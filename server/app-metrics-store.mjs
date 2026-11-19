const DAY = 86_400_000;
const dateAt = (milliseconds) => new Date(milliseconds).toISOString().slice(0, 10);

// A cold launch may precede the first foreground session. Every field is idempotent, so a replay
// or a background notification arriving before its foreground notification yields the same session.
export function fileAppMetrics(state, persist) {
  return {
    async createAppLifecycleRecord({ sessionKey, kind, at }, userId) {
      const data = state();
      const session = { ...data.appMetricSessions[sessionKey] };
      if (kind === "open" && (!session.opened || at < session.opened)) session.opened = at;
      if (kind === "foreground" && (!session.started || at < session.started)) session.started = at;
      if (kind === "background" && (!session.ended || at < session.ended)) session.ended = at;
      if (kind !== "open" && (!session.last || at > session.last)) session.last = at;
      data.appMetricSessions[sessionKey] = session;
      if (userId && data.users[userId] && data.users[userId].passwordHash !== "deleted") {
        const date = at.slice(0, 10);
        data.appMetricActivity[date + ":" + userId] = { date, userId };
      }
      await persist();
    },
    async createAppCrashSummary(record) {
      state().appMetricCrashes[record.id] ??= record;
      await persist();
    },
    getAppMetricDays(from, to) {
      const data = state(), days = new Map();
      const first = Date.parse(from), after = Date.parse(to) + DAY;
      for (let time = first; time < after; time += DAY) {
        const date = dateAt(time);
        days.set(date, { date, new_users: 0, active_users: 0, opens: 0, sessions: 0, total_session_seconds: 0 });
      }
      for (const { createdAt } of Object.values(data.users)) {
        const day = days.get(createdAt.slice(0, 10));
        if (day) day.new_users++;
      }
      for (const { date } of Object.values(data.appMetricActivity)) {
        const day = days.get(date);
        if (day) day.active_users++;
      }
      for (const session of Object.values(data.appMetricSessions)) {
        const openDay = days.get(session.opened?.slice(0, 10));
        if (openDay) openDay.opens++;
        if (!session.started) continue;
        const startDay = days.get(session.started.slice(0, 10));
        if (startDay) startDay.sessions++;
        let cursor = Math.max(first, Date.parse(session.started));
        const stop = Math.min(after, Date.parse(session.ended || session.last));
        while (cursor < stop) {
          const next = Math.min(stop, (Math.floor(cursor / DAY) + 1) * DAY);
          days.get(dateAt(cursor)).total_session_seconds += next - cursor;
          cursor = next;
        }
      }
      return Array.from(days.values(), (day) => ({ ...day, total_session_seconds: Math.floor(day.total_session_seconds / 1000) }));
    },
  };
}

export async function migrateAppMetrics(pool) {
  await pool.query(`
    create index if not exists app_metric_registrations_idx on users(created_at);
    create table if not exists app_metric_sessions (
      session_key text primary key, opened_at timestamptz, started_at timestamptz,
      last_seen_at timestamptz, ended_at timestamptz
    );
    create index if not exists app_metric_opened_idx on app_metric_sessions(opened_at) where opened_at is not null;
    create index if not exists app_metric_started_idx on app_metric_sessions(started_at) where started_at is not null;
    create index if not exists app_metric_last_idx on app_metric_sessions(last_seen_at) where last_seen_at is not null;
    create table if not exists app_metric_activity (
      date date not null, user_id text not null references users(id) on delete cascade, primary key(date, user_id)
    );
    create index if not exists app_metric_activity_user_idx on app_metric_activity(user_id);
    create table if not exists app_metric_crashes (
      event_id uuid primary key, occurred_at timestamptz not null, build text not null, crashes jsonb not null
    );
  `);
}

export function postgresAppMetrics(pool) {
  return {
    async createAppLifecycleRecord({ sessionKey, kind, at }, userId) {
      // One statement commits a session update and active-account marker together. Only the date
      // marker identifies an account; neither the session timeline nor crash diagnostics identify it.
      await pool.query(`
        with session_write as (
          insert into app_metric_sessions(session_key,opened_at,started_at,last_seen_at,ended_at)
          values ($1,case when $2='open' then $3::timestamptz end,
                     case when $2='foreground' then $3::timestamptz end,
                     case when $2<>'open' then $3::timestamptz end,
                     case when $2='background' then $3::timestamptz end)
          on conflict(session_key) do update set
            opened_at=least(app_metric_sessions.opened_at,excluded.opened_at),
            started_at=least(app_metric_sessions.started_at,excluded.started_at),
            last_seen_at=greatest(app_metric_sessions.last_seen_at,excluded.last_seen_at),
            ended_at=least(app_metric_sessions.ended_at,excluded.ended_at)
        ), account as (
          select id from users where id=$4 and password_hash <> 'deleted' for share
        )
        insert into app_metric_activity(date,user_id)
        select ($3::timestamptz at time zone 'UTC')::date, id from account on conflict do nothing
      `, [sessionKey, kind, at, userId]);
    },
    async createAppCrashSummary({ id, at, build, crashes }) {
      await pool.query("insert into app_metric_crashes(event_id,occurred_at,build,crashes) values ($1,$2,$3,$4) on conflict do nothing", [id, at, build, JSON.stringify(crashes)]);
    },
    async getAppMetricDays(from, to) {
      // Clip at each UTC midnight. Unfinished sessions contribute only up to their last observed
      // foreground heartbeat. A missing background callback cannot create imaginary screen time.
      const result = await pool.query(`
        with days as (
          select day::date as date, day at time zone 'UTC' as lo, (day + interval '1 day') at time zone 'UTC' as hi
          from generate_series($1::date::timestamp, $2::date::timestamp, interval '1 day') as d(day)
        )
        select date::text as date,
          (select count(*) from users where created_at >= lo and created_at < hi) as new_users,
          (select count(*) from app_metric_activity a where a.date=d.date) as active_users,
          (select count(*) from app_metric_sessions where opened_at >= lo and opened_at < hi) as opens,
          (select count(*) from app_metric_sessions where started_at >= lo and started_at < hi) as sessions,
          (select coalesce(floor(sum(extract(epoch from least(coalesce(ended_at,last_seen_at),hi)-greatest(started_at,lo)))),0)
           from app_metric_sessions where started_at < hi and last_seen_at > lo
           and coalesce(ended_at,last_seen_at) > greatest(started_at,lo)) as total_session_seconds
        from days d order by date
      `, [from, to]);
      return result.rows.map((row) => ({
        date: row.date, new_users: Number(row.new_users), active_users: Number(row.active_users),
        opens: Number(row.opens), sessions: Number(row.sessions), total_session_seconds: Number(row.total_session_seconds),
      }));
    },
  };
}
