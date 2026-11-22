import express from "express";
import { addSpaceItem, archiveSpaceRecord, changeMoment, ensureMomentSpaces, listSpaces, migrateLegacyLists, MOMENTS, updateSpaceItem } from "./space-domain.mjs";

// Pages only show spaces and make small changes; Pinky creates spaces and items from the conversation.
export function createSpaceRouter({ store, emit = () => {} }) {
  const router = express.Router();
  router.use(["/spaces", "/space-items"], (req, res, next) => req.auth ? next() : res.status(401).json({ error: "Please sign in." }));
  // Shared changes take the couple's lock; private ones only the person's own.
  const transact = async (req, action) => {
    const context = await store.getRelationshipContext(req.auth.user.id);
    const key = context?.relationship.status === "active" ? `relationship:${context.relationship.id}` : `user:${req.auth.user.id}`;
    return store.transaction(key, (tx) => action(tx, req.auth.user.id));
  };
  const announce = (record, userId) => emit(record, "space.updated", record.visibility === "private" ? userId : null);
  const handle = (run) => async (req, res) => {
    try { const record = await transact(req, (tx, userId) => run(tx, userId, req)); announce(record, req.auth.user.id); res.json({ record }); }
    catch (error) { res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Something went wrong." }); }
  };

  router.get("/spaces", async (req, res) => { await ensureMomentSpaces(store, req.auth.user.id); await migrateLegacyLists(store, req.auth.user.id); res.json({ spaces: await listSpaces(store, req.auth.user.id) }); });
  router.patch("/space-items/:id", handle((tx, userId, req) => updateSpaceItem(tx, { userId, id: req.params.id, fields: req.body || {} })));
  router.post("/space-items/:id/archive", handle((tx, userId, req) => archiveSpaceRecord(tx, { userId, collection: "spaceItems", id: req.params.id })));
  // "We did it" on one of the 100 little things, by hand (QA round 3: it used to need Ourever, so it failed with AI declined or
  // down): a memory in the couple's shared moments album that names the idea, which ticks its card for both of them. One
  // record for the couple: whoever taps second gets the memory already there. Undo is its own route so either of them can
  // take it back, and taking back what is already gone is fine (QA round 4: the partner's Undo failed, and a second Undo errored).
  const say = (req, zh, en, es) => { const language = req.body?.language || req.auth.user.language; return language === "en" ? en : language === "es" ? es : zh; };
  const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  // Today where the member is, when the phone says where; otherwise a day of slack for time zones ahead of UTC.
  const latestDay = (req) => {
    try { if (req.body?.timezone) return new Date().toLocaleDateString("en-CA", { timeZone: String(req.body.timezone) }); } catch { /* unknown zone: fall back */ }
    return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  };
  const ideaOf = (req, res) => {
    const idea = Number(req.params.number);
    if (!Number.isInteger(idea) || idea < 1 || idea > 100) { res.status(400).json({ error: "Unknown idea." }); return null; }
    return idea;
  };
  const sharedAlbum = async (tx, userId, relationshipId) => (await tx.listRelationshipRecordsForUser("spaces", userId)).find((space) => space.system === MOMENTS && space.visibility === "shared" && space.relationshipId === relationshipId && !space.archivedAt);
  router.post("/spaces/moments/ideas/:number", async (req, res) => {
    const idea = ideaOf(req, res), userId = req.auth.user.id;
    if (!idea) return;
    const context = await store.getRelationshipContext(userId);
    if (!(context?.relationship.status === "active" && context.members.length === 2)) return res.status(409).json({ error: "pairing_required", code: "pairing_required" });
    const latest = latestDay(req), date = req.body?.date ? String(req.body.date) : latest;
    if (!isDay(date)) return res.status(400).json({ error: say(req, "日期不对。", "That date doesn't work.", "Esa fecha no sirve.") });
    if (date > latest) return res.status(400).json({ error: say(req, "请选择今天或更早的日期。", "Pick today or an earlier date.", "Elige hoy o una fecha anterior.") });
    // Not before they got together, if they've said when; otherwise not before any plausible date.
    const since = (await store.listRelationshipRecordsForUser("milestones", userId)).find((item) => item.relationshipId === context.relationship.id && item.type === "relationship_started" && !item.archivedAt)?.date;
    const floor = isDay(String(since || "")) ? since : "1950-01-01";
    if (date < floor) return res.status(400).json({ error: say(req, `这一天在你们在一起（${floor}）之前。`, `That's before you got together (${floor}).`, `Eso es antes de que estuvieran juntos (${floor}).`) });
    await ensureMomentSpaces(store, userId);
    try {
      const { record, created } = await transact(req, async (tx) => {
        const album = await sharedAlbum(tx, userId, context.relationship.id);
        if (!album) throw Object.assign(new Error("Moments album not found."), { statusCode: 409 });
        const existing = (await tx.listRelationshipRecordsForUser("spaceItems", userId)).find((item) => item.spaceId === album.id && item.idea === idea && !item.archivedAt);
        if (existing) return { record: existing, created: false };
        return { record: await addSpaceItem(tx, { userId, space: album, title: String(req.body?.title || `#${idea}`), date, idea, source: "member" }), created: true };
      });
      if (created) announce(record, userId);
      res.status(created ? 201 : 200).json({ record });
    } catch (error) { res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Something went wrong." }); }
  });
  router.post("/spaces/moments/ideas/:number/undo", async (req, res) => {
    const idea = ideaOf(req, res), userId = req.auth.user.id, id = String(req.body?.id || "");
    if (!idea) return;
    const context = await store.getRelationshipContext(userId);
    if (!(context?.relationship.status === "active" && context.members.length === 2)) return res.status(409).json({ error: "pairing_required", code: "pairing_required" });
    try {
      const record = await transact(req, async (tx) => {
        const album = await sharedAlbum(tx, userId, context.relationship.id);
        const item = album && id ? await tx.getRelationshipRecordForUser("spaceItems", id, userId) : null;
        if (!item || item.spaceId !== album.id || item.idea !== idea || item.archivedAt) return null; // already undone
        const now = new Date().toISOString(), group = item.momentGroup;
        const items = group ? (await tx.listRelationshipRecordsForUser("spaceItems", userId)).filter((other) => other.spaceId === album.id && other.momentGroup === group && !other.archivedAt) : [item];
        let result = null;
        for (const each of items) {
          const updated = await tx.updateRelationshipRecordForUser("spaceItems", each.id, userId, (draft) => {
            draft.archivedAt = now; draft.status = "archived"; draft.version += 1;
            draft.provenance = { ...draft.provenance, editedByUserId: userId, editedAt: now };
          });
          if (each.id === item.id) result = updated;
        }
        return result;
      });
      if (record) announce(record, userId);
      res.json({ record });
    } catch (error) { res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Something went wrong." }); }
  });
  for (const action of ["edit", "archive", "restore"]) {
    router.post(`/space-items/:id/moment/${action}`, handle((tx, userId, req) =>
      changeMoment(tx, { userId, id: req.params.id, action, fields: req.body || {}, version: req.body?.version })));
  }
  return router;
}
