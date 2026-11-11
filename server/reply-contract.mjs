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

// A requested draft can be one sentence while an accompanying factual answer is not.
const draftOnlyLimit = (request) => hasSentenceRequest(request) && /[?？]|(?:最后|再|另外|同时).{0,8}(?:给|写)|(?:then|also).{0,20}(?:draft|sentence)/iu.test(request);
function quotedDrafts(text) {
  const pairs = { "“": "”", "「": "」", '"': '"' }, stack = [], drafts = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (stack.length && char === stack.at(-1)) {
      stack.pop();
      if (!stack.length) drafts.push(text.slice(start + 1, i));
    } else if (pairs[char]) {
      if (!stack.length) start = i;
      stack.push(pairs[char]);
    }
  }
  return drafts;
}
export function checkReplyFormat(reply, request = "", language = "zh") {
  const limits = formatLimits(request), issues = [];
  let text = String(reply || "").trim();
  if (limits.sentences && draftOnlyLimit(request)) {
    const draft = quotedDrafts(text).at(-1) || text.match(/(?:可以(?:说|回)|回复|文案|draft|reply|respuesta)\s*[：:]\s*([\s\S]+)$/iu)?.[1];
    if (!draft) issues.push("Put the requested copyable draft in quotation marks, separate from the other requested answer.");
    text = draft || text;
  }
  const sentenceCount = segments(text, language).filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
  if (limits.sentences && sentenceCount !== limits.sentences) issues.push(`Expected ${limits.sentences} sentence; found ${sentenceCount}.`);
  const lines = String(reply || "").trim().split(/\r?\n/).filter((line) => line.trim()).length;
  if (limits.lines && lines !== limits.lines) issues.push(`Expected ${limits.lines} nonempty lines; found ${lines}.`);
  const chars = [...String(reply || "").replace(/\s/gu, "")].length;
  if (limits.chars && chars > limits.chars) issues.push(`Maximum ${limits.chars} characters; found ${chars}.`);
  return { ok: !issues.length, issues };
}

export async function repairReplyFormat(reply, { request = "", language = "zh", rewrite } = {}) {
  const checked = checkReplyFormat(reply, request, language);
  if (checked.ok) return reply;
  const revised = rewrite ? await rewrite({ reply, issues: checked.issues }) : null;
  if (typeof revised === "string" && checkReplyFormat(revised, request, language).ok) return revised;
  return language === "en" ? "I couldn't produce the requested format this time." : language === "es" ? "Esta vez no pude preparar el formato solicitado." : "这次没能按你要求的格式写好。";
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

export const replyContractInstructions = `Final reply check: deliver only what was asked. Sentence/line/character limits override default advice and feature offers. Acknowledgments contain warmth only, no unsolicited advice. Wording only: draft only. Mixed request: at most two brief analysis sentences, then quote the draft. Never add a first-person feeling, promise or acceptance absent from the user's words. Describe an activity naturally in the reply language, not just an unexplained foreign title. Raw transcript outranks summaries: compare actual timestamps before saying before/after/near; preserve each speaker's exact claim. Updates do not inherit old details. No saved/prepared/scheduled claims: the server reports committed writes; reminders still need actions after lookup. If asked not to book, say no booking was made. Unsupported events remain unestablished; offer to sort known facts together, never interrogate. Privacy: neutrally refer only to user-provided/shared information once, never discuss whether another private chat exists; no scolding or repetition when pressed. Examples: library closing time -> "六点", not "六点，早点出门"; due Monday/delivered Tuesday -> "期限后送达", not "临近期限"; class moved to Friday -> old duration unconfirmed, not "仍是一小时".`;
