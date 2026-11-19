import { createServerFn } from "@tanstack/react-start";
import { shown } from "@/lib/porch/on-hold";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import { iceConfigFor } from "@/lib/porch/ice-config.server";
import { ensureCallAsk, ensureCallRing, pairCallAllowed } from "@/lib/porch/call-ask";
import type { Seed } from "@/lib/porch/model";

export type GroupSummary = {
  id: number;
  name: string;
  purpose: string;
  ownerId: string;
  ownerName: string;
  joined: boolean;
};

export type GroupMember = {
  userId: string;
  displayName: string;
  imageUrl: string | null;
  role: string;
  owner: boolean;
};

export type GroupNote = {
  id: number;
  authorId: string;
  authorName: string;
  authorImage: string | null;
  body: string;
  createdAt: string;
};

export type GroupPage = {
  id: number;
  name: string;
  owner: boolean;
  members: GroupMember[];
  others: GroupMember[];
  notes: GroupNote[];
};

export type CallSignalKind = "offer" | "answer" | "ice";

export type CallSignal = {
  id: number;
  fromId: string;
  kind: CallSignalKind;
  payload: string;
};

const CALL_LIMIT = 6;

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function parseId(value: unknown): number | null {
  const n = num(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function yes(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

function parseSeed(input: unknown): Seed {
  const raw = asRecord(input);
  const nested = asRecord(raw.seed);
  const source = nested.displayName || nested.email ? nested : raw;
  const emailRaw = typeof source.email === "string" ? source.email.trim().slice(0, 200) : "";
  return {
    displayName: typeof source.displayName === "string" ? clip(source.displayName, 60) : "",
    email: emailRaw.includes("@") ? emailRaw : null,
    imageUrl: null,
  };
}

async function ensureGroups(sql: Sql) {
  await sql`alter table groups add column if not exists purpose text not null default ''`;
  await sql`alter table groups add column if not exists category text not null default 'Bible Study'`;
  await sql`alter table groups add column if not exists privacy text not null default 'public'`;
  await sql`alter table groups add column if not exists join_mode text not null default 'open'`;
  await sql`alter table groups add column if not exists post_mode text not null default 'members'`;
  await sql`alter table groups add column if not exists rules text not null default ''`;
  await sql`alter table groups add column if not exists where_at text not null default ''`;
  await sql`alter table groups add column if not exists cover_url text not null default ''`;
  await sql`alter table group_members add column if not exists member_role text not null default 'member'`;
  await sql`alter table group_members add column if not exists status text not null default 'active'`;
  await sql`alter table group_notes add column if not exists kind text not null default 'discussion'`;
  await sql`alter table group_notes add column if not exists scripture text not null default ''`;
  await sql`alter table group_notes add column if not exists verse_text text not null default ''`;
  await sql`alter table group_notes add column if not exists pinned boolean not null default false`;
  await sql`alter table group_notes add column if not exists hidden boolean not null default false`;
  await sql`alter table group_notes add column if not exists locked boolean not null default false`;
  await sql`alter table group_notes add column if not exists answered boolean not null default false`;
  await sql`alter table group_notes add column if not exists helpful boolean not null default false`;
  await sql`alter table group_notes add column if not exists parent_id integer`;
  await sql`alter table group_notes add column if not exists event_when text not null default ''`;
  await sql`alter table group_notes add column if not exists event_place text not null default ''`;
  await sql`
    create table if not exists group_marks (
      note_id integer not null references group_notes (id) on delete cascade,
      user_id text not null,
      kind text not null,
      primary key (note_id, user_id, kind)
    )
  `;
  await sql`
    create table if not exists group_follows (
      group_id integer not null references groups (id) on delete cascade,
      user_id text not null references profiles (user_id) on delete cascade,
      primary key (group_id, user_id)
    )
  `;
  await sql`
    create table if not exists group_studies (
      id serial primary key,
      group_id integer not null references groups (id) on delete cascade,
      title text not null,
      detail text not null default '',
      passage text not null default '',
      days integer not null default 1,
      start_on date,
      created_at timestamptz not null default now()
    )
  `;
  await sql`
    create table if not exists group_study_done (
      study_id integer not null references group_studies (id) on delete cascade,
      user_id text not null,
      day_no integer not null,
      primary key (study_id, user_id, day_no)
    )
  `;
  await sql`
    create table if not exists group_reports (
      note_id integer not null references group_notes (id) on delete cascade,
      user_id text not null,
      created_at timestamptz not null default now(),
      primary key (note_id, user_id)
    )
  `;
}

async function membership(sql: Sql, groupId: number, userId: string) {
  await ensureGroups(sql);
  const rows = await sql<{ id: number; name: string; owner_id: string }>`
    select g.id, g.name, g.owner_id
    from groups g
    join group_members m on m.group_id = g.id and m.user_id = ${userId} and coalesce(m.status, 'active') = 'active'
    where g.id = ${groupId} and g.porch_id = my_porch(${userId})
  `;
  return rows[0] ?? null;
}

async function pairOnly(sql: Sql, groupId: number, userId: string): Promise<boolean> {
  const rows = await sql<{ kind: string | null }>`select kind from groups where id = ${groupId}`;
  if (rows[0]?.kind !== "pair") return true;
  return pairCallAllowed(sql, groupId, userId);
}

export const listGroups = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await ensureGroups(sql);
    const rows = await sql<{
      id: number;
      name: string;
      purpose: string | null;
      owner_id: string;
      owner_name: string;
      joined: unknown;
    }>`
      select g.id, g.name, g.purpose, g.owner_id, p.display_name as owner_name,
             exists (
               select 1 from group_members m
               where m.group_id = g.id and m.user_id = ${context.userId}
             ) as joined
      from groups g
      join profiles p on p.user_id = g.owner_id
      where g.kind = 'personal' and g.porch_id = my_porch(${context.userId})
      order by g.created_at desc
    `;
    const groups: GroupSummary[] = rows.map((row) => ({
      id: num(row.id),
      name: row.name,
      purpose: row.purpose ?? "",
      ownerId: row.owner_id,
      ownerName: row.owner_name,
      joined: yes(row.joined),
    }));
    return { groups };
  });

export const createGroup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      name: typeof raw.name === "string" ? clip(raw.name, 40) : "",
      purpose: typeof raw.purpose === "string" ? clip(raw.purpose, 280) : "",
      category: typeof raw.category === "string" ? clip(raw.category, 40) : "Bible Study",
      privacy: raw.privacy === "private" ? "private" : "public",
      joinMode: raw.joinMode === "approval" ? "approval" : "open",
      postMode: raw.postMode === "admin" ? "admin" : "members",
      rules: typeof raw.rules === "string" ? clip(raw.rules, 600) : "",
      whereAt: typeof raw.whereAt === "string" ? clip(raw.whereAt, 80) : "",
      cover: typeof raw.cover === "string" && raw.cover.trim().startsWith("https://") ? raw.cover.trim().slice(0, 300) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.name) return { ok: false as const, error: "Name the group." };
    if (!data.purpose) return { ok: false as const, error: "Write a brief purpose." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureLeaders(sql);
    if (!(await leaderFlags(sql, context.userId)).leader) return { ok: false as const, error: "Only leaders can start a group." };
    const rows = await sql<{ id: number }>`
      insert into groups (name, owner_id, purpose, category, privacy, join_mode, post_mode, rules, where_at, cover_url)
      values (${data.name}, ${context.userId}, ${data.purpose}, ${data.category || "Bible Study"}, ${data.privacy}, ${data.joinMode}, ${data.postMode}, ${data.rules}, ${data.whereAt}, ${data.cover})
      returning id
    `;
    const id = num(rows[0]?.id);
    await sql`
      insert into group_members (group_id, user_id, member_role, status)
      values (${id}, ${context.userId}, 'owner', 'active')
    `;
    return { ok: true as const, id };
  });

