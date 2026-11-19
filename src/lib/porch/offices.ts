import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import { porchTables } from "@/lib/porch/porch-foundation";
import type { Seed } from "@/lib/porch/model";

export const OFFICES = [
  { key: "pastor", name: "Office of the Pastor" },
  { key: "hoo", name: "Office of the H.O.O" },
  { key: "administrator", name: "Office of the Administrator" },
  { key: "hof", name: "Office of the H.O.F" },
  { key: "communications", name: "Head of Communications Office" },
  { key: "missions", name: "Head of Missions and outreach" },
  { key: "centre", name: "Centre Coordination Office" },
  { key: "pastoral", name: "Office of Pastoral Support" },
] as const;

export const OFFICE_PARTS: Record<string, readonly string[]> = {
  hof: ["Daily Report", "Weekly Report", "Monthly Report"],
  administrator: [
    "Procurement",
    "Human resource",
    "Volunteer co-ordination",
    "Assets management",
    "Office management",
    "Production head",
    "Setup",
    "Ushering",
    "Security",
    "Worship and creative arts",
    "Media",
  ],
  communications: [
    "Information management",
    "Testimonies",
    "Follow-up",
    "Dissemination",
    "Branding and design",
    "Marketing",
  ],
  missions: [
    "Schools",
    "Prisons",
    "Evangelism and mobilisation",
    "Hospital ministry",
    "Charity",
    "Transportation",
    "Campus",
  ],
};

export const PASTOR_ROOMS = [
  { key: "thanks", name: "Thank God with me", hint: "A prayer request" },
  { key: "chat", name: "Contact Pastor", hint: "A message for the pastor" },
  { key: "appoint", name: "Appointments", hint: "I need an appointment" },
  { key: "calendar", name: "Calendar", hint: "Weekly standard program" },
  { key: "account", name: "Accountability", hint: "Account for an assignment" },
  { key: "official", name: "Official", hint: "A message from the pastor's office" },
] as const;

export type PastorRoom = (typeof PASTOR_ROOMS)[number]["key"];

export type OfficeKey = (typeof OFFICES)[number]["key"];

export type OfficeCard = {
  key: OfficeKey;
  name: string;
  headUserId: string | null;
  headName: string | null;
  headImage: string | null;
};

export type PrayerStatus = "open" | "received" | "answered";

export type OfficeThreadPreview = {
  memberId: string;
  memberName: string;
  memberImage: string | null;
  lastBody: string;
  updatedAt: string;
  status: PrayerStatus;
  doorClosed: boolean;
};

export type OfficeNote = {
  id: number;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  mine: boolean;
  official: boolean;
  held: boolean;
};

const KEYS = new Set<string>(OFFICES.map((office) => office.key));

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

function parseSeed(input: unknown): Seed {
  const raw = asRecord(input);
  return {
    displayName: typeof raw.displayName === "string" ? clip(raw.displayName, 80) : "",
    email: typeof raw.email === "string" ? clip(raw.email, 200) : null,
    imageUrl: typeof raw.imageUrl === "string" ? clip(raw.imageUrl, 500) : null,
  };
}

function parseStatus(value: string | null | undefined): PrayerStatus {
  if (value === "received" || value === "answered") return value;
  return "open";
}

function parseKey(value: unknown): OfficeKey | null {
  return typeof value === "string" && KEYS.has(value) ? (value as OfficeKey) : null;
}

function parseRoom(value: unknown): PastorRoom | "" {
  if (value === "thanks" || value === "chat" || value === "appoint" || value === "calendar" || value === "account" || value === "official") return value;
  return "";
}

function threadRoom(key: OfficeKey, room: PastorRoom | ""): string {
  if (key !== "pastor") return "note";
  if (room === "thanks" || room === "chat" || room === "appoint" || room === "account" || room === "official") return room;
  return "";
}

