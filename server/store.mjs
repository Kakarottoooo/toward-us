import { AsyncLocalStorage } from "node:async_hooks";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createPostgresStore } from "./postgres-store.mjs";
import { phoneTakenError } from "./phone-identity.mjs";
import { GRAPH_COLLECTIONS, PERSONAL_COLLECTIONS, assertRecordScope } from "./relationship-domain.mjs";

const EMPTY_STATE = () => ({
  version: 4,
  users: {},
  userByEmail: {},
  sessions: {},
  relationships: {},
  memberships: {},
  formerMemberships: {},
  invitations: {},
  phones: {},
  phoneLinks: {},
  rooms: {},
  demoRooms: {},
  relationshipGraph: Object.fromEntries(GRAPH_COLLECTIONS.map((collection) => [collection, {}])),
});

export async function createStore(filePath, databaseUrl = process.env.DATABASE_URL) {
  if (databaseUrl) return createPostgresStore(databaseUrl);
  return createFileStore(filePath);
}

// Values in the committed state are frozen and never changed in place, so a transaction copies only what it changes
// (founder 11-10, after the scale test: a turn copied and rewrote the whole file, so it slowed as data grew).
const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
};
/** A caller's own copy. A conversation's older pages never change once written, so they are shared, not copied. */
export const copyEntry = (value) => {
  if (!value || typeof value !== "object" || !Array.isArray(value.earlier)) return structuredClone(value);
  const { earlier, ...rest } = value;
  return { ...structuredClone(rest), earlier: [...earlier] };
};
const MAPS = Object.keys(EMPTY_STATE()).filter((key) => key !== "version" && key !== "relationshipGraph");

/**
 * The file store keeps everything in memory, the whole of it in `filePath`, and each committed transaction's changes as
 * one line appended to `filePath.journal`. The log is folded into the file once it grows, and on every start, so the
 * file alone is whole after a restart. Each fold has a generation; lines of an older one are ignored.
 */
