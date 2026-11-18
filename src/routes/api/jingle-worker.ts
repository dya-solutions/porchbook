import { createFileRoute } from "@tanstack/react-router";
import { ensureDbReady, getSql } from "@/lib/db";

/** The audio server reports a mixed jingle (or why it couldn't); the job's one-off token must match. */
export const Route = createFileRoute("/api/jingle-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        await ensureDbReady();
        const sql = await getSql();
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const token = typeof body.jobToken === "string" ? body.jobToken : "";
        const id = Math.round(Number(body.draftId) || 0);
        if (token.length < 20 || !id) return Response.json({ error: "bad request" }, { status: 400 });
        const rows = await sql.query<{ id: number }>("select id from jingle_drafts where id = $1 and job_token = $2 and status = 'mixing'", [id, token]);
        if (!rows[0]) return Response.json({ error: "unknown job" }, { status: 404 });
        if (body.action === "done") {
          const url = typeof body.url === "string" ? body.url : "";
          const durationSec = Number(body.durationSec) || 0;
          const { isStoreUrl } = await import("@/lib/porch/audio-store.server");
          if (!(await isStoreUrl(sql, url, "jingles/")) || durationSec < 0.5) return Response.json({ error: "bad result" }, { status: 400 });
          await sql.query("update jingle_drafts set status = 'ready', url = $2, duration_sec = $3, job_token = null where id = $1", [id, url, durationSec]);
          return Response.json({ ok: true });
        }
        if (body.action === "failed") {
          const why = typeof body.error === "string" ? body.error.slice(0, 200) : "the mix didn't work";
          await sql.query("update jingle_drafts set status = 'failed', error = $2, job_token = null where id = $1", [id, `The mix didn't work: ${why}`]);
          return Response.json({ ok: true });
        }
        return Response.json({ error: "bad request" }, { status: 400 });
      },
    },
  },
});
