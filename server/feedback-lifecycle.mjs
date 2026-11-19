import { createHash } from "node:crypto";
import { createRelationshipRecord } from "./relationship-domain.mjs";
import { attachmentBytes, feedbackError } from "./feedback-images.mjs";
import { workbenchContext } from "./feedback-context.mjs";
import { internalBearerStatus } from "./reminder-router.mjs";

export const STATUSES = ["received", "triaging", "reproducing", "fixing", "shipped", "needs_info", "suggestion", "wont_fix", "duplicate", "reopened"];
const legacy = { new: "received", seen: "triaging", planned: "fixing", fixed: "shipped", declined: "wont_fix" };
export const statusFor = (record) => STATUSES.includes(record.status) ? record.status : Object.hasOwn(legacy, record.status) ? legacy[record.status] : "received";
export const opaque = (prefix, ...parts) => createHash("sha256").update(JSON.stringify([prefix, ...parts])).digest("hex");
const missing = () => feedbackError(404, "feedback_not_found");
const publicUpdated = (row) => row.feedbackUpdatedAt || row.updatedAt;
const attachments = (row, internal = false) => (row.attachmentIds || row.photoIds || []).map((_, index) => ({
  index, content_type: "image/webp", url: `/api/${internal ? "internal/" : ""}feedback/${encodeURIComponent(row.id)}/attachments/${index}`,
}));

export function userView(row) {
  return { id: row.id, text: row.text, kind: row.kind, severity: row.severity, summary: row.summary,
    context: workbenchContext(row.context), photoIds: row.photoIds || [], attachments: attachments(row),
    status: statusFor(row), public_note: row.publicNote || "", unread: row.unread === true, createdAt: row.createdAt, updatedAt: publicUpdated(row) };
}

function inboxView(row) {
  const capturedReply = row.context?.report === "pinky" && row.context?.messageId;
  return { id: row.id, user_ref: opaque("ourever-feedback-user", row.ownerUserId),
    kind: row.kind || "other", severity: row.severity || null, summary: capturedReply ? "Reported Ourever reply" : row.summary || "",
    text: capturedReply ? "Reported Ourever reply" : row.text, status: statusFor(row), public_note: row.publicNote || "",
    context: workbenchContext(row.context), include_activity: row.includeActivity === true, activity: row.includeActivity === true ? row.activity || "" : null,
    attachments: attachments(row, true), duplicate_of: row.duplicateOf || null, fix_commit: row.fixCommit || null,
    created_at: row.createdAt, updated_at: row.updatedAt };
}

export async function ownedFeedback(store, userId, id) {
  const row = await store.getRelationshipRecordForUser("feedback", id, userId);
  if (!row || row.ownerUserId !== userId || row.visibility !== "private") throw missing();
  return row;
}

// Sending and deleting repeatedly must not reset the quota. Keep only the past day's timestamps, under the same user lock.
export async function consumeFeedbackQuota(tx, userId, now, { voice = false } = {}) {
  const id = (voice ? "feedback-voice-quota:" : "feedback-quota:") + userId;
  const at = now().getTime(), day = 86_400_000, burst = 600_000;
  const row = await tx.getRelationshipRecordForUser("accountSettings", id, userId);
  const times = (row?.times || []).filter((time) => time > at - (voice ? burst : day));
  const recent = times.filter((time) => time > at - burst);
  const until = Math.max(!voice && times.length >= 20 ? times[0] + day : 0, recent.length >= (voice ? 10 : 5) ? recent[0] + burst : 0);
  if (until > at) throw Object.assign(feedbackError(429, "feedback_rate_limited"), { retryAfter: Math.ceil((until - at) / 1000) });
  times.push(at);
  if (row) await tx.updateRelationshipRecordForUser("accountSettings", id, userId, (draft) => { draft.times = times; });
  else await tx.createRelationshipRecord("accountSettings", createRelationshipRecord({ id, userId, relationshipId: null, visibility: "private", aiAccessScope: "none", times }));
}

