import { hideUnrevealedAnswers } from "./relationship-domain.mjs";

const missing = () => Object.assign(new Error("Conversation not found."), { statusCode: 404 });
const live = (record) => record && !record.archivedAt && !record.withdrawnAt && record.status === "active";

// Both search and navigation use this boundary. IDs supplied by a model or browser never grant access.
export async function readableConversation(store, userId, channel, conversationId) {
  if (channel === "me") {
    const record = await store.getRelationshipRecordForUser("privateAgentThreads", conversationId, userId);
    if (!live(record) || record.ownerUserId !== userId || record.visibility !== "private" || record.intentType !== "assistant") throw missing();
    return record;
  }
  if (channel !== "us") throw missing();
  const context = await store.getRelationshipContext(userId);
  if (!context || !context.members.some((member) => member.userId === userId) || conversationId !== `together:${context.relationship.id}`) throw missing();
  const record = await store.getRelationshipRecordForUser("togetherConversations", conversationId, userId);
  if (!live(record) || record.relationshipId !== context.relationship.id || record.visibility !== "shared") throw missing();
  return record;
}

export async function conversationMessages(store, userId, channel, record) {
  if (channel === "me") return [...(record.earlier || []).flatMap((page) => page.messages || []), ...(record.messages || [])];
  const messages = [];
  for (let seq = 1; seq <= (record.archived?.chunks || 0); seq += 1) {
    const chunk = await store.getRelationshipRecordForUser("togetherArchives", `${record.id}:archive:${seq}`, userId);
    if (live(chunk) && chunk.relationshipId === record.relationshipId && chunk.visibility === "shared") messages.push(...(chunk.messages || []));
  }
  messages.push(...(record.messages || []));
  // Projection must never mutate the stored archive (file stores can share immutable pages).
  return hideUnrevealedAnswers({ messages: structuredClone(messages) }, userId).messages;
}

export function conversationDay(at, timezone = "UTC") {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at)); }
  catch { return ""; }
}

// A bounded window replaces the stream in place; before/after cursors allow reading on without loading years into the UI.
export async function locateConversation({ store, userId, channel, conversationId, messageId, date, timezone = "UTC", direction }) {
  if ((!messageId && !date) || date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || conversationDay(`${date}T12:00:00Z`) !== date)
    || !conversationDay("2026-01-01T12:00:00Z", timezone) || direction && !["before", "after"].includes(direction)) {
    throw Object.assign(new Error("Invalid history location."), { statusCode: 400 });
  }
  const record = await readableConversation(store, userId, channel, conversationId);
  const all = await conversationMessages(store, userId, channel, record);
  const index = all.findIndex((message) => messageId ? message.id === messageId : conversationDay(message.createdAt, timezone) === date);
  if (index < 0) throw missing();
  const start = direction === "before" ? Math.max(0, index - 50) : direction === "after" ? index + 1 : Math.max(0, index - 10);
  const end = direction === "before" ? index : Math.min(all.length, start + 50);
  const messages = all.slice(start, end);
  return { record, channel, conversationId, messageId: direction ? messages[0]?.id || null : all[index].id, messages,
    before: start > 0 ? messages[0]?.id || null : null, after: end < all.length ? messages.at(-1)?.id || null : null };
}

// Citation markers are selected by the model only from server-issued results. Unknown or repeated markers cannot forge links.
export function citedReply(text, sources = [], { renderExchanges = false, language = "zh" } = {}) {
  const selected = [];
  const reply = String(text || "").replace(/\[recall:([^\]\s]+)\]/g, (_marker, id) => {
    const source = sources.find((item) => item.messageId === id);
    if (source && !selected.some((item) => item.messageId === id) && selected.length < 3) selected.push(source);
    return "";
  }).trim();
  const labels = language === "en" ? ["You asked", "Pinky answered"] : language === "es" ? ["Preguntaste", "Pinky respondió"] : ["你当时问", "Pinky 当时答"];
  const exchanges = renderExchanges ? selected.filter((source) => source.exchange?.question && source.exchange?.answer) : [];
  return { reply: exchanges.length ? exchanges.map((source) => `${source.date}\n${labels[0]}：${source.exchange.question}\n${labels[1]}${source.exchange.answerDate !== source.date ? ` (${source.exchange.answerDate})` : ""}：${source.exchange.answer}`).join("\n\n") : reply,
    sources: selected.map(({ exchange, ...source }) => source) };
}
