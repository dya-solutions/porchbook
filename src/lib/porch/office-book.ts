import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { touchProfile } from "@/lib/porch/api";
import { noteAttempt } from "@/lib/porch/guard.server";
import type { Seed } from "@/lib/porch/model";
import { OFFICE_PARTS, OFFICES, type OfficeKey } from "@/lib/porch/offices";
import { myPorchId, porchTables } from "@/lib/porch/porch-foundation";
import { readBookMeta, readLibrary, type BookMeta, type LibraryPages } from "@/lib/porch/pdf-book";

const KEYS = new Set<string>(OFFICES.map((office) => office.key));

function clip(value: string, max: number): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === "t" || value === "true";
}

function storedOfficeBook(book: string): { library: LibraryPages | null; scan: string | null } | null {
  if (!book.startsWith('{"v":1')) return null;
  const library = readLibrary(book);
  if (library) return { library, scan: null };
  try {
    const raw = JSON.parse(book) as { error?: unknown };
    if (typeof raw.error === "string" && raw.error) return { library: null, scan: raw.error };
  } catch {
    return null;
  }
  return null;
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

function parseKey(value: unknown): OfficeKey | null {
  return typeof value === "string" && KEYS.has(value) ? (value as OfficeKey) : null;
}

async function ready(sql: Awaited<ReturnType<typeof getSql>>) {
  await sql`
    create table if not exists office_books (
      office_key text primary key,
      title text not null default '',
      body text not null default '',
      updated_at timestamptz not null default now()
    )
  `;
  await porchTables(sql, { key: [["office_books", "office_key"]] });
}

async function place(sql: Awaited<ReturnType<typeof getSql>>, userId: string, key: OfficeKey) {
  const me = await sql.query<{ is_founder: boolean }>("select is_porch_admin($1) as is_founder", [userId]);
  const office = await sql.query<{ head_user_id: string | null }>("select head_user_id from offices where key = $1 and porch_id = my_porch($2)", [key, userId]);
  const held = await sql.query<{ head_user_id: string }>("select head_user_id from offices where head_user_id = $1 and porch_id = my_porch($1) limit 1", [userId]);
  const hooHead = await sql.query<{ head_user_id: string | null }>("select head_user_id from offices where key = 'hoo' and porch_id = my_porch($1)", [userId]);
  const founder = boolish(me[0]?.is_founder);
  const head = office[0]?.head_user_id === userId;
  // Offices are locked: only the office's own head, the founder, and the H.O.O (who receives every office's reports) may read inside.
  const hoo = hooHead[0]?.head_user_id === userId;
  return { founder, head, holds: held.length > 0, allowed: founder || head || hoo };
}

export const loadOfficeBook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { seed: parseSeed(raw), key: parseKey(raw.key) };
  })
  .handler(async ({ context, data }) => {
    if (!data.key) return { ok: false as const, error: "That office is not here." };
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, data.seed);
    await ready(sql);
    const who = await place(sql, context.userId, data.key);
    if (!who.allowed) return { ok: false as const, error: "That office is locked." };
    const rows = await sql.query<{ title: string; body: string }>("select title, body from office_books where office_key = $1 and porch_id = $2", [data.key, porch]);
    return { ok: true as const, title: rows[0]?.title ?? "", body: rows[0]?.body ?? "", canEdit: who.head };
  });

export const saveOfficeBook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      seed: parseSeed(raw),
      key: parseKey(raw.key),
      title: typeof raw.title === "string" ? clip(raw.title, 80) : "",
      body: typeof raw.body === "string" ? clip(raw.body, 8400) : "",
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.key) return { ok: false as const, error: "That office is not here." };
    if (!data.title) return { ok: false as const, error: "Write the title on the cover." };
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, data.seed);
    await ready(sql);
    const who = await place(sql, context.userId, data.key);
    if (!who.head) return { ok: false as const, error: "Only the office holder can write in this book." };
    await sql`
      insert into office_books (porch_id, office_key, title, body, updated_at)
      values (${porch}, ${data.key}, ${data.title}, ${data.body}, now())
      on conflict (porch_id, office_key) do update set title = ${data.title}, body = ${data.body}, updated_at = now()
    `;
    return { ok: true as const };
  });

