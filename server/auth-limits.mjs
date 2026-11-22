// Sign-up, sign-in and recovery limits (QA round 5, findings 8–11). Everything is in memory and per app instance:
// the service runs one instance (render.yaml numInstances: 1), and a restart only forgets counts, never accounts.
import { createHash } from "node:crypto";

// Production numbers. Tests that drive many accounts through one app pass their own `authLimits` to createApiApp.
export const DEFAULT_AUTH_LIMITS = Object.freeze({
  // Every sign-up that reaches the store (created or "already registered") counts, so probing which addresses have an
  // account is capped at the same rate as creating them.
  registerPerIp: { max: 20, windowMs: 60 * 60_000 },
  registerGlobal: { max: 300, windowMs: 10 * 60_000 },
  // Failed sign-ins: per network and address (a typo-prone person), per network across all addresses (spraying).
  loginPerIpEmail: { max: 10, windowMs: 10 * 60_000 },
  loginPerIp: { max: 50, windowMs: 15 * 60_000 },
  // Per account, whatever the network: a few free failures, then 1 s, 2 s, 4 s … up to 15 minutes between tries.
  // It slows guessing without locking the owner out: a password reset by email or recovery code clears it.
  accountBackoff: { free: 5, maxSeconds: 15 * 60 },
  // Recovery-code guesses per account across networks (rotating IPs): same backoff shape, cleared by a reset.
  recoveryBackoff: { free: 10, maxSeconds: 15 * 60 },
});

export const emailKey = (email) => createHash("sha256").update(String(email)).digest("hex");

// A fixed window per key. take() counts and returns 0, or returns the seconds until a slot frees (and counts nothing).
export function windowLimiter({ max, windowMs }, now = () => Date.now()) {
  const hits = new Map();
  const recent = (key) => (hits.get(key) || []).filter((at) => at > now() - windowMs);
  const wait = (key) => { const times = recent(key); return times.length >= max ? Math.max(1, Math.ceil((times[times.length - max] + windowMs - now()) / 1000)) : 0; };
  const hit = (key) => {
    hits.set(key, [...recent(key), now()]);
    if (hits.size > 10_000) for (const [candidate] of hits) if (!recent(candidate).length) hits.delete(candidate);
  };
  return { wait, hit, take: (key) => { const seconds = wait(key); if (!seconds) hit(key); return seconds; }, clear: (key) => hits.delete(key) };
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

export function createAuthLimits(limits = DEFAULT_AUTH_LIMITS) {
  const config = { ...DEFAULT_AUTH_LIMITS, ...limits };
  const registerPerIp = windowLimiter(config.registerPerIp);
  const registerGlobal = windowLimiter(config.registerGlobal);
  const loginPerIpEmail = windowLimiter(config.loginPerIpEmail);
  const loginPerIp = windowLimiter(config.loginPerIp);
  const account = backoff(config.accountBackoff);
  const recovery = backoff(config.recoveryBackoff);
  return {
    // Seconds to wait before this sign-up may go ahead; 0 means go, and it has been counted.
    register(ip) {
      const wait = Math.max(registerPerIp.wait(ip), registerGlobal.wait("all"));
      if (!wait) { registerPerIp.hit(ip); registerGlobal.hit("all"); }
      return wait;
    },
    loginWait: (ip, email) => Math.max(loginPerIpEmail.wait(`${ip}:${email}`), loginPerIp.wait(ip), account.wait(emailKey(email))),
    loginFailed(ip, email) { loginPerIpEmail.hit(`${ip}:${email}`); loginPerIp.hit(ip); account.fail(emailKey(email)); },
    loginSucceeded(ip, email) { loginPerIpEmail.clear(`${ip}:${email}`); account.clear(emailKey(email)); },
    recoveryWait: (email) => recovery.wait(emailKey(email)),
    recoveryFailed: (email) => recovery.fail(emailKey(email)),
    // The owner proved control of the mailbox or the recovery code: sign-in and recovery start fresh for this account.
    passwordReset(email) { account.clear(emailKey(email)); recovery.clear(emailKey(email)); },
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

export function tooManyTries(language, seconds) {
  const wait = waitText(language, seconds);
  return language === "zh" ? `尝试次数过多，请 ${wait}后再试。` : language === "es" ? `Demasiados intentos. Vuelve a intentarlo en ${wait}.` : `Too many tries. Try again in ${wait}.`;
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
