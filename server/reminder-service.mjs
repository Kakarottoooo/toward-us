import { randomUUID, createHash } from "node:crypto";
import { createRelationshipRecord, canViewRecord } from "./relationship-domain.mjs";
import { validatePushSubscription } from "./push-delivery.mjs";

const LOCK = "reminder-delivery";
const MAX_ATTEMPTS = 5;
const LEASE_MS = 120_000;
const active = (record) => record && !record.archivedAt && !record.withdrawnAt && record.status === "active";
const iso = (value) => new Date(value).toISOString();
const fail = (message, statusCode = 400, code = "invalid_reminder") => Object.assign(new Error(message), { statusCode, code });

export function createReminderService({ store, sendPush, publicKey = "", enabled = false, now = () => new Date(), internalSecret = "" }) {
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
    return { enabled: enabled && preference?.enabled === true, configured: enabled, publicKey: enabled ? publicKey : "", timezone: preference?.timezone || "UTC", devices: (await owned(store, "pushSubscriptions", userId)).filter(active).map(({ id, createdAt }) => ({ id, createdAt })) };
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

  return {
    internalSecret,
    getSettings: settings,
    async updateSettings(userId, input) {
      if (typeof input?.enabled !== "boolean") throw fail("Choose whether reminders are enabled.");
      if (input.enabled && !enabled) throw fail("Browser push has not been configured.", 503, "push_not_configured");
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
        const jobs = (await owned(db, "deliveryJobs", userId)).filter((job) => job.reminderId === id && job.scheduleVersion === reminder.scheduleVersion && ["failed", "retry"].includes(job.status));
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
      if (!enabled || typeof sendPush !== "function") return { configured: false, claimed: 0, accepted: 0, failed: 0, cancelled: 0 };
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
          if (!preference?.enabled) continue;
          const devices = (await owned(db, "pushSubscriptions", reminder.ownerUserId)).filter(active);
          if (!devices.length) continue;
          for (const device of devices) {
            const dedupeKey = `${reminder.id}:${reminder.scheduleVersion || 0}:${reminder.dueAt}:${device.id}`;
            if (keys.has(dedupeKey)) continue;
            const job = privateRecord(reminder.ownerUserId, { status: "pending", reminderId: reminder.id, subscriptionId: device.id, sourceRelationshipId: reminder.sourceRelationshipId || reminder.relationshipId, scheduleVersion: reminder.scheduleVersion, dueAt: reminder.dueAt, nextAttemptAt: at, dedupeKey, attempts: 0, leaseUntil: null });
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
      const result = { configured: true, claimed: claims.length, accepted: 0, failed: 0, cancelled: 0 };
      // Small parallel groups keep every provider timeout inside its persisted lease.
      for (let offset = 0; offset < claims.length; offset += 5) {
        await Promise.all(claims.slice(offset, offset + 5).map(async (job) => {
          const current = await store.getRelationshipRecordForUser("deliveryJobs", job.id, job.ownerUserId);
          const authorization = current?.status === "processing" && current.leaseToken === job.leaseToken ? await authorizedDelivery(store, current) : null;
          const finalClaim = authorization ? await store.getRelationshipRecordForUser("deliveryJobs", job.id, job.ownerUserId) : null;
          if (!authorization || finalClaim?.status !== "processing" || finalClaim.leaseToken !== job.leaseToken || finalClaim.cancelRequestedAt) { await finish(job, { status: "cancelled" }); result.cancelled += 1; return; }
          try {
            const receipt = await sendPush(authorization.device.subscription, reminderPayload(authorization.reminder, authorization.language, job.dedupeKey), { dedupeKey: job.dedupeKey });
            if (!Number.isInteger(receipt?.statusCode) || receipt.statusCode < 200 || receipt.statusCode >= 300) throw fail("Push provider did not accept delivery.", 502, "provider_rejected");
            await finish(job, { status: "accepted", acceptedAt: iso(now()), lastErrorCode: null }); result.accepted += 1;
          } catch (error) {
            const expired = [404, 410].includes(error.statusCode);
            const terminal = expired || [400, 401, 403].includes(error.statusCode) || job.attempts >= MAX_ATTEMPTS;
            const lastErrorCode = expired ? "subscription_expired" : error.statusCode === 429 ? "provider_rate_limited" : "provider_unavailable";
            await finish(job, { status: terminal ? "failed" : "retry", lastErrorCode, nextAttemptAt: iso(now().getTime() + Math.min(3600_000, 60_000 * 2 ** job.attempts)) }, expired);
            result.failed += 1;
          }
        }));
      }
      return result;
    },
  };

  async function finish(job, patch, expired = false) {
    await store.transaction(LOCK, async (db) => {
      const current = await db.getRelationshipRecordForUser("deliveryJobs", job.id, job.ownerUserId);
      if (!current || current.status !== "processing" || current.leaseToken !== job.leaseToken) return;
      await update(db, "deliveryJobs", current, { ...patch, leaseUntil: null, leaseToken: null });
      if (expired) {
        const device = await db.getRelationshipRecordForUser("pushSubscriptions", job.subscriptionId, job.ownerUserId);
        if (device) await update(db, "pushSubscriptions", device, { status: "revoked", subscription: null });
      }
    });
  }
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
function reminderPayload(reminder, language, key) {
  const target = reminder.target;
  const url = target?.kind === "issue" ? `/?view=decide&issue=${encodeURIComponent(target.id)}` : target?.kind === "outcome" ? `/?view=decide&outcome=${encodeURIComponent(target.id)}` : target?.kind === "milestone" || reminder.milestoneId ? `/?view=plans&milestone=${encodeURIComponent(target?.id || reminder.milestoneId)}` : target?.kind === "checkin" || target?.kind === "checkins" ? "/?view=checkins" : target?.kind === "plans" ? "/?view=plans" : `/?view=reminders&reminder=${encodeURIComponent(reminder.id)}`;
  return { title: "Toward Us", body: language === "en" ? "You have a reminder. Open Toward Us when you are ready." : language === "es" ? "Tienes un recordatorio. Abre Toward Us cuando quieras." : "你有一条提醒，方便时打开彼此查看。", url, tag: createHash("sha256").update(key).digest("base64url").slice(0, 32) };
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
