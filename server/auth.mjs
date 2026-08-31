import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "toward_us_session";
const SESSION_AGE_SECONDS = 60 * 60 * 24 * 30;

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

export async function issueSession(store, userId) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const session = {
    id: sessionId(token),
    userId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_AGE_SECONDS * 1000).toISOString(),
  };
  await store.createSession(session);
  return { token, session };
}

export function readSessionToken(req) {
  const cookies = String(req.headers.cookie || "").split(";");
  for (const entry of cookies) {
    const [name, ...parts] = entry.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(parts.join("="));
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

export function createUser({ email, name, passwordHash }) {
  return { id: randomUUID(), email, name, passwordHash, createdAt: new Date().toISOString() };
}

export function publicUser(user) {
  return user ? { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt } : null;
}

export function normalizeEmail(value) { return String(value || "").trim().toLowerCase().slice(0, 254); }
export function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
export function validPassword(value) { return typeof value === "string" && value.length >= 10 && value.length <= 128; }
