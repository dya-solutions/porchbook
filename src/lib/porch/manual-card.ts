import { createServerFn } from "@tanstack/react-start";
import { myPorchId } from "@/lib/porch/porch-foundation";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

/**
 * The welcome card that invites people to read the Porchbook Manual: one wording for new members
 * (joined in the last 7 days), another for everyone else who has never opened it.
 */
const rec = (input: unknown): Record<string, unknown> => (input && typeof input === "object" ? (input as Record<string, unknown>) : {});

async function isFounder(sql: Sql, userId: string) {
  const rows = await sql.query<{ is_founder: unknown }>("select is_porch_admin($1) as is_founder", [userId]);
  const f = rows[0]?.is_founder;
  return f === true || f === 1 || f === "1" || f === "t" || f === "true";
}

export const manualCard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    const founder = await isFounder(sql, context.userId);
    const flag = await sql.query<{ enabled: boolean }>(`select enabled from app_flags where porch_id = ${porch} and key = 'manual_card'`).catch(() => []);
    if (!founder && !flag[0]?.enabled) return { show: false as const };
    const read = await sql.query<{ opened_at: string | null; hide_until: string | null }>("select opened_at, hide_until from manual_reads where user_id = $1", [context.userId]);
    if (read[0]?.opened_at) return { show: false as const };
    if (read[0]?.hide_until && new Date(read[0].hide_until).getTime() > Date.now()) return { show: false as const };
    const me = await sql.query<{ display_name: string; created_at: string }>("select display_name, created_at from profiles where user_id = $1", [context.userId]);
    const name = (me[0]?.display_name ?? "").trim().split(/\s+/)[0] ?? "";
    const fresh = me[0]?.created_at ? Date.now() - new Date(me[0].created_at).getTime() < 7 * 86_400_000 : false;
    return { show: true as const, kind: fresh ? ("new" as const) : ("old" as const), name, founder, live: Boolean(flag[0]?.enabled) };
  });

/** They opened the manual: the card is done for good. */
export const manualOpened = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await sql.query(
      `insert into manual_reads (user_id, opened_at) values ($1, now())
       on conflict (user_id) do update set opened_at = coalesce(manual_reads.opened_at, now())`,
      [context.userId],
    );
    return { ok: true as const };
  });

/** Later: back tomorrow. ✕: back in 2 weeks, once; after that it stays away. */
export const hideManualCard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ how: rec(input).how === "close" ? ("close" as const) : ("later" as const) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    const prev = await sql.query<{ hides: number }>("select hides from manual_reads where user_id = $1", [context.userId]);
    const closes = (prev[0]?.hides ?? 0) + (data.how === "close" ? 1 : 0);
    const days = data.how === "later" ? 1 : closes >= 2 ? 36500 : 14;
    await sql.query(
      `insert into manual_reads (user_id, hide_until, hides) values ($1, now() + ($2 || ' days')::interval, $3)
       on conflict (user_id) do update set hide_until = excluded.hide_until, hides = excluded.hides`,
      [context.userId, String(days), closes],
    );
    return { ok: true as const };
  });

/** Founder: show the card to everyone (or take it back to founder-only). */
export const setManualCardLive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ on: rec(input).on === true }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    if (!(await isFounder(sql, context.userId))) return { ok: false as const };
    await sql.query(`insert into app_flags (porch_id, key, enabled) values (${porch}, 'manual_card', $1) on conflict (porch_id, key) do update set enabled = excluded.enabled`, [data.on]);
    return { ok: true as const };
  });
