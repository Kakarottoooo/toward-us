import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import express from "express";
import { sessionId } from "./auth.mjs";

// A verified phone number is bound to an account by a one-time link. Nothing here sends a message: the future iMessage
// task calls createPhoneLink and delivers the URL itself. The raw code is never stored, only its sha256 (like sessions).
export const PHONE_LINK_TTL_MS = 30 * 60 * 1000;
const CODE_PATTERN = /^[a-z0-9]{12}$/;
const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const LANGUAGES = ["zh", "en", "es"];

export function normalizePhone(value) {
  if (typeof value !== "string") return null;
  const compact = value.replace(/[\s().-]/g, "");
  return /^\+\d{8,15}$/.test(compact) ? compact : null;
}

export const phoneTakenError = () => Object.assign(new Error("phone_taken"), { statusCode: 409, code: "phone_taken" });

export async function createPhoneLink(store, phone, { baseUrl = process.env.TOWARD_US_BASE_URL || "", now = new Date() } = {}) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw Object.assign(new Error("invalid_phone"), { statusCode: 400, code: "invalid_phone" });
  const code = Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  await store.createPhoneLink({ codeHash: sessionId(code), phone: normalized, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + PHONE_LINK_TTL_MS).toISOString() });
  return { code, url: `${String(baseUrl).replace(/\/+$/, "")}/m/${code}` };
}

const TEXT = {
  zh: {
    title: "彼此", ok: "手机号已绑定", okBody: (phone) => `${phone} 已绑定到你的账号。回到信息 App 继续对话即可。`,
    expired: "链接已失效", expiredBody: "这个链接已过期或已经用过了。请再给我们发一条消息，会收到新的链接。",
    taken: "无法绑定", takenBody: "这个手机号已经绑定了另一个账号。", unauthenticated: "请先登录。", unbound: "手机号已解绑。",
  },
  en: {
    title: "TOWARD US", ok: "Phone linked", okBody: (phone) => `${phone} is now linked to your account. Go back to Messages and keep talking.`,
    expired: "This link has expired", expiredBody: "The link expired or was already used. Text us again to get a new one.",
    taken: "Can't link this number", takenBody: "This phone number is already linked to another account.", unauthenticated: "Please sign in.", unbound: "Phone number unlinked.",
  },
  es: {
    title: "TOWARD US", ok: "Teléfono vinculado", okBody: (phone) => `${phone} ya está vinculado a tu cuenta. Vuelve a Mensajes y sigue conversando.`,
    expired: "El enlace ha caducado", expiredBody: "El enlace caducó o ya se usó. Escríbenos de nuevo para recibir uno nuevo.",
    taken: "No se puede vincular", takenBody: "Este número de teléfono ya está vinculado a otra cuenta.", unauthenticated: "Inicia sesión.", unbound: "Teléfono desvinculado.",
  },
};

function languageOf(req) {
  const explicit = req.body?.language || req.query?.language;
  if (LANGUAGES.includes(explicit)) return explicit;
  for (const part of String(req.headers["accept-language"] || "").split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase().slice(0, 2);
    if (LANGUAGES.includes(tag)) return tag;
  }
  return "en";
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const maskPhone = (phone) => phone.length > 6 ? `${phone.slice(0, 2)}${"•".repeat(phone.length - 6)}${phone.slice(-4)}` : phone;
const digest = (value) => createHash("sha256").update(value).digest();

function page(req, res, status, language, code, heading, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.accepts(["html", "json"]) === "json") return res.status(status).json({ code, error: heading, message: body });
  res.status(status).type("html").send(`<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(heading)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f1e7;color:#1d1b18;font:17px/1.5 system-ui,sans-serif}main{max-width:26rem;padding:2rem 1.5rem}p.brand{letter-spacing:.2em;font-size:.8rem;margin:0 0 1.5rem}h1{font-size:1.5rem;margin:0 0 .75rem}p{margin:0}</style></head><body><main><p class="brand">${escapeHtml(TEXT[language].title)}</p><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(body)}</p></main></body></html>`);
}

export function createPhoneRouter({ store, internalSecret = () => "" }) {
  const router = express.Router();

  // Server-to-server only: the future iMessage task mints links here (or calls createPhoneLink directly).
  router.post("/api/internal/phone-links", async (req, res, next) => {
    const secret = internalSecret();
    if (!secret || secret.length < 32) return res.status(503).json({ error: "Phone links are not configured." });
    const provided = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
    if (!timingSafeEqual(digest(provided), digest(`Bearer ${secret}`))) return res.status(401).json({ error: "Unauthorized." });
    const phone = normalizePhone(req.body?.phone);
    if (!phone) return res.status(400).json({ error: "A phone number in E.164 format is required.", code: "invalid_phone" });
    try {
      const host = String(req.get("host") || "");
      const baseUrl = process.env.TOWARD_US_BASE_URL || (/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host) ? `${req.protocol}://${host}` : "");
      res.status(201).json(await createPhoneLink(store, phone, { baseUrl }));
    } catch (error) { next(error); }
  });

  router.get("/m/:code", async (req, res, next) => {
    const language = languageOf(req); const text = TEXT[language]; const code = String(req.params.code || "");
    const expired = () => page(req, res, 410, language, "link_expired", text.expired, text.expiredBody);
    if (!CODE_PATTERN.test(code)) return expired();
    if (!req.auth) { res.setHeader("Cache-Control", "no-store"); return res.redirect(302, `/?next=/m/${code}`); }
    try {
      const phone = await store.consumePhoneLink(sessionId(code), req.auth.user.id, new Date().toISOString());
      if (!phone) return expired();
      page(req, res, 200, language, "phone_linked", text.ok, text.okBody(maskPhone(phone)));
    } catch (error) {
      if (error?.code === "phone_taken") return page(req, res, 409, language, "phone_taken", text.taken, text.takenBody);
      next(error);
    }
  });

  router.post("/api/phone/unbind", async (req, res, next) => {
    const text = TEXT[languageOf(req)];
    if (!req.auth) return res.status(401).json({ error: text.unauthenticated, code: "unauthenticated" });
    try { await store.unbindPhone(req.auth.user.id); res.json({ unbound: true, message: text.unbound }); } catch (error) { next(error); }
  });
  return router;
}
