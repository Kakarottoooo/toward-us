import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createPostgresStore } from "./postgres-store.mjs";
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
  rooms: {},
  demoRooms: {},
  relationshipGraph: Object.fromEntries(GRAPH_COLLECTIONS.map((collection) => [collection, {}])),
});

export async function createStore(filePath, databaseUrl = process.env.DATABASE_URL) {
  if (databaseUrl) return createPostgresStore(databaseUrl);
  return createFileStore(filePath);
}

export async function createFileStore(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
  let committedState = EMPTY_STATE();
  const transactions = new AsyncLocalStorage();
  let transactionQueue = Promise.resolve();
  const state = () => transactions.getStore()?.state || committedState;

  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    committedState = { ...EMPTY_STATE(), ...parsed, version: 5 };
    state().relationshipGraph = Object.fromEntries(GRAPH_COLLECTIONS.map((collection) => [collection, parsed.relationshipGraph?.[collection] || {}]));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const persist = async () => { if (transactions.getStore()) transactions.getStore().dirty = true; };
  const transaction = async (_key, callback) => {
    if (transactions.getStore()) return callback(store);
    const previous = transactionQueue;
    let release;
    transactionQueue = new Promise((resolve) => { release = resolve; });
    await previous;
    const context = { state: structuredClone(committedState), dirty: false };
    try {
      return await transactions.run(context, async () => {
        const result = await callback(store);
        if (context.dirty) {
          await writeFile(`${filePath}.tmp`, JSON.stringify(context.state, null, 2), "utf8");
          await rename(`${filePath}.tmp`, filePath);
          committedState = context.state;
        }
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
    const invitation = Object.values(state().invitations).find((candidate) => candidate.relationshipId === relationship.id && !candidate.acceptedAt) || null;
    return { relationship: { ...relationship }, membership: { ...membership }, members, invitation: invitation ? { ...invitation } : null };
  };

  const implementation = {
    kind: "file",
    transaction,
    async ping() { return true; },
    getUserByEmail(email) {
      const id = state().userByEmail[email];
      return id ? { ...state().users[id] } : null;
    },
    getUserById(id) { return state().users[id] ? { ...state().users[id] } : null; },
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
    async updateUserPassword(userId, passwordHash) { if (!state().users[userId]) return false; state().users[userId].passwordHash = passwordHash; await persist(); return true; },
    async leaveRelationship(userId) {
      const context = relationshipContext(userId); if (!context) return null;
      const id = context.relationship.id;
      const members = context.members.map(({ user, ...member }) => member);
      state().formerMemberships[id] = members;
      state().relationships[id].status = "ended"; state().relationships[id].updatedAt = new Date().toISOString();
      for (const invitation of Object.values(state().invitations)) if (invitation.relationshipId === id) invitation.expiresAt = new Date().toISOString();
      for (const member of members) delete state().memberships[member.userId];
      for (const collection of ["privateAgentThreads", "memories", "checkins"]) for (const record of Object.values(state().relationshipGraph[collection])) {
        if (record.relationshipId === id && record.visibility === "private") { record.relationshipId = null; record.previousRelationshipId = id; record.status = "closed"; record.aiAccessScope = "none"; record.version += 1; }
      }
      await persist(); return { relationshipId: id, memberIds: members.map((member) => member.userId) };
    },
    async getPrivacySnapshot(userId) {
      const ids = new Set(Object.entries(state().formerMemberships).filter(([, members]) => members.some((member) => member.userId === userId)).map(([id]) => id));
      const current = state().memberships[userId]?.relationshipId; if (current) ids.add(current);
      return {
        relationships: [...ids].map((id) => structuredClone(state().relationships[id])),
        graph: Object.fromEntries(GRAPH_COLLECTIONS.map((collection) => [collection, Object.values(state().relationshipGraph[collection]).filter((record) => ids.has(record.relationshipId) || record.ownerUserId === userId).map((record) => structuredClone(record))])),
        rooms: Object.values(state().rooms).filter((room) => ids.has(room.relationshipId)).map((room) => structuredClone(room)),
      };
    },
    async deletePrivateData(userId) {
      let deleted = 0;
      for (const collection of GRAPH_COLLECTIONS) {
        if (["accountSettings", "deliveryPreferences", "consentEvents", "pushSubscriptions", "deliveryJobs"].includes(collection)) continue;
        for (const [id, record] of Object.entries(state().relationshipGraph[collection])) if (record.ownerUserId === userId && ["private", "private_surprise"].includes(record.visibility)) { delete state().relationshipGraph[collection][id]; deleted += 1; }
      }
      for (const room of Object.values(state().rooms)) if (room.analysis?.private) delete room.analysis.private[userId];
      await persist(); return deleted;
    },
    async deleteAccount(userId) {
      await store.leaveRelationship(userId); await store.deletePrivateData(userId); await store.deleteUserSessions(userId);
      for (const collection of ["accountSettings", "deliveryPreferences", "pushSubscriptions", "deliveryJobs"]) for (const [id, record] of Object.entries(state().relationshipGraph[collection])) if (record.ownerUserId === userId) delete state().relationshipGraph[collection][id];
      const user = state().users[userId]; if (!user) return false;
      delete state().userByEmail[user.email]; user.email = `${userId}@deleted.invalid`; user.name = "Deleted user"; user.passwordHash = "deleted";
      for (const room of Object.values(state().rooms)) {
        const participantIds = new Set((room.participants || []).filter((person) => person.userId === userId).map((person) => person.id));
        for (const person of room.participants || []) if (participantIds.has(person.id)) person.name = "Deleted user";
        room.messages = (room.messages || []).filter((message) => !participantIds.has(message.participantId));
        room.aiConversation = (room.aiConversation || []).filter((message) => message.userId !== userId && !participantIds.has(message.participantId));
      }
      await persist(); return true;
    },
    async deleteSession(id) { delete state().sessions[id]; await persist(); },
    getRelationshipContext(userId) { return relationshipContext(userId); },
    async createInvitation({ relationship, membership, invitation }) {
      if (state().memberships[membership.userId]) return null;
      state().relationships[relationship.id] = { ...relationship };
      state().memberships[membership.userId] = { ...membership };
      state().invitations[invitation.code] = { ...invitation };
      await persist();
      return relationshipContext(membership.userId);
    },
    getInvitation(code) { return state().invitations[code] ? { ...state().invitations[code] } : null; },
    async acceptInvitation(code, userId, acceptedAt) {
      const invitation = state().invitations[code];
      if (!invitation || invitation.acceptedAt || invitation.expiresAt <= acceptedAt || invitation.createdByUserId === userId || state().memberships[userId]) return null;
      const relationship = state().relationships[invitation.relationshipId];
      if (!relationship || relationship.status !== "pending") return null;
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
      const room = state().rooms[code];
      const membership = state().memberships[userId];
      if (!room || membership?.relationshipId !== room.relationshipId) return null;
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
      const room = state().demoRooms[code];
      if (!room) return null;
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
      const demo = state().demoRooms[demoCode];
      if (!demo || demo.status !== "active" || memberships.some((membership) => state().memberships[membership.userId])) return null;
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
      state().relationshipGraph[collection][record.id] = structuredClone(record);
      await persist();
      return structuredClone(record);
    },
    getRelationshipRecordForUser(collection, id, userId) {
      assertCollection(collection);
      const record = state().relationshipGraph[collection][id];
      const membership = state().memberships[userId];
      return accessibleRecord(collection, record, userId) ? structuredClone(record) : null;
    },
    listRelationshipRecordsForUser(collection, userId) {
      assertCollection(collection);
      const relationshipId = state().memberships[userId]?.relationshipId;
      return Object.values(state().relationshipGraph[collection]).filter((record) => accessibleRecord(collection, record, userId)).map((record) => structuredClone(record));
    },
    async updateRelationshipRecordForUser(collection, id, userId, updater) {
      assertCollection(collection);
      const record = state().relationshipGraph[collection][id];
      const membership = state().memberships[userId];
      if (!accessibleRecord(collection, record, userId)) return null;
      await updater(record);
      assertRecordScope(collection, record);
      record.updatedAt = new Date().toISOString();
      await persist();
      return structuredClone(record);
    },
    async deleteRelationshipRecordForUser(collection, id, userId) {
      assertCollection(collection);
      const record = state().relationshipGraph[collection][id];
      if (!accessibleRecord(collection, record, userId) || record.ownerUserId !== userId) return false;
      delete state().relationshipGraph[collection][id]; await persist(); return true;
    },
    async listRecordsForJob(collection) { assertCollection(collection); return Object.values(state().relationshipGraph[collection]).map((record) => structuredClone(record)); },
    async relationshipSnapshotForUser(userId) {
      const relationshipId = state().memberships[userId]?.relationshipId;
      return Object.fromEntries(GRAPH_COLLECTIONS.map((collection) => [collection, Object.values(state().relationshipGraph[collection]).filter((record) => accessibleRecord(collection, record, userId)).map((record) => structuredClone(record))]));
    },
  };
  const store = Object.fromEntries(Object.entries(implementation).map(([name, value]) => [name,
    typeof value === "function" && /^(create|update|delete|accept|finalize|leave)/.test(name)
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
