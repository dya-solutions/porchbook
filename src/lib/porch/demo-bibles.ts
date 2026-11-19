import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

/**
 * Founder-only demo Bibles (proof of concept). Copyrighted translations are kept here, compressed,
 * and given ONLY to the founder's account — members never see or receive them. When a licence is in
 * place, a translation can be shared with everyone.
 */

const MAX = 3_000_000; // compressed, as base64

const truthy = (value: unknown) => value === true || value === "t" || value === "true" || value === 1;

async function ensure(sql: Sql) {
  await sql`
    create table if not exists demo_bibles (
      id text primary key,
      abbreviation text not null,
      name text not null,
      data text not null,
      added_at timestamptz not null default now()
    )
  `;
}

async function isFounder(sql: Sql, userId: string) {
  const rows = await sql.query<{ is_founder: unknown }>("select is_platform_owner($1) as is_founder", [userId]);
  return truthy(rows[0]?.is_founder);
}

export const listDemoBibles = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { founder: false, bibles: [] as { id: string; abbreviation: string; name: string }[] };
    await ensure(sql);
    const rows = await sql.query<{ id: string; abbreviation: string; name: string }>("select id, abbreviation, name from demo_bibles order by added_at");
    return { founder: true, bibles: rows };
  });

export const getDemoBible = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: input && typeof input === "object" && typeof (input as { id?: unknown }).id === "string" ? (input as { id: string }).id.slice(0, 20) : "" }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { ok: false as const };
    await ensure(sql);
    const rows = await sql.query<{ data: string }>("select data from demo_bibles where id = $1", [data.id]);
    return rows[0] ? { ok: true as const, data: rows[0].data } : { ok: false as const };
  });

export const putDemoBible = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const text = (key: string, max: number) => (typeof raw[key] === "string" ? (raw[key] as string).slice(0, max) : "");
    const data = text("data", MAX + 1);
    return { id: text("id", 20), abbreviation: text("abbreviation", 12), name: text("name", 80), data: data.length <= MAX && /^[A-Za-z0-9+/=]+$/.test(data) ? data : "" };
  })
  .handler(async ({ context, data }) => {
    if (!data.id || !data.data) return { ok: false as const, error: "That file is too large or not readable." };
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { ok: false as const, error: "Only the founder can add a demo Bible." };
    await ensure(sql);
    await sql.query(
      `insert into demo_bibles (id, abbreviation, name, data) values ($1, $2, $3, $4)
       on conflict (id) do update set abbreviation = excluded.abbreviation, name = excluded.name, data = excluded.data, added_at = now()`,
      [data.id, data.abbreviation, data.name, data.data],
    );
    return { ok: true as const };
  });

/** The demo versions are gone: the founder's saved copies are deleted (anyone else: nothing happens). */
export const dropDemoBibles = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { ok: false as const };
    await ensure(sql);
    await sql.query("delete from demo_bibles");
    return { ok: true as const };
  });
