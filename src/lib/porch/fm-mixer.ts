import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { canRunStudio } from "@/lib/porch/fm";
import type { Loud, MixSettings } from "@/lib/porch/fm-mix-settings";

/**
 * Porchbook Radio's mixer, for the Control Room: settings, measuring, mastering,
 * before/after samples and undo. The sound work runs on the audio worker in the
 * background; nothing on air is interrupted.
 */

export type MixTrack = {
  id: number;
  title: string;
  kind: string;
  before: Loud | null;
  after: Loud | null;
  mastered: boolean;
  /** waiting to go in (the item is on air or about to be) */
  swapping: boolean;
  job: "" | "measure" | "master";
  error: string;
  video: boolean;
};

function rec(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}
const ids = (v: unknown) => (v === "all" ? ("all" as const) : Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500) : []);
const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

async function readTracks(sql: Awaited<ReturnType<typeof getSql>>): Promise<MixTrack[]> {
  const { cleanLoud } = await import("@/lib/porch/fm-mixer.server");
  const { isVideoFile } = await import("@/lib/porch/fm-schedule");
  const rows = await sql.query<{
    id: number; title: string; kind: string; url: string; loud_before: unknown; loud_after: unknown; mastered_at: string | null;
    original_url: string | null; pending_url: string | null; mix_job: string | null; mix_token: string | null; mix_error: string | null;
  }>(
    `select id, title, kind, url, loud_before, loud_after, mastered_at, original_url, pending_url, mix_job, mix_token, mix_error
       from fm_tracks order by created_at asc, id asc`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    title: r.title,
    kind: r.kind,
    before: cleanLoud(parse(r.loud_before)),
    after: r.original_url || r.pending_url ? cleanLoud(parse(r.loud_after)) : null,
    mastered: Boolean(r.original_url) && r.pending_url !== r.original_url,
    swapping: Boolean(r.pending_url),
    job: r.mix_token ? ((r.mix_job === "measure" ? "measure" : "master") as "measure" | "master") : "",
    error: r.mix_error ?? "",
    video: isVideoFile(r.url),
  }));
}

/** Everything the Control Room needs about the mixer. Also re-sends jobs the worker lost. */
export const getMixer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, error: "Only the studio can use the mixer." };
    const { readMixer, workerState, applyMixes, requestMix } = await import("@/lib/porch/fm-mixer.server");
    await applyMixes(sql);
    const mixer = await readMixer(sql);
    const worker = await workerState();
    // Jobs that went quiet (the free server slept or restarted): send them again.
    if (worker.state === "ready") {
      const stale = await sql.query<{ id: number; mix_job: string }>(
        "select id, mix_job from fm_tracks where mix_token is not null and mix_started_at < now() - interval '25 minutes' limit 30",
      );
      for (const s of stale) {
        const id = Number(s.id);
        if (worker.working === id || worker.queued.includes(id)) continue;
        await requestMix(sql, id, s.mix_job === "measure" ? "measure" : "master", mixer.settings).catch(() => false);
      }
    }
    const tracks = await readTracks(sql);
    const inBatch = await sql.query<{ total: number; left: number; failed: number }>(
      `select count(*)::int as total, count(*) filter (where mix_token is not null)::int as left,
              count(*) filter (where mix_error is not null and mix_token is null)::int as failed
         from fm_tracks where mix_batch = $1`,
      [mixer.batch],
    );
    const b = inBatch[0];
    return {
      ok: true as const,
      settings: mixer.settings,
      auto: mixer.auto,
      worker: worker.state,
      tracks,
      batch: b && Number(b.total) > 0 ? { mode: mixer.batchMode || "master", total: Number(b.total), done: Number(b.total) - Number(b.left), failed: Number(b.failed) } : null,
    };
  });