async function ensureOffices(sql: Sql, userId: string) {
  // Each church porch has its own offices (Stage 3b). The office's short key ("pastor") is only
  // unique within a church, so the old links that assumed one set of offices are removed.
  await sql`alter table office_threads drop constraint if exists office_threads_office_key_fkey`;
  await sql`alter table office_calendar drop constraint if exists office_calendar_office_key_fkey`;
  await porchTables(sql, { key: [["offices", "key"]] });
  for (const [index, office] of OFFICES.entries()) {
    await sql`
      insert into offices (porch_id, key, name, sort)
      values (my_porch(${userId}), ${office.key}, ${office.name}, ${index + 1})
      on conflict (porch_id, key) do update set name = excluded.name, sort = excluded.sort
    `;
  }
  await sql`alter table office_threads add column if not exists status text not null default 'open'`;
  await sql`alter table office_threads add column if not exists room text not null default 'note'`;
  await sql`alter table office_threads drop constraint if exists office_threads_office_key_member_id_key`;
  await sql`
    update office_threads
    set office_key = 'pastor', room = 'thanks'
    where office_key = 'prayer'
  `;
  await sql`
    update office_threads
    set room = 'appoint'
    where office_key = 'pastor' and room = 'note'
  `;
  await sql`
    create table if not exists porch_flags (
      key text primary key
    )
  `;
  const moved = await sql<{ key: string }>`select key from porch_flags where key = 'appoint_to_chat'`;
  if (!moved.length) {
    await sql`
      update office_threads
      set room = 'chat'
      where office_key = 'pastor' and room = 'appoint'
    `;
    await sql`insert into porch_flags (key) values ('appoint_to_chat') on conflict (key) do nothing`;
  }
  await porchTables(sql, { tag: [["office_threads", "member_id"]], child: [["office_messages", "thread_id", "office_threads"]] });
  await sql`drop index if exists office_threads_member_room`;
  await sql`
    create unique index if not exists office_threads_porch_member_room
    on office_threads (porch_id, office_key, member_id, room)
  `;
  await sql`alter table office_messages add column if not exists official boolean not null default false`;
  // A closed door: the person's messages are held (they see "Not sent") until the head opens it.
  await sql`alter table office_messages add column if not exists held boolean not null default false`;
  await sql`
    create table if not exists office_doors (
      office_key text not null,
      member_id text not null,
      closed_at timestamptz not null default now(),
      primary key (office_key, member_id)
    )
  `;
  await sql`
    create table if not exists office_calendar (
      office_key text primary key,
      body text not null default '',
      updated_at timestamptz not null default now()
    )
  `;
  await porchTables(sql, { key: [["office_doors", "office_key, member_id"], ["office_calendar", "office_key"]] });
}

async function holdsOffice(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql.query<{ head_user_id: string }>(
    "select head_user_id from offices where head_user_id = $1 and porch_id = my_porch($1) limit 1",
    [userId],
  );
  return rows.length > 0;
}

async function founderFlag(sql: Sql, userId: string): Promise<boolean> {
  const me = await sql.query<{ is_founder: boolean }>(
    "select is_porch_admin($1) as is_founder",
    [userId],
  );
  return boolish(me[0]?.is_founder);
}

export const listOffices = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await ensureOffices(sql, context.userId);
    const isFounder = await founderFlag(sql, context.userId);
    const rows = await sql.query<{
      key: string;
      name: string;
      head_user_id: string | null;
      head_name: string | null;
      head_image: string | null;
    }>(
      `select o.key, o.name, o.head_user_id, p.display_name as head_name, p.image_url as head_image
       from offices o
       left join profiles p on p.user_id = o.head_user_id
       where o.porch_id = my_porch($1)
       order by o.sort asc`,
      [context.userId],
    );
    const offices: OfficeCard[] = rows
      .filter((row) => KEYS.has(row.key))
      .map((row) => ({
        key: row.key as OfficeKey,
        name: row.name,
        headUserId: row.head_user_id,
        headName: row.head_name,
        headImage: row.head_image,
      }));
    const people = isFounder
      ? await sql.query<{ user_id: string; display_name: string }>(
          "select user_id, display_name from profiles where porch_id = my_porch($1) order by lower(display_name) asc",
          [context.userId],
        )
      : [];
    return {
      isFounder,
      offices,
      people: people.map((person) => ({ userId: person.user_id, displayName: person.display_name })),
    };
  });

