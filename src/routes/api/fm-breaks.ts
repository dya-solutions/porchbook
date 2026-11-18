import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { readBreaks } from "@/lib/porch/fm";

/**
 * Listeners poll this about every 10 seconds for studio "Play now" breaks.
 * Cached at the edge for 4 seconds, so however many people are listening the
 * database is asked at most a few times a minute. Holds only recording ids
 * and start times.
 */
export const Route = createFileRoute("/api/fm-breaks")({
  server: {
    handlers: {
      GET: async () => {
        const sql = await getSql();
        const breaks = await readBreaks(sql);
        return Response.json(
          { breaks },
          { headers: { "cache-control": "public, max-age=0, s-maxage=4, stale-while-revalidate=4" } },
        );
      },
    },
  },
});
