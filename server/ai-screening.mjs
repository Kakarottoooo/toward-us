import { chatSignal } from "./chat-response.mjs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { checkCurrentAiPermission, servingAiAccounts } from "./ai-ledger.mjs";
import { currentAiUser } from "./ai-budget.mjs";

const errors = {
  ai_screening_unavailable: ["Ourever 暂时没法检查这条消息，请稍后再试。", "Ourever can't check this message right now — try again in a moment.", "Ourever no puede revisar este mensaje ahora mismo. Inténtalo de nuevo en un momento."],
  ai_content_blocked: ["这段内容未通过安全检查。请调整内容，或在设置中联系支持。", "This content did not pass safety screening. Revise it or contact Support in Settings.", "El contenido no pasó la revisión de seguridad. Edítalo o contacta con soporte en Ajustes."],
};
function failure(code) {
  const language = currentAiUser()?.language;
  return Object.assign(new Error(errors[code][language === "en" ? 1 : language === "es" ? 2 : 0]), { code, statusCode: code === "ai_content_blocked" ? 422 : 503 });
}
export const isAiPolicyError = (error) => error?.code === "ai_consent_required" || Object.hasOwn(errors, error?.code ?? "");

async function screen(input, direction) {
  await checkCurrentAiPermission();
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw failure("ai_screening_unavailable");
  const result = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST", redirect: "error", signal: chatSignal() ? AbortSignal.any([chatSignal(), AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "omni-moderation-latest", input }),
  }).then((r) => r.ok ? r.json() : null).catch(() => null);
  const rows = result?.results;
  const expected = typeof input[0] === "string" ? input.length : 1;
  if (!Array.isArray(rows) || rows.length !== expected || rows.some((r) => typeof r?.flagged !== "boolean")) throw failure("ai_screening_unavailable");
  // A disclosure of violence or suicidal feelings can be a request for help. Permit those inputs to reach the existing
  // safety response; never exempt a generated reply, instructions for harm, threats, or other flagged categories.
  for (const row of rows) if (row.flagged) {
    const categories = Object.entries(row.categories || {}).filter(([, flagged]) => flagged).map(([category]) => category);
    if (direction !== "input" || !categories.length || categories.some((c) => !["self-harm", "self-harm/intent", "violence"].includes(c))) throw failure("ai_content_blocked");
  }
}

export async function screenText(value, direction = "input") {
  if (!servingAiAccounts() || !value) return;
  const chunks = String(value).match(/[\s\S]{1,6000}/gu) || [];
  for (let i = 0; i < chunks.length; i += 8) await screen(chunks.slice(i, i + 8), direction);
}

/** Founder 11-22: a partner's own words to the other partner are delivered even while screening is unavailable, and
 * screened afterwards (together-domain screenDeferredMessages). Opt-in for that path only; every other caller stays
 * fail-closed through screenText. Resolves null when screened, or the unavailable error when screening was deferred. */
export async function screenTextOrDefer(value) {
  try { await screenText(value); return null; }
  catch (error) { if (error?.code === "ai_screening_unavailable") return error; throw error; }
}

export async function screenImage(bytes, mime) {
  if (!servingAiAccounts()) return;
  await screen([{ type: "image_url", image_url: { url: `data:${mime};base64,${bytes.toString("base64")}` } }], "input");
}

export function screenedClient(client) {
  if (!client) return client;
  return {
    ...client,
    responses: { async create(params, options) {
      const messages = Array.isArray(params.input) ? params.input.filter((m) => ["user", "assistant"].includes(m.role)).map((m) => m.content) : [params.input];
      await screenText(messages.map((v) => typeof v === "string" ? v : JSON.stringify(v)).join("\n"));
      const signal = chatSignal();
      signal?.throwIfAborted();
      const result = await client.responses.create(params, signal ? { ...options, signal: options?.signal ? AbortSignal.any([signal, options.signal]) : signal } : options);
      await screenText(result.output_text, "output");
      return result;
    } },
    ...(client.lookup && { async lookup(query, ...args) {
      await screenText(query);
      const result = await client.lookup(query, ...args);
      await screenText(result, "output");
      return result;
    } }),
    ...(client.readImages && { async readImages(options) {
      if (servingAiAccounts()) {
        await screenText(options.prompt);
        for (const path of options.paths) {
          const mime = ({ ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" })[extname(path).toLowerCase()] || "image/jpeg";
          const bytes = await readFile(path);
          await screenImage(bytes, mime);
        }
      }
      const result = await client.readImages(options);
      await screenText(JSON.stringify(result), "output");
      return result;
    } }),
  };
}
