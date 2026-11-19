import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

/** The bell: reactions, replies and questions for you, newest first. */
const rec = (input: unknown): Record<string, unknown> => (input && typeof input === "object" ? (input as Record<string, unknown>) : {});

async function shownTo(sql: Sql, userId: string) {
  const rows = await sql.query<{ is_founder: unknown }>("select is_porch_admin($1) as is_founder", [userId]);
  const f = rows[0]?.is_founder;
  const founder = f === true || f === 1 || f === "1" || f === "t" || f === "true";
  const flag = await sql.query<{ enabled: boolean }>("select enabled from app_flags where key = 'bell'").catch(() => []);
  const live = Boolean(flag[0]?.enabled);
  return { show: founder || live, founder, live };
}

export type BellNote = {
  id: number;
  kind: "reaction" | "reply" | "question";
  target: "post" | "reply";
  postId: number;
  refId: number;
  reaction: string;
  snippet: string;
  seen: boolean;
  at: string;
  actorId: string;
  actorName: string;
  actorImage: string;
};

export const bellCount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const who = await shownTo(sql, context.userId);
    if (!who.show) return { show: false as const, unread: 0 };
    const rows = await sql.query<{ n: number }>("select count(*)::int as n from notifications where user_id = $1 and not seen", [context.userId]);
    return { show: true as const, unread: Number(rows[0]?.n ?? 0), founder: who.founder, live: who.live };
  });

export const bellNotes = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ before: typeof rec(input).before === "string" ? String(rec(input).before).slice(0, 40) : "" }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await shownTo(sql, context.userId)).show) return { ok: false as const, notes: [] as BellNote[], more: false };
    const params: unknown[] = [context.userId];
    if (data.before) params.push(data.before);
    const rows = await sql.query<{
      id: number; kind: string; target: string; post_id: number; ref_id: number; reaction: string; snippet: string; seen: unknown; at: string;
      actor_id: string; actor_name: string | null; actor_image: string | null;
    }>(
      `select n.id, n.kind, n.target, n.post_id, n.ref_id, n.reaction, n.snippet, n.seen,
              to_char(n.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at,
              n.actor_id, p.display_name as actor_name, p.image_url as actor_image
       from notifications n left join profiles p on p.user_id = n.actor_id
       where n.user_id = $1 ${data.before ? "and n.created_at < $2::timestamptz" : ""}
       order by n.created_at desc limit 61`,
      params,
    );
    const notes: BellNote[] = rows.slice(0, 60).map((r) => ({
      id: Number(r.id),
      kind: r.kind as BellNote["kind"],
      target: r.target === "reply" ? "reply" : "post",
      postId: Number(r.post_id),
      refId: Number(r.ref_id),
      reaction: r.reaction,
      snippet: r.snippet,
      seen: r.seen === true || r.seen === "t" || r.seen === 1,
      at: r.at,
      actorId: r.actor_id,
      actorName: (r.actor_name ?? "").trim() || "Someone",
      actorImage: r.actor_image ?? "",
    }));
    return { ok: true as const, notes, more: rows.length > 60 };
  });

/** Opening the list counts as seeing them (the green dots stay until the list closes). */
export const bellSeen = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await sql.query("update notifications set seen = true where user_id = $1 and not seen", [context.userId]);
    return { ok: true as const };
  });
