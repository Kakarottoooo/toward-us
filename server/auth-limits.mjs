// Sign-up, sign-in and recovery limits. Counts are in memory and per app instance (render.yaml numInstances: 1); a restart
// forgets counts, never accounts or trusted devices.
//
// Sign-in (QA round 7, replacing the round-6 ceiling):
// - Reserve, then check: every attempt is counted per network and per network+address BEFORE the password is compared,
//   synchronously, so parallel requests can never run more compares than the caps allow. A success gives its slot back.
// - No account-wide lockout of a correct password. When an account is under attack (>= 20 wrong passwords in the last hour
//   from all networks), a correct password from a device that isn't trusted for that account must also enter a 6-digit
//   code we email (202 {code: "verify_email"}); a trusted device signs in directly. Wrong passwords then wait a short,
//   fixed delay. Per-network caps stay, and stop guessing from any one source.
// - Without a configured proxy everyone may share one address, so the per-network caps never refuse; past them, a correct
//   password from an untrusted device takes the same email step instead (no global lockout).
import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";

// Production numbers. Tests that drive many accounts through one app pass their own `authLimits` to createApiApp.
export const DEFAULT_AUTH_LIMITS = Object.freeze({
  // Every sign-up that reaches the store (created or "already registered") counts, so probing which addresses have an
  // account is capped at the same rate as creating them.
  registerPerIp: { max: 20, windowMs: 60 * 60_000 },
  registerGlobal: { max: 300, windowMs: 10 * 60_000 },
  // Sign-in attempts per network and address (a typo-prone person) and per network across all addresses (spraying).
  loginPerIpEmail: { max: 10, windowMs: 10 * 60_000 },
  loginPerIp: { max: 50, windowMs: 15 * 60_000 },
  // An account is under attack past this many wrong passwords in the window, from all networks together.
  accountAttack: { threshold: 20, windowMs: 60 * 60_000, delayMs: 1000 },
  // The emailed step-up code: lifetime, wrong tries before it is discarded, and the gap before another email is sent.
  emailCode: { ttlMs: 10 * 60_000, maxTries: 5, resendMs: 60_000 },
  // Recovery-code guesses per account across networks (rotating IPs): exponential backoff, cleared by a reset.
  recoveryBackoff: { free: 10, maxSeconds: 15 * 60 },
});

// When no proxy is configured (neither TRUST_PROXY nor RENDER), every request may arrive from one proxy address. Sign-up
// caps are raised; sign-in caps then mark requests as suspicious instead of refusing them (see above).
export const SHARED_ADDRESS_LIMITS = Object.freeze({
  registerPerIp: { max: 200, windowMs: 60 * 60_000 },
  registerGlobal: { max: 1000, windowMs: 10 * 60_000 },
  loginPerIpEmail: { max: 50, windowMs: 10 * 60_000 },
  loginPerIp: { max: 1000, windowMs: 15 * 60_000 },
});

export const emailKey = (email) => createHash("sha256").update(String(email)).digest("hex");

// A sliding window per key. take() counts and returns 0, or returns the seconds until a slot frees (and counts nothing).
export function windowLimiter({ max, windowMs }, now = () => Date.now()) {
  const hits = new Map();
  const recent = (key) => (hits.get(key) || []).filter((at) => at > now() - windowMs);
  const wait = (key) => { const times = recent(key); return times.length >= max ? Math.max(1, Math.ceil((times[times.length - max] + windowMs - now()) / 1000)) : 0; };
  const hit = (key) => {
    hits.set(key, [...recent(key), now()]);
    if (hits.size > 10_000) for (const [candidate] of hits) if (!recent(candidate).length) hits.delete(candidate);
  };
  // Gives back one counted slot (the most recent), for an attempt that turned out to be the owner's.
  const unhit = (key) => { const times = recent(key); times.pop(); if (times.length) hits.set(key, times); else hits.delete(key); };
  return { wait, hit, unhit, count: (key) => recent(key).length, take: (key) => { const seconds = wait(key); if (!seconds) hit(key); return seconds; }, clear: (key) => hits.delete(key) };
}

