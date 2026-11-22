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
  // down): a memory in the couple's shared moments album that names the idea, which ticks its card for both of them. Undo is
  // the moment's own archive. Doing it again returns the memory already there.
  router.post("/spaces/moments/ideas/:number", async (req, res) => {
    const idea = Number(req.params.number), userId = req.auth.user.id;
    const context = await store.getRelationshipContext(userId);
    if (!Number.isInteger(idea) || idea < 1 || idea > 100) return res.status(400).json({ error: "Unknown idea." });
    if (!(context?.relationship.status === "active" && context.members.length === 2)) return res.status(409).json({ error: "pairing_required", code: "pairing_required" });
    await ensureMomentSpaces(store, userId);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.date || "")) ? req.body.date : new Date().toISOString().slice(0, 10);
    try {
      const { record, created } = await transact(req, async (tx) => {
        const album = (await tx.listRelationshipRecordsForUser("spaces", userId)).find((space) => space.system === MOMENTS && space.visibility === "shared" && space.relationshipId === context.relationship.id && !space.archivedAt);
        if (!album) throw Object.assign(new Error("Moments album not found."), { statusCode: 409 });
        const existing = (await tx.listRelationshipRecordsForUser("spaceItems", userId)).find((item) => item.spaceId === album.id && item.idea === idea && !item.archivedAt);
        if (existing) return { record: existing, created: false };
        return { record: await addSpaceItem(tx, { userId, space: album, title: String(req.body?.title || `#${idea}`), date, idea, source: "member" }), created: true };
      });
      if (created) announce(record, userId);
      res.status(created ? 201 : 200).json({ record });
    } catch (error) { res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Something went wrong." }); }
  });
  for (const action of ["edit", "archive", "restore"]) {
    router.post(`/space-items/:id/moment/${action}`, handle((tx, userId, req) =>
      changeMoment(tx, { userId, id: req.params.id, action, fields: req.body || {}, version: req.body?.version })));
  }
  return router;
}