async function filesReady(sql: Awaited<ReturnType<typeof getSql>>) {
  await sql`
    create table if not exists office_files (
      office_key text not null,
      part text not null,
      title text not null default '',
      body text not null default '',
      updated_at timestamptz not null default now(),
      primary key (office_key, part)
    )
  `;
  await sql`alter table office_files add column if not exists hoo_body text`;
  await sql`alter table office_files add column if not exists hoo_edited boolean not null default false`;
  await sql`
    create table if not exists office_removed (
      office_key text not null,
      part text not null,
      primary key (office_key, part)
    )
  `;
  await sql`
    create table if not exists office_pdfs (
      office_key text not null,
      part text not null,
      pdf text not null,
      primary key (office_key, part)
    )
  `;
  await sql`alter table office_pdfs add column if not exists hoo_pdf text`;
  await sql`alter table office_pdfs add column if not exists hoo_edited boolean not null default false`;
  await sql`alter table office_pdfs add column if not exists book text not null default ''`;
  await sql`alter table office_pdfs add column if not exists hoo_book text not null default ''`;
  await porchTables(sql, { key: [["office_files", "office_key, part"], ["office_removed", "office_key, part"], ["office_pdfs", "office_key, part"]] });
}

async function shareWrite(sql: Awaited<ReturnType<typeof getSql>>, porch: number, key: string, part: string, title: string, body: string) {
  const rows = await sql.query<{ body: string; hoo_body: string | null }>(
    "select body, hoo_body from office_files where office_key = $1 and porch_id = $3 and part = $2",
    [key, part, porch],
  );
  const current = rows[0];
  if (!current) {
    await sql`delete from office_removed where office_key = ${key} and porch_id = ${porch} and part = ${part}`;
    await sql`
      insert into office_files (porch_id, office_key, part, title, body, hoo_body, hoo_edited, updated_at)
      values (${porch}, ${key}, ${part}, ${title}, ${body}, ${body}, false, now())
    `;
    return;
  }
  if (current.body === body) {
    await sql`
      update office_files set title = ${title}, updated_at = now()
      where office_key = ${key} and porch_id = ${porch} and part = ${part}
    `;
    return;
  }
  const snapshot = current.hoo_body ?? current.body;
  await sql`
    update office_files
    set title = ${title}, body = ${body}, hoo_body = ${snapshot}, hoo_edited = true, updated_at = now()
    where office_key = ${key} and porch_id = ${porch} and part = ${part}
  `;
}

