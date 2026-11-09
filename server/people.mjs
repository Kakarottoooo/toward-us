import express from "express";
import { createRelationshipRecord } from "./relationship-domain.mjs";

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

export const livePerson = (record, userId) => record?.kind === PERSON_KIND && record.ownerUserId === userId && record.status === "active" && !record.archivedAt && !record.deletedAt;

/** The people this member is getting to know, most recently seen first. */
export async function listPeople(db, userId, { archived = false } = {}) {
  const records = await db.listRelationshipRecordsForUser("memories", userId);
  return records.filter((record) => record?.kind === PERSON_KIND && record.ownerUserId === userId && !record.deletedAt && record.status !== "merged" && (archived || livePerson(record, userId)))
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
export const projectPerson = (record, facts = 0) => ({ id: record.id, version: record.version, name: record.name, aliases: record.aliases || [], archived: Boolean(record.archivedAt), lastSeenAt: record.lastSeenAt || record.updatedAt, facts });

/** 我的 TA 们: list, rename, merge two that are one person, archive. Every route works on the member's own records only. */
export function createPeopleRouter({ store, emit = () => {} }) {
  const router = express.Router();
  const fail = (status, message) => Object.assign(new Error(message), { statusCode: status });
  router.use("/people", (req, res, next) => req.auth ? next() : res.status(401).json({ error: "Please sign in." }));
  const owned = async (db, id, userId) => {
    const record = await db.getRelationshipRecordForUser("memories", id, userId);
    if (!record || record.kind !== PERSON_KIND || record.ownerUserId !== userId || record.deletedAt) throw fail(404, "Not found.");
    return record;
  };
  router.get("/people", async (req, res) => {
    const userId = req.auth.user.id;
    const records = await store.listRelationshipRecordsForUser("memories", userId);
    const counts = new Map();
    for (const record of records) if (record.kind === "profile" && record.ownerUserId === userId && record.status === "active" && !record.archivedAt && String(record.subjectUserId || "").startsWith("person:")) counts.set(personOf(record.subjectUserId), (counts.get(personOf(record.subjectUserId)) || 0) + 1);
    res.json({ people: (await listPeople(store, userId, { archived: req.query.archived === "1" })).map((person) => projectPerson(person, counts.get(person.id) || 0)) });
  });
  // One card: what Pinky keeps about this person, newest first, and what happened between them by date.
  router.get("/people/:id", async (req, res) => {
    const userId = req.auth.user.id, person = await owned(store, req.params.id, userId);
    const facts = (await store.listRelationshipRecordsForUser("memories", userId)).filter((record) => record.kind === "profile" && record.ownerUserId === userId && record.status === "active" && !record.archivedAt && record.subjectUserId === personSubject(person.id));
    const line = (record) => ({ id: record.id, version: record.version, category: record.category || "other", text: record.text, quote: record.evidence?.quote || null, updatedAt: record.updatedAt });
    res.json({ person: projectPerson(person, facts.length),
      facts: facts.filter((record) => record.category !== "history").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 40).map(line),
      history: facts.filter((record) => record.category === "history").sort((a, b) => String(b.text).localeCompare(String(a.text))).slice(0, 30).map(line) });
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
