// Model prose is not an execution receipt. Only the caller's committed results can confirm a write.
const savedClaim = /(?:已(?:经)?(?:帮你)?(?:记入|记进|保存|存入|记下|记录)|(?:我)?记下了|(?:I(?:'ve| have)?\s+)?(?:(?:saved|stored|recorded|noted)\b|kept\s+(?:in|on|a note)\b)|(?:he\s+)?(?:guardado|registrado|anotado)\b)/iu;
const segments = (text, language) => [...new Intl.Segmenter(language || "zh", { granularity: "sentence" }).segment(text)].map(({ segment }) => segment);
const claimsWrite = (text) => savedClaim.test(text) && !/(?:没有|并未|尚未|未曾|不能|not |never |cannot |can't |no se |no he )[^。！？.!?]{0,45}(?:已|记|保存|saved|stored|recorded|noted|kept|guardado|registrado|anotado)/iu.test(text);

export function wantsOneSentence(request) {
  return /(?:只(?:要|回|用|写|给|需)|就(?:回|写)|用)[^。！？\n]{0,12}(?:一句|一条短句)|(?:only|just|exactly)\s+(?:one|a|1)\s+(?:short\s+)?sentence|(?:solo|sólo|una sola)\s+(?:una\s+)?frase/iu.test(request || "");
}

export function finishReply(reply, { request = "", language = "zh", receipts = [] } = {}) {
  const parts = segments(String(reply || "").trim(), language);
  const removed = parts.some(claimsWrite);
  // Receipts are server-authored after successful writes, never planner-provided flags.
  let text = parts.filter((part) => !claimsWrite(part)).join("").trim();
  if (removed && receipts.length) text = [text, ...receipts].filter(Boolean).join("\n");
  if (!text && removed) text = language === "en" ? "No new record was saved in this turn." : language === "es" ? "No se guardó ningún registro nuevo en este turno." : "这轮没有新增记录。";
  if (wantsOneSentence(request) && !receipts.length) text = segments(text, language)[0]?.trim() || text;
  return text;
}

export const replyContractInstructions = `Respect explicit output scope: if asked for only one sentence, give exactly one useful sentence, no preamble, commentary, extra advice or closing. If asked for wording, put the usable draft first. Preserve all useful supplied specifics (names, places, dates, amounts) without inventing commitments or accepting a proposed time for the user. Compare dated events precisely: before an agreed time and after it are different. Never claim you saved, recorded or updated anything in prose: the server reports committed writes. Private rephrasing must preserve the user's definite choices (not wanting to disclose is not being undecided); omit excluded sensitive details from BOTH the draft and surrounding commentary. If a recalled event itself has no evidence, say that the event is not established in the available records before asking for clarification; do not merely say its cause is unknown or invite details as if it happened. A different related event is not evidence for that premise.`;
