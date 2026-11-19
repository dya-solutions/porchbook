import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

/**
 * Nuggets: short clips of selected speakers, played between Radio items as station breaks.
 * The Studio finds them (the AI suggests from transcripts; the founder approves, edits or adds by hand);
 * listeners can save a nugget and share a link to it.
 */
const rec = (input: unknown): Record<string, unknown> => (input && typeof input === "object" ? (input as Record<string, unknown>) : {});
const bool = (v: unknown) => v === true || v === 1 || v === "1" || v === "t" || v === "true";
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

async function studio(sql: Sql, userId: string) {
  const { canRunStudio } = await import("@/lib/porch/fm");
  return canRunStudio(sql, userId);
}

export type NuggetSpeaker = { id: number; name: string; feedUrl: string; youtube: string; permission: string; onAir: boolean };
export type NuggetSource = { id: number; speakerId: number; title: string; audioUrl: string; publishedAt: string; durationSec: number; status: string; error: string; found: number };
export type Nugget = {
  id: number;
  sourceId: number;
  speakerId: number;
  speaker: string;
  episode: string;
  audioUrl: string;
  title: string;
  tags: string[];
  startSec: number;
  endSec: number;
  status: string;
  madeBy: string;
  why: string;
  url: string;
  durationSec: number;
  cutError: string;
  cutting: boolean;
  saves: number;
  inBreaks: boolean;
};

const NUGGET_SELECT = `
  select n.id, n.source_id, n.speaker_id, p.name as speaker, coalesce(s.title, '') as episode, coalesce(s.audio_url, '') as audio_url,
         n.title, n.tags, n.start_sec, n.end_sec, n.status, n.made_by, n.why, n.url, n.duration_sec, n.cut_error,
         (n.job_token is not null and n.url = '' and n.cut_error = '' and n.job_started_at > now() - interval '20 minutes') as cutting,
         (select count(*)::int from nugget_favourites f where f.nugget_id = n.id) as saves, n.in_breaks
    from nuggets n join nugget_speakers p on p.id = n.speaker_id left join nugget_sources s on s.id = n.source_id`;
type NuggetRow = {
  id: number; source_id: number | null; speaker_id: number; speaker: string; episode: string; audio_url: string; title: string; tags: string[];
  start_sec: number; end_sec: number; status: string; made_by: string; why: string; url: string; duration_sec: number; cut_error: string; cutting: unknown; saves: number;
  in_breaks: unknown;
};
const toNugget = (r: NuggetRow): Nugget => ({
  id: Number(r.id),
  sourceId: Number(r.source_id ?? 0),
  speakerId: Number(r.speaker_id),
  speaker: r.speaker,
  episode: r.episode,
  audioUrl: r.audio_url,
  title: r.title,
  tags: r.tags ?? [],
  startSec: Number(r.start_sec),
  endSec: Number(r.end_sec),
  status: r.status,
  madeBy: r.made_by,
  why: r.why,
  url: r.url,
  durationSec: Number(r.duration_sec),
  cutError: r.cut_error,
  cutting: bool(r.cutting),
  saves: Number(r.saves ?? 0),
  inBreaks: r.in_breaks === undefined ? true : bool(r.in_breaks),
});

// ---- Studio ------------------------------------------------------------------

/** Everything the Studio's Nuggets tab shows. */
export const nuggetDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { ok: false as const };
    const speakers = await sql.query<{ id: number; name: string; feed_url: string; youtube: string; permission: string; on_air: unknown }>(
      "select id, name, feed_url, youtube, permission, on_air from nugget_speakers order by id asc",
    );
    const sources = await sql.query<{ id: number; speaker_id: number; title: string; audio_url: string; published_at: string | null; duration_sec: number; status: string; error: string; found: number }>(
      `select s.id, s.speaker_id, s.title, s.audio_url, to_char(s.published_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as published_at,
              s.duration_sec, s.status, s.error, (select count(*)::int from nuggets n where n.source_id = s.id) as found
         from nugget_sources s order by s.published_at desc nulls last, s.id desc limit 30`,
    );
    const nuggets = await sql.query<NuggetRow>(`${NUGGET_SELECT} where n.status <> 'dropped' order by n.status desc, n.created_at desc limit 200`);
    const set = await sql.query<{ breaks_on: unknown; every_items: number }>("select breaks_on, every_items from nugget_settings where id = 1");
    const flag = await sql.query<{ enabled: unknown }>(/* On hold: Phaneroo's switch only. Must become per church before switching on (decision 8). */ "select enabled from app_flags where key = 'nuggets' and porch_id = 1");
    const keyRow = await sql.query<{ groq_key: string }>("select groq_key from nugget_settings where id = 1").catch(() => []);
    return {
      ok: true as const,
      speakers: speakers.map((r): NuggetSpeaker => ({ id: Number(r.id), name: r.name, feedUrl: r.feed_url, youtube: r.youtube, permission: r.permission, onAir: bool(r.on_air) })),
      sources: sources.map((r): NuggetSource => ({
        id: Number(r.id), speakerId: Number(r.speaker_id), title: r.title, audioUrl: r.audio_url, publishedAt: r.published_at ?? "", durationSec: Number(r.duration_sec), status: r.status, error: r.error, found: Number(r.found),
      })),
      nuggets: nuggets.map(toNugget),
      settings: { breaksOn: bool(set[0]?.breaks_on ?? true), every: Number(set[0]?.every_items ?? 3), live: bool(flag[0]?.enabled) },
      canTranscribe: Boolean(keyRow[0]?.groq_key),
    };
  });

