import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";

/**
 * An event's flyer on its own, so the Events list stays small and quick.
 * The `v` code (part of the flyer's fingerprint) is only handed out inside the list,
 * and it changes when the flyer changes, so the phone can keep it for good.
 */
export const Route = createFileRoute("/api/event-flyer")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const id = Number(url.searchParams.get("id"));
        const v = url.searchParams.get("v") ?? "";
        if (!Number.isInteger(id) || id <= 0 || !/^[0-9a-f]{16}$/.test(v)) return new Response("Missing.", { status: 404 });
        const sql = await getSql();
        const rows = await sql.query<{ flyer: string }>(
          "select flyer from pb_events where id = $1 and flyer <> '' and left(md5(flyer), 16) = $2",
          [id, v],
        );
        const flyer = rows[0]?.flyer ?? "";
        const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(flyer);
        if (!match) return new Response("Missing.", { status: 404 });
        return new Response(new Uint8Array(Buffer.from(match[2], "base64")), {
          headers: { "content-type": match[1], "cache-control": "private, max-age=31536000, immutable" },
        });
      },
    },
  },
});