export async function sendAttachment(store, row, index, res) {
  const bytes = await attachmentBytes(store, row, index);
  res.set({ "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }).send(bytes);
}

function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw feedbackError(400, "invalid_since");
  return new Date(value).toISOString();
}

export function internalFeedbackRoutes(router, { store, adminToken, notify, now }) {
  router.use("/internal/feedback", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const status = internalBearerStatus(req, adminToken());
    if (status !== 200) return res.status(status).json({ error: status === 503 ? "metrics_admin_not_configured" : "unauthorized" });
    next();
  });
  router.get("/internal/feedback", async (req, res) => {
    const { status, since, limit = "100", after = "" } = req.query;
    if ((status !== undefined && !STATUSES.includes(status)) || !/^(?:[1-9]\d?|[1-4]\d{2}|500)$/.test(limit) || typeof after !== "string" || after.length > 160) throw feedbackError(400, "invalid_feedback_filter");
    const statuses = status ? [status, ...Object.keys(legacy).filter((key) => legacy[key] === status)] : null;
    const rows = await store.listFeedbackForInbox({ since: since === undefined ? "1970-01-01T00:00:00.000Z" : timestamp(since), after, statuses, limit: Number(limit) + 1 });
    const items = rows.slice(0, Number(limit)).map(inboxView);
    const last = items.at(-1);
    res.json({ items, next: rows.length > items.length ? { since: last.updated_at, after: last.id } : null });
  });
  router.get("/internal/feedback/:id/attachments/:n", async (req, res) => {
    const row = await store.getFeedbackForInbox(req.params.id);
    if (!row) throw missing();
    await sendAttachment(store, row, req.params.n, res);
  });
  router.post("/internal/feedback/:id/status", async (req, res) => {
    const body = req.body || {};
    if (!STATUSES.includes(body.status) || Object.keys(body).some((key) => !["status", "public_note", "duplicate_of", "fix_commit"].includes(key))
      || (body.public_note !== undefined && (typeof body.public_note !== "string" || body.public_note.length > 2000))
      || (body.fix_commit != null && (typeof body.fix_commit !== "string" || !/^[a-f\d]{7,40}$/i.test(body.fix_commit)))
      || (body.duplicate_of != null && (typeof body.duplicate_of !== "string" || !body.duplicate_of || body.duplicate_of.length > 160 || body.duplicate_of === req.params.id || body.status !== "duplicate")))
      throw feedbackError(400, "invalid_feedback_update");
    const initial = await store.getFeedbackForInbox(req.params.id);
    if (!initial) throw missing();
    const result = await store.transaction(`user:${initial.ownerUserId}`, async (tx) => {
      const row = await ownedFeedback(tx, initial.ownerUserId, initial.id);
      const changedStatus = statusFor(row) !== body.status;
      const publicNote = body.public_note ?? (changedStatus ? "" : row.publicNote || "");
      const duplicateOf = body.status === "duplicate" ? body.duplicate_of ?? row.duplicateOf ?? null : null;
      const fixCommit = body.fix_commit ?? (body.status === "reopened" ? null : row.fixCommit || null);
      if (duplicateOf && !(await tx.getFeedbackForInbox(duplicateOf))) throw feedbackError(400, "unknown_duplicate");
      const notifyUser = changedStatus || publicNote !== (row.publicNote || "");
      if (!notifyUser && duplicateOf === (row.duplicateOf || null) && fixCommit === (row.fixCommit || null)) return { row, notifyUser: false };
      const updated = await tx.updateRelationshipRecordForUser("feedback", row.id, row.ownerUserId, (draft) => {
        draft.status = body.status; draft.publicNote = publicNote; draft.duplicateOf = duplicateOf; draft.fixCommit = fixCommit;
        draft.feedbackUpdatedAt = new Date(Math.max(now().getTime(), Date.parse(publicUpdated(row)) + 1)).toISOString();
        draft.unread = notifyUser || row.unread === true; draft.version++;
      });
      return { row: updated, notifyUser };
    });
    if (result.notifyUser) {
      try {
        await notify?.(initial.ownerUserId, { body: { zh: "你的反馈有了新进展。", en: "There’s an update to your feedback.", es: "Hay novedades sobre tus comentarios." },
          url: "/?view=feedback", tag: "feedback-" + result.row.id + "-" + result.row.version });
      } catch { /* Durable unread state remains available when a push service is unavailable. */ }
    }
    res.json({ item: inboxView(result.row) });
  });
}