/** Add or change a speaker. */
export const saveNuggetSpeaker = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const r = rec(input);
    return { id: num(r.id), name: str(r.name, 80), feedUrl: str(r.feedUrl, 500), youtube: str(r.youtube, 300), permission: str(r.permission, 500), onAir: r.onAir !== false };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { ok: false as const, error: "Only the Studio can do this." };
    if (!data.name) return { ok: false as const, error: "Give the speaker's name." };
    if (data.feedUrl && !/^https:\/\//i.test(data.feedUrl)) return { ok: false as const, error: "The podcast feed must be an https link." };
    if (data.id) {
      const { keepOnAir } = await import("@/lib/porch/fm");
      await keepOnAir(sql, () =>
        sql.query("update nugget_speakers set name = $2, feed_url = $3, youtube = $4, permission = $5, on_air = $6 where id = $1", [
          data.id, data.name, data.feedUrl, data.youtube, data.permission, data.onAir,
        ]),
      );
    } else {
      await sql.query("insert into nugget_speakers (name, feed_url, youtube, permission, on_air) values ($1, $2, $3, $4, $5)", [data.name, data.feedUrl, data.youtube, data.permission, data.onAir]);
    }
    return { ok: true as const };
  });

/** Fetch a speaker's newest podcast episodes. */
export const refreshNuggetFeed = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ speakerId: num(rec(input).speakerId) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { ok: false as const, error: "Only the Studio can do this." };
    const rows = await sql.query<{ feed_url: string }>("select feed_url from nugget_speakers where id = $1", [data.speakerId]);
    if (!rows[0]?.feed_url) return { ok: false as const, error: "This speaker has no podcast feed." };
    try {
      const { readFeed } = await import("@/lib/porch/nuggets.server");
      const added = await readFeed(sql, data.speakerId, rows[0].feed_url);
      return { ok: true as const, added };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Couldn't read the podcast." };
    }
  });

/** Find the strongest moments in an episode: its transcript first (the podcast's own, or made by ElevenLabs), then the AI's picks. */
export const findNuggetMoments = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ sourceId: num(rec(input).sourceId) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { ok: false as const, error: "Only the Studio can do this." };
    const rows = await sql.query<{ audio_url: string; transcript_url: string; has: unknown }>(
      "select audio_url, transcript_url, (transcript is not null) as has from nugget_sources where id = $1",
      [data.sourceId],
    );
    const row = rows[0];
    if (!row) return { ok: false as const, error: "That episode is gone." };
    const server = await import("@/lib/porch/nuggets.server");
    try {
      if (!bool(row.has) && row.transcript_url) {
        const segs = await server.fetchTranscript(row.transcript_url);
        if (segs.length) await sql.query("update nugget_sources set transcript = $2, status = 'ready' where id = $1", [data.sourceId, JSON.stringify(segs)]);
      }
      const again = await sql.query<{ has: unknown }>("select (transcript is not null) as has from nugget_sources where id = $1", [data.sourceId]);
      if (bool(again[0]?.has)) {
        const found = await server.suggestMoments(sql, data.sourceId);
        return { ok: true as const, found, waiting: false };
      }
      const keyRow = await sql.query<{ groq_key: string }>("select groq_key from nugget_settings where id = 1").catch(() => []);
      const key = keyRow[0]?.groq_key ?? "";
      if (!key) return { ok: false as const, error: "Paste your Groq key first (Speakers tab), so the sermon can be turned into text." };
      await server.requestTranscript(sql, data.sourceId, row.audio_url, key);
      return { ok: true as const, found: 0, waiting: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn't find moments.";
      await sql.query("update nugget_sources set status = 'failed', error = $2 where id = $1", [data.sourceId, message.slice(0, 300)]);
      return { ok: false as const, error: message };
    }
  });

