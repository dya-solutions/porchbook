import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

/** Where each member has moved the furniture in the porch guy's room: { piece: [x, z, turn] }. */
export type RoomLayout = Record<string, [number, number, number]>;

const PIECE = /^[a-z][a-z0-9-]{0,30}$/;

function cleanLayout(input: unknown): RoomLayout {
  const out: RoomLayout = {};
  if (!input || typeof input !== "object") return out;
  let count = 0;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (count >= 40 || !PIECE.test(key) || !Array.isArray(value) || value.length !== 3) continue;
    const [x, z, turn] = value.map(Number);
    if (![x, z, turn].every((n) => Number.isFinite(n) && Math.abs(n) < 50)) continue;
    out[key] = [Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000, Math.round(turn * 1000) / 1000];
    count += 1;
  }
  return out;
}

async function ensure(sql: Awaited<ReturnType<typeof getSql>>) {
  await sql`
    create table if not exists porch_room_layout (
      user_id text primary key,
      data text not null default '{}',
      updated_at timestamptz not null default now()
    )
  `;
}

export const getRoomLayout = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensure(sql);
    const rows = await sql.query<{ data: string }>("select data from porch_room_layout where user_id = $1", [context.userId]);
    try {
      return { layout: cleanLayout(JSON.parse(rows[0]?.data ?? "{}")) };
    } catch {
      return { layout: {} as RoomLayout };
    }
  });

export const saveRoomLayout = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => cleanLayout((input as { layout?: unknown } | null)?.layout))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensure(sql);
    if (!Object.keys(data).length) {
      await sql.query("delete from porch_room_layout where user_id = $1", [context.userId]);
      return { ok: true as const };
    }
    await sql.query(
      `insert into porch_room_layout (user_id, data, updated_at) values ($1, $2, now())
       on conflict (user_id) do update set data = excluded.data, updated_at = now()`,
      [context.userId, JSON.stringify(data)],
    );
    return { ok: true as const };
  });
