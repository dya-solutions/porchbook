import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

/**
 * Pictures inside notes. Each one is kept on its own (the note only holds its code),
 * under a long random name that only the note knows.
 */

type Sql = Awaited<ReturnType<typeof getSql>>;
let preparing: Promise<void> | null = null;

export function ensureNotePictures(sql: Sql) {
  preparing ??= (async () => {
    await sql.query(`create table if not exists note_pictures (
      id text primary key,
      user_id text not null,
      picture text not null,
      created_at timestamptz not null default now()
    )`);
  })().catch((error) => {
    preparing = null;
    throw error;
  });
  return preparing;
}

function newId() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((byte) => letters[byte % letters.length]).join("");
}

export const addNotePicture = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const picture = typeof raw.picture === "string" ? raw.picture : "";
    return { picture: /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(picture) && picture.length <= 900_000 ? picture : "" };
  })
  .handler(async ({ context, data }) => {
    if (!data.picture) return { ok: false as const, error: "That picture is too big or not a picture. Try another." };
    const sql = await getSql();
    await ensureNotePictures(sql);
    const count = await sql.query<{ n: string | number }>("select count(*) as n from note_pictures where user_id = $1 and created_at > now() - interval '1 day'", [context.userId]);
    if (Number(count[0]?.n ?? 0) >= 60) return { ok: false as const, error: "That's a lot of pictures today. Try again tomorrow." };
    const id = newId();
    await sql.query("insert into note_pictures (id, user_id, picture) values ($1, $2, $3)", [id, context.userId, data.picture]);
    return { ok: true as const, id };
  });
