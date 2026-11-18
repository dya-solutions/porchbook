import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";

/**
 * A post's photo on its own, so the feed doesn't carry every picture each time.
 * The `v` code (part of the photo's fingerprint) is only handed out inside the
 * feed, so the photo stays private; it also lets the phone keep it for good.
 */
export const Route = createFileRoute("/api/post-photo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const id = Number(url.searchParams.get("id"));
        const v = url.searchParams.get("v") ?? "";
        if (!Number.isInteger(id) || id <= 0 || !/^[0-9a-f]{16}$/.test(v)) return new Response("Missing.", { status: 404 });
        const sql = await getSql();
        const rows = await sql.query<{ photo: string; photo_mime: string }>(
          "select photo, photo_mime from posts where id = $1 and coalesce(photo, '') <> '' and left(md5(photo), 16) = $2",
          [id, v],
        );
        const row = rows[0];
        if (!row) return new Response("Missing.", { status: 404 });
        return new Response(new Uint8Array(Buffer.from(row.photo, "base64")), {
          headers: {
            "content-type": row.photo_mime || "image/jpeg",
            "cache-control": "private, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
