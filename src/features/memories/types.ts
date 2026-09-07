import type { Language } from "../../i18n";

export type MemoryRecord = {
  id: string; relationshipId: string | null; ownerUserId: string; visibility: string; aiAccessScope: string;
  kind: string; text: string; status: string; version: number; createdAt: string; updatedAt: string;
  archivedAt?: string | null; withdrawnAt?: string | null; expiresAt?: string | null; mood?: string | null;
  approvals?: Array<{ userId: string; version: number }>;
  provenance: { source: string; sourceType?: string; sourceId?: string; sourceVersion?: number; createdAt?: string; correctedAt?: string };
};
export type MemorySource = { type: "outcome_review"; id: string; version: number; createdAt: string; text: string };
export type WorkspaceProps = { language: Language; userId: string; relationshipId?: string | null; onChanged?: () => void | Promise<void> };
export type SharePreview = { sourceId: string; expectedVersion: number; text: string; digest: string };
