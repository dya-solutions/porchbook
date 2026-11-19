import { createServerFn } from "@tanstack/react-start";
import { myPorchId, porchTables } from "@/lib/porch/porch-foundation";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";

export const CLOTHES = ["shirt", "trousers"] as const;
export type ClothPart = (typeof CLOTHES)[number];

const CLOTH_ID: Record<ClothPart, number> = { shirt: 1, trousers: 2 };

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

function partOf(value: unknown): ClothPart {
  return value === "trousers" ? "trousers" : "shirt";
}

function colorOf(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : "";
}

async function ensure(sql: Awaited<ReturnType<typeof getSql>>) {
  await sql`
    create table if not exists porch_cloth (
      id integer primary key,
      color text not null,
      updated_at timestamptz not null default now()
    )
  `;
  await porchTables(sql, { key: [["porch_cloth", "id"]] });
}

async function founderFlag(sql: Awaited<ReturnType<typeof getSql>>, userId: string) {
  const me = await sql.query<{ is_founder: boolean }>("select is_porch_admin($1) as is_founder", [userId]);
  return boolish(me[0]?.is_founder);
}

export const getCloth = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, seed);
    await ensure(sql);
    const founder = await founderFlag(sql, context.userId);
    const rows = await sql.query<{ id: number; color: string }>(`select id, color from porch_cloth where porch_id = ${porch} and id in (1, 2)`);
    const colors = { shirt: "", trousers: "" };
    for (const row of rows) {
      const part = (Object.keys(CLOTH_ID) as ClothPart[]).find((key) => CLOTH_ID[key] === Number(row.id));
      if (!part) continue;
      colors[part] = colorOf(row.color);
    }
    return { founder, colors };
  });

export const setCloth = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      part: partOf(raw.part),
      color: colorOf(raw.color),
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, data.seed);
    await ensure(sql);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "cloth", "Tried to change the porch guy's clothes.");
      return { ok: false as const, error: "Only an admin can change his clothes." };
    }
    const id = CLOTH_ID[data.part];
    if (!data.color) {
      await sql`delete from porch_cloth where porch_id = ${porch} and id = ${id}`;
      return { ok: true as const };
    }
    await sql`
      insert into porch_cloth (porch_id, id, color, updated_at)
      values (${porch}, ${id}, ${data.color}, now())
      on conflict (porch_id, id) do update set color = ${data.color}, updated_at = now()
    `;
    return { ok: true as const };
  });
