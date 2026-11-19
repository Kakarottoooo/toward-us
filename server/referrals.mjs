import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { forgetPurchases } from "./membership.mjs";
import { DAY_MS, grantMembershipDays, privateReferral, REWARD_LOCK, rewardDigest } from "./reward-ledger.mjs";

const COLLECTION = "referrals";
const profileId = (id) => `referral-profile:${id}`;
const claimId = (id) => `referral-claim:${id}`;
const day = (value) => value.toISOString().slice(0, 10);
const positive = (key, fallback) => {
  const value = Number(process.env[key]);
  return Number.isSafeInteger(value) && value > 0 && value <= 3650 ? value : fallback;
};
const referralRules = () => ({
  calls: positive("REFERRAL_ACTIVATION_CALLS", 10), days: positive("REFERRAL_ACTIVATION_DAYS", 3),
  windowDays: positive("REFERRAL_WINDOW_DAYS", 30), rewardDays: positive("REFERRAL_REWARD_DAYS", 7),
  monthlyCap: positive("REFERRAL_MONTHLY_CAP", 5),
});
const deletionDays = () => positive("REFERRAL_EARLY_DELETION_DAYS", 7);
const disposableDomains = new Set(readFileSync(new URL("./referrals-disposable-domains.txt", import.meta.url), "utf8").split(/\s+/));
function disposable(email) {
  const parts = String(email).toLowerCase().split("@").pop().split(".");
  const extra = new Set((process.env.REFERRAL_DISPOSABLE_DOMAINS || "").toLowerCase().split(/[\s,]+/));
  return parts.some((_, i) => i < parts.length - 1 && (disposableDomains.has(parts.slice(i).join(".")) || extra.has(parts.slice(i).join("."))));
}
function emailRoot(email) {
  let [local, domain] = String(email).trim().toLowerCase().split("@");
  local = local.split("+")[0];
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replaceAll(".", "");
  return `${local}@${domain}`;
}
const live = (user) => Boolean(user && user.passwordHash !== "deleted" && !String(user.email).endsWith("@deleted.invalid"));
const initial = (user) => Array.from(String(user?.name || "").trim())[0]?.match(/[\p{Letter}]/u)?.[0]?.toLocaleUpperCase() || "•";
const installKey = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value) ? rewardDigest("referral-install", value) : null;
const denied = (reason) => ({ accepted: false, reason });
const load = (db, id) => db.getReferralById(id);
const add = (tx, userId, data) => tx.createRelationshipRecord(COLLECTION, privateReferral(userId, data));
const change = (tx, row, data) => tx.updateRelationshipRecordForUser(COLLECTION, row.id, row.ownerUserId, (draft) => { Object.assign(draft, data); draft.version += 1; });
const validCode = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{16}$/.test(value);
const activeMembers = (context, userId) => context?.relationship?.status === "active" ? context.members.map((m) => m.userId) : [userId];

async function ensureProfile(tx, userId, device) {
  const existing = await load(tx, profileId(userId));
  if (!existing) return add(tx, userId, { id: profileId(userId), kind: "profile", code: randomBytes(12).toString("base64url"), devices: device ? [device] : [] });
  if (device && existing.code && !existing.devices.includes(device)) return change(tx, existing, { devices: [...existing.devices, device] });
  return existing;
}

export async function rememberReferralInstall(store, userId, { installId } = {}) {
  const device = installKey(installId);
  if (!device) return;
  const existing = await load(store, profileId(userId));
  if (existing?.devices.includes(device)) return;
  await store.transaction(REWARD_LOCK, (tx) => ensureProfile(tx, userId, device));
}

export async function referralPreview(store, code, { installId, now = new Date() } = {}) {
  if (!validCode(code)) return null;
  const profile = await store.getReferralByCode(code);
  if (!profile) return null;
  const user = await store.getUserById(profile.ownerUserId);
  if (!live(user)) return null;
  const device = installKey(installId);
  if (device && !profile.devices.includes(device)) {
    const id = `referral-open:${rewardDigest(profile.id, device)}`;
    if (!await load(store, id)) await store.transaction(REWARD_LOCK, async (tx) => {
      if (!await load(tx, id)) await add(tx, profile.ownerUserId, { id, kind: "open", openedAt: now.toISOString() });
    });
  }
  return { initial: initial(user), rules: referralRules() };
}

