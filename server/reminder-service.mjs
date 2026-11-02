import { randomUUID, createHash } from "node:crypto";
import { createRelationshipRecord, canViewRecord } from "./relationship-domain.mjs";
import { validatePushSubscription } from "./push-delivery.mjs";
import { announceInTogether, memberLanguage, togetherI18n } from "./together-domain.mjs";

const LOCK = "reminder-delivery";
const MAX_ATTEMPTS = 5;
const LEASE_MS = 120_000;
const ANNOUNCE_WINDOW_MS = 7 * 86_400_000;
const JOINT = new Set(["shared", "jointly_confirmed", "revealed"]);
const active = (record) => record && !record.archivedAt && !record.withdrawnAt && record.status === "active";
const iso = (value) => new Date(value).toISOString();
const fail = (message, statusCode = 400, code = "invalid_reminder") => Object.assign(new Error(message), { statusCode, code });
const NATIVE_TOKEN = /^[A-Za-z0-9_:-]{16,4096}$/;
const TOGETHER_NOTIFY_MS = 10 * 60_000;
// Channels the browser retry button never re-targets (it can only move a job to another browser).
const OWN_CHANNELS = new Set(["imessage", "native"]);
const RAW_APNS = /^[0-9a-f]{64}$/i;

export function createReminderService({ store, sendPush, publicKey = "", enabled = false, now = () => new Date(), internalSecret = "", onAnnounce = () => {}, sendIMessage = null, sendNative = null, groupsEnabled = () => false }) {
  const pushOn = enabled && typeof sendPush === "function";
  const nativeOn = typeof sendNative === "function";
  // Like the iMessage mirror: what this process already nudged about per conversation, so nothing older than it goes out.
  const togetherCursors = new Map(), startedAt = new Date().toISOString();
  const owned = async (db, collection, userId) => (await db.listRelationshipRecordsForUser(collection, userId)).filter((item) => item.ownerUserId === userId && !item.archivedAt);
  const update = (db, collection, item, patch) => db.updateRelationshipRecordForUser(collection, item.id, item.ownerUserId, (record) => { Object.assign(record, patch); record.version += 1; });
  const privateRecord = (userId, data) => createRelationshipRecord({ userId, relationshipId: null, visibility: "private", aiAccessScope: "none", ...data });
  const preferences = async (db, userId) => (await owned(db, "deliveryPreferences", userId))[0];
  const cancelJobs = async (db, userId, predicate = () => true) => {
    for (const job of await owned(db, "deliveryJobs", userId)) {
      if (["pending", "retry", "processing"].includes(job.status) && predicate(job)) await update(db, "deliveryJobs", job, { ...(job.status === "processing" ? {} : { status: "cancelled", leaseUntil: null }), cancelRequestedAt: iso(now()) });
    }
  };
  const settings = async (userId) => {
    const preference = await preferences(store, userId);
    const imessage = typeof sendIMessage === "function" && Boolean(await store.getPhoneForUser(userId));
    return { enabled: enabled && preference?.enabled === true, configured: enabled, nativeConfigured: nativeOn, nativeEnabled: nativeOn && preference?.enabled !== false, imessage, imessageEnabled: imessage && preference?.enabled !== false, publicKey: enabled ? publicKey : "", timezone: preference?.timezone || "UTC", devices: (await owned(store, "pushSubscriptions", userId)).filter(active).map(({ id, createdAt }) => ({ id, createdAt })) };
  };
  const getOwnedReminder = async (db, id, userId) => {
    const reminder = await db.getRelationshipRecordForUser("reminders", id, userId);
    if (!reminder || reminder.ownerUserId !== userId || reminder.archivedAt) throw fail("Reminder not found.", 404, "not_found");
    return reminder;
  };
  const authorizeReminder = async (db, reminder) => {
    if (!active(reminder)) return false;
    const user = await db.getUserById(reminder.ownerUserId);
    if (!user || user.deletedAt || user.disabledAt) return false;
    const sourceRelationshipId = reminder.sourceRelationshipId || reminder.relationshipId;
    if (sourceRelationshipId) {
      const context = await db.getRelationshipContext(reminder.ownerUserId);
      if (context?.relationship.id !== sourceRelationshipId || context.relationship.status !== "active") return false;
    }
    const target = reminder.target;
    const collection = targetCollection(target?.kind) || (reminder.milestoneId ? "milestones" : null);
    const targetId = target?.id || reminder.milestoneId;
    if (collection && targetId) {
      const record = await db.getRelationshipRecordForUser(collection, targetId, reminder.ownerUserId);
      if (!record || !canViewRecord(record, reminder.ownerUserId) || record.withdrawnAt || ["archived", "revoked", "withdrawn"].includes(record.status)) return false;
    }
    return true;
  };
  const authorizedDelivery = async (db, job) => {
    // iMessage is the owner's own 1:1 line: it needs a still-bound number, not browser push; "turn off all reminder notifications" stops it too.
    if (job.channel === "imessage") {
      if (typeof sendIMessage !== "function" || (await preferences(db, job.ownerUserId))?.enabled === false) return null;
      const reminder = await db.getRelationshipRecordForUser("reminders", job.reminderId, job.ownerUserId);
      const phone = reminder && reminder.scheduleVersion === job.scheduleVersion && await authorizeReminder(db, reminder) ? await db.getPhoneForUser(job.ownerUserId) : null;
      return phone ? { reminder, phone, language: await memberLanguage(db, job.ownerUserId) } : null;
    }
    // App push: registering the phone is the opt-in; "turn off all reminder notifications" (an explicit disabled preference) is the opt-out.
    if (job.channel === "native") {
      if (!nativeOn || (await preferences(db, job.ownerUserId))?.enabled === false) return null;
      const reminder = await db.getRelationshipRecordForUser("reminders", job.reminderId, job.ownerUserId);
      if (!reminder || reminder.scheduleVersion !== job.scheduleVersion || !await authorizeReminder(db, reminder)) return null;
      const device = await db.getRelationshipRecordForUser("nativePushDevices", job.deviceId, job.ownerUserId);
      return active(device) && device.ownerUserId === job.ownerUserId && device.token ? { reminder, device, native: true, language: await memberLanguage(db, job.ownerUserId) } : null;
    }
    if (!enabled) return null;
    const preference = await preferences(db, job.ownerUserId);
    if (!preference?.enabled || !active(preference)) return null;
    const reminder = await db.getRelationshipRecordForUser("reminders", job.reminderId, job.ownerUserId);
    if (!reminder || reminder.scheduleVersion !== job.scheduleVersion || !await authorizeReminder(db, reminder)) return null;
    const device = await db.getRelationshipRecordForUser("pushSubscriptions", job.subscriptionId, job.ownerUserId);
    if (!active(device) || device.ownerUserId !== job.ownerUserId) return null;
    try { validatePushSubscription(device.subscription); } catch { return null; }
    return { reminder, device, language: preference.language || "zh" };
  };

  // The Agent's own voice in the shared "together" conversation, driven by the same run tick. Only genuinely joint things are
  // announced, and only their shared title: personal reminders (this service's own records, titles included) and private
  // review answers never leave their owner. Handles make a repeated tick or a retry a no-op.
  const announceDue = async () => {
    const current = now();
    const post = async (relationshipId, userId, build) => {
      try {
        const result = await store.transaction(`relationship:${relationshipId}`, async (tx) => {
          const context = await tx.getRelationshipContext(userId);
          if (!context || context.relationship.id !== relationshipId || context.relationship.status !== "active" || context.members.length !== 2) return null;
          return build(tx, await memberLanguage(tx, userId), context);
        });
        if (result && !result.duplicate) onAnnounce(result.conversation, "together.updated");
      } catch (error) { console.error("together announcement failed", error?.code || "error"); /* One broken record must not stop the other announcements or push delivery. */ }
    };
    // Due-ness is computed before the per-tick cap, so already-announced or not-yet-due reminders never crowd out due ones.
    let announcedReminders = 0;
    for (const reminder of (await store.listRecordsForJob("reminders")).filter((item) => active(item) && item.visibility === "shared" && item.relationshipId && item.milestoneId)) {
      if (announcedReminders >= 100) break;
      const milestone = await store.getRelationshipRecordForUser("milestones", reminder.milestoneId, reminder.ownerUserId);
      if (!milestone || !canViewRecord(milestone, reminder.ownerUserId) || milestone.withdrawnAt || !JOINT.has(milestone.visibility)) continue;
      const due = jointReminderDue(milestone, reminder.minutesBefore, current);
      if (!due || reminder.announcedAt?.[due.dueAt]) continue;
      announcedReminders += 1;
      const i18n = togetherI18n((language) => say(language, `到点提醒：「${milestone.title}」（${due.occursOn}）。`, `Reminder: "${milestone.title}" (${due.occursOn}).`, `Recordatorio: "${milestone.title}" (${due.occursOn}).`));
      // The occurrence is stamped on the reminder in the same transaction as the post: the handle alone only dedupes against
      // the last 200 messages, while a due occurrence stays in the 7-day window. No version bump: it is bookkeeping, not an edit.
      await post(reminder.relationshipId, reminder.ownerUserId, async (tx, language) => {
        const fresh = await tx.getRelationshipRecordForUser("reminders", reminder.id, reminder.ownerUserId);
        if (!fresh || fresh.announcedAt?.[due.dueAt]) return null;
        const result = await announceInTogether(tx, {
          relationshipId: reminder.relationshipId, userId: reminder.ownerUserId, kind: "reminder", handle: `reminder:${reminder.id}:${due.dueAt}`,
          refs: [{ type: "milestone", id: milestone.id, version: milestone.version }, { type: "reminder", id: reminder.id }],
          text: i18n[language], i18n,
        });
        await tx.updateRelationshipRecordForUser("reminders", reminder.id, reminder.ownerUserId, (draft) => { draft.announcedAt = { ...(draft.announcedAt || {}), [due.dueAt]: iso(current) }; });
        return result;
      });
    }
    for (const outcome of (await store.listRecordsForJob("outcomes")).filter((item) => item.relationshipId && JOINT.has(item.visibility) && item.status === "pending" && !item.announcedAt && !item.archivedAt && !item.withdrawnAt && item.reviewAt && new Date(item.reviewAt) <= current).slice(0, 100)) {
      const userId = outcome.createdByUserId;
      await post(outcome.relationshipId, userId, async (tx, language) => {
        const fresh = await tx.getRelationshipRecordForUser("outcomes", outcome.id, userId);
        if (!fresh || fresh.status !== "pending" || fresh.announcedAt) return null;
        const i18n = togetherI18n((item) => say(item, `该复盘了：「${fresh.title}」。请你们各自私下完成复盘；双方都完成后才会形成共同结果。`, `Time to review "${fresh.title}". Each of you reviews it privately; the shared result forms once you have both finished.`, `Es hora de revisar "${fresh.title}". Cada uno lo revisa en privado; el resultado compartido se forma cuando ambos terminen.`));
        const result = await announceInTogether(tx, {
          relationshipId: outcome.relationshipId, userId, kind: "review", handle: `review:${outcome.id}`, refs: [{ type: "outcome", id: outcome.id, version: fresh.version }],
          text: i18n[language], i18n,
        });
        await tx.updateRelationshipRecordForUser("outcomes", outcome.id, userId, (draft) => { draft.announcedAt = iso(current); draft.version += 1; });
        return result;
      });
    }
    // Active shared commitments that reached their due time (completed, renegotiating or awaiting-confirmation ones are skipped;
    // so is anything overdue by more than the 7-day window, like joint reminders).
    for (const commitment of (await store.listRecordsForJob("commitments")).filter((item) => item.relationshipId && JOINT.has(item.visibility) && item.status === "active" && !item.dueAnnouncedAt && !item.archivedAt && !item.withdrawnAt && item.dueAt && new Date(item.dueAt) <= current && current.getTime() - new Date(item.dueAt).getTime() <= ANNOUNCE_WINDOW_MS).slice(0, 100)) {
      const userId = commitment.createdByUserId;
      // Stamped like outcomes (dueAnnouncedAt) so the handle's 200-message horizon cannot re-announce it; no version bump, so
      // members confirming or completing the commitment right at its due time do not hit stale_version.
      await post(commitment.relationshipId, userId, async (tx, language, context) => {
        const fresh = await tx.getRelationshipRecordForUser("commitments", commitment.id, userId);
        if (!fresh || fresh.status !== "active" || fresh.dueAnnouncedAt) return null;
        const owner = context.members.find((member) => commitment.ownerType === `member_${String(member.role).toLowerCase()}`);
        const due = iso(commitment.dueAt).slice(0, 16).replace("T", " ") + " UTC";
        const i18n = togetherI18n((item) => { const who = owner?.user?.name || say(item, "你们俩", "both of you", "ambos"); return say(item, `承诺到期：${who}要做的「${commitment.description}」，到期时间 ${due}。`, `Commitment due: ${who} agreed to "${commitment.description}", due ${due}.`, `Compromiso vencido: ${who} acordó "${commitment.description}", vence el ${due}.`); });
        const result = await announceInTogether(tx, {
          relationshipId: commitment.relationshipId, userId, kind: "reminder", handle: `commitment:${commitment.id}:due`, refs: [{ type: "commitment", id: commitment.id, version: commitment.version }],
          text: i18n[language], i18n,
        });
        await tx.updateRelationshipRecordForUser("commitments", commitment.id, userId, (draft) => { draft.dueAnnouncedAt = iso(current); });
        return result;
      });
    }
  };

  return {
    internalSecret,
    getSettings: settings,
    async updateSettings(userId, input) {
      if (typeof input?.enabled !== "boolean") throw fail("Choose whether reminders are enabled.");
      if (input.enabled && !enabled && !nativeOn && typeof sendIMessage !== "function") throw fail("Browser push has not been configured.", 503, "push_not_configured");
      const timezone = input.timezone || "UTC"; dateFormatter(timezone);
      await store.transaction(LOCK, async (db) => {
        const existing = await preferences(db, userId);
        const values = { enabled: input.enabled, timezone, language: ["zh", "en", "es"].includes(input.language) ? input.language : "zh", status: "active" };
        if (existing) await update(db, "deliveryPreferences", existing, values);
        else await db.createRelationshipRecord("deliveryPreferences", privateRecord(userId, values));
        if (!input.enabled) await cancelJobs(db, userId);
      });
      return settings(userId);
    },
    async subscribe(userId, input) {
      if (!enabled) throw fail("Browser push has not been configured.", 503, "push_not_configured");
      const subscription = validatePushSubscription(input);
      return store.transaction(LOCK, async (db) => {
        // A browser endpoint must not continue receiving another account's reminders after switching accounts.
        const existing = (await db.listRecordsForJob("pushSubscriptions")).find((item) => active(item) && item.subscription?.endpoint === subscription.endpoint);
        if (existing?.ownerUserId === userId) { await update(db, "pushSubscriptions", existing, { subscription }); return { id: existing.id }; }
        if (existing) {
          await update(db, "pushSubscriptions", existing, { status: "revoked", subscription: null });
          await cancelJobs(db, existing.ownerUserId, (job) => job.subscriptionId === existing.id);
        }
        const devices = (await owned(db, "pushSubscriptions", userId)).filter(active);
        if (devices.length >= 5) throw fail("Remove an old browser before adding another.", 409, "too_many_devices");
        const record = privateRecord(userId, { subscription });
        await db.createRelationshipRecord("pushSubscriptions", record);
        return { id: record.id };
      });
    },
    async unsubscribe(userId, id) {
      await store.transaction(LOCK, async (db) => {
        const device = await db.getRelationshipRecordForUser("pushSubscriptions", id, userId);
        if (!device || device.ownerUserId !== userId) throw fail("Browser subscription not found.", 404, "not_found");
        await update(db, "pushSubscriptions", device, { status: "revoked", subscription: null });
        await cancelJobs(db, userId, (job) => job.subscriptionId === id);
      });
    },
    async registerNativeDevice(userId, input) {
      if (!nativeOn) throw fail("Phone notifications have not been configured.", 503, "push_not_configured");
      const token = typeof input?.token === "string" ? input.token : "";
      // A raw APNs device token (64 hex) cannot be addressed through FCM: iOS must hand over Firebase's token.
      if (!NATIVE_TOKEN.test(token) || !["ios", "android"].includes(input?.platform) || (input.platform === "ios" && RAW_APNS.test(token))) throw fail("Invalid phone notification token.", 400, "invalid_device");
      return store.transaction(LOCK, async (db) => {
        // One token, one account: a phone that switched accounts must stop receiving the previous account's reminders.
        const holders = (await db.listRecordsForJob("nativePushDevices")).filter((item) => active(item) && item.token === token);
        const mine = holders.find((item) => item.ownerUserId === userId);
        for (const other of holders.filter((item) => item.ownerUserId !== userId)) await revokeNative(db, other);
        if (mine) { if (mine.platform !== input.platform) await update(db, "nativePushDevices", mine, { platform: input.platform }); return { id: mine.id }; }
        // Tokens rotate; keep the five newest phones instead of refusing a rotated token.
        const devices = (await owned(db, "nativePushDevices", userId)).filter(active).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        for (const stale of devices.slice(0, Math.max(0, devices.length - 4))) await revokeNative(db, stale);
        const record = privateRecord(userId, { token, platform: input.platform });
        await db.createRelationshipRecord("nativePushDevices", record);
        return { id: record.id };
      });
    },
    async unregisterNativeDevice(userId, input) {
      const token = typeof input?.token === "string" ? input.token : "";
      if (!NATIVE_TOKEN.test(token)) throw fail("Invalid phone notification token.", 400, "invalid_device");
      return store.transaction(LOCK, async (db) => {
        const devices = (await owned(db, "nativePushDevices", userId)).filter((item) => active(item) && item.token === token);
        for (const device of devices) await revokeNative(db, device);
        return { removed: devices.length };
      });
    },
    // Every published "我们俩" change (member messages, relays, Agent replies, cards, due/review announcements) passes here.
    // New messages since the last call nudge the members who did not write them, vaguely, when the couple has no live iMessage
    // group to carry them. `actorUserId` is the member who triggered an Agent card, so they are not nudged about their own action.
    async notifyTogether(conversation, actorUserId = null) {
      if (!nativeOn || !conversation?.relationshipId || !Array.isArray(conversation.messages)) return { sent: 0 };
      const cursor = togetherCursors.get(conversation.id) || { since: startedAt, ids: new Set() };
      const fresh = conversation.messages.filter((item) => item.createdAt > cursor.since || (item.createdAt === cursor.since && !cursor.ids.has(item.id)));
      if (!fresh.length) return { sent: 0 };
      const since = fresh.reduce((latest, item) => item.createdAt > latest ? item.createdAt : latest, cursor.since);
      togetherCursors.set(conversation.id, { since, ids: new Set([...(since === cursor.since ? cursor.ids : []), ...fresh.filter((item) => item.createdAt === since).map((item) => item.id)]) });
      const context = await store.getRelationshipContext(conversation.createdByUserId);
      if (context?.relationship.id !== conversation.relationshipId || context.relationship.status !== "active" || context.members.length !== 2 || (groupsEnabled() && context.relationship.imessageGroupId)) return { sent: 0 };
      const authorOf = (item) => item.role === "member" ? item.actorUserId : conversation.messages.find((other) => other.id === item.replyTo)?.actorUserId || actorUserId;
      let sent = 0;
      for (const member of context.members) {
        const mine = fresh.filter((item) => authorOf(item) !== member.userId);
        if (mine.length) sent += await nudge(member.userId, mine.some((item) => item.role === "member"));
      }
      return { sent };
    },
    async listReminders(userId) {
      const reminders = await owned(store, "reminders", userId);
      const jobs = await owned(store, "deliveryJobs", userId);
      return reminders.map((reminder) => ({ ...reminder, deliveries: jobs.filter((job) => job.reminderId === reminder.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10).map(({ id, status, attempts, acceptedAt, lastErrorCode, dueAt }) => ({ id, status, attempts, acceptedAt, lastErrorCode, dueAt })) }));
    },
    async createReminder(userId, input) {
      const values = reminderInput(input, now());
      return store.transaction(LOCK, async (db) => {
        const reminders = await owned(db, "reminders", userId);
        if (reminders.filter((item) => active(item) && (item.frequency === "weekly" || !item.lastEnqueuedDueAt)).length >= 100) throw fail("You already have 100 active reminders.", 409, "too_many_reminders");
        const target = input.target || { kind: "reminders" };
        const sourceRelationshipId = await validateTarget(db, userId, target);
        const record = privateRecord(userId, { ...values, target, sourceRelationshipId, scheduleVersion: 1, channel: "web_push" });
        await db.createRelationshipRecord("reminders", record);
        return record;
      });
    },
    async updateReminder(userId, id, input) {
      return store.transaction(LOCK, async (db) => {
        const reminder = await getOwnedReminder(db, id, userId);
        if (input.expectedVersion !== undefined && input.expectedVersion !== reminder.version) throw fail("Reminder changed. Refresh and retry.", 409, "version_conflict");
        const patch = {};
        if (input.title !== undefined) {
          const title = typeof input.title === "string" ? input.title.trim().slice(0, 120) : "";
          if (!title) throw fail("Give this reminder a name.");
          patch.title = title;
        }
        if (input.enabled !== undefined) {
          if (typeof input.enabled !== "boolean") throw fail("Invalid reminder setting.");
          patch.status = input.enabled ? "active" : "paused";
        }
        if (input.localDateTime !== undefined) {
          const values = reminderInput({ ...reminder, ...input }, now());
          if (input.occurrence === "once") {
            if (reminder.frequency !== "weekly" || values.frequency !== "weekly" || values.timezone !== reminder.timezone || values.title !== reminder.title) throw fail("A single occurrence change can only move the next weekly reminder's date and time.");
            const originalDueAt = reminder.occurrenceOriginalDueAt || reminder.dueAt;
            const nextRegular = nextWeeklyOccurrence(originalDueAt, reminder.timezone, now(), reminder.localTime);
            if (new Date(values.dueAt) >= new Date(nextRegular)) throw fail("Move this occurrence to a time before the next regular reminder.");
            Object.assign(patch, { dueAt: values.dueAt, occurrenceOriginalDueAt: originalDueAt });
          } else Object.assign(patch, values, { occurrenceOriginalDueAt: null });
        }
        if (!Object.keys(patch).length) throw fail("No reminder change supplied.");
        const scheduleChanged = input.enabled !== undefined || input.localDateTime !== undefined;
        if (scheduleChanged) { patch.scheduleVersion = (reminder.scheduleVersion || 0) + 1; patch.lastEnqueuedDueAt = null; }
        const updated = await update(db, "reminders", reminder, patch);
        if (scheduleChanged) await cancelJobs(db, userId, (job) => job.reminderId === id);
        return updated;
      });
    },
    async retryReminder(userId, id) {
      return store.transaction(LOCK, async (db) => {
        const reminder = await getOwnedReminder(db, id, userId);
        if (!await authorizeReminder(db, reminder) || !(await preferences(db, userId))?.enabled) throw fail("Enable this reminder and browser notifications first.", 409, "reminder_disabled");
        const jobs = (await owned(db, "deliveryJobs", userId)).filter((job) => job.reminderId === id && job.scheduleVersion === reminder.scheduleVersion && ["failed", "retry"].includes(job.status) && !OWN_CHANNELS.has(job.channel));
        if (!jobs.length) throw fail("There are no failed deliveries to retry.", 409, "no_failed_delivery");
        const devices = (await owned(db, "pushSubscriptions", userId)).filter(active);
        const queuedDevices = new Set();
        let queued = 0;
        for (const job of jobs) {
          const device = devices.find((item) => item.id === job.subscriptionId) || devices[0];
          const deviceOccurrence = `${device?.id}:${job.dueAt}`;
          if (!device || queuedDevices.has(deviceOccurrence) || !await authorizedDelivery(db, { ...job, subscriptionId: device.id })) continue;
          await update(db, "deliveryJobs", job, { status: "pending", subscriptionId: device.id, attempts: 0, nextAttemptAt: iso(now()), lastErrorCode: null, cancelRequestedAt: null }); queued += 1;
          queuedDevices.add(deviceOccurrence);
        }
        if (!queued) throw fail("Reconnect browser notifications before retrying.", 409, "subscription_expired");
        return { queued };
      });
    },
    async runDue({ limit = 25 } = {}) {
      await announceDue();
      if (!pushOn && typeof sendIMessage !== "function" && !nativeOn) return { configured: false, imessageConfigured: false, nativeConfigured: false, claimed: 0, accepted: 0, failed: 0, cancelled: 0 };
      const batchSize = Math.max(1, Math.min(50, Number.isInteger(limit) ? limit : 25));
      const claims = await store.transaction(LOCK, async (db) => {
        const current = now(); const at = iso(current);
        const jobs = await db.listRecordsForJob("deliveryJobs");
        const keys = new Set(jobs.map((job) => job.dedupeKey));
        const due = (await db.listRecordsForJob("reminders")).filter((item) => active(item) && item.dueAt && item.lastEnqueuedDueAt !== item.dueAt && new Date(item.dueAt) <= current).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
        // Bound scheduling work independently of the send batch.
        for (const reminder of due.slice(0, 100)) {
          const preference = await preferences(db, reminder.ownerUserId);
          if (!await authorizeReminder(db, reminder)) { await update(db, "reminders", reminder, { status: "cancelled" }); continue; }
          const devices = pushOn && preference?.enabled ? (await owned(db, "pushSubscriptions", reminder.ownerUserId)).filter(active) : [];
          const phone = typeof sendIMessage === "function" && preference?.enabled !== false ? await db.getPhoneForUser(reminder.ownerUserId) : null;
          const phones = nativeOn && preference?.enabled !== false ? (await owned(db, "nativePushDevices", reminder.ownerUserId)).filter((item) => active(item) && item.token) : [];
          if (!devices.length && !phone && !phones.length) continue;
          // One job per channel and occurrence; the channel suffix keeps a failure or retry on one from touching the other.
          const occurrence = `${reminder.id}:${reminder.scheduleVersion || 0}:${reminder.dueAt}`;
          if (phone && !keys.has(`${occurrence}:imessage`)) {
            const dedupeKey = `${occurrence}:imessage`;
            const job = privateRecord(reminder.ownerUserId, { status: "pending", channel: "imessage", reminderId: reminder.id, sourceRelationshipId: reminder.sourceRelationshipId || reminder.relationshipId, scheduleVersion: reminder.scheduleVersion, dueAt: reminder.dueAt, nextAttemptAt: at, dedupeKey, attempts: 0, leaseUntil: null });
            await db.createRelationshipRecord("deliveryJobs", job); jobs.push(job); keys.add(dedupeKey);
          }
          // Channel order for a personal reminder: iMessage, then App push, then browser push.
          for (const device of phones) {
            const dedupeKey = `${occurrence}:${device.id}:native`;
            if (keys.has(dedupeKey)) continue;
            const job = privateRecord(reminder.ownerUserId, { status: "pending", channel: "native", reminderId: reminder.id, deviceId: device.id, sourceRelationshipId: reminder.sourceRelationshipId || reminder.relationshipId, scheduleVersion: reminder.scheduleVersion, dueAt: reminder.dueAt, nextAttemptAt: at, dedupeKey, attempts: 0, leaseUntil: null });
            await db.createRelationshipRecord("deliveryJobs", job); jobs.push(job); keys.add(dedupeKey);
          }
          for (const device of devices) {
            const dedupeKey = `${occurrence}:${device.id}:push`;
            if (keys.has(dedupeKey)) continue;
            const job = privateRecord(reminder.ownerUserId, { status: "pending", channel: "push", reminderId: reminder.id, subscriptionId: device.id, sourceRelationshipId: reminder.sourceRelationshipId || reminder.relationshipId, scheduleVersion: reminder.scheduleVersion, dueAt: reminder.dueAt, nextAttemptAt: at, dedupeKey, attempts: 0, leaseUntil: null });
            await db.createRelationshipRecord("deliveryJobs", job); jobs.push(job); keys.add(dedupeKey);
          }
          await update(db, "reminders", reminder, { lastEnqueuedDueAt: reminder.dueAt, ...(reminder.frequency === "weekly" ? { dueAt: nextWeeklyOccurrence(reminder.occurrenceOriginalDueAt || reminder.dueAt, reminder.timezone, current, reminder.localTime), occurrenceOriginalDueAt: null } : {}) });
        }
        const candidates = jobs.filter((job) => (["pending", "retry"].includes(job.status) && new Date(job.nextAttemptAt) <= current) || (job.status === "processing" && new Date(job.leaseUntil) <= current)).sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt));
        const selected = [];
        for (const job of candidates.slice(0, batchSize)) {
          if (!await authorizedDelivery(db, job)) { await update(db, "deliveryJobs", job, { status: "cancelled", leaseUntil: null }); continue; }
          if (job.attempts >= MAX_ATTEMPTS) { await update(db, "deliveryJobs", job, { status: "failed", leaseUntil: null, lastErrorCode: "attempt_limit" }); continue; }
          const leaseToken = randomUUID();
          selected.push(await update(db, "deliveryJobs", job, { status: "processing", attempts: job.attempts + 1, leaseToken, leaseUntil: iso(current.getTime() + LEASE_MS) }));
        }
        return selected;
      });
      // `configured` keeps meaning browser push (scripts/run-reminders.mjs relies on it); the iMessage sender is reported separately.
      const result = { configured: pushOn, imessageConfigured: typeof sendIMessage === "function", nativeConfigured: nativeOn, claimed: claims.length, accepted: 0, failed: 0, cancelled: 0 };
      // Small parallel groups keep every provider timeout inside its persisted lease.
      for (let offset = 0; offset < claims.length; offset += 5) {
        await Promise.all(claims.slice(offset, offset + 5).map(async (job) => {
          const current = await store.getRelationshipRecordForUser("deliveryJobs", job.id, job.ownerUserId);
          const authorization = current?.status === "processing" && current.leaseToken === job.leaseToken ? await authorizedDelivery(store, current) : null;
          const finalClaim = authorization ? await store.getRelationshipRecordForUser("deliveryJobs", job.id, job.ownerUserId) : null;
          if (!authorization || finalClaim?.status !== "processing" || finalClaim.leaseToken !== job.leaseToken || finalClaim.cancelRequestedAt) { await finish(job, { status: "cancelled" }); result.cancelled += 1; return; }
          try {
            if (authorization.phone) await sendIMessage(authorization.phone, reminderText(authorization.reminder, authorization.language));
            // Same vague copy as browser push (only the 1:1 iMessage may carry the title); a tap opens the conversation home.
            else if (authorization.native) { const { title, body } = reminderPayload(authorization.reminder, authorization.language, job.dedupeKey); await sendNative(authorization.device.token, { title, body, url: "/" }); }
            else {
              const receipt = await sendPush(authorization.device.subscription, reminderPayload(authorization.reminder, authorization.language, job.dedupeKey), { dedupeKey: job.dedupeKey });
              if (!Number.isInteger(receipt?.statusCode) || receipt.statusCode < 200 || receipt.statusCode >= 300) throw fail("Push provider did not accept delivery.", 502, "provider_rejected");
            }
            await finish(job, { status: "accepted", acceptedAt: iso(now()), lastErrorCode: null }); result.accepted += 1;
          } catch (error) {
            const expired = authorization.native ? error.expired === true : !authorization.phone && [404, 410].includes(error.statusCode);
            // FCM 401 means our cached access token went stale (native-push clears it): retry with a fresh one.
            const permanent = authorization.phone || authorization.native ? error.statusCode >= 400 && error.statusCode < 500 && ![408, 429, ...(authorization.native ? [401] : [])].includes(error.statusCode) : [400, 401, 403].includes(error.statusCode);
            const terminal = expired || permanent || job.attempts >= MAX_ATTEMPTS;
            const lastErrorCode = expired ? "subscription_expired" : error.statusCode === 429 ? "provider_rate_limited" : "provider_unavailable";
            await finish(job, { status: terminal ? "failed" : "retry", lastErrorCode, nextAttemptAt: iso(now().getTime() + Math.min(3600_000, 60_000 * 2 ** job.attempts)) }, expired);
            result.failed += 1;
          }
        }));
      }
      return result;
    },
  };

  // One member's phones, at most once per 10 minutes; respects "turn off all reminder notifications"; best effort, never retried.
  async function nudge(userId, partnerWrote) {
    const devices = await store.transaction(LOCK, async (db) => {
      if ((await preferences(db, userId))?.enabled === false) return [];
      const current = now(), mine = (await owned(db, "nativePushDevices", userId)).filter((item) => active(item) && item.token);
      const last = mine.map((item) => item.togetherNotifiedAt || "").sort().at(-1);
      if (!mine.length || (last && current.getTime() - new Date(last).getTime() < TOGETHER_NOTIFY_MS)) return [];
      // Bookkeeping stamp, no version bump: it must not conflict with a concurrent re-registration.
      for (const device of mine) await db.updateRelationshipRecordForUser("nativePushDevices", device.id, device.ownerUserId, (draft) => { draft.togetherNotifiedAt = iso(current); });
      return mine;
    });
    const language = devices.length ? await memberLanguage(store, userId) : "zh";
    const body = partnerWrote ? say(language, "TA 在“我们俩”里说了话。", "Your partner wrote in Us.", "Tu pareja escribió en Nosotros.") : say(language, "“我们俩”里有新消息。", "There is something new in Us.", "Hay algo nuevo en Nosotros.");
    let sent = 0;
    for (const device of devices) {
      try { await sendNative(device.token, { title: "Pinky", body, url: "/?channel=us" }); sent += 1; }
      catch (error) {
        console.error("together native push failed", error?.code || "error");
        if (error?.expired) await store.transaction(LOCK, async (db) => { const fresh = await db.getRelationshipRecordForUser("nativePushDevices", device.id, device.ownerUserId); if (active(fresh) && fresh.token === device.token) await revokeNative(db, fresh); });
      }
    }
    return sent;
  }

  async function revokeNative(db, device) {
    await update(db, "nativePushDevices", device, { status: "revoked", token: null });
    await cancelJobs(db, device.ownerUserId, (job) => job.deviceId === device.id);
  }

  async function finish(job, patch, expired = false) {
    await store.transaction(LOCK, async (db) => {
      const current = await db.getRelationshipRecordForUser("deliveryJobs", job.id, job.ownerUserId);
      if (!current || current.status !== "processing" || current.leaseToken !== job.leaseToken) return;
      await update(db, "deliveryJobs", current, { ...patch, leaseUntil: null, leaseToken: null });
      if (expired && job.channel === "native") {
        const device = await db.getRelationshipRecordForUser("nativePushDevices", job.deviceId, job.ownerUserId);
        if (device) await revokeNative(db, device);
      } else if (expired) {
        const device = await db.getRelationshipRecordForUser("pushSubscriptions", job.subscriptionId, job.ownerUserId);
        if (device) await update(db, "pushSubscriptions", device, { status: "revoked", subscription: null });
      }
    });
  }
}

