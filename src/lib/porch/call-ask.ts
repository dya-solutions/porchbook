import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function parseSeed(input: unknown): Seed {
  const raw = asRecord(input);
  return {
    displayName: typeof raw.displayName === "string" ? clip(raw.displayName, 80) : "",
    email: typeof raw.email === "string" ? clip(raw.email, 200) : null,
    imageUrl: typeof raw.imageUrl === "string" ? clip(raw.imageUrl, 500) : null,
  };
}

export async function ensureCallAsk(sql: Sql) {
  await sql`
    create table if not exists call_permissions (
      owner_id text not null references profiles (user_id) on delete cascade,
      caller_id text not null references profiles (user_id) on delete cascade,
      status text not null default 'pending',
      created_at timestamptz not null default now(),
      primary key (owner_id, caller_id)
    )
  `;
}

export async function ensureCallRing(sql: Sql) {
  await sql`
    create table if not exists call_rings (
      callee_id text primary key,
      caller_id text not null,
      caller_name text not null,
      created_at timestamptz not null default now()
    )
  `;
  await sql`alter table call_rings add column if not exists kind text not null default 'voice'`;
  await sql`
    create table if not exists call_log (
      id serial primary key,
      caller_id text not null,
      callee_id text not null,
      kind text not null,
      status text not null,
      started_at timestamptz not null default now(),
      ended_at timestamptz
    )
  `;
}

export async function pairCallAllowed(sql: Sql, groupId: number, userId: string): Promise<boolean> {
  await ensureCallAsk(sql);
  const rows = await sql<{ kind: string | null; pair_key: string | null }>`
    select kind, pair_key from groups where id = ${groupId}
  `;
  const group = rows[0];
  if (!group || group.kind !== "pair" || !group.pair_key) return true;
  const other = group.pair_key.split("\n").find((id) => id && id !== userId);
  if (!other) return false;
  return group.pair_key.split("\n").includes(userId);
}

export const askToCall = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      userId: typeof raw.userId === "string" ? clip(raw.userId, 120) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.userId) return { ok: false as const, error: "Choose someone." };
    if (data.userId === context.userId) return { ok: false as const, error: "You can't call yourself." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureCallAsk(sql);
    const found = await sql<{ user_id: string }>`select user_id from profiles where user_id = ${data.userId} and same_porch(user_id, ${context.userId})`;
    if (!found.length) return { ok: false as const, error: "You can only call people in your porch." };
    const existing = await sql<{ status: string }>`
      select status from call_permissions
      where owner_id = ${data.userId} and caller_id = ${context.userId}
    `;
    const status = existing[0]?.status;
    if (status === "allowed") return { ok: true as const, state: "allowed" as const };
    if (status === "pending") return { ok: true as const, state: "pending" as const };
    await sql`
      insert into call_permissions (owner_id, caller_id, status)
      values (${data.userId}, ${context.userId}, 'pending')
      on conflict (owner_id, caller_id) do nothing
    `;
    const { notifyCallAsk } = await import("@/lib/porch/push.server");
    await notifyCallAsk(sql, data.userId, context.userId);
    return { ok: true as const, state: "pending" as const };
  });

export const callPermit = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      userId: typeof raw.userId === "string" ? clip(raw.userId, 120) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.userId) return { ok: false as const, state: "none" as const };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureCallAsk(sql);
    const rows = await sql<{ status: string }>`
      select status from call_permissions
      where owner_id = ${data.userId} and caller_id = ${context.userId}
    `;
    const status = rows[0]?.status;
    if (status === "allowed") return { ok: true as const, state: "allowed" as const };
    if (status === "pending") return { ok: true as const, state: "pending" as const };
    return { ok: true as const, state: "none" as const };
  });

export type CallPerson = { userId: string; name: string; imageUrl: string | null };

