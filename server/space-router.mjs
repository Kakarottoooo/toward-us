import express from "express";
import { archiveSpaceRecord, ensureMomentSpaces, listSpaces, migrateLegacyLists, updateSpace, updateSpaceItem } from "./space-domain.mjs";

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
  router.patch("/spaces/:id", handle((tx, userId, req) => updateSpace(tx, { userId, id: req.params.id, fields: req.body || {} })));
  router.post("/spaces/:id/archive", handle((tx, userId, req) => archiveSpaceRecord(tx, { userId, collection: "spaces", id: req.params.id })));
  router.patch("/space-items/:id", handle((tx, userId, req) => updateSpaceItem(tx, { userId, id: req.params.id, fields: req.body || {} })));
  router.post("/space-items/:id/archive", handle((tx, userId, req) => archiveSpaceRecord(tx, { userId, collection: "spaceItems", id: req.params.id })));
  return router;
}
