import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import { CHAT_REACTS, type Seed } from "@/lib/porch/model";

const EDIT_MS = 15 * 60 * 1000;
const DELETE_MS = 48 * 60 * 60 * 1000;

let ready = false;
let opening: Promise<void> | null = null;

export function ensureChat(sql: Sql): Promise<void> {
  if (ready) return Promise.resolve();
  opening ??= (async () => {
    await sql`alter table messages add column if not exists reply_to integer`;
    await sql`alter table messages add column if not exists edited_at timestamptz`;
    await sql`alter table messages add column if not exists deleted_at timestamptz`;
    await sql`
      create table if not exists message_hides (
        message_id integer not null references messages (id) on delete cascade,
        user_id text not null references profiles (user_id) on delete cascade,
        primary key (message_id, user_id)
      )
    `;
    await sql`
      create table if not exists message_stars (
        message_id integer not null references messages (id) on delete cascade,
        user_id text not null references profiles (user_id) on delete cascade,
        created_at timestamptz not null default now(),
        primary key (message_id, user_id)
      )
    `;
    await sql`
      create table if not exists message_reactions (
        message_id integer not null references messages (id) on delete cascade,
        user_id text not null references profiles (user_id) on delete cascade,
        emoji text not null,
        primary key (message_id, user_id)
      )
    `;
    await sql`
      create table if not exists conversation_pins (
        conversation_id integer primary key references conversations (id) on delete cascade,
        message_id integer not null references messages (id) on delete cascade
      )
    `;
    await sql`alter table conversations drop constraint if exists conversations_order_chk`;
    await sql`
      alter table conversations
        add constraint conversations_order_chk check (low_user_id <= high_user_id)
    `;
    ready = true;
  })().catch((error) => {
    opening = null;
    throw error;
  });
  return opening;
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function clip(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
}

function parseSeed(input: unknown): Seed {
  const raw = asRecord(input);
  const emailRaw = typeof raw.email === "string" ? clip(raw.email, 200) : "";
  return {
    displayName: typeof raw.displayName === "string" ? clip(raw.displayName, 60) : "",
    email: emailRaw.includes("@") ? emailRaw : null,
    imageUrl: typeof raw.imageUrl === "string" && raw.imageUrl.startsWith("http") ? raw.imageUrl.slice(0, 500) : null,
  };
}

type Held = {
  id: number;
  conversation_id: number;
  author_id: string;
  created_at: string;
  deleted_at: string | null;
};

async function hold(sql: Sql, viewer: string, messageId: number): Promise<Held | null> {
  const rows = await sql.query<Held & { low_user_id: string; high_user_id: string }>(
    `select m.id, m.conversation_id, m.author_id, m.created_at::text, m.deleted_at::text,
            c.low_user_id, c.high_user_id
     from messages m
     join conversations c on c.id = m.conversation_id
     where m.id = $1 and c.porch_id = my_porch($2)`,
    [messageId, viewer],
  );
  const row = rows[0];
  if (!row || (row.low_user_id !== viewer && row.high_user_id !== viewer)) return null;
  return row;
}

function fresh(iso: string, windowMs: number) {
  const at = Date.parse(iso);
  return !Number.isNaN(at) && Date.now() - at <= windowMs;
}

export const editMessage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      messageId: Number(raw.messageId),
      body: typeof raw.body === "string" ? clip(raw.body, 2000) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!Number.isInteger(data.messageId) || !data.body) return { ok: false as const, error: "Write the message first." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureChat(sql);
    const message = await hold(sql, context.userId, data.messageId);
    if (!message || message.author_id !== context.userId || message.deleted_at) {
      noteAttempt(context.userId, "chat-edit", "Tried to edit a message that is not theirs.");
      return { ok: false as const, error: "That message can't be edited." };
    }
    if (!fresh(message.created_at, EDIT_MS)) return { ok: false as const, error: "Edit stays open for 15 minutes." };
    await sql`
      update messages set body = ${data.body}, edited_at = now()
      where id = ${data.messageId}
    `;
    return { ok: true as const };
  });

