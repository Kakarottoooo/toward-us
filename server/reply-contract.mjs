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
// Give repair/check callers the same literal limits the server actually measures.
export function replyFormatRequirements(request = "") {
  const limits = formatLimits(request);
  return { ...limits, sentenceScope: draftOnlyLimit(request) ? "sendableDraft" : "whole reply",
    linesAndCharsScope: "whole reply and sendableDraft together" };
}
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
export const replyPartsSchema = { type: "object", additionalProperties: false, required: ["reply", "sendableDraft", "activityDescription"], properties: {
  reply: { type: "string", description: "Analysis only; empty for draft-only." },
  sendableDraft: { type: ["string", "null"], description: "Copyable wording or null." },
  activityDescription: { type: ["string", "null"], description: "Source activity in output language; null unless inviting." },
} };

export function renderReply(reply) {
  if (typeof reply === "string") return reply;
  const body = String(reply?.reply || "").trim();
  let draft = activityDraft(reply);
  // A structured field already identifies the draft. Strip only wrappers around
  // the entire field; quoted source words inside the message remain untouched.
  while (draft) {
    const whole = quotedDrafts(draft).find((quote) => quote.start === 0 && quote.end === draft.length);
    if (!whole) break;
    draft = whole.text.trim();
  }
  return [body, draft].filter(Boolean).join("\n\n");
}

export function activityDraft(reply) {
  const draft = reply?.sendableDraft?.trim(), description = reply?.activityDescription?.trim();
  if (!draft || !description) return draft;
  return draft.includes("{{activityDescription}}") ? draft.replaceAll("{{activityDescription}}", description) : `${description}：${draft}`;
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
  if (isPrivateBoundaryReply(reply)) return reply;
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
  return renderReply(candidates[0]);
}

export function finishReply(reply, { request = "", language = "zh", receipts = [], reminderWritten = false, formatChecked = false } = {}) {
  const parts = segments(String(reply || "").trim(), language);
  const reminderRemoved = parts.some(claimsReminder);
  const removed = reminderRemoved || parts.some(claimsWrite);
  // Receipts are server-authored after successful writes, never planner-provided flags.
  let text = parts.filter((part) => !claimsWrite(part) && !claimsReminder(part)
    && !(receipts.length && (describesActionStatus(part) || reminderWritten && confirmsReminder(part)))).join("").trim();
  if (receipts.length) text = [text, ...receipts].filter(Boolean).join("\n");
  if (reminderRemoved && !reminderWritten) text = [text, language === "en" ? "No reminder was created in this turn." : language === "es" ? "No se creó ningún recordatorio en este turno." : "这轮尚未创建提醒。"].filter(Boolean).join("\n");
  if (!text && removed) text = language === "en" ? "No new record was saved in this turn." : language === "es" ? "No se guardó ningún registro nuevo en este turno." : "这轮没有新增记录。";
  // Private replies have already been checked/repaired; preserve the existing shared-chat path.
  if (!formatChecked && wantsOneSentence(request) && !receipts.length) text = segments(text, language)[0]?.trim() || text;
  return text;
}

// Reminder promises also duplicate a committed receipt without saying "created".
const confirmsReminder = text => /^(?:(?:好的|好|没问题)[，,]?\s*)?(?:我会|我将|我来|会在|将在|今天|明天|后天|下周|周[一二三四五六日天]|\d{1,4}年|\d{1,2}月).{0,80}提醒(?:你|您)|\b(?:I(?:'ll| will) remind you|te recordar[eé])\b/iu.test(text);

// Positive AND negative model status claims yield to the actual operation receipts.
const describesActionStatus = (text) => /(?:提醒|记录|草稿|计划).{0,45}(?:设|创建|保存|写入|回执|安排|完成)|(?:未|没|不|已).{0,35}(?:设置|创建|保存|写入)|\b(?:reminder|record|draft).{0,70}\b(?:set|created|saved|scheduled|ready|receipt)|\b(?:recordatorio|registro|borrador).{0,70}\b(?:programad|cread|guardad|list)/iu.test(text);

const privateReplies = {
  zh: ["我没法判断对方的想法或安排。可以直接问：‘你愿意和我聊聊你现在的想法吗？’", "对方怎么想、有什么安排，我没法替 TA 判断。你可以说说自己的感受，再问 TA 愿意分享什么。", "我不能替对方确认想法或安排。如果 TA 还没准备好说，可以先约个愿意聊的时间，或等 TA 自己揭晓。"],
  en: ["I can't determine what they think or plan. You could ask: ‘Would you like to tell me what's on your mind?’", "I can't speak for their thoughts or plans. You can share how you feel and ask what they're comfortable sharing.", "I can't confirm their thoughts or plans. If they aren't ready to talk, agree on a time or let them reveal it themselves."],
  es: ["No puedo saber qué piensa o planea la otra persona. Puedes preguntarle: ‘¿Te gustaría contarme qué estás pensando?’", "No puedo hablar por sus ideas o planes. Puedes expresar cómo te sientes y preguntar qué quiere compartir.", "No puedo confirmar sus ideas o planes. Si aún no quiere hablar, acuerden un momento o deja que lo cuente por su cuenta."],
};
export const privateBoundaryReply = (language, index = 0) => (privateReplies[language] || privateReplies.zh)[index % 3];
export const isPrivateBoundaryReply = (reply) => Object.values(privateReplies).some((variants) => variants.includes(reply));

export const replyContractInstructions = `Only requested content; obey length/format. sendableDraft: copyable wording or null; obey its requested sentence count, including any explanation inside it. reply: analysis only, empty for draft-only, <=2 sentences for mixed requests. No invented facts/feelings/affection/acceptance/promises. Preserve sources, speakers and times; states aren't outcomes. Inherit no unconfirmed details. Server receipts report writes; reminders need actions after lookup. Say no booking for bookable activities. No interrogation or private-chat/access hints; one neutral privacy boundary.
Examples (good / bad):
Which shelf now, moved A to C? "C." / "C, formerly A."
Printer fixed; thanks! "You're welcome, glad it helped!" / "Clean it regularly."
Badge demanded under threat of exclusion: "I won't lend it; stop threatening exclusion." / "I prefer to keep it."
Updates arrived after agreed start: "Tell me before our agreed start if plans change." / "Tell me soon."
Proposed delivery slot 10:15: "I will check whether 10:15 works." / "10:15 works." Preserve concrete options without accepting them.
Invitations: translate activityDescription (Chinese for zh); insert {{activityDescription}} in sendableDraft.`;