export const getGroup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { id: parseId(raw.id), seed: parseSeed(raw) };
  })
  .handler(async ({ context, data }): Promise<GroupPage | null> => {
    if (!data.id) return null;
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    const group = await membership(sql, data.id, context.userId);
    if (!group) return null;
    const members = await sql<{
      user_id: string;
      display_name: string;
      image_url: string | null;
      role: string;
    }>`
      select p.user_id, p.display_name, p.image_url, p.role
      from group_members m
      join profiles p on p.user_id = m.user_id
      where m.group_id = ${data.id}
      order by lower(p.display_name)
    `;
    const others =
      group.owner_id === context.userId
        ? await sql<{
            user_id: string;
            display_name: string;
            image_url: string | null;
            role: string;
          }>`
            select p.user_id, p.display_name, p.image_url, p.role
            from profiles p
            where p.user_id <> ${context.userId}
              and same_porch(p.user_id, ${context.userId})
              and p.user_id not in (select user_id from group_members where group_id = ${data.id})
            order by lower(p.display_name)
          `
        : [];
    const notes = await sql<{
      id: number;
      author_id: string;
      author_name: string;
      author_image: string | null;
      body: string;
      created_at: string;
    }>`
      select n.id, n.author_id, p.display_name as author_name, p.image_url as author_image, n.body,
             to_char(n.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
      from group_notes n
      join profiles p on p.user_id = n.author_id
      where n.group_id = ${data.id}
      order by n.created_at desc
      limit 80
    `;
    const mapMember = (row: { user_id: string; display_name: string; image_url: string | null; role: string }) => ({
      userId: row.user_id,
      displayName: row.display_name,
      imageUrl: row.image_url,
      role: row.role ?? "",
      owner: row.user_id === group.owner_id,
    });
    return {
      id: num(group.id),
      name: group.name,
      owner: group.owner_id === context.userId,
      members: members.map(mapMember),
      others: others.map(mapMember),
      notes: notes.reverse().map((row) => ({
        id: num(row.id),
        authorId: row.author_id,
        authorName: row.author_name,
        authorImage: row.author_image,
        body: row.body,
        createdAt: row.created_at,
      })),
    };
  });

export const addMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      groupId: parseId(raw.groupId),
      userId: typeof raw.userId === "string" ? raw.userId : "",
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.groupId || !data.userId) return { ok: false as const, error: "Pick someone." };
    const sql = await getSql();
    const group = await membership(sql, data.groupId, context.userId);
    if (!group || group.owner_id !== context.userId) {
      return { ok: false as const, error: "Only the person who made the group can add people." };
    }
    const found = await sql<{ user_id: string }>`select user_id from profiles where user_id = ${data.userId} and same_porch(user_id, ${context.userId})`;
    if (!found.length) return { ok: false as const, error: "That person hasn't joined." };
    await sql`
      insert into group_members (group_id, user_id) values (${data.groupId}, ${data.userId})
      on conflict do nothing
    `;
    return { ok: true as const };
  });

export const leaveGroup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      groupId: parseId(raw.groupId),
      userId: typeof raw.userId === "string" ? raw.userId : "",
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.groupId) return { ok: false as const, error: "Missing group." };
    const target = data.userId || context.userId;
    if (target !== context.userId) {
      const sql = await getSql();
      const group = await membership(sql, data.groupId, context.userId);
      if (!group || group.owner_id !== context.userId) {
        noteAttempt(context.userId, "group-remove", "Tried to remove someone from a group they did not make.");
        return { ok: false as const, error: "You can only remove people from a group you made." };
      }
    }
    const sql = await getSql();
    const group = await membership(sql, data.groupId, context.userId);
    if (!group) {
      noteAttempt(context.userId, "group-leave", "Tried to change a group they are not in.");
      return { ok: false as const, error: "That group isn't yours." };
    }
    await sql`delete from group_members where group_id = ${data.groupId} and user_id = ${target}`;
    await sql`delete from call_peers where group_id = ${data.groupId} and user_id = ${target}`;
    const left = await sql<{ user_id: string }>`
      select user_id from group_members where group_id = ${data.groupId} order by created_at asc
    `;
    if (!left.length) {
      const kind = await sql<{ kind: string }>`select kind from groups where id = ${data.groupId}`;
      if (kind[0]?.kind !== "porch") {
        await sql`delete from groups where id = ${data.groupId}`;
      }
    } else if (group.owner_id === target) {
      await sql`update groups set owner_id = ${left[0].user_id} where id = ${data.groupId}`;
    }
    return { ok: true as const };
  });

export const addGroupNote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      groupId: parseId(raw.groupId),
      body: typeof raw.body === "string" ? clip(raw.body, 800) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.groupId || !data.body) return { ok: false as const, error: "Write something first." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    const group = await membership(sql, data.groupId, context.userId);
    if (!group) {
      noteAttempt(context.userId, "group-note", "Tried to write in a group they are not in.");
      return { ok: false as const, error: "That group isn't yours." };
    }
    await sql`
      insert into group_notes (group_id, author_id, body)
      values (${data.groupId}, ${context.userId}, ${data.body})
    `;
    const members = await sql<{ user_id: string }>`
      select user_id from group_members where group_id = ${data.groupId} and user_id <> ${context.userId}
    `;
    const people = await sql<{ display_name: string }>`
      select display_name from profiles where user_id = ${context.userId}
    `;
    const name = people[0]?.display_name?.trim() || "Someone";
    const { notifyPeople } = await import("@/lib/porch/push.server");
    await notifyPeople(
      sql,
      members.map((member) => member.user_id),
      group.name,
      `${name} wrote in ${group.name}`,
      `/groups/${data.groupId}`,
    );
    return { ok: true as const };
  });

export const openPersonCall = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      userId: typeof raw.userId === "string" ? raw.userId.trim().slice(0, 120) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.userId) return { ok: false as const, error: "Choose someone to call." };
    if (data.userId === context.userId) return { ok: false as const, error: "You can't call yourself." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    const other = await sql<{ user_id: string; display_name: string }>`
      select user_id, display_name from profiles where user_id = ${data.userId} and same_porch(user_id, ${context.userId})
    `;
    const person = other[0];
    if (!person) return { ok: false as const, error: "You can only call people in your porch." };
    await ensureCallAsk(sql);
    await ensureCallRing(sql);
    const groupId = await ensurePair(sql, context.userId, person.user_id);
    const log = await sql<{ id: number }>`
      select id from call_log
      where status in ('calling', 'answered')
        and (
          (caller_id = ${context.userId} and callee_id = ${person.user_id})
          or (caller_id = ${person.user_id} and callee_id = ${context.userId})
        )
      order by started_at desc
      limit 1
    `;
    return {
      ok: true as const,
      groupId,
      name: person.display_name || "Teammate",
      callId: log[0]?.id ?? 0,
    };
  });