// Exponential backoff per key: after `free` failures the next try waits 2^(failures - free) seconds after the last
// failure, capped at maxSeconds. Tries during the wait are refused without counting.
export function backoff({ free, maxSeconds }, now = () => Date.now()) {
  const state = new Map();
  const wait = (key) => {
    const entry = state.get(key);
    if (!entry || entry.failures < free) return 0;
    const delay = Math.min(maxSeconds, 2 ** (entry.failures - free)) * 1000;
    return Math.max(0, Math.ceil((entry.lastAt + delay - now()) / 1000));
  };
  const fail = (key) => {
    const entry = state.get(key) || { failures: 0, lastAt: 0 };
    // A day without failures starts over.
    if (now() - entry.lastAt > 24 * 60 * 60_000) entry.failures = 0;
    entry.failures += 1; entry.lastAt = now(); state.set(key, entry);
    if (state.size > 10_000) for (const [candidate, value] of state) if (now() - value.lastAt > 24 * 60 * 60_000) state.delete(candidate);
  };
  return { wait, fail, clear: (key) => state.delete(key) };
}

// Trusted devices. The cookie holds, for each account this browser signed in to, HMAC(key, userId) where the key is derived
// from the account's stored password hash: a server-side secret that survives restarts and deploys and changes whenever
// the password is changed or reset, which un-trusts every device at once. Accounts without a password (federated,
// deleted) never have trusted devices here.
const DEVICE_MARKS = 5;
const deviceMark = (user) => {
  const stored = String(user?.passwordHash || "");
  if (!user?.id || !stored.startsWith("scrypt$")) return "";
  const key = createHash("sha256").update(`ourever-trusted-device-v1\0${stored}`).digest();
  return createHmac("sha256", key).update(String(user.id)).digest("base64url").slice(0, 32);
};
export function deviceTrusted(cookie, user) {
  const expected = deviceMark(user);
  if (!expected) return false;
  return String(cookie || "").split(".").some((mark) => mark.length === expected.length && timingSafeEqual(Buffer.from(mark), Buffer.from(expected)));
}
/** The cookie value after this browser proved it can sign in to `user`: its mark first, up to five accounts kept. */
export function trustDevice(cookie, user) {
  const mark = deviceMark(user);
  const others = String(cookie || "").split(".").filter((value) => /^[\w-]{32}$/.test(value) && value !== mark);
  return [mark, ...others].filter(Boolean).slice(0, DEVICE_MARKS).join(".");
}

