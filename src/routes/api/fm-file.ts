import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";

/** Serves small FM audio kept in the database (used only without Blob). */
export const Route = createFileRoute("/api/fm-file")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const id = Number(new URL(request.url).searchParams.get("id"));
        if (!Number.isInteger(id) || id <= 0) return new Response("Missing.", { status: 404 });
        const sql = await getSql();
        const rows = await sql.query<{ mime: string; data: string }>("select mime, data from fm_files where id = $1", [id]);
        const row = rows[0];
        if (!row) return new Response("Missing.", { status: 404 });
        const bytes = Buffer.from(row.data, "base64");
        const range = request.headers.get("range");
        const match = range?.match(/bytes=(\d*)-(\d*)/);
        if (match) {
          const start = match[1] ? Number(match[1]) : 0;
          const end = match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
          return new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
            status: 206,
            headers: {
              "content-type": row.mime,
              "content-range": `bytes ${start}-${end}/${bytes.length}`,
              "accept-ranges": "bytes",
              "cache-control": "public, max-age=31536000, immutable",
            },
          });
        }
        return new Response(new Uint8Array(bytes), {
          headers: { "content-type": row.mime, "accept-ranges": "bytes", "cache-control": "public, max-age=31536000, immutable" },
        });
      },
    },
  },
});
