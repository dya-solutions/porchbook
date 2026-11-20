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

export type OfficeKey = string;

/**
 * What an office can offer (Stage 4b). Each office chooses some of these.
 * Phaneroo's Office of the Pastor offers all six; its other offices offer "Contact the office".
 */
export const OFFICE_ACTIONS = [
  { key: "thanks", name: "Thank God with me", hint: "Share a testimony or prayer request" },
  { key: "chat", name: "Contact the office", hint: "Send a private message" },
  { key: "appoint", name: "Book an appointment", hint: "Ask for a time to meet" },
  { key: "calendar", name: "Weekly programme", hint: "Services and meetings this week" },
  { key: "account", name: "Accountability", hint: "Report back on an assignment" },
  { key: "official", name: "Official", hint: "Messages from this office to office holders" },
] as const;
export type OfficeAction = (typeof OFFICE_ACTIONS)[number]["key"];
const ACTION_KEYS = new Set<string>(OFFICE_ACTIONS.map((action) => action.key));

/** An action's name for one office ("Contact the pastor" for the Office of the Pastor). */
export function actionName(action: string, officeKey: string, officeName: string) {
  if (action === "chat") {
    if (officeKey === "pastor" || /pastor/i.test(officeName)) return "Contact the pastor";
    return "Contact the office";
  }
  return OFFICE_ACTIONS.find((item) => item.key === action)?.name ?? "Office";
}

/** A request's status, in words: Sent, Confirmed, Answered. */
export function statusName(status: string) {
  return status === "received" ? "Confirmed" : status === "answered" ? "Answered" : "Sent";
}

