import { createServerFn } from "@tanstack/react-start";
import { myPorchId, porchTables } from "@/lib/porch/porch-foundation";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";

const MAX_BYTES = 700_000;

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
    create table if not exists porch_ground (
      id integer primary key,
      mime text not null,
      image text not null,
      updated_at timestamptz not null default now()
    )
  `;
  await porchTables(sql, { key: [["porch_ground", "id"]] });
}

async function founderFlag(sql: Awaited<ReturnType<typeof getSql>>, userId: string) {
  const me = await sql.query<{ is_founder: boolean }>("select is_porch_admin($1) as is_founder", [userId]);
  return boolish(me[0]?.is_founder);
}

export const getGround = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, seed);
    await ensure(sql);
    const founder = await founderFlag(sql, context.userId);
    const rows = await sql.query<{ mime: string; image: string; updated_at: string }>(`select mime, image, to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
       from porch_ground where porch_id = ${porch} and id = 1`,
    );
    const row = rows[0];
    return {
      founder,
      mime: row?.mime ?? "",
      image: row?.image ?? "",
      updatedAt: row?.updated_at ?? "",
    };
  });

export const setGround = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      mime: typeof raw.mime === "string" ? clip(raw.mime, 40) : "",
      image: typeof raw.image === "string" ? raw.image.replace(/\s/g, "").slice(0, 1_200_000) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, data.seed);
    await ensure(sql);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "ground", "Tried to change the background.");
      return { ok: false as const, error: "Only an admin can change the background." };
    }
    if (!data.image) {
      await sql`delete from porch_ground where porch_id = ${porch} and id = 1`;
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
      insert into porch_ground (porch_id, id, mime, image, updated_at)
      values (${porch}, 1, ${data.mime}, ${data.image}, now())
      on conflict (porch_id, id) do update set mime = ${data.mime}, image = ${data.image}, updated_at = now()
    `;
    return { ok: true as const };
  });
