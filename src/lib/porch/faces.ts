import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

/** Profile photos: small square JPEGs kept in the database and served at /api/face/<userId>. */

const MAX_BASE64 = 200_000; // ~150 KB; the phone sends ~30 KB

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}
const truthy = (value: unknown) => value === true || value === "t" || value === "true" || value === 1;

export async function ensureFaces(sql: Sql) {
  await sql`
    create table if not exists profile_faces (
      user_id text primary key,
      mime text not null default 'image/jpeg',
      data text not null,
      updated_at timestamptz not null default now()
    )
  `;
}

export const getMyFace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql.query<{ image_url: string | null }>("select image_url from profiles where user_id = $1", [context.userId]);
    return { imageUrl: rows[0]?.image_url ?? null };
  });

export const setMyFace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const image = typeof raw.image === "string" ? raw.image.replace(/\s/g, "") : "";
    return { image: image.length <= MAX_BASE64 && /^[A-Za-z0-9+/=]+$/.test(image) ? image : "" };
  })
  .handler(async ({ context, data }) => {
    if (!data.image) return { ok: false as const, error: "That photo couldn't be used. Try another." };
    const sql = await getSql();
    await ensureFaces(sql);
    const found = await sql.query<{ user_id: string }>("select user_id from profiles where user_id = $1", [context.userId]);
    if (!found.length) return { ok: false as const, error: "Open Porchbook once more, then try again." };
    await sql.query(
      `insert into profile_faces (user_id, mime, data, updated_at) values ($1, 'image/jpeg', $2, now())
       on conflict (user_id) do update set data = excluded.data, mime = excluded.mime, updated_at = now()`,
      [context.userId, data.image],
    );
    const imageUrl = `/api/face/${encodeURIComponent(context.userId)}?v=${Date.now().toString(36)}`;
    await sql.query("update profiles set image_url = $2 where user_id = $1", [context.userId, imageUrl]);
    return { ok: true as const, imageUrl };
  });

/** Remove a photo: your own, or (founder only) anyone's. */
export const removeFace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { userId: typeof raw.userId === "string" ? raw.userId.slice(0, 80) : "" };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const target = data.userId || context.userId;
    if (target !== context.userId) {
      const me = await sql.query<{ is_founder: unknown }>("select is_founder from profiles where user_id = $1", [context.userId]);
      if (!truthy(me[0]?.is_founder)) return { ok: false as const, error: "Only the founder can remove someone's photo." };
    }
    await ensureFaces(sql);
    await sql.query("delete from profile_faces where user_id = $1", [target]);
    await sql.query("update profiles set image_url = null where user_id = $1", [target]);
    return { ok: true as const };
  });