export const listCallAsks = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await ensureCallAsk(sql);
    const rows = await sql.query<{
      user_id: string;
      display_name: string;
      image_url: string | null;
      status: string;
    }>(
      `select p.user_id, p.display_name, p.image_url, c.status
       from call_permissions c
       join profiles p on p.user_id = c.caller_id
       where c.owner_id = $1
       order by c.created_at desc`,
      [context.userId],
    );
    const asks: CallPerson[] = [];
    const allowed: CallPerson[] = [];
    for (const row of rows) {
      const person = { userId: row.user_id, name: row.display_name, imageUrl: row.image_url };
      if (row.status === "allowed") allowed.push(person);
      else asks.push(person);
    }
    return { asks, allowed };
  });

export const answerCallAsk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      callerId: typeof raw.callerId === "string" ? clip(raw.callerId, 120) : "",
      allow: raw.allow === true,
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.callerId) return { ok: false as const, error: "Choose a person." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureCallAsk(sql);
    if (data.allow) {
      const updated = await sql<{ caller_id: string }>`
        update call_permissions set status = 'allowed'
        where owner_id = ${context.userId} and caller_id = ${data.callerId}
        returning caller_id
      `;
      if (!updated.length) return { ok: false as const, error: "That request is not here." };
      return { ok: true as const };
    }
    await sql`
      delete from call_permissions
      where owner_id = ${context.userId} and caller_id = ${data.callerId}
    `;
    return { ok: true as const };
  });

export const revokeCall = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      callerId: typeof raw.callerId === "string" ? clip(raw.callerId, 120) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.callerId) return { ok: false as const, error: "Choose a person." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureCallAsk(sql);
    await sql`
      delete from call_permissions
      where owner_id = ${context.userId} and caller_id = ${data.callerId}
    `;
    return { ok: true as const };
  });

export const ringPerson = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      userId: typeof raw.userId === "string" ? clip(raw.userId, 120) : "",
      video: raw.video === true,
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.userId || data.userId === context.userId) return { ok: false as const };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    // Calls only between members of the same church porch.
    const same = await sql<{ ok: unknown }>`select same_porch(${context.userId}, ${data.userId}) as ok`;
    if (!(same[0]?.ok === true || same[0]?.ok === "t")) return { ok: false as const };
    await ensureCallAsk(sql);
    await ensureCallRing(sql);
    const pairKey = [context.userId, data.userId].sort().join("\n");
    const pair = await sql<{ id: number }>`select id from groups where pair_key = ${pairKey} limit 1`;
    const pairId = pair[0]?.id ?? 0;
    const busy = await sql<{ user_id: string }>`
      select user_id from call_peers
      where user_id = ${data.userId}
        and updated_at > now() - interval '20 seconds'
        and group_id <> ${pairId}
      limit 1
    `;
    if (busy.length) return { ok: false as const, busy: true as const };
    const me = await sql<{ display_name: string }>`select display_name from profiles where user_id = ${context.userId}`;
    const name = me[0]?.display_name?.trim() || "Someone";
    const kind = data.video ? "video" : "voice";
    if (pairId) await sql`delete from call_signals where group_id = ${pairId}`;
    await sql`
      insert into call_rings (callee_id, caller_id, caller_name, kind, created_at)
      values (${data.userId}, ${context.userId}, ${name}, ${kind}, now())
      on conflict (callee_id) do update
        set caller_id = excluded.caller_id, caller_name = excluded.caller_name, kind = excluded.kind, created_at = now()
    `;
    const inserted = await sql<{ id: number }>`
      insert into call_log (caller_id, callee_id, kind, status)
      values (${context.userId}, ${data.userId}, ${kind}, 'calling')
      returning id
    `;
    const callId = inserted[0]?.id ?? 0;
    const { notifyIncomingCall } = await import("@/lib/porch/push.server");
    await notifyIncomingCall(sql, data.userId, context.userId, data.video);
    return { ok: true as const, callId };
  });

