import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { iceConfigFor } from "@/lib/porch/ice-config.server";

export const Route = createFileRoute("/api/calling/ice-config")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) return Response.json({ error: "Sign in." }, { status: 401 });
        const config = iceConfigFor(session.user.id);
        return Response.json({
          iceServers: config.iceServers,
          turn: config.turn,
          reason: config.turn ? "" : "Porchbook is waiting for real TURN credentials.",
        });
      },
    },
  },
});