export async function createFileStore(filePath, { foldBytes = 4 * 1024 * 1024 } = {}) {
  await mkdir(dirname(filePath), { recursive: true });
  const journalPath = `${filePath}.journal`;
  let committedState = EMPTY_STATE();
  const transactions = new AsyncLocalStorage();
  let transactionQueue = Promise.resolve();
  const state = () => transactions.getStore()?.state || committedState;
  let generation = 0, journalBytes = 0, foldAt = foldBytes, onDisk = false;

  try {
    const text = await readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    generation = Number(parsed.journalGeneration) || 0; onDisk = true; foldAt = Math.max(foldBytes, text.length / 2);
    delete parsed.journalGeneration;
    committedState = { ...EMPTY_STATE(), ...parsed, version: 5 };
    state().relationshipGraph = Object.fromEntries(GRAPH_COLLECTIONS.map((collection) => [collection, parsed.relationshipGraph?.[collection] || {}]));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const mapAt = (root, path) => path.startsWith("graph.") ? root.relationshipGraph[path.slice(6)] : root[path];
  let replayed = 0;
  try {
    // A line cut off by a crash, or written by a transaction that then failed, does not parse and is skipped.
    for (const line of (await readFile(journalPath, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      let entry; try { entry = JSON.parse(line); } catch { continue; }
      if (entry?.g !== generation || !Array.isArray(entry.c)) continue;
      for (const [path, key, value, from, added] of entry.c) {
        const map = mapAt(committedState, path); if (!map) continue;
        if (value === undefined) { delete map[key]; continue; }
        if (from !== undefined) value.earlier = [...(map[key]?.earlier || []).slice(0, from), ...added];
        map[key] = value;
      }
      replayed += 1;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  freeze(committedState);

  const fold = async (whole) => {
    const text = JSON.stringify({ ...whole, journalGeneration: generation + 1 });
    await writeFile(`${filePath}.tmp`, text, "utf8");
    await rename(`${filePath}.tmp`, filePath);
    generation += 1; onDisk = true; journalBytes = 0; foldAt = Math.max(foldBytes, text.length / 2);
    await writeFile(journalPath, "", "utf8");
  };
  if (replayed) await fold(committedState);

  /** A transaction's view: each map is copied (keys only) the first time it is touched; entries are copied by `own`. */
  const begin = () => {
    const base = committedState, targets = new Map(), views = new Map(), changed = new Map();
    const mark = (path, key) => { if (!changed.has(path)) changed.set(path, new Set()); changed.get(path).add(key); };
    const view = (path) => {
      if (!views.has(path)) {
        const target = { ...mapAt(base, path) };
        targets.set(path, target);
        views.set(path, new Proxy(target, {
          set(object, key, value) { object[key] = value; mark(path, key); return true; },
          deleteProperty(object, key) { delete object[key]; mark(path, key); return true; },
        }));
      }
      return views.get(path);
    };
    const graph = {}, current = { version: base.version, relationshipGraph: graph };
    for (const key of Object.keys(base)) if (!MAPS.includes(key) && key !== "relationshipGraph" && key !== "version") current[key] = base[key];
    for (const key of MAPS) Object.defineProperty(current, key, { enumerable: true, get: () => view(key) });
    for (const collection of GRAPH_COLLECTIONS) Object.defineProperty(graph, collection, { enumerable: true, get: () => view(`graph.${collection}`) });
    return { state: current, base, targets, changed, owned: new Map(), dirty: false };
  };
  /** The entry `map[key]` as this transaction's own copy, safe to change. */
  const own = (map, key) => {
    const context = transactions.getStore();
    if (!context) throw new Error("Changes to the store need a transaction.");
    if (!context.owned.has(map)) context.owned.set(map, new Set());
    const keys = context.owned.get(map);
    if (!keys.has(key) && map[key] !== undefined) { map[key] = copyEntry(map[key]); keys.add(key); }
    return map[key];
  };
  const commit = async (context) => {
    const next = { ...context.base, relationshipGraph: { ...context.base.relationshipGraph } }, changes = [];
    for (const [path, keys] of context.changed) {
      const target = context.targets.get(path), before = mapAt(context.base, path);
      for (const key of keys) {
        const value = target[key];
        if (value === undefined) { changes.push([path, key]); continue; }
        freeze(value);
        // Pages already written are named by count, not written again.
        const old = before[key]?.earlier;
        if (Array.isArray(value.earlier) && Array.isArray(old) && value.earlier.length >= old.length && old.every((page, index) => value.earlier[index] === page)) {
          const { earlier, ...rest } = value;
          changes.push([path, key, rest, old.length, earlier.slice(old.length)]);
        } else changes.push([path, key, value]);
      }
      if (path.startsWith("graph.")) next.relationshipGraph[path.slice(6)] = target; else next[path] = target;
    }
    if (!changes.length) return;
    if (!onDisk) { await fold(next); committedState = next; return; }
    // Each line starts on its own line, so one cut off by a crash never swallows the next.
    const line = `\n${JSON.stringify({ g: generation, c: changes })}`;
    await appendFile(journalPath, line, "utf8");
    journalBytes += line.length;
    committedState = next;
    if (journalBytes > foldAt) await fold(next).catch((error) => console.error("Could not fold the store's change log; it stays safe in the log:", error?.message || error));
  };

  const persist = async () => { if (transactions.getStore()) transactions.getStore().dirty = true; };
  const transaction = async (_key, callback) => {
    if (transactions.getStore()) return callback(store);
    const previous = transactionQueue;
    let release;
    transactionQueue = new Promise((resolve) => { release = resolve; });
    await previous;
    const context = begin();
    try {
      return await transactions.run(context, async () => {
        const result = await callback(store);
        if (context.dirty) await commit(context);
        return result;
      });
    } finally { release(); }
  };
  const accessibleRecord = (collection, record, userId) => {
    if (!record) return false;
    if (!record.relationshipId) return PERSONAL_COLLECTIONS.has(collection) && record.visibility === "private" && record.ownerUserId === userId;
    return state().memberships[userId]?.relationshipId === record.relationshipId;
  };

  const relationshipContext = (userId) => {
    const membership = state().memberships[userId];
    if (!membership) return null;
    const relationship = state().relationships[membership.relationshipId];
    if (!relationship) return null;
    const members = Object.values(state().memberships)
      .filter((candidate) => candidate.relationshipId === relationship.id)
      .map((candidate) => ({ ...candidate, user: publicUser(state().users[candidate.userId]) }));
    // The newest open invite: one sent again after the first expired replaces it.
    const invitation = Object.values(state().invitations).filter((candidate) => candidate.relationshipId === relationship.id && !candidate.acceptedAt).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
    return { relationship: { ...relationship }, membership: { ...membership }, members, invitation: invitation ? { ...invitation } : null };
  };

  // Sendblue cannot remove anyone from a group, so a member's number leaving the account retires the couple's group.
  const dropCoupleGroup = (userId) => { const id = state().memberships[userId]?.relationshipId; if (state().relationships[id]?.imessageGroupId) own(state().relationships, id).imessageGroupId = null; };

  const implementation = {
    kind: "file",
    transaction,
    async ping() { return true; },
    getUserByEmail(email) {
      const id = state().userByEmail[email];
      return id ? { ...state().users[id] } : null;
    },
    getUserById(id) { return state().users[id] ? { ...state().users[id] } : null; },
    getUserForUpdate(id) { return store.getUserById(id); },
    async createUser(user) {
      if (state().userByEmail[user.email]) return null;
      state().users[user.id] = { ...user };
      state().userByEmail[user.email] = user.id;
      await persist();
      return { ...user };
    },
    async createSession(session) { state().sessions[session.id] = { ...session }; await persist(); return session; },
    getSession(id) {
      const session = state().sessions[id];
      if (!session || session.expiresAt <= new Date().toISOString()) return null;
      return { ...session };
    },
    async deleteUserSessions(userId) { for (const [id, session] of Object.entries(state().sessions)) if (session.userId === userId) delete state().sessions[id]; await persist(); },
    async updateUserPassword(userId, passwordHash) { if (!state().users[userId]) return false; own(state().users, userId).passwordHash = passwordHash; await persist(); return true; },
    async updateUserLanguage(userId, language) { if (!state().users[userId]) return false; own(state().users, userId).language = language; await persist(); return true; },
    async leaveRelationship(userId) {
      const context = relationshipContext(userId); if (!context) return null;
      const id = context.relationship.id;
      const members = context.members.map(({ user, ...member }) => member);
      state().formerMemberships[id] = members;
      Object.assign(own(state().relationships, id), { status: "ended", imessageGroupId: null, updatedAt: new Date().toISOString() });
      for (const [code, invitation] of Object.entries(state().invitations)) if (invitation.relationshipId === id) own(state().invitations, code).expiresAt = new Date().toISOString();
      for (const member of members) delete state().memberships[member.userId];
      for (const collection of ["privateAgentThreads", "memories", "checkins"]) for (const [key, found] of Object.entries(state().relationshipGraph[collection])) {
        if (found.relationshipId === id && found.visibility === "private") { const record = own(state().relationshipGraph[collection], key); record.relationshipId = null; record.previousRelationshipId = id; record.status = "closed"; record.aiAccessScope = "none"; record.version += 1; }
      }
      await persist(); return { relationshipId: id, memberIds: members.map((member) => member.userId) };
    },
    async createPhoneLink(link) {
      // Links hold the raw number, so expired ones are purged as new ones are minted.
      for (const [hash, old] of Object.entries(state().phoneLinks)) if (old.expiresAt <= link.createdAt) delete state().phoneLinks[hash];
      state().phoneLinks[link.codeHash] = { ...link }; await persist();
    },
    getPhoneLink(codeHash, now) { const link = state().phoneLinks[codeHash]; return link && link.expiresAt > now ? link.phone : null; },
    async bindPhone(userId, phone) {
      if (state().phones[phone] && state().phones[phone].userId !== userId) throw phoneTakenError();
      if (Object.entries(state().phones).some(([other, record]) => record.userId === userId && other !== phone)) dropCoupleGroup(userId);
      for (const [other, record] of Object.entries(state().phones)) if (record.userId === userId && other !== phone) delete state().phones[other];
      state().phones[phone] ||= { userId, createdAt: new Date().toISOString() };
      await persist(); return phone;
    },
    async consumePhoneLink(codeHash, userId, now) {
      const link = state().phoneLinks[codeHash];
      if (!link || link.expiresAt <= now) return null;
      await store.bindPhone(userId, link.phone); delete state().phoneLinks[codeHash]; await persist(); return link.phone;
    },
    async unbindPhone(userId) {
      if (Object.values(state().phones).some((record) => record.userId === userId)) dropCoupleGroup(userId);
      for (const [phone, record] of Object.entries(state().phones)) if (record.userId === userId) delete state().phones[phone]; await persist();
    },
    getUserIdByPhone(phone) { return state().phones[phone]?.userId || null; },
    getPhoneForUser(userId) { return Object.keys(state().phones).find((phone) => state().phones[phone].userId === userId) || null; },
    async getPrivacySnapshot(userId) {
      const ids = new Set(Object.entries(state().formerMemberships).filter(([, members]) => members.some((member) => member.userId === userId)).map(([id]) => id));
      const current = state().memberships[userId]?.relationshipId; if (current) ids.add(current);
      return {
        relationships: [...ids].map((id) => structuredClone(state().relationships[id])),
        graph: Object.fromEntries(GRAPH_COLLECTIONS.map((collection) => [collection, Object.values(state().relationshipGraph[collection]).filter((record) => ids.has(record.relationshipId) || record.ownerUserId === userId).map((record) => structuredClone(record))])),
        rooms: Object.values(state().rooms).filter((room) => ids.has(room.relationshipId)).map((room) => structuredClone(room)),
        phone: implementation.getPhoneForUser(userId),
      };
    },
    async deletePrivateData(userId) {
      let deleted = 0;
      for (const collection of GRAPH_COLLECTIONS) {
        if (["accountSettings", "deliveryPreferences", "consentEvents", "pushSubscriptions", "deliveryJobs", "nativePushDevices", "purchases", "betaCodes"].includes(collection)) continue;
        for (const [id, record] of Object.entries(state().relationshipGraph[collection])) if (record.ownerUserId === userId && ["private", "private_surprise"].includes(record.visibility)) { delete state().relationshipGraph[collection][id]; deleted += 1; }
      }
      // The streak's showed-up days (accountSettings "showedup:…") are this person's activity: they go with private data.
      for (const [id, record] of Object.entries(state().relationshipGraph.accountSettings)) if (record.ownerUserId === userId && id.startsWith("showedup:")) { delete state().relationshipGraph.accountSettings[id]; deleted += 1; }
      for (const [code, room] of Object.entries(state().rooms)) if (room.analysis?.private && Object.hasOwn(room.analysis.private, userId)) delete own(state().rooms, code).analysis.private[userId];
      await persist(); return deleted;
    },
    async deleteAccount(userId) {
      await store.leaveRelationship(userId); await store.deletePrivateData(userId); await store.deleteUserSessions(userId);
      for (const collection of ["accountSettings", "deliveryPreferences", "pushSubscriptions", "deliveryJobs", "nativePushDevices", "purchases", "betaCodes"]) for (const [id, record] of Object.entries(state().relationshipGraph[collection])) if (record.ownerUserId === userId) delete state().relationshipGraph[collection][id];
      const phone = implementation.getPhoneForUser(userId);
      for (const [hash, link] of Object.entries(state().phoneLinks)) if (link.phone === phone) delete state().phoneLinks[hash];
      await store.unbindPhone(userId);
      if (!state().users[userId]) return false;
      const user = own(state().users, userId);
      delete state().userByEmail[user.email]; user.email = `${userId}@deleted.invalid`; user.name = "Deleted user"; user.passwordHash = "deleted";
      for (const [code, found] of Object.entries(state().rooms)) {
        const participantIds = new Set((found.participants || []).filter((person) => person.userId === userId).map((person) => person.id));
        if (!participantIds.size && !(found.aiConversation || []).some((message) => message.userId === userId)) continue;
        const room = own(state().rooms, code);
        for (const person of room.participants || []) if (participantIds.has(person.id)) person.name = "Deleted user";
        room.messages = (room.messages || []).filter((message) => !participantIds.has(message.participantId));
        room.aiConversation = (room.aiConversation || []).filter((message) => message.userId !== userId && !participantIds.has(message.participantId));
      }
      await persist(); return true;
    },
    async deleteSession(id) { delete state().sessions[id]; await persist(); },
    getRelationshipContext(userId) { return relationshipContext(userId); },
    // The couple's iMessage group is attached once, only to an active relationship that has none yet; leaving clears it.
    async bindRelationshipGroup(relationshipId, groupId) {
      const relationship = state().relationships[relationshipId];
      if (!relationship || relationship.status !== "active" || relationship.imessageGroupId) return false;
      own(state().relationships, relationshipId).imessageGroupId = groupId; await persist(); return true;
    },
    async createInvitation({ relationship, membership, invitation }) {
      if (state().memberships[membership.userId]) return null;
      state().relationships[relationship.id] = { ...relationship };
      state().memberships[membership.userId] = { ...membership };
      state().invitations[invitation.code] = { ...invitation };
      await persist();
      return relationshipContext(membership.userId);
    },
    getInvitation(code) { return state().invitations[code] ? { ...state().invitations[code] } : null; },
    // A fresh invite for a space that is still waiting for the partner (the first one expired).
    async renewInvitation(invitation) {
      const relationship = state().relationships[invitation.relationshipId];
      if (relationship?.status !== "pending" || state().memberships[invitation.createdByUserId]?.relationshipId !== relationship.id) return null;
      state().invitations[invitation.code] = { ...invitation };
      await persist();
      return relationshipContext(invitation.createdByUserId);
    },
    // Only the first time the link is opened is kept: the inviter sees it, and the partner-join report counts it.
    async markInvitationOpened(code, openedAt) {
      if (!state().invitations[code] || state().invitations[code].openedAt) return;
      own(state().invitations, code).openedAt = openedAt; await persist();
    },
    async listInvitationsForJob() { return Object.values(state().invitations).map((invitation) => ({ ...invitation })); },
    async acceptInvitation(code, userId, acceptedAt) {
      if (!state().invitations[code]) return null;
      const invitation = own(state().invitations, code);
      if (invitation.acceptedAt || invitation.expiresAt <= new Date().toISOString() || invitation.createdByUserId === userId) return null;
      if (state().relationships[invitation.relationshipId]?.status !== "pending") return null;
      const relationship = own(state().relationships, invitation.relationshipId);
      // Someone who made an invite of their own and then accepts their partner's: their solo, still-pending space ends
      // and they join. Their own private records come along, still private; anything else stays with the ended space.
      const mine = state().memberships[userId];
      if (mine) {
        const found = state().relationships[mine.relationshipId];
        if (found?.status !== "pending" || Object.values(state().memberships).some((member) => member.relationshipId === found.id && member.userId !== userId)) return null;
        const solo = own(state().relationships, found.id);
        state().formerMemberships[solo.id] = [{ ...mine }];
        solo.status = "ended"; solo.updatedAt = acceptedAt;
        for (const [key, item] of Object.entries(state().invitations)) if (item.relationshipId === solo.id && !item.acceptedAt) own(state().invitations, key).expiresAt = acceptedAt;
        delete state().memberships[userId];
        for (const collection of GRAPH_COLLECTIONS) for (const [key, record] of Object.entries(state().relationshipGraph[collection])) {
          if (record.relationshipId === solo.id && record.ownerUserId === userId && ["private", "private_surprise"].includes(record.visibility)) own(state().relationshipGraph[collection], key).relationshipId = relationship.id;
        }
      }
      state().memberships[userId] = { userId, relationshipId: relationship.id, role: "B", joinedAt: acceptedAt };
      invitation.acceptedAt = acceptedAt;
      invitation.acceptedByUserId = userId;
      relationship.status = "active";
      relationship.updatedAt = acceptedAt;
      await persist();
      return relationshipContext(userId);
    },
    async createRoom(room) { state().rooms[room.code] = structuredClone(room); await persist(); return structuredClone(room); },
    getRoomByCode(code) { return state().rooms[code] ? structuredClone(state().rooms[code]) : null; },
    getRoomForUser(code, userId) {
      const room = state().rooms[code];
      const membership = state().memberships[userId];
      return room && membership?.relationshipId === room.relationshipId ? structuredClone(room) : null;
    },
    async updateRoomForUser(code, userId, updater) {
      const membership = state().memberships[userId];
      if (!state().rooms[code] || membership?.relationshipId !== state().rooms[code].relationshipId) return null;
      const room = own(state().rooms, code);
      await updater(room);
      room.updatedAt = new Date().toISOString();
      await persist();
      return structuredClone(room);
    },
    listRoomsForUser(userId, status = null) {
      const relationshipId = state().memberships[userId]?.relationshipId;
      if (!relationshipId) return [];
      return Object.values(state().rooms)
        .filter((room) => room.relationshipId === relationshipId && (!status || room.status === status))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((room) => structuredClone(room));
    },
    async createDemoRoom(room) {
      state().demoRooms[room.code] = structuredClone(room);
      await persist();
      return structuredClone(room);
    },
    getDemoRoom(code) { return state().demoRooms[code] ? structuredClone(state().demoRooms[code]) : null; },
    async updateDemoRoom(code, updater) {
      if (!state().demoRooms[code]) return null;
      const room = own(state().demoRooms, code);
      await updater(room);
      room.updatedAt = new Date().toISOString();
      await persist();
      return structuredClone(room);
    },
    async deleteExpiredDemoRooms(now) {
      let changed = false;
      for (const [code, room] of Object.entries(state().demoRooms)) {
        if (room.expiresAt <= now) { delete state().demoRooms[code]; changed = true; }
      }
      if (changed) await persist();
    },
    async finalizeDemoRoom(demoCode, { relationship, memberships, room, convertedAt }) {
      if (!state().demoRooms[demoCode] || state().demoRooms[demoCode].status !== "active" || memberships.some((membership) => state().memberships[membership.userId])) return null;
      const demo = own(state().demoRooms, demoCode);
      state().relationships[relationship.id] = structuredClone(relationship);
      for (const membership of memberships) state().memberships[membership.userId] = structuredClone(membership);
      state().rooms[room.code] = structuredClone(room);
      demo.status = "converted";
      demo.convertedAt = convertedAt;
      demo.convertedRoomCode = room.code;
      demo.updatedAt = convertedAt;
      await persist();
      return { demoRoom: structuredClone(demo), room: structuredClone(room) };
    },
    async createRelationshipRecord(collection, record) {
      assertCollection(collection);
      assertRecordScope(collection, record);
      if (state().relationshipGraph[collection][record.id]) throw Object.assign(new Error("Duplicate record."), { code: "23505" });
      state().relationshipGraph[collection][record.id] = copyEntry(record);
      await persist();
      return copyEntry(record);
    },
    getRelationshipRecordForUser(collection, id, userId) {
      assertCollection(collection);
      const record = state().relationshipGraph[collection][id];
      const membership = state().memberships[userId];
      return accessibleRecord(collection, record, userId) ? copyEntry(record) : null;
    },
    listRelationshipRecordsForUser(collection, userId) {
      assertCollection(collection);
      const relationshipId = state().memberships[userId]?.relationshipId;
      return Object.values(state().relationshipGraph[collection]).filter((record) => accessibleRecord(collection, record, userId)).map(copyEntry);
    },
    async updateRelationshipRecordForUser(collection, id, userId, updater) {
      assertCollection(collection);
      if (!accessibleRecord(collection, state().relationshipGraph[collection][id], userId)) return null;
      const record = own(state().relationshipGraph[collection], id);
      await updater(record);
      assertRecordScope(collection, record);
      record.updatedAt = new Date().toISOString();
      await persist();
      return copyEntry(record);
    },
    async deleteRelationshipRecordForUser(collection, id, userId) {
      assertCollection(collection);
      const record = state().relationshipGraph[collection][id];
      if (!accessibleRecord(collection, record, userId) || record.ownerUserId !== userId) return false;
      delete state().relationshipGraph[collection][id]; await persist(); return true;
    },
    async listRelationshipsForJob() { return Object.values(state().relationships).map((relationship) => ({ ...relationship })); },
    async listRecordsForJob(collection) { assertCollection(collection); return Object.values(state().relationshipGraph[collection]).map(copyEntry); },
    async relationshipSnapshotForUser(userId) {
      const relationshipId = state().memberships[userId]?.relationshipId;
      // Metering rows and archived Us history stay out of every snapshot; archives are read on demand by together-domain.
      return Object.fromEntries(GRAPH_COLLECTIONS.filter((collection) => !["productEvents", "aiUsage", "togetherArchives", "matches", "purchases", "betaCodes"].includes(collection)).map((collection) => [collection, Object.values(state().relationshipGraph[collection]).filter((record) => accessibleRecord(collection, record, userId)).map(copyEntry)]));
    },
  };
  const store = Object.fromEntries(Object.entries(implementation).map(([name, value]) => [name,
    typeof value === "function" && /^(create|update|delete|accept|finalize|leave|consume|bind|unbind|renew|mark)/.test(name)
      ? (...args) => transaction("file", () => value(...args)) : value,
  ]));
  return store;
}

function assertCollection(collection) {
  if (!GRAPH_COLLECTIONS.includes(collection)) throw new Error(`Unsupported relationship collection: ${collection}`);
}

function publicUser(user) {
  return user ? { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt } : null;
}