export const setOfficeHead = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { key: parseKey(raw.key), userId: typeof raw.userId === "string" ? raw.userId : "", seed: parseSeed(raw) };
  })
  .handler(async ({ context, data }) => {
    if (!data.key || !data.userId) return { ok: false as const, error: "Choose a head." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureOffices(sql, context.userId);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "office-head", "Tried to choose an office head.");
      return { ok: false as const, error: "Only the founder can choose a head." };
    }
    const found = await sql<{ user_id: string }>`select user_id from profiles where user_id = ${data.userId} and same_porch(user_id, ${context.userId})`;
    if (!found.length) return { ok: false as const, error: "That person is not in your porch." };
    await sql`update offices set head_user_id = ${data.userId} where key = ${data.key} and porch_id = my_porch(${context.userId})`;
    return { ok: true as const };
  });

export const openOffice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      key: parseKey(raw.key),
      memberId: typeof raw.memberId === "string" ? raw.memberId : "",
      room: parseRoom(raw.room),
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.key) return { ok: false as const, error: "That office is not here." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureOffices(sql, context.userId);
    const offices = await sql.query<{ name: string; head_user_id: string | null; head_name: string | null }>(
      `select o.name, o.head_user_id, p.display_name as head_name
       from offices o
       left join profiles p on p.user_id = o.head_user_id
       where o.key = $1 and o.porch_id = my_porch($2)`,
      [data.key, context.userId],
    );
    const office = offices[0];
    if (!office) return { ok: false as const, error: "That office is not here." };
    const isFounder = await founderFlag(sql, context.userId);
    const isHead = office.head_user_id === context.userId;
    const officeHolder = await holdsOffice(sql, context.userId);
    const oversee = isFounder || isHead;
    let room = data.key === "pastor" ? data.room : "";
    if (data.key === "pastor" && room === "account" && !officeHolder && !isFounder && !isHead) room = "";
    if (data.key === "pastor" && room === "official" && !officeHolder && !isFounder && !isHead) room = "";
    // Locked offices: members only write; the calendar is for the office's owners.
    if (data.key === "pastor" && room === "calendar" && !isFounder && !isHead) room = "";
    if (data.key === "pastor" && !room) {
      return {
        ok: true as const,
        kind: "rooms" as const,
        name: office.name,
        room: "",
        roomName: "",
        headUserId: office.head_user_id,
        headName: office.head_name,
        hasHead: Boolean(office.head_user_id),
        isFounder,
        isHead,
        holdsOffice: officeHolder,
        memberId: "",
        memberName: "",
        threads: [] as OfficeThreadPreview[],
        notes: [] as OfficeNote[],
        requestStatus: "open" as const,
        calendar: "",
        canEditCalendar: false,
        waiting: false,
        doorClosed: false,
      };
    }
    if (data.key === "pastor" && room === "calendar") {
      const saved = await sql<{ body: string }>`
        select body from office_calendar where office_key = 'pastor' and porch_id = my_porch(${context.userId})
      `;
      return {
        ok: true as const,
        kind: "calendar" as const,
        name: office.name,
        room,
        roomName: "Calendar",
        headUserId: office.head_user_id,
        headName: office.head_name,
        hasHead: Boolean(office.head_user_id),
        isFounder,
        isHead,
        holdsOffice: officeHolder,
        memberId: "",
        memberName: "",
        threads: [] as OfficeThreadPreview[],
        notes: [] as OfficeNote[],
        requestStatus: "open" as const,
        calendar: saved[0]?.body ?? "",
        canEditCalendar: isHead,
        waiting: false,
        doorClosed: false,
      };
    }
    const noteRoom = threadRoom(data.key, room);
    if (data.key === "pastor" && !noteRoom) {
      return { ok: false as const, error: "That room is not here." };
    }
    let memberId = oversee ? data.memberId : context.userId;
    if (isHead && memberId === context.userId) memberId = "";

    const threads = oversee
      ? await sql.query<{
          member_id: string;
          member_name: string;
          member_image: string | null;
          status: string | null;
          last_body: string | null;
          updated_at: string | null;
          door: boolean | null;
        }>(
          `select t.member_id, p.display_name as member_name, p.image_url as member_image,
                  t.status,
                  exists (select 1 from office_doors d where d.office_key = t.office_key and d.member_id = t.member_id and d.porch_id = t.porch_id) as door,
                  last.body as last_body,
                  to_char(last.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
           from office_threads t
           join profiles p on p.user_id = t.member_id
           left join lateral (
             select body, created_at from office_messages
             where thread_id = t.id and not held
             order by created_at desc
             limit 1
           ) last on true
           where t.office_key = $1 and t.room = $2 and t.porch_id = my_porch($3)
             and exists (select 1 from office_messages m where m.thread_id = t.id and not m.held)
           order by case t.status when 'open' then 0 when 'received' then 1 else 2 end,
                    last.created_at desc nulls last, t.created_at desc`,
          [data.key, noteRoom, context.userId],
        )
      : [];

    let notes: OfficeNote[] = [];
    let memberName = "";
    let requestStatus: PrayerStatus = "open";
    if (memberId && office.head_user_id) {
      if (!oversee && memberId !== context.userId) {
        noteAttempt(context.userId, "office-read", "Tried to open an office thread that is not theirs.");
        return { ok: false as const, error: "That conversation is not yours." };
      }
      const who = await sql<{ display_name: string; status: string | null }>`
        select p.display_name, t.status
        from profiles p
        left join office_threads t on t.member_id = p.user_id and t.office_key = ${data.key} and t.room = ${noteRoom} and t.porch_id = my_porch(${context.userId})
        where p.user_id = ${memberId} and same_porch(p.user_id, ${context.userId})
      `;
      memberName = who[0]?.display_name ?? "";
      requestStatus = parseStatus(who[0]?.status);
      const rows = await sql.query<{
        id: number;
        author_id: string;
        author_name: string;
        body: string;
        created_at: string;
        official: boolean;
        held: boolean;
      }>(
        `select m.id, m.author_id, p.display_name as author_name, m.body, m.official, m.held,
                to_char(m.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
         from office_messages m
         join office_threads t on t.id = m.thread_id
         join profiles p on p.user_id = m.author_id
         where t.office_key = $1 and t.member_id = $2 and t.room = $3 and t.porch_id = my_porch($4)
           and (not m.held or m.author_id = $4)
         order by m.created_at asc`,
        [data.key, memberId, noteRoom, context.userId],
      );
      notes = rows.map((row) => ({
        id: row.id,
        authorId: row.author_id,
        authorName: row.author_name,
        body: row.body,
        createdAt: row.created_at,
        mine: row.author_id === context.userId,
        official: Boolean(row.official),
        held: boolish(row.held),
      }));
    }
    // One message until the office replies: the person waits while the last word is theirs.
    const waiting = !isHead && memberId === context.userId && notes.length > 0 && notes[notes.length - 1].mine;
    let doorClosed = false;
    if (oversee && memberId && memberId !== context.userId) {
      const door = await sql.query<{ member_id: string }>("select member_id from office_doors where office_key = $1 and member_id = $2 and porch_id = my_porch($3)", [data.key, memberId, context.userId]);
      doorClosed = door.length > 0;
    }

    const roomName = PASTOR_ROOMS.find((item) => item.key === noteRoom)?.name ?? office.name;

    return {
      ok: true as const,
      kind: "notes" as const,
      name: office.name,
      room: noteRoom,
      roomName,
      headUserId: office.head_user_id,
      headName: office.head_name,
      hasHead: Boolean(office.head_user_id),
      isFounder,
      isHead,
      holdsOffice: officeHolder,
      memberId,
      memberName,
      threads: threads.map((row) => ({
        memberId: row.member_id,
        memberName: row.member_name,
        memberImage: row.member_image,
        lastBody: row.last_body ?? "",
        updatedAt: row.updated_at ?? "",
        status: parseStatus(row.status),
        doorClosed: boolish(row.door),
      })),
      notes,
      requestStatus,
      calendar: "",
      canEditCalendar: false,
      waiting,
      doorClosed,
    };
  });

