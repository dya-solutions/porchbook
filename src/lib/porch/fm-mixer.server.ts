import { randomBytes } from "node:crypto";
import type { Sql } from "@/lib/db";
import { isVideoFile, onAirAt } from "@/lib/porch/fm-schedule";
import { audioWorkerBase } from "@/lib/porch/audio-worker.server";

/**
 * Porchbook Radio's mixer (server side). The audio worker (Porchbook Audio, its own server) does the
 * sound work; this file sends it jobs, keeps the originals for undo, and swaps a mastered
 * copy in only while that item isn't on air (or about to be), so no listener hears a jump.
 */

export type MixMode = "measure" | "master";
export { DEFAULT_MIX, cleanMix, cleanLoud, type MixSettings, type Loud } from "@/lib/porch/fm-mix-settings";
import { cleanMix, type MixSettings } from "@/lib/porch/fm-mix-settings";

function workerBase() {
  return audioWorkerBase();
}
function siteOrigin() {
  return (process.env.BETTER_AUTH_URL || "https://porchbook.vercel.app").replace(/\/+$/, "");
}

export async function readMixer(sql: Sql) {
  const rows = await sql
    .query<{ settings: unknown; auto: unknown; batch: number; batch_mode: string | null }>("select settings, auto, batch, batch_mode from fm_mixer where id = 1")
    .catch(() => []);
  const r = rows[0];
  const settings = typeof r?.settings === "string" ? JSON.parse(r.settings) : r?.settings;
  return { settings: cleanMix(settings), auto: r?.auto === true || String(r?.auto) === "t" || String(r?.auto) === "true", batch: Number(r?.batch ?? 0), batchMode: (r?.batch_mode ?? "") as MixMode | "" };
}

/** What the worker is doing: "ready" (has the mixer), "old" (needs updating), "asleep" (didn't answer: asleep, or not set up yet). */
export async function workerState(): Promise<{ state: "ready" | "old" | "asleep"; working: number; queued: number[] }> {
  try {
    const res = await fetch(`${workerBase()}/fm/status`, { signal: AbortSignal.timeout(6000) });
    const s = (await res.json()) as { mixer?: number; working?: number; queued?: number[] };
    return { state: s.mixer ? "ready" : "old", working: Number(s.working ?? 0), queued: Array.isArray(s.queued) ? s.queued.map(Number) : [] };
  } catch {
    return { state: "asleep", working: 0, queued: [] };
  }
}