export async function lookupRing(sql: Sql, userId: string) {
  await ensureCallRing(sql);
  await sql`
    update call_log set status = 'missed', ended_at = now()
    where status = 'calling' and started_at < now() - interval '90 seconds'
  `;
  await sql`delete from call_rings where created_at < now() - interval '90 seconds'`;
  const rows = await sql<{ caller_id: string; caller_name: string; kind: string | null; created_at: Date | string; image_url: string | null }>`
    select r.caller_id, r.caller_name, r.kind, r.created_at, p.image_url
    from call_rings r
    left join profiles p on p.user_id = r.caller_id
    where r.callee_id = ${userId}
  `;
  const ring = rows[0];
  if (!ring) return null;
  const at = ring.created_at instanceof Date ? ring.created_at.toISOString() : String(ring.created_at);
  return { userId: ring.caller_id, name: ring.caller_name, imageUrl: ring.image_url, at, video: ring.kind === "video" };
}

export const incomingCall = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    const call = await lookupRing(sql, context.userId);
    return { call };
  });

export const dismissCall = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { ...parseSeed(raw), answered: raw.answered === true };
  })
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await ensureCallRing(sql);
    await sql`delete from call_rings where callee_id = ${context.userId}`;
    if (!seed.answered) {
      await sql`
        update call_log set status = 'declined', ended_at = now()
        where id = (
          select id from call_log
          where callee_id = ${context.userId} and status = 'calling'
          order by started_at desc
          limit 1
        )
      `;
    } else {
      await sql`
        update call_log set status = 'answered'
        where id = (
          select id from call_log
          where callee_id = ${context.userId} and status = 'calling'
          order by started_at desc
          limit 1
        )
      `;
    }
    return { ok: true as const };
  });

export const finishCall = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const status = raw.status === "missed" || raw.status === "cancelled" || raw.status === "completed" ? raw.status : "";
    return {
      userId: typeof raw.userId === "string" ? clip(raw.userId, 120) : "",
      status,
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.userId || !data.status) return { ok: false as const };
    const sql = await getSql();
    await ensureCallRing(sql);
    await sql`
      delete from call_rings
      where (caller_id = ${context.userId} and callee_id = ${data.userId})
         or (caller_id = ${data.userId} and callee_id = ${context.userId})
    `;
    await sql`
      update call_log set status = ${data.status}, ended_at = now()
      where id = (
        select id from call_log
        where status in ('calling', 'answered')
          and (
            (caller_id = ${context.userId} and callee_id = ${data.userId})
            or (caller_id = ${data.userId} and callee_id = ${context.userId})
          )
        order by started_at desc
        limit 1
      )
    `;
    return { ok: true as const };
  });

export const listCalls = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await ensureCallRing(sql);
    const rows = await sql.query<{
      id: number;
      other_id: string;
      other_name: string;
      kind: string;
      status: string;
      direction: string;
      started_at: Date | string;
      ended_at: Date | string | null;
    }>(
      `select c.id, c.kind, c.status, c.started_at, c.ended_at,
              case when c.caller_id = $1 then 'out' else 'in' end as direction,
              case when c.caller_id = $1 then c.callee_id else c.caller_id end as other_id,
              coalesce(p.display_name, 'Teammate') as other_name
       from call_log c
       left join profiles p on p.user_id = case when c.caller_id = $1 then c.callee_id else c.caller_id end
       where c.caller_id = $1 or c.callee_id = $1
       order by c.started_at desc
       limit 20`,
      [context.userId],
    );
    return {
      calls: rows.map((row) => {
        const started = row.started_at instanceof Date ? row.started_at.getTime() : Date.parse(String(row.started_at));
        const ended = row.ended_at instanceof Date ? row.ended_at.getTime() : row.ended_at ? Date.parse(String(row.ended_at)) : 0;
        return {
          id: row.id,
          userId: row.other_id,
          name: row.other_name,
          kind: row.kind === "video" ? "video" : "voice",
          status: row.status,
          direction: row.direction === "out" ? "out" : "in",
          seconds: ended > started ? Math.round((ended - started) / 1000) : 0,
          at: row.started_at instanceof Date ? row.started_at.toISOString() : String(row.started_at),
        };
      }),
    };
  });