export const sendOfficeNote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      key: parseKey(raw.key),
      memberId: typeof raw.memberId === "string" ? raw.memberId : "",
      room: parseRoom(raw.room),
      body: typeof raw.body === "string" ? clip(raw.body, 2000) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.key || !data.body) return { ok: false as const, error: "Write a note first." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureOffices(sql, context.userId);
    const offices = await sql<{ head_user_id: string | null }>`
      select head_user_id from offices where key = ${data.key} and porch_id = my_porch(${context.userId})
    `;
    const headId = offices[0]?.head_user_id ?? null;
    if (!headId) return { ok: false as const, error: "This office has no head yet." };
    const noteRoom = threadRoom(data.key, data.room);
    if (!noteRoom) return { ok: false as const, error: "That room is not here." };
    if (noteRoom === "account" && !(await holdsOffice(sql, context.userId))) {
      noteAttempt(context.userId, "office-account", "Tried to write in Accountability.");
      return { ok: false as const, error: "That room is not here." };
    }
    if (noteRoom === "official" && headId !== context.userId) {
      const existing = await sql<{ id: number }>`
        select id from office_threads where office_key = 'pastor' and member_id = ${context.userId} and room = 'official' and porch_id = my_porch(${context.userId})
      `;
      if (!existing.length) return { ok: false as const, error: "Wait for an official message." };
    }
    const isFounder = await founderFlag(sql, context.userId);
    const isHead = headId === context.userId;
    if (isFounder && !isHead) {
      noteAttempt(context.userId, "office-write", "Tried to write in an office they only read.");
      return { ok: false as const, error: "You can read this office, not write in it." };
    }
    let memberId = isHead ? data.memberId : context.userId;
    if (!memberId) memberId = context.userId;
    if (memberId === headId) {
      return { ok: false as const, error: "A head replies to the person who wrote in." };
    }
    if (isHead && memberId === context.userId) {
      return { ok: false as const, error: "Reply in a note sent to your office." };
    }
    if (!isHead && memberId !== context.userId) {
      noteAttempt(context.userId, "office-write", "Tried to write in an office thread that is not theirs.");
      return { ok: false as const, error: "That conversation is not yours." };
    }
    if (isHead && memberId !== context.userId) {
      const existing = await sql<{ id: number }>`
        select id from office_threads where office_key = ${data.key} and member_id = ${memberId} and room = ${noteRoom} and porch_id = my_porch(${context.userId})
      `;
      if (!existing.length) {
        return { ok: false as const, error: "Wait for someone to write to your office." };
      }
    }
    const member = await sql<{ user_id: string }>`select user_id from profiles where user_id = ${memberId} and same_porch(user_id, ${context.userId})`;
    if (!member.length) return { ok: false as const, error: "That person is not on Porchbook." };
    let held = false;
    if (!isHead) {
      const last = await sql.query<{ author_id: string }>(
        `select m.author_id from office_messages m join office_threads t on t.id = m.thread_id
          where t.office_key = $1 and t.member_id = $2 and t.room = $3 and t.porch_id = my_porch($4) order by m.created_at desc, m.id desc limit 1`,
        [data.key, memberId, noteRoom, context.userId],
      );
      if (last[0]?.author_id === context.userId) return { ok: false as const, error: "Your message is with the office. You can write again when they reply." };
      const door = await sql.query<{ member_id: string }>("select member_id from office_doors where office_key = $1 and member_id = $2 and porch_id = my_porch($2)", [data.key, context.userId]);
      held = door.length > 0;
    }
    const inserted = await sql<{ id: number }>`
      insert into office_threads (porch_id, office_key, member_id, room)
      values (my_porch(${context.userId}), ${data.key}, ${memberId}, ${noteRoom})
      on conflict (porch_id, office_key, member_id, room) do update set room = excluded.room
      returning id
    `;
    const threadId = inserted[0]?.id;
    if (!threadId) return { ok: false as const, error: "Couldn't open that office." };
    await sql`
      insert into office_messages (thread_id, author_id, body, official, held)
      values (${threadId}, ${context.userId}, ${data.body}, ${noteRoom === "official" && isHead}, ${held})
    `;
    if (held) return { ok: true as const, held: true };
    if (noteRoom === "thanks" && context.userId === memberId) {
      await sql`update office_threads set status = 'open' where id = ${threadId}`;
    }
    const officeName =
      data.key === "pastor"
        ? (PASTOR_ROOMS.find((item) => item.key === noteRoom)?.name ?? "Office of the Pastor")
        : (OFFICES.find((office) => office.key === data.key)?.name ?? "your office");
    const roomQuery = data.key === "pastor" ? `&room=${noteRoom}` : "";
    const people = await sql<{ display_name: string }>`
      select display_name from profiles where user_id = ${context.userId}
    `;
    const name = people[0]?.display_name?.trim() || "Someone";
    const { notifyPeople } = await import("@/lib/porch/push.server");
    await notifyPeople(
      sql,
      [headId, memberId].filter((id): id is string => Boolean(id) && id !== context.userId),
      officeName,
      `${name} wrote in ${officeName}`,
      `/offices/${data.key}?member=${encodeURIComponent(memberId)}${roomQuery}`,
    );
    return { ok: true as const };
  });