const say = (language, zh, en, es) => language === "en" ? en : language === "es" ? es : zh;
// A joint milestone reminder is due `minutesBefore` ahead of the milestone's (yearly: nearest) occurrence; ignore ones that went stale.
function jointReminderDue(milestone, minutesBefore, current) {
  const source = new Date(`${milestone.date}T12:00:00.000Z`);
  if (Number.isNaN(source.getTime())) return null;
  const years = milestone.recurringRule === "yearly" ? [-1, 0, 1].map((offset) => current.getUTCFullYear() + offset) : [source.getUTCFullYear()];
  const occurrences = years.map((year) => Date.UTC(year, source.getUTCMonth(), source.getUTCDate(), 12));
  const offset = (Number.isFinite(minutesBefore) ? minutesBefore : 1440) * 60_000;
  const due = occurrences.map((at) => ({ at, dueAt: at - offset })).filter((item) => item.dueAt <= current.getTime() && current.getTime() - item.dueAt <= ANNOUNCE_WINDOW_MS).sort((a, b) => b.dueAt - a.dueAt)[0];
  return due ? { dueAt: iso(due.dueAt), occursOn: iso(due.at).slice(0, 10) } : null;
}
function reminderInput(input, current) {
  const timezone = input.timezone || "UTC";
  const dueAt = localDateTimeToInstant(input.localDateTime, timezone);
  if (new Date(dueAt) <= current || new Date(dueAt).getTime() > current.getTime() + 730 * 86_400_000) throw fail("Choose a future time within two years.");
  if (!["once", "weekly"].includes(input.frequency || "once")) throw fail("Choose once or weekly.");
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 120) : "";
  if (!title) throw fail("Give this reminder a name.");
  return { title, dueAt, timezone, localTime: input.localDateTime.slice(11), frequency: input.frequency || "once" };
}
function targetCollection(kind) { return { issue: "issues", milestone: "milestones", outcome: "outcomes", checkin: "checkins" }[kind]; }
async function validateTarget(store, userId, target) {
  if (["reminders", "plans", "checkins"].includes(target?.kind) && !target.id) return null;
  const collection = targetCollection(target?.kind);
  if (!collection || typeof target.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(target.id)) throw fail("Invalid reminder destination.");
  const record = await store.getRelationshipRecordForUser(collection, target.id, userId);
  if (!record || !canViewRecord(record, userId) || record.withdrawnAt) throw fail("Reminder destination not found.", 404, "not_found");
  return record.relationshipId || null;
}
// The 1:1 iMessage is the owner's own private channel, so (unlike push) it may carry the reminder's title. Never used for the group.
function reminderText(reminder, language) { return say(language, `提醒：「${reminder.title}」`, `Reminder: "${reminder.title}"`, `Recordatorio: "${reminder.title}"`); }
function reminderPayload(reminder, language, key) {
  const target = reminder.target;
  const url = target?.kind === "issue" ? `/?view=decide&issue=${encodeURIComponent(target.id)}` : target?.kind === "outcome" ? `/?view=decide&outcome=${encodeURIComponent(target.id)}` : target?.kind === "milestone" || reminder.milestoneId ? `/?view=plans&milestone=${encodeURIComponent(target?.id || reminder.milestoneId)}` : target?.kind === "checkin" || target?.kind === "checkins" ? "/?view=checkins" : target?.kind === "plans" ? "/?view=plans" : `/?view=reminders&reminder=${encodeURIComponent(reminder.id)}`;
  return { title: "Pinky", body: language === "en" ? "You have a reminder. Open Pinky when you are ready." : language === "es" ? "Tienes un recordatorio. Abre Pinky cuando quieras." : "你有一条提醒，方便时打开 Pinky 查看。", url, tag: createHash("sha256").update(key).digest("base64url").slice(0, 32) };
}