function parseActions(value: unknown): OfficeAction[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.replace(/[{}"]/g, "").split(",") : [];
  return [...new Set(list.map((item) => String(item).trim()).filter((item) => ACTION_KEYS.has(item)))] as OfficeAction[];
}

export type OfficeCard = {
  key: OfficeKey;
  name: string;
  description: string;
  actions: OfficeAction[];
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
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{1,40}$/.test(value) ? value : null;
}

function parseRoom(value: unknown): PastorRoom | "" {
  if (value === "thanks" || value === "chat" || value === "appoint" || value === "calendar" || value === "account" || value === "official") return value;
  return "";
}

/** The conversation room for an action this office offers ("" when it doesn't offer it). */
function threadRoom(actions: OfficeAction[], room: PastorRoom | ""): string {
  if (!room || room === "calendar" || !actions.includes(room)) return "";
  return room;
}

async function ensureOffices(sql: Sql, userId: string) {
  // Each church porch has its own offices (Stage 3b). The office's short key ("pastor") is only
  // unique within a church, so the old links that assumed one set of offices are removed.
  await sql`alter table office_threads drop constraint if exists office_threads_office_key_fkey`;
  await sql`alter table office_calendar drop constraint if exists office_calendar_office_key_fkey`;
  await porchTables(sql, { key: [["offices", "key"]] });
  await sql`alter table offices add column if not exists description text not null default ''`;
  await sql`alter table offices add column if not exists actions text[] not null default '{}'`;
  await sql`alter table offices add column if not exists removed_at timestamptz`;
  // Phaneroo (porch 1) has its 8 offices (seeded first, so the one-time step below finds them).
  // Other churches create their own (Stage 4b).
  // Existing offices are never overwritten, so renames and removals stay.
  for (const [index, office] of OFFICES.entries()) {
    await sql`
      insert into offices (porch_id, key, name, sort)
      values (1, ${office.key}, ${office.name}, ${index + 1})
      on conflict (porch_id, key) do nothing
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
  // Once: Phaneroo's offices get their actions and short descriptions, and their single
  // conversation ("note") becomes "Contact the office" (Stage 4b).
  const first = await sql<{ step: string }>`insert into porch_steps (step) values ('offices-actions-v1') on conflict do nothing returning step`;
  if (first.length) {
    await sql`update offices set actions = '{thanks,chat,appoint,calendar,account,official}' where key = 'pastor' and cardinality(actions) = 0`;
    await sql`update offices set actions = '{chat}' where key <> 'pastor' and cardinality(actions) = 0`;
    for (const [key, text] of Object.entries(PHANEROO_DESCRIPTIONS)) {
      await sql`update offices set description = ${text} where porch_id = 1 and key = ${key} and description = ''`;
    }
    await sql`update office_threads set room = 'chat' where room = 'note' and office_key <> 'pastor'`;
  }
  // The old "Prayer Requests" office (from the first database setup) was merged into the Office of
  // the Pastor's "Thank God with me" long ago. It used to be filtered out; now it is marked removed.
  const merged = await sql<{ step: string }>`insert into porch_steps (step) values ('offices-prayer-merged-v1') on conflict do nothing returning step`;
  if (merged.length) await sql`update offices set removed_at = now() where key = 'prayer' and removed_at is null`;
  // Office announcements (Stage 4b): one at a time per office, shown pinned at the top of My porch.
  await sql`
    create table if not exists office_announcements (
      id serial primary key,
      porch_id integer not null references porches(id),
      office_key text not null,
      author_id text not null,
      body text not null,
      created_at timestamptz not null default now(),
      removed_at timestamptz
    )
  `;
}

/** Phaneroo's offices, described as in design-reference/Offices.dc.html. */
const PHANEROO_DESCRIPTIONS: Record<string, string> = {
  pastor: "Prayer, appointments, contact the pastor",
  administrator: "Church records and general requests",
  communications: "Announcements and media",
  missions: "Outreach teams and reports",
  pastoral: "Care, visits and counselling",
  centre: "Your centre and its leaders",
};

async function holdsOffice(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql.query<{ head_user_id: string }>(
    "select head_user_id from offices where head_user_id = $1 and porch_id = my_porch($1) and removed_at is null limit 1",
    [userId],
  );
  return rows.length > 0;
}

/** The office this person heads that offers Official messages (the Office of the Pastor at Phaneroo). */
async function officialOffice(sql: Sql, userId: string): Promise<{ key: string; name: string } | null> {
  const rows = await sql<{ key: string; name: string }>`
    select key, name from offices
    where head_user_id = ${userId} and porch_id = my_porch(${userId}) and removed_at is null and 'official' = any(actions)
    order by sort limit 1
  `;
  return rows[0] ?? null;
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
      description: string;
      actions: unknown;
      head_user_id: string | null;
      head_name: string | null;
      head_image: string | null;
    }>(
      `select o.key, o.name, o.description, o.actions, o.head_user_id, p.display_name as head_name, p.image_url as head_image
       from offices o
       left join profiles p on p.user_id = o.head_user_id
       where o.porch_id = my_porch($1) and o.removed_at is null
       order by o.sort asc, o.name asc`,
      [context.userId],
    );
    const offices: OfficeCard[] = rows
      .map((row) => ({
        key: row.key,
        name: row.name,
        description: row.description ?? "",
        actions: parseActions(row.actions),
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
    // The person's own requests to offices, newest first, with their status (Stage 4b).
    const mine = await sql.query<{ office_key: string; office_name: string; room: string; status: string | null; last_body: string | null; updated_at: string | null }>(
      `select t.office_key, o.name as office_name, t.room, t.status, last.body as last_body,
              to_char(last.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
       from office_threads t
       join offices o on o.key = t.office_key and o.porch_id = t.porch_id and o.removed_at is null
       join lateral (
         select body, created_at from office_messages where thread_id = t.id order by created_at desc, id desc limit 1
       ) last on true
       where t.member_id = $1 and t.porch_id = my_porch($1) and t.room <> 'official' and o.head_user_id is distinct from $1
       order by last.created_at desc
       limit 20`,
      [context.userId],
    );
    return {
      isFounder,
      offices,
      people: people.map((person) => ({ userId: person.user_id, displayName: person.display_name })),
      requests: mine.map((row) => ({
        officeKey: row.office_key,
        officeName: row.office_name,
        room: row.room,
        roomName: actionName(row.room, row.office_key, row.office_name),
        status: parseStatus(row.status),
        lastBody: row.last_body ?? "",
        updatedAt: row.updated_at ?? "",
      })),
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
      return { ok: false as const, error: "Only an admin can choose a head." };
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
    const offices = await sql.query<{ name: string; description: string; actions: unknown; head_user_id: string | null; head_name: string | null; phaneroo: unknown }>(
      `select o.name, o.description, o.actions, o.head_user_id, p.display_name as head_name, o.porch_id = 1 as phaneroo
       from offices o
       left join profiles p on p.user_id = o.head_user_id
       where o.key = $1 and o.porch_id = my_porch($2) and o.removed_at is null`,
      [data.key, context.userId],
    );
    const office = offices[0];
    if (!office) return { ok: false as const, error: "That office is not here." };
    const isFounder = await founderFlag(sql, context.userId);
    const isHead = office.head_user_id === context.userId;
    const officeHolder = await holdsOffice(sql, context.userId);
    const oversee = isFounder || isHead;
    const actions = parseActions(office.actions);
    let room: PastorRoom | "" = data.room && actions.includes(data.room) ? data.room : "";
    if (room === "account" && !officeHolder && !isFounder && !isHead) room = "";
    if (room === "official" && !officeHolder && !isFounder && !isHead) room = "";
    if (!room) {
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
        actions,
        description: office.description ?? "",
        phanerooWeek: office.phaneroo === true && data.key === "pastor",
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
    if (room === "calendar") {
      // The weekly programme: everyone reads it; the office's head writes it.
      const saved = await sql<{ body: string }>`
        select body from office_calendar where office_key = ${data.key} and porch_id = my_porch(${context.userId})
      `;
      return {
        ok: true as const,
        kind: "calendar" as const,
        name: office.name,
        room,
        roomName: actionName("calendar", data.key, office.name),
        headUserId: office.head_user_id,
        headName: office.head_name,
        hasHead: Boolean(office.head_user_id),
        isFounder,
        isHead,
        holdsOffice: officeHolder,
        actions,
        description: office.description ?? "",
        phanerooWeek: office.phaneroo === true && data.key === "pastor",
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
    const noteRoom = threadRoom(actions, room);
    if (!noteRoom) {
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

    const roomName = actionName(noteRoom, data.key, office.name);

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
      actions,
      description: office.description ?? "",
      phanerooWeek: false,
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
    const offices = await sql<{ head_user_id: string | null; name: string; actions: unknown }>`
      select head_user_id, name, actions from offices where key = ${data.key} and porch_id = my_porch(${context.userId}) and removed_at is null
    `;
    const headId = offices[0]?.head_user_id ?? null;
    if (!headId) return { ok: false as const, error: "This office has no head yet." };
    const noteRoom = threadRoom(parseActions(offices[0]?.actions), data.room);
    if (!noteRoom) return { ok: false as const, error: "That room is not here." };
    if (noteRoom === "account" && !(await holdsOffice(sql, context.userId))) {
      noteAttempt(context.userId, "office-account", "Tried to write in Accountability.");
      return { ok: false as const, error: "That room is not here." };
    }
    if (noteRoom === "official" && headId !== context.userId) {
      const existing = await sql<{ id: number }>`
        select id from office_threads where office_key = ${data.key} and member_id = ${context.userId} and room = 'official' and porch_id = my_porch(${context.userId})
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
    // A request's status (Stage 4b): Sent when the person writes; when the office replies it is
    // Answered (for "Thank God with me", Confirmed: the person marks it answered when God answers).
    if (noteRoom !== "official") {
      if (context.userId === memberId) {
        await sql`update office_threads set status = 'open' where id = ${threadId}`;
      } else {
        await sql`update office_threads set status = ${noteRoom === "thanks" ? "received" : "answered"} where id = ${threadId} and status <> 'answered'`;
      }
    }
    const officeName = `${offices[0]?.name ?? "Office"} · ${actionName(noteRoom, data.key, offices[0]?.name ?? "")}`;
    const roomQuery = `&room=${noteRoom}`;
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
      key: parseKey(raw.key) ?? "pastor",
      room: parseRoom(raw.room) || "thanks",
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
      select head_user_id from offices where key = ${data.key} and porch_id = my_porch(${context.userId}) and removed_at is null
    `;
    const headId = offices[0]?.head_user_id ?? null;
    const isHead = Boolean(headId) && context.userId === headId;
    // The office marks Confirmed or Answered. For "Thank God with me" the person who asked marks it answered.
    const askerMayAnswer = data.room === "thanks" && data.status === "answered" && context.userId === data.memberId;
    if (!isHead && !askerMayAnswer) {
      noteAttempt(context.userId, "prayer-mark", "Tried to mark an office request.");
      return { ok: false as const, error: "Only the office can mark this." };
    }
    const updated = await sql<{ member_id: string }>`
      update office_threads set status = ${data.status}
      where office_key = ${data.key} and room = ${data.room} and member_id = ${data.memberId} and porch_id = my_porch(${context.userId})
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
      key: parseKey(raw.key) ?? "pastor",
      body: typeof raw.body === "string" ? clip(raw.body, 4000) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureOffices(sql, context.userId);
    const offices = await sql<{ head_user_id: string | null }>`
      select head_user_id from offices where key = ${data.key} and porch_id = my_porch(${context.userId}) and removed_at is null and 'calendar' = any(actions)
    `;
    const headId = offices[0]?.head_user_id ?? null;
    if (!headId || context.userId !== headId) {
      noteAttempt(context.userId, "calendar", "Tried to change an office's weekly programme.");
      return { ok: false as const, error: "Only the office's head can write the weekly programme." };
    }
    await sql`
      insert into office_calendar (porch_id, office_key, body, updated_at)
      values (my_porch(${context.userId}), ${data.key}, ${data.body}, now())
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
    if (!(await officialOffice(sql, context.userId))) return { ok: false as const, error: "Only the head of an office with Official messages can write one.", people: [] as { userId: string; displayName: string; offices: string[] }[] };
    const rows = await sql<{ user_id: string; display_name: string; name: string }>`
      select p.user_id, p.display_name, o.name
      from offices o
      join profiles p on p.user_id = o.head_user_id
      where o.head_user_id is not null and o.head_user_id <> ${context.userId} and o.porch_id = my_porch(${context.userId}) and o.removed_at is null
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
    const from = await officialOffice(sql, context.userId);
    if (!from) {
      noteAttempt(context.userId, "official", "Tried to send an official message.");
      return { ok: false as const, error: "Only the head of an office with Official messages can write one." };
    }
    const heads = await sql<{ user_id: string }>`
      select distinct head_user_id as user_id from offices
      where head_user_id is not null and head_user_id <> ${context.userId} and porch_id = my_porch(${context.userId}) and removed_at is null
    `;
    const targets = data.userId ? heads.filter((row) => row.user_id === data.userId) : heads;
    if (!targets.length) return { ok: false as const, error: data.userId ? "That person does not hold an office." : "No office holder yet." };
    for (const target of targets) {
      const inserted = await sql<{ id: number }>`
        insert into office_threads (porch_id, office_key, member_id, room)
        values (my_porch(${context.userId}), ${from.key}, ${target.user_id}, 'official')
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
      `A message from the ${from.name}`,
      `/offices/${from.key}?room=official`,
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


// ---------------------------------------------------------------------------------------------
// Stage 4b: each church makes its own offices. Only the porch's admins create, rename or remove
// them, choose the head (setOfficeHead) and choose what each office offers.

function parseActionList(value: unknown): OfficeAction[] {
  return parseActions(Array.isArray(value) ? value : []);
}

function parseOfficeForm(input: unknown) {
  const raw = asRecord(input);
  return {
    key: parseKey(raw.key),
    name: typeof raw.name === "string" ? clip(raw.name.trim(), 60) : "",
    description: typeof raw.description === "string" ? clip(raw.description.trim(), 120) : "",
    actions: parseActionList(raw.actions),
  };
}

function slugOf(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/^(the )?office of (the )?/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return slug.length >= 2 ? slug : "office";
}

export const createOffice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(parseOfficeForm)
  .handler(async ({ context, data }) => {
    if (!data.name) return { ok: false as const, error: "Give the office a name." };
    if (!data.actions.length) return { ok: false as const, error: "Choose at least one thing the office offers." };
    const sql = await getSql();
    await ensureOffices(sql, context.userId);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "office-create", "Tried to create an office.");
      return { ok: false as const, error: "Only an admin can create an office." };
    }
    const kind = await sql<{ kind: string }>`select kind from porches where id = my_porch(${context.userId})`;
    if (kind[0]?.kind !== "church") return { ok: false as const, error: "Offices are for church porches." };
    const base = slugOf(data.name);
    const taken = await sql<{ key: string }>`select key from offices where porch_id = my_porch(${context.userId})`;
    const used = new Set(taken.map((row) => row.key));
    let key = base;
    for (let n = 2; used.has(key); n += 1) key = `${base}-${n}`;
    await sql`
      insert into offices (porch_id, key, name, description, actions, sort)
      values (my_porch(${context.userId}), ${key}, ${data.name}, ${data.description}, ${data.actions},
              coalesce((select max(sort) from offices where porch_id = my_porch(${context.userId})), 0) + 1)
    `;
    return { ok: true as const, key };
  });

export const updateOffice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(parseOfficeForm)
  .handler(async ({ context, data }) => {
    if (!data.key) return { ok: false as const, error: "That office is not here." };
    if (!data.name) return { ok: false as const, error: "Give the office a name." };
    if (!data.actions.length) return { ok: false as const, error: "Choose at least one thing the office offers." };
    const sql = await getSql();
    await ensureOffices(sql, context.userId);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "office-edit", "Tried to change an office.");
      return { ok: false as const, error: "Only an admin can change an office." };
    }
    const updated = await sql<{ key: string }>`
      update offices set name = ${data.name}, description = ${data.description}, actions = ${data.actions}
      where key = ${data.key} and porch_id = my_porch(${context.userId}) and removed_at is null
      returning key
    `;
    if (!updated.length) return { ok: false as const, error: "That office is not here." };
    return { ok: true as const };
  });

/** Removing keeps the office's old conversations in the database; it just stops showing. */
export const removeOffice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ key: parseKey(asRecord(input).key) }))
  .handler(async ({ context, data }) => {
    if (!data.key) return { ok: false as const, error: "That office is not here." };
    const sql = await getSql();
    await ensureOffices(sql, context.userId);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "office-remove", "Tried to remove an office.");
      return { ok: false as const, error: "Only an admin can remove an office." };
    }
    const removed = await sql<{ key: string }>`
      update offices set removed_at = now()
      where key = ${data.key} and porch_id = my_porch(${context.userId}) and removed_at is null
      returning key
    `;
    if (!removed.length) return { ok: false as const, error: "That office is not here." };
    await sql`update office_announcements set removed_at = now() where office_key = ${data.key} and porch_id = my_porch(${context.userId}) and removed_at is null`;
    return { ok: true as const };
  });

export type OfficeAnnouncement = {
  id: number;
  officeKey: string;
  officeName: string;
  body: string;
  createdAt: string;
  canRemove: boolean;
};

/** The current announcements of my porch's offices (one per office), newest first. */
export const listAnnouncements = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensureOffices(sql, context.userId);
    const isFounder = await founderFlag(sql, context.userId);
    const rows = await sql<{ id: number; office_key: string; office_name: string; body: string; created_at: string; head_user_id: string | null }>`
      select a.id, a.office_key, o.name as office_name, a.body, o.head_user_id,
             to_char(a.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
      from office_announcements a
      join offices o on o.key = a.office_key and o.porch_id = a.porch_id and o.removed_at is null
      where a.porch_id = my_porch(${context.userId}) and a.removed_at is null
      order by a.created_at desc
      limit 3
    `;
    return rows.map((row): OfficeAnnouncement => ({
      id: row.id,
      officeKey: row.office_key,
      officeName: row.office_name,
      body: row.body,
      createdAt: row.created_at,
      canRemove: isFounder || row.head_user_id === context.userId,
    }));
  });

/** The office's head posts an announcement. It replaces the office's earlier one. */
export const postAnnouncement = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { key: parseKey(raw.key), body: typeof raw.body === "string" ? clip(raw.body.trim(), 600) : "" };
  })
  .handler(async ({ context, data }) => {
    if (!data.key) return { ok: false as const, error: "That office is not here." };
    if (!data.body) return { ok: false as const, error: "Write the announcement first." };
    const sql = await getSql();
    await ensureOffices(sql, context.userId);
    const office = await sql<{ head_user_id: string | null; name: string }>`
      select head_user_id, name from offices where key = ${data.key} and porch_id = my_porch(${context.userId}) and removed_at is null
    `;
    if (!office[0] || office[0].head_user_id !== context.userId) {
      noteAttempt(context.userId, "office-announce", "Tried to post an announcement for an office that isn't theirs.");
      return { ok: false as const, error: "Only the office's head can post its announcement." };
    }
    await sql`update office_announcements set removed_at = now() where office_key = ${data.key} and porch_id = my_porch(${context.userId}) and removed_at is null`;
    await sql`
      insert into office_announcements (porch_id, office_key, author_id, body)
      values (my_porch(${context.userId}), ${data.key}, ${context.userId}, ${data.body})
    `;
    return { ok: true as const };
  });

export const removeAnnouncement = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: Number(asRecord(input).id) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensureOffices(sql, context.userId);
    const rows = await sql<{ head_user_id: string | null }>`
      select o.head_user_id from office_announcements a
      join offices o on o.key = a.office_key and o.porch_id = a.porch_id
      where a.id = ${data.id} and a.porch_id = my_porch(${context.userId}) and a.removed_at is null
    `;
    if (!rows.length) return { ok: false as const, error: "That announcement is not here." };
    if (rows[0].head_user_id !== context.userId && !(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "office-announce", "Tried to remove an office announcement.");
      return { ok: false as const, error: "Only the office's head or an admin can remove it." };
    }
    await sql`update office_announcements set removed_at = now() where id = ${data.id}`;
    return { ok: true as const };
  });
