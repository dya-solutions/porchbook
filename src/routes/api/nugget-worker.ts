import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";

/**
 * The audio worker reports Nuggets work here. Every message carries its job's one-off token.
 *  - transcript / transcript-failed: an episode's words with times (then the AI picks moments)
 *  - token: a one-off pass to upload a cut nugget
 *  - cut / cut-failed: the nugget's own short audio file
 */
export const Route = createFileRoute("/api/nugget-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ error: "bad json" }, { status: 400 });
        }
        const token = typeof body.jobToken === "string" ? body.jobToken : "";
        if (token.length < 20) return Response.json({ error: "unknown job" }, { status: 403 });
        const sql = await getSql();
        const action = String(body.action ?? "");

        if (action === "transcript" || action === "transcript-failed") {
          const sourceId = Number(body.sourceId);
          const job = await sql.query<{ id: number }>(
            "select id from nugget_sources where id = $1 and job_token = $2 and job_started_at > now() - interval '6 hours'",
            [sourceId, token],
          );
          if (!job.length) return Response.json({ error: "unknown job" }, { status: 403 });
          if (action === "transcript-failed") {
            await sql.query("update nugget_sources set status = 'failed', error = $2, job_token = null where id = $1", [sourceId, String(body.error ?? "Transcribing failed.").slice(0, 300)]);
            return Response.json({ ok: true });
          }
          const { segmentsFromWords, suggestMoments } = await import("@/lib/porch/nuggets.server");
          // Groq sends sentence-sized pieces; word lists (from other services) are grouped here.
          const pieces = Array.isArray(body.segments) ? (body.segments as { text?: unknown; start?: unknown; end?: unknown }[]) : [];
          const words = Array.isArray(body.words) ? (body.words as { text?: unknown; start?: unknown; end?: unknown }[]) : [];
          const segs = pieces.length
            ? pieces.map((x) => ({ s: Number(x.start) || 0, e: Number(x.end) || 0, t: String(x.text ?? "").trim() })).filter((x) => x.t)
            : segmentsFromWords(words.map((w) => ({ text: String(w.text ?? ""), start: Number(w.start) || 0, end: Number(w.end) || 0 })));
          if (!segs.length) {
            await sql.query("update nugget_sources set status = 'failed', error = 'No words came back.', job_token = null where id = $1", [sourceId]);
            return Response.json({ ok: true });
          }
          await sql.query("update nugget_sources set transcript = $2, status = 'ready', job_token = null where id = $1", [sourceId, JSON.stringify(segs)]);
          try {
            const found = await suggestMoments(sql, sourceId);
            return Response.json({ ok: true, found });
          } catch (error) {
            await sql.query("update nugget_sources set status = 'ready', error = $2 where id = $1", [sourceId, (error instanceof Error ? error.message : "The AI couldn't read it.").slice(0, 300)]);
            return Response.json({ ok: true, found: 0 });
          }
        }

        const nuggetId = Number(body.nuggetId);
        const job = await sql.query<{ id: number }>("select id from nuggets where id = $1 and job_token = $2 and job_started_at > now() - interval '6 hours'", [nuggetId, token]);
        if (!job.length) return Response.json({ error: "unknown job" }, { status: 403 });

        if (action === "token") {
          const { uploadSpot } = await import("@/lib/porch/audio-store.server");
          try {
            return Response.json(await uploadSpot(sql, `nuggets/${nuggetId}-${Date.now()}.mp3`, { contentTypes: ["audio/mpeg"], maxBytes: 20 * 1024 * 1024 }));
          } catch {
            return Response.json({ error: "audio storage isn't connected" }, { status: 503 });
          }
        }
        if (action === "cut") {
          const url = typeof body.url === "string" ? body.url : "";
          const durationSec = Number(body.durationSec);
          if (!(await (await import("@/lib/porch/audio-store.server")).isStoreUrl(sql, url, "nuggets/")) || !(durationSec > 1)) {
            return Response.json({ error: "bad result" }, { status: 400 });
          }
          const { keepOnAir } = await import("@/lib/porch/fm");
          await keepOnAir(sql, () => sql.query("update nuggets set url = $2, duration_sec = $3, job_token = null, cut_error = '' where id = $1", [nuggetId, url, durationSec]));
          return Response.json({ ok: true });
        }
        if (action === "cut-failed") {
          await sql.query("update nuggets set cut_error = $2, job_token = null where id = $1", [nuggetId, String(body.error ?? "Cutting failed.").slice(0, 300)]);
          return Response.json({ ok: true });
        }
        return Response.json({ error: "unknown action" }, { status: 400 });
      },
    },
  },
});