export const setPrayerStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const status = raw.status === "received" || raw.status === "answered" ? raw.status : null;
    return {
      memberId: typeof raw.memberId === "string" ? raw.memberId : "",
      status,
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.memberId || !data.status) return { ok: false as const, error: "Choose a mark." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureOffices(sql, context.userId);
    const offices = await sql<{ head_user_id: string | null }>`
      select head_user_id from offices where key = 'pastor' and porch_id = my_porch(${context.userId})
    `;
    const headId = offices[0]?.head_user_id ?? null;
    if (data.status === "answered") {
      if (context.userId !== data.memberId) {
        return { ok: false as const, error: "Only the person who asked can mark it answered." };
      }
    } else if (context.userId !== headId) {
      noteAttempt(context.userId, "prayer-mark", "Tried to mark a prayer request received.");
      return { ok: false as const, error: "Only the pastor's office can mark it received." };
    }
    const updated = await sql<{ member_id: string }>`
      update office_threads set status = ${data.status}
      where office_key = 'pastor' and room = 'thanks' and member_id = ${data.memberId} and porch_id = my_porch(${context.userId})
      returning member_id
    `;
    if (!updated.length) return { ok: false as const, error: "That request is not here." };
    return { ok: true as const };
  });

export const saveCalendar = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      body: typeof raw.body === "string" ? clip(raw.body, 4000) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureOffices(sql, context.userId);
    const offices = await sql<{ head_user_id: string | null }>`
      select head_user_id from offices where key = 'pastor' and porch_id = my_porch(${context.userId})
    `;
    const headId = offices[0]?.head_user_id ?? null;
    if (context.userId !== headId) {
      noteAttempt(context.userId, "calendar", "Tried to change the pastor's calendar.");
      return { ok: false as const, error: "Only the pastor's office can write the calendar." };
    }
    await sql`
      insert into office_calendar (porch_id, office_key, body, updated_at)
      values (my_porch(${context.userId}), 'pastor', ${data.body}, now())
      on conflict (porch_id, office_key) do update set body = excluded.body, updated_at = now()
    `;
    return { ok: true as const };
  });

