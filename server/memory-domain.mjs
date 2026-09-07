import { createHash } from "node:crypto";

export function hasCurrentMemoryApprovals(record) {
  const members = [...new Set(record.memberUserIds || [])];
  return members.length === 2 && members.every((userId) => (record.approvals || []).some((approval) => approval.userId === userId && approval.version === record.version && !approval.withdrawnAt));
}

export function projectMemoryRecord(record, userId, relationshipId) {
  if (!record || record.deletedAt) return null;
  if (record.visibility === "private") return record.ownerUserId === userId && (!record.relationshipId || record.relationshipId === relationshipId) ? structuredClone(record) : null;
  if (!relationshipId || record.relationshipId !== relationshipId || !(record.memberUserIds || []).includes(userId)) return null;
  if (!["shared", "jointly_confirmed"].includes(record.visibility)) return null;
  // Shared objects contain only owner-confirmed text. Private source IDs and mood
  // never enter a shared object, even for its creator.
  const { privateSourceId, privateNotes, mood, ...projected } = structuredClone(record);
  return projected;
}

export function buildMemoryContext(records, { userId, relationshipId = null, scope }) {
  if (!["private", "joint"].includes(scope) || !userId) return { memories: [], references: [] };
  const now = Date.now();
  const memories = (Array.isArray(records) ? records : records?.memories || []).filter((record) => {
    if (!record.text || record.status !== "active" || record.archivedAt || record.withdrawnAt || record.deletedAt) return false;
    if (record.expiresAt && (!Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt) <= now)) return false;
    if (scope === "private" && record.visibility === "private") return record.ownerUserId === userId && record.aiAccessScope === "private" && (!record.relationshipId || record.relationshipId === relationshipId);
    return Boolean(relationshipId && record.relationshipId === relationshipId && record.visibility === "jointly_confirmed" && record.aiAccessScope === "joint" && (record.memberUserIds || []).includes(userId) && hasCurrentMemoryApprovals(record));
  }).map(({ id, text, version, provenance }) => ({ id, text, version, provenance: structuredClone(provenance || {}) }));
  return { memories, references: memories.map(({ id, version, provenance }) => ({ id, version, provenance })) };
}

export function sharePreview(record, text) {
  const digest = createHash("sha256").update(JSON.stringify([record.id, record.version, text])).digest("hex");
  return { sourceId: record.id, expectedVersion: record.version, text, digest, includesPrivateOriginal: false, includesMood: false };
}