export function localDateTimeToInstant(localDateTime, timeZone, gapPolicy = "reject") {
  if (typeof localDateTime !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localDateTime)) throw fail("Invalid local date and time.");
  const wall = Date.parse(`${localDateTime}:00Z`);
  if (!Number.isFinite(wall) || iso(wall).slice(0, 16) !== localDateTime) throw fail("Invalid local date and time.");
  const formatter = dateFormatter(timeZone);
  const offsets = new Set([-2, -1, 0, 1, 2].map((days) => {
    const instant = wall + days * 86_400_000;
    return Date.parse(`${localParts(formatter, instant)}:00Z`) - instant;
  }));
  const candidates = [...offsets].map((offset) => wall - offset).sort((a, b) => a - b);
  const exact = candidates.find((candidate) => localParts(formatter, candidate) === localDateTime);
  if (exact !== undefined) return iso(exact); // Overlaps consistently use the earlier instant.
  if (gapPolicy === "forward") {
    const forward = candidates.filter((candidate) => localParts(formatter, candidate) > localDateTime).sort((a, b) => localParts(formatter, a).localeCompare(localParts(formatter, b)))[0];
    if (forward !== undefined) return iso(forward);
  }
  throw fail("This local time does not exist because the clocks change. Choose another time.", 400, "nonexistent_local_time");
}

export function nextWeeklyOccurrence(dueAt, timeZone, now, localTime) {
  const previous = localParts(dateFormatter(timeZone), new Date(dueAt));
  const date = new Date(`${previous.slice(0, 10)}T12:00:00Z`);
  const time = localTime || previous.slice(11);
  // Skip missed weeks after downtime instead of flooding the user with a backlog.
  const elapsedDays = Math.max(0, Math.floor((now.getTime() - new Date(dueAt).getTime()) / 86_400_000));
  date.setUTCDate(date.getUTCDate() + Math.max(1, Math.floor(elapsedDays / 7)) * 7);
  for (let index = 0; index < 3; index += 1) {
    const result = localDateTimeToInstant(`${iso(date).slice(0, 10)}T${time}`, timeZone, "forward");
    if (new Date(result) > now) return result;
    date.setUTCDate(date.getUTCDate() + 7);
  }
  throw fail("Could not calculate next weekly occurrence.");
}

function dateFormatter(timeZone) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
  catch { throw fail("Invalid IANA time zone."); }
}
function localParts(formatter, date) {
  const parts = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