async function ensurePair(sql: Sql, a: string, b: string) {
  const key = [a, b].sort().join("\n");
  let id = num((await sql<{ id: number }>`select id from groups where pair_key = ${key} limit 1`)[0]?.id);
  if (!id) {
    try {
      id = num(
        (
          await sql<{ id: number }>`
            insert into groups (name, owner_id, kind, pair_key)
            values ('Call', ${a}, 'pair', ${key})
            returning id
          `
        )[0]?.id,
      );
    } catch {
      id = num((await sql<{ id: number }>`select id from groups where pair_key = ${key} limit 1`)[0]?.id);
    }
  }
  if (!id) throw new Error("That call could not be opened.");
  await sql`
    insert into group_members (group_id, user_id)
    values (${id}, ${a})
    on conflict do nothing
  `;
  await sql`
    insert into group_members (group_id, user_id)
    values (${id}, ${b})
    on conflict do nothing
  `;
  return id;
}

export const openPorchCall = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    // Group calls are on hold (BUILD-BRIEF.md section 4), and this one call was shared by everyone.
    if (!shown("groupCalls")) return { groupId: 0, onCall: 0 };
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    const groupId = await ensurePorch(sql, context.userId);
    const onCall = num(
      (
        await sql<{ n: number }>`
          select count(*)::int as n from call_peers
          where group_id = ${groupId} and updated_at > now() - interval '20 seconds'
        `
      )[0]?.n,
    );
    return { groupId, onCall };
  });

async function ensurePorch(sql: Sql, userId: string) {
  let id = num((await sql<{ id: number }>`select id from groups where kind = 'porch' limit 1`)[0]?.id);
  if (!id) {
    try {
      id = num(
        (
          await sql<{ id: number }>`
            insert into groups (name, owner_id, kind)
            values ('Porch call', ${userId}, 'porch')
            returning id
          `
        )[0]?.id,
      );
    } catch {
      id = num((await sql<{ id: number }>`select id from groups where kind = 'porch' limit 1`)[0]?.id);
    }
  }
  if (!id) throw new Error("Porch call could not be opened.");
  await sql`
    insert into group_members (group_id, user_id)
    values (${id}, ${userId})
    on conflict do nothing
  `;
  return id;
}

export const callPoll = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      groupId: parseId(raw.groupId),
      since: parseId(raw.since) ?? 0,
      name: clip(String(raw.name ?? ""), 60),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.groupId) return { ok: false as const, error: "Missing group.", peers: [], signals: [] };
    const sql = await getSql();
    if (!(await membership(sql, data.groupId, context.userId))) {
      noteAttempt(context.userId, "group-call", "Tried to join a call in a group they are not in.");
      return { ok: false as const, error: "That group isn't yours.", peers: [], signals: [] };
    }
    if (!(await pairOnly(sql, data.groupId, context.userId))) {
      return { ok: false as const, error: "That call is not open.", peers: [], signals: [] };
    }
    const name = data.name || "Teammate";
    await sql`
      insert into call_peers (group_id, user_id, display_name, updated_at)
      values (${data.groupId}, ${context.userId}, ${name}, now())
      on conflict (group_id, user_id) do update set display_name = ${name}, updated_at = now()
    `;
    await sql`delete from call_peers where group_id = ${data.groupId} and updated_at < now() - interval '20 seconds'`;
    await sql`delete from call_signals where created_at < now() - interval '3 minutes'`;
    const count = num(
      (await sql<{ n: number }>`select count(*)::int as n from call_peers where group_id = ${data.groupId}`)[0]?.n,
    );
    if (count > CALL_LIMIT) {
      await sql`delete from call_peers where group_id = ${data.groupId} and user_id = ${context.userId}`;
      return { ok: false as const, error: "This call holds six people.", peers: [], signals: [] };
    }
    const peers = await sql<{ user_id: string; display_name: string }>`
      select user_id, display_name from call_peers
      where group_id = ${data.groupId} and user_id <> ${context.userId}
      order by updated_at asc
    `;
    const signals = await sql<{ id: number; from_id: string; kind: CallSignalKind; payload: string }>`
      select id, from_id, kind, payload from call_signals
      where group_id = ${data.groupId} and to_id = ${context.userId} and id > ${data.since}
      order by id asc
      limit 40
    `;
    const ice = iceConfigFor(context.userId).iceServers;
    return {
      ok: true as const,
      peers: peers.map((row) => ({ id: row.user_id, name: row.display_name })),
      signals: signals.map((row) => ({
        id: num(row.id),
        fromId: row.from_id,
        kind: row.kind,
        payload: row.payload,
      })),
      ice,
    };
  });

export const callSignal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const kind = raw.kind === "offer" || raw.kind === "answer" || raw.kind === "ice" ? raw.kind : null;
    return {
      groupId: parseId(raw.groupId),
      toId: typeof raw.toId === "string" ? raw.toId : "",
      kind,
      payload: typeof raw.payload === "string" ? raw.payload.slice(0, 24000) : "",
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.groupId || !data.toId || !data.kind || !data.payload) return { ok: false as const };
    const sql = await getSql();
    if (!(await membership(sql, data.groupId, context.userId))) return { ok: false as const };
    if (!(await membership(sql, data.groupId, data.toId))) return { ok: false as const };
    if (!(await pairOnly(sql, data.groupId, context.userId))) return { ok: false as const };
    await sql`
      insert into call_signals (group_id, from_id, to_id, kind, payload)
      values (${data.groupId}, ${context.userId}, ${data.toId}, ${data.kind}, ${data.payload})
    `;
    return { ok: true as const };
  });

export const callLeave = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseId(asRecord(input).groupId))
  .handler(async ({ context, data: groupId }) => {
    if (!groupId) return { ok: false as const };
    const sql = await getSql();
    await ensureCallVoice(sql);
    await sql`delete from call_peers where group_id = ${groupId} and user_id = ${context.userId}`;
    await sql`
      delete from call_signals
      where group_id = ${groupId} and (from_id = ${context.userId} or to_id = ${context.userId})
    `;
    await sql`delete from call_voice where group_id = ${groupId} and from_id = ${context.userId}`;
    const pair = await sql<{ pair_key: string | null }>`select pair_key from groups where id = ${groupId}`;
    const ids = (pair[0]?.pair_key ?? "").split("\n").filter(Boolean);
    if (ids.length === 2) {
      const [a, b] = ids;
      await sql`
        delete from call_rings
        where (caller_id = ${a} and callee_id = ${b})
           or (caller_id = ${b} and callee_id = ${a})
      `;
    }
    return { ok: true as const };
  });

async function ensureCallVoice(sql: Sql) {
  await sql`
    create table if not exists call_voice (
      id serial primary key,
      group_id integer not null,
      from_id text not null,
      payload text not null,
      created_at timestamptz not null default now()
    )
  `;
}

export const callVoicePush = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      groupId: parseId(raw.groupId),
      payload: typeof raw.payload === "string" ? raw.payload.slice(0, 12000) : "",
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.groupId || !data.payload) return { ok: false as const };
    const sql = await getSql();
    await ensureCallVoice(sql);
    if (!(await membership(sql, data.groupId, context.userId))) return { ok: false as const };
    await sql`
      insert into call_voice (group_id, from_id, payload)
      values (${data.groupId}, ${context.userId}, ${data.payload})
    `;
    await sql`delete from call_voice where created_at < now() - interval '8 seconds'`;
    return { ok: true as const };
  });

export const callVoicePull = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { groupId: parseId(raw.groupId), since: parseId(raw.since) ?? 0 };
  })
  .handler(async ({ context, data }) => {
    if (!data.groupId) return { ok: false as const, chunks: [] as { id: number; payload: string }[] };
    const sql = await getSql();
    await ensureCallVoice(sql);
    if (!(await membership(sql, data.groupId, context.userId))) return { ok: false as const, chunks: [] };
    const rows = await sql<{ id: number; payload: string }>`
      select id, payload from call_voice
      where group_id = ${data.groupId} and from_id <> ${context.userId} and id > ${data.since}
      order by id asc
      limit 12
    `;
    return { ok: true as const, chunks: rows.map((row) => ({ id: num(row.id), payload: row.payload })) };
  });