export const loadOfficeFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { seed: parseSeed(raw), key: parseKey(raw.key), part: typeof raw.part === "string" ? clip(raw.part, 80) : "", snapshot: raw.snapshot === true };
  })
  .handler(async ({ context, data }) => {
    if (!data.key || !data.part) return { ok: false as const, error: "That file is not here." };
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, data.seed);
    await filesReady(sql);
    const who = await place(sql, context.userId, data.key);
    if (!who.allowed) {
      noteAttempt(context.userId, "office-file", "Tried to read a locked office file.");
      return { ok: false as const, error: "That office is locked." };
    }
    const rows = await sql.query<{ title: string; body: string }>(
      "select title, body from office_files where office_key = $1 and porch_id = $3 and part = $2",
      [data.key, data.part, porch],
    );
    const pdf = await sql.query<{ pdf: string; book: string | null; from_hoo: boolean | null }>(
      data.snapshot
        ? "select case when coalesce(hoo_pdf, '') <> '' then hoo_pdf else pdf end as pdf, case when coalesce(hoo_pdf, '') <> '' then hoo_book else book end as book, (coalesce(hoo_pdf, '') <> '') as from_hoo from office_pdfs where office_key = $1 and porch_id = $3 and part = $2 and (pdf <> '' or coalesce(hoo_pdf, '') <> '' or coalesce(book, '') <> '' or coalesce(hoo_book, '') <> '')"
        : "select pdf, book, false as from_hoo from office_pdfs where office_key = $1 and porch_id = $3 and part = $2 and (pdf <> '' or coalesce(book, '') <> '')",
      [data.key, data.part, porch],
    );
    const stored = pdf[0];
    let library: LibraryPages | null = null;
    let scan: string | null = null;
    let meta: BookMeta = { author: "", summary: "", cover: "" };
    if (stored && !stored.pdf && stored.book) {
      const cached = storedOfficeBook(stored.book);
      if (cached) {
        library = cached.library;
        scan = cached.scan;
      }
      meta = readBookMeta(stored.book);
    } else if (stored?.pdf) {
      const cached = storedOfficeBook(stored.book ?? "");
      const keepHoo = data.snapshot && boolish(stored.from_hoo);
      if (cached) {
        library = cached.library;
        scan = cached.scan;
        meta = readBookMeta(stored.book ?? "");
      } else {
        const { bookFromPdf } = await import("@/lib/porch/pdf-book.server");
        const result = await bookFromPdf(Buffer.from(stored.pdf, "base64"));
        const save = async (body: string) => {
          if (keepHoo) await sql`update office_pdfs set hoo_book = ${body} where office_key = ${data.key} and porch_id = ${porch} and part = ${data.part}`;
          else await sql`update office_pdfs set book = ${body} where office_key = ${data.key} and porch_id = ${porch} and part = ${data.part}`;
        };
        if ("error" in result) {
          scan = result.error;
          if (result.error !== "This PDF could not be read.") await save(JSON.stringify({ v: 1, error: result.error }));
        } else {
          await save(result.body);
          library = readLibrary(result.body);
          meta = readBookMeta(result.body);
        }
      }
    }
    return { ok: true as const, title: rows[0]?.title ?? "", body: rows[0]?.body ?? "", canEdit: who.head, hasPdf: Boolean(stored?.pdf || library), library, scan, meta };
  });

export const saveOfficeFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      seed: parseSeed(raw),
      key: parseKey(raw.key),
      part: typeof raw.part === "string" ? clip(raw.part, 80) : "",
      title: typeof raw.title === "string" ? clip(raw.title, 80) : "",
      body: typeof raw.body === "string" ? clip(raw.body, 4000) : "",
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.key || !data.part) return { ok: false as const, error: "That file is not here." };
    if (!data.title) return { ok: false as const, error: "Write the title." };
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, data.seed);
    await filesReady(sql);
    const who = await place(sql, context.userId, data.key);
    if (!who.head) return { ok: false as const, error: "Only the office holder can write in this file." };
    await shareWrite(sql, porch, data.key, data.part, data.title, data.body);
    return { ok: true as const };
  });

export const clearOfficeFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      seed: parseSeed(raw),
      key: parseKey(raw.key),
      part: typeof raw.part === "string" ? clip(raw.part, 80) : "",
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.key || !data.part) return { ok: false as const, error: "That file is not here." };
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, data.seed);
    await filesReady(sql);
    const who = await place(sql, context.userId, data.key);
    if (!who.head) return { ok: false as const, error: "Only the office holder can empty this book." };
    await shareWrite(sql, porch, data.key, data.part, data.part, "");
    const held = await sql.query<{ pdf: string; hoo_pdf: string | null }>(
      "select pdf, hoo_pdf from office_pdfs where office_key = $1 and porch_id = $3 and part = $2",
      [data.key, data.part, porch],
    );
    const current = held[0];
    if (current?.pdf) {
      const snapshot = current.hoo_pdf || current.pdf;
      await sql`
        update office_pdfs set pdf = '', book = '', hoo_pdf = ${snapshot}, hoo_edited = true
        where office_key = ${data.key} and porch_id = ${porch} and part = ${data.part}
      `;
    }
    return { ok: true as const };
  });

