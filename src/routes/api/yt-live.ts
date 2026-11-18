import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { phanerooLive } from "@/lib/porch/yt-live.server";

/**
 * Is Phaneroo live on YouTube? Members' phones ask about once a minute while
 * the radio panel is open; the answer is cached for a minute at the edge so
 * YouTube is asked at most about once a minute in total.
 */
export const Route = createFileRoute("/api/yt-live")({
  server: {
    handlers: {
      GET: async () => {
        const sql = await getSql();
        const info = await phanerooLive(sql);
        return Response.json(info, { headers: { "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=30" } });
      },
    },
  },
});
