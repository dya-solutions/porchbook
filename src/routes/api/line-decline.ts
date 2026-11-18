import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { ensureDbReady, getSql } from "@/lib/db";

/**
 * Tapped "Decline" on a Porchbook call notification: mark the ring declined so
 * the caller's phone stops ringing and tells them straight away.
 */
export const Route = createFileRoute("/api/line-decline")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        await ensureDbReady();
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) return Response.json({ ok: false }, { status: 401 });
        const caller = (new URL(request.url).searchParams.get("caller") || "").slice(0, 120);
        if (!caller) return Response.json({ ok: false }, { status: 400 });
        const sql = await getSql();
        try {
          await sql.query("alter table line_rings add column if not exists declined_at timestamptz");
          await sql.query("update line_rings set declined_at = now() where caller_id = $1 and callee_id = $2", [caller, session.user.id]);
        } catch {
          /* no ring on record: nothing to tell */
        }
        return Response.json({ ok: true });
      },
    },
  },
});