export const deleteMessage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      messageId: Number(raw.messageId),
      everyone: raw.everyone === true,
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!Number.isInteger(data.messageId)) return { ok: false as const, error: "That message is not here." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureChat(sql);
    const message = await hold(sql, context.userId, data.messageId);
    if (!message) {
      noteAttempt(context.userId, "chat-delete", "Tried to delete a message outside their chat.");
      return { ok: false as const, error: "That message is not here." };
    }
    if (data.everyone) {
      if (message.author_id !== context.userId || message.deleted_at || !fresh(message.created_at, DELETE_MS)) {
        return { ok: false as const, error: "Delete for everyone stays open for 48 hours." };
      }
      await sql`
        update messages set body = '', deleted_at = now() where id = ${data.messageId}
      `;
      await sql`delete from conversation_pins where message_id = ${data.messageId}`;
    } else {
      await sql`
        insert into message_hides (message_id, user_id)
        values (${data.messageId}, ${context.userId})
        on conflict do nothing
      `;
    }
    return { ok: true as const };
  });

export const starMessage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { messageId: Number(raw.messageId), seed: parseSeed(raw) };
  })
  .handler(async ({ context, data }) => {
    if (!Number.isInteger(data.messageId)) return { ok: false as const, error: "That message is not here." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureChat(sql);
    const message = await hold(sql, context.userId, data.messageId);
    if (!message || message.deleted_at) return { ok: false as const, error: "That message is not here." };
    const existing = await sql.query<{ n: number }>(
      "select 1 as n from message_stars where message_id = $1 and user_id = $2",
      [data.messageId, context.userId],
    );
    if (existing.length) {
      await sql`delete from message_stars where message_id = ${data.messageId} and user_id = ${context.userId}`;
    } else {
      await sql`
        insert into message_stars (message_id, user_id)
        values (${data.messageId}, ${context.userId})
        on conflict do nothing
      `;
    }
    return { ok: true as const };
  });

export const pinMessage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { messageId: Number(raw.messageId), seed: parseSeed(raw) };
  })
  .handler(async ({ context, data }) => {
    if (!Number.isInteger(data.messageId)) return { ok: false as const, error: "That message is not here." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureChat(sql);
    const message = await hold(sql, context.userId, data.messageId);
    if (!message || message.deleted_at) return { ok: false as const, error: "That message is not here." };
    const current = await sql.query<{ message_id: number }>(
      "select message_id from conversation_pins where conversation_id = $1",
      [message.conversation_id],
    );
    if (current[0] && Number(current[0].message_id) === data.messageId) {
      await sql`delete from conversation_pins where conversation_id = ${message.conversation_id}`;
    } else {
      await sql`
        insert into conversation_pins (conversation_id, message_id)
        values (${message.conversation_id}, ${data.messageId})
        on conflict (conversation_id) do update set message_id = excluded.message_id
      `;
    }
    return { ok: true as const };
  });

export const reactMessage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const emoji = typeof raw.emoji === "string" ? raw.emoji : "";
    return {
      messageId: Number(raw.messageId),
      emoji: (CHAT_REACTS as readonly string[]).includes(emoji) ? emoji : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!Number.isInteger(data.messageId) || !data.emoji) return { ok: false as const, error: "Choose a reaction." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureChat(sql);
    const message = await hold(sql, context.userId, data.messageId);
    if (!message || message.deleted_at) return { ok: false as const, error: "That message is not here." };
    const existing = await sql.query<{ emoji: string }>(
      "select emoji from message_reactions where message_id = $1 and user_id = $2",
      [data.messageId, context.userId],
    );
    if (existing[0]?.emoji === data.emoji) {
      await sql`delete from message_reactions where message_id = ${data.messageId} and user_id = ${context.userId}`;
    } else {
      await sql`
        insert into message_reactions (message_id, user_id, emoji)
        values (${data.messageId}, ${context.userId}, ${data.emoji})
        on conflict (message_id, user_id) do update set emoji = excluded.emoji
      `;
    }
    return { ok: true as const };
  });