/** Change a nugget (title, tags, times), approve it (it is then cut), or drop it. */
export const saveNugget = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const r = rec(input);
    const tags = Array.isArray(r.tags) ? r.tags.map((t) => String(t).toLowerCase().replace(/^#/, "").replace(/[^a-z0-9 -]/g, "").trim()).filter(Boolean).slice(0, 5) : [];
    const status = r.status === "approved" || r.status === "dropped" || r.status === "suggested" ? r.status : "";
    return { id: num(r.id), title: str(r.title, 80), tags, startSec: num(r.startSec), endSec: num(r.endSec), status };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { ok: false as const, error: "Only the Studio can do this." };
    const rows = await sql.query<{ start_sec: number; end_sec: number; url: string; status: string }>("select start_sec, end_sec, url, status from nuggets where id = $1", [data.id]);
    const was = rows[0];
    if (!was) return { ok: false as const, error: "That nugget is gone." };
    if (data.status === "dropped") {
      const { keepOnAir } = await import("@/lib/porch/fm");
      await keepOnAir(sql, () => sql.query("update nuggets set status = 'dropped' where id = $1", [data.id]));
      return { ok: true as const };
    }
    if (!data.title) return { ok: false as const, error: "Give it a title." };
    const length = data.endSec - data.startSec;
    if (data.startSec < 0 || length < 10 || length > 180) return { ok: false as const, error: "A nugget runs between 10 seconds and 3 minutes." };
    const status = data.status || was.status;
    await sql.query("update nuggets set title = $2, tags = $3, start_sec = $4, end_sec = $5, status = $6 where id = $1", [data.id, data.title, data.tags, data.startSec, data.endSec, status]);
    // Approved: cut it (again, if its times changed).
    const moved = Math.abs(Number(was.start_sec) - data.startSec) > 0.05 || Math.abs(Number(was.end_sec) - data.endSec) > 0.05;
    if (status === "approved" && (!was.url || moved || was.status !== "approved")) {
      await sql.query("update nuggets set cut_tries = 0 where id = $1", [data.id]);
      const { requestCut } = await import("@/lib/porch/nuggets.server");
      if (!(await requestCut(sql, data.id))) return { ok: false as const, error: "Its episode audio is missing." };
    }
    return { ok: true as const };
  });

/** Add a nugget by hand, from an episode, between two times. It is approved and cut straight away. */
export const addNugget = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const r = rec(input);
    const tags = Array.isArray(r.tags) ? r.tags.map((t) => String(t).toLowerCase().replace(/^#/, "").replace(/[^a-z0-9 -]/g, "").trim()).filter(Boolean).slice(0, 5) : [];
    return { sourceId: num(r.sourceId), title: str(r.title, 80), tags, startSec: num(r.startSec), endSec: num(r.endSec) };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { ok: false as const, error: "Only the Studio can do this." };
    const src = await sql.query<{ speaker_id: number }>("select speaker_id from nugget_sources where id = $1", [data.sourceId]);
    if (!src[0]) return { ok: false as const, error: "Choose an episode." };
    if (!data.title) return { ok: false as const, error: "Give it a title." };
    const length = data.endSec - data.startSec;
    if (data.startSec < 0 || length < 10 || length > 180) return { ok: false as const, error: "A nugget runs between 10 seconds and 3 minutes." };
    const made = await sql.query<{ id: number }>(
      `insert into nuggets (source_id, speaker_id, title, tags, start_sec, end_sec, status, made_by) values ($1, $2, $3, $4, $5, $6, 'approved', 'founder') returning id`,
      [data.sourceId, src[0].speaker_id, data.title, data.tags, data.startSec, data.endSec],
    );
    const { requestCut } = await import("@/lib/porch/nuggets.server");
    await requestCut(sql, Number(made[0].id));
    return { ok: true as const };
  });