export const dropOfficeFiles = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const parts = Array.isArray(raw.parts) ? raw.parts.filter((part): part is string => typeof part === "string").map((part) => clip(part, 80)).filter(Boolean) : [];
    return { seed: parseSeed(raw), key: parseKey(raw.key), parts: parts.slice(0, 40) };
  })
  .handler(async ({ context, data }) => {
    if (!data.key || !data.parts.length) return { ok: false as const, error: "Choose a file." };
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, data.seed);
    await filesReady(sql);
    const who = await place(sql, context.userId, data.key);
    if (!who.head && !(who.founder && data.key === "pastor")) return { ok: false as const, error: "Only the office holder can delete a file." };
    for (const part of data.parts) {
      await sql`delete from office_files where office_key = ${data.key} and porch_id = ${porch} and part = ${part}`;
      await sql`delete from office_pdfs where office_key = ${data.key} and porch_id = ${porch} and part = ${part}`;
      await sql`
        insert into office_removed (porch_id, office_key, part) values (${porch}, ${data.key}, ${part})
        on conflict (porch_id, office_key, part) do nothing
      `;
    }
    return { ok: true as const };
  });

const REPORT_BOOKS = new Set(["Daily Report", "Weekly Report", "Monthly Report"]);

export const saveReportPdf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const file = typeof raw.file === "string" ? raw.file : "";
    const part = typeof raw.part === "string" ? clip(raw.part, 80) : "";
    return {
      seed: parseSeed(raw),
      key: parseKey(raw.key),
      part,
      name: typeof raw.name === "string" ? clip(raw.name, 120) : "",
      file: file.length > 8_000_000 ? "" : file,
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.key || !data.part) return { ok: false as const, error: "That book is not here." };
    if (!data.file) return { ok: false as const, error: "That file is empty." };
    const kind = data.name.split(".").pop()?.toLowerCase() ?? "";
    const isPdf = data.file.startsWith("JVBERi") || kind === "pdf";
    let storedPdf = data.file;
    let storedBook = "";
    if (!isPdf) {
      if (!["txt", "text", "docx", "epub"].includes(kind)) return { ok: false as const, error: "Use a PDF, Word, EPUB, or text file." };
      const { bookFromFile } = await import("@/lib/porch/pdf-book.server");
      const made = await bookFromFile(data.name || `book.${kind}`, Buffer.from(data.file, "base64"));
      if ("error" in made) return { ok: false as const, error: made.error };
      storedPdf = "";
      storedBook = made.body;
    } else if (!data.file.startsWith("JVBERi")) return { ok: false as const, error: "That file is not a PDF." };
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, data.seed);
    await filesReady(sql);
    const who = await place(sql, context.userId, data.key);
    if (!who.head) return { ok: false as const, error: "Only the office holder can put a PDF in this book." };
    const held = await sql.query<{ pdf: string; book: string | null; hoo_pdf: string | null }>(
      "select pdf, book, hoo_pdf from office_pdfs where office_key = $1 and porch_id = $3 and part = $2",
      [data.key, data.part, porch],
    );
    const current = held[0];
    if (!current) {
      await sql`delete from office_removed where office_key = ${data.key} and porch_id = ${porch} and part = ${data.part}`;
      await sql`
        insert into office_pdfs (porch_id, office_key, part, pdf, hoo_pdf, hoo_edited, book)
        values (${porch}, ${data.key}, ${data.part}, ${storedPdf}, ${storedPdf}, false, ${storedBook})
      `;
      return { ok: true as const };
    }
    if (isPdf && current.pdf === storedPdf) return { ok: true as const };
    if (!isPdf && current.pdf === "" && (current.book ?? "") === storedBook) return { ok: true as const };
    const snapshot = current.hoo_pdf || current.pdf;
    await sql`
      update office_pdfs
      set pdf = ${storedPdf}, book = ${storedBook}, hoo_pdf = ${snapshot}, hoo_edited = true,
          hoo_book = case when hoo_pdf is not distinct from ${snapshot} then hoo_book else '' end
      where office_key = ${data.key} and porch_id = ${porch} and part = ${data.part}
    `;
    return { ok: true as const };
  });

