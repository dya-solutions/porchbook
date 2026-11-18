import { createFileRoute } from "@tanstack/react-router";

/** The live build's number. Phones on an older one show "tap Refresh". */
export const Route = createFileRoute("/api/build")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify({ build: __PORCH_BUILD__ }), {
          headers: { "content-type": "application/json", "cache-control": "no-store, max-age=0" },
        }),
    },
  },
});