export const listOfficeHolders = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await ensureOffices(sql, context.userId);
    const pastor = await sql<{ head_user_id: string | null }>`select head_user_id from offices where key = 'pastor' and porch_id = my_porch(${context.userId})`;
    if (pastor[0]?.head_user_id !== context.userId) return { ok: false as const, error: "Only the pastor can write an official message.", people: [] as { userId: string; displayName: string; offices: string[] }[] };
    const rows = await sql<{ user_id: string; display_name: string; name: string }>`
      select p.user_id, p.display_name, o.name
      from offices o
      join profiles p on p.user_id = o.head_user_id
      where o.head_user_id is not null and o.head_user_id <> ${context.userId} and o.porch_id = my_porch(${context.userId})
      order by o.sort
    `;
    const people = new Map<string, { userId: string; displayName: string; offices: string[] }>();
    for (const row of rows) {
      const current = people.get(row.user_id) ?? { userId: row.user_id, displayName: row.display_name || "Office holder", offices: [] };
      current.offices.push(row.name);
      people.set(row.user_id, current);
    }
    return { ok: true as const, people: [...people.values()] };
  });

export const sendOfficial = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      body: typeof raw.body === "string" ? clip(raw.body, 2000) : "",
      userId: typeof raw.userId === "string" ? raw.userId : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.body) return { ok: false as const, error: "Write the message first." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureOffices(sql, context.userId);
    const pastor = await sql<{ head_user_id: string | null }>`select head_user_id from offices where key = 'pastor' and porch_id = my_porch(${context.userId})`;
    if (pastor[0]?.head_user_id !== context.userId) {
      noteAttempt(context.userId, "official", "Tried to send an official message.");
      return { ok: false as const, error: "Only the pastor can write an official message." };
    }
    const heads = await sql<{ user_id: string }>`
      select distinct head_user_id as user_id from offices
      where head_user_id is not null and head_user_id <> ${context.userId} and porch_id = my_porch(${context.userId})
    `;
    const targets = data.userId ? heads.filter((row) => row.user_id === data.userId) : heads;
    if (!targets.length) return { ok: false as const, error: data.userId ? "That person does not hold an office." : "No office holder yet." };
    for (const target of targets) {
      const inserted = await sql<{ id: number }>`
        insert into office_threads (porch_id, office_key, member_id, room)
        values (my_porch(${context.userId}), 'pastor', ${target.user_id}, 'official')
        on conflict (porch_id, office_key, member_id, room) do update set room = excluded.room
        returning id
      `;
      const threadId = inserted[0]?.id;
      if (!threadId) continue;
      await sql`
        insert into office_messages (thread_id, author_id, body, official)
        values (${threadId}, ${context.userId}, ${data.body}, true)
      `;
    }
    const { notifyPeople } = await import("@/lib/porch/push.server");
    await notifyPeople(
      sql,
      targets.map((row) => row.user_id),
      "Official",
      "A message from the pastor's office",
      "/offices/pastor?room=official",
    );
    return { ok: true as const, sent: targets.length };
  });