// Compare only provider-verified identities already retained by the product.
// Apple supplies an original transaction ID; an Apple ID is never exposed.
async function paymentKeys(db, userId) {
  const rows = await db.listRelationshipRecordsForUser("purchases", userId);
  return rows.filter((r) => r.ownerUserId === userId).flatMap((r) =>
    r.source === "stripe" && typeof r.customer === "string" ? [`stripe:${r.customer}`] :
    r.source === "apple" && r.externalId ? [r.externalId] : []);
}
async function exclusion(tx, inviterProfile, inviteeProfile, members) {
  const inviterId = inviterProfile.ownerUserId;
  if (members.includes(inviterId)) return "self_invite";
  const inviter = await tx.getUserById(inviterId);
  if (!live(inviter)) return "invalid_code";
  if (disposable(inviter.email)) return "disposable_email";
  const payer = new Set(await paymentKeys(tx, inviterId));
  for (const id of members) {
    const user = await tx.getUserById(id);
    if (!live(user)) return "account_ineligible";
    if (emailRoot(user.email) === emailRoot(inviter.email)) return "self_invite";
    if (disposable(user.email)) return "disposable_email";
    const profile = id === inviteeProfile.ownerUserId ? inviteeProfile : await load(tx, profileId(id));
    if (profile?.devices.some((device) => inviterProfile.devices.includes(device))) return "same_device";
    if (payer.size && (await paymentKeys(tx, id)).some((value) => payer.has(value))) return "same_payment";
  }
  return null;
}

// Called only inside successful new-account registration. A rejected referral
// leaves the existing signup transaction free to complete normally.
export async function attachReferral(store, userId, { code, installId, now = new Date() } = {}) {
  const device = installKey(installId);
  if (!validCode(code)) return denied("invalid_code");
  if (!device) return denied("install_required");
  return store.transaction(REWARD_LOCK, async (tx) => {
    const inviter = await tx.getReferralByCode(code);
    if (!inviter?.devices.length) return denied("invalid_code");
    const user = await tx.getUserById(userId);
    if (!live(user)) return denied("account_ineligible");
    const invitee = await ensureProfile(tx, userId, device);
    const reason = await exclusion(tx, inviter, invitee, [userId]);
    if (reason) return denied(reason);
    if (await load(tx, claimId(userId))) return denied("already_invited");
    if (await load(tx, `referral-device:${device}`)) return denied("device_rewarded");
    const rules = referralRules();
    await add(tx, userId, {
      id: claimId(userId), kind: "claim", status: "registered", inviterId: inviter.ownerUserId, device,
      signupAt: user.createdAt || now.toISOString(), rules, events: {}, activeDays: 0,
    });
    return { accepted: true };
  });
}

// Successful provider calls only. Keep this allowlist explicit: newly added
// background tasks, moderation and internal answer checks cannot qualify by default.
// A realtime handshake or a duration receipt alone does not prove anyone spoke.
// Completed transcriptions and delegated conversational turns count on their own receipts.
const INTERACTIVE = new Set(["assistant_turn", "together_turn", "together_mediation", "private_agent", "perspective_summary",
  "decision_options", "decision_discussion", "web_lookup", "demo_analysis", "demo_answer", "transcription", "feedback_voice"]);
export const isReferralAiCall = (row) => row.outcome === "ok" && Boolean(row.provider) && row.provider !== "none" && INTERACTIVE.has(row.feature);
const pending = (r) => r?.status === "registered" && !r.deletedAt;
const cutoff = (claim) => Date.parse(claim.signupAt) + claim.rules.windowDays * DAY_MS;
const monthCount = (claims, at) => claims.filter((c) => !c.earlyDeleted && c.inviterGrantedAt?.slice(0, 7) === at.slice(0, 7)).length;
const sameTimeOrAfter = (a, b) => Date.parse(a) >= Date.parse(b);

async function candidates(db, userId) {
  const context = await db.getRelationshipContext(userId);
  const members = activeMembers(context, userId);
  const claims = [];
  for (const member of members) {
    const claim = await load(db, claimId(member));
    if (pending(claim)) claims.push(claim);
  }
  claims.sort((a, b) => a.signupAt.localeCompare(b.signupAt) || a.id.localeCompare(b.id));
  return { context, members, claims };
}

function eligibleEntry(claim, entry, context) {
  const time = Date.parse(entry.at);
  if (!entry.id || !(time >= Date.parse(claim.signupAt) && time < cutoff(claim))) return false;
  if (entry.ownerUserId === claim.ownerUserId) return true;
  if (context?.relationship?.status !== "active" || entry.spaceId !== context.relationship.id) return false;
  return [entry.ownerUserId, claim.ownerUserId].every((id) => {
    const member = context.members.find((person) => person.userId === id);
    return member && sameTimeOrAfter(entry.at, member.joinedAt);
  });
}

