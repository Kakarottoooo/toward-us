// Model prose is not an execution receipt. Only the caller's committed results can confirm a write.
const savedClaim = /(?:起草好了|(?:已经|已)起草|已(?:经)?(?:帮你)?(?:记入|记进|保存|存入|记下|记录)|(?:我)?记下了|(?:I(?:'ve| have)?\s+)?(?:(?:saved|stored|recorded|noted)\b|kept\s+(?:in|on|a note)\b)|(?:he\s+)?(?:guardado|registrado|anotado)\b)/iu;
const segments = (text, language) => [...new Intl.Segmenter(language || "zh", { granularity: "sentence" }).segment(text)].map(({ segment }) => segment);
const claimsWrite = (text) => savedClaim.test(text) && !/(?:没有|并未|尚未|未曾|不能|not |never |cannot |can't |no se |no he )[^。！？.!?]{0,45}(?:已|记|保存|saved|stored|recorded|noted|kept|guardado|registrado|anotado)/iu.test(text);
const reminderClaim = /(?:已(?:经)?|我(?:已|只|已经)?|帮你|替你).{0,18}(?:设好|设置|设了|设|安排|创建|准备|保存).{0,24}提醒|(?:提醒).{0,12}(?:设好了|已设置|已准备|已创建)|(?:我会|到时会|到时候会).{0,24}提醒你|\b(?:I(?:'ve| have)?\s+(?:set|scheduled|created|prepared)|(?:reminder|alert).{0,20}(?:is set|is ready|scheduled)|I(?:'ll| will) remind you)\b|\b(?:(?:he|ya).{0,18}(?:preparado|programado|creado).{0,24}recordatorio|te recordaré)\b/iu;
export const claimsReminder = (text) => reminderClaim.test(text) && !/(?:没有|并未|尚未|不能|不会|还没|not |never |cannot |can't |no he |no está)[^。！？.!?]{0,40}(?:提醒|remind|set|schedul|prepar|recordatorio)/iu.test(text);

function hasSentenceRequest(request) {
  return /(?:只(?:要|回|用|写|给|需)|就(?:回|写)|(?:帮我|请)?(?:写|给|用)|回复?我?)[^。！？\n]{0,12}(?:一句|一条短句)|(?:only|just|exactly)\s+(?:one|a|1)\s+(?:short\s+)?sentence|(?:solo|sólo|una sola)\s+(?:una\s+)?frase/iu.test(request || "");
}
export const wantsOneSentence = (request) => hasSentenceRequest(request) && !/[?？]|(?:最后|再|另外|同时).{0,8}(?:给|写)|(?:then|also).{0,20}(?:draft|sentence)/iu.test(request);

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
    || /(?:先.{1,80}再|(?:查不到|没有找到|找不到).{0,12}(?:就|给|提供)|(?:别|不要)(?:猜|硬猜|照搬))|\b(?:if (?:not found|unavailable)|without guessing|si no (?:encuentras|est[aá] disponible))\b/iu.test(request)
    || /(?:一句|一条短句|[一二两三四五六七八九十\d]+行|[一二两三四五六七八九十\d]+字(?:以[内下]|之内)|短回复|简短(?:地)?回)|\b(?:(?:one|a single|1)\s+(?:short\s+)?sentence|(?:short|brief)\s+reply|\d+\s+(?:lines|characters)|(?:una(?: sola)?|1)\s+frase|respuesta\s+(?:breve|corta)|\d+\s+(?:l[ií]neas|caracteres))\b/iu.test(request)
    || /(?:哪[天日]|星期几|周几|几月|几[号点时]|多少|哪(?:一)?[个位]?人|谁|(?:在|去|到)哪(?:里|儿)?|什么(?:时候|时间|日期|地方))|\b(?:when|where|who|how (?:many|much)|what (?:time|date|day)|which (?:day|date|person|place)|cu[aá]ndo|d[oó]nde|qui[eé]n|cu[aá]nt[oa]s?|qu[eé] (?:d[ií]a|hora|fecha))\b/iu.test(request);
}

// A requested draft can be one sentence while an accompanying factual answer is not.
const draftOnlyLimit = (request) => hasSentenceRequest(request) && /[?？]|(?:帮我|替我|文案|草稿|邀约|可复制|可发送)|(?:最后|再|另外|同时).{0,8}(?:给|写)|(?:then|also).{0,20}(?:draft|sentence)|\b(?:draft|reply to|responder a|borrador)\b/iu.test(request);
// Give repair/check callers the same literal limits the server actually measures.
export function replyFormatRequirements(request = "") {
  const limits = formatLimits(request);
  return { ...limits, sentenceScope: draftOnlyLimit(request) ? "sendableDraft" : "whole reply",
    linesAndCharsScope: draftOnlyLimit(request) ? "sendableDraft" : "whole reply" };
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
  if (limits.sentences && (draftOnlyLimit(request) || structured && reply.sendableDraft?.trim())) {
    const draft = structured ? reply.sendableDraft?.trim() : copyableDraft(text)
      || (wantsOneSentence(request) && !/[\n：:]/u.test(text) ? text : null);
    // No identifiable object means no format measurement, never an error shown to the user.
    if (!draft) return { ok: true, issues: [] };
    text = draft;
  }
  const sentenceCount = segments(text, language).filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
  if (limits.sentences && sentenceCount !== limits.sentences) issues.push(`Expected ${limits.sentences} sentence; found ${sentenceCount}.`);
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).length;
  if (limits.lines && lines !== limits.lines) issues.push(`Expected ${limits.lines} nonempty lines; found ${lines}.`);
  const chars = [...text.replace(/\s/gu, "")].length;
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
  return directFactReply(text, request);
}

// Remove presentation metadata only. Negative/missing-evidence statements and
// event dates are facts, so neither is rewritten by this final rendering step.
export function directFactReply(text, request = "") {
  if (/(?:来源|出处|记录.*(?:哪|何|时间|日期|时候)|(?:哪|何|什么时候).*记录|从哪|根据什么)|\b(?:source|provenance|recorded when|how do you know|where.*(?:get|learn)|fuente|procedencia|de d[oó]nde|c[oó]mo (?:lo )?sabes)\b/iu.test(request)) return text;
  return text.replace(/(?:记录里|记录中)有一条([^。！？\n]+?)的信息(?:[（(]记录于[^）)]+[）)])?/gu, '$1')
    .replace(/(^|[。！？\n：:])\s*(?:根据记录[，,:：]?|(?:记录里|记录中)(?:显示|提到|写着|只有)[，,:：]?|我这边看到(?:的是|了)?[，,:：]?)\s*/gu, '$1')
    .replace(/(^|[.!?\n])\s*(?:(?:according to|based on) (?:the )?records?|(?:según|de acuerdo con) (?:los )?registros?)[,:，]?\s*/giu, '$1')
    .replace(/[（(]记录于\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}[）)]/gu, '');
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
export function privateBoundaryReply(language, index = 0, request = "") {
  // A topic is copied exclusively from the current public question, never a
  // portrait, another principal's records or model-generated private content.
  const topic = request.match(/(?:对|关于)([^，。！？?\n‘’“”]{1,24}?)(?:有(?:什么)?(?:想法|看法|感受)|怎么(?:看|想)|的(?:想法|看法|感受))/u)?.[1];
  if (language === 'zh' && topic) return `我没法替对方判断这些想法。你可以直接问 TA：‘关于${topic}，你愿意和我聊聊你的感受吗？’`;
  return (privateReplies[language] || privateReplies.zh)[index % 3];
}
export const isPrivateBoundaryReply = (reply) => Object.values(privateReplies).some((variants) => variants.includes(reply))
  || /^我没法替对方判断这些想法。你可以直接问 TA：‘关于[^，。！？?\n‘’“”]{1,24}，你愿意和我聊聊你的感受吗？’$/u.test(reply);

export const replyContractInstructions = `Only requested content; obey length/format, including draft explanations. sendableDraft: copyable wording or null. reply: analysis only; empty for draft-only; <=2 sentences for mixed asks. Invent no facts, feelings, affection, acceptance or promises. Preserve speakers, sources, full day+time; states aren't outcomes. Inherit no unconfirmed details. Writes use server receipts; reminders need actions after lookup. Say no booking for bookable activities. No interrogation/private-chat hints; one neutral privacy boundary.
Examples (good / bad):
Which shelf, moved A to C? "C." / "C, formerly A."
Which gate? "C." / "According to records, C." Source asked? "The notice says C."
Thanks for fixing it! "Glad it helped!" / "Clean it regularly."
Decline without arguing: "I won't lend it; let's talk about your concern." / "I feel uncomfortable."
Threatened exclusion: "Stop threatening exclusion." / "I prefer privacy."
Late notice: "Tell me before our agreed start." / "Tell me soon."
Proposed 10:15: "I'll check whether 10:15 works." / "10:15 works."
Invitations: translate activityDescription (Chinese for zh); insert {{activityDescription}} in sendableDraft.`;