export const GROUP_CATEGORIES = [
  "Bible Study",
  "Prayer",
  "Worship",
  "Youth",
  "Families",
  "Men",
  "Women",
  "Christian Leadership",
  "Evangelism",
  "Missions",
  "Theology",
  "Christian Books",
  "Local Fellowship",
  "Church Groups",
  "Other",
] as const;

export type GroupCard = {
  id: number;
  name: string;
  purpose: string;
  category: string;
  privacy: string;
  whereAt: string;
  cover: string;
  members: number;
  ownerId: string;
  ownerName: string;
  joined: boolean;
  pending: boolean;
  followed: boolean;
};

export type GroupPost = {
  id: number;
  parentId: number;
  authorId: string;
  authorName: string;
  authorImage: string | null;
  body: string;
  createdAt: string;
  kind: string;
  scripture: string;
  verseText: string;
  pinned: boolean;
  locked: boolean;
  answered: boolean;
  helpful: boolean;
  eventWhen: string;
  eventPlace: string;
  prays: number;
  supports: number;
  ups: number;
  going: number;
  maybe: number;
  declined: number;
  reports: number;
  mine: string[];
};

export type GroupStudy = {
  id: number;
  title: string;
  detail: string;
  passage: string;
  days: number;
  startOn: string;
  done: number[];
};

export type GroupHome = {
  id: number;
  name: string;
  purpose: string;
  category: string;
  privacy: string;
  joinMode: string;
  postMode: string;
  rules: string;
  whereAt: string;
  cover: string;
  role: string;
  joined: boolean;
  pending: boolean;
  memberCount: number;
  postCount: number;
  members: GroupMember[];
  waiting: GroupMember[];
  posts: GroupPost[];
  studies: GroupStudy[];
  reportCount: number;
};

const POST_KINDS = new Set(["discussion", "scripture", "question", "prayer", "study", "resource", "event", "video"]);
const MARKS = new Set(["pray", "support", "up", "going", "maybe", "decline"]);

function staff(role: string) {
  return role === "owner" || role === "admin" || role === "moderator";
}

export const browseGroups = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await ensureGroups(sql);
    const me = context.userId;
    const rows = await sql<{
      id: number;
      name: string;
      purpose: string | null;
      category: string | null;
      privacy: string | null;
      where_at: string | null;
      cover_url: string | null;
      owner_id: string;
      owner_name: string;
      members: string;
      joined: unknown;
      pending: unknown;
      followed: unknown;
    }>`
      select g.id, g.name, g.purpose, g.category, g.privacy, g.where_at, g.cover_url, g.owner_id,
             p.display_name as owner_name,
             (select count(*)::text from group_members m where m.group_id = g.id and coalesce(m.status, 'active') = 'active') as members,
             exists (select 1 from group_members m where m.group_id = g.id and m.user_id = ${me} and coalesce(m.status, 'active') = 'active') as joined,
             exists (select 1 from group_members m where m.group_id = g.id and m.user_id = ${me} and m.status = 'pending') as pending,
             exists (select 1 from group_follows f where f.group_id = g.id and f.user_id = ${me}) as followed
      from groups g
      join profiles p on p.user_id = g.owner_id
      where g.kind = 'personal' and g.porch_id = my_porch(${me})
      order by g.created_at desc
    `;
    const groups: GroupCard[] = rows.map((row) => ({
      id: num(row.id),
      name: row.name,
      purpose: row.purpose ?? "",
      category: row.category || "Bible Study",
      privacy: row.privacy === "private" ? "private" : "public",
      whereAt: row.where_at ?? "",
      cover: row.cover_url ?? "",
      members: Number(row.members) || 0,
      ownerId: row.owner_id,
      ownerName: row.owner_name,
      joined: yes(row.joined),
      pending: yes(row.pending),
      followed: yes(row.followed),
    }));
    return { groups };
  });

