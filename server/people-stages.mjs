import { listPeople, livePerson, nameKey } from "./people.mjs";

// One Pinky, three stages (founder 11-09: "A 吧，一个 Pinky，三个阶段"): getting to know several people, settling on one,
// and being together in Pinky as a couple. The stage follows facts (is the member paired, has a person been chosen); the
// member only ever confirms the one moment that matters: "听起来你和阿杰确定了？" → 是的. Choosing someone puts the others
// away (never deleted), and if the couple later leaves, the people put away come back.
const ASK_AGAIN_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const TOGETHER = /在一起了|确定关系|确定了关系|官宣|成了?(男|女)朋友|是(男|女)朋友了|交往了|we'?re (together|dating|official)|estamos juntos/i;

const shown = (person) => [person.name, ...(person.aliases || [])].map((name) => nameKey(String(name).replace(/[（(][^）)]*[）)]/g, ""))).filter((key) => key.length >= 1);
const paired = async (store, userId) => (await store.getRelationshipContext(userId))?.relationship?.status === "active";

/** Where the member is: "dating", "chosen" (settled on one, not yet together in Pinky) or "together". */
export async function stageOf(store, userId) {
  if (await paired(store, userId)) return { stage: "together", chosen: null };
  const chosen = (await listPeople(store, userId, { archived: true })).find((person) => person.chosenAt && !person.deletedAt && person.status !== "merged") || null;
  return chosen ? { stage: "chosen", chosen } : { stage: "dating", chosen: null };
}

/** The person a message says the member is now together with, when it is time to ask; else null. */
export async function togetherWith(store, userId, text) {
  if (!TOGETHER.test(String(text || "")) || await paired(store, userId)) return null;
  const people = await listPeople(store, userId, { archived: true });
  if (people.some((person) => person.chosenAt)) return null;
  const said = nameKey(text);
  const named = people.filter((person) => livePerson(person, userId) && shown(person).some((key) => said.includes(key)));
  if (named.length !== 1) return null;
  const person = named[0];
  return person.chooseAskedAt && Date.now() - Date.parse(person.chooseAskedAt) < ASK_AGAIN_AFTER_MS ? null : person;
}

/** Marks that Pinky asked about this person, so a "not yet" is not asked again for a month. */
export const markAsked = (tx, userId, personId) => tx.updateRelationshipRecordForUser("memories", personId, userId, (draft) => { draft.chooseAskedAt = new Date().toISOString(); draft.version += 1; });

/** 是的: this is the one. Everyone else is put away; nothing is deleted. */
export async function choose(tx, userId, personId, at = new Date().toISOString()) {
  const people = await listPeople(tx, userId, { archived: true });
  const person = people.find((item) => item.id === personId);
  if (!person) return null;
  for (const other of people) {
    if (other.id === personId || other.archivedAt) continue;
    await tx.updateRelationshipRecordForUser("memories", other.id, userId, (draft) => { draft.archivedAt = at; draft.archivedFor = personId; draft.version += 1; });
  }
  return tx.updateRelationshipRecordForUser("memories", personId, userId, (draft) => { draft.chosenAt = at; draft.archivedAt = null; draft.status = "active"; draft.version += 1; });
}

/** 还没有 / changed my mind: nobody is chosen any more and the people put away for them come back. */
export async function unchoose(tx, userId) {
  const people = await listPeople(tx, userId, { archived: true });
  const chosen = people.find((person) => person.chosenAt);
  if (!chosen) return null;
  for (const other of people) if (other.archivedFor === chosen.id) await tx.updateRelationshipRecordForUser("memories", other.id, userId, (draft) => { draft.archivedAt = null; draft.archivedFor = null; draft.version += 1; });
  return tx.updateRelationshipRecordForUser("memories", chosen.id, userId, (draft) => { draft.chosenAt = null; draft.pairedAt = null; draft.version += 1; });
}

/**
 * Keeps the stage honest as pairing changes, without hooking into pairing itself: once a member who chose someone is
 * paired, the choice is marked as having become a couple; when that couple is gone, the people put away come back.
 */
export async function settle(store, userId) {
  const isPaired = await paired(store, userId);
  const chosen = (await listPeople(store, userId, { archived: true })).find((person) => person.chosenAt);
  if (!chosen) return;
  if (isPaired && !chosen.pairedAt) await store.transaction(`user:${userId}`, (tx) => tx.updateRelationshipRecordForUser("memories", chosen.id, userId, (draft) => { draft.pairedAt = new Date().toISOString(); draft.version += 1; }));
  else if (!isPaired && chosen.pairedAt) await store.transaction(`user:${userId}`, (tx) => unchoose(tx, userId));
}

