import { createServerFn } from "@tanstack/react-start";
import { myPorchId, porchTables } from "@/lib/porch/porch-foundation";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";

/** Book covers on the library shelf: the founder's material photo for any book, shared with everyone. */

const MAX_BYTES = 400_000;

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function parseSeed(input: unknown): Seed {
  const raw = asRecord(input);
  return {
    displayName: typeof raw.displayName === "string" ? clip(raw.displayName, 80) : "",
    email: typeof raw.email === "string" ? clip(raw.email, 200) : null,
    imageUrl: typeof raw.imageUrl === "string" ? clip(raw.imageUrl, 500) : null,
  };
}

function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

async function ensure(sql: Awaited<ReturnType<typeof getSql>>) {
  await sql`
    create table if not exists porch_cover (
      book text primary key,
      mime text not null,
      image text not null,
      updated_at timestamptz not null default now()
    )
  `;
  await porchTables(sql, { key: [["porch_cover", "book"]] });
  await sql`
    create table if not exists porch_cover_fly (
      book text primary key,
      x real not null,
      y real not null,
      s real not null default 1,
      hidden boolean not null default false,
      updated_at timestamptz not null default now()
    )
  `;
  await porchTables(sql, { key: [["porch_cover_fly", "book"]] });
}

/** Where a book's butterfly sits: x, y in % of the cover (its centre), s = size (1 = usual), or hidden. */
export type Fly = { x: number; y: number; s: number; hidden: boolean };

async function founderFlag(sql: Awaited<ReturnType<typeof getSql>>, userId: string) {
  const me = await sql.query<{ is_founder: boolean }>("select is_porch_admin($1) as is_founder", [userId]);
  return boolish(me[0]?.is_founder);
}

export const getCovers = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, seed);
    await ensure(sql);
    const founder = await founderFlag(sql, context.userId);
    const rows = await sql.query<{ book: string; mime: string; image: string; updated_at: string }>(`select book, mime, image, to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at from porch_cover where porch_id = ${porch}`,
    );
    const covers: Record<string, { mime: string; image: string }> = {};
    let updatedAt = "";
    for (const row of rows) {
      covers[row.book] = { mime: row.mime, image: row.image };
      if (row.updated_at > updatedAt) updatedAt = row.updated_at;
    }
    const flyRows = await sql.query<{ book: string; x: number; y: number; s: number; hidden: boolean; updated_at: string }>(`select book, x, y, s, hidden, to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at from porch_cover_fly where porch_id = ${porch}`,
    );
    const flies: Record<string, Fly> = {};
    for (const row of flyRows) {
      flies[row.book] = { x: Number(row.x), y: Number(row.y), s: Number(row.s), hidden: boolish(row.hidden) };
      if (row.updated_at > updatedAt) updatedAt = row.updated_at;
    }
    return { founder, covers, flies, updatedAt: `${rows.length}:${flyRows.length}:${updatedAt}` };
  });

export const setCover = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      book: typeof raw.book === "string" ? clip(raw.book, 80) : "",
      mime: typeof raw.mime === "string" ? clip(raw.mime, 40) : "",
      image: typeof raw.image === "string" ? raw.image.replace(/\s/g, "").slice(0, 700_000) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, data.seed);
    await ensure(sql);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "cover", "Tried to change a book cover.");
      return { ok: false as const, error: "Only an admin can change book covers." };
    }
    if (!data.book) return { ok: false as const, error: "Which book?" };
    if (!data.image) {
      await sql`delete from porch_cover where porch_id = ${porch} and book = ${data.book}`;
      return { ok: true as const };
    }
    // A plain colour (e.g. the porch guy's background) is kept as "color" with its #rrggbb.
    if (data.mime === "color") {
      if (!/^#[0-9a-f]{6}$/i.test(data.image)) return { ok: false as const, error: "Pick a colour." };
      await sql`
        insert into porch_cover (porch_id, book, mime, image, updated_at)
        values (${porch}, ${data.book}, 'color', ${data.image}, now())
        on conflict (porch_id, book) do update set mime = 'color', image = ${data.image}, updated_at = now()
      `;
      return { ok: true as const };
    }
    if (data.mime !== "image/jpeg") return { ok: false as const, error: "Use a photo." };
    let bytes = 0;
    try {
      bytes = atob(data.image).length;
    } catch {
      return { ok: false as const, error: "That photo could not be read." };
    }
    if (bytes > MAX_BYTES) return { ok: false as const, error: "That photo is too large. Choose another." };
    await sql`
      insert into porch_cover (porch_id, book, mime, image, updated_at)
      values (${porch}, ${data.book}, ${data.mime}, ${data.image}, now())
      on conflict (porch_id, book) do update set mime = ${data.mime}, image = ${data.image}, updated_at = now()
    `;
    return { ok: true as const };
  });

const clampNumber = (value: unknown, low: number, high: number, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(high, Math.max(low, n)) : fallback;
};

/** The founder moves, resizes or hides a book's butterfly (or puts it back with reset). */
export const setButterfly = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      book: typeof raw.book === "string" ? clip(raw.book, 80) : "",
      reset: raw.reset === true,
      x: clampNumber(raw.x, 0, 100, 85),
      y: clampNumber(raw.y, 0, 100, 88),
      s: clampNumber(raw.s, 0.4, 3, 1),
      hidden: raw.hidden === true,
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, data.seed);
    await ensure(sql);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "cover", "Tried to move a book's butterfly.");
      return { ok: false as const, error: "Only an admin can move the butterflies." };
    }
    if (!data.book) return { ok: false as const, error: "Which book?" };
    if (data.reset) {
      await sql`delete from porch_cover_fly where porch_id = ${porch} and book = ${data.book}`;
      return { ok: true as const };
    }
    await sql`
      insert into porch_cover_fly (porch_id, book, x, y, s, hidden, updated_at)
      values (${porch}, ${data.book}, ${data.x}, ${data.y}, ${data.s}, ${data.hidden}, now())
      on conflict (porch_id, book) do update set x = ${data.x}, y = ${data.y}, s = ${data.s}, hidden = ${data.hidden}, updated_at = now()
    `;
    return { ok: true as const };
  });