async function activate(tx, claim, members, at) {
  const inviterId = claim.inviterId, inviteeId = claim.ownerUserId;
  const inviter = await load(tx, profileId(inviterId)), invitee = await load(tx, profileId(inviteeId));
  let reason = !inviter?.code || !invitee?.code ? "account_ineligible" : await exclusion(tx, inviter, invitee, members);
  const devices = new Set([claim.device]);
  const markerIds = members.map((id) => `referral-member:${rewardDigest(id)}`);
  for (const id of members) {
    const profile = await load(tx, profileId(id));
    for (const device of profile?.devices || []) devices.add(device);
  }
  for (const device of devices) markerIds.push(`referral-device:${device}`);
  if (!reason) for (const id of markerIds) {
    if (await load(tx, id)) { reason = "already_rewarded"; break; }
  }
  if (reason) {
    await change(tx, claim, { status: "ineligible", reason, events: {} });
    return false;
  }
  const { monthlyCap, rewardDays } = referralRules();
  const utc = at.toISOString();
  const count = monthCount(await tx.listReferralClaims(inviterId), utc);
  const capped = count >= monthlyCap;
  // A new friend still earns their own reward when the inviter has reached their monthly cap.
  const common = { source: "referral", days: claim.rules.rewardDays ?? rewardDays, key: claim.id, now: at };
  await grantMembershipDays(tx, { ...common, userId: inviteeId, kind: "referral_invitee" });
  if (!capped) await grantMembershipDays(tx, { ...common, userId: inviterId, kind: "referral_inviter" });
  for (const id of markerIds) await add(tx, inviteeId, { id, kind: "claimed-identity" });
  await change(tx, claim, {
    status: "activated", activeDays: claim.rules.days, activatedAt: utc, inviterGrantedAt: capped ? null : utc, capped, events: {},
  });
  return true;
}

async function advance(tx, userId, entries, at) {
  const { context, members, claims } = await candidates(tx, userId);
  for (const claim of claims) {
    if (members.includes(claim.inviterId)) {
      await change(tx, claim, { status: "ineligible", reason: "self_invite", events: {} });
      continue;
    }
    const events = structuredClone(claim.events);
    let dirty = false;
    let matched = false;
    for (const entry of entries) {
      if (!eligibleEntry(claim, entry, context)) continue;
      matched = true;
      const date = entry.at.slice(0, 10), ids = events[date] ||= [];
      // Keeping at most the required call count per day bounds pending state.
      if (ids.length < claim.rules.calls && !ids.includes(entry.id)) { ids.push(entry.id); dirty = true; }
    }
    if (!dirty) {
      if (matched) return false;
      continue;
    }
    const activeDays = Object.keys(events).length;
    const calls = Object.values(events).reduce((count, ids) => count + ids.length, 0);
    if (activeDays < claim.rules.days || calls < claim.rules.calls) {
      await change(tx, claim, { events, activeDays });
      // While two new users are paired, their first eligible referral owns the couple's usage.
      return false;
    }
    if (await activate(tx, claim, members, at)) {
      for (const other of claims.filter((r) => r.id !== claim.id)) await change(tx, other, { status: "ineligible", reason: "couple_rewarded", events: {} });
      return true;
    }
  }
  return false;
}

export async function recordReferralUse(store, userId, { now = new Date(), eventId, spaceId } = {}) {
  if (!eventId || !userId) return;
  const claims = spaceId ? (await candidates(store, userId)).claims : [await load(store, claimId(userId))];
  if (!claims.some((claim) => pending(claim) && now.getTime() < cutoff(claim))) return;
  const entry = { id: eventId, ownerUserId: userId, at: now.toISOString(), spaceId };
  if (await store.transaction(REWARD_LOCK, (tx) => advance(tx, userId, [entry], now))) forgetPurchases(store);
}

// Covers a process exiting after the provider ledger commits and before the
// reward transaction. Read only this pending household's bounded signup window.
async function reconcile(store, userId, now) {
  const { claims, members } = await candidates(store, userId);
  if (!claims.length) return;
  const from = claims[0].signupAt;
  const to = new Date(Math.min(now.getTime() + 1, Math.max(...claims.map(cutoff)))).toISOString();
  if (from >= to) return;
  const entries = [];
  for (const id of members) {
    entries.push(...(await store.listReferralAiCalls(id, from, to)).filter(isReferralAiCall));
  }
  if (entries.length && await store.transaction(REWARD_LOCK, (tx) => advance(tx, userId, entries, now))) forgetPurchases(store);
  const expired = claims.filter((c) => cutoff(c) <= now.getTime());
  if (expired.length) await store.transaction(REWARD_LOCK, async (tx) => {
    for (const old of expired) {
      const claim = await load(tx, old.id);
      if (pending(claim)) await change(tx, claim, { status: "expired", events: {} });
    }
  });
}

