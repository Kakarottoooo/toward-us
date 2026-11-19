import { feedbackError } from "./feedback-images.mjs";
import { opaque, statusFor, timestamp } from "./feedback-lifecycle.mjs";
import { forgetPurchases, membershipFor } from "./membership.mjs";
import { grantMembershipDays, privateReferral, REWARD_LOCK, rewardAuditId } from "./reward-ledger.mjs";

const KIND = "feedback_fixed";
const DAYS = 3;
const DUPLICATE_DAYS = 1;
const MONTHLY_MAX = 10;
const userRef = (id) => opaque("ourever-feedback-user", id);
const feedbackAudit = (row) => row.kind === "reward-audit" && row.source === "feedback" && row.rewardKind === KIND;
const findGrant = (store, id) => store.getReferralById(rewardAuditId(KIND, id));

const ineligible = (strict, code) => { if (strict) throw feedbackError(409, code); return null; };

// Called with REWARD_LOCK held. Explicit workbench calls validate the requested amount.
// Status updates may legitimately arrive before the canonical fix and leave the item pending.
async function settleOne(tx, item, now, requestedDays, strict) {
  const userId = item.ownerUserId;
  const previous = await findGrant(tx, item.id);
  if (previous) {
    if (strict && previous.clusterId !== item.id && requestedDays === DAYS) throw feedbackError(409, "feedback_duplicate_days");
    return { granted_days: 0, membership_until: previous.until };
  }
  const owner = await tx.getUserForUpdate(userId);
  if (!owner || owner.passwordHash === "deleted") {
    if (strict) throw feedbackError(404, "feedback_not_found");
    return null;
  }
  const cappedId = "feedback-cap:" + opaque(KIND, item.id);
  const capped = await tx.getReferralById(cappedId);
  if (capped) return { granted_days: 0, membership_until: capped.until };
  const current = await tx.getFeedbackForInbox(item.id);
  const eligibleState = (record) => record?.kind === "bug" && !record.rewardExclusion && ["shipped", "duplicate"].includes(statusFor(record));
  if (!eligibleState(current)) return ineligible(strict, "feedback_not_eligible");
  const parent = current.rewardClusterId || current.duplicateOf;
  const parentReward = parent && await findGrant(tx, parent);
  if ((parent || statusFor(current) === "duplicate") && !parentReward) return ineligible(strict, "feedback_cluster_not_rewarded");
  if (parentReward && requestedDays === DAYS) return ineligible(strict, "feedback_duplicate_days");
  const days = parentReward ? DUPLICATE_DAYS : requestedDays || DAYS;
  // A user's reopen or deletion can race a workbench callback. Decide under the feedback row lock.
  let receipt = null;
  const row = await tx.updateRelationshipRecordForUser("feedback", item.id, userId, async (draft) => {
    if (!eligibleState(draft)) return ineligible(strict, "feedback_not_eligible");
    const month = now.toISOString().slice(0, 7);
    const ownRecords = await tx.listRelationshipRecordsForUser("referrals", userId);
    const count = ownRecords.filter((entry) => feedbackAudit(entry) && entry.ownerUserId === userId && entry.rewardAt.startsWith(month)).length;
    if (count >= MONTHLY_MAX) {
      receipt = { granted_days: 0, membership_until: (await membershipFor(tx, userId, { now })).until };
      draft.feedbackReward = { ...receipt, capped: true };
      await tx.createRelationshipRecord("referrals", privateReferral(userId, { id: cappedId, kind: "feedback-capped", until: receipt.membership_until }));
    } else {
      receipt = await grantMembershipDays(tx, { userId, source: "feedback", days, key: draft.id, kind: KIND, now,
        details: { feedbackId: draft.id, feedbackRef: userRef(userId), clusterId: parentReward?.clusterId || draft.id } });
      draft.feedbackReward = receipt;
    }
    draft.feedbackUpdatedAt = new Date(Math.max(now.getTime(), Date.parse(draft.feedbackUpdatedAt || draft.updatedAt) + 1)).toISOString();
    draft.unread = true;
    draft.version++;
  });
  if (!row && strict) throw feedbackError(404, "feedback_not_found");
  return receipt;
}

export async function settleFeedbackReward(tx, item, now, requestedDays, strict = false) {
  const receipt = await settleOne(tx, item, now, requestedDays, strict);
  if (!receipt?.granted_days) return receipt;
  // Duplicates can reach the workbench before the main fix. Walk only still-unrewarded children.
  const queue = [item.id];
  const seen = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    for (const duplicate of await tx.listFeedbackRewardDependents(queue[i])) {
      if (seen.has(duplicate.id)) continue;
      seen.add(duplicate.id);
      const grant = await settleOne(tx, duplicate, now, DUPLICATE_DAYS, false);
      if (grant?.granted_days) queue.push(duplicate.id);
    }
  }
  return receipt;
}

// Mounted after the metrics-bearer middleware shared with /internal/feedback.
export function feedbackRewardRoutes(router, { store, now }) {
  router.post("/internal/rewards", async (req, res) => {
    const body = req.body;
    if (body?.kind !== KIND || ![DAYS, DUPLICATE_DAYS].includes(body.days)
      || typeof body.user_ref !== "string" || !/^[a-f\d]{64}$/.test(body.user_ref)
      || typeof body.feedback_id !== "string" || !body.feedback_id.length || body.feedback_id.length > 160) throw feedbackError(400, "invalid_feedback_reward");
    const result = await store.transaction(REWARD_LOCK, async (tx) => {
      const item = await tx.getFeedbackForInbox(body.feedback_id);
      if (!item) {
        const previous = await findGrant(tx, body.feedback_id);
        if (previous?.feedbackRef === body.user_ref) return { granted_days: 0, membership_until: previous.until };
      }
      if (!item || userRef(item.ownerUserId) !== body.user_ref) throw feedbackError(404, "feedback_not_found");
      return settleFeedbackReward(tx, item, now(), body.days, true);
    });
    if (result.granted_days) forgetPurchases(store);
    res.json(result);
  });
  router.get("/internal/rewards", async (req, res) => {
    const { limit = "100", after = "", since } = req.query;
    if (!/^(?:[1-9]\d?|[1-4]\d{2}|500)$/.test(limit) || typeof after !== "string" || after.length > 160) {
      throw feedbackError(400, "invalid_reward_filter");
    }
    const start = since === undefined ? "1970-01-01T00:00:00.000Z" : timestamp(since);
    const rows = (await store.listRecordsForJob("referrals")).filter(feedbackAudit)
      .filter((row) => row.rewardAt > start || (row.rewardAt === start && row.feedbackId > after))
      .sort((a, b) => a.rewardAt.localeCompare(b.rewardAt) || (a.feedbackId < b.feedbackId ? -1 : 1));
    const items = rows.slice(0, Number(limit)).map((row) => ({
      kind: KIND, feedback_id: row.feedbackId, user_ref: row.feedbackRef,
      granted_days: row.rewardDays, membership_until: row.until, granted_at: row.rewardAt,
    }));
    const last = items.at(-1);
    res.json({ items, next: rows.length > items.length ? { since: last.granted_at, after: last.feedback_id } : null });
  });
}
