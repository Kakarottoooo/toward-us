import { randomInt } from "node:crypto";
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

// Opening a link only ever shows a confirmation; binding needs a deliberate POST, so a forwarded link cannot bind by itself.
export async function createPhoneLink(store, phone, { baseUrl = process.env.TOWARD_US_BASE_URL || "", now = new Date() } = {}) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw Object.assign(new Error("invalid_phone"), { statusCode: 400, code: "invalid_phone" });
  const code = Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  await store.createPhoneLink({ codeHash: sessionId(code), phone: normalized, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + PHONE_LINK_TTL_MS).toISOString() });
  return { code, url: `${String(baseUrl).replace(/\/+$/, "")}/m/${code}` };
}

const TEXT = {
  zh: {
    title: "PINKY", ok: "手机号已绑定", okBody: (phone) => `${phone} 已绑定到你的账号。回到信息 App 继续对话即可。`,
    expired: "链接已失效", expiredBody: "这个链接已过期或已经用过了。请再给我们发一条消息，会收到新的链接。",
    taken: "无法绑定", takenBody: "这个手机号已经绑定了另一个账号。", unauthenticated: "请先登录。", unbound: "手机号已解绑。",
    confirm: "绑定这个手机号？", confirmBody: (phone) => `将把 ${phone} 绑定到你当前登录的账号。`,
    confirmWarning: "只有在你刚刚亲自用这部手机给我们发过消息时才确认。如果这个链接是别人转发给你的，请不要确认。",
    replaceNote: (old) => `你的账号已绑定 ${old}，确认后会被替换。`, confirmButton: "确认绑定",
  },
  en: {
    title: "PINKY", ok: "Phone linked", okBody: (phone) => `${phone} is now linked to your account. Go back to Messages and keep talking.`,
    expired: "This link has expired", expiredBody: "The link expired or was already used. Text us again to get a new one.",
    taken: "Can't link this number", takenBody: "This phone number is already linked to another account.", unauthenticated: "Please sign in.", unbound: "Phone number unlinked.",
    confirm: "Link this phone number?", confirmBody: (phone) => `This will link ${phone} to the account you are signed in to.`,
    confirmWarning: "Only confirm if you just texted Pinky from this phone yourself. If someone else sent you this link, do not confirm.",
    replaceNote: (old) => `Your account is already linked to ${old}; confirming will replace it.`, confirmButton: "Confirm and link",
  },
  es: {
    title: "PINKY", ok: "Teléfono vinculado", okBody: (phone) => `${phone} ya está vinculado a tu cuenta. Vuelve a Mensajes y sigue conversando.`,
    expired: "El enlace ha caducado", expiredBody: "El enlace caducó o ya se usó. Escríbenos de nuevo para recibir uno nuevo.",
    taken: "No se puede vincular", takenBody: "Este número de teléfono ya está vinculado a otra cuenta.", unauthenticated: "Inicia sesión.", unbound: "Teléfono desvinculado.",
    confirm: "¿Vincular este teléfono?", confirmBody: (phone) => `Se vinculará ${phone} a la cuenta con la que has iniciado sesión.`,
    confirmWarning: "Confirma solo si acabas de escribir a Pinky tú mismo desde este teléfono. Si otra persona te envió este enlace, no confirmes.",
    replaceNote: (old) => `Tu cuenta ya está vinculada a ${old}; al confirmar se reemplazará.`, confirmButton: "Confirmar y vincular",
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

function page(req, res, status, language, code, heading, body, form = null) {
  res.setHeader("Cache-Control", "no-store");
  // same-origin, not no-referrer: with no-referrer browsers send `Origin: null` on the Confirm POST and the same-origin
  // check rejects it. same-origin still never leaks the one-time code in the URL to another site.
  res.setHeader("Referrer-Policy", "same-origin");
  if (req.accepts(["html", "json"]) === "json") return res.status(status).json({ code, error: heading, message: [body].flat().join(" ") });
  res.status(status).type("html").send(`<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(heading)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f1e7;color:#1d1b18;font:17px/1.5 system-ui,sans-serif}main{max-width:26rem;padding:2rem 1.5rem}p.brand{letter-spacing:.2em;font-size:.8rem;margin:0 0 1.5rem}h1{font-size:1.5rem;margin:0 0 .75rem}p{margin:0 0 .75rem}button{font:inherit;padding:.6rem 1.2rem;border:0;border-radius:.5rem;background:#1d1b18;color:#f6f1e7;margin-top:.5rem}</style></head><body><main><p class="brand">${escapeHtml(TEXT[language].title)}</p><h1>${escapeHtml(heading)}</h1>${[body].flat().map((line) => `<p>${escapeHtml(line)}</p>`).join("")}${form ? `<form method="post" action="${escapeHtml(form.action)}"><button type="submit">${escapeHtml(form.label)}</button></form>` : ""}</main></body></html>`);
}

// `onBound(userId)` runs after a number is linked (the couple's iMessage group may now be possible).
export function createPhoneRouter({ store, onBound = () => {} }) {
  const router = express.Router();

  // GET only previews: it never consumes the link or touches the account.
  router.get("/m/:code", async (req, res, next) => {
    const language = languageOf(req); const text = TEXT[language]; const code = String(req.params.code || "");
    if (!CODE_PATTERN.test(code)) return page(req, res, 410, language, "link_expired", text.expired, text.expiredBody);
    if (!req.auth) { res.setHeader("Cache-Control", "no-store"); return res.redirect(302, `/?next=/m/${code}`); }
    try {
      const phone = await store.getPhoneLink(sessionId(code), new Date().toISOString());
      if (!phone) return page(req, res, 410, language, "link_expired", text.expired, text.expiredBody);
      const current = await store.getPhoneForUser(req.auth.user.id);
      const body = [text.confirmBody(maskPhone(phone)), text.confirmWarning, ...(current && current !== phone ? [text.replaceNote(maskPhone(current))] : [])];
      page(req, res, 200, language, "confirm_required", text.confirm, body, { action: `/m/${code}?language=${language}`, label: text.confirmButton });
    } catch (error) { next(error); }
  });

  // The same-origin check in app.mjs guards this POST; the form carries no secret beyond the one-time code in its URL.
  router.post("/m/:code", async (req, res, next) => {
    const language = languageOf(req); const text = TEXT[language]; const code = String(req.params.code || "");
    const expired = () => page(req, res, 410, language, "link_expired", text.expired, text.expiredBody);
    if (!CODE_PATTERN.test(code)) return expired();
    if (!req.auth) return res.redirect(303, `/?next=/m/${code}`);
    try {
      const phone = await store.consumePhoneLink(sessionId(code), req.auth.user.id, new Date().toISOString());
      if (!phone) return expired();
      onBound(req.auth.user.id);
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