export const openGroup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { id: parseId(raw.id), seed: parseSeed(raw) };
  })
  .handler(async ({ context, data }): Promise<GroupHome | null> => {
    if (!data.id) return null;
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureGroups(sql);
    const rows = await sql<{
      id: number;
      name: string;
      purpose: string | null;
      category: string | null;
      privacy: string | null;
      join_mode: string | null;
      post_mode: string | null;
      rules: string | null;
      where_at: string | null;
      cover_url: string | null;
      owner_id: string;
    }>`
      select id, name, purpose, category, privacy, join_mode, post_mode, rules, where_at, cover_url, owner_id
      from groups where id = ${data.id} and kind = 'personal' and porch_id = my_porch(${context.userId})
    `;
    const group = rows[0];
    if (!group) return null;
    const mine = await sql<{ status: string | null; member_role: string | null }>`
      select status, member_role from group_members where group_id = ${data.id} and user_id = ${context.userId}
    `;
    const status = mine[0]?.status ?? "";
    if (status === "banned") return null;
    const joined = status === "active" || group.owner_id === context.userId;
    const pending = status === "pending";
    const role = group.owner_id === context.userId ? "owner" : joined ? mine[0]?.member_role || "member" : pending ? "pending" : "guest";
    const members = joined
      ? await sql<{ user_id: string; display_name: string; image_url: string | null; member_role: string | null; status: string | null }>`
          select p.user_id, p.display_name, p.image_url, m.member_role, m.status
          from group_members m
          join profiles p on p.user_id = m.user_id
          where m.group_id = ${data.id}
          order by lower(p.display_name)
        `
      : [];
    const counted = await sql<{ n: string }>`
      select count(*)::text as n from group_members where group_id = ${data.id} and coalesce(status, 'active') = 'active'
    `;
    const mapMember = (row: { user_id: string; display_name: string; image_url: string | null; member_role: string | null }) => ({
      userId: row.user_id,
      displayName: row.display_name,
      imageUrl: row.image_url,
      role: row.user_id === group.owner_id ? "owner" : row.member_role || "member",
      owner: row.user_id === group.owner_id,
    });
    const active = members.filter((row) => (row.status ?? "active") === "active");
    const waiting = staff(role) ? members.filter((row) => row.status === "pending").map(mapMember) : [];
    const posts = joined
      ? await sql<{
          id: number;
          parent_id: number | null;
          author_id: string;
          author_name: string;
          author_image: string | null;
          body: string;
          created_at: string;
          kind: string | null;
          scripture: string | null;
          verse_text: string | null;
          pinned: unknown;
          locked: unknown;
          answered: unknown;
          helpful: unknown;
          hidden: unknown;
          event_when: string | null;
          event_place: string | null;
        }>`
          select n.id, n.parent_id, n.author_id, p.display_name as author_name, p.image_url as author_image, n.body,
                 to_char(n.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
                 n.kind, n.scripture, n.verse_text, n.pinned, n.locked, n.answered, n.helpful, n.hidden, n.event_when, n.event_place
          from group_notes n
          join profiles p on p.user_id = n.author_id
          where n.group_id = ${data.id}
          order by n.pinned desc, n.created_at desc
          limit 120
        `
      : [];
    const visible = posts.filter((row) => !yes(row.hidden) || staff(role));
    const ids = visible.map((row) => num(row.id));
    const marks = ids.length
      ? await sql.query<{ note_id: number; kind: string; n: string; mine: unknown }>(
          `select note_id, kind, count(*)::text as n,
                  bool_or(user_id = $2) as mine
           from group_marks where note_id = any($1::int[])
           group by note_id, kind`,
          [ids, context.userId],
        )
      : [];
    const reports = ids.length
      ? await sql.query<{ note_id: number; n: string }>(
          "select note_id, count(*)::text as n from group_reports where note_id = any($1::int[]) group by note_id",
          [ids],
        )
      : [];
    const markOf = (id: number, kind: string) => Number(marks.find((row) => num(row.note_id) === id && row.kind === kind)?.n ?? 0);
    const mineOf = (id: number) => marks.filter((row) => num(row.note_id) === id && yes(row.mine)).map((row) => row.kind);
    const studies = joined
      ? await sql<{ id: number; title: string; detail: string; passage: string; days: number; start_on: string | null }>`
          select id, title, detail, passage, days, to_char(start_on, 'YYYY-MM-DD') as start_on
          from group_studies where group_id = ${data.id} order by id desc limit 12
        `
      : [];
    const doneRows = studies.length
      ? await sql.query<{ study_id: number; day_no: number }>(
          "select study_id, day_no from group_study_done where user_id = $2 and study_id = any($1::int[])",
          [studies.map((row) => num(row.id)), context.userId],
        )
      : [];
    const reportCount = staff(role)
      ? Number((await sql<{ n: string }>`select count(*)::text as n from group_reports r join group_notes n on n.id = r.note_id where n.group_id = ${data.id}`)[0]?.n ?? 0)
      : 0;
    return {
      id: num(group.id),
      name: group.name,
      purpose: group.purpose ?? "",
      category: group.category || "Bible Study",
      privacy: group.privacy === "private" ? "private" : "public",
      joinMode: group.join_mode === "approval" ? "approval" : "open",
      postMode: group.post_mode === "admin" ? "admin" : "members",
      rules: group.rules ?? "",
      whereAt: group.where_at ?? "",
      cover: group.cover_url ?? "",
      role,
      joined,
      pending,
      memberCount: joined ? active.length : Number(counted[0]?.n ?? 0),
      postCount: visible.filter((row) => !row.parent_id).length,
      members: active.map(mapMember),
      waiting,
      posts: visible.map((row) => ({
        id: num(row.id),
        parentId: num(row.parent_id),
        authorId: row.author_id,
        authorName: row.author_name,
        authorImage: row.author_image,
        body: row.body,
        createdAt: row.created_at,
        kind: row.kind || "discussion",
        scripture: row.scripture ?? "",
        verseText: row.verse_text ?? "",
        pinned: yes(row.pinned),
        locked: yes(row.locked),
        answered: yes(row.answered),
        helpful: yes(row.helpful),
        eventWhen: row.event_when ?? "",
        eventPlace: row.event_place ?? "",
        prays: markOf(num(row.id), "pray"),
        supports: markOf(num(row.id), "support"),
        ups: markOf(num(row.id), "up"),
        going: markOf(num(row.id), "going"),
        maybe: markOf(num(row.id), "maybe"),
        declined: markOf(num(row.id), "decline"),
        reports: Number(reports.find((item) => num(item.note_id) === num(row.id))?.n ?? 0),
        mine: mineOf(num(row.id)),
      })),
      studies: studies.map((row) => ({
        id: num(row.id),
        title: row.title,
        detail: row.detail,
        passage: row.passage,
        days: num(row.days) || 1,
        startOn: row.start_on ?? "",
        done: doneRows.filter((item) => num(item.study_id) === num(row.id)).map((item) => num(item.day_no)),
      })),
      reportCount,
    };
  });

export const joinGroup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseId(asRecord(input).id))
  .handler(async ({ context, data: id }) => {
    if (!id) return { ok: false as const, error: "That group is not here." };
    // Members don't join by themselves any more: their leader adds them.
    if (id) return { ok: false as const, error: "Your leader adds you to a group." };
    const sql = await getSql();
    await ensureGroups(sql);
    const group = await sql<{ join_mode: string | null; kind: string | null }>`select join_mode, kind from groups where id = ${id} and porch_id = my_porch(${context.userId})`;
    if (group[0]?.kind !== "personal") return { ok: false as const, error: "That group is not here." };
    const held = await sql<{ status: string | null }>`select status from group_members where group_id = ${id} and user_id = ${context.userId}`;
    if (held[0]?.status === "banned") return { ok: false as const, error: "You cannot join this group." };
    if (held[0]?.status === "active") return { ok: true as const, pending: false };
    if (held[0]?.status === "pending") return { ok: true as const, pending: true };
    const pending = group[0]?.join_mode === "approval";
    await sql`
      insert into group_members (group_id, user_id, member_role, status)
      values (${id}, ${context.userId}, 'member', ${pending ? "pending" : "active"})
      on conflict (group_id, user_id) do update set status = ${pending ? "pending" : "active"}, member_role = 'member'
    `;
    return { ok: true as const, pending };
  });

export const followGroup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseId(asRecord(input).id))
  .handler(async ({ context, data: id }) => {
    if (!id) return { ok: false as const, error: "That group is not here." };
    const sql = await getSql();
    await ensureGroups(sql);
    const inPorch = await sql<{ id: number }>`select id from groups where id = ${id} and kind = 'personal' and porch_id = my_porch(${context.userId})`;
    if (!inPorch.length) return { ok: false as const, error: "That group is not here." };
    const held = await sql<{ user_id: string }>`select user_id from group_follows where group_id = ${id} and user_id = ${context.userId}`;
    if (held.length) {
      await sql`delete from group_follows where group_id = ${id} and user_id = ${context.userId}`;
      return { ok: true as const, followed: false };
    }
    await sql`insert into group_follows (group_id, user_id) values (${id}, ${context.userId}) on conflict do nothing`;
    return { ok: true as const, followed: true };
  });

export const postInGroup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const kind = typeof raw.kind === "string" && POST_KINDS.has(raw.kind) ? raw.kind : "discussion";
    return {
      groupId: parseId(raw.groupId),
      parentId: parseId(raw.parentId) ?? 0,
      kind,
      body: typeof raw.body === "string" ? clip(raw.body, 800) : "",
      scripture: typeof raw.scripture === "string" ? clip(raw.scripture, 40) : "",
      verseText: typeof raw.verseText === "string" ? clip(raw.verseText, 500) : "",
      eventWhen: typeof raw.eventWhen === "string" ? clip(raw.eventWhen, 80) : "",
      eventPlace: typeof raw.eventPlace === "string" ? clip(raw.eventPlace, 120) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.groupId || !data.body) return { ok: false as const, error: "Write something first." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureGroups(sql);
    const group = await membership(sql, data.groupId, context.userId);
    if (!group) return { ok: false as const, error: "Join the group before you write." };
    const mode = await sql<{ post_mode: string | null; owner_id: string }>`select post_mode, owner_id from groups where id = ${data.groupId}`;
    const seat = await sql<{ member_role: string | null }>`select member_role from group_members where group_id = ${data.groupId} and user_id = ${context.userId}`;
    const role = group.owner_id === context.userId ? "owner" : seat[0]?.member_role || "member";
    if (!data.parentId && mode[0]?.post_mode === "admin" && !staff(role)) return { ok: false as const, error: "Only a leader can post here." };
    if (data.parentId) {
      const parent = await sql<{ locked: unknown }>`select locked from group_notes where id = ${data.parentId} and group_id = ${data.groupId}`;
      if (!parent.length) return { ok: false as const, error: "That post is not here." };
      if (yes(parent[0]?.locked) && !staff(role)) return { ok: false as const, error: "That discussion is locked." };
    }
    await sql`
      insert into group_notes (group_id, author_id, body, kind, scripture, verse_text, parent_id, event_when, event_place)
      values (${data.groupId}, ${context.userId}, ${data.body}, ${data.kind}, ${data.scripture}, ${data.verseText}, ${data.parentId || null}, ${data.eventWhen}, ${data.eventPlace})
    `;
    return { ok: true as const };
  });

