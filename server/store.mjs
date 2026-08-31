import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createPostgresStore } from "./postgres-store.mjs";

const EMPTY_STATE = () => ({
  version: 2,
  users: {},
  userByEmail: {},
  sessions: {},
  relationships: {},
  memberships: {},
  invitations: {},
  rooms: {},
});

export async function createStore(filePath, databaseUrl = process.env.DATABASE_URL) {
  if (databaseUrl) return createPostgresStore(databaseUrl);
  return createFileStore(filePath);
}

export async function createFileStore(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
  let state = EMPTY_STATE();
  let writeQueue = Promise.resolve();

  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    state = { ...EMPTY_STATE(), ...parsed, version: 2 };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const persist = () => {
    const snapshot = JSON.stringify(state, null, 2);
    const temporaryPath = `${filePath}.tmp`;
    writeQueue = writeQueue.then(async () => {
      await writeFile(temporaryPath, snapshot, "utf8");
      await rename(temporaryPath, filePath);
    });
    return writeQueue;
  };

  const relationshipContext = (userId) => {
    const membership = state.memberships[userId];
    if (!membership) return null;
    const relationship = state.relationships[membership.relationshipId];
    if (!relationship) return null;
    const members = Object.values(state.memberships)
      .filter((candidate) => candidate.relationshipId === relationship.id)
      .map((candidate) => ({ ...candidate, user: publicUser(state.users[candidate.userId]) }));
    const invitation = Object.values(state.invitations).find((candidate) => candidate.relationshipId === relationship.id && !candidate.acceptedAt) || null;
    return { relationship: { ...relationship }, membership: { ...membership }, members, invitation: invitation ? { ...invitation } : null };
  };

  return {
    kind: "file",
    async ping() { return true; },
    getUserByEmail(email) {
      const id = state.userByEmail[email];
      return id ? { ...state.users[id] } : null;
    },
    getUserById(id) { return state.users[id] ? { ...state.users[id] } : null; },
    async createUser(user) {
      if (state.userByEmail[user.email]) return null;
      state.users[user.id] = { ...user };
      state.userByEmail[user.email] = user.id;
      await persist();
      return { ...user };
    },
    async createSession(session) { state.sessions[session.id] = { ...session }; await persist(); return session; },
    getSession(id) {
      const session = state.sessions[id];
      if (!session || session.expiresAt <= new Date().toISOString()) return null;
      return { ...session };
    },
    async deleteSession(id) { delete state.sessions[id]; await persist(); },
    getRelationshipContext(userId) { return relationshipContext(userId); },
    async createInvitation({ relationship, membership, invitation }) {
      if (state.memberships[membership.userId]) return null;
      state.relationships[relationship.id] = { ...relationship };
      state.memberships[membership.userId] = { ...membership };
      state.invitations[invitation.code] = { ...invitation };
      await persist();
      return relationshipContext(membership.userId);
    },
    getInvitation(code) { return state.invitations[code] ? { ...state.invitations[code] } : null; },
    async acceptInvitation(code, userId, acceptedAt) {
      const invitation = state.invitations[code];
      if (!invitation || invitation.acceptedAt || invitation.expiresAt <= acceptedAt || invitation.createdByUserId === userId || state.memberships[userId]) return null;
      const relationship = state.relationships[invitation.relationshipId];
      if (!relationship || relationship.status !== "pending") return null;
      state.memberships[userId] = { userId, relationshipId: relationship.id, role: "B", joinedAt: acceptedAt };
      invitation.acceptedAt = acceptedAt;
      invitation.acceptedByUserId = userId;
      relationship.status = "active";
      relationship.updatedAt = acceptedAt;
      await persist();
      return relationshipContext(userId);
    },
    async createRoom(room) { state.rooms[room.code] = structuredClone(room); await persist(); return structuredClone(room); },
    getRoomByCode(code) { return state.rooms[code] ? structuredClone(state.rooms[code]) : null; },
    getRoomForUser(code, userId) {
      const room = state.rooms[code];
      const membership = state.memberships[userId];
      return room && membership?.relationshipId === room.relationshipId ? structuredClone(room) : null;
    },
    async updateRoomForUser(code, userId, updater) {
      const room = state.rooms[code];
      const membership = state.memberships[userId];
      if (!room || membership?.relationshipId !== room.relationshipId) return null;
      await updater(room);
      room.updatedAt = new Date().toISOString();
      await persist();
      return structuredClone(room);
    },
    listRoomsForUser(userId, status = null) {
      const relationshipId = state.memberships[userId]?.relationshipId;
      if (!relationshipId) return [];
      return Object.values(state.rooms)
        .filter((room) => room.relationshipId === relationshipId && (!status || room.status === status))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((room) => structuredClone(room));
    },
  };
}

function publicUser(user) {
  return user ? { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt } : null;
}
