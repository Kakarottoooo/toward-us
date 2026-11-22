import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "toward_us_session";
export const DEMO_COOKIE = "toward_us_demo";
const SESSION_AGE_SECONDS = 60 * 60 * 24 * 30;
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

export function setSessionCookie(res, token, production) {
  const secure = production ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${SESSION_AGE_SECONDS}`);
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
  const hint = String(req.headers?.["accept-language"] || "").toLowerCase().match(/^\s*(zh|en|es)(?![a-z])/)?.[1];
  return hint || null;
}

export function normalizeEmail(value) { return String(value || "").trim().toLowerCase().slice(0, 254); }
export function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
export function validPassword(value) { return typeof value === "string" && value.length >= 10 && value.length <= 128; }
