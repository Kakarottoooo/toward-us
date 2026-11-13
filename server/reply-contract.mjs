// Model prose is not an execution receipt. Only the caller's committed results can confirm a write.
const savedClaim = /(?:起草好了|(?:已经|已)起草|已(?:经)?(?:帮你)?(?:记入|记进|保存|存入|记下|记录|记住)|(?:我)?(?:记下了|记住了)|(?:I(?:'ve| have)?\s+)?(?:(?:saved|stored|recorded|noted|remembered)\b|kept\s+(?:in|on|a note)\b)|(?:he\s+)?(?:guardado|registrado|anotado)\b)/iu;
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
    || /(?:买什么|做什么|哪种|哪款|是否|是不是|可以吗|能不能|可不可以|定了吗|记住)/u.test(request)
    || /\b(?:remember that|recuerda que)\b/iu.test(request)
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

export function copyableDraft(text) {
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

// Beside an analysis, a sendable draft is introduced as wording the user can send (task 58: judges read an unlabelled
// first-person draft under an assessment as Pinky speaking, "不够像可发送草稿"). The label is one the copyable-draft
// reader already recognises, so later literal checks still measure only the draft.
const draftLabel = (language, request) => language === "en" ? "You could send: " : language === "es" ? "Podrías enviar: " : /回/u.test(request || "") ? "可以这样回：" : "可以这样发：";
export function renderReply(reply, { label = false, language = "zh", request = "" } = {}) {
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
  // The card owns its copyable text. Do not repeat an identical paragraph in body.
  const analysis = draft ? body.split(/\n\s*\n/u).filter(part => fragmentKey(part) !== fragmentKey(draft)).join("\n\n") : body;
  const introduced = label && analysis && draft && !/[：:]\s*$/u.test(analysis) ? `${draftLabel(language, request)}${draft}` : draft;
  return [analysis, introduced].filter(Boolean).join("\n\n");
}

// Literal contract failures share the existing single rewrite budget. These
// checks inspect outputs; they never synthesize a yes/no answer or a new fact.
export function checkDelivery(reply, request = "", { webPages = [] } = {}) {
  const rendered = renderReply(reply), body = typeof reply === "string" ? reply : reply?.reply || "";
  const issues = [];
  if (/(?:是否|可以吗|能不能|能.{0,8}吗|定了吗|确定了吗)|\b(?:can|could|is|has|did|does)\b.+\?|¿(?:puedo|puede|est[aá])/iu.test(request)
    && !/^(?:可以|不行|不能|不可以|定了|还没定|还没有|尚未|没有|不确定|无法确定|无法确认|不能确认|不合理|合理|不建议|建议|Yes\b|No\b|Not yet\b|I (?:can|can't|cannot)\b|S[ií]\b|No\b)/iu.test(body.trim())) issues.push("Answer the yes/no or settled-status question directly in the first clause, using only supported certainty; preserve necessary uncertainty.");
  // Excluded topics are part of the user format contract (contractIssues), checked once there.
  if (webPages.length && /(?:之后|拿到后|稍后|晚点).{0,20}(?:告诉你|给你|发给你)|(?:will|I'll).{0,30}(?:later|once I)|te (?:dir[eé]|avisar[eé]).{0,20}despu[eé]s/iu.test(rendered)) issues.push("No deferred web promise: deliver the observed result now, or state the observed failure.");
  if (/(?:过敏|allerg|al[eé]rgi)/iu.test(request) && /(?:无法|不能|不确定|没有|未|不足|缺少|unknown|cannot|can't|unclear|no puedo)/iu.test(rendered)
    && !/(?:向|问|联系|与).{0,12}(?:店家|商家|餐厅|医|专业)|(?:店家|商家|餐厅).{0,12}(?:确认|核实)|(?:check|confirm|ask).{0,30}(?:restaurant|staff|doctor|seller)|(?:consult|confirm).{0,30}(?:local|m[eé]dic|restaurante)/iu.test(rendered)) issues.push("Preserve one necessary allergy-safety next step: confirm ingredients with the establishment; absence of page evidence is not safety clearance.");
  if (/(?:用药|症状|诊断|治疗|转账|汇款|银行账户|私密|隐私)/u.test(request) && /无法|不能|不确定|未核实/u.test(rendered)
    && !/确认|核实|医生|专业|直接问|自己开口|先问|本人|征求/u.test(rendered)) issues.push("After the direct answer preserve one necessary, relevant health, money or privacy safety next step; do not replace it with generic caveats.");
  return issues;
}

// The longest stretch of an activity description the draft already says itself ("Clay Together" in both "陶艺活动 Clay
// Together" and "周六有个 Clay Together"): at least two CJK characters or four other letters, never just digits or spaces.
function sharedName(description, draft) {
  let best = "";
  for (let start = 0; start < description.length; start++) for (let end = description.length; end > start + best.length; end--) {
    const piece = description.slice(start, end).trim();
    if (piece.length > best.length && draft.includes(piece)) { best = piece; break; }
  }
  const cjk = (best.match(/[\p{Script=Han}]/gu) || []).length, letters = (best.match(/\p{L}/gu) || []).length;
  return cjk >= 2 || letters - cjk >= 4 ? best : "";
}
const trimJoin = (text) => text.replace(/^[\s:：,，、\-–—]+|[\s:：,，、\-–—]+$/gu, "");
/** Interpolates the translated activity description into a draft so the activity is named once (task 58: "陶艺活动 Clay
 * Together：周六…有个 Clay Together…" named it twice). */
export function activityDraft(reply) {
  const draft = reply?.sendableDraft?.trim(), description = reply?.activityDescription?.trim();
  if (!draft || !description) return draft;
  const slot = "{{activityDescription}}", name = sharedName(description, draft.replaceAll(slot, ""));
  if (draft.includes(slot)) {
    // The draft already names the activity elsewhere: the slot gets only what the name lacks.
    const fill = name ? trimJoin(description.replace(name, "")) : description;
    return draft.replaceAll(slot, fill).replace(/[ \t]{2,}/gu, " ").replace(/[ \t]+([，。！？,.!?])/gu, "$1");
  }
  if (!name) return `${description}：${draft}`;
  if (draft.includes(description)) return draft;
  // The description takes the place of the bare name, unless its other words are already there too.
  const rest = trimJoin(description.replace(name, ""));
  return rest && !draft.includes(rest) ? draft.replace(name, description) : draft;
}

export function checkReplyFormat(reply, request = "", language = "zh") {
  const limits = formatLimits(request), issues = [];
  const structured = reply && typeof reply === "object" && Object.hasOwn(reply, "sendableDraft");
  const rendered = renderReply(reply);
  let text = rendered.trim(), objects = [text];
  if (limits.sentences && (draftOnlyLimit(request) || structured && reply.sendableDraft?.trim())) {
    const draft = structured ? reply.sendableDraft?.trim() : copyableDraft(text)
      || (wantsOneSentence(request) && !/[\n：:]/u.test(text) ? text : null);
    // No identifiable object means no format measurement, never an error shown to the user.
    if (!draft) return { ok: true, issues: [] };
    const labelled = structured ? [] : text.split(/\n\s*\n/u).map(copyableDraft).filter(Boolean);
    objects = labelled.length ? labelled : [draft];
  }
  for (text of objects) {
  // Intl sentence segmentation merges some adjacent Chinese !/? sentences.
  // Every terminator counts, including mixed scripts and unspaced punctuation.
  const sentenceCount = text.split(/[。！？!?]+|\.(?=\s|$|[\p{L}])/u).filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
  if (limits.sentences && sentenceCount !== limits.sentences) issues.push(`Expected ${limits.sentences} sentence; found ${sentenceCount}.`);
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).length;
  if (limits.lines && lines !== limits.lines) issues.push(`Expected ${limits.lines} nonempty lines; found ${lines}.`);
  const chars = [...text.replace(/\s/gu, "")].length;
  if (limits.chars && chars > limits.chars) issues.push(`Maximum ${limits.chars} characters; found ${chars}.`);
  }
  return { ok: !issues.length, issues };
}

// ---- User format contract (task 58) ----
// Code reads the explicit format constraints in the user's own words once per turn ("一句", "N 字以内", "只答时间/地点",
// "不要提 X", "不要发送 / 不要保存"). Every later check, rewrite, supplement and projection keeps them: a step whose output
// breaks the contract is discarded in favour of the previous one, candidates are ranked by contract compliance before any
// semantic score, and the final text is accepted by code, which truncates deterministically when nothing else complies.
const onlyKinds = [["time", /时间|几点|钟点|\btime\b|\bhora\b/iu], ["date", /日期|哪天|哪一天|几号|星期几|周几|\b(?:date|day)\b|\b(?:fecha|d[ií]a)\b/iu],
  ["place", /地点|地方|哪里|哪儿|在哪|地址|\b(?:place|location|address|where)\b|\b(?:lugar|direcci[oó]n|d[oó]nde)\b/iu],
  ["amount", /多少钱|金额|价格|总价|费用|\b(?:price|cost|total|amount)\b|\b(?:precio|total|costo)\b/iu], ["person", /是谁|名字|\b(?:who|name)\b|\bqui[eé]n\b/iu]];
const kindTokens = { time: /\d{1,2}\s*[:：]\s*\d{2}|\d{1,2}\s*[点時时]|[零一二两三四五六七八九十]{1,3}\s*点|\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)/iu,
  date: /\d{1,2}\s*月\s*\d{1,2}|\d{4}-\d{2}-\d{2}|周[一二三四五六日天]|星期[一二三四五六日天]|[今明后]天|\b(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d|\b(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b|\d{1,2}\s+de\s+[a-z]+/iu,
  amount: /\d/u };
function onlyAnswer(request) {
  const clause = request.match(/只(?:需要?|要)?(?:回答|答|告诉我|说|回|给我|写)(?:一下)?([^，,。！？!?；;\n]{1,16})/u)?.[1]
    || request.match(/\b(?:just|only)\s+(?:tell me|give me|answer(?: with)?|say|reply with)\s+([^.,!?;\n]{1,30})/iu)?.[1]
    || request.match(/\bs[oó]lo\s+(?:dime|responde(?: con)?|di)\s+([^.,!?;\n]{1,30})/iu)?.[1];
  const kinds = clause ? onlyKinds.filter(([, pattern]) => pattern.test(clause)).map(([kind]) => kind) : [];
  // "只告诉我时间，再写一句邀约" asks for more than the value: then only the value's own sentence limit is lifted.
  return kinds.length ? { kinds, alone: !/(?:写|起草|草稿|邀约|邀请|文案|回复|再|另外|同时)|\b(?:write|draft|reply|also|then)\b|\b(?:escribe|borrador|tambi[eé]n)\b/iu.test(request.replace(clause, "")) } : null;
}
const sentClaim = /(?:已(?:经)?|帮你|替你|我)(?:直接)?(?:发送|发出|发给|发过去|转发)|(?:发过去了|发出去了|已发)|\b(?:I(?:'ve| have)?\s+sent|(?:has|was) been sent)\b|\b(?:(?:ya\s+)?(?:lo\s+)?(?:envi[eé]|he enviado))\b/iu;
/** The explicit format constraints in the user's request. */
export function formatContract(request = "") {
  const limits = formatLimits(request);
  // Only an instruction excludes a topic: "他从来不提…" describes someone, "不要提醒/提前" and "不要说教/说太多" are no topics.
  const avoid = [...request.matchAll(/(?:(?:不要|别|不用|无需)(?:提到|提起|提|说起|说|讲)|(?:^|[，,；;：:\s])不提)(?![醒前出交供高起教])[“"‘「]?([^，,。！？!?；;\n”"’」]{1,16})/gu)]
    .map(match => match[1].trim()).filter(word => word.length >= 1 && !/^(?:了|话|得|太|很|那么|这么|清|过|好|废话|多|谎)/u.test(word));
  return { sentences: limits.sentences, lines: limits.lines, chars: limits.chars, scope: draftOnlyLimit(request) ? "sendableDraft" : "whole reply", avoid, only: onlyAnswer(request),
    noSend: /(?:不要|别|先别|不用|无需|不必)(?:帮我)?(?:直接)?(?:发送|发出|发过去|发给|转发)|\b(?:don't|do not)\s+send\b|\bno\s+(?:lo\s+)?env[ií]es\b/iu.test(request),
    noSave: /(?:不要|别|不用|无需|不必)(?:帮我)?(?:保存|存下来|存起来|存档|记录下来|记下来|记住|记录)(?![^，,。！？!?]{0,4}(?:草稿|提醒))|\b(?:don't|do not)\s+(?:save|store|remember|keep)\b|\bno\s+(?:lo\s+)?(?:guardes|recuerdes|apuntes)\b/iu.test(request) };
}
export const hasContract = (contract) => Boolean(contract.sentences || contract.lines || contract.chars || contract.avoid.length || contract.only || contract.noSend || contract.noSave);
/** Every way `reply` breaks the user's format contract, as rewrite instructions. Empty when it complies. */
export function contractIssues(reply, request = "", language = "zh") {
  const contract = formatContract(request), text = renderReply(reply), issues = [...checkReplyFormat(reply, request, language).issues];
  const avoided = contract.avoid.filter(word => text.includes(word));
  if (avoided.length) issues.push(`Omit the user's explicitly excluded topic (${avoided.join(", ")}) from both analysis and copyable wording; do not repeat the exclusion as an explanation.`);
  if (contract.only) {
    const units = sentenceUnits(text), kinds = contract.only.kinds.filter(kind => kindTokens[kind]);
    if (contract.only.alone && units.length > 1) issues.push(`Answer only the requested ${contract.only.kinds.join(" and ")} in one short sentence; nothing else.`);
    if (kinds.length && !kinds.some(kind => kindTokens[kind].test(text))) issues.push(`State the requested ${kinds.join(" and ")} explicitly.`);
  }
  if (contract.noSend && sentenceUnits(text).some(unit => sentClaim.test(unit) && !/(?:没有|并未|尚未|不会|还没|not |never |no )/iu.test(unit))) issues.push("The user asked not to send anything: do not say anything was sent.");
  if (contract.noSave && claimsWrite(text)) issues.push("The user asked not to save anything: do not say anything was saved or remembered.");
  return issues;
}
/** Sentences as the literal counter sees them, each keeping its own punctuation and leading line breaks. */
export function sentenceUnits(text) {
  const units = [];
  let start = 0;
  for (const match of String(text || "").matchAll(/[。！？!?]+[”」"’）)]*|\.(?=\s|$|\p{L})[”」"’）)]*/gu)) { units.push(text.slice(start, match.index + match[0].length)); start = match.index + match[0].length; }
  if (start < String(text || "").length) units.push(text.slice(start));
  return units.filter(unit => /[\p{L}\p{N}]/u.test(unit));
}
const visibleLength = (text) => [...String(text).replace(/\s/gu, "")].length;
// At most `limit` visible characters, ending on a sentence or clause boundary so the cut never leaves half a statement.
function clipChars(text, limit, language) {
  if (!limit || visibleLength(text) <= limit) return text;
  const units = sentenceUnits(text), kept = [];
  for (const unit of units) { if (visibleLength([...kept, unit].join("")) > limit) break; kept.push(unit); }
  if (kept.length) return kept.join("").trim();
  const first = (units[0] || text).trim(), end = language === "zh" ? "。" : ".";
  let best = "";
  for (const match of first.matchAll(/[，,；;、：:]/gu)) { const head = first.slice(0, match.index); if (visibleLength(head) + 1 <= limit) best = head; }
  if (best) return `${best.trim()}${end}`;
  return [...first].reduce((out, char) => visibleLength(out + char) <= limit ? out + char : out, "");
}
/** The final code acceptance of the user format contract: deterministic truncation of model prose that still breaks it after
 * the one constrained rewrite. Server receipts are never cut; in a whole-reply limit they take their room first. */
export function settleContract(text, request = "", language = "zh", { receipts = [] } = {}) {
  const contract = formatContract(request);
  if (!hasContract(contract) || !String(text || "").trim()) return text;
  let body = String(text);
  const keep = (units) => units.join("").trim();
  if (contract.avoid.length) { const units = sentenceUnits(body), clean = units.filter(unit => !contract.avoid.some(word => unit.includes(word))); if (clean.length) body = keep(clean); }
  if (contract.noSend) { const units = sentenceUnits(body), clean = units.filter(unit => !sentClaim.test(unit)); if (clean.length) body = keep(clean); }
  if (contract.only?.alone && sentenceUnits(body).length > 1) {
    const units = sentenceUnits(body), kinds = contract.only.kinds.filter(kind => kindTokens[kind]);
    body = (units.find(unit => kinds.some(kind => kindTokens[kind].test(unit))) || units[0]).trim();
  }
  const trim = (value) => {
    let out = value;
    if (contract.sentences) out = keep(sentenceUnits(out).slice(0, contract.sentences));
    if (contract.lines) out = out.split(/\r?\n/u).filter(line => line.trim()).slice(0, contract.lines).join("\n");
    return clipChars(out, contract.chars, language);
  };
  if (contract.scope === "sendableDraft") {
    const draft = copyableDraft(body);
    if (!draft) return body;
    const at = body.lastIndexOf(draft), fitted = trim(draft);
    return at < 0 || fitted === draft ? body : body.slice(0, at) + fitted + body.slice(at + draft.length);
  }
  const used = receipts.length;
  if (contract.sentences && used >= contract.sentences) return "";
  if (contract.sentences) body = keep(sentenceUnits(body).slice(0, contract.sentences - used));
  if (contract.lines) body = body.split(/\r?\n/u).filter(line => line.trim()).slice(0, Math.max(0, contract.lines - used)).join("\n");
  if (contract.chars) body = clipChars(body, Math.max(0, contract.chars - visibleLength(receipts.join(""))), language);
  return body;
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

const fragmentKey = (text) => text.normalize("NFKC").replace(/\s/gu, "").replace(/[。.!！？?；;，,：:]+$/gu, "").toLowerCase();
// Near-duplicate agreement lines say the same duty in other words ("每周日晚上，两人一起把下周的菜单定好" and "每周日晚上，我们
// 一起定好下周的菜单"): most character pairs of the shorter line, ignoring who-words, appear in the longer one.
const dutyPairs = (text) => pairsOf(String(text || "").replace(/我们俩|你们俩|我们|你们|两人|两个人|一起|双方|把|的|了|we both|both of us|together|we|nosotros|juntos/giu, ""));
export function nearDuplicate(a, b) {
  const left = dutyPairs(a), right = dutyPairs(b);
  if (left.length < 2 || right.length < 2) return fragmentKey(a) === fragmentKey(b);
  const [short, long] = left.length <= right.length ? [left, new Set(right)] : [right, new Set(left)];
  return short.filter(pair => long.has(pair)).length / short.length >= 0.75;
}
// Task 58: a term equal to the title is the duplicate, so the TERM goes and the title stays (the round-22 projection cleared
// the title instead, and the stored draft then read as untitled). Near-duplicate terms and a summary repeating a term go too.
export function agreementPresentation(draft, reply = "") {
  if (!draft) return { draft, reply };
  const seen = new Set(), kept = [];
  for (const term of draft.terms || []) {
    const key = fragmentKey(term);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (/^(?:建议(?:默认)?|默认建议|suggested default|proposed default|valor predeterminado sugerido)\s*[:：]/iu.test(term)) continue;
    // Of two near-duplicates the fuller wording stays ("…冷静十分钟再回来聊" over "…冷静十分钟").
    const twin = kept.findIndex(other => nearDuplicate(other, term));
    if (twin >= 0) { if (dutyPairs(term).length > dutyPairs(kept[twin]).length) kept[twin] = term; continue; }
    kept.push(term);
  }
  const titleKey = fragmentKey(draft.title || "");
  // The only term is never removed: then the title simply stays beside it.
  const terms = titleKey && kept.length > 1 ? kept.filter(term => fragmentKey(term) !== titleKey) : kept;
  const summary = draft.summary && terms.some(term => fragmentKey(term) === fragmentKey(draft.summary) || nearDuplicate(term, draft.summary)) ? "" : draft.summary;
  const body = reply.split(/\n/u).filter(line => !seen.has(fragmentKey(line))).join("\n");
  return { draft: { ...draft, title: draft.title, summary, terms, unresolvedPoints: [...new Set(draft.unresolvedPoints || [])] }, reply: body };
}

export function groundedAgreementTerms(terms, checks, messages) {
  const originals = messages.filter(message => message.role === "member");
  return terms.filter((term, index) => {
    const rows = checks?.filter(row => row.index === index) || [];
    return rows.length === 1 && rows[0].supported === true && rows[0].quote?.trim()
      && originals.some(message => message.id === rows[0].messageId && message.text.includes(rows[0].quote));
  });
}
// Split independent clauses before removing action claims. A semicolon must
// never make the factual half of a mixed delivery disappear with its receipt.
export const deliveryParts = (text, language = "zh") => segments(String(text || "").trim(), language).flatMap(part => part.split(/(?<=[；;\n])/u));
// One action, one receipt line (task 56): facts remembered in the same turn read as one "已记住：A；B。", never a line each.
const rememberedPrefix = /^(已记住：|Remembered: |Recordado: )(.+?)[。.]?$/u;
const reminderTimeOnly = /^(?:[今明后]天|周[一二三四五六日天]|星期[一二三四五六日天]|早上|上午|中午|下午|晚上|夜里|凌晨|\d{1,4}|[一二三四五六七八九十两]+|[年月日号点时分半:：\s\-（）()]|Asia\/[A-Za-z_]+)+[。.]?$/u;
// Beside a server receipt, a model promise about how it will use the record later ("以后给他挑礼物，我会避开…") is an
// unrequested extra and an unverifiable commitment; the receipt alone confirms the action (task 56).
const promisesFutureUse = part => /^(?:(?:好的|好)[，,]?\s*)?(?:以后|今后|下次|之后)[^。！？]{0,40}(?:我会|我来|帮你)|^我(?:以后|今后|下次|之后)(?:会|就)|^(?:From now on|Next time)[^.!?]{0,60}I(?:'ll| will)|^(?:A partir de ahora|La próxima vez)[^.!?]{0,60}(?:te ayudaré|evitaré|tendré)/iu.test(part.trim());
const pairsOf = text => { const chars = [...String(text).normalize("NFKC").replace(/[\s\p{P}]/gu, "")]; return chars.slice(1).map((char, index) => chars[index] + char); };
const receiptContainment = (part, receipt) => { const pairs = pairsOf(part), inside = new Set(pairsOf(receipt)); return pairs.length >= 2 ? pairs.filter(pair => inside.has(pair)).length / pairs.length : 0; };
export function mergeReceipts(receipts = [], language = "zh") {
  const counts = new Map(), remembered = [];
  for (const receipt of receipts) {
    const fact = receipt.match(rememberedPrefix);
    if (fact) { if (!remembered.some(([, text]) => text === fact[2])) remembered.push([fact[1], fact[2]]); continue; }
    counts.set(receipt, (counts.get(receipt) || 0) + 1);
  }
  if (remembered.length) counts.set(`${remembered[0][0]}${remembered.map(([, text]) => text).join(language === "zh" ? "；" : "; ")}${language === "zh" ? "。" : "."}`, 1);
  return [...counts].map(([receipt, count]) => count === 1 ? receipt : language === "en" ? `${receipt} (${count} items)` : language === "es" ? `${receipt} (${count} elementos)` : /已放进去/.test(receipt) ? `已加入 ${count} 项。` : `${receipt.replace(/[。.!]$/, "")}（${count} 项）。`);
}
export function finishReply(reply, { request = "", language = "zh", receipts = [], reminderWritten = false, formatChecked = false, deliverables, webPages = [], sourceTranscript } = {}) {
  const parts = deliveryParts(reply, language);
  // The checked candidate is the recovery source, never unverified planner prose.
  const deferred = part => webPages.length && /(?:之后|拿到后|稍后|晚点).{0,20}(?:告诉你|给你|发给你)|(?:will|I'll).{0,30}(?:later|once I)/iu.test(part);
  const transcriptEcho = part => sourceTranscript && reminderWritten && /(?:转写|原话|原文|你说|transcri|you said)/iu.test(part);
  // A committed reminder's receipt already states its time and content: audit quotes of that time or content are not
  // separate deliverables to re-add (task 56: "明天晚上八点半" + "提醒你给他回电话" came back as a second confirmation).
  const coveredByReminder = part => receipts.length && reminderWritten && (confirmsReminder(part) || /提醒|remind|recordar/iu.test(part) || reminderTimeOnly.test(part.trim()));
  // A receipt that already states the saved fact covers an audit quote of it, even when the quote names its subject
  // ("阿杰不吃香菜" beside "已记住：不吃香菜；对花粉过敏。"): most of the quote's character pairs are in one receipt.
  const coveredByReceipt = part => receipts.some(receipt => receiptContainment(part, receipt) >= 0.6);
  const required = [...(deliverables || []).flatMap(part => deliveryParts(part, language)).filter(part => !coveredByReminder(part) && !coveredByReceipt(part)), ...parts.filter(part => !coveredByReceipt(part))]
    .filter(part => !claimsWrite(part) && !claimsReminder(part) && !describesActionStatus(part) && !(receipts.length && (reminderWritten && confirmsReminder(part) || promisesFutureUse(part))) && !deferred(part) && !transcriptEcho(part));
  const reminderRemoved = parts.some(claimsReminder);
  const removed = reminderRemoved || parts.some(claimsWrite);
  // Receipts are server-authored after successful writes, never planner-provided flags.
  const kept = parts.filter((part) => !claimsWrite(part) && !claimsReminder(part) && !deferred(part) && !transcriptEcho(part)
    && !(receipts.length && (describesActionStatus(part) || reminderWritten && confirmsReminder(part) || promisesFutureUse(part)))
    // One action, one sentence (task 58): model prose restating what a receipt already confirms ("阿杰不吃香菜，对花粉过敏。"
    // above "好，记住了：阿杰不吃香菜；对花粉过敏。") is left to the receipt.
    && !coveredByReceipt(part));
  // A supplement is a later step too: one that would break the user's format contract is not added (task 58).
  const joined = (values) => values.join("").trim();
  for (const part of required) if (![...kept, ...receipts].some(value => fragmentKey(value).includes(fragmentKey(part)))
    && contractIssues(joined([...kept, part]), request, language).length <= contractIssues(joined(kept), request, language).length) kept.push(part);
  const seen = new Set();
  let text = kept.filter(part => { const key = fragmentKey(part); if (!key || seen.has(key)) return false; seen.add(key); return true; }).join("").trim().replace(/[；;]\s*$/, "。");
  if (!text && parts.some(deferred)) text = language === "en" ? "I could not confirm the requested information in this turn." : language === "es" ? "No pude confirmar la información solicitada en este turno." : "这次未能确认你问的信息。";
  const merged = mergeReceipts(receipts, language);
  // Final code acceptance of the user format contract for every channel (checked or not): receipts are never cut.
  text = settleContract(text, request, language, { receipts: merged });
  if (merged.length) text = [text, ...merged].filter(Boolean).join("\n");
  if (reminderRemoved && !reminderWritten) text = [text, language === "en" ? "No reminder was created in this turn." : language === "es" ? "No se creó ningún recordatorio en este turno." : "这轮尚未创建提醒。"].filter(Boolean).join("\n");
  if (!text && removed) text = language === "en" ? "No new record was saved in this turn." : language === "es" ? "No se guardó ningún registro nuevo en este turno." : "这轮没有新增记录。";
  return directFactReply(text, request);
}

// Remove presentation metadata only. Negative/missing-evidence statements and
// event dates are facts, so neither is rewritten by this final rendering step.
export function directFactReply(text, request = "") {
  if (/(?:来源|出处|记录.*(?:哪|何|时间|日期|时候)|(?:哪|何|什么时候).*记录|从哪|根据什么)|\b(?:source|provenance|recorded when|how do you know|where.*(?:get|learn)|fuente|procedencia|de d[oó]nde|c[oó]mo (?:lo )?sabes)\b/iu.test(request)) return text;
  text = stripNormalizedMetadata(text);
  return text.replace(/(?:记录里|记录中)有一条([^。！？\n]+?)的信息(?:[（(]记录于[^）)]+[）)])?/gu, '$1')
    .replace(/(^|[。！？\n：:])\s*(?:记录(?:里|中)|根据(?:你|您)(?:在)?\s*\d{1,4}[^，。！？\n]{0,16}说的)[，,:：]?\s*(?!没有|没找到|未|不存在|不清楚)/gu, '$1')
    .replace(/[（(]\s*(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*[日号]?\s*(?:说的|提到的|告诉我的)\s*[）)]/gu, '')
    .replace(/(^|[。！？\n：:])\s*(?:根据记录[，,:：]?|(?:记录里|记录中)(?:显示|提到|写着|只有)[，,:：]?|我这边看到(?:的是|了)?[，,:：]?)\s*/gu, '$1')
    .replace(/(^|[.!?\n])\s*(?:(?:according to|based on) (?:the )?records?|(?:según|de acuerdo con) (?:los )?registros?)[,:，]?\s*/giu, '$1')
    .replace(/[（(]记录于\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}[）)]/gu, '');
}

function stripNormalizedMetadata(text) {
  let normalized = "", offsets = [];
  for (let index = 0; index < text.length; index++) {
    const value = text[index].normalize("NFKC");
    normalized += value;
    offsets.push(...Array(value.length).fill(index));
  }
  const pattern = /(?:^|(?<=[。!?\n:]))\s*(?:记\s*录\s*(?:里|中)(?:\s*(?:显示|提到|写着|只有))?|根据记录|我这边看到(?:的是|了)?)[,，:：]?\s*(?!有一条|没有|没找到|未|不存在|不清楚)|\(\s*(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*[日号]?\s*(?:说的|提到的|告诉我的)\s*\)/gu;
  const ranges = [...normalized.matchAll(pattern)].map(match => [offsets[match.index], offsets[match.index + match[0].length - 1] + 1]);
  for (const [start, end] of ranges.reverse()) text = text.slice(0, start) + text.slice(end);
  return text;
}

// Reminder promises also duplicate a committed receipt without saying "created".
const confirmsReminder = text => /^(?:(?:好的|好|没问题)[，,]?\s*)?(?:我会|我将|我来|会在|将在|今天|明天|后天|下周|周[一二三四五六日天]|\d{1,4}年|\d{1,2}月).{0,80}提醒(?:你|您)|\b(?:I(?:'ll| will) remind you|te recordar[eé])\b/iu.test(text);

// Positive AND negative model status claims yield to the actual operation receipts.
const describesActionStatus = (text) => /(?:提醒|记录|草稿|计划).{0,45}(?:设|创建|保存|写入|回执|安排|完成)|(?:未|没|不|已).{0,35}(?:设置|创建|保存|写入)|\b(?:reminder|record|draft).{0,70}\b(?:set|created|saved|scheduled|ready|receipt)|\b(?:recordatorio|registro|borrador).{0,70}\b(?:programad|cread|guardad|list)/iu.test(text);

// Founder ruling (task 56): every partner has a private area, so saying plainly that Pinky cannot see the other person's
// private content reveals nothing. Repeated asks get naturally different wording, each with one line the user can say to
// the partner themselves. No topic is copied from the question: "关于分手，你愿意聊聊感受吗" read as a machine template.
const privateReplies = {
  zh: [
    "我看不到 TA 的私人内容，也没法替 TA 回答。想知道的话，可以直接问 TA：“最近有什么想跟我聊聊的吗？”",
    "那是 TA 自己的私人空间，我这边看不到，也不会去猜。你可以找个轻松的时候问 TA：“我有点在意我们俩的事，你愿意说说你的想法吗？”",
    "这个我真的帮不上：TA 的私人对话只有 TA 自己能看。与其等我给答案，不如把你的不安说出来，直接问 TA：“我心里有点没底，想听听你现在怎么想。”",
  ],
  en: [
    "I can't see their private content, so I can't answer for them. If you want to know, you could ask: “Is there anything you'd like to talk to me about lately?”",
    "That's their own private space; I can't see it and I won't guess. When things feel relaxed, you could say: “I've been thinking about us. Would you tell me what's on your mind?”",
    "I really can't help with that one: their private conversations are visible only to them. You could tell them how you feel instead, for example: “I feel a bit unsure and would love to hear what you think.”",
  ],
  es: [
    "No puedo ver su contenido privado, así que no puedo responder por esa persona. Si quieres saberlo, puedes preguntarle: “¿Hay algo de lo que quieras hablar conmigo últimamente?”",
    "Ese es su espacio privado; no lo veo y no voy a adivinar. En un momento tranquilo puedes decirle: “He estado pensando en nosotros. ¿Me cuentas qué piensas?”",
    "En esto no puedo ayudar: sus conversaciones privadas solo las ve esa persona. Puedes contarle cómo te sientes, por ejemplo: “Me siento un poco insegura/o y me gustaría saber qué piensas.”",
  ],
};
// Ruling (task 58, memory-partner-secret-gift): the suggestion may fit the KIND of question (a secret, a thought, an
// arrangement), e.g. "等 TA 自己揭晓" for a secret, while never copying the user's topic words and never revealing or hinting
// at any private content. Every line still says plainly that Pinky cannot see the other person's private content.
const typedPrivateReplies = {
  secret: {
    zh: ["我看不到 TA 的私人内容，也不会替 TA 透露什么。要是 TA 真有打算，就等 TA 自己揭晓吧。",
      "TA 的私人空间我这边看不到，有没有我也不会去猜。真有的话，留给 TA 亲手拿出来会更好。",
      "这个我帮不上：TA 的私人对话我看不到，有没有、是什么我都不知道。先别急着打听，让 TA 按自己的节奏告诉你。"],
    en: ["I can't see their private content, and I won't give anything away for them. If they do have something in mind, let them reveal it themselves.",
      "Their private space is closed to me, and I won't guess whether there's anything there. If there is, it's nicer coming from them.",
      "I can't help with this one: only they can see their private conversations, so I don't know if there's anything or what. Let them share it in their own time."],
    es: ["No puedo ver su contenido privado y no voy a desvelar nada por esa persona. Si tiene algo pensado, deja que lo revele ella misma.",
      "Su espacio privado no lo veo, y no voy a adivinar si hay algo. Si lo hay, será mejor que venga de su parte.",
      "En esto no puedo ayudar: solo esa persona ve sus conversaciones privadas, así que no sé si hay algo ni qué es. Deja que te lo cuente a su ritmo."],
  },
  thought: {
    zh: ["TA 心里怎么想，我看不到 TA 的私人内容，没法替 TA 回答。你可以直接问 TA：“最近你心里有什么想跟我说的吗？”",
      "这种事只有 TA 自己说得清，我这边看不到，也不会去猜。找个安静的时候问问：“你最近对我们之间感觉怎么样？我想听你说。”",
      "这个我帮不上：TA 的私人对话只有 TA 自己能看。不如先把你的在意说出来，再问 TA：“我有点没底，你愿意跟我聊聊吗？”"],
    en: ["I can't see their private content, so I can't say what's on their mind. You could ask them directly: “Is there anything on your mind you'd like to tell me?”",
      "Only they can speak to that; I can't see it and I won't guess. In a quiet moment you could ask: “How are you feeling about us lately? I'd like to hear it from you.”",
      "I can't help with this one: their private conversations are visible only to them. Share what's worrying you, then ask: “I feel a bit unsure. Would you talk with me?”"],
    es: ["No puedo ver su contenido privado, así que no puedo decir qué piensa. Puedes preguntarle directamente: “¿Hay algo que tengas en mente y quieras contarme?”",
      "Eso solo puede explicarlo esa persona; no lo veo y no voy a adivinar. En un momento tranquilo puedes preguntar: “¿Cómo te sientes con lo nuestro últimamente? Quiero oírlo de ti.”",
      "En esto no puedo ayudar: sus conversaciones privadas solo las ve esa persona. Cuéntale lo que te inquieta y pregúntale: “Me siento algo insegura/o, ¿hablamos?”"],
  },
  arrangement: {
    zh: ["TA 的私人安排我看不到，也没法替 TA 回答。想知道的话可以直接问：“你最近有什么打算吗？我想一起排排时间。”",
      "那是 TA 自己的日程，我这边看不到，也不会去猜。不如约个时间对一下：“我们找天把接下来的事一起看看？”",
      "这个我真帮不上：TA 的私人内容只有 TA 自己能看。你可以先说说你的计划，再问 TA：“你那边方便吗？”"],
    en: ["I can't see their private plans, so I can't answer for them. You could just ask: “What do you have coming up? I'd like to plan some time together.”",
      "Their schedule is their own and I can't see it, so I won't guess. Why not sync up: “Shall we look at the next few days together?”",
      "I really can't help with that: only they can see their private content. Share your own plan first, then ask: “Does that work on your side?”"],
    es: ["No puedo ver sus planes privados, así que no puedo responder por esa persona. Puedes preguntarle: “¿Qué tienes previsto? Me gustaría organizar algo juntos.”",
      "Su agenda es suya y no la veo, así que no voy a adivinar. Mejor coordínense: “¿Miramos juntos los próximos días?”",
      "En esto no puedo ayudar: solo esa persona ve su contenido privado. Cuéntale tu plan primero y pregúntale: “¿A ti te viene bien?”"],
  },
};
const privateKinds = [["thought", /想法|看法|怎么想|在想|觉得|感受|心里|爱不爱|喜不喜欢|满意|后悔|分手|离开|\b(?:think|thinks|thinking|feel|feels|opinion|break(?:ing)? up|breakup)\b|\b(?:piensa|siente|opini[oó]n|terminar|romper)\b/iu],
  ["secret", /惊喜|礼物|秘密|瞒|偷偷|\b(?:surprise|gift|secret|hiding)\b|\b(?:sorpresa|regalo|secreto|oculta)\b/iu],
  ["arrangement", /安排|计划|打算|行程|去哪|约了|跟谁|见了谁|周末|\b(?:plans?|schedule|weekend|meeting)\b|\b(?:planes?|horario|fin de semana|cita)\b/iu]];
// The user's topic word is never echoed back, nor any four-character run of their question (the old "关于分手…" template
// copied the topic). Function words such as "有没有" may coincide.
const echoes = (line, request, topics) => {
  const han = (text) => [...String(text || "").normalize("NFKC").replace(/[^\p{Script=Han}]/gu, "")];
  const words = (text) => String(text || "").normalize("NFKC").toLowerCase().match(/\p{L}+/gu)?.filter((word) => !/\p{Script=Han}/u.test(word)) || [];
  const said = han(request).join(""), chars = han(line), saidWords = words(request).join(" "), lineWords = words(line);
  return topics.some((word) => line.toLowerCase().includes(word.toLowerCase()))
    || said.length >= 4 && chars.some((_, index) => index + 4 <= chars.length && said.includes(chars.slice(index, index + 4).join("")))
    || lineWords.some((_, index) => index + 3 <= lineWords.length && ` ${saidWords} `.includes(` ${lineWords.slice(index, index + 3).join(" ")} `));
};
// The third question in a row gets the third wording; the request selects only the kind of suggestion, never a topic.
export function privateBoundaryReply(language, index = 0, request = "") {
  const generic = privateReplies[language] || privateReplies.zh, found = privateKinds.find(([, pattern]) => pattern.test(request));
  const topics = privateKinds.flatMap(([, pattern]) => [...request.matchAll(new RegExp(pattern.source, "giu"))].map((match) => match[0]));
  const typed = found ? typedPrivateReplies[found[0]][language] || typedPrivateReplies[found[0]].zh : [];
  const usable = [...typed, ...generic].filter((line) => !echoes(line, request, topics));
  return (usable.length >= 3 ? usable : generic)[index % 3];
}
export const isPrivateBoundaryReply = (reply) => [...Object.values(privateReplies), ...Object.values(typedPrivateReplies).flatMap((kind) => Object.values(kind))].some((variants) => variants.includes(reply));

// Character-bigram Jaccard similarity: repeated boundary replies must read differently, not as one template.
export function replySimilarity(a = "", b = "") {
  const grams = (text) => { const chars = [...String(text).replace(/\s/gu, "")]; return new Set(chars.slice(1).map((char, index) => chars[index] + char)); };
  const left = grams(a), right = grams(b);
  if (!left.size && !right.size) return 1;
  let shared = 0; for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

// Never fail empty (task 56). Generic failure copy may only be shown when no model ever produced a usable draft; once a
// draft exists, checkers and rewrites can only degrade it (one constrained rewrite, then the last good draft plus a one-line
// caveat), never replace it with an apology for being unavailable or a refusal of the whole delivery.
export const genericFailureReplies = [
  "Pinky 暂时不可用，稍后再试。", "Pinky is unavailable right now. Please try again later.", "Pinky no está disponible ahora. Inténtalo de nuevo más tarde.",
  "Pinky 暂时不可用，什么都没有改动。请稍后再试。", "Pinky is unavailable right now. Nothing was changed; please try again later.", "Pinky no está disponible ahora. No se cambió nada; inténtalo de nuevo más tarde.",
  "这份安排还没通过预算或条件核对，我暂时不能把它当作可执行方案；相关价格、地点、日期和安全条件仍需核实。", "这份安排的预算和条件仍未通过核对，暂时不能当作可执行方案。",
  "This plan still needs its budget and conditions verified before it can be used.", "Falta verificar el presupuesto y las condiciones antes de usar este plan.",
];
const genericKey = (text) => String(text || "").normalize("NFKC").replace(/\s/gu, "");
export const isGenericFailure = (text) => !genericKey(text) || genericFailureReplies.some((reply) => genericKey(text) === genericKey(reply))
  || /^(?:Pinky|助手|AI)\s*暂时不可用/u.test(String(text || "").trim()) || /不能把它当作可执行方案|暂时不能当作可执行方案/u.test(String(text || ""));
/** The delivered text: `final` unless it is empty/generic, then the last good draft with its caveat. Throws only when
 * neither exists, which callers turn into their honest unavailable state (no model output at all). */
export function deliveredReply(final, lastGood = "", caveat = "") {
  if (!isGenericFailure(final)) return String(final).trim();
  const fallback = [String(lastGood || "").trim(), caveat].filter(Boolean).join("\n");
  if (!isGenericFailure(lastGood)) return fallback;
  throw Object.assign(new Error("No deliverable reply"), { code: "NO_DELIVERABLE" });
}

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