export const markGroupPost = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { noteId: parseId(raw.noteId), kind: typeof raw.kind === "string" && MARKS.has(raw.kind) ? raw.kind : "" };
  })
  .handler(async ({ context, data }) => {
    if (!data.noteId || !data.kind) return { ok: false as const, error: "That post is not here." };
    const sql = await getSql();
    await ensureGroups(sql);
    const note = await sql<{ group_id: number }>`select group_id from group_notes where id = ${data.noteId}`;
    if (!note[0] || !(await membership(sql, num(note[0].group_id), context.userId))) return { ok: false as const, error: "Join the group first." };
    const held = await sql<{ user_id: string }>`select user_id from group_marks where note_id = ${data.noteId} and user_id = ${context.userId} and kind = ${data.kind}`;
    if (held.length) await sql`delete from group_marks where note_id = ${data.noteId} and user_id = ${context.userId} and kind = ${data.kind}`;
    else await sql`insert into group_marks (note_id, user_id, kind) values (${data.noteId}, ${context.userId}, ${data.kind}) on conflict do nothing`;
    return { ok: true as const };
  });

export const guideGroup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const action = typeof raw.action === "string" ? raw.action : "";
    return {
      groupId: parseId(raw.groupId),
      noteId: parseId(raw.noteId) ?? 0,
      userId: typeof raw.userId === "string" ? raw.userId : "",
      role: raw.role === "admin" || raw.role === "moderator" || raw.role === "member" ? raw.role : "",
      action,
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.groupId) return { ok: false as const, error: "That group is not here." };
    const sql = await getSql();
    await ensureGroups(sql);
    const group = await membership(sql, data.groupId, context.userId);
    if (!group) return { ok: false as const, error: "That group isn't yours." };
    const seat = await sql<{ member_role: string | null }>`select member_role from group_members where group_id = ${data.groupId} and user_id = ${context.userId}`;
    const role = group.owner_id === context.userId ? "owner" : seat[0]?.member_role || "member";
    if (data.action === "report") {
      if (!data.noteId) return { ok: false as const, error: "That post is not here." };
      await sql`insert into group_reports (note_id, user_id) values (${data.noteId}, ${context.userId}) on conflict do nothing`;
      return { ok: true as const };
    }
    if (data.action === "answered" && data.noteId) {
      const note = await sql<{ author_id: string }>`select author_id from group_notes where id = ${data.noteId} and group_id = ${data.groupId}`;
      if (note[0]?.author_id !== context.userId && !staff(role)) return { ok: false as const, error: "Only the person who asked can mark it answered." };
      await sql`update group_notes set answered = not answered where id = ${data.noteId}`;
      return { ok: true as const };
    }
    if (!staff(role)) return { ok: false as const, error: "Only a leader can do that." };
    if (data.action === "approve" && data.userId) {
      await sql`update group_members set status = 'active' where group_id = ${data.groupId} and user_id = ${data.userId} and status = 'pending'`;
      return { ok: true as const };
    }
    if (data.action === "reject" && data.userId) {
      await sql`delete from group_members where group_id = ${data.groupId} and user_id = ${data.userId} and status = 'pending'`;
      return { ok: true as const };
    }
    if (data.action === "ban" && data.userId && data.userId !== group.owner_id) {
      await sql`update group_members set status = 'banned', member_role = 'member' where group_id = ${data.groupId} and user_id = ${data.userId}`;
      return { ok: true as const };
    }
    if (data.action === "role" && data.userId && data.role && group.owner_id === context.userId && data.userId !== group.owner_id) {
      await sql`update group_members set member_role = ${data.role} where group_id = ${data.groupId} and user_id = ${data.userId} and coalesce(status, 'active') = 'active'`;
      return { ok: true as const };
    }
    if (!data.noteId) return { ok: false as const, error: "That post is not here." };
    if (data.action === "hide") await sql`update group_notes set hidden = true where id = ${data.noteId} and group_id = ${data.groupId}`;
    else if (data.action === "show") await sql`update group_notes set hidden = false where id = ${data.noteId} and group_id = ${data.groupId}`;
    else if (data.action === "pin") await sql`update group_notes set pinned = true where id = ${data.noteId} and group_id = ${data.groupId}`;
    else if (data.action === "unpin") await sql`update group_notes set pinned = false where id = ${data.noteId} and group_id = ${data.groupId}`;
    else if (data.action === "lock") await sql`update group_notes set locked = true where id = ${data.noteId} and group_id = ${data.groupId}`;
    else if (data.action === "unlock") await sql`update group_notes set locked = false where id = ${data.noteId} and group_id = ${data.groupId}`;
    else if (data.action === "helpful") await sql`update group_notes set helpful = not helpful where id = ${data.noteId} and group_id = ${data.groupId}`;
    else if (data.action === "delete") {
      await sql`delete from group_notes where parent_id = ${data.noteId} and group_id = ${data.groupId}`;
      await sql`delete from group_notes where id = ${data.noteId} and group_id = ${data.groupId}`;
    } else return { ok: false as const, error: "That action is not here." };
    return { ok: true as const };
  });

export const saveGroupStudy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const days = num(raw.days);
    return {
      groupId: parseId(raw.groupId),
      title: typeof raw.title === "string" ? clip(raw.title, 80) : "",
      detail: typeof raw.detail === "string" ? clip(raw.detail, 280) : "",
      passage: typeof raw.passage === "string" ? clip(raw.passage, 40) : "",
      days: days >= 1 && days <= 90 ? days : 1,
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.groupId || !data.title) return { ok: false as const, error: "Name the study." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    const group = await membership(sql, data.groupId, context.userId);
    if (!group) return { ok: false as const, error: "Join the group first." };
    const seat = await sql<{ member_role: string | null }>`select member_role from group_members where group_id = ${data.groupId} and user_id = ${context.userId}`;
    const role = group.owner_id === context.userId ? "owner" : seat[0]?.member_role || "member";
    if (!staff(role)) return { ok: false as const, error: "Only a leader can open a study." };
    await sql`
      insert into group_studies (group_id, title, detail, passage, days, start_on)
      values (${data.groupId}, ${data.title}, ${data.detail}, ${data.passage}, ${data.days}, current_date)
    `;
    return { ok: true as const };
  });

export const markStudyDay = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { studyId: parseId(raw.studyId), day: num(raw.day) };
  })
  .handler(async ({ context, data }) => {
    if (!data.studyId || data.day < 1) return { ok: false as const, error: "That day is not here." };
    const sql = await getSql();
    await ensureGroups(sql);
    const study = await sql<{ group_id: number }>`select group_id from group_studies where id = ${data.studyId}`;
    if (!study[0] || !(await membership(sql, num(study[0].group_id), context.userId))) return { ok: false as const, error: "Join the group first." };
    const held = await sql<{ user_id: string }>`select user_id from group_study_done where study_id = ${data.studyId} and user_id = ${context.userId} and day_no = ${data.day}`;
    if (held.length) await sql`delete from group_study_done where study_id = ${data.studyId} and user_id = ${context.userId} and day_no = ${data.day}`;
    else await sql`insert into group_study_done (study_id, user_id, day_no) values (${data.studyId}, ${context.userId}, ${data.day}) on conflict do nothing`;
    return { ok: true as const };
  });

