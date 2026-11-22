import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "toward_us_session";
export const DEMO_COOKIE = "toward_us_demo";
export const DEVICE_COOKIE = "toward_us_device";
const SESSION_AGE_SECONDS = 60 * 60 * 24 * 30;
// Sliding sessions (QA round 6): a session used after half its life is extended to a fresh 30 days, but never past a
// year from sign-in. Signing out, a password change or account deletion still end it at once.
const SESSION_MAX_LIFETIME_SECONDS = 60 * 60 * 24 * 365;
const DEVICE_AGE_SECONDS = 60 * 60 * 24 * 365;
const DEMO_AGE_SECONDS = 60 * 60;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, { cost: 16384, blockSize: 8, parallelization: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, cost, saltValue, hashValue] = String(encoded || "").split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltValue, "base64url"), expected.length, {
    cost: Number(cost), blockSize: 8, parallelization: 1, maxmem: 64 * 1024 * 1024,
  }));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function issueSession(store, userId, provider = null) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const session = {
    id: sessionId(token),
    userId,
    ...(provider ? { provider } : {}),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_AGE_SECONDS * 1000).toISOString(),
  };
  await store.createSession(session);
  return { token, session };
}

export function readSessionToken(req) {
  return readCookie(req, SESSION_COOKIE);
}

/** The later expiry a session in use should get now, or null when it needs none yet. */
export function renewedSessionExpiry(session, now = new Date()) {
  const expires = Date.parse(session.expiresAt), created = Date.parse(session.createdAt);
  if (!Number.isFinite(expires) || expires - now.getTime() > (SESSION_AGE_SECONDS * 1000) / 2) return null;
  const cap = Number.isFinite(created) ? created + SESSION_MAX_LIFETIME_SECONDS * 1000 : now.getTime() + SESSION_AGE_SECONDS * 1000;
  const next = Math.min(now.getTime() + SESSION_AGE_SECONDS * 1000, cap);
  return next > expires + 60_000 ? new Date(next).toISOString() : null;
}

export function readDeviceToken(req) { return readCookie(req, DEVICE_COOKIE); }

export function setDeviceCookie(res, token, production) {
  const secure = production ? "; Secure" : "";
  res.append("Set-Cookie", `${DEVICE_COOKIE}=${encodeURIComponent(token)}; HttpOnly${secure}; SameSite=Lax; Path=/api/auth; Max-Age=${DEVICE_AGE_SECONDS}`);
}

export function readDemoToken(req) {
  return readCookie(req, DEMO_COOKIE);
}

function readCookie(req, cookieName) {
  const cookies = String(req.headers.cookie || "").split(";");
  for (const entry of cookies) {
    const [name, ...parts] = entry.trim().split("=");
    if (name === cookieName) return decodeURIComponent(parts.join("="));
  }
  return "";
}

export function sessionId(token) { return createHash("sha256").update(String(token)).digest("base64url"); }

export function setSessionCookie(res, token, production, maxAge = SESSION_AGE_SECONDS) {
  const secure = production ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${Math.max(1, Math.floor(maxAge))}`);
}

export function clearSessionCookie(res, production) {
  const secure = production ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`);
}

export function setDemoCookie(res, token, production) {
  const secure = production ? "; Secure" : "";
  res.append("Set-Cookie", `${DEMO_COOKIE}=${encodeURIComponent(token)}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${DEMO_AGE_SECONDS}`);
}

export function clearDemoCookie(res, production) {
  const secure = production ? "; Secure" : "";
  res.append("Set-Cookie", `${DEMO_COOKIE}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`);
}

// nameSource (QA round 5): "user" when the member typed the name, "provider" when Google/Apple gave it, "fallback" when the
// server made one up ("我", an email's local part). Onboarding asks for a name only in the last case. language is the
// interface language at sign-up, so Coming up can show both partners' holidays before either changes it.
export function createUser({ email, name, passwordHash, nameSource = "user", language = null }) {
  return { id: randomUUID(), email, name, passwordHash, nameSource, language, createdAt: new Date().toISOString() };
}

export function publicUser(user) {
  return user ? { id: user.id, email: user.email, name: user.name, nameSet: nameWasChosen(user), createdAt: user.createdAt } : null;
}

// Accounts from before nameSource was stored: only the register fallback "我" is known not to be chosen.
export function nameWasChosen(user) { return user.nameSource ? user.nameSource !== "fallback" : user.name !== "我"; }

const SIGNUP_LANGUAGES = new Set(["zh", "en", "es"]);
/** The interface language a sign-up came from: the body's, else the browser's Accept-Language, else null. */
export function signupLanguage(req) {
  if (SIGNUP_LANGUAGES.has(req.body?.language)) return req.body.language;
  return acceptedLanguage(req.headers?.["accept-language"]);
}

/** The supported language (zh, en, es) an Accept-Language header prefers most, honouring q-values; null when none. */
export function acceptedLanguage(header) {
  const ranked = String(header || "").split(",").map((part, index) => {
    const [tag, ...params] = part.trim().toLowerCase().split(";");
    const q = params.map((param) => param.trim().match(/^q=([0-9.]+)$/)?.[1]).find(Boolean);
    return { base: tag.trim().split("-")[0], q: q === undefined ? 1 : Number(q), index };
  }).filter((entry) => SIGNUP_LANGUAGES.has(entry.base) && entry.q > 0).sort((a, b) => b.q - a.q || a.index - b.index);
  return ranked[0]?.base || null;
}

export function normalizeEmail(value) { return String(value || "").trim().toLowerCase().slice(0, 254); }
export function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
export function validPassword(value) { return typeof value === "string" && value.length >= 10 && value.length <= 128; }
