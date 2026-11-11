// Model prose is not an execution receipt. Only the caller's committed results can confirm a write.
const savedClaim = /(?:起草好了|(?:已经|已)起草|已(?:经)?(?:帮你)?(?:记入|记进|保存|存入|记下|记录)|(?:我)?记下了|(?:I(?:'ve| have)?\s+)?(?:(?:saved|stored|recorded|noted)\b|kept\s+(?:in|on|a note)\b)|(?:he\s+)?(?:guardado|registrado|anotado)\b)/iu;
const segments = (text, language) => [...new Intl.Segmenter(language || "zh", { granularity: "sentence" }).segment(text)].map(({ segment }) => segment);
const claimsWrite = (text) => savedClaim.test(text) && !/(?:没有|并未|尚未|未曾|不能|not |never |cannot |can't |no se |no he )[^。！？.!?]{0,45}(?:已|记|保存|saved|stored|recorded|noted|kept|guardado|registrado|anotado)/iu.test(text);
const reminderClaim = /(?:已(?:经)?|我(?:已|只|已经)?|帮你|替你).{0,18}(?:设好|设置|设了|设|安排|创建|准备|保存).{0,24}提醒|(?:提醒).{0,12}(?:设好了|已设置|已准备|已创建)|(?:我会|到时会|到时候会).{0,24}提醒你|\b(?:I(?:'ve| have)?\s+(?:set|scheduled|created|prepared)|(?:reminder|alert).{0,20}(?:is set|is ready|scheduled)|I(?:'ll| will) remind you)\b|\b(?:(?:he|ya).{0,18}(?:preparado|programado|creado).{0,24}recordatorio|te recordaré)\b/iu;
export const claimsReminder = (text) => reminderClaim.test(text) && !/(?:没有|并未|尚未|不能|不会|还没|not |never |cannot |can't |no he |no está)[^。！？.!?]{0,40}(?:提醒|remind|set|schedul|prepar|recordatorio)/iu.test(text);

export function wantsOneSentence(request) {
  return /(?:只(?:要|回|用|写|给|需)|就(?:回|写)|(?:^|[，。！？\n])(?:请)?用|回复?我?)[^。！？\n]{0,12}(?:一句|一条短句)|(?:only|just|exactly)\s+(?:one|a|1)\s+(?:short\s+)?sentence|(?:solo|sólo|una sola)\s+(?:una\s+)?frase/iu.test(request || "");
}

export function finishReply(reply, { request = "", language = "zh", receipts = [], reminderWritten = false } = {}) {
  const parts = segments(String(reply || "").trim(), language);
  const reminderRemoved = parts.some(claimsReminder);
  const removed = reminderRemoved || parts.some(claimsWrite);
  // Receipts are server-authored after successful writes, never planner-provided flags.
  let text = parts.filter((part) => !claimsWrite(part) && !claimsReminder(part)).join("").trim();
  if (removed && receipts.length) text = [text, ...receipts].filter(Boolean).join("\n");
  if (reminderRemoved && !reminderWritten) text = [text, language === "en" ? "No reminder was created in this turn." : language === "es" ? "No se creó ningún recordatorio en este turno." : "这轮尚未创建提醒。"].filter(Boolean).join("\n");
  if (!text && removed) text = language === "en" ? "No new record was saved in this turn." : language === "es" ? "No se guardó ningún registro nuevo en este turno." : "这轮没有新增记录。";
  if (wantsOneSentence(request) && !receipts.length) text = segments(text, language)[0]?.trim() || text;
  return text;
}

export const replyContractInstructions = `Respect explicit output scope: if asked for only one sentence, give exactly one useful sentence, no preamble, commentary, extra advice or closing. If asked for wording, put the usable draft first. Preserve all useful supplied specifics (names, places, dates, amounts) without inventing commitments or accepting a proposed time for the user. Use message timestamps to distinguish past records from the current turn; never call an old message just said. Compare dated events precisely: before an agreed time and after it are different. Never claim you saved, recorded, scheduled or prepared a reminder in prose: the server reports committed writes. A requested reminder requires a reminder action even after a lookup; actions:[] means no reminder will exist. Private rephrasing must preserve the user's definite choices (not wanting to disclose is not being undecided); omit excluded sensitive details from BOTH the draft and surrounding commentary. If a recalled event itself has no evidence, say that the event is not established in the available records before asking for clarification; do not merely say its cause is unknown or invite details as if it happened. Explain plainly why the related fact does not prove it. If clarification helps, ask what the user observed or heard, never how the unestablished event happened. Be brief and warm about privacy; never scold repeated asking or suggest probing secrets.`;
