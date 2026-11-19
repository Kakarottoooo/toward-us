import { createHash } from "node:crypto";
import { membershipFor } from "./membership.mjs";
import { createRelationshipRecord } from "./relationship-domain.mjs";

// File writes are serialized. In Postgres the outermost transaction must take this
// advisory lock before deciding a cap, consuming a claim or extending a membership.
export const REWARD_LOCK = "membership-rewards";
export const DAY_MS = 86_400_000;
export const rewardDigest = (...parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
export const rewardAuditId = (kind, key) => `grant:${rewardDigest("membership-grant", kind, key)}`;
export const privateReferral = (userId, fields) => createRelationshipRecord({
  relationshipId: null, userId, visibility: "private", aiAccessScope: "none", approvalPolicy: "owner", provenanceSource: "system", ...fields,
});

// Both records commit with the caller's eligibility decision. The audit survives
// account erasure with an opaque owner, while the account's entitlement is erased.
export async function grantMembershipDays(tx, { userId, source, days, key, kind, now = new Date(), details = {} }) {
  if (!["feedback", "referral"].includes(source) || !Number.isSafeInteger(days) || days < 1 || !key || !kind) throw new Error("Invalid membership reward.");
  const auditId = rewardAuditId(kind, key);
  const previous = await tx.getReferralById(auditId);
  if (previous) return { granted_days: 0, membership_until: previous.until };

  const plan = await membershipFor(tx, userId, { now });
  const start = Math.max(now.getTime(), Date.parse(plan.until) || 0);
  const until = new Date(start + days * DAY_MS).toISOString();
  const at = now.toISOString();
  const common = { source, until, rewardDays: days, rewardAt: at, rewardKind: kind, createdAt: at, updatedAt: at };
  await tx.createRelationshipRecord("purchases", privateReferral(userId, {
    id: `purchase:${auditId}`, externalId: auditId, kind: "membership", plan: source, ...common, provenanceSource: source,
  }));
  await tx.createRelationshipRecord("referrals", privateReferral(userId, {
    id: auditId, kind: "reward-audit", ...details, rewardKey: key, ...common,
  }));
  return { granted_days: days, membership_until: until };
}