export const addOfficeBook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { seed: parseSeed(raw), key: parseKey(raw.key), name: typeof raw.name === "string" ? clip(raw.name, 60) : "" };
  })
  .handler(async ({ context, data }) => {
    if (!data.key || !data.name) return { ok: false as const, error: "Name the cover." };
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, data.seed);
    await filesReady(sql);
    const who = await place(sql, context.userId, data.key);
    if (!who.head) return { ok: false as const, error: "Only the office holder can add a book." };
    const taken = await coverTaken(sql, porch, data.key, data.name, "");
    if (taken) return { ok: false as const, error: "That cover is already on the shelf." };
    await sql`delete from office_removed where office_key = ${data.key} and porch_id = ${porch} and part = ${data.name}`;
    await sql`
      insert into office_files (porch_id, office_key, part, title, body, hoo_body, hoo_edited, updated_at)
      values (${porch}, ${data.key}, ${data.name}, ${data.name}, '', '', false, now())
      on conflict (porch_id, office_key, part) do nothing
    `;
    return { ok: true as const };
  });

export const renameOfficeFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      seed: parseSeed(raw),
      key: parseKey(raw.key),
      from: typeof raw.from === "string" ? clip(raw.from, 60) : "",
      to: typeof raw.to === "string" ? clip(raw.to, 60) : "",
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.key || !data.from || !data.to) return { ok: false as const, error: "Name the cover." };
    if (data.from === data.to) return { ok: true as const };
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, data.seed);
    await filesReady(sql);
    const who = await place(sql, context.userId, data.key);
    if (!who.head) return { ok: false as const, error: "Only the office holder can rename a file." };
    const taken = await coverTaken(sql, porch, data.key, data.to, data.from);
    if (taken) return { ok: false as const, error: "That cover is already on the shelf." };
    const moved = await sql`
      update office_files set part = ${data.to}, title = ${data.to}
      where office_key = ${data.key} and porch_id = ${porch} and part = ${data.from}
      returning part
    `;
    if (!moved.length) {
      await sql`
        insert into office_files (porch_id, office_key, part, title, body, hoo_body, hoo_edited, updated_at)
        values (${porch}, ${data.key}, ${data.to}, ${data.to}, '', '', false, now())
      `;
    }
    await sql`update office_pdfs set part = ${data.to} where office_key = ${data.key} and porch_id = ${porch} and part = ${data.from}`;
    if ((OFFICE_PARTS[data.key] ?? []).includes(data.from)) {
      await sql`
        insert into office_removed (porch_id, office_key, part) values (${porch}, ${data.key}, ${data.from})
        on conflict (porch_id, office_key, part) do nothing
      `;
    }
    await sql`delete from office_removed where office_key = ${data.key} and porch_id = ${porch} and part = ${data.to}`;
    return { ok: true as const };
  });

async function coverTaken(sql: Awaited<ReturnType<typeof getSql>>, porch: number, key: string, name: string, except: string) {
  const fixed = (OFFICE_PARTS[key] ?? []).filter((part) => part !== except);
  const gone = await sql.query<{ part: string }>("select part from office_removed where office_key = $1 and porch_id = $2", [key, porch]);
  const removed = new Set(gone.map((row) => row.part));
  if (fixed.some((part) => part === name && !removed.has(part))) return true;
  const files = await sql.query<{ part: string }>("select part from office_files where office_key = $1 and porch_id = $3 and part = $2", [key, name, porch]);
  if (files.length && name !== except) return true;
  const pdfs = await sql.query<{ part: string }>("select part from office_pdfs where office_key = $1 and porch_id = $3 and part = $2", [key, name, porch]);
  return pdfs.length > 0 && name !== except;
}

const DESK_OFFICE: Record<string, OfficeKey> = {
  admin: "administrator",
  hof: "hof",
  comm: "communications",
  mission: "missions",
  centre: "centre",
  pastoral: "pastoral",
};

