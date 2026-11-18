import { randomBytes } from "node:crypto";
import type { Sql } from "@/lib/db";

import { videoWorkerBase } from "@/lib/porch/audio-worker.server";

function siteOrigin() {
  return (process.env.BETTER_AUTH_URL || "https://porchbook.vercel.app").replace(/\/+$/, "");
}

/**
 * Ask the worker to even out a track's loudness and re-save it in the standard
 * format. Fire-and-forget: the worker reports back to /api/fm-worker.
 * A job is re-sent if it hasn't finished after 20 minutes (the free server may
 * have been asleep or restarted).
 */
export async function requestProcessing(sql: Sql, trackId: number) {
  const rows = await sql.query<{ url: string; kind: string; processed_at: string | null; stale: boolean; process_token: string | null }>(
    `select url, kind, processed_at, process_token,
            (process_started_at is null or process_started_at < now() - interval '20 minutes') as stale
       from fm_tracks where id = $1`,
    [trackId],
  );
  const row = rows[0];
  if (!row || row.processed_at || !(row.stale === true || String(row.stale) === "t" || String(row.stale) === "true")) return false;
  // Keep the same job token when re-sending, so a job the worker already has
  // (still queued or half done) is still recognised when it reports back.
  const token = row.process_token || randomBytes(24).toString("hex");
  await sql.query("update fm_tracks set process_token = $2, process_started_at = now(), process_error = null where id = $1", [trackId, token]);
  const sourceUrl = row.url.startsWith("/") ? `${siteOrigin()}${row.url}` : row.url;
  try {
    await fetch(`${await videoWorkerBase()}/fm/process`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobToken: token, trackId, sourceUrl, kind: row.kind }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* the worker may be waking up; the request usually still lands, and the Studio retries later */
  }
  return true;
}

/** Find the job a worker message belongs to (its one-off token must match and be fresh). */
export async function jobFor(sql: Sql, trackId: number, token: string) {
  if (!token || token.length < 20) return null;
  const rows = await sql.query<{ url: string; kind: string }>(
    `select url, kind from fm_tracks
      where id = $1 and process_token = $2 and process_started_at > now() - interval '6 hours'`,
    [trackId, token],
  );
  return rows[0] ?? null;
}
