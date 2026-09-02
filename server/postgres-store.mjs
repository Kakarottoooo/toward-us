import { Pool } from "pg";
import { GRAPH_COLLECTIONS } from "./relationship-domain.mjs";

const GRAPH_TABLES = Object.freeze({
  privateAgentThreads: "private_agent_threads",
  milestones: "relationship_milestones", reminders: "reminders", lists: "shared_lists", listItems: "shared_list_items",
  issues: "relationship_issues", perspectives: "issue_perspectives", summaries: "shareable_summaries", proposals: "decision_proposals",
  evaluations: "proposal_evaluations", agreements: "agreements", approvals: "agreement_approvals", commitments: "commitments",
  outcomes: "outcome_reviews", outcomeResponses: "outcome_review_responses", notifications: "notifications",
  consentEvents: "consent_events", productEvents: "product_events",
});

export async function createPostgresStore(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.DB_POOL_SIZE || 5), ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false } });
  await migrate(pool);

  return {
    kind: "postgres",
    async ping() { await pool.query("select 1"); return true; },
    async getUserByEmail(email) { return mapUser((await pool.query("select * from users where email = $1", [email])).rows[0]); },
    async getUserById(id) { return mapUser((await pool.query("select * from users where id = $1", [id])).rows[0]); },
    async createUser(user) {
      const result = await pool.query("insert into users (id,email,name,password_hash,created_at) values ($1,$2,$3,$4,$5) on conflict (email) do nothing returning *", [user.id, user.email, user.name, user.passwordHash, user.createdAt]);
      return mapUser(result.rows[0]);
    },
    async createSession(session) { await pool.query("insert into sessions (id,user_id,created_at,expires_at) values ($1,$2,$3,$4)", [session.id, session.userId, session.createdAt, session.expiresAt]); return session; },
    async getSession(id) { return mapSession((await pool.query("select * from sessions where id = $1 and expires_at > now()", [id])).rows[0]); },
    async deleteSession(id) { await pool.query("delete from sessions where id = $1", [id]); },
    async getRelationshipContext(userId) { return loadRelationshipContext(pool, userId); },
    async createInvitation({ relationship, membership, invitation }) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        if ((await client.query("select 1 from relationship_members where user_id = $1", [membership.userId])).rowCount) { await client.query("rollback"); return null; }
        await client.query("insert into relationships (id,status,created_at,updated_at) values ($1,$2,$3,$4)", [relationship.id, relationship.status, relationship.createdAt, relationship.updatedAt]);
        await client.query("insert into relationship_members (relationship_id,user_id,role,joined_at) values ($1,$2,$3,$4)", [membership.relationshipId, membership.userId, membership.role, membership.joinedAt]);
        await client.query("insert into invitations (code,relationship_id,created_by_user_id,created_at,expires_at) values ($1,$2,$3,$4,$5)", [invitation.code, invitation.relationshipId, invitation.createdByUserId, invitation.createdAt, invitation.expiresAt]);
        await client.query("commit");
        return loadRelationshipContext(pool, membership.userId);
      } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
    },
    async getInvitation(code) { return mapInvitation((await pool.query("select * from invitations where code = $1", [code])).rows[0]); },
    async acceptInvitation(code, userId, acceptedAt) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const invitation = mapInvitation((await client.query("select * from invitations where code = $1 for update", [code])).rows[0]);
        if (!invitation || invitation.acceptedAt || invitation.expiresAt <= acceptedAt || invitation.createdByUserId === userId) { await client.query("rollback"); return null; }
        if ((await client.query("select 1 from relationship_members where user_id = $1", [userId])).rowCount) { await client.query("rollback"); return null; }
        await client.query("insert into relationship_members (relationship_id,user_id,role,joined_at) values ($1,$2,'B',$3)", [invitation.relationshipId, userId, acceptedAt]);
        await client.query("update invitations set accepted_at=$2, accepted_by_user_id=$3 where code=$1", [code, acceptedAt, userId]);
        await client.query("update relationships set status='active', updated_at=$2 where id=$1 and status='pending'", [invitation.relationshipId, acceptedAt]);
        await client.query("commit");
        return loadRelationshipContext(pool, userId);
      } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
    },
    async createRoom(room) { await pool.query("insert into rooms (code,relationship_id,status,payload,created_at,updated_at) values ($1,$2,$3,$4,$5,$6)", [room.code, room.relationshipId, room.status, room, room.createdAt, room.updatedAt]); return structuredClone(room); },
    async getRoomByCode(code) { return (await pool.query("select payload from rooms where code=$1", [code])).rows[0]?.payload || null; },
    async getRoomForUser(code, userId) {
      const result = await pool.query("select r.payload from rooms r join relationship_members m on m.relationship_id=r.relationship_id where r.code=$1 and m.user_id=$2", [code, userId]);
      return result.rows[0]?.payload || null;
    },
    async updateRoomForUser(code, userId, updater) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await client.query("select r.payload from rooms r join relationship_members m on m.relationship_id=r.relationship_id where r.code=$1 and m.user_id=$2 for update of r", [code, userId]);
        if (!result.rowCount) { await client.query("rollback"); return null; }
        const room = result.rows[0].payload;
        await updater(room);
        room.updatedAt = new Date().toISOString();
        await client.query("update rooms set status=$2,payload=$3,updated_at=$4 where code=$1", [code, room.status, room, room.updatedAt]);
        await client.query("commit");
        return room;
      } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
    },
    async listRoomsForUser(userId, status = null) {
      const values = [userId];
      let filter = "";
      if (status) { values.push(status); filter = " and r.status=$2"; }
      const result = await pool.query(`select r.payload from rooms r join relationship_members m on m.relationship_id=r.relationship_id where m.user_id=$1${filter} order by r.updated_at desc`, values);
      return result.rows.map((row) => row.payload);
    },
    async createDemoRoom(room) {
      await pool.query("insert into demo_rooms (code,status,payload,expires_at,created_at,updated_at) values ($1,$2,$3,$4,$5,$6)", [room.code, room.status, room, room.expiresAt, room.createdAt, room.updatedAt]);
      return structuredClone(room);
    },
    async getDemoRoom(code) { return (await pool.query("select payload from demo_rooms where code=$1", [code])).rows[0]?.payload || null; },
    async updateDemoRoom(code, updater) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await client.query("select payload from demo_rooms where code=$1 for update", [code]);
        if (!result.rowCount) { await client.query("rollback"); return null; }
        const room = result.rows[0].payload;
        await updater(room);
        room.updatedAt = new Date().toISOString();
        await client.query("update demo_rooms set status=$2,payload=$3,expires_at=$4,updated_at=$5 where code=$1", [code, room.status, room, room.expiresAt, room.updatedAt]);
        await client.query("commit");
        return room;
      } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
    },
    async deleteExpiredDemoRooms(now) { await pool.query("delete from demo_rooms where expires_at <= $1", [now]); },
    async finalizeDemoRoom(demoCode, { relationship, memberships, room, convertedAt }) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const demoResult = await client.query("select payload from demo_rooms where code=$1 for update", [demoCode]);
        if (!demoResult.rowCount || demoResult.rows[0].payload.status !== "active") { await client.query("rollback"); return null; }
        const userIds = memberships.map((membership) => membership.userId);
        if ((await client.query("select 1 from relationship_members where user_id = any($1::text[]) limit 1", [userIds])).rowCount) { await client.query("rollback"); return null; }
        await client.query("insert into relationships (id,status,created_at,updated_at) values ($1,$2,$3,$4)", [relationship.id, relationship.status, relationship.createdAt, relationship.updatedAt]);
        for (const membership of memberships) await client.query("insert into relationship_members (relationship_id,user_id,role,joined_at) values ($1,$2,$3,$4)", [membership.relationshipId, membership.userId, membership.role, membership.joinedAt]);
        await client.query("insert into rooms (code,relationship_id,status,payload,created_at,updated_at) values ($1,$2,$3,$4,$5,$6)", [room.code, room.relationshipId, room.status, room, room.createdAt, room.updatedAt]);
        const demo = demoResult.rows[0].payload;
        demo.status = "converted";
        demo.convertedAt = convertedAt;
        demo.convertedRoomCode = room.code;
        demo.updatedAt = convertedAt;
        await client.query("update demo_rooms set status=$2,payload=$3,updated_at=$4 where code=$1", [demoCode, demo.status, demo, demo.updatedAt]);
        await client.query("commit");
        return { demoRoom: demo, room };
      } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
    },
    async createRelationshipRecord(collection, record) {
      const table = graphTable(collection);
      const result = await pool.query(`insert into ${table} (id,relationship_id,created_by_user_id,owner_user_id,visibility,status,version,due_at,review_at,expires_at,data,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`, graphValues(record));
      return mapGraphRecord(result.rows[0]);
    },
    async getRelationshipRecordForUser(collection, id, userId) {
      const table = graphTable(collection);
      const result = await pool.query(`select r.* from ${table} r join relationship_members m on m.relationship_id=r.relationship_id where r.id=$1 and m.user_id=$2`, [id, userId]);
      return mapGraphRecord(result.rows[0]);
    },
    async listRelationshipRecordsForUser(collection, userId) {
      const table = graphTable(collection);
      const result = await pool.query(`select r.* from ${table} r join relationship_members m on m.relationship_id=r.relationship_id where m.user_id=$1 order by r.created_at desc`, [userId]);
      return result.rows.map(mapGraphRecord);
    },
    async updateRelationshipRecordForUser(collection, id, userId, updater) {
      const table = graphTable(collection);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await client.query(`select r.* from ${table} r join relationship_members m on m.relationship_id=r.relationship_id where r.id=$1 and m.user_id=$2 for update of r`, [id, userId]);
        if (!result.rowCount) { await client.query("rollback"); return null; }
        const record = mapGraphRecord(result.rows[0]);
        await updater(record);
        record.updatedAt = new Date().toISOString();
        const updated = await client.query(`update ${table} set owner_user_id=$2,visibility=$3,status=$4,version=$5,due_at=$6,review_at=$7,expires_at=$8,data=$9,updated_at=$10 where id=$1 returning *`, [record.id, record.ownerUserId, record.visibility, record.status, record.version, record.dueAt || null, record.reviewAt || null, record.expiresAt || null, record, record.updatedAt]);
        await client.query("commit");
        return mapGraphRecord(updated.rows[0]);
      } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
    },
    async relationshipSnapshotForUser(userId) {
      const context = await loadRelationshipContext(pool, userId);
      if (!context) return null;
      const entries = await Promise.all(GRAPH_COLLECTIONS.map(async (collection) => {
        const table = graphTable(collection);
        const rows = (await pool.query(`select * from ${table} where relationship_id=$1 order by created_at desc`, [context.relationship.id])).rows.map(mapGraphRecord);
        return [collection, rows];
      }));
      return Object.fromEntries(entries);
    },
  };
}

