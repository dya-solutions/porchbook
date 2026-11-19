import { createServerFn } from "@tanstack/react-start";
import { myPorchId, porchTables } from "@/lib/porch/porch-foundation";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";
import { readLibrary, type LibraryPages } from "@/lib/porch/pdf-book";

function clip(value: string, max: number): string {
  return value.replace(/[\u0000-\u0008\u000b\u000e-\u001f]/g, "").trim().slice(0, max);
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === "t" || value === "true";
}

function parseSeed(input: unknown): Seed {
  const raw = asRecord(input);
  const emailRaw = typeof raw.email === "string" ? clip(raw.email, 200) : "";
  return {
    displayName: typeof raw.displayName === "string" ? clip(raw.displayName, 80) : "",
    email: emailRaw.includes("@") ? emailRaw : null,
    imageUrl: typeof raw.imageUrl === "string" && raw.imageUrl.startsWith("http") ? raw.imageUrl.slice(0, 500) : null,
  };
}

function linkOf(value: unknown): string {
  if (typeof value !== "string") return "";
  const link = value.trim().slice(0, 300);
  return /^https:\/\/\S+$/i.test(link) ? link : "";
}

let preparing: Promise<void> | null = null;

async function prepare(sql: Awaited<ReturnType<typeof getSql>>) {
  await sql`
    create table if not exists read_docs (
      key text primary key,
      title text not null,
      body text not null default '',
      link text not null default '',
      sort integer not null default 0
    )
  `;
  await sql`
    create table if not exists read_notes (
      user_id text primary key,
      title text not null default '',
      body text not null default '',
      updated_at timestamptz not null default now()
    )
  `;
  await sql`alter table read_notes add column if not exists title text not null default ''`;
  await sql`
    create table if not exists notebook_notes (
      id text primary key,
      user_id text not null,
      title text not null default '',
      body text not null default '',
      updated_at timestamptz not null default now()
    )
  `;
  await sql`
    insert into notebook_notes (id, user_id, title, body, updated_at)
    select 'legacy-' || user_id, user_id, coalesce(title, ''), body, updated_at
    from read_notes
    where coalesce(title, '') <> '' or coalesce(body, '') <> ''
    on conflict (id) do nothing
  `;
  await sql`alter table notebook_notes add column if not exists subtitle text not null default ''`;
  await sql`alter table notebook_notes add column if not exists phaneroo text not null default ''`;
  await sql`alter table notebook_notes add column if not exists kind text not null default 'personal'`;
  // Deleted notes wait a minute (for Undo), then go for good.
  await sql`alter table notebook_notes add column if not exists deleted_at timestamptz`;
  await porchTables(sql, { key: [["read_docs", "key"]] });
  await shelfFor(sql, 1);
  await sql`alter table read_docs add column if not exists pdf text not null default ''`;
  await sql`alter table read_docs add column if not exists link_set_at timestamptz`;
  await sql`alter table read_docs add column if not exists auto_checked_at timestamptz`;
}

// The devotional switches to Phaneroo's newest devotion as soon as it's posted: from midnight
// Kampala time, Phaneroo is checked every few minutes. A link the founder pastes is kept until the next midnight.
const DEVOTION_HOUR = 0;
const KAMPALA_MS = 3 * 60 * 60 * 1000;
const RECHECK_MS = 5 * 60 * 1000;

function lastSwitchMs(nowMs: number) {
  const local = new Date(nowMs + KAMPALA_MS);
  let switchMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), DEVOTION_HOUR) - KAMPALA_MS;
  if (switchMs > nowMs) switchMs -= 24 * 60 * 60 * 1000;
  return switchMs;
}

