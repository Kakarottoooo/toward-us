import { signInText } from "./request-language.mjs";
import express from "express";
import { createRelationshipRecord } from "./relationship-domain.mjs";
import { choose, markAsked, settle, stageOf, unchoose } from "./people-stages.mjs";

// Pinky works for someone single too (founder 11-09: "有很多个暧昧对象……Pinky 要能识别对面是不同的人……哪个人最后评估下来是
// 比较适合我的"). Each person they are getting to know is a private record of theirs, never a user and never shared: the
// pairing partner is still one account, and someone they are seeing is a name with notes. Facts about a person are ordinary
// private profile facts whose subject is `person:<id>`, so they stay with the member through pairing and leaving.
export const PERSON_KIND = "person";
export const personSubject = (id) => `person:${id}`;
export const personOf = (subjectUserId) => String(subjectUserId || "").startsWith("person:") ? String(subjectUserId).slice(7) : null;

const squash = (value) => String(value || "").replace(/\s+/g, " ").trim();
const clean = (value, limit) => squash(value).replace(/\0/g, "").slice(0, limit);
/** A name as typed or shown in a chat title, compared without spaces, case, emoji or punctuation ("Lily 🌸" is "lily"). */
export const nameKey = (value) => squash(value).normalize("NFKC").toLowerCase().replace(/[\s\p{Extended_Pictographic}️()（）·.,，。!！?？~～_\-'"“”‘’]/gu, "");
// Placeholders the screenshot reader or an export uses when a chat shows no name: never a person of their own.
const PLACEHOLDERS = new Set(["ta", "partner", "pareja", "对方", "他", "她", "me", "我", "yo", "unknown", "未知"].map(nameKey));

export const livePerson = (record, userId) => record?.kind === PERSON_KIND && record.visibility === "private" && record.ownerUserId === userId && record.status === "active" && !record.archivedAt && !record.deletedAt;

/** The people this member is getting to know, most recently seen first. */
export async function listPeople(db, userId, { archived = false } = {}) {
  const records = await db.listRelationshipRecordsForUser("memories", userId);
  return records.filter((record) => record?.kind === PERSON_KIND && record.visibility === "private" && record.ownerUserId === userId && !record.deletedAt && record.status !== "merged" && (archived || livePerson(record, userId)))
    .sort((a, b) => String(b.lastSeenAt || b.updatedAt).localeCompare(String(a.lastSeenAt || a.updatedAt)));
}

/** The person a name belongs to: their name or any name they were seen under. */
export function matchPerson(people, name) {
  const key = nameKey(name);
  return key ? people.find((person) => [person.name, ...(person.aliases || [])].some((alias) => nameKey(alias) === key)) || null : null;
}

/** The person a chat is with, made the first time their name is seen. Null for a chat that shows no usable name. */
export async function personFor(tx, userId, name, { at = new Date().toISOString() } = {}) {
  const shown = clean(name, 60);
  if (!nameKey(shown) || PLACEHOLDERS.has(nameKey(shown))) return null;
  const people = await listPeople(tx, userId, { archived: true });
  const found = matchPerson(people, shown);
  if (found) {
    // Someone archived who writes again is back: the member is talking about them now.
    return tx.updateRelationshipRecordForUser("memories", found.id, userId, (draft) => { draft.lastSeenAt = at; if (draft.archivedAt) { draft.archivedAt = null; draft.status = "active"; } draft.version += 1; });
  }
  const record = createRelationshipRecord({ relationshipId: null, userId, ownerUserId: userId, visibility: "private", aiAccessScope: "none", status: "active", provenanceSource: "agent", kind: PERSON_KIND, name: shown, aliases: [shown], lastSeenAt: at });
  await tx.createRelationshipRecord("memories", record);
  return record;
}

/** One person as their owner sees them. */
export const projectPerson = (record) => ({ id: record.id, version: record.version, name: record.name, aliases: record.aliases || [], archived: Boolean(record.archivedAt), lastSeenAt: record.lastSeenAt || record.updatedAt, createdAt: record.createdAt });

async function publicStage(store, userId) {
  const { stage, chosen } = await stageOf(store, userId);
  return { stage, chosen: chosen ? projectPerson(chosen) : null };
}

export function createPeopleRouter({ store, emit = () => {} }) {
  const router = express.Router();
  const fail = (status, message) => Object.assign(new Error(message), { statusCode: status });
  router.use("/people", (req, res, next) => req.auth ? next() : res.status(401).json({ error: signInText(req) }));
  const owned = async (db, id, userId) => {
    const record = await db.getRelationshipRecordForUser("memories", id, userId);
    if (!record || record.kind !== PERSON_KIND || record.visibility !== "private" || record.ownerUserId !== userId || record.deletedAt) throw fail(404, "Not found.");
    return record;
  };
  router.get("/people", async (req, res) => {
    const userId = req.auth.user.id;
    await settle(store, userId).catch((error) => console.error("Could not settle the stage:", error?.message || error));
    const people = await listPeople(store, userId, { archived: req.query.archived === "1" });
    const threads = new Map((await store.listRelationshipRecordsForUser("privateAgentThreads", userId)).filter((record) => record.personId && record.ownerUserId === userId && !record.archivedAt).map((record) => [record.personId, { id: record.id, updatedAt: record.updatedAt, lastFrom: record.messages?.at(-1)?.role || null }]));
    res.json({ people: people.map((person) => ({ ...projectPerson(person), thread: threads.get(person.id) || null })), alerts: 0, ...await publicStage(store, userId) });
  });
  router.get("/people/board", async (req, res) => {
    const userId = req.auth.user.id;
    const people = await listPeople(store, userId);
    res.json({ status: "directory", people: people.map(projectPerson), ...await publicStage(store, userId) });
  });
  router.get("/people/:id", async (req, res) => {
    const person = await owned(store, req.params.id, req.auth.user.id);
    res.json({ person: projectPerson(person), numbers: null, read: null, facts: [], history: [] });
  });
  router.delete("/people/:id", async (req, res) => {
    const userId = req.auth.user.id;
    const person = await store.transaction(`user:${userId}`, async (tx) => {
      const target = await owned(tx, req.params.id, userId);
      if (req.body?.confirm !== target.id) throw fail(400, "Confirm this person before deleting.");
      if (target.chosenAt) await unchoose(tx, userId);
      const memories = (await tx.listRelationshipRecordsForUser("memories", userId)).filter((row) => row.ownerUserId === userId && row.visibility === "private");
      // Include previous cards explicitly folded into this one, including a chain of merges.
      const ids = new Set([target.id]);
      for (let size = 0; size !== ids.size;) {
        size = ids.size;
        for (const row of memories) if (row.kind === PERSON_KIND && ids.has(row.mergedInto)) ids.add(row.id);
      }
      for (const row of memories) {
        if (ids.has(row.id) || ids.has(personOf(row.subjectUserId)) || ids.has(personOf(row.subjectKey)) || row.kind === "people_reading") {
          await tx.deleteRelationshipRecordForUser("memories", row.id, userId);
        }
      }
      for (const row of await tx.listRelationshipRecordsForUser("privateAgentThreads", userId)) {
        if (row.ownerUserId === userId && row.visibility === "private" && ids.has(row.personId)) {
          await tx.deleteRelationshipRecordForUser("privateAgentThreads", row.id, userId);
        }
      }
      for (const row of await tx.listRelationshipRecordsForUser("chatImports", userId)) {
        if (row.ownerUserId === userId && row.visibility === "private" && ids.has(row.personId)) {
          await tx.updateRelationshipRecordForUser("chatImports", row.id, userId, (draft) => {
            delete draft.personId; delete draft.personNew;
            draft.personDetached = true; draft.version += 1;
          });
        }
      }
      return target;
    });
    emit(person, "person.deleted", userId);
    res.status(204).end();
  });
  router.patch("/people/:id", async (req, res) => {
    const userId = req.auth.user.id, name = clean(req.body?.name, 60);
    if (!nameKey(name)) throw fail(400, "Give a name.");
    const updated = await store.transaction(`user:${userId}`, async (tx) => {
      const current = await owned(tx, req.params.id, userId);
      const other = matchPerson((await listPeople(tx, userId, { archived: true })).filter((person) => person.id !== current.id), name);
      if (other) throw fail(409, "Someone else already has this name. Merge them instead.");
      return tx.updateRelationshipRecordForUser("memories", current.id, userId, (draft) => { draft.name = name; draft.aliases = [...new Set([...(draft.aliases || []), name])].slice(-12); draft.version += 1; });
    });
    emit(updated, "person.updated", userId);
    res.json({ person: projectPerson(updated) });
  });
  // Two records that are one person (a chat title that changed, a nickname): the notes move to the one kept.
  router.post("/people/:id/merge", async (req, res) => {
    const userId = req.auth.user.id, intoId = clean(req.body?.into, 80);
    if (!intoId || intoId === req.params.id) throw fail(400, "Pick who to merge into.");
    const kept = await store.transaction(`user:${userId}`, async (tx) => {
      const from = await owned(tx, req.params.id, userId), into = await owned(tx, intoId, userId);
      for (const record of await tx.listRelationshipRecordsForUser("memories", userId)) {
        if (record.kind === "profile" && record.ownerUserId === userId && record.subjectUserId === personSubject(from.id)) await tx.updateRelationshipRecordForUser("memories", record.id, userId, (draft) => { draft.subjectUserId = personSubject(into.id); draft.version += 1; });
      }
      for (const record of await tx.listRelationshipRecordsForUser("chatImports", userId)) {
        if (record.ownerUserId === userId && record.personId === from.id) await tx.updateRelationshipRecordForUser("chatImports", record.id, userId, (draft) => { draft.personId = into.id; draft.version += 1; });
      }
      await tx.updateRelationshipRecordForUser("memories", from.id, userId, (draft) => { draft.status = "merged"; draft.mergedInto = into.id; draft.archivedAt = new Date().toISOString(); draft.version += 1; });
      return tx.updateRelationshipRecordForUser("memories", into.id, userId, (draft) => { draft.aliases = [...new Set([...(draft.aliases || []), from.name, ...(from.aliases || [])])].slice(-12); draft.version += 1; });
    });
    emit(kept, "person.updated", userId);
    res.json({ person: projectPerson(kept) });
  });
  // The one moment that matters (founder 11-09, three stages): 是的 settles on this person and puts the others away; 还没有
  // only keeps Pinky from asking again for a while.
  router.post("/people/:id/choose", async (req, res) => {
    const userId = req.auth.user.id;
    const chosen = await store.transaction(`user:${userId}`, async (tx) => {
      await owned(tx, req.params.id, userId);
      return req.body?.chosen === false ? markAsked(tx, userId, req.params.id) : choose(tx, userId, req.params.id);
    });
    emit(chosen, "person.updated", userId);
    res.json({ ...await publicStage(store, userId), person: projectPerson(chosen) });
  });
  // Not the one after all: the people put away for them come back.
  router.post("/people/unchoose", async (req, res) => {
    const userId = req.auth.user.id;
    await store.transaction(`user:${userId}`, (tx) => unchoose(tx, userId));
    res.json(await publicStage(store, userId));
  });
  router.post("/people/:id/archive", async (req, res) => {
    const userId = req.auth.user.id, archived = req.body?.archived !== false;
    const updated = await store.transaction(`user:${userId}`, async (tx) => {
      await owned(tx, req.params.id, userId);
      return tx.updateRelationshipRecordForUser("memories", req.params.id, userId, (draft) => { draft.archivedAt = archived ? new Date().toISOString() : null; draft.status = "active"; draft.version += 1; });
    });
    emit(updated, "person.updated", userId);
    res.json({ person: projectPerson(updated) });
  });
  router.use((error, _req, res, next) => error.statusCode ? res.status(error.statusCode).json({ error: error.message }) : next(error));
  return router;
}
