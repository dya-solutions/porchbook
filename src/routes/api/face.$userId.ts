import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { ensureFaces } from "@/lib/porch/faces";

/** A member's profile photo. The link changes with each new photo, so phones may keep it a long time. */
export const Route = createFileRoute("/api/face/$userId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const sql = await getSql();
        await ensureFaces(sql);
        const rows = await sql.query<{ mime: string; data: string }>("select mime, data from profile_faces where user_id = $1", [params.userId]);
        const row = rows[0];
        if (!row) return new Response("No photo", { status: 404 });
        return new Response(Buffer.from(row.data, "base64"), {
          headers: { "content-type": row.mime || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
        });
      },
    },
  },
});