async function loadRelationshipContext(client, userId) {
  const membershipResult = await client.query("select * from relationship_members where user_id=$1", [userId]);
  if (!membershipResult.rowCount) return null;
  const membership = mapMembership(membershipResult.rows[0]);
  const relationship = mapRelationship((await client.query("select * from relationships where id=$1", [membership.relationshipId])).rows[0]);
  const members = (await client.query("select m.*,u.email,u.name,u.created_at as user_created_at from relationship_members m join users u on u.id=m.user_id where m.relationship_id=$1 order by m.role", [membership.relationshipId])).rows.map((row) => ({ ...mapMembership(row), user: { id: row.user_id, email: row.email, name: row.name, createdAt: iso(row.user_created_at) } }));
  const invitation = mapInvitation((await client.query("select * from invitations where relationship_id=$1 and accepted_at is null order by created_at desc limit 1", [membership.relationshipId])).rows[0]);
  return { relationship, membership, members, invitation };
}

async function migrate(pool) {
  await pool.query(`
    create table if not exists users (id text primary key, email text not null unique, name text not null, password_hash text not null, created_at timestamptz not null);
    create table if not exists sessions (id text primary key, user_id text not null references users(id) on delete cascade, created_at timestamptz not null, expires_at timestamptz not null);
    create index if not exists sessions_expiry_idx on sessions(expires_at);
    create table if not exists relationships (id text primary key, status text not null check (status in ('pending','active')), created_at timestamptz not null, updated_at timestamptz not null);
    create table if not exists relationship_members (relationship_id text not null references relationships(id) on delete cascade, user_id text primary key references users(id) on delete cascade, role text not null check (role in ('A','B')), joined_at timestamptz not null, unique(relationship_id,role));
    create table if not exists invitations (code text primary key, relationship_id text not null references relationships(id) on delete cascade, created_by_user_id text not null references users(id), created_at timestamptz not null, expires_at timestamptz not null, accepted_at timestamptz, accepted_by_user_id text references users(id));
    create table if not exists rooms (code text primary key, relationship_id text not null references relationships(id) on delete cascade, status text not null, payload jsonb not null, created_at timestamptz not null, updated_at timestamptz not null);
    create index if not exists rooms_relationship_status_idx on rooms(relationship_id,status,updated_at desc);
    create table if not exists demo_rooms (code text primary key, status text not null, payload jsonb not null, expires_at timestamptz not null, created_at timestamptz not null, updated_at timestamptz not null);
    create index if not exists demo_rooms_expiry_idx on demo_rooms(expires_at);
  `);
  for (const table of Object.values(GRAPH_TABLES)) {
    await pool.query(`
      create table if not exists ${table} (
        id text primary key,
        relationship_id text not null references relationships(id) on delete cascade,
        created_by_user_id text not null references users(id),
        owner_user_id text not null references users(id),
        visibility text not null,
        status text not null,
        version integer not null default 1,
        due_at timestamptz,
        review_at timestamptz,
        expires_at timestamptz,
        data jsonb not null,
        created_at timestamptz not null,
        updated_at timestamptz not null
      );
      create index if not exists ${table}_relationship_status_idx on ${table}(relationship_id,status,created_at desc);
      create index if not exists ${table}_owner_idx on ${table}(owner_user_id,created_at desc);
      create index if not exists ${table}_due_idx on ${table}(due_at) where due_at is not null;
      create index if not exists ${table}_review_idx on ${table}(review_at) where review_at is not null;
      create index if not exists ${table}_expiry_idx on ${table}(expires_at) where expires_at is not null;
    `);
  }
}

