// Old routing-only replies can survive in saved conversations or a cached model response.
const oldStatus = [
  "我先私下读一下截图，再在这里回答你。",
  "I'll read the screenshots privately and answer here.",
  "Leeré las capturas en privado y te responderé aquí.",
];
const oldImportReceipts = [
  /^收到了 \d+ 条消息(?: \([^()\n]+\))?，我开始读了。大概要几分钟，读完会在这里告诉你。原文只有你能看到。$/u,
  /^Got \d+ messages?(?: \([^()\n]+\))?\. I'm reading them now; it takes a few minutes and I'll tell you here when I'm done\. Only you can see them\.$/u,
  /^Recibí \d+ mensajes?(?: \([^()\n]+\))?\. Los estoy leyendo; tardaré unos minutos y te avisaré aquí\. Solo tú puedes verlos\.$/u,
];

// Strip only literal preambles emitted by earlier clients. Preserve the rest of a mixed reply.
export function withoutScreenshotPreamble(text) {
  if (typeof text !== "string" || !text) return text;
  const trimmed = text.trimStart();
  const prefix = oldStatus.find((line) => trimmed.replaceAll("’", "'").startsWith(line));
  return prefix ? trimmed.slice(prefix.length).trimStart() : text;
}

export function screenshotTurnMessages(session) {
  return [...(session.earlier || []).flatMap((page) => page.messages || []), ...(session.messages || [])];
}

export function screenshotPending(message) {
  return Boolean(message.screenshotReplyTo && Date.now() - Date.parse(message.screenshotStartedAt) < 15 * 60_000);
}

export function visibleAssistantText(message, previous) {
  if (message.role !== "assistant") return message.text;
  const text = withoutScreenshotPreamble(message.text);
  if (message.cards?.some((card) => card.kind === "chat_import") && (message.screenshotReplyTo || previous?.screenshots || previous?.photoIds?.length)) {
    // Older imports separately posted a text receipt and the actionable analysis card.
    const receipt = text?.trim().replaceAll("’", "'");
    if (receipt && oldImportReceipts.some((pattern) => pattern.test(receipt))) return "";
  }
  return text;
}
