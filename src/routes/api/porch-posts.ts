import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { getSql } from "@/lib/db";

function asText(value: unknown) {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return "";
}

export const Route = createFileRoute("/api/porch-posts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const headers = new Headers(request.headers);
        const token = url.searchParams.get("t");
        if (token && !headers.get("authorization")) headers.set("authorization", `Bearer ${token}`);
        const session = await auth.api.getSession({ headers });
        if (!session?.user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
        const sql = await getSql();
        const id = Number(url.searchParams.get("id"));
        if (Number.isInteger(id) && id > 0) {
          const rows = await sql.query<{ photo: string; photo_mime: string }>(
            "select photo, photo_mime from posts where id = $1 and porch_id = my_porch($2)",
            [id, session.user.id],
          );
          const row = rows[0];
          const stored = asText(row?.photo);
          if (!stored) return new Response("That photo is missing.", { status: 404 });
          const raw = stored.includes(",") ? stored.slice(stored.indexOf(",") + 1) : stored;
          const bytes = Buffer.from(raw, "base64");
          return new Response(new Uint8Array(bytes), {
            headers: {
              "content-type": row.photo_mime || "image/jpeg",
              "cache-control": "private, no-store",
            },
          });
        }
        const rows = await sql.query<{ id: number; body: string; author_name: string; has_photo: unknown }>(
          `select p.id, p.body, a.display_name as author_name,
                  (p.photo is not null and p.photo <> '') as has_photo
           from posts p
           join profiles a on a.user_id = p.author_id
           where p.porch_id = my_porch($1)
           order by p.created_at desc
           limit 30`,
          [session.user.id],
        );
        return Response.json({
          ok: true,
          posts: rows.map((row) => ({
            id: row.id,
            author: (row.author_name || "Someone").trim() || "Someone",
            body: (row.body || "").trim().slice(0, 420),
            hasPhoto: row.has_photo === true || row.has_photo === 1 || row.has_photo === "t" || row.has_photo === "true",
          })),
        });
      },
    },
  },
});