export const groupsOnPassage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { scripture: typeof raw.scripture === "string" ? clip(raw.scripture, 40) : "" };
  })
  .handler(async ({ context, data }) => {
    if (!data.scripture) return { groups: [] as { id: number; name: string; members: number; posts: number }[] };
    const sql = await getSql();
    await ensureGroups(sql);
    const like = `${data.scripture}%`;
    const rows = await sql<{ id: number; name: string; members: string; posts: string }>`
      select g.id, g.name,
             (select count(*)::text from group_members m where m.group_id = g.id and coalesce(m.status, 'active') = 'active') as members,
             (select count(*)::text from group_notes n where n.group_id = g.id and n.scripture ilike ${like} and n.hidden = false) as posts
      from groups g
      where g.kind = 'personal' and g.privacy = 'public' and g.porch_id = my_porch(${context.userId})
        and exists (select 1 from group_notes n where n.group_id = g.id and n.scripture ilike ${like} and n.hidden = false)
      order by posts desc
      limit 8
    `;
    return {
      groups: rows.map((row) => ({ id: num(row.id), name: row.name, members: Number(row.members) || 0, posts: Number(row.posts) || 0 })),
      you: context.userId,
    };
  });

// ---- Leaders' groups (Oct 2026): only Leaders (and an admin) start a group; the leader adds the people
// under him; a member can leave or be removed. Nothing else happens inside a group for now; older notes and
// studies stay stored but are no longer shown.

async function ensureLeaders(sql: Sql) {
  await ensureGroups(sql);
  await sql`alter table profiles add column if not exists is_leader boolean not null default false`;
  await sql`create table if not exists porch_once (key text primary key, done_at timestamptz not null default now())`;
  // Once: everyone who had already opened a group becomes a Leader.
  const first = await sql<{ key: string }>`insert into porch_once (key) values ('leaders-from-groups') on conflict do nothing returning key`;
  if (first.length) {
    await sql`update profiles set is_leader = true where user_id in (select owner_id from groups where kind = 'personal')`;
  }
}

async function leaderFlags(sql: Sql, userId: string) {
  const rows = await sql<{ is_founder: unknown; is_leader: unknown }>`select is_porch_admin(user_id) as is_founder, is_leader from profiles where user_id = ${userId}`;
  const founder = yes(rows[0]?.is_founder);
  return { founder, leader: founder || yes(rows[0]?.is_leader) };
}

export type PlainGroup = { id: number; name: string; purpose: string; ownerId: string; ownerName: string; members: number };
export type PlainMember = { userId: string; displayName: string; imageUrl: string | null; leader: boolean };

/** The groups you lead or are in (an admin sees them all), and whether you may start one. */
export const myGroups = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await ensureLeaders(sql);
    const me = await leaderFlags(sql, context.userId);
    const rows = await sql.query<{ id: number; name: string; purpose: string | null; owner_id: string; owner_name: string; members: string }>(
      `select g.id, g.name, g.purpose, g.owner_id, p.display_name as owner_name,
              (select count(*)::text from group_members m where m.group_id = g.id and coalesce(m.status, 'active') = 'active') as members
       from groups g
       join profiles p on p.user_id = g.owner_id
       where g.kind = 'personal'
         and g.porch_id = my_porch($1)
         and ($2::boolean or g.owner_id = $1 or exists (
           select 1 from group_members m where m.group_id = g.id and m.user_id = $1 and coalesce(m.status, 'active') = 'active'))
       order by g.created_at desc`,
      [context.userId, me.founder],
    );
    const groups: PlainGroup[] = rows.map((row) => ({
      id: num(row.id),
      name: row.name,
      purpose: row.purpose ?? "",
      ownerId: row.owner_id,
      ownerName: row.owner_name,
      members: Number(row.members) || 0,
    }));
    return { groups, canStart: me.leader, founder: me.founder };
  });

/** A leader starts a group. */
export const startGroup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      name: typeof raw.name === "string" ? clip(raw.name, 40) : "",
      purpose: typeof raw.purpose === "string" ? clip(raw.purpose, 280) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.name) return { ok: false as const, error: "Name the group." };
    if (!data.purpose) return { ok: false as const, error: "Write a brief purpose." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureLeaders(sql);
    if (!(await leaderFlags(sql, context.userId)).leader) {
      noteAttempt(context.userId, "group-start", "Tried to start a group without being a leader.");
      return { ok: false as const, error: "Only leaders can start a group." };
    }
    const rows = await sql<{ id: number }>`
      insert into groups (name, owner_id, purpose, privacy, join_mode, post_mode)
      values (${data.name}, ${context.userId}, ${data.purpose}, 'private', 'approval', 'admin')
      returning id
    `;
    const id = num(rows[0]?.id);
    await sql`insert into group_members (group_id, user_id, member_role, status) values (${id}, ${context.userId}, 'owner', 'active')`;
    return { ok: true as const, id };
  });

/** Inside a group: its leader and members. */
export const openPlainGroup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { id: parseId(raw.id), seed: parseSeed(raw) };
  })
  .handler(async ({ context, data }) => {
    if (!data.id) return { ok: false as const, error: "That group is not here." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureLeaders(sql);
    const me = await leaderFlags(sql, context.userId);
    const groups = await sql<{ id: number; name: string; purpose: string | null; owner_id: string; owner_name: string }>`
      select g.id, g.name, g.purpose, g.owner_id, p.display_name as owner_name
      from groups g join profiles p on p.user_id = g.owner_id
      where g.id = ${data.id} and g.kind = 'personal' and g.porch_id = my_porch(${context.userId})
    `;
    const group = groups[0];
    if (!group) return { ok: false as const, error: "That group is not here." };
    const rows = await sql<{ user_id: string; display_name: string; image_url: string | null }>`
      select p.user_id, p.display_name, p.image_url
      from group_members m join profiles p on p.user_id = m.user_id
      where m.group_id = ${data.id} and coalesce(m.status, 'active') = 'active'
      order by (m.user_id = ${group.owner_id}) desc, lower(p.display_name)
    `;
    const isMember = rows.some((row) => row.user_id === context.userId);
    if (!isMember && !me.founder) {
      noteAttempt(context.userId, "group-open", "Tried to open a group they are not in.");
      return { ok: false as const, error: "Your leader adds you to a group." };
    }
    const members: PlainMember[] = rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      imageUrl: row.image_url,
      leader: row.user_id === group.owner_id,
    }));
    return {
      ok: true as const,
      group: { id: num(group.id), name: group.name, purpose: group.purpose ?? "", ownerId: group.owner_id, ownerName: group.owner_name },
      members,
      canManage: group.owner_id === context.userId || me.founder,
      isMember,
    };
  });

