import express from "express";
import { canViewRecord } from "./relationship-domain.mjs";

// 主动展示功能 (founder 11-06): "新用户不知道这个产品可以做这些事情……要主动展示，不能让用户去点 Pinky can do". Two quiet ways,
// no notifications: a card at the end of each conversation that shows one thing this member has not tried yet (one a day,
// tried or dismissed in a tap), and a sentence from Pinky when the conversation naturally touches something they have not
// tried. What counts as tried is read from what they have already done, so nothing is shown twice once it is in use.
export const FEATURES = {
  // channel: where the card shows; hint: what the agents may offer (cycle is never offered unprompted).
  games: { channel: "us", hint: "little games in Us (would you rather, how well do you know me, heart to heart): say \"Pinky, let's play a game\"" },
  miss_you: { channel: "us", hint: "the heart at the top of Us sends 想你了 with floating hearts" },
  pet: { channel: "us", hint: "their little one (the Lv pill at the top of Us) grows with what they do together; each can pet it once a day" },
  ledger: { channel: "us", hint: "a shared ledger: tell Pinky in Us who paid for what and it keeps who owes whom" },
  meetup: { channel: "us", hint: "a countdown to the next time they meet: tell Pinky the date in Us" },
  recap: { channel: "us", hint: "a recap card of a stretch of their time together: \"Pinky, make us a recap\"" },
  agreement: { channel: "us", hint: "writing down what they agreed so both approve it and Pinky follows up" },
  letter: { channel: "me", hint: "a letter or time capsule to the partner, sealed until a chosen day" },
  profile: { channel: "me", hint: "About us in Settings: what Pinky remembers of each of them, editable" },
  photos: { channel: "me", hint: "turning their iPhone photos of the two of them into memories and a map" },
  reminder: { channel: "me", hint: "personal reminders, once or weekly" },
  hard_words: { channel: "me", hint: "help saying something hard to the partner, sent only after they confirm" },
  cycle: { channel: "me", hint: null },
};

/** What this member (or the couple, for shared things) has already used. Server-side: only keys leave. */
export async function featuresUsed(store, userId) {
  const used = new Set();
  const context = await store.getRelationshipContext(userId);
  const relationshipId = context?.relationship.status === "active" && context.members.length === 2 ? context.relationship.id : null;
  const list = async (collection) => (await store.listRelationshipRecordsForUser(collection, userId)).filter((item) => canViewRecord(item, userId) || item.ownerUserId === userId);
  if (relationshipId) {
    const conversation = await store.getRelationshipRecordForUser("togetherConversations", `together:${relationshipId}`, userId);
    for (const message of conversation?.messages || []) {
      if (message.kind === "game") used.add("games");
      if (message.kind === "nudge" && message.actorUserId === userId) used.add("miss_you");
      if (message.kind === "story") used.add("recap");
      if (message.kind === "letter_sealed" && message.actorUserId === userId) used.add("letter");
    }
    if (Object.values(conversation?.pets || {}).some((ids) => ids.includes(userId)) || Object.keys(conversation?.pet?.seen || {}).some((key) => key.startsWith("pet:") && key.endsWith(`:${userId}`))) used.add("pet");
    const spaces = await list("spaces");
    if (spaces.some((space) => space.system === "ledger" && space.relationshipId === relationshipId)) used.add("ledger");
    const milestones = await list("milestones");
    if (milestones.some((item) => item.type === "meetup" && item.relationshipId === relationshipId)) used.add("meetup");
    if ((await list("agreements")).some((item) => item.relationshipId === relationshipId)) used.add("agreement");
    const album = spaces.find((space) => space.system === "moments" && space.relationshipId === relationshipId);
    if (album && (await list("spaceItems")).some((item) => item.spaceId === album.id && item.photoId)) used.add("photos");
  }
  const threads = (await store.listRelationshipRecordsForUser("privateAgentThreads", userId)).filter((item) => item.ownerUserId === userId);
  if (threads.some((thread) => (thread.letters || []).length)) used.add("letter");
  if (threads.some((thread) => thread.partnerMessage?.sharedAt || (thread.messages || []).some((message) => (message.cards || []).some((card) => card.kind === "partner_message")))) used.add("hard_words");
  if ((await store.listRelationshipRecordsForUser("reminders", userId)).some((item) => item.ownerUserId === userId && item.visibility === "private")) used.add("reminder");
  if ((await store.listRelationshipRecordsForUser("checkins", userId)).some((item) => item.ownerUserId === userId && item.kind === "cycle")) used.add("cycle");
  return { used, paired: Boolean(relationshipId) };
}

/** For the agents: a few things this member has not tried, to offer once when the conversation touches them. */
export async function notTriedYet(store, userId, channel) {
  const { used, paired } = await featuresUsed(store, userId);
  return Object.entries(FEATURES).filter(([key, feature]) => feature.hint && !used.has(key) && (paired || feature.channel === "me") && (channel === "us" ? feature.channel === "us" : true)).slice(0, 6).map(([key, feature]) => ({ feature: key, what: feature.hint }));
}

export function createDiscoverRouter({ store }) {
  const router = express.Router();
  router.use("/discover", (req, res, next) => req.auth ? next() : res.status(401).json({ error: "Please sign in." }));
  router.get("/discover", async (req, res) => {
    const { used, paired } = await featuresUsed(store, req.auth.user.id);
    res.json({ used: [...used], paired });
  });
  return router;
}
