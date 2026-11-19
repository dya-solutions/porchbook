import { createServerFn } from "@tanstack/react-start";
import { myPorchId, porchTables } from "@/lib/porch/porch-foundation";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";

const MAX_BYTES = 700_000;

export const WALLS = ["back", "left", "right", "ahead"] as const;
export type WallSide = (typeof WALLS)[number];

const WALL_ID: Record<WallSide, number> = { back: 1, left: 2, right: 3, ahead: 4 };

function wallSide(value: unknown): WallSide {
  return value === "left" || value === "right" || value === "ahead" || value === "back" ? value : "back";
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
    create table if not exists porch_wall (
      id integer primary key,
      mime text not null,
      image text not null,
      updated_at timestamptz not null default now()
    )
  `;
  await porchTables(sql, { key: [["porch_wall", "id"]] });
}

async function founderFlag(sql: Awaited<ReturnType<typeof getSql>>, userId: string) {
  const me = await sql.query<{ is_founder: boolean }>("select is_porch_admin($1) as is_founder", [userId]);
  return boolish(me[0]?.is_founder);
}

export const getWall = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, seed);
    await ensure(sql);
    const founder = await founderFlag(sql, context.userId);
    const rows = await sql.query<{ id: number; mime: string; image: string }>(`select id, mime, image from porch_wall where porch_id = ${porch} and id in (1, 2, 3, 4)`,
    );
    const walls = { back: "", left: "", right: "", ahead: "" };
    const mimes = { back: "", left: "", right: "", ahead: "" };
    for (const row of rows) {
      const side = (Object.keys(WALL_ID) as WallSide[]).find((key) => WALL_ID[key] === Number(row.id));
      if (!side) continue;
      walls[side] = row.image ?? "";
      mimes[side] = row.mime ?? "";
    }
    return { founder, walls, mimes };
  });

export const setWall = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      mime: typeof raw.mime === "string" ? clip(raw.mime, 40) : "",
      image: typeof raw.image === "string" ? raw.image.replace(/\s/g, "").slice(0, 1_200_000) : "",
      wall: wallSide(raw.wall),
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, data.seed);
    await ensure(sql);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "wall", "Tried to change the wall photo.");
      return { ok: false as const, error: "Only the founder can change the wall photo." };
    }
    const id = WALL_ID[data.wall];
    if (!data.image) {
      await sql`delete from porch_wall where porch_id = ${porch} and id = ${id}`;
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
      insert into porch_wall (porch_id, id, mime, image, updated_at)
      values (${porch}, ${id}, ${data.mime}, ${data.image}, now())
      on conflict (porch_id, id) do update set mime = ${data.mime}, image = ${data.image}, updated_at = now()
    `;
    return { ok: true as const };
  });
