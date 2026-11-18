import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { ensureNotePictures } from "@/lib/porch/note-pictures";

/** A picture inside a note, by its long random name. It never changes, so the phone keeps it. */
export const Route = createFileRoute("/api/note-picture")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const id = new URL(request.url).searchParams.get("id") ?? "";
        if (!/^[A-Za-z0-9]{20,40}$/.test(id)) return new Response("Missing.", { status: 404 });
        const sql = await getSql();
        await ensureNotePictures(sql);
        const rows = await sql.query<{ picture: string }>("select picture from note_pictures where id = $1", [id]);
        const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(rows[0]?.picture ?? "");
        if (!match) return new Response("Missing.", { status: 404 });
        return new Response(new Uint8Array(Buffer.from(match[2], "base64")), {
          headers: { "content-type": match[1], "cache-control": "private, max-age=31536000, immutable" },
        });
      },
    },
  },
});
