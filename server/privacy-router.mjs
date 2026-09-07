import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import express from "express";
import { clearSessionCookie, hashPassword, normalizeEmail, validPassword, verifyPassword } from "./auth.mjs";
import { createRelationshipRecord, projectRecord } from "./relationship-domain.mjs";

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const local = (req, zh, en, es) => (req.body?.language || req.query.language || "zh") === "zh" ? zh : (req.body?.language || req.query.language) === "es" ? es : en;
const hiddenCollections = new Set(["accountSettings", "pushSubscriptions", "deliveryJobs", "deliveryPreferences"]);

export function createPrivacyRouter({ store, production = false, closeConnections = () => {} }) {
  const router = express.Router(); const attempts = new Map();
  const limited = (key) => {
    const now = Date.now(); const recent = (attempts.get(key) || []).filter((at) => at > now - 15 * 60_000);
    if (recent.length >= 6) return true;
    recent.push(now); attempts.set(key, recent);
    if (attempts.size > 5000) for (const [candidate, times] of attempts) if (times.every((at) => at < now - 15 * 60_000)) attempts.delete(candidate);
    return false;
  };
  const settings = async (userId, tx = store) => (await tx.getRelationshipRecordForUser("accountSettings", `account:${userId}`, userId)) || null;
  const updateSettings = async (userId, updater, tx = store) => {
    const current = await settings(userId, tx);
    if (current) return tx.updateRelationshipRecordForUser("accountSettings", current.id, userId, (record) => { updater(record); record.version += 1; });
    const record = createRelationshipRecord({ relationshipId: null, userId, visibility: "private", aiAccessScope: "none", privateRetentionDays: null });
    record.id = `account:${userId}`; updater(record); return tx.createRelationshipRecord("accountSettings", record);
  };
  const reauthenticate = async (req) => {
    if (limited(`reauth:${req.ip}:${req.auth.user.id}`)) throw fail(429, local(req, "尝试过多，请稍后再试。", "Too many attempts. Try later.", "Demasiados intentos. Inténtalo más tarde."));
    const user = await store.getUserById(req.auth.user.id);
    if (!user || !await verifyPassword(String(req.body?.password || ""), user.passwordHash)) throw fail(403, local(req, "请使用当前密码确认。", "Confirm with your current password.", "Confirma con tu contraseña actual."));
    attempts.delete(`reauth:${req.ip}:${req.auth.user.id}`);
  };
  const confirm = (req) => { if (req.body?.confirm !== true) throw fail(400, local(req, "请明确确认这项操作。", "Explicit confirmation is required.", "Se requiere una confirmación explícita.")); };
  const audit = async (tx, userId, eventType, extras = {}) => tx.createRelationshipRecord("consentEvents", createRelationshipRecord({ relationshipId: null, userId, visibility: "private", aiAccessScope: "none", eventType, status: "recorded", ...extras }));
  router.post("/auth/recover", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (limited(`recovery:${req.ip}`) || limited(`recovery-account:${email}`)) throw fail(429, local(req, "尝试过多，请稍后再试。", "Too many attempts. Try later.", "Demasiados intentos. Inténtalo más tarde."));
    if (!validPassword(req.body?.password)) throw fail(400, local(req, "新密码需要10–128个字符。", "Use 10–128 characters for the new password.", "Usa entre 10 y 128 caracteres para la nueva contraseña."));
    const user = await store.getUserByEmail(email);
    const result = user && await store.transaction(`user:${user.id}`, async (tx) => {
      const current = await settings(user.id, tx);
      const provided = hash(String(req.body?.recoveryCode || "").replace(/[\s-]/g, ""));
      const expected = current?.recoveryCodeHash || "0".repeat(64);
      if (!timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex")) || !current?.recoveryCodeHash) return false;
      await tx.updateUserPassword(user.id, await hashPassword(req.body.password));
      await tx.deleteUserSessions(user.id);
      await updateSettings(user.id, (record) => { delete record.recoveryCodeHash; record.recoveryUsedAt = new Date().toISOString(); }, tx);
      await audit(tx, user.id, "account.recovered"); return true;
    });
    if (!result) throw fail(401, local(req, "邮箱或恢复码不正确，或恢复码已被使用。", "Email or recovery code is invalid, or the code was already used.", "El correo o código es incorrecto, o el código ya se utilizó."));
    closeConnections([user.id]); clearSessionCookie(res, production); res.status(204).end();
  });
  router.use("/privacy", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    return req.auth ? next() : res.status(401).json({ error: local(req, "请先登录。", "Please sign in.", "Inicia sesión.") });
  });
  router.get("/privacy", async (req, res) => {
    const userId = req.auth.user.id; const current = await settings(userId); const snapshot = await store.getPrivacySnapshot(userId);
    const privateCount = Object.entries(snapshot.graph).filter(([collection]) => !hiddenCollections.has(collection) && collection !== "consentEvents").reduce((count, [, records]) => count + records.filter((record) => record.ownerUserId === userId && ["private", "private_surprise"].includes(record.visibility)).length, 0);
    res.json({ privateRetentionDays: current?.privateRetentionDays ?? null, recoveryEnabled: Boolean(current?.recoveryCodeHash), privateCount,
      relationships: snapshot.relationships,
      sharedSummaries: snapshot.graph.summaries.filter((record) => record.ownerUserId === userId).map(({ id, issueId, text, version, status, aiAccessScope, withdrawnAt }) => ({ id, issueId, text, version, status, aiAccessScope, withdrawnAt })),
      consentHistory: snapshot.graph.consentEvents.filter((record) => record.ownerUserId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50).map(({ eventType, createdAt, objectId, sourceVersion }) => ({ eventType, createdAt, objectId, sourceVersion })),
    });
  });
  router.patch("/privacy", async (req, res) => {
    const days = req.body?.privateRetentionDays;
    if (![null, 7, 30, 90, 365].includes(days)) throw fail(400, "Unsupported retention period.");
    confirm(req); await reauthenticate(req);
    await store.transaction(`user:${req.auth.user.id}`, async (tx) => {
      await updateSettings(req.auth.user.id, (record) => { record.privateRetentionDays = days; }, tx);
      await audit(tx, req.auth.user.id, "privacy.retention_changed", { privateRetentionDays: days });
    }); res.json({ privateRetentionDays: days });
  });
  router.post("/privacy/recovery-code", async (req, res) => {
    await reauthenticate(req); const code = randomBytes(24).toString("hex");
    await store.transaction(`user:${req.auth.user.id}`, async (tx) => {
      await updateSettings(req.auth.user.id, (record) => { record.recoveryCodeHash = hash(code); record.recoveryCreatedAt = new Date().toISOString(); }, tx);
      await audit(tx, req.auth.user.id, "account.recovery_code_rotated");
    });
    res.json({ recoveryCode: code.match(/.{1,8}/g).join("-"), shownOnce: true });
  });
  router.post("/privacy/export", async (req, res) => {
    await reauthenticate(req);
    const snapshot = await store.getPrivacySnapshot(req.auth.user.id);
    res.setHeader("Content-Disposition", 'attachment; filename="toward-us-export.json"');
    res.json(privacyExport(snapshot, req.auth.user));
  });
  router.post("/privacy/delete-private", async (req, res) => {
    confirm(req); await reauthenticate(req);
    const deleted = await store.transaction(`user:${req.auth.user.id}`, async (tx) => {
      const count = await tx.deletePrivateData(req.auth.user.id); await audit(tx, req.auth.user.id, "privacy.private_data_deleted"); return count;
    }); res.json({ deleted });
  });
  router.post("/privacy/leave", async (req, res) => {
    confirm(req); await reauthenticate(req); const ended = await store.leaveRelationship(req.auth.user.id);
    if (ended) closeConnections(ended.memberIds);
    await audit(store, req.auth.user.id, "relationship.left"); res.json({ ended: Boolean(ended) });
  });
  router.delete("/privacy/account", async (req, res) => {
    confirm(req); await reauthenticate(req);
    const context = await store.getRelationshipContext(req.auth.user.id);
    await store.deleteAccount(req.auth.user.id);
    closeConnections(context?.members.map((member) => member.userId) || [req.auth.user.id]);
    clearSessionCookie(res, production); res.status(204).end();
  });
  router.post("/privacy/summaries/:id/withdraw", async (req, res) => {
    confirm(req); const userId = req.auth.user.id;
    const current = await store.getRelationshipRecordForUser("summaries", req.params.id, userId);
    if (!current || current.ownerUserId !== userId) throw fail(404, "Shared summary not found.");
    await store.transaction(`relationship:${current.relationshipId}`, async (tx) => {
      const summary = await tx.getRelationshipRecordForUser("summaries", current.id, userId);
      if (summary.version !== Number(req.body.version)) throw fail(409, "The shared version changed. Refresh first.");
      await tx.updateRelationshipRecordForUser("summaries", summary.id, userId, (record) => { record.withdrawnAt = new Date().toISOString(); record.aiAccessScope = "none"; record.version += 1; });
      // Previously confirmed agreements stay intact; new options must use current consent.
      const snapshot = await tx.relationshipSnapshotForUser(userId);
      for (const proposal of snapshot.proposals.filter((record) => record.issueId === summary.issueId)) await tx.updateRelationshipRecordForUser("proposals", proposal.id, userId, (record) => { record.archivedAt = new Date().toISOString(); record.aiAccessScope = "none"; });
      await tx.updateRelationshipRecordForUser("issues", summary.issueId, userId, (record) => { record.sharedContext = ""; record.version += 1; });
      await audit(tx, userId, "summary.ai_access_withdrawn", { objectId: summary.id, sourceVersion: summary.version });
    }); res.json({ withdrawn: true });
  });
  return router;
}

