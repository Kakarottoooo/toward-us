// Model prose is not an execution receipt. Only the caller's committed results can confirm a write.
const savedClaim = /(?:起草好了|(?:已经|已)起草|已(?:经)?(?:帮你)?(?:记入|记进|保存|存入|记下|记录)|(?:我)?记下了|(?:I(?:'ve| have)?\s+)?(?:(?:saved|stored|recorded|noted)\b|kept\s+(?:in|on|a note)\b)|(?:he\s+)?(?:guardado|registrado|anotado)\b)/iu;
const segments = (text, language) => [...new Intl.Segmenter(language || "zh", { granularity: "sentence" }).segment(text)].map(({ segment }) => segment);
const claimsWrite = (text) => savedClaim.test(text) && !/(?:没有|并未|尚未|未曾|不能|not |never |cannot |can't |no se |no he )[^。！？.!?]{0,45}(?:已|记|保存|saved|stored|recorded|noted|kept|guardado|registrado|anotado)/iu.test(text);
const reminderClaim = /(?:已(?:经)?|我(?:已|只|已经)?|帮你|替你).{0,18}(?:设好|设置|设了|设|安排|创建|准备|保存).{0,24}提醒|(?:提醒).{0,12}(?:设好了|已设置|已准备|已创建)|(?:我会|到时会|到时候会).{0,24}提醒你|\b(?:I(?:'ve| have)?\s+(?:set|scheduled|created|prepared)|(?:reminder|alert).{0,20}(?:is set|is ready|scheduled)|I(?:'ll| will) remind you)\b|\b(?:(?:he|ya).{0,18}(?:preparado|programado|creado).{0,24}recordatorio|te recordaré)\b/iu;
export const claimsReminder = (text) => reminderClaim.test(text) && !/(?:没有|并未|尚未|不能|不会|还没|not |never |cannot |can't |no he |no está)[^。！？.!?]{0,40}(?:提醒|remind|set|schedul|prepar|recordatorio)/iu.test(text);

function hasSentenceRequest(request) {
  return /(?:只(?:要|回|用|写|给|需)|就(?:回|写)|(?:帮我|请)?(?:写|给|用)|回复?我?)[^。！？\n]{0,12}(?:一句|一条短句)|(?:only|just|exactly)\s+(?:one|a|1)\s+(?:short\s+)?sentence|(?:solo|sólo|una sola)\s+(?:una\s+)?frase/iu.test(request || "");
}
export const wantsOneSentence = (request) => hasSentenceRequest(request) && !draftOnlyLimit(request);

const number = (value) => /^\d+$/.test(value) ? Number(value) : value === "十" ? 10 : value.includes("十") ? (number(value.split("十")[0] || "一") * 10 + number(value.split("十")[1] || "零")) : "零一二三四五六七八九".indexOf(value.replace("两", "二"));
const countToken = "([0-9]+|[一二两三四五六七八九十]{1,3})";
function formatLimits(request) {
  const lines = request.match(new RegExp(`(?:用|写|分成|分|恰好|仅|只要)${countToken}行|(?:exactly|only)\\s+(\\d+)\\s+lines|exactamente\\s+(\\d+)\\s+l[ií]neas`, "iu"));
  const chars = request.match(new RegExp(`(?:不超过|最多|限)${countToken}字|${countToken}字以内|(?:at most|no more than)\\s+(\\d+)\\s+characters|m[aá]ximo\\s+(\\d+)\\s+caracteres`, "iu"));
  return { sentences: hasSentenceRequest(request) ? 1 : null, lines: lines ? number(lines.slice(1).find(Boolean)) : null, chars: chars ? number(chars.slice(1).find(Boolean)) : null };
}

// Narrow semantic audit: explicit value questions or literal delivery limits.
// No domain names, people or evaluation IDs participate in routing.
export function requiresReplyScopeCheck(request = "") {
  return Object.values(formatLimits(request)).some(Boolean)
    || /(?:一句|一条短句|[一二两三四五六七八九十\d]+行|[一二两三四五六七八九十\d]+字(?:以[内下]|之内)|短回复|简短(?:地)?回)|\b(?:(?:one|a single|1)\s+(?:short\s+)?sentence|(?:short|brief)\s+reply|\d+\s+(?:lines|characters)|(?:una(?: sola)?|1)\s+frase|respuesta\s+(?:breve|corta)|\d+\s+(?:l[ií]neas|caracteres))\b/iu.test(request)
    || /(?:哪[天日]|星期几|周几|几月|几[号点时]|多少|哪(?:一)?[个位]?人|谁|(?:在|去|到)哪(?:里|儿)?|什么(?:时候|时间|日期|地方))|\b(?:when|where|who|how (?:many|much)|what (?:time|date|day)|which (?:day|date|person|place)|cu[aá]ndo|d[oó]nde|qui[eé]n|cu[aá]nt[oa]s?|qu[eé] (?:d[ií]a|hora|fecha))\b/iu.test(request);
}

// A requested draft can be one sentence while an accompanying factual answer is not.
const draftOnlyLimit = (request) => hasSentenceRequest(request) && /[?？]|(?:最后|再|另外|同时).{0,8}(?:给|写)|(?:then|also).{0,20}(?:draft|sentence)/iu.test(request);
function quotedDrafts(text) {
  const pairs = { "“": "”", "「": "」", '"': '"' }, stack = [], drafts = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (stack.length && char === stack.at(-1)) {
      stack.pop();
      if (!stack.length) drafts.push({ text: text.slice(start + 1, i), start, end: i + 1 });
    } else if (pairs[char]) {
      if (!stack.length) start = i;
      stack.push(pairs[char]);
    }
  }
  return drafts;
}

function copyableDraft(text) {
  const quotes = quotedDrafts(text);
  // Prefer an explicit delivery label outside quoted source material. In particular,
  // an inline quotation INSIDE an unquoted draft is not the draft itself.
  const labels = [...text.matchAll(/(?:^|[\n。！？.!?，,；;])\s*(?:\*\*)?(?:(?:(?:回复|文案)(?:可以)?|(?:现在)?(?:你)?可以)(?:这样|这么)?(?:(?:跟|对|给)[^：:\n。！？]{1,24}?)?(?:(?:平和|温和|简短|直接)地)?(?:说|回|回复|写|发)|(?:最终|可发|可发送|可复制)?(?:的)?(?:回复|文案|邀约|邀请|道歉|消息|短信)(?:草稿|文案|示例)?|草稿|(?:you\s+(?:can|could)\s+(?:say|reply|write|send)|(?:(?:suggested|copyable|final)\s+)?(?:draft|reply|message|invitation|apology)(?:\s+(?:draft|like\s+this))?)|(?:(?:puedes|podrías)\s+(?:decir|responder|escribir|enviar)|(?:respuesta|borrador|mensaje|invitaci[oó]n)(?:\s+sugerid[ao])?))(?:\*\*)?\s*[：:]\s*/giu)]
    .filter((match) => !quotes.some((quote) => match.index >= quote.start && match.index < quote.end));
  if (labels.length) {
    const label = labels.at(-1), start = label.index + label[0].length;
    const quoted = quotes.find((quote) => quote.start === start);
    return quoted ? quoted.text : text.slice(start).split(/\n\s*\n/)[0].trim();
  }
  // Without a label accept only a whole, final quoted paragraph. Never guess
  // from the last inline quotation in an analysis sentence.
  const last = quotes.at(-1);
  if (last && !text.slice(last.end).trim() && !text.slice(text.lastIndexOf("\n", last.start - 1) + 1, last.start).trim()) return last.text;
  return null;
}
export const replyPartsSchema = { type: "object", additionalProperties: false, required: ["reply", "sendableDraft"], properties: {
  reply: { type: "string", description: "Analysis/facts only; empty for drafting-only requests." },
  sendableDraft: { type: ["string", "null"], description: "Copyable message, no label/outer quotes; null if not requested." },
} };

export function renderReply(reply) {
  if (typeof reply === "string") return reply;
  const body = String(reply?.reply || "").trim(), draft = reply?.sendableDraft?.trim();
  return draft ? body ? `${body}\n\n“${draft}”` : draft : body;
}

export function checkReplyFormat(reply, request = "", language = "zh") {
  const limits = formatLimits(request), issues = [];
  const structured = reply && typeof reply === "object" && Object.hasOwn(reply, "sendableDraft");
  const rendered = renderReply(reply);
  let text = rendered.trim();
  if (limits.sentences && draftOnlyLimit(request)) {
    const draft = structured ? reply.sendableDraft?.trim() : copyableDraft(text);
    if (!draft) issues.push("Separate the requested copyable draft from analysis with an explicit reply label or a final quoted paragraph; source quotations do not count as a draft.");
    text = draft || text;
  }
  const sentenceCount = segments(text, language).filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
  if (limits.sentences && sentenceCount !== limits.sentences) issues.push(`Expected ${limits.sentences} sentence; found ${sentenceCount}.`);
  const lines = rendered.trim().split(/\r?\n/).filter((line) => line.trim()).length;
  if (limits.lines && lines !== limits.lines) issues.push(`Expected ${limits.lines} nonempty lines; found ${lines}.`);
  const chars = [...rendered.replace(/\s/gu, "")].length;
  if (limits.chars && chars > limits.chars) issues.push(`Maximum ${limits.chars} characters; found ${chars}.`);
  return { ok: !issues.length, issues };
}

export async function repairReplyFormat(reply, { request = "", language = "zh", rewrite } = {}) {
  // The server's privacy response must never re-enter model prose generation.
  if (reply === privateBoundaryReply(language)) return reply;
  const checked = checkReplyFormat(reply, request, language);
  if (checked.ok) return reply;
  const revised = rewrite ? await rewrite({ reply, issues: checked.issues }) : null;
  if (renderReply(revised).trim() && checkReplyFormat(revised, request, language).ok) return revised;
  // Keep the most complete deliverable: never replace usable wording with only an error.
  // Prefer an identifiable draft, then fewer format violations; retain the full text
  // so shortening cannot silently remove a condition, negation or factual answer.
  const candidates = [revised, reply].filter((value) => renderReply(value).trim());
  const draft = (value) => typeof value === "object" ? value.sendableDraft : copyableDraft(value);
  candidates.sort((a, b) => Number(Boolean(draft(b))) - Number(Boolean(draft(a)))
    || checkReplyFormat(a, request, language).issues.length - checkReplyFormat(b, request, language).issues.length);
  const note = language === "en" ? "The format still needs adjusting." : language === "es" ? "El formato aún necesita ajustes." : "格式还需调整。";
  return [renderReply(candidates[0]), note].filter(Boolean).join("\n");
}

export function finishReply(reply, { request = "", language = "zh", receipts = [], reminderWritten = false, formatChecked = false } = {}) {
  const parts = segments(String(reply || "").trim(), language);
  const reminderRemoved = parts.some(claimsReminder);
  const removed = reminderRemoved || parts.some(claimsWrite);
  // Receipts are server-authored after successful writes, never planner-provided flags.
  let text = parts.filter((part) => !claimsWrite(part) && !claimsReminder(part)).join("").trim();
  if (removed && receipts.length) text = [text, ...receipts].filter(Boolean).join("\n");
  if (reminderRemoved && !reminderWritten) text = [text, language === "en" ? "No reminder was created in this turn." : language === "es" ? "No se creó ningún recordatorio en este turno." : "这轮尚未创建提醒。"].filter(Boolean).join("\n");
  if (!text && removed) text = language === "en" ? "No new record was saved in this turn." : language === "es" ? "No se guardó ningún registro nuevo en este turno." : "这轮没有新增记录。";
  // Private replies have already been checked/repaired; preserve the existing shared-chat path.
  if (!formatChecked && wantsOneSentence(request) && !receipts.length) text = segments(text, language)[0]?.trim() || text;
  return text;
}

export const privateBoundaryReply = (language) => language === "en" ? "I can only help you work through information you provide or that is explicitly shared with you." : language === "es" ? "Solo puedo ayudarte con la información que tú aportes o que se haya compartido explícitamente contigo." : "我只能根据你提供或明确共享的信息帮你梳理。";

export const replyContractInstructions = `Only requested content; respect sentence/line/character limits. When schema includes sendableDraft: drafts go only there (no labels/quotes), null if unrequested; reply holds only analysis, empty for draft-only requests. Mixed requests: at most two brief analysis sentences. No feelings, affection, promises or acceptance absent from the user's words. Describe foreign activities naturally in Chinese. For bookable activities or "don't book", state no booking was made. Raw sources outrank summaries; preserve speakers, claims and times; states are not outcomes. Updates inherit no unconfirmed old details. No saved/prepared/scheduled claims: the server reports writes; reminders need actions after lookup. No invented events or interrogation. Privacy: one neutral boundary, no access claims, private-chat hints or comments on persistence.
Scope examples (not facts):
Q: Which shelf now? Moved A to C. Good: "C." Bad: "C, formerly A, then corrected." Give only the requested value.
Q: The printer works; one warm reply. Good: "Glad it worked!" Bad: "Glad it worked; remember to clean it." No unasked advice.`;