async function refreshDevotion(sql: Awaited<ReturnType<typeof getSql>>, porch: number) {
  const rows = await sql.query<{ link: string; set_ms: string | number | null; checked_ms: string | number | null }>(
    `select link, (extract(epoch from link_set_at) * 1000)::bigint as set_ms,
            (extract(epoch from auto_checked_at) * 1000)::bigint as checked_ms
       from read_docs where key = 'devotion' and porch_id = $1`,
    [porch],
  );
  const row = rows[0];
  if (!row) return;
  const nowMs = Date.now();
  const since = lastSwitchMs(nowMs);
  // Already switched (or pasted) since midnight, or checked a moment ago.
  if (row.set_ms !== null && Number(row.set_ms) >= since) return;
  if (row.checked_ms !== null && nowMs - Number(row.checked_ms) < RECHECK_MS) return;
  await sql`update read_docs set auto_checked_at = now() where key = 'devotion' and porch_id = ${porch}`;
  const { newestDevotionLink } = await import("@/lib/porch/phaneroo-site.server");
  const newest = await newestDevotionLink();
  // Not posted yet (still yesterday's): keep it and look again in a few minutes.
  if (!newest || newest === row.link) return;
  await sql`update read_docs set link = ${newest}, link_set_at = now() where key = 'devotion' and porch_id = ${porch}`;
}

/** Each church porch's shelf starts with its Bible and Devotional (Stage 3b). */
async function shelfFor(sql: Awaited<ReturnType<typeof getSql>>, porch: number) {
  if (!porch) return;
  await sql`
    insert into read_docs (porch_id, key, title, body, link, sort)
    values (${porch}, 'bible', 'Bible', '', '', 0), (${porch}, 'devotion', 'Devotional', '', '', 1)
    on conflict (porch_id, key) do nothing
  `;
}

/** The viewer's church porch, with its shelf ready. */
async function shelfPorch(sql: Awaited<ReturnType<typeof getSql>>, userId: string) {
  const porch = await myPorchId(sql, userId);
  await shelfFor(sql, porch);
  return porch;
}

async function ready(sql: Awaited<ReturnType<typeof getSql>>) {
  if (!preparing) {
    preparing = prepare(sql).catch((error) => {
      preparing = null;
      throw error;
    });
  }
  await preparing;
}

async function founder(sql: Awaited<ReturnType<typeof getSql>>, userId: string) {
  const me = await sql.query<{ is_founder: boolean }>("select is_porch_admin($1) as is_founder", [userId]);
  return boolish(me[0]?.is_founder);
}

export type NoteCard = { id: string; title: string; phaneroo: string; updatedAt: string };

export const listNotes = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await ready(sql);
    await purgeDeleted(sql, context.userId);
    const rows = await sql.query<{ id: string; title: string; phaneroo: string; updated_at: string }>(
      `select id, title, phaneroo, to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
       from notebook_notes where user_id = $1 and deleted_at is null order by updated_at desc`,
      [context.userId],
    );
    return {
      ok: true as const,
      notes: rows.map((row) => ({ id: row.id, title: row.title, phaneroo: row.phaneroo, updatedAt: row.updated_at })) satisfies NoteCard[],
    };
  });

export const openNote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { seed: parseSeed(raw), id: typeof raw.id === "string" ? clip(raw.id, 80) : "" };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ready(sql);
    const rows = await sql.query<{ title: string; subtitle: string; phaneroo: string; kind: string; body: string; updated_at: string }>(
      `select title, subtitle, phaneroo, kind, body, to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
       from notebook_notes where id = $1 and user_id = $2 and deleted_at is null`,
      [data.id, context.userId],
    );
    if (!rows.length) return { ok: false as const, error: "That note is not yours." };
    return {
      ok: true as const,
      title: rows[0].title,
      subtitle: rows[0].subtitle,
      phaneroo: rows[0].phaneroo,
      kind: rows[0].kind === "office" ? ("office" as const) : ("personal" as const),
      body: rows[0].body,
      updatedAt: rows[0].updated_at,
    };
  });

function stampValue(value: string) {
  const masterclass = /^\s*m/i.test(value);
  const number = value.replace(/\D/g, "").slice(0, 6);
  return masterclass ? `M${number}` : number;
}