/** Station breaks: on or off, how often, and whether everyone hears them (or only the founder, to check). */
export const saveNuggetSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const r = rec(input);
    return { breaksOn: r.breaksOn !== false, every: Math.max(1, Math.min(20, Math.round(num(r.every)) || 3)), live: r.live === true };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { ok: false as const, error: "Only the Studio can do this." };
    const { keepOnAir } = await import("@/lib/porch/fm");
    await keepOnAir(sql, async () => {
      await sql.query("update nugget_settings set breaks_on = $1, every_items = $2 where id = 1", [data.breaksOn, data.every]);
      await sql.query(/* On hold: Phaneroo's switch only. Must become per church before switching on (decision 8). */ "insert into app_flags (porch_id, key, enabled) values (1, 'nuggets', $1) on conflict (porch_id, key) do update set enabled = excluded.enabled", [data.live]);
    });
    return { ok: true as const };
  });

// ---- Listeners ---------------------------------------------------------------

/** One nugget (for a shared link), with whether I've saved it. */
export const getNugget = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: num(rec(input).id) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql.query<NuggetRow>(`${NUGGET_SELECT} where n.id = $1 and n.status = 'approved' and n.url <> ''`, [data.id]);
    if (!rows[0]) return { ok: false as const };
    const mine = await sql.query("select 1 from nugget_favourites where user_id = $1 and nugget_id = $2", [context.userId, data.id]);
    const n = toNugget(rows[0]);
    return { ok: true as const, nugget: { id: n.id, title: n.title, speaker: n.speaker, tags: n.tags, url: n.url, durationSec: n.durationSec }, saved: mine.length > 0 };
  });

/** Save or unsave a nugget. */
export const toggleNuggetSave = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: num(rec(input).id) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const had = await sql.query("delete from nugget_favourites where user_id = $1 and nugget_id = $2 returning nugget_id", [context.userId, data.id]);
    if (had.length) return { ok: true as const, saved: false };
    const ok = await sql.query("select 1 from nuggets where id = $1 and status = 'approved'", [data.id]);
    if (!ok.length) return { ok: false as const, saved: false };
    await sql.query("insert into nugget_favourites (user_id, nugget_id) values ($1, $2) on conflict do nothing", [context.userId, data.id]);
    return { ok: true as const, saved: true };
  });

/** My saved nuggets, newest first. */
export const mySavedNuggets = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql
      .query<{ id: number; title: string; speaker: string; tags: string[]; url: string; duration_sec: number }>(
        `select n.id, n.title, p.name as speaker, n.tags, n.url, n.duration_sec
           from nugget_favourites f join nuggets n on n.id = f.nugget_id join nugget_speakers p on p.id = n.speaker_id
          where f.user_id = $1 and n.status = 'approved' and n.url <> '' order by f.created_at desc limit 100`,
        [context.userId],
      )
      .catch(() => []);
    return rows.map((r) => ({ id: Number(r.id), title: r.title, speaker: r.speaker, tags: r.tags ?? [], url: r.url, durationSec: Number(r.duration_sec) }));
  });

/** The Groq key that turns sermons into text (checked with Groq before it is saved; empty removes it). */
export const saveGroqKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ key: str(rec(input).key, 300) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { ok: false as const, error: "Only the Studio can do this." };
    if (data.key) {
      const res = await fetch("https://api.groq.com/openai/v1/models", { headers: { authorization: `Bearer ${data.key}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
      if (!res) return { ok: false as const, error: "Couldn't reach Groq. Try again in a moment." };
      if (res.status === 401 || res.status === 403) return { ok: false as const, error: "Groq didn't accept that key. Copy it again from console.groq.com." };
    }
    await sql.query("update nugget_settings set groq_key = $1 where id = 1", [data.key]);
    return { ok: true as const };
  });

/** Keep a nugget in (or out of) the automatic station breaks. Out, it plays only when the Studio chooses it. */
export const setNuggetInBreaks = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: num(rec(input).id), on: rec(input).on !== false }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { ok: false as const, error: "Only the Studio can do this." };
    const { keepOnAir } = await import("@/lib/porch/fm");
    await keepOnAir(sql, () => sql.query("update nuggets set in_breaks = $2 where id = $1", [data.id, data.on]));
    return { ok: true as const };
  });

/** Studio: is the audio server (which cuts nuggets and turns sermons into text) awake and up to date? */
export const nuggetWorker = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { state: "unknown" as const };
    const { workerState, resendStuck } = await import("@/lib/porch/nuggets.server");
    const state = await workerState();
    if (state === "ready") await resendStuck(sql, true);
    return { state };
  });
