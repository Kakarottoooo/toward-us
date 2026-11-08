import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { rm } from "node:fs/promises";
import express from "express";
import { photoFile } from "./photo-store.mjs";
import { importFile } from "./chat-import.mjs";
import { clearSessionCookie, hashPassword, normalizeEmail, validEmail, validPassword, verifyPassword } from "./auth.mjs";
import { canViewRecord, createRelationshipRecord, hideUnrevealedAnswers, projectRecord } from "./relationship-domain.mjs";
import { createEmailSender } from "./email.mjs";

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const local = (req, zh, en, es) => (req.body?.language || req.query.language || "zh") === "zh" ? zh : (req.body?.language || req.query.language) === "es" ? es : en;
const hiddenCollections = new Set(["accountSettings", "pushSubscriptions", "deliveryJobs", "deliveryPreferences", "productEvents", "nativePushDevices", "aiUsage"]);

export function createPrivacyRouter({ store, production = false, closeConnections = () => {}, email = createEmailSender() }) {
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
  const reauthenticate = async (req, tx) => {
    if (limited(`reauth:${req.ip}:${req.auth.user.id}`)) throw fail(429, local(req, "尝试过多，请稍后再试。", "Too many attempts. Try later.", "Demasiados intentos. Inténtalo más tarde."));
    const user = await tx.getUserForUpdate(req.auth.user.id);
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
      const liveUser = await tx.getUserForUpdate(user.id); if (!liveUser || liveUser.email !== email || liveUser.passwordHash === "deleted") return false;
      const current = await settings(user.id, tx);
      const provided = hash(String(req.body?.recoveryCode || "").replace(/[\s-]/g, ""));
      const expected = current?.recoveryCodeHash || "0".repeat(64);
      if (!timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex")) || !current?.recoveryCodeHash) return false;
      await tx.updateUserPassword(user.id, await hashPassword(req.body.password));
      await tx.deleteUserSessions(user.id);
      await updateSettings(user.id, (record) => { delete record.recoveryCodeHash; delete record.widgetToken; record.recoveryUsedAt = new Date().toISOString(); }, tx);
      await audit(tx, user.id, "account.recovered"); return true;
    });
    if (!result) throw fail(401, local(req, "邮箱或恢复码不正确，或恢复码已被使用。", "Email or recovery code is invalid, or the code was already used.", "El correo o código es incorrecto, o el código ya se utilizó."));
    closeConnections([user.id]); clearSessionCookie(res, production); res.status(204).end();
  });
  // Password reset by email. The token is "<userId>.<secret>"; only sha256(secret) is stored, on the owner's private accountSettings record.
  const RESET_TTL_MS = 30 * 60_000; const resetRequests = new Map();
  const resetLimited = (key, max) => {
    const now = Date.now(); const recent = (resetRequests.get(key) || []).filter((at) => at > now - 3_600_000);
    const over = recent.length >= max; if (!over) recent.push(now); resetRequests.set(key, recent);
    if (resetRequests.size > 5000) for (const [candidate, times] of resetRequests) if (times.every((at) => at < now - 3_600_000)) resetRequests.delete(candidate);
    return over;
  };
  const resetMessage = (language, link) => language === "es"
    ? { subject: "Restablece tu contraseña de Pinky", text: `Usa este enlace para elegir una nueva contraseña. Funciona durante 30 minutos y solo una vez.\n\n${link}\n\nSi no lo pediste, ignora este correo: tu contraseña no cambiará.` }
    : language === "en"
      ? { subject: "Reset your Pinky password", text: `Use this link to choose a new password. It works for 30 minutes and only once.\n\n${link}\n\nIf you did not ask for this, ignore this email; your password will not change.` }
      : { subject: "重设你的 Pinky 密码", text: `用这个链接设置新密码。链接 30 分钟内有效，且只能使用一次。\n\n${link}\n\n如果不是你本人操作，请忽略这封邮件，你的密码不会改变。` };
  router.post("/auth/reset-request", async (req, res) => {
    const address = normalizeEmail(req.body?.email);
    // Both counters always advance (non-short-circuit) and every outcome is the same 200, so limits reveal nothing about accounts.
    const tooMany = resetLimited(`ip:${req.ip}`, 20) | resetLimited(`email:${address}`, 3);
    const user = !tooMany && validEmail(address) ? await store.getUserByEmail(address) : null;
    if (user && user.email === address && user.passwordHash !== "deleted") {
      // Never build the link from a client-supplied Host in production (host-header poisoning): require TOWARD_US_BASE_URL there.
      const base = String(process.env.TOWARD_US_BASE_URL || (production ? "" : `${req.protocol}://${req.get("host")}`)).replace(/\/+$/, "");
      if (!base) console.error("[email] password reset skipped: set TOWARD_US_BASE_URL");
      else {
        const secret = randomBytes(32).toString("base64url");
        await store.transaction(`user:${user.id}`, async (tx) => {
          const live = await tx.getUserForUpdate(user.id); if (!live || live.passwordHash === "deleted") return;
          await updateSettings(user.id, (record) => { record.passwordReset = { hash: hash(secret), expiresAt: new Date(Date.now() + RESET_TTL_MS).toISOString() }; }, tx);
        });
        const link = `${base}/?reset=${user.id}.${secret}`; const language = ["zh", "en", "es"].includes(req.body?.language) ? req.body.language : ["zh", "en", "es"].includes(user.language) ? user.language : "zh";
        // Not awaited: the response must not reveal, by timing, whether an email was sent.
        void Promise.resolve().then(() => email.send({ to: user.email, link, ...resetMessage(language, link) })).catch(() => console.error("[email] password reset delivery failed"));
      }
    }
    res.json({ ok: true });
  });
  router.post("/auth/reset", async (req, res) => {
    if (limited(`reset:${req.ip}`)) throw fail(429, local(req, "尝试过多，请稍后再试。", "Too many attempts. Try later.", "Demasiados intentos. Inténtalo más tarde."));
    if (!validPassword(req.body?.password)) throw fail(400, local(req, "新密码需要10–128个字符。", "Use 10–128 characters for the new password.", "Usa entre 10 y 128 caracteres para la nueva contraseña."));
    const invalid = () => fail(400, local(req, "这个重设链接无效或已过期，请重新申请。", "This reset link is invalid or has expired. Request a new one.", "Este enlace no es válido o ya caducó. Solicita uno nuevo."));
    const [userId, secret, ...extra] = String(req.body?.token || "").split(".");
    if (!userId || !secret || extra.length || userId.length > 80 || secret.length > 80) throw invalid();
    const done = await store.transaction(`user:${userId}`, async (tx) => {
      const liveUser = await tx.getUserForUpdate(userId); if (!liveUser || liveUser.passwordHash === "deleted") return false;
      const reset = (await settings(userId, tx))?.passwordReset;
      if (!reset?.hash || !reset.expiresAt || reset.expiresAt <= new Date().toISOString()) return false;
      if (!timingSafeEqual(Buffer.from(hash(secret), "hex"), Buffer.from(reset.hash, "hex"))) return false;
      await tx.updateUserPassword(userId, await hashPassword(req.body.password));
      await tx.deleteUserSessions(userId);
      await updateSettings(userId, (record) => { delete record.passwordReset; delete record.widgetToken; }, tx);
      await audit(tx, userId, "account.password_reset"); return true;
    });
    if (!done) throw invalid();
    closeConnections([userId]); clearSessionCookie(res, production); res.status(204).end();
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
      sharedSummaries: snapshot.graph.summaries.filter((record) => record.ownerUserId === userId).map(({ id, relationshipId, issueId, text, version, status, aiAccessScope, withdrawnAt }) => ({ id, relationshipId, issueId, text, version, status, aiAccessScope, withdrawnAt })),
      consentHistory: snapshot.graph.consentEvents.filter((record) => record.ownerUserId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50).map(({ eventType, createdAt, objectId, sourceVersion }) => ({ eventType, createdAt, objectId, sourceVersion })),
    });
  });
  // 「Pinky 能看到什么」(founder 11-07, trust you can see): counts of everything the AI can draw on for this member, in one
  // place, with nothing of its content. The partner's private material is never counted here: it is never theirs to see.
  router.get("/privacy/ai-access", async (req, res) => {
    const userId = req.auth.user.id;
    const snapshot = await store.relationshipSnapshotForUser(userId);
    const context = await store.getRelationshipContext(userId);
    const relationshipId = context?.relationship?.status === "active" ? context.relationship.id : null;
    const live = (collection) => (snapshot[collection] || []).filter((record) => !record.archivedAt && !record.withdrawnAt && canViewRecord(record, userId));
    const mine = (collection) => live(collection).filter((record) => record.ownerUserId === userId);
    const memories = live("memories"), own = memories.filter((record) => record.ownerUserId === userId && record.visibility === "private");
    const us = relationshipId ? (snapshot.togetherConversations || []).find((record) => record.relationshipId === relationshipId) : null;
    res.json({
      paired: Boolean(relationshipId),
      facts: { used: own.filter((record) => record.aiAccessScope !== "none").length, off: own.filter((record) => record.aiAccessScope === "none").length, together: memories.filter((record) => record.visibility !== "private").length },
      privateChat: mine("privateAgentThreads").filter((record) => record.intentType === "assistant").reduce((count, record) => count + (record.messages || []).length, 0),
      us: us ? (us.messages || []).length : 0,
      imports: mine("chatImports").length,
      photos: mine("photos").length,
      checkins: mine("checkins").length,
      reminders: mine("reminders").length,
      privateItems: mine("spaceItems").filter((record) => record.visibility === "private").length,
      sharedByYou: (snapshot.consentEvents || []).filter((record) => record.ownerUserId === userId).length,
    });
  });
  router.patch("/privacy", async (req, res) => {
    const days = req.body?.privateRetentionDays;
    if (![null, 7, 30, 90, 365].includes(days)) throw fail(400, "Unsupported retention period.");
    confirm(req);
    await store.transaction(`user:${req.auth.user.id}`, async (tx) => {
      await reauthenticate(req, tx);
      await updateSettings(req.auth.user.id, (record) => { record.privateRetentionDays = days; }, tx);
      await audit(tx, req.auth.user.id, "privacy.retention_changed", { privateRetentionDays: days });
    }); res.json({ privateRetentionDays: days });
  });
  router.post("/privacy/recovery-code", async (req, res) => {
    const code = randomBytes(24).toString("hex");
    await store.transaction(`user:${req.auth.user.id}`, async (tx) => {
      await reauthenticate(req, tx);
      await updateSettings(req.auth.user.id, (record) => { record.recoveryCodeHash = hash(code); record.recoveryCreatedAt = new Date().toISOString(); }, tx);
      await audit(tx, req.auth.user.id, "account.recovery_code_rotated");
    });
    res.json({ recoveryCode: code.match(/.{1,8}/g).join("-"), shownOnce: true });
  });
  router.post("/privacy/export", async (req, res) => {
    const snapshot = await store.transaction(`user:${req.auth.user.id}`, async (tx) => { await reauthenticate(req, tx); return tx.getPrivacySnapshot(req.auth.user.id); });
    res.setHeader("Content-Disposition", 'attachment; filename="pinky-export.json"');
    res.json(privacyExport(snapshot, req.auth.user));
  });
  // Private photos and imported chats keep their bytes in files beside the data; deleting the records deletes those too.
  const privateFiles = async (userId) => [
    ...(await store.listRelationshipRecordsForUser("photos", userId)).filter((record) => record.ownerUserId === userId && record.visibility === "private").map(photoFile),
    ...(await store.listRelationshipRecordsForUser("chatImports", userId)).filter((record) => record.ownerUserId === userId && record.visibility === "private").map(importFile),
  ];
  const removeFiles = (paths) => Promise.all(paths.map((path) => rm(path, { force: true }).catch(() => {})));
  router.post("/privacy/delete-private", async (req, res) => {
    confirm(req); const files = await privateFiles(req.auth.user.id);
    const deleted = await store.transaction(`user:${req.auth.user.id}`, async (tx) => {
      await reauthenticate(req, tx);
      const count = await tx.deletePrivateData(req.auth.user.id); await audit(tx, req.auth.user.id, "privacy.private_data_deleted"); return count;
    }); await removeFiles(files); res.json({ deleted });
  });
  router.post("/privacy/leave", async (req, res) => {
    confirm(req); const context = await store.getRelationshipContext(req.auth.user.id);
    const ended = await store.transaction(context ? `relationship:${context.relationship.id}` : `user:${req.auth.user.id}`, async (tx) => { await reauthenticate(req, tx); return tx.leaveRelationship(req.auth.user.id); });
    if (ended) closeConnections(ended.memberIds);
    await audit(store, req.auth.user.id, "relationship.left"); res.json({ ended: Boolean(ended) });
  });
  router.delete("/privacy/account", async (req, res) => {
    confirm(req); const files = await privateFiles(req.auth.user.id);
    const context = await store.getRelationshipContext(req.auth.user.id);
    await store.transaction(context ? `relationship:${context.relationship.id}` : `user:${req.auth.user.id}`, async (tx) => { await reauthenticate(req, tx); return tx.deleteAccount(req.auth.user.id); });
    await removeFiles(files);
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
  const graph = Object.fromEntries(Object.entries(snapshot.graph).filter(([collection]) => !hiddenCollections.has(collection)).map(([collection, records]) => [collection, records.filter((record) => record.ownerUserId === user.id || ["shared", "jointly_confirmed", "revealed"].includes(record.visibility) || (record.visibility === "shareable_summary" && record.status === "confirmed")).map((record) => { if (record.ownerUserId === user.id) return hideUnrevealedAnswers(structuredClone(record), user.id); const projected = projectRecord({ ...record, archivedAt: null, status: record.status === "archived" ? "active" : record.status }, user.id); return projected ? { ...projected, status: record.status, archivedAt: record.archivedAt } : null; }).filter(Boolean)]));
  const rooms = snapshot.rooms.map((room) => {
    const ownIds = new Set(room.participants.filter((person) => person.userId === user.id).map((person) => person.id));
    return { code: room.code, relationshipId: room.relationshipId, status: room.status, messages: room.messages.filter((message) => ownIds.has(message.participantId)), sharedAnalysis: room.status === "archived" ? room.analysis?.shared || null : null, createdAt: room.createdAt, archivedAt: room.archivedAt || null };
  });
  return { exportedAt: new Date().toISOString(), user: { id: user.id, name: user.name, email: user.email, phone: snapshot.phone || null }, relationships: snapshot.relationships, graph, rooms };
}

export async function runPrivateRetention(store, now = new Date()) {
  let deleted = 0;
  for (const settings of await store.listRecordsForJob("accountSettings")) {
    if (![7, 30, 90, 365].includes(settings.privateRetentionDays)) continue;
    await store.transaction(`user:${settings.ownerUserId}`, async (tx) => {
      const cutoff = new Date(now.getTime() - settings.privateRetentionDays * 86400000).toISOString();
      for (const collection of ["privateAgentThreads", "memories", "checkins"]) {
        for (const record of await tx.listRelationshipRecordsForUser(collection, settings.ownerUserId)) if (record.ownerUserId === settings.ownerUserId && record.visibility === "private" && record.updatedAt < cutoff) {
          // A sealed letter waits on its thread until its day (letters.mjs); that thread is kept until it has been delivered.
          if (Array.isArray(record.letters) && record.letters.some((letter) => !letter.deliveredAt)) continue;
          await tx.deleteRelationshipRecordForUser(collection, record.id, settings.ownerUserId); deleted += 1;
        }
      }
    });
  }
  return { deleted };
}
