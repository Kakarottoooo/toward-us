import { Pool } from "pg";

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
  `);
}

const iso = (value) => value ? new Date(value).toISOString() : null;
const mapUser = (row) => row ? { id: row.id, email: row.email, name: row.name, passwordHash: row.password_hash, createdAt: iso(row.created_at) } : null;
const mapSession = (row) => row ? { id: row.id, userId: row.user_id, createdAt: iso(row.created_at), expiresAt: iso(row.expires_at) } : null;
const mapRelationship = (row) => row ? { id: row.id, status: row.status, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) } : null;
const mapMembership = (row) => row ? { relationshipId: row.relationship_id, userId: row.user_id, role: row.role, joinedAt: iso(row.joined_at) } : null;
const mapInvitation = (row) => row ? { code: row.code, relationshipId: row.relationship_id, createdByUserId: row.created_by_user_id, createdAt: iso(row.created_at), expiresAt: iso(row.expires_at), acceptedAt: iso(row.accepted_at), acceptedByUserId: row.accepted_by_user_id || null } : null;
