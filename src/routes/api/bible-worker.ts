import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";

/**
 * The audio server reports Bible reading work here (each message carries its job's one-off token):
 *  - token: a pass to upload one cut chapter
 *  - done: the book's chapters (ready for the founder to check)
 *  - failed: why it couldn't be cut
 */
export const Route = createFileRoute("/api/bible-worker")({
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
        const bookId = Number(body.bookId);
        if (token.length < 20 || !Number.isInteger(bookId)) return Response.json({ error: "unknown job" }, { status: 403 });
        const sql = await getSql();
        const job = await sql.query<{ id: number }>("select id from bible_audio_books where id = $1 and job_token = $2 and job_started_at > now() - interval '12 hours'", [bookId, token]);
        if (!job.length) return Response.json({ error: "unknown job" }, { status: 403 });

        if (body.action === "token") {
          const chapter = Math.max(1, Math.min(200, Math.round(Number(body.chapter) || 1)));
          const { uploadSpot } = await import("@/lib/porch/audio-store.server");
          try {
            // one piece of the book
            return Response.json(await uploadSpot(sql, `bible/${bookId}/${chapter}-${Date.now()}.mp3`, { contentTypes: ["audio/mpeg"], maxBytes: 60 * 1024 * 1024 }));
          } catch {
            return Response.json({ error: "audio storage isn't connected" }, { status: 503 });
          }
        }
        if (body.action === "done") {
          const pieces = Array.isArray(body.chapters) ? (body.chapters as Record<string, unknown>[]) : [];
          const ours = await (await import("@/lib/porch/audio-store.server")).storeUrlChecker(sql);
          const good = pieces.filter((c) => Number(c.chapter) >= 1 && ours(c.url, "bible/") && Number(c.durationSec) > 1);
          if (!good.length) return Response.json({ error: "no pieces" }, { status: 400 });
          const total = Number(body.totalSec) || Math.max(...good.map((c) => Number(c.endSec) || 0));
          const book = await sql.query<{ file_url: string }>("select file_url from bible_audio_books where id = $1", [bookId]);
          const { keepOnAir } = await import("@/lib/porch/fm");
          await keepOnAir(sql, async () => {
            await sql.query("delete from bible_audio_chapters where book_id = $1", [bookId]);
            for (const c of good) {
              await sql.query(
                "insert into bible_audio_chapters (book_id, chapter, url, start_sec, end_sec, duration_sec, approved) values ($1, $2, $3, $4, $5, $6, true)",
                [bookId, Number(c.chapter), String(c.url), Number(c.startSec) || 0, Number(c.endSec) || 0, Number(c.durationSec)],
              );
            }
            await sql.query("update bible_audio_books set status = 'ready', error = '', job_token = null, duration_sec = $2, file_url = '' where id = $1", [bookId, total]);
          });
          const plan = await import("@/lib/porch/bible-radio.server");
          await plan.clearComingReadings(sql);
          await plan.ensureReadings(sql, true);
          // The whole-book upload isn't needed any more: its pieces are kept instead (saves storage).
          if (book[0]?.file_url) {
            await (await import("@/lib/porch/audio-store.server")).storeDelete(sql, [book[0].file_url]);
          }
          return Response.json({ ok: true });
        }
        if (body.action === "moved") {
          const pieces = Array.isArray(body.pieces) ? (body.pieces as Record<string, unknown>[]) : [];
          const ours = await (await import("@/lib/porch/audio-store.server")).storeUrlChecker(sql);
          const good = pieces.filter((c) => ours(c.url, "bible/") && Number(c.durationSec) > 1);
          if (good.length !== 2) return Response.json({ error: "bad result" }, { status: 400 });
          const old = await sql.query<{ chapter: number; url: string; start_sec: number }>(
            "select chapter, url, start_sec from bible_audio_chapters where book_id = $1 and chapter = any($2::int[]) order by chapter",
            [bookId, good.map((c) => Number(c.chapter))],
          );
          const firstStart = Number(old[0]?.start_sec ?? 0);
          const { keepOnAir } = await import("@/lib/porch/fm");
          await keepOnAir(sql, async () => {
            for (const c of good) {
              const start = firstStart + Number(c.offsetSec || 0);
              await sql.query("update bible_audio_chapters set url = $3, duration_sec = $4, start_sec = $5, end_sec = $5 + $4 where book_id = $1 and chapter = $2", [
                bookId,
                Number(c.chapter),
                String(c.url),
                Number(c.durationSec),
                start,
              ]);
            }
            await sql.query("update bible_audio_books set status = 'ready', error = '', job_token = null where id = $1", [bookId]);
          });
          const plan = await import("@/lib/porch/bible-radio.server");
          await plan.clearComingReadings(sql);
          await plan.ensureReadings(sql, true);
          await (await import("@/lib/porch/audio-store.server")).storeDelete(sql, old.map((o) => o.url));
          return Response.json({ ok: true });
        }
        if (body.action === "failed") {
          await sql.query("update bible_audio_books set status = 'failed', error = $2, job_token = null where id = $1", [bookId, String(body.error ?? "Cutting failed.").slice(0, 300)]);
          return Response.json({ ok: true });
        }
        return Response.json({ error: "unknown action" }, { status: 400 });
      },
    },
  },
});