function claimView(claim, now, received = false) {
  if (!claim || claim.earlyDeleted || claim.status === "ineligible") return null;
  let state;
  if (claim.status === "activated") state = claim.capped && !received ? "capped" : "activated";
  else if (claim.deletedAt || cutoff(claim) <= now.getTime()) state = "expired";
  else state = claim.activeDays ? "using" : "registered";
  return { state, activeDays: Math.min(claim.activeDays, claim.rules.days) };
}

export async function referralPage(store, userId, { installId, now = new Date() } = {}) {
  const device = installKey(installId);
  let profile = await load(store, profileId(userId));
  if (!profile || (device && !profile.devices.includes(device))) {
    profile = await store.transaction(REWARD_LOCK, (tx) => ensureProfile(tx, userId, device));
  }
  const mine = await store.listReferralClaims(userId);
  await reconcile(store, userId, now);
  for (const claim of mine.filter(pending)) await reconcile(store, claim.ownerUserId, now);
  const claims = await store.listReferralClaims(userId);
  const invited = [];
  for (const claim of claims.sort((a, b) => b.signupAt.localeCompare(a.signupAt))) {
    const view = claimView(claim, now);
    if (view) invited.push({ initial: claim.deletedAt ? "•" : initial(await store.getUserById(claim.ownerUserId)), ...view });
  }
  const rewards = (await store.listRelationshipRecordsForUser(COLLECTION, userId))
    .filter((r) => r.ownerUserId === userId && r.kind === "reward-audit")
    .sort((a, b) => b.rewardAt.localeCompare(a.rewardAt))
    .map((r) => ({ source: r.source, days: r.rewardDays, at: r.rewardAt, until: r.until }));
  return {
    code: profile.code, rules: referralRules(), invited, totalDays: rewards.reduce((total, r) => total + r.days, 0),
    monthCount: monthCount(claims, now.toISOString()), rewards, received: claimView(await load(store, claimId(userId)), now, true),
  };
}

export async function deleteReferralAccount(store, userId, { now = new Date() } = {}) {
  await store.transaction(REWARD_LOCK, async (tx) => {
    const profile = await load(tx, profileId(userId));
    if (profile) await change(tx, profile, { code: null, devices: [] });
    const claim = await load(tx, claimId(userId));
    if (claim && !claim.deletedAt) await change(tx, claim, {
      deletedAt: now.toISOString(), earlyDeleted: now.getTime() - Date.parse(claim.signupAt) < deletionDays() * DAY_MS,
      events: {}, device: null,
    });
    for (const outgoing of (await tx.listReferralClaims(userId)).filter(pending)) await change(tx, outgoing, { status: "ineligible", reason: "inviter_deleted", events: {} });
  });
}

export async function referralReport(store, { from, to, now = new Date() } = {}) {
  const invalid = () => Object.assign(new Error("Use an inclusive UTC date range of up to 366 days."), { statusCode: 400, code: "invalid_referral_dates" });
  const parse = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid();
    const d = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(d.getTime()) || day(d) !== value) throw invalid();
    return d.getTime();
  };
  const end = parse(to === undefined ? day(now) : to);
  const start = from === undefined ? end - 29 * DAY_MS : parse(from);
  if (end < start || end - start >= 366 * DAY_MS) throw invalid();
  const rows = new Map();
  for (let time = start; time <= end; time += DAY_MS) {
    const date = day(new Date(time));
    rows.set(date, { date, invites_sent: null, invites_opened: 0, signups: 0, activations: 0, referral_days: 0, feedback_days: 0, rewards_granted_days: 0 });
  }
  const increment = (at, metric, count = 1) => {
    const row = at && rows.get(at.slice(0, 10));
    if (row) row[metric] += count;
  };
  for (const record of await store.listRecordsForJob(COLLECTION)) {
    if (record.kind === "open") increment(record.openedAt, "invites_opened");
    if (record.kind === "claim" && !record.earlyDeleted && record.status !== "ineligible") {
      increment(record.signupAt, "signups");
      increment(record.activatedAt, "activations");
    }
    if (record.kind === "reward-audit") {
      increment(record.rewardAt, record.source === "referral" ? "referral_days" : "feedback_days", record.rewardDays);
      increment(record.rewardAt, "rewards_granted_days", record.rewardDays);
    }
  }
  return { from: day(new Date(start)), to: day(new Date(end)), timezone: "UTC", days: [...rows.values()] };
}