function graphTable(collection) {
  const table = GRAPH_TABLES[collection];
  if (!table) throw new Error(`Unsupported relationship collection: ${collection}`);
  return table;
}

function graphValues(record) {
  return [record.id, record.relationshipId, record.createdByUserId, record.ownerUserId, record.visibility, record.status, record.version, record.dueAt || null, record.reviewAt || null, record.expiresAt || null, record, record.createdAt, record.updatedAt];
}

function mapGraphRecord(row) {
  if (!row) return null;
  return { ...row.data, id: row.id, relationshipId: row.relationship_id, createdByUserId: row.created_by_user_id, ownerUserId: row.owner_user_id, visibility: row.visibility, status: row.status, version: row.version, dueAt: iso(row.due_at) || row.data?.dueAt || null, reviewAt: iso(row.review_at) || row.data?.reviewAt || null, expiresAt: iso(row.expires_at) || row.data?.expiresAt || null, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

const iso = (value) => value ? new Date(value).toISOString() : null;
const mapUser = (row) => row ? { id: row.id, email: row.email, name: row.name, passwordHash: row.password_hash, createdAt: iso(row.created_at) } : null;
const mapSession = (row) => row ? { id: row.id, userId: row.user_id, createdAt: iso(row.created_at), expiresAt: iso(row.expires_at) } : null;
const mapRelationship = (row) => row ? { id: row.id, status: row.status, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) } : null;
const mapMembership = (row) => row ? { relationshipId: row.relationship_id, userId: row.user_id, role: row.role, joinedAt: iso(row.joined_at) } : null;
const mapInvitation = (row) => row ? { code: row.code, relationshipId: row.relationship_id, createdByUserId: row.created_by_user_id, createdAt: iso(row.created_at), expiresAt: iso(row.expires_at), acceptedAt: iso(row.accepted_at), acceptedByUserId: row.accepted_by_user_id || null } : null;
