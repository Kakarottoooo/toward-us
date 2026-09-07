import express from "express";
import { createRelationshipRecord } from "./relationship-domain.mjs";
import { hasCurrentMemoryApprovals, projectMemoryRecord, sharePreview } from "./memory-domain.mjs";

export function createMemoryRouter({ store, emit = () => {} }) {
  const router = express.Router();
  router.use((req, res, next) => req.auth ? next() : res.status(401).json({ error: message(req, "请先登录。", "Please sign in.", "Inicia sesión.") }));

  router.get("/memories", list("memories"));
  router.post("/memories", async (req, res) => {
    const text = requiredText(req); const userId = req.auth.user.id;
    const memory = await transact(req, async (tx, context) => {
      const provenance = await sourceFor(tx, req);
      const record = createRelationshipRecord({ relationshipId: context?.relationship.id || null, userId, visibility: "private", aiAccessScope: req.body?.allowPrivateAI === true ? "private" : "none", text, kind: "memory", provenance, expiresAt: expiry(req.body?.expiresAt), approvals: [] });
      await tx.createRelationshipRecord("memories", record); await audit(tx, record, userId, "memory.created"); return record;
    });
    emit(memory, "memory.updated", userId); res.status(201).json({ memory });
  });

  router.patch("/memories/:id", async (req, res) => {
    const memory = await transact(req, async (tx, context) => {
      const current = await visible(tx, "memories", req.params.id, req, context); version(current, req);
      if (current.archivedAt) fail(req, 409, "已归档的记录不能修改。", "Archived memories cannot be edited.", "Los recuerdos archivados no se pueden editar.");
      const text = requiredText(req);
      const updated = await tx.updateRelationshipRecordForUser("memories", current.id, req.auth.user.id, (draft) => {
        draft.text = text; draft.version += 1; draft.approvals = []; draft.withdrawnAt = null;
        draft.provenance = { ...draft.provenance, correctedByUserId: req.auth.user.id, correctedAt: new Date().toISOString() };
        if (current.visibility === "private") draft.aiAccessScope = req.body?.allowPrivateAI === true ? "private" : "none";
        else { draft.visibility = "shared"; draft.status = "pending_confirmation"; draft.aiAccessScope = "none"; }
        if (Object.hasOwn(req.body || {}, "expiresAt")) draft.expiresAt = expiry(req.body.expiresAt);
      });
      await audit(tx, updated, req.auth.user.id, "memory.corrected"); return updated;
    });
    emit(memory, "memory.updated", memory.visibility === "private" ? req.auth.user.id : null); res.json({ memory });
  });

  for (const collection of ["memories", "checkins"]) router.delete(`/${collection}/:id`, async (req, res) => {
    const deleted = await transact(req, async (tx, context) => {
      const current = await visible(tx, collection, req.params.id, req, context); version(current, req);
      if (current.ownerUserId !== req.auth.user.id || current.visibility !== "private") fail(req, 403, "只能删除自己的私人原文；已经分享的内容仍可被对方查看。", "Only your private original can be deleted; shared text remains visible to your partner.", "Solo puedes borrar tu original privado; tu pareja aún puede ver el texto compartido.");
      await audit(tx, current, req.auth.user.id, `${current.kind}.deleted`); await tx.deleteRelationshipRecordForUser(collection, current.id, req.auth.user.id); return current;
    });
    emit(deleted, `${deleted.kind}.deleted`, req.auth.user.id); res.status(204).end();
  });

  router.post("/memories/:id/archive", async (req, res) => {
    const memory = await transact(req, async (tx, context) => {
      const current = await visible(tx, "memories", req.params.id, req, context); version(current, req);
      if (current.visibility !== "private" || current.ownerUserId !== req.auth.user.id) fail(req, 403, "只能归档自己的私人记忆。", "You can archive only your private memories.", "Solo puedes archivar tus recuerdos privados.");
      const updated = await tx.updateRelationshipRecordForUser("memories", current.id, req.auth.user.id, (draft) => { draft.status = "archived"; draft.archivedAt = new Date().toISOString(); draft.aiAccessScope = "none"; draft.version += 1; });
      await audit(tx, updated, req.auth.user.id, "memory.archived"); return updated;
    });
    emit(memory, "memory.updated", req.auth.user.id); res.json({ memory });
  });

  router.get("/memories/sources", async (req, res) => {
    const context = await activeContext(store, req.auth.user.id);
    const records = await store.listRelationshipRecordsForUser("outcomeResponses", req.auth.user.id);
    const sources = records.filter((item) => context && item.relationshipId === context.relationship.id && item.ownerUserId === req.auth.user.id && item.status === "submitted" && !item.archivedAt && !item.withdrawnAt).map((item) => ({ type: "outcome_review", id: item.id, version: item.version, outcomeId: item.outcomeId, createdAt: item.createdAt, text: [item.learnedPatternCandidate, item.effective, item.ineffective].filter(Boolean).join("\n") })).filter((item) => item.text);
    res.json({ sources });
  });

  router.get("/checkins", list("checkins"));
  router.post("/checkins", async (req, res) => {
    const text = requiredText(req); const userId = req.auth.user.id;
    const checkin = await transact(req, async (tx, context) => {
      const kind = ["checkin", "gratitude", "good_moment"].includes(req.body?.kind) ? req.body.kind : "checkin";
      const mood = ["low", "mixed", "okay", "good"].includes(req.body?.mood) ? req.body.mood : null;
      const record = createRelationshipRecord({ relationshipId: context?.relationship.id || null, userId, visibility: "private", aiAccessScope: "none", kind, text, mood, provenance: { source: "member", createdByUserId: userId, createdAt: new Date().toISOString() } });
      await tx.createRelationshipRecord("checkins", record); await audit(tx, record, userId, "checkin.created"); return record;
    });
    emit(checkin, "checkin.updated", userId); res.status(201).json({ checkin });
  });

  for (const collection of ["memories", "checkins"]) {
    router.post(`/${collection}/:id/share-preview`, async (req, res) => {
      const context = await requirePair(store, req);
      const current = await visible(store, collection, req.params.id, req, context); requirePrivateOwner(current, req);
      res.json({ preview: sharePreview(current, requiredText(req)) });
    });
    router.post(`/${collection}/:id/share`, async (req, res) => {
      const shared = await transact(req, async (tx, context) => {
        if (!context) fail(req, 409, "邀请伴侣加入后，才能共同分享。", "Invite your partner before sharing together.", "Invita a tu pareja antes de compartir.");
        const current = await visible(tx, collection, req.params.id, req, context); requirePrivateOwner(current, req); version(current, req);
        const text = requiredText(req); const preview = sharePreview(current, text);
        if (req.body?.confirm !== true || req.body?.digest !== preview.digest) fail(req, 409, "请先预览并确认这段确切的分享文本。", "Preview and confirm this exact text before sharing.", "Previsualiza y confirma este texto exacto antes de compartirlo.");
        const memberUserIds = context.members.map((member) => member.userId);
        const existing = (await tx.listRelationshipRecordsForUser(collection, req.auth.user.id)).find((item) => item.relationshipId === context.relationship.id && item.shareDigest === preview.digest && item.ownerUserId === req.auth.user.id);
        if (existing) return existing;
        const record = createRelationshipRecord({ relationshipId: context.relationship.id, userId: req.auth.user.id, visibility: "shared", aiAccessScope: "none", approvalPolicy: collection === "memories" ? "both" : "owner", status: collection === "memories" ? "pending_confirmation" : "active", kind: current.kind, text, memberUserIds, approvals: [], shareDigest: preview.digest, expiresAt: current.expiresAt || null, provenance: { source: "owner_confirmed_text", sourceType: current.provenance?.source || "member", createdByUserId: req.auth.user.id, createdAt: new Date().toISOString() } });
        await tx.createRelationshipRecord(collection, record); await audit(tx, record, req.auth.user.id, `${collection === "memories" ? "memory" : "checkin"}.shared`); return record;
      });
      emit(shared, `${collection === "memories" ? "memory" : "checkin"}.updated`); res.status(201).json({ [collection === "memories" ? "memory" : "checkin"]: shared });
    });
  }

  router.post("/memories/:id/approve", async (req, res) => {
    const memory = await transact(req, async (tx, context) => {
      const current = await visible(tx, "memories", req.params.id, req, context); version(current, req);
      if (!context || current.visibility === "private" || !["pending_confirmation", "active"].includes(current.status) || current.withdrawnAt || current.archivedAt || (current.expiresAt && Date.parse(current.expiresAt) <= Date.now())) fail(req, 409, "这个版本目前不能授权使用。请先修改或刷新。", "This version cannot be authorized now. Revise or refresh it first.", "Esta versión no puede autorizarse ahora. Revísala o actualízala primero.");
      if (req.body?.allowJointAI !== true) fail(req, 400, "确认此版本时，请明确允许共同 AI 使用。", "Explicitly allow joint AI use when confirming this version.", "Autoriza expresamente el uso de la IA compartida al confirmar esta versión.");
      const updated = await tx.updateRelationshipRecordForUser("memories", current.id, req.auth.user.id, (draft) => {
        draft.memberUserIds = context.members.map((member) => member.userId);
        draft.approvals = (draft.approvals || []).filter((approval) => approval.userId !== req.auth.user.id && approval.version === draft.version);
        draft.approvals.push({ userId: req.auth.user.id, version: draft.version, approvedAt: new Date().toISOString() });
        if (hasCurrentMemoryApprovals(draft)) { draft.status = "active"; draft.visibility = "jointly_confirmed"; draft.aiAccessScope = "joint"; }
      });
      await audit(tx, updated, req.auth.user.id, "memory.ai_approved"); return updated;
    });
    emit(memory, "memory.updated"); res.json({ memory });
  });

  router.post("/memories/:id/withdraw", async (req, res) => {
    const memory = await transact(req, async (tx, context) => {
      const current = await visible(tx, "memories", req.params.id, req, context); version(current, req);
      const updated = await tx.updateRelationshipRecordForUser("memories", current.id, req.auth.user.id, (draft) => {
        draft.aiAccessScope = "none"; draft.withdrawnAt = new Date().toISOString(); draft.withdrawnByUserId = req.auth.user.id; draft.approvals = []; draft.version += 1;
        if (draft.visibility !== "private") { draft.status = "withdrawn"; draft.visibility = "shared"; }
      });
      await audit(tx, updated, req.auth.user.id, "memory.ai_withdrawn"); return updated;
    });
    emit(memory, "memory.updated", memory.visibility === "private" ? req.auth.user.id : null); res.json({ memory });
  });

  function list(collection) { return async (req, res) => {
    const context = await activeContext(store, req.auth.user.id);
    const query = clean(req.query?.q, 120).toLocaleLowerCase();
    const records = (await store.listRelationshipRecordsForUser(collection, req.auth.user.id)).map((record) => projectMemoryRecord(record, req.auth.user.id, context?.relationship.id)).filter(Boolean).filter((record) => !query || record.text.toLocaleLowerCase().includes(query)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    res.json({ [collection]: records });
  }; }

  async function transact(req, action) {
    const context = await activeContext(store, req.auth.user.id);
    return store.transaction(context ? `relationship:${context.relationship.id}` : `user:${req.auth.user.id}`, async (tx) => {
      // Membership is checked again inside the same lock used by relationship exit.
      return action(tx, await activeContext(tx, req.auth.user.id));
    });
  }
  return router;
}

async function activeContext(store, userId) { const context = await store.getRelationshipContext(userId); return context?.relationship.status === "active" && context.members.length === 2 ? context : null; }
async function requirePair(store, req) { const context = await activeContext(store, req.auth.user.id); if (!context) fail(req, 409, "邀请伴侣加入后，才能共同分享。", "Invite your partner before sharing together.", "Invita a tu pareja antes de compartir."); return context; }
async function visible(store, collection, id, req, context) { const record = await store.getRelationshipRecordForUser(collection, id, req.auth.user.id); if (!projectMemoryRecord(record, req.auth.user.id, context?.relationship.id)) fail(req, 404, "没有找到这条记录。", "This record was not found.", "No se encontró este registro."); return record; }
function requirePrivateOwner(record, req) { if (record.visibility !== "private" || record.ownerUserId !== req.auth.user.id || record.archivedAt) fail(req, 404, "没有找到可分享的私人记录。", "No private record is available to share.", "No hay un registro privado para compartir."); }
function version(record, req) { if (!Number.isSafeInteger(req.body?.expectedVersion) || req.body.expectedVersion !== record.version) fail(req, 409, "记录已变化，请刷新后确认当前版本。", "This record changed. Refresh and confirm the current version.", "Este registro cambió. Actualiza y confirma la versión actual."); }
function requiredText(req) { const text = clean(req.body?.text, 2000); if (!text) fail(req, 400, "写下一句你希望留下的话。", "Write something you want to keep.", "Escribe algo que quieras guardar."); return text; }
function expiry(value) { if (!value) return null; const parsed = Date.parse(value); if (!Number.isFinite(parsed) || parsed <= Date.now()) throw Object.assign(new Error("Invalid future expiry date"), { statusCode: 400 }); return new Date(parsed).toISOString(); }
async function sourceFor(store, req) {
  const source = req.body?.source;
  if (!source || source.type === "member") return { source: "member", createdByUserId: req.auth.user.id, createdAt: new Date().toISOString() };
  if (source.type !== "outcome_review") fail(req, 400, "请选择有效来源。", "Choose a valid source.", "Elige una fuente válida.");
  const response = await store.getRelationshipRecordForUser("outcomeResponses", clean(source.id, 120), req.auth.user.id);
  if (!response || response.ownerUserId !== req.auth.user.id || response.version !== source.version || response.status !== "submitted" || response.archivedAt || response.withdrawnAt) fail(req, 404, "没有找到你已提交的这版复盘。", "Your submitted review version was not found.", "No se encontró esta versión de tu revisión enviada.");
  return { source: "outcome_review", sourceId: response.id, sourceVersion: response.version, outcomeId: response.outcomeId, createdByUserId: req.auth.user.id, createdAt: new Date().toISOString() };
}
async function audit(store, record, userId, eventType) { await store.createRelationshipRecord("consentEvents", createRelationshipRecord({ relationshipId: record.relationshipId, userId, visibility: "private", aiAccessScope: "none", status: "recorded", objectId: record.id, objectType: record.kind, eventType, sourceVersion: record.version })); }
const clean = (value, limit) => String(value || "").trim().replace(/\0/g, "").slice(0, limit);
const message = (req, zh, en, es) => req.body?.language === "en" || req.query?.language === "en" ? en : req.body?.language === "es" || req.query?.language === "es" ? es : zh;
function fail(req, statusCode, zh, en, es) { throw Object.assign(new Error(message(req, zh, en, es)), { statusCode }); }