export const saveNote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      seed: parseSeed(raw),
      id: typeof raw.id === "string" ? clip(raw.id, 80) : "",
      title: typeof raw.title === "string" ? clip(raw.title, 60) : "",
      subtitle: typeof raw.subtitle === "string" ? clip(raw.subtitle, 80) : "",
      // The stamp: Phaneroo is just the number ("47"); MasterClass is "M" then the number ("M45").
      phaneroo: typeof raw.phaneroo === "string" ? stampValue(raw.phaneroo) : "",
      kind: raw.kind === "office" ? ("office" as const) : ("personal" as const),
      body: typeof raw.body === "string" ? clip(raw.body, 8000) : "",
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.title && !data.subtitle && !data.phaneroo.replace(/\D/g, "") && !data.body) return { ok: false as const, error: "Write the note first." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ready(sql);
    if (data.id) {
      const owned = await sql.query<{ id: string }>("select id from notebook_notes where id = $1 and user_id = $2", [data.id, context.userId]);
      if (!owned.length) return { ok: false as const, error: "That note is not yours." };
      await sql`
        update notebook_notes set title = ${data.title}, subtitle = ${data.subtitle}, phaneroo = ${data.phaneroo}, kind = ${data.kind}, body = ${data.body}, updated_at = now()
        where id = ${data.id} and user_id = ${context.userId}
      `;
      return { ok: true as const, id: data.id };
    }
    await purgeDeleted(sql, context.userId);
    const count = await sql.query<{ n: string }>("select count(*)::text as n from notebook_notes where user_id = $1 and deleted_at is null", [context.userId]);
    if (Number(count[0]?.n ?? 0) >= 100) return { ok: false as const, error: "The notebook is full." };
    const id = `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await sql`
      insert into notebook_notes (id, user_id, title, subtitle, phaneroo, kind, body)
      values (${id}, ${context.userId}, ${data.title}, ${data.subtitle}, ${data.phaneroo}, ${data.kind}, ${data.body})
    `;
    return { ok: true as const, id };
  });

// A deleted note can be brought back for a minute (a little longer here, for a slow connection).
const UNDO_SECONDS = 75;

async function purgeDeleted(sql: Awaited<ReturnType<typeof getSql>>, userId: string) {
  await sql.query(`delete from notebook_notes where user_id = $1 and deleted_at < now() - interval '${UNDO_SECONDS} seconds'`, [userId]);
}

function noteId(input: unknown) {
  const raw = asRecord(input);
  return { id: typeof raw.id === "string" ? clip(raw.id, 80) : "" };
}

export const deleteNote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(noteId)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ready(sql);
    const rows = await sql.query<{ id: string }>(
      "update notebook_notes set deleted_at = now() where id = $1 and user_id = $2 and deleted_at is null returning id",
      [data.id, context.userId],
    );
    return rows.length ? { ok: true as const } : { ok: false as const, error: "That note is already gone." };
  });

export const restoreNote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(noteId)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ready(sql);
    const rows = await sql.query<{ id: string }>(
      `update notebook_notes set deleted_at = null
        where id = $1 and user_id = $2 and deleted_at > now() - interval '${UNDO_SECONDS} seconds' returning id`,
      [data.id, context.userId],
    );
    return rows.length ? { ok: true as const } : { ok: false as const, error: "Too late to undo: that note is gone." };
  });

export type ReadBook = { key: string; title: string; link: string; hasPdf: boolean };

export const loadReadShelf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await Promise.all([touchProfile(sql, context.userId, seed), ready(sql)]);
    const porch = await shelfPorch(sql, context.userId);
    const [isFounder, rows] = await Promise.all([
      founder(sql, context.userId),
      sql.query<{ key: string; title: string; link: string; has_pdf: boolean }>(
        "select key, title, link, (pdf <> '') as has_pdf from read_docs where porch_id = $1 order by sort, title",
        [porch],
      ),
    ]);
    return {
      ok: true as const,
      isFounder,
      books: rows.map((row) => ({ key: row.key, title: row.title, link: row.link, hasPdf: boolish(row.has_pdf) })) satisfies ReadBook[],
    };
  });

export const loadReadDoc = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { seed: parseSeed(raw), key: typeof raw.key === "string" ? clip(raw.key, 40) : "" };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ready(sql);
    const isFounder = await founder(sql, context.userId);
    const porch = await shelfPorch(sql, context.userId);
    if (data.key === "notebook") {
      const rows = await sql.query<{ title: string; body: string; updated_at: string }>(
        `select title, body, to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
         from read_notes where user_id = $1`,
        [context.userId],
      );
      return {
        ok: true as const,
        title: rows[0]?.title ?? "",
        body: rows[0]?.body ?? "",
        link: "",
        hasPdf: false,
        canEdit: true,
        updatedAt: rows[0]?.updated_at ?? "",
        library: null as LibraryPages | null,
        scan: null as string | null,
      };
    }
    if (data.key === "devotion") {
      try {
        await refreshDevotion(sql, porch);
      } catch {
        /* keep the current devotional */
      }
    }
    const rows = await sql.query<{ title: string; body: string; link: string; has_pdf: boolean }>(
      "select title, body, link, (pdf <> '') as has_pdf from read_docs where key = $1 and porch_id = $2",
      [data.key, porch],
    );
    if (!rows.length) return { ok: false as const, error: "That book is not here." };
    const hasPdf = boolish(rows[0].has_pdf);
    let library = readLibrary(rows[0].body);
    let scan: string | null = null;
    if (!library && hasPdf) {
      const stored = await sql.query<{ pdf: string | null }>("select pdf from read_docs where key = $1 and porch_id = $2", [data.key, porch]);
      const pdf = stored[0]?.pdf;
      if (pdf) {
        const { bookFromPdf } = await import("@/lib/porch/pdf-book.server");
        const result = await bookFromPdf(Buffer.from(pdf, "base64"), "book");
        if ("error" in result) scan = result.error;
        else {
          await sql`update read_docs set body = ${result.body} where key = ${data.key} and porch_id = ${porch}`;
          library = readLibrary(result.body);
        }
      }
    }
    return {
      ok: true as const,
      title: rows[0].title,
      body: rows[0].body,
      link: rows[0].link,
      hasPdf,
      canEdit: isFounder && data.key !== "devotion" && data.key !== "bible",
      library,
      scan,
    };
  });

export const saveReadDoc = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      seed: parseSeed(raw),
      key: typeof raw.key === "string" ? clip(raw.key, 40) : "",
      body: typeof raw.body === "string" ? clip(raw.body, 5200) : "",
      link: linkOf(raw.link),
      title: typeof raw.title === "string" ? clip(raw.title, 60) : "",
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ready(sql);
    if (data.key === "notebook") {
      await sql`
        insert into read_notes (user_id, title, body, updated_at)
        values (${context.userId}, ${data.title}, ${data.body}, now())
        on conflict (user_id) do update set title = ${data.title}, body = ${data.body}, updated_at = now()
      `;
      return { ok: true as const };
    }
    if (!(await founder(sql, context.userId))) {
      noteAttempt(context.userId, "read-write", "Tried to change a book they only read.");
      return { ok: false as const, error: "Only the pastor can change this book." };
    }
    const porch = await shelfPorch(sql, context.userId);
    if (data.key === "devotion" || data.key === "bible") {
      if (!data.link) return { ok: false as const, error: "Paste the page address. It must begin with https://" };
      await sql`update read_docs set link = ${data.link}, link_set_at = now() where key = ${data.key} and porch_id = ${porch}`;
      return { ok: true as const };
    }
    const found = await sql.query<{ key: string }>("select key from read_docs where key = $1 and porch_id = $2", [data.key, porch]);
    if (!found.length) return { ok: false as const, error: "That book is not here." };
    await sql`update read_docs set body = ${data.body} where key = ${data.key} and porch_id = ${porch}`;
    return { ok: true as const };
  });

export const addReadBook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { seed: parseSeed(raw), title: typeof raw.title === "string" ? clip(raw.title, 60) : "" };
  })
  .handler(async ({ context, data }) => {
    if (!data.title) return { ok: false as const, error: "Write the title." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ready(sql);
    if (!(await founder(sql, context.userId))) return { ok: false as const, error: "Only the pastor can add a book." };
    const porch = await shelfPorch(sql, context.userId);
    const count = await sql.query<{ n: string }>("select count(*)::text as n from read_docs where porch_id = $1", [porch]);
    if (Number(count[0]?.n ?? 0) >= 12) return { ok: false as const, error: "The shelf is full." };
    const key = `book${Date.now().toString(36)}`;
    await sql`
      insert into read_docs (porch_id, key, title, body, link, sort)
      values (${porch}, ${key}, ${data.title}, '', '', 10)
    `;
    return { ok: true as const };
  });

export const renameReadBook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      seed: parseSeed(raw),
      key: typeof raw.key === "string" ? clip(raw.key, 40) : "",
      title: typeof raw.title === "string" ? clip(raw.title.trim(), 60) : "",
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.key) return { ok: false as const, error: "Pick a book." };
    if (!data.title) return { ok: false as const, error: "Write the new name." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ready(sql);
    if (!(await founder(sql, context.userId))) return { ok: false as const, error: "Only the pastor can rename a book." };
    const found = await sql.query<{ key: string }>("update read_docs set title = $1 where key = $2 and porch_id = my_porch($3) returning key", [data.title, data.key, context.userId]);
    if (!found.length) return { ok: false as const, error: "That book is not here." };
    return { ok: true as const, title: data.title };
  });

export const addReadPdf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const file = typeof raw.file === "string" ? raw.file : "";
    return {
      seed: parseSeed(raw),
      title: typeof raw.title === "string" ? clip(raw.title, 60) : "",
      file: file.length > 6_000_000 ? "" : file,
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.title) return { ok: false as const, error: "Write the title." };
    if (!data.file.startsWith("JVBERi")) return { ok: false as const, error: "That file is not a PDF." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ready(sql);
    if (!(await founder(sql, context.userId))) return { ok: false as const, error: "Only the pastor can add a book." };
    const porch = await shelfPorch(sql, context.userId);
    const count = await sql.query<{ n: string }>("select count(*)::text as n from read_docs where porch_id = $1", [porch]);
    if (Number(count[0]?.n ?? 0) >= 12) return { ok: false as const, error: "The shelf is full." };
    const key = `book${Date.now().toString(36)}`;
    await sql`
      insert into read_docs (porch_id, key, title, body, link, sort, pdf)
      values (${porch}, ${key}, ${data.title}, '', '', 10, ${data.file})
    `;
    return { ok: true as const, key };
  });

const KEPT_BOOKS = new Set(["bible", "devotion", "notebook"]);

export const dropReadBooks = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const keys = Array.isArray(raw.keys) ? raw.keys.filter((key): key is string => typeof key === "string").map((key) => clip(key, 40)).filter(Boolean) : [];
    return { seed: parseSeed(raw), keys: keys.slice(0, 12) };
  })
  .handler(async ({ context, data }) => {
    const keys = data.keys.filter((key) => !KEPT_BOOKS.has(key));
    if (!keys.length) return { ok: false as const, error: "The Bible, the notebook, and the devotional stay." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ready(sql);
    if (!(await founder(sql, context.userId))) return { ok: false as const, error: "Only the pastor can delete a book." };
    for (const key of keys) {
      await sql`delete from read_docs where key = ${key} and porch_id = my_porch(${context.userId})`;
    }
    return { ok: true as const };
  });
