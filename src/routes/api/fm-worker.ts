import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { jobFor } from "@/lib/porch/fm-process.server";
import { applyMixes, cleanLoud, mixJobFor, trashLater } from "@/lib/porch/fm-mixer.server";

const MIX_MODES = new Set(["measure", "master", "preview"]);

/**
 * The audio worker reports here. Every message carries the job's one-off
 * token, which must match what Porchbook gave it for that track.
 *  - token: get a one-off pass to upload the processed audio
 *  - done:  swap the track over to the processed audio
 *  - failed: note why (the Studio can retry)
 */
export const Route = createFileRoute("/api/fm-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ error: "bad json" }, { status: 400 });
        }
        const trackId = Number(body.trackId);
        const token = typeof body.jobToken === "string" ? body.jobToken : "";
        const sql = await getSql();
        const mode = typeof body.mode === "string" ? body.mode : "";
        if (MIX_MODES.has(mode)) return mixMessage(sql, body, trackId, token, mode);
        const job = Number.isInteger(trackId) ? await jobFor(sql, trackId, token) : null;
        if (!job) return Response.json({ error: "unknown job" }, { status: 403 });

        if (body.action === "token") {
          const { uploadSpot } = await import("@/lib/porch/audio-store.server");
          try {
            return Response.json(await uploadSpot(sql, `fm/processed/${trackId}-${Date.now()}.mp3`, { contentTypes: ["audio/mpeg"], maxBytes: 300 * 1024 * 1024 }));
          } catch {
            return Response.json({ error: "audio storage isn't connected" }, { status: 503 });
          }
        }

        if (body.action === "done") {
          const url = typeof body.url === "string" ? body.url : "";
          const durationSec = Number(body.durationSec);
          const { isStoreUrl } = await import("@/lib/porch/audio-store.server");
          if (!(await isStoreUrl(sql, url, "fm/processed/")) || !(durationSec > 0.5)) {
            return Response.json({ error: "bad result" }, { status: 400 });
          }
          const { keepOnAir } = await import("@/lib/porch/fm");
          await keepOnAir(sql, () =>
            sql.query(
              `update fm_tracks set url = $2, duration_sec = $3, play_sec = null, processed_at = now(),
                    process_token = null, process_error = null where id = $1`,
              [trackId, url, durationSec],
            ),
          );
          // With "Auto-master uploads" on, a video's sound is mastered once it's been taken out.
          try {
            const { readMixer, requestMix, workerState } = await import("@/lib/porch/fm-mixer.server");
            const mixer = await readMixer(sql);
            if (mixer.auto && (await workerState()).state !== "old") await requestMix(sql, trackId, "master", mixer.settings);
          } catch {
            /* it can be mastered from the Control Room */
          }
          // Remove the original upload.
          const old = job.url;
          const fallback = old.match(/^\/api\/fm-file\?id=(\d+)$/);
          if (fallback) await sql.query("delete from fm_files where id = $1", [Number(fallback[1])]);
          else if (old && old !== url) {
            const { storeDelete } = await import("@/lib/porch/audio-store.server");
            await storeDelete(sql, [old]);
          }
          return Response.json({ ok: true });
        }

        if (body.action === "failed") {
          const error = typeof body.error === "string" ? body.error.slice(0, 300) : "failed";
          await sql.query("update fm_tracks set process_error = $2, process_token = null where id = $1", [trackId, error]);
          return Response.json({ ok: true });
        }
        return Response.json({ error: "unknown action" }, { status: 400 });
      },
    },
  },
});

type Sql = Awaited<ReturnType<typeof getSql>>;

/** Messages about the mixer's jobs: measure, master, before/after samples. */
async function mixMessage(sql: Sql, body: Record<string, unknown>, trackId: number, token: string, mode: string) {
  const job = Number.isInteger(trackId) ? await mixJobFor(sql, trackId, token, mode) : null;
  if (!job) return Response.json({ error: "unknown job" }, { status: 403 });

  if (body.action === "token") {
    if (mode === "measure") return Response.json({ error: "audio storage isn't connected" }, { status: 503 });
    const which = body.which === "before" ? "before" : body.which === "after" ? "after" : "master";
    if ((mode === "preview") !== (which !== "master")) return Response.json({ error: "bad request" }, { status: 400 });
    const pathname = mode === "preview" ? `fm/preview/${trackId}-${which}-${Date.now()}.mp3` : `fm/mastered/${trackId}-${Date.now()}.mp3`;
    const { uploadSpot } = await import("@/lib/porch/audio-store.server");
    try {
      return Response.json(await uploadSpot(sql, pathname, { contentTypes: ["audio/mpeg"], maxBytes: 300 * 1024 * 1024 }));
    } catch {
      return Response.json({ error: "audio storage isn't connected" }, { status: 503 });
    }
  }

  const ours = await (await import("@/lib/porch/audio-store.server")).storeUrlChecker(sql);
  const blob = (v: unknown, folder: string) => (typeof v === "string" && ours(v, `fm/${folder}/`) ? v : "");

  if (body.action === "measured" && mode === "measure") {
    await sql.query("update fm_tracks set loud_before = $2, mix_token = null, mix_error = null where id = $1", [trackId, JSON.stringify(cleanLoud(body.before))]);
    return Response.json({ ok: true });
  }

  if (body.action === "previewed" && mode === "preview") {
    const before = blob(body.beforeUrl, "preview");
    const after = blob(body.afterUrl, "preview");
    if (!before || !after) return Response.json({ error: "bad result" }, { status: 400 });
    // The last sample of this item is replaced, so remove the old files.
    const old = await sql.query<{ before_url: string | null; after_url: string | null }>("select before_url, after_url from fm_previews where track_id = $1", [trackId]);
    await sql.query("update fm_previews set before_url = $2, after_url = $3, token = '' where track_id = $1", [trackId, before, after]);
    const gone = [old[0]?.before_url, old[0]?.after_url].filter((u): u is string => Boolean(u));
    if (gone.length) await (await import("@/lib/porch/audio-store.server")).storeDelete(sql, gone);
    return Response.json({ ok: true });
  }

  if (body.action === "done" && mode === "master" && "url" in job) {
    const url = blob(body.url, "mastered");
    const durationSec = Number(body.durationSec);
    if (!url || !(durationSec > 0.5)) return Response.json({ error: "bad result" }, { status: 400 });
    // Keep the original for undo; the mastered copy goes in when the item isn't on air.
    const before = await sql.query<{ pending_url: string | null }>("select pending_url from fm_tracks where id = $1", [trackId]);
    await sql.query(
      `update fm_tracks set original_url = coalesce(original_url, url), pending_url = $2, pending_duration = $3,
              loud_before = $4, loud_after = $5, mastered_at = now(), mix_token = null, mix_error = null where id = $1`,
      [trackId, url, durationSec, JSON.stringify(cleanLoud(body.before)), JSON.stringify(cleanLoud(body.after))],
    );
    // A mastered copy that never went on air (a quicker re-master overtook it).
    if (before[0]?.pending_url && before[0].pending_url !== job.originalUrl) await trashLater(sql, before[0].pending_url);
    await applyMixes(sql, true);
    return Response.json({ ok: true });
  }

  if (body.action === "failed") {
    const error = typeof body.error === "string" ? body.error.slice(0, 300) : "failed";
    if (mode === "preview") await sql.query("update fm_previews set error = $2, token = '' where track_id = $1", [trackId, error]);
    else await sql.query("update fm_tracks set mix_error = $2, mix_token = null where id = $1", [trackId, error]);
    return Response.json({ ok: true });
  }
  return Response.json({ error: "unknown action" }, { status: 400 });
}