/** The leader (or an admin) adds someone to the group. */
export const addToGroup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { groupId: parseId(raw.groupId), userId: typeof raw.userId === "string" ? raw.userId : "" };
  })
  .handler(async ({ context, data }) => {
    if (!data.groupId || !data.userId) return { ok: false as const, error: "Pick someone." };
    const sql = await getSql();
    await ensureLeaders(sql);
    const me = await leaderFlags(sql, context.userId);
    const group = await sql<{ owner_id: string }>`select owner_id from groups where id = ${data.groupId} and kind = 'personal' and porch_id = my_porch(${context.userId})`;
    if (!group[0] || (group[0].owner_id !== context.userId && !me.founder)) {
      noteAttempt(context.userId, "group-add", "Tried to add someone to a group they don't lead.");
      return { ok: false as const, error: "Only the group's leader can add people." };
    }
    const found = await sql<{ user_id: string }>`select user_id from profiles where user_id = ${data.userId} and same_porch(user_id, ${context.userId})`;
    if (!found.length) return { ok: false as const, error: "That person hasn't joined Porchbook." };
    await sql`
      insert into group_members (group_id, user_id, member_role, status) values (${data.groupId}, ${data.userId}, 'member', 'active')
      on conflict (group_id, user_id) do update set status = 'active'
    `;
    return { ok: true as const };
  });

/** Leave a group yourself, or (the leader or an admin) remove someone. The leader stays with the group. */
export const removeFromGroup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { groupId: parseId(raw.groupId), userId: typeof raw.userId === "string" ? raw.userId : "" };
  })
  .handler(async ({ context, data }) => {
    if (!data.groupId) return { ok: false as const, error: "Missing group." };
    const target = data.userId || context.userId;
    const sql = await getSql();
    await ensureLeaders(sql);
    const me = await leaderFlags(sql, context.userId);
    const group = await sql<{ owner_id: string }>`select owner_id from groups where id = ${data.groupId} and kind = 'personal' and porch_id = my_porch(${context.userId})`;
    if (!group[0]) return { ok: false as const, error: "That group is not here." };
    if (target === group[0].owner_id) return { ok: false as const, error: "The leader stays with the group." };
    if (target !== context.userId && group[0].owner_id !== context.userId && !me.founder) {
      noteAttempt(context.userId, "group-remove", "Tried to remove someone from a group they don't lead.");
      return { ok: false as const, error: "Only the group's leader can remove people." };
    }
    await sql`delete from group_members where group_id = ${data.groupId} and user_id = ${target}`;
    await sql`delete from call_peers where group_id = ${data.groupId} and user_id = ${target}`;
    return { ok: true as const };
  });

/** The admin: who are the Leaders, and marking or unmarking one. */
export const listLeaders = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensureLeaders(sql);
    const me = await leaderFlags(sql, context.userId);
    if (!me.founder) return { ok: false as const, leaderIds: [] as string[] };
    const rows = await sql<{ user_id: string }>`select user_id from profiles where is_leader = true and porch_id = my_porch(${context.userId})`;
    return { ok: true as const, leaderIds: rows.map((row) => row.user_id) };
  });

export const setLeader = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { userId: typeof raw.userId === "string" ? raw.userId : "", on: raw.on === true };
  })
  .handler(async ({ context, data }) => {
    if (!data.userId) return { ok: false as const, error: "Pick someone." };
    const sql = await getSql();
    await ensureLeaders(sql);
    if (!(await leaderFlags(sql, context.userId)).founder) {
      noteAttempt(context.userId, "set-leader", "Tried to mark a leader.");
      return { ok: false as const, error: "Only an admin can mark leaders." };
    }
    await sql`update profiles set is_leader = ${data.on} where user_id = ${data.userId} and same_porch(user_id, ${context.userId})`;
    return { ok: true as const };
  });

// ---- Accountability: a leader accounts for what happens in their group. Only that group's
// leader and an admin (developer) see it; members never do.

export type GroupAccount = { id: number; happenedOn: string; attended: number | null; body: string; needs: string; authorId: string; authorName: string; createdAt: string };

async function ensureAccounts(sql: Sql) {
  await sql`create table if not exists group_accounts (
    id bigserial primary key, group_id bigint not null, author_id text not null, happened_on date not null,
    attended integer, body text not null, needs text not null default '', created_at timestamptz not null default now()
  )`;
}

/** The group's leader, or an admin: the only ones who see and write its accounts. */
async function accountGate(sql: Sql, userId: string, groupId: number | null) {
  if (!groupId) return null;
  const rows = await sql<{ owner_id: string }>`select owner_id from groups where id = ${groupId} and kind = 'personal' and porch_id = my_porch(${userId})`;
  if (!rows[0]) return null;
  const me = await leaderFlags(sql, userId);
  return rows[0].owner_id === userId || me.founder ? { founder: me.founder } : null;
}

export const listGroupAccounts = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ groupId: parseId(asRecord(input).groupId) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensureAccounts(sql);
    const gate = await accountGate(sql, context.userId, data.groupId);
    if (!gate) return { ok: false as const, error: "Only the group's leader can see its accountability." };
    const rows = await sql<{ id: number; happened_on: string; attended: number | null; body: string; needs: string; author_id: string; author_name: string | null; created_at: string }>`
      select a.id, to_char(a.happened_on, 'YYYY-MM-DD') as happened_on, a.attended, a.body, a.needs, a.author_id, p.display_name as author_name,
             to_char(a.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
      from group_accounts a left join profiles p on p.user_id = a.author_id
      where a.group_id = ${data.groupId}
      order by a.happened_on desc, a.id desc
      limit 200
    `;
    const accounts: GroupAccount[] = rows.map((row) => ({
      id: num(row.id),
      happenedOn: row.happened_on,
      attended: row.attended === null || row.attended === undefined ? null : num(row.attended),
      body: row.body,
      needs: row.needs ?? "",
      authorId: row.author_id,
      authorName: row.author_name ?? "",
      createdAt: row.created_at,
    }));
    return { ok: true as const, accounts, founder: gate.founder };
  });

export const addGroupAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const day = typeof raw.happenedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.happenedOn) ? raw.happenedOn : "";
    const attended = raw.attended === null || raw.attended === "" || raw.attended === undefined ? null : Math.max(0, Math.min(100000, Math.round(Number(raw.attended)) || 0));
    return {
      groupId: parseId(raw.groupId),
      happenedOn: day,
      attended,
      body: typeof raw.body === "string" ? clip(raw.body.trim(), 20000) : "",
      needs: typeof raw.needs === "string" ? clip(raw.needs.trim(), 2000) : "",
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensureAccounts(sql);
    const gate = await accountGate(sql, context.userId, data.groupId);
    if (!gate) {
      noteAttempt(context.userId, "group-account", "Tried to write a group's accountability.");
      return { ok: false as const, error: "Only the group's leader can account for it." };
    }
    if (!data.happenedOn) return { ok: false as const, error: "Which day?" };
    if (!data.body) return { ok: false as const, error: "Write the activity." };
    await sql`
      insert into group_accounts (group_id, author_id, happened_on, attended, body, needs)
      values (${data.groupId}, ${context.userId}, ${data.happenedOn}, ${data.attended}, ${data.body}, ${data.needs})
    `;
    return { ok: true as const };
  });

/** Take back an account: its writer, or an admin. */
export const removeGroupAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { groupId: parseId(raw.groupId), id: parseId(raw.id) };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensureAccounts(sql);
    const gate = await accountGate(sql, context.userId, data.groupId);
    if (!gate || !data.id) return { ok: false as const, error: "You can't remove that." };
    const gone = gate.founder
      ? await sql`delete from group_accounts where id = ${data.id} and group_id = ${data.groupId} returning id`
      : await sql`delete from group_accounts where id = ${data.id} and group_id = ${data.groupId} and author_id = ${context.userId} returning id`;
    return gone.length ? { ok: true as const } : { ok: false as const, error: "You can't remove that." };
  });