async function send(body: Record<string, unknown>) {
  try {
    await fetch(`${workerBase()}/fm/process`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* the worker may be waking up; the request usually still lands, and the Control Room re-sends stale jobs */
  }
}
const absolute = (url: string) => (url.startsWith("/") ? `${siteOrigin()}${url}` : url);

/** Start a measure or master job for one item (always from its original sound). */
export async function requestMix(sql: Sql, trackId: number, mode: MixMode, settings: MixSettings, batch?: number) {
  const rows = await sql.query<{ url: string; original_url: string | null; kind: string; mix_token: string | null }>(
    "select url, original_url, kind, mix_token from fm_tracks where id = $1",
    [trackId],
  );
  const row = rows[0];
  if (!row || isVideoFile(row.url)) return false;
  const token = randomBytes(24).toString("hex");
  await sql.query(
    `update fm_tracks set mix_token = $2, mix_job = $3, mix_started_at = now(), mix_error = null${batch !== undefined ? ", mix_batch = $4" : ""} where id = $1`,
    batch !== undefined ? [trackId, token, mode, batch] : [trackId, token, mode],
  );
  await send({ jobToken: token, trackId, sourceUrl: absolute(row.original_url || row.url), kind: row.kind, mode, settings });
  return true;
}

/** A 20-second before/after sample of one item. */
export async function requestPreview(sql: Sql, trackId: number, settings: MixSettings, atSec: number) {
  const rows = await sql.query<{ url: string; original_url: string | null; kind: string }>("select url, original_url, kind from fm_tracks where id = $1", [trackId]);
  const row = rows[0];
  if (!row || isVideoFile(row.url)) return false;
  const token = randomBytes(24).toString("hex");
  await sql.query(
    `insert into fm_previews (track_id, token, at_sec, before_url, after_url, error, started_at) values ($1, $2, $3, null, null, null, now())
     on conflict (track_id) do update set token = $2, at_sec = $3, before_url = null, after_url = null, error = null, started_at = now()`,
    [trackId, token, atSec],
  );
  await send({ jobToken: token, trackId, sourceUrl: absolute(row.original_url || row.url), kind: row.kind, mode: "preview", settings, atSec });
  return true;
}

/** Start a new batch (for the "x of y done" card) and send its jobs. */
export async function startBatch(sql: Sql, ids: number[], mode: MixMode, settings: MixSettings) {
  const b = await sql.query<{ batch: number }>("update fm_mixer set batch = batch + 1, batch_mode = $1, updated_at = now() where id = 1 returning batch", [mode]);
  const batch = Number(b[0]?.batch ?? 1);
  let sent = 0;
  // A few at a time, so a long list doesn't hold the request open.
  for (let i = 0; i < ids.length; i += 6) {
    const done = await Promise.all(ids.slice(i, i + 6).map((id) => requestMix(sql, id, mode, settings, batch).catch(() => false)));
    sent += done.filter(Boolean).length;
  }
  return sent;
}

/** Which job a worker message belongs to (its one-off token must match and be fresh). */
export async function mixJobFor(sql: Sql, trackId: number, token: string, mode: string) {
  if (!token || token.length < 20) return null;
  if (mode === "preview") {
    const rows = await sql.query<{ track_id: number }>("select track_id from fm_previews where track_id = $1 and token = $2 and started_at > now() - interval '3 hours'", [trackId, token]);
    return rows[0] ? { mode: "preview" as const } : null;
  }
  const rows = await sql.query<{ url: string; original_url: string | null; mix_job: string }>(
    "select url, original_url, mix_job from fm_tracks where id = $1 and mix_token = $2 and mix_job = $3 and mix_started_at > now() - interval '12 hours'",
    [trackId, token, mode],
  );
  return rows[0] ? { mode: mode as MixMode, url: rows[0].url, originalUrl: rows[0].original_url } : null;
}

/** A file to remove later (a listener's phone may still be playing it for a while). */
export async function trashLater(sql: Sql, url: string | null | undefined) {
  if (!url || !(await (await import("@/lib/porch/audio-store.server")).isStoreUrl(sql, url, "fm/mastered/"))) return;
  await sql.query("insert into fm_trash (url, delete_after) values ($1, now() + interval '1 day') on conflict (url) do nothing", [url]).catch(() => undefined);
}
async function emptyTrash(sql: Sql) {
  const due = await sql.query<{ url: string }>("select url from fm_trash where delete_after < now() limit 20").catch(() => []);
  if (!due.length) return;
  await (await import("@/lib/porch/audio-store.server")).storeDelete(sql, due.map((d) => d.url));
  await sql.query("delete from fm_trash where url = any($1::text[])", [due.map((d) => d.url)]).catch(() => undefined);
}

let lastApply = 0;
/**
 * Swap in mastered copies (or originals, after an undo) for items that aren't on air
 * and don't start within the next 90 seconds. The schedule stays exactly the same:
 * mastering doesn't change an item's length, so its stored length is kept.
 */
export async function applyMixes(sql: Sql, force = false) {
  if (!force && Date.now() - lastApply < 15000) return;
  lastApply = Date.now();
  try {
    const waiting = await sql.query<{ id: number; url: string; original_url: string | null; pending_url: string; pending_duration: number | null; duration_sec: number }>(
      "select id, url, original_url, pending_url, pending_duration, duration_sec from fm_tracks where pending_url is not null",
    );
    if (waiting.length) {
      const { readStation, readBreaks, keepOnAir } = await import("@/lib/porch/fm");
      const station = await readStation(sql);
      const breaks = await readBreaks(sql);
      const nowMs = Date.now();
      const busy = new Set<number>();
      for (const at of [0, 30000, 60000, 90000]) {
        const on = onAirAt([...station.tracks, ...station.nuggets], station.programmes, nowMs + at, breaks);
        if (on) busy.add(on.track.id);
      }
      for (const row of waiting) {
        const id = Number(row.id);
        if (busy.has(id)) continue;
        const backToOriginal = row.original_url && row.pending_url === row.original_url;
        const newLength = Number(row.pending_duration ?? 0);
        const sameLength = !(newLength > 0.5) || Math.abs(newLength - Number(row.duration_sec)) <= 1.5;
        const clearOriginal = backToOriginal ? ", original_url = null" : "";
        if (sameLength) {
          await sql.query(`update fm_tracks set url = pending_url, pending_url = null, pending_duration = null${clearOriginal} where id = $1 and pending_url = $2`, [id, row.pending_url]);
        } else {
          // A different length moves the timeline: let what's on air finish first.
          await keepOnAir(sql, () =>
            sql.query(`update fm_tracks set url = pending_url, duration_sec = $3, pending_url = null, pending_duration = null${clearOriginal} where id = $1 and pending_url = $2`, [id, row.pending_url, newLength]),
          );
        }
        if (row.url !== row.original_url && row.url !== row.pending_url) await trashLater(sql, row.url);
      }
    }
    await emptyTrash(sql);
  } catch {
    /* tried again on the next station read */
  }
}