export const listOfficeBooks = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { seed: parseSeed(raw), key: parseKey(raw.key) };
  })
  .handler(async ({ context, data }) => {
    if (!data.key) return { ok: false as const, error: "That office is not here.", books: [] as string[], removed: [] as string[] };
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, data.seed);
    await filesReady(sql);
    const who = await place(sql, context.userId, data.key);
    if (!who.allowed) return { ok: false as const, error: "That office is locked.", books: [] as string[], removed: [] as string[] };
    const fixed = new Set(OFFICE_PARTS[data.key] ?? []);
    const rows = await sql.query<{ part: string }>(
      "select part from office_files where office_key = $1 and porch_id = $2 order by updated_at",
      [data.key, porch],
    );
    const gone = await sql.query<{ part: string }>("select part from office_removed where office_key = $1 and porch_id = $2", [data.key, porch]);
    return {
      ok: true as const,
      books: rows.map((row) => row.part).filter((part) => part && !fixed.has(part)),
      removed: gone.map((row) => row.part),
      head: who.head,
    };
  });

export const loadDeskReading = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const desk = typeof raw.desk === "string" ? raw.desk : "";
    return { seed: parseSeed(raw), desk: DESK_OFFICE[desk] ? desk : "" };
  })
  .handler(async ({ context, data }) => {
    const key = DESK_OFFICE[data.desk];
    if (!key) return { ok: true as const, books: [] as { title: string; body: string; edited: boolean; hasPdf: boolean }[] };
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, data.seed);
    await filesReady(sql);
    const me = await sql.query<{ is_founder: boolean }>("select is_porch_admin($1) as is_founder", [context.userId]);
    const heads = await sql.query<{ key: string; head_user_id: string | null }>(
      "select key, head_user_id from offices where key in ('hoo', $1) and porch_id = my_porch($2)",
      [key, context.userId],
    );
    const founder = boolish(me[0]?.is_founder);
    const hoo = heads.some((row) => row.key === "hoo" && row.head_user_id === context.userId);
    const mine = heads.some((row) => row.key === key && row.head_user_id === context.userId);
    if (!founder && !hoo && !mine) return { ok: false as const, error: "That report is not yours.", books: [] as { title: string; body: string; edited: boolean; hasPdf: boolean }[] };
    const fixed = new Set(OFFICE_PARTS[key] ?? []);
    const gone = await sql.query<{ part: string }>("select part from office_removed where office_key = $1 and porch_id = $2", [key, porch]);
    const removed = new Set(gone.map((row) => row.part));
    const rows = await sql.query<{ part: string; body: string; hoo_body: string | null; hoo_edited: boolean }>(
      "select part, body, hoo_body, hoo_edited from office_files where office_key = $1 and porch_id = $2 order by updated_at",
      [key, porch],
    );
    const pdfs = await sql.query<{ part: string; pdf: string | null; hoo_pdf: string | null; hoo_edited: boolean }>(
      "select part, pdf, hoo_pdf, hoo_edited from office_pdfs where office_key = $1 and porch_id = $2",
      [key, porch],
    );
    const byPart = new Map<string, { title: string; body: string; edited: boolean; hasPdf: boolean }>();
    for (const row of rows) {
      if (!row.part || removed.has(row.part)) continue;
      const body = row.hoo_body ?? row.body;
      const hasText = body.trim().length > 0;
      if (fixed.has(row.part) && !hasText && !REPORT_BOOKS.has(row.part)) continue;
      byPart.set(row.part, { title: row.part, body, edited: boolish(row.hoo_edited), hasPdf: false });
    }
    for (const row of pdfs) {
      const readable = row.pdf || row.hoo_pdf;
      if (!row.part || removed.has(row.part) || !readable) continue;
      const book = byPart.get(row.part) ?? { title: row.part, body: "", edited: false, hasPdf: false };
      book.hasPdf = true;
      book.edited = book.edited || boolish(row.hoo_edited);
      byPart.set(row.part, book);
    }
    return { ok: true as const, books: [...byPart.values()] };
  });