/** Save the mixer's settings and the auto-master switch; optionally re-master everything to them. */
export const saveMixer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    return { settings: raw.settings, auto: typeof raw.auto === "boolean" ? raw.auto : null, remaster: raw.remaster === true };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, error: "Only the studio can change the mixer." };
    const { readMixer, cleanMix, startBatch } = await import("@/lib/porch/fm-mixer.server");
    const now = await readMixer(sql);
    const settings: MixSettings = data.settings ? cleanMix(data.settings, now.settings) : now.settings;
    await sql.query("update fm_mixer set settings = $1, auto = $2, updated_at = now() where id = 1", [JSON.stringify(settings), data.auto ?? now.auto]);
    let sent = 0;
    if (data.remaster) {
      const { workerState } = await import("@/lib/porch/fm-mixer.server");
      if ((await workerState()).state === "old") return { ok: false as const, error: "Settings saved, but the audio server needs updating before it can re-master." };
      const all = (await readTracks(sql)).filter((t) => !t.video).map((t) => t.id);
      sent = await startBatch(sql, all, "master", settings);
    }
    return { ok: true as const, settings, sent };
  });

/** Measure or master some items (or all of them), in the background. */
export const mixTracks = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    return { mode: raw.mode === "measure" ? ("measure" as const) : ("master" as const), ids: ids(raw.ids), settings: raw.settings };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, error: "Only the studio can use the mixer." };
    const { readMixer, cleanMix, startBatch, workerState } = await import("@/lib/porch/fm-mixer.server");
    const worker = await workerState();
    if (worker.state === "old") return { ok: false as const, error: "The audio server needs updating first." };
    const mixer = await readMixer(sql);
    const settings = data.settings ? cleanMix(data.settings, mixer.settings) : mixer.settings;
    const usable = (await readTracks(sql)).filter((t) => !t.video).map((t) => t.id);
    const list = data.ids === "all" ? usable : data.ids.filter((id) => usable.includes(id));
    if (!list.length) return { ok: false as const, error: "No items to work on." };
    const sent = await startBatch(sql, list, data.mode, settings);
    return { ok: true as const, sent, waking: worker.state === "asleep" };
  });

/** Put the original sound back (undo mastering). */
export const undoMix = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ ids: ids(rec(input).ids) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, error: "Only the studio can use the mixer." };
    const { applyMixes, trashLater } = await import("@/lib/porch/fm-mixer.server");
    const rows = await sql.query<{ id: number; pending_url: string | null; original_url: string }>(
      data.ids === "all"
        ? "select id, pending_url, original_url from fm_tracks where original_url is not null"
        : "select id, pending_url, original_url from fm_tracks where original_url is not null and id = any($1::int[])",
      data.ids === "all" ? [] : [data.ids],
    );
    for (const r of rows) {
      if (r.pending_url && r.pending_url !== r.original_url) await trashLater(sql, r.pending_url);
      await sql.query("update fm_tracks set pending_url = original_url, pending_duration = null, loud_after = null, mastered_at = null, mix_token = null where id = $1", [r.id]);
    }
    await applyMixes(sql, true);
    return { ok: true as const, count: rows.length };
  });

/** Ask for a 20-second before/after sample of one item at the current (or given) settings. */
export const previewMix = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    return { id: Number(raw.id) || 0, settings: raw.settings };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, error: "Only the studio can use the mixer." };
    const { readMixer, cleanMix, requestPreview, workerState } = await import("@/lib/porch/fm-mixer.server");
    const worker = await workerState();
    if (worker.state === "old") return { ok: false as const, error: "The audio server needs updating first." };
    const row = await sql.query<{ duration_sec: number }>("select duration_sec from fm_tracks where id = $1", [data.id]);
    if (!row[0]) return { ok: false as const, error: "That item isn't in the library." };
    const length = Number(row[0].duration_sec);
    // A spot well inside the item (past any intro), leaving room for 20 seconds.
    const atSec = Math.max(0, Math.min(length * 0.35, length - 20));
    const mixer = await readMixer(sql);
    const ok = await requestPreview(sql, data.id, data.settings ? cleanMix(data.settings, mixer.settings) : mixer.settings, Math.round(atSec));
    return ok ? { ok: true as const, waking: worker.state === "asleep" } : { ok: false as const, error: "That item can't be sampled." };
  });

export const getMixPreview = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: Number(rec(input).id) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, error: "Only the studio can use the mixer." };
    const rows = await sql.query<{ before_url: string | null; after_url: string | null; error: string | null }>(
      "select before_url, after_url, error from fm_previews where track_id = $1",
      [data.id],
    );
    const r = rows[0];
    return { ok: true as const, before: r?.before_url ?? "", after: r?.after_url ?? "", error: r?.error ?? "" };
  });
