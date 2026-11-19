import { createServerFn } from "@tanstack/react-start";
import { myPorchId, porchTables } from "@/lib/porch/porch-foundation";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";

const MAX_BYTES = 700_000;

/** The shelf's materials: the whole shelf photo (1), or the top board (2), back panel (3) and plank (4) on their own. */
export const SHELF_PARTS = ["whole", "top", "back", "plank"] as const;
export type ShelfPart = (typeof SHELF_PARTS)[number];
const PART_ID: Record<ShelfPart, number> = { whole: 1, top: 2, back: 3, plank: 4 };
function shelfPart(value: unknown): ShelfPart {
  return value === "top" || value === "back" || value === "plank" ? value : "whole";
}

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
    create table if not exists porch_shelf (
      id integer primary key,
      mime text not null,
      image text not null,
      updated_at timestamptz not null default now()
    )
  `;
  await porchTables(sql, { key: [["porch_shelf", "id"]] });
}

async function founderFlag(sql: Awaited<ReturnType<typeof getSql>>, userId: string) {
  const me = await sql.query<{ is_founder: boolean }>("select is_porch_admin($1) as is_founder", [userId]);
  return boolish(me[0]?.is_founder);
}

export const getShelf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, seed);
    await ensure(sql);
    await sql`delete from porch_shelf where porch_id = ${porch} and id = 1 and updated_at < '2026-10-06T23:30:00Z'`;
    const founder = await founderFlag(sql, context.userId);
    const rows = await sql.query<{ id: number; mime: string; image: string; updated_at: string }>(`select id, mime, image, to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
       from porch_shelf where porch_id = ${porch} and id in (1, 2, 3, 4)`,
    );
    const row = rows.find((item) => Number(item.id) === 1);
    const parts = { top: { mime: "", image: "" }, back: { mime: "", image: "" }, plank: { mime: "", image: "" } };
    let updatedAt = row?.updated_at ?? "";
    for (const item of rows) {
      const part = (["top", "back", "plank"] as const).find((key) => PART_ID[key] === Number(item.id));
      if (part) parts[part] = { mime: item.mime ?? "", image: item.image ?? "" };
      if ((item.updated_at ?? "") > updatedAt) updatedAt = item.updated_at;
    }
    return {
      founder,
      mime: row?.mime ?? "",
      image: row?.image ?? "",
      parts,
      updatedAt,
    };
  });

export const setShelf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      mime: typeof raw.mime === "string" ? clip(raw.mime, 40) : "",
      image: typeof raw.image === "string" ? raw.image.replace(/\s/g, "").slice(0, 1_200_000) : "",
      part: shelfPart(raw.part),
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, data.seed);
    await ensure(sql);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "shelf", "Tried to change the shelf.");
      return { ok: false as const, error: "Only the founder can change the shelf." };
    }
    if (!data.image) {
      await sql`delete from porch_shelf where porch_id = ${porch} and id = ${PART_ID[data.part]}`;
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
      insert into porch_shelf (porch_id, id, mime, image, updated_at)
      values (${porch}, ${PART_ID[data.part]}, ${data.mime}, ${data.image}, now())
      on conflict (porch_id, id) do update set mime = ${data.mime}, image = ${data.image}, updated_at = now()
    `;
    return { ok: true as const };
  });
