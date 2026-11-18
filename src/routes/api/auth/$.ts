import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { ensureDbReady } from "@/lib/db";

// Tables must exist before Better Auth reads or writes users.
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await ensureDbReady();
        return auth.handler(request);
      },
      POST: async ({ request }) => {
        await ensureDbReady();
        return auth.handler(request);
      },
    },
  },
});