export function createAuthLimits(limits = DEFAULT_AUTH_LIMITS, { sharedAddress = false } = {}) {
  const config = { ...DEFAULT_AUTH_LIMITS, ...limits };
  const registerPerIp = windowLimiter(config.registerPerIp);
  const registerGlobal = windowLimiter(config.registerGlobal);
  const loginPerIpEmail = windowLimiter(config.loginPerIpEmail);
  const loginPerIp = windowLimiter(config.loginPerIp);
  const wrongPasswords = windowLimiter({ max: Number.MAX_SAFE_INTEGER, windowMs: config.accountAttack.windowMs });
  const recovery = backoff(config.recoveryBackoff);
  // Pending email step-up codes per account: sha256 of the code, expiry, tries left, when it was last sent.
  const challenges = new Map();
  const underAttack = (email) => wrongPasswords.count(emailKey(email)) >= config.accountAttack.threshold;
  return {
    // Counts this attempt before the password is compared, synchronously, so parallel requests see each other's counts.
    // Returns { wait } (seconds to refuse with) or a ticket for loginFailed / loginSucceeded / stepUpNeeded.
    reserveLogin(ip, email) {
      const pair = `${ip}:${emailKey(email)}`;
      const over = Math.max(loginPerIpEmail.wait(pair), loginPerIp.wait(ip));
      if (over && !sharedAddress) return { wait: over };
      loginPerIpEmail.hit(pair); loginPerIp.hit(ip);
      return { wait: 0, ip, email, pair, suspicious: Boolean(over) };
    },
    // A wrong password (or no such account) counts toward the account's attack window. Returns ms to hold the answer.
    loginFailed(ticket) {
      const delay = underAttack(ticket.email) || ticket.suspicious ? config.accountAttack.delayMs : 0;
      wrongPasswords.hit(emailKey(ticket.email));
      return delay;
    },
    // The right password from a device that isn't trusted, while the account is under attack (or the shared address is
    // past its caps), needs the emailed code too.
    stepUpNeeded: (ticket, { trusted }) => !trusted && (ticket.suspicious || underAttack(ticket.email)),
    // The owner got in: their network's slots are given back.
    loginSucceeded(ticket) { loginPerIpEmail.clear(ticket.pair); loginPerIp.unhit(ticket.ip); },
    // A fresh code to email for this account, or null when one went out too recently (that one still works).
    issueEmailCode(userId) {
      const current = challenges.get(userId);
      if (current && current.expiresAt > Date.now() && Date.now() - current.sentAt < config.emailCode.resendMs) return null;
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      challenges.set(userId, { hash: emailKey(code), expiresAt: Date.now() + config.emailCode.ttlMs, triesLeft: config.emailCode.maxTries, sentAt: Date.now() });
      if (challenges.size > 10_000) for (const [id, value] of challenges) if (value.expiresAt <= Date.now()) challenges.delete(id);
      return code;
    },
    // true when `code` matches this account's pending code, which is then used up. Each wrong code uses up a try.
    checkEmailCode(userId, code) {
      const current = challenges.get(userId);
      if (!current || current.expiresAt <= Date.now()) { challenges.delete(userId); return false; }
      const given = Buffer.from(emailKey(String(code || "").replace(/\D/g, ""))), expected = Buffer.from(current.hash);
      if (timingSafeEqual(given, expected)) { challenges.delete(userId); return true; }
      current.triesLeft -= 1; if (current.triesLeft <= 0) challenges.delete(userId);
      return false;
    },
    underAttack,
    // Seconds to wait before this sign-up may go ahead; 0 means go, and it has been counted.
    register(ip) {
      const wait = Math.max(registerPerIp.wait(ip), registerGlobal.wait("all"));
      if (!wait) { registerPerIp.hit(ip); registerGlobal.hit("all"); }
      return wait;
    },
    recoveryWait: (email) => recovery.wait(emailKey(email)),
    recoveryFailed: (email) => recovery.fail(emailKey(email)),
    // The owner proved control of the mailbox or the recovery code: the attack window and recovery backoff start fresh.
    passwordReset(email, userId) { wrongPasswords.clear(emailKey(email)); recovery.clear(emailKey(email)); if (userId) challenges.delete(userId); },
  };
}

// "how long" in the reader's language: seconds under a minute, else whole minutes rounded up.
export function waitText(language, seconds) {
  const minutes = Math.ceil(seconds / 60);
  const [count, zh, en, es] = seconds < 60
    ? [seconds, "秒", `second${seconds === 1 ? "" : "s"}`, `segundo${seconds === 1 ? "" : "s"}`]
    : [minutes, "分钟", `minute${minutes === 1 ? "" : "s"}`, `minuto${minutes === 1 ? "" : "s"}`];
  return language === "zh" ? `${count} ${zh}` : language === "es" ? `${count} ${es}` : `${count} ${en}`;
}

export function tooManyTries(language, seconds, { reset = false } = {}) {
  const wait = waitText(language, seconds);
  const text = language === "zh" ? `尝试次数过多，请 ${wait}后再试。` : language === "es" ? `Demasiados intentos. Vuelve a intentarlo en ${wait}.` : `Too many tries. Try again in ${wait}.`;
  return reset ? text + resetNow(language) : text;
}
// Said with a sign-in or recovery wait: resetting the password by email is never behind the same limit (QA round 7, E).
export function resetNow(language) {
  return language === "zh" ? "也可以现在点“忘记密码？”，用邮件重设密码。" : language === "es" ? " También puedes tocar «¿Olvidaste tu contraseña?» y restablecerla por correo ahora mismo." : " You can also tap “Forgot password?” and reset it by email right now.";
}

// Express "trust proxy" from TRUST_PROXY: unset means nothing is in front, so X-Forwarded-For is ignored and req.ip is
// the socket address. A number is a hop count (Render runs one proxy hop: TRUST_PROXY=1 takes the address that proxy
// appended, the right-most X-Forwarded-For entry). Anything else is passed through (for example "loopback").
export function trustProxySetting(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "false") return false;
  if (/^\d+$/.test(text)) return Number(text);
  return text === "true" ? true : text;
}