export function privacyExport(snapshot, user) {
  const graph = Object.fromEntries(Object.entries(snapshot.graph).filter(([collection]) => !hiddenCollections.has(collection)).map(([collection, records]) => [collection, records.filter((record) => record.ownerUserId === user.id || ["shared", "jointly_confirmed", "revealed"].includes(record.visibility) || (record.visibility === "shareable_summary" && record.status === "confirmed")).map((record) => projectRecord(record, user.id)).filter(Boolean)]));
  const rooms = snapshot.rooms.map((room) => {
    const ownIds = new Set(room.participants.filter((person) => person.userId === user.id).map((person) => person.id));
    return { code: room.code, relationshipId: room.relationshipId, status: room.status, messages: room.messages.filter((message) => ownIds.has(message.participantId)), sharedAnalysis: room.status === "archived" ? room.analysis?.shared || null : null, createdAt: room.createdAt, archivedAt: room.archivedAt || null };
  });
  return { exportedAt: new Date().toISOString(), user: { id: user.id, name: user.name, email: user.email }, relationships: snapshot.relationships, graph, rooms };
}

export async function runPrivateRetention(store, now = new Date()) {
  let deleted = 0;
  for (const settings of await store.listRecordsForJob("accountSettings")) {
    if (![7, 30, 90, 365].includes(settings.privateRetentionDays)) continue;
    await store.transaction(`user:${settings.ownerUserId}`, async (tx) => {
      const cutoff = new Date(now.getTime() - settings.privateRetentionDays * 86400000).toISOString();
      for (const collection of ["privateAgentThreads", "memories", "checkins"]) {
        for (const record of await tx.listRelationshipRecordsForUser(collection, settings.ownerUserId)) if (record.ownerUserId === settings.ownerUserId && record.visibility === "private" && record.updatedAt < cutoff) {
          await tx.deleteRelationshipRecordForUser(collection, record.id, settings.ownerUserId); deleted += 1;
        }
      }
    });
  }
  return { deleted };
}
