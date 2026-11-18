import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { getSql } from "@/lib/db";
import { ensureCallRing, lookupRing } from "@/lib/porch/call-ask";
import { radioAlertFor, studioAlertFor } from "@/lib/porch/fm";

export const Route = createFileRoute("/api/ring")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) return Response.json({ call: null }, { status: 401 });
        const sql = await getSql();
        const url = new URL(request.url);
        if (url.searchParams.get("dismiss") === "1" || url.searchParams.get("answer") === "1") {
          await ensureCallRing(sql);
          await sql`delete from call_rings where callee_id = ${session.user.id}`;
          if (url.searchParams.get("answer") === "1") {
            await sql`
              update call_log set status = 'answered'
              where id = (
                select id from call_log
                where callee_id = ${session.user.id} and status = 'calling'
                order by started_at desc
                limit 1
              )
            `;
          } else {
            await sql`
              update call_log set status = 'declined', ended_at = now()
              where id = (
                select id from call_log
                where callee_id = ${session.user.id} and status = 'calling'
                order by started_at desc
                limit 1
              )
            `;
          }
          return Response.json({ ok: true });
        }
        const call = await lookupRing(sql, session.user.id);
        // Porchbook app: "your request is about to play" / "… dedicated a song to you".
        const radio = (await radioAlertFor(sql, session.user.id)) ?? (await studioAlertFor(sql, session.user.id));
        return Response.json({ call, radio });
      },
    },
  },
});