/** The office head closes (or opens) their door to one person. Opening it delivers what was held. */
export const setOfficeDoor = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { key: parseKey(raw.key), memberId: typeof raw.memberId === "string" ? raw.memberId : "", open: raw.open === true };
  })
  .handler(async ({ context, data }) => {
    if (!data.key || !data.memberId) return { ok: false as const, error: "Choose the person first." };
    const sql = await getSql();
    await ensureOffices(sql, context.userId);
    const office = await sql.query<{ head_user_id: string | null; name: string }>("select head_user_id, name from offices where key = $1 and porch_id = my_porch($2)", [data.key, context.userId]);
    if (!office[0] || office[0].head_user_id !== context.userId) {
      noteAttempt(context.userId, "office-door", "Tried to close or open an office door that isn't theirs.");
      return { ok: false as const, error: "Only the office's head can do that." };
    }
    if (data.memberId === context.userId) return { ok: false as const, error: "That's you." };
    if (!data.open) {
      await sql.query("insert into office_doors (porch_id, office_key, member_id) values (my_porch($3), $1, $2) on conflict do nothing", [data.key, data.memberId, context.userId]);
      return { ok: true as const };
    }
    await sql.query("delete from office_doors where office_key = $1 and member_id = $2 and porch_id = my_porch($3)", [data.key, data.memberId, context.userId]);
    const released = await sql.query<{ id: number }>(
      `update office_messages m set held = false from office_threads t
        where t.id = m.thread_id and t.office_key = $1 and t.member_id = $2 and t.porch_id = my_porch($3) and m.held returning m.id`,
      [data.key, data.memberId, context.userId],
    );
    if (released.length) {
      try {
        const people = await sql.query<{ display_name: string }>("select display_name from profiles where user_id = $1", [data.memberId]);
        const { notifyPeople } = await import("@/lib/porch/push.server");
        await notifyPeople(sql, [context.userId], office[0].name, `${people[0]?.display_name?.trim() || "Someone"} wrote in ${office[0].name}`, `/offices/${data.key}?member=${encodeURIComponent(data.memberId)}`);
      } catch {
        // The messages are in the office either way.
      }
    }
    return { ok: true as const, released: released.length };
  });
