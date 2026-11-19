import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";

/**
 * Who's on the porch. Each open Porchbook sends a light "I'm here" every 30 s.
 * Online: a beat in the last 75 s. Idle: no touch for 5 minutes. Hidden people never show,
 * and (fair trade) someone hidden sees only how many are on, not who.
 */

export type PresenceStatus = "online" | "dnd" | "hidden";
export type OnlinePerson = { userId: string; name: string; imageUrl: string | null; idle: boolean; dnd: boolean };

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}
function parseSeed(raw: Record<string, unknown>): Seed {
  return {
    displayName: typeof raw.displayName === "string" ? raw.displayName.trim().slice(0, 80) : "",
    email: typeof raw.email === "string" ? raw.email.trim().slice(0, 200) : null,
    imageUrl: typeof raw.imageUrl === "string" ? raw.imageUrl.trim().slice(0, 500) : null,
  };
}
function parseStatus(value: unknown): PresenceStatus | null {
  return value === "online" || value === "dnd" || value === "hidden" ? value : null;
}
const truthy = (value: unknown) => value === true || value === "t" || value === "true" || value === 1;

async function ensure(sql: Sql) {
  await sql`
    create table if not exists presence (
      user_id text primary key,
      status text not null default 'hidden',
      chose boolean not null default false,
      last_beat timestamptz,
      last_touch timestamptz
    )
  `;
}

async function readPorch(sql: Sql, userId: string) {
  const mine = await sql.query<{ status: string; chose: unknown }>("select status, chose from presence where user_id = $1", [userId]);
  const status = parseStatus(mine[0]?.status) ?? "hidden";
  const rows = await sql.query<{ user_id: string; name: string; image_url: string | null; idle: unknown; status: string }>(
    `select p.user_id, coalesce(pr.display_name, 'Someone') as name, pr.image_url,
            (p.last_touch is null or p.last_touch < now() - interval '5 minutes') as idle, p.status
       from presence p join profiles pr on pr.user_id = p.user_id
      where p.status <> 'hidden' and p.last_beat > now() - interval '75 seconds' and p.user_id <> $1
        and pr.porch_id = my_porch($1)
      order by (p.last_touch is null or p.last_touch < now() - interval '5 minutes'), p.last_touch desc nulls last
      limit 60`,
    [userId],
  );
  const people: OnlinePerson[] = rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    imageUrl: row.image_url,
    idle: truthy(row.idle),
    dnd: row.status === "dnd",
  }));
  return {
    status,
    chose: truthy(mine[0]?.chose),
    count: people.length,
    // Fair trade: only people who show themselves see who's on.
    people: status === "hidden" ? [] : people,
  };
}

export const presenceBeat = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { seed: parseSeed(raw), active: raw.active === true, here: raw.here !== false };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensure(sql);
    if (data.here) {
      await sql.query(
        `insert into presence (user_id, last_beat, last_touch) values ($1, now(), case when $2 then now() else null end)
         on conflict (user_id) do update set last_beat = now(),
           last_touch = case when $2 then now() else presence.last_touch end`,
        [context.userId, data.active],
      );
      // Waiting for a radio request? The admin hears they're here.
      const { noticeRequester, tellPlayedRequests } = await import("@/lib/porch/fm");
      await noticeRequester(sql, context.userId);
      await tellPlayedRequests(sql);
    } else {
      // Leaving (app closed or hidden): drop off straight away.
      await sql.query("update presence set last_beat = now() - interval '10 minutes' where user_id = $1", [context.userId]);
    }
    return readPorch(sql, context.userId);
  });

export const setPresence = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { seed: parseSeed(raw), status: parseStatus(raw.status) };
  })
  .handler(async ({ context, data }) => {
    if (!data.status) return { ok: false as const, error: "Pick a status." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensure(sql);
    await sql.query(
      `insert into presence (user_id, status, chose, last_beat, last_touch) values ($1, $2, true, now(), now())
       on conflict (user_id) do update set status = $2, chose = true, last_beat = now(), last_touch = now()`,
      [context.userId, data.status],
    );
    return { ok: true as const, ...(await readPorch(sql, context.userId)) };
  });
