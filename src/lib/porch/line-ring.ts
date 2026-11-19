import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

/**
 * Ring a member who doesn't have Porchbook open, by phone notification.
 * At most once every 20 seconds per caller and person.
 */
export const ringOffline = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    return {
      to: typeof raw.to === "string" ? raw.to.trim().slice(0, 120) : "",
      video: raw.video === true,
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.to || data.to === context.userId) return { ok: false as const, reached: 0 };
    const sql = await getSql();
    // Calls only between members of the same church porch.
    const person = await sql.query<{ user_id: string }>("select user_id from profiles where user_id = $1 and same_porch(user_id, $2)", [data.to, context.userId]);
    if (!person.length) return { ok: false as const, reached: 0 };
    await sql.query(
      `create table if not exists line_rings (
         caller_id text not null,
         callee_id text not null,
         rung_at timestamptz not null default now(),
         primary key (caller_id, callee_id)
       )`,
    );
    await sql.query("alter table line_rings add column if not exists declined_at timestamptz");
    const recent = await sql.query<{ fresh: boolean }>(
      "select rung_at > now() - interval '20 seconds' as fresh from line_rings where caller_id = $1 and callee_id = $2",
      [context.userId, data.to],
    );
    if (recent[0]?.fresh === true || String(recent[0]?.fresh) === "true" || String(recent[0]?.fresh) === "t") {
      return { ok: true as const, reached: -1 };
    }
    await sql.query(
      `insert into line_rings (caller_id, callee_id, rung_at, declined_at) values ($1, $2, now(), null)
       on conflict (caller_id, callee_id) do update set rung_at = now(), declined_at = null`,
      [context.userId, data.to],
    );
    const { notifyLineCall } = await import("@/lib/porch/push.server");
    let reached = 0;
    try {
      reached = await notifyLineCall(sql, data.to, context.userId, data.video);
    } catch {
      reached = 0;
    }
    return { ok: true as const, reached };
  });

/** The caller checks while ringing: did they tap Decline on the notification? */
export const ringStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    return { to: typeof raw.to === "string" ? raw.to.trim().slice(0, 120) : "" };
  })
  .handler(async ({ context, data }) => {
    if (!data.to) return { declined: false };
    const sql = await getSql();
    try {
      const rows = await sql.query<{ declined_at: string | null }>(
        "select declined_at from line_rings where caller_id = $1 and callee_id = $2",
        [context.userId, data.to],
      );
      return { declined: Boolean(rows[0]?.declined_at) };
    } catch {
      return { declined: false };
    }
  });
