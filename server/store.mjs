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
    typeof value === "function" && /^(create|update|delete|accept|finalize)/.test(name)
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
