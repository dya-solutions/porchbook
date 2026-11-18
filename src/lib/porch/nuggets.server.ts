import { randomBytes } from "node:crypto";
import type { Sql } from "@/lib/db";
import type { FmTrack } from "@/lib/porch/fm-schedule";
import { audioWorkerBase } from "@/lib/porch/audio-worker.server";

/** Nuggets' server work: reading a speaker's podcast, transcripts, the AI's picks, and the audio worker's jobs. */

export const NUGGET_ID_BASE = 10_000_000; // nugget tracks on the radio get ids above this
const bool = (v: unknown) => v === true || v === 1 || v === "1" || v === "t" || v === "true";
const siteOrigin = () => (process.env.BETTER_AUTH_URL || "https://porchbook.vercel.app").replace(/\/+$/, "");

export type Segment = { s: number; e: number; t: string };

// ---- The radio ---------------------------------------------------------------

/**
 * Approved, ready nuggets as radio items. All of them are sent (so the Studio can play any one now or next);
 * `rotate` marks the ones the automatic station breaks take turns with: breaks on, live for everyone
 * (or this is the founder), the nugget left in the breaks, and its speaker on air.
 */
export async function stationNuggets(sql: Sql, founder: boolean): Promise<FmTrack[]> {
  try {
    const set = await sql.query<{ breaks_on: unknown; every_items: number }>("select breaks_on, every_items from nugget_settings where id = 1");
    const flag = await sql.query<{ enabled: unknown }>("select enabled from app_flags where key = 'nuggets'");
    // While Bible readings are on, they are the station breaks: the automatic nugget breaks pause.
    const bible = await sql.query<{ readings_on: unknown }>("select readings_on from bible_settings where id = 1").catch(() => []);
    // Everyone (the founder too) hears the same schedule: a founder-only rotation would put the founder's
    // radio out of step, and items would start mid-way for him after every break.
    void founder;
    const breaks = Boolean(set[0]) && bool(set[0].breaks_on) && bool(flag[0]?.enabled) && !bool(bible[0]?.readings_on);
    const every = Math.max(1, Math.min(20, Number(set[0]?.every_items) || 3));
    const rows = await sql.query<{ id: number; title: string; tags: string[]; url: string; duration_sec: number; speaker: string; in_breaks: unknown; on_air: unknown }>(
      `select n.id, n.title, n.tags, n.url, n.duration_sec, s.name as speaker, n.in_breaks, s.on_air
         from nuggets n join nugget_speakers s on s.id = n.speaker_id
        where n.status = 'approved' and n.url <> '' and n.duration_sec > 1
        order by n.id asc`,
    );
    return rows.map((r) => ({
      id: NUGGET_ID_BASE + Number(r.id),
      title: r.title,
      kind: "nugget",
      url: r.url,
      durationSec: Number(r.duration_sec),
      nugget: { id: Number(r.id), speaker: r.speaker, tags: r.tags ?? [], every, rotate: breaks && bool(r.in_breaks) && bool(r.on_air) },
      ...(breaks && bool(r.in_breaks) && bool(r.on_air) ? { breakEvery: every } : {}),
    }));
  } catch {
    return []; // tables not there yet
  }
}

// ---- The podcast feed --------------------------------------------------------

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (w, n: string) =>
      n[0] === "#" ? String.fromCodePoint(n[1].toLowerCase() === "x" ? parseInt(n.slice(2), 16) : Number(n.slice(1))) : (ENT[n.toLowerCase()] ?? w),
    )
    .trim();
const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return m ? decode(m[1]) : "";
};
const attr = (xml: string, name: string, key: string) => {
  const m = new RegExp(`<${name}\\s[^>]*${key}="([^"]*)"`, "i").exec(xml);
  return m ? decode(m[1]) : "";
};
function seconds(text: string) {
  if (!text) return 0;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  return text.split(":").reduce((sum, part) => sum * 60 + Number(part || 0), 0);
}

/** The newest episodes in a speaker's podcast, saved (new ones only). Returns how many were new. */
export async function readFeed(sql: Sql, speakerId: number, feedUrl: string) {
  const res = await fetch(feedUrl, { headers: { "user-agent": "Porchbook/1.0 (+https://porchbook.vercel.app)" }, signal: AbortSignal.timeout(20000) }).catch(() => {
    throw new Error("Couldn't reach the podcast. Try again in a moment.");
  });
  if (!res.ok) throw new Error(`The podcast feed answered ${res.status}.`);
  const xml = await res.text();
  const items = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].slice(0, 25).map((m) => m[0]);
  let added = 0;
  for (const item of items) {
    const audio = attr(item, "enclosure", "url");
    if (!audio) continue;
    const guid = tag(item, "guid") || audio;
    const title = tag(item, "title").slice(0, 300) || "Episode";
    const date = tag(item, "pubDate");
    const published = date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null;
    const duration = seconds(tag(item, "itunes:duration"));
    const transcript = attr(item, "podcast:transcript", "url");
    const done = await sql.query<{ id: number }>(
      `insert into nugget_sources (speaker_id, kind, guid, title, audio_url, published_at, duration_sec, transcript_url)
       values ($1, 'podcast', $2, $3, $4, $5, $6, $7)
       on conflict (speaker_id, guid) do update set audio_url = excluded.audio_url, title = excluded.title
       returning (xmax = 0) as id`,
      [speakerId, guid.slice(0, 500), title, audio, published, duration, transcript],
    );
    if (bool(done[0]?.id)) added += 1;
  }
  return added;
}

// ---- Transcripts -------------------------------------------------------------

/** A podcast's own transcript (WebVTT, SRT or Podcasting 2.0 JSON), if it publishes one. */
export async function fetchTranscript(url: string): Promise<Segment[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) return [];
  const text = await res.text();
  if (/^\s*\{/.test(text)) {
    const json = JSON.parse(text) as { segments?: { startTime?: number; endTime?: number; body?: string }[] };
    return (json.segments ?? []).map((x) => ({ s: Number(x.startTime) || 0, e: Number(x.endTime) || 0, t: String(x.body ?? "").trim() })).filter((x) => x.t);
  }
  const out: Segment[] = [];
  const time = (s: string) => s.replace(",", ".").split(":").reduce((sum, p) => sum * 60 + Number(p), 0);
  for (const block of text.split(/\r?\n\r?\n/)) {
    const m = /(\d{1,2}:?\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:?\d{2}:\d{2}[.,]\d{1,3})[^\n]*\n([\s\S]+)/.exec(block);
    if (m) out.push({ s: time(m[1]), e: time(m[2]), t: m[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() });
  }
  return out.filter((x) => x.t);
}

/** Words (with times) grouped into sentence-sized pieces, for the AI to read. */
export function segmentsFromWords(words: { text: string; start: number; end: number }[]): Segment[] {
  const out: Segment[] = [];
  let cur: Segment | null = null;
  for (const w of words) {
    const t = w.text.trim();
    if (!t) continue;
    if (!cur) cur = { s: w.start, e: w.end, t };
    else {
      cur.t += ` ${t}`;
      cur.e = w.end;
    }
    if (/[.!?]$/.test(t) || cur.t.length > 220) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ---- The AI's picks ----------------------------------------------------------

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** Ask Claude for the strongest 30–90 second moments; saves them as suggestions. Returns how many. */
export async function suggestMoments(sql: Sql, sourceId: number) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("The AI isn't connected (no Claude key).");
  const rows = await sql.query<{ transcript: Segment[] | string | null; title: string; speaker_id: number; speaker: string }>(
    `select s.transcript, s.title, s.speaker_id, p.name as speaker from nugget_sources s join nugget_speakers p on p.id = s.speaker_id where s.id = $1`,
    [sourceId],
  );
  const row = rows[0];
  if (!row) throw new Error("That episode is gone.");
  const segs: Segment[] = typeof row.transcript === "string" ? JSON.parse(row.transcript) : (row.transcript ?? []);
  if (!segs.length) throw new Error("No transcript yet.");
  await sql.query("update nugget_sources set status = 'finding', error = '' where id = $1", [sourceId]);
  // Keep the prompt within reach: about 60,000 characters of the message.
  let lines = segs.map((x) => `[${mmss(x.s)}] ${x.t}`);
  while (lines.join("\n").length > 60000) lines = lines.filter((_, i) => i % 4 !== 3);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    signal: AbortSignal.timeout(170000),
    body: JSON.stringify({
      model: process.env.NUGGETS_MODEL || "claude-sonnet-5-5",
      max_tokens: 3000,
      system:
        "You pick 'nuggets' from a sermon transcript for a Christian radio station: short clips (30 to 90 seconds) that stand completely on their own, " +
        "with one clear, powerful, quotable thought, a natural start (not mid-sentence) and a strong ending line. Avoid moments that need earlier context, " +
        "announcements, offering appeals, songs, or crowd responses. Keep the preacher's meaning exactly; titles must not overstate or add doctrine. " +
        'Answer with JSON only: {"moments":[{"title":"under 60 chars","start":"m:ss","end":"m:ss","tags":["2 or 3 short lowercase words"],"why":"one short sentence"}]} with 4 to 8 moments, strongest first. Never put double quote characters inside the text values (use single quotes), and write nothing but the JSON.',
      messages: [{ role: "user", content: `Speaker: ${row.speaker}\nMessage: ${row.title}\n\nTranscript (times are when each line starts):\n${lines.join("\n")}` }],
    }),
  });
  if (!res.ok) throw new Error(`The AI couldn't read it (${res.status}).`);
  const body = (await res.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string };
  const text = (body.content ?? []).map((p) => (p.type === "text" ? (p.text ?? "") : "")).join("");
  const json = /\{[\s\S]*\}/.exec(text)?.[0] ?? "";
  let moments: Record<string, unknown>[] = [];
  try {
    const parsed = JSON.parse(json) as { moments?: unknown } | unknown[];
    const list = Array.isArray(parsed) ? parsed : (parsed as { moments?: unknown }).moments;
    moments = Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
  } catch {
    moments = [];
  }
  // The whole answer wasn't clean JSON (cut short, or a stray character): read each pick on its own.
  if (!moments.length) {
    for (const piece of text.match(/\{[^{}]*"title"[^{}]*\}/g) ?? []) {
      try {
        moments.push(JSON.parse(piece) as Record<string, unknown>);
      } catch {
        const field = (name: string) => new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`).exec(piece)?.[1] ?? "";
        const tags = /"tags"\s*:\s*\[([^\]]*)\]/.exec(piece)?.[1]?.match(/"([^"]*)"/g)?.map((t) => t.replace(/"/g, "")) ?? [];
        if (field("title") && field("start") && field("end")) moments.push({ title: field("title"), start: field("start"), end: field("end"), why: field("why"), tags });
      }
    }
  }
  const when = (v: unknown) => (typeof v === "number" ? v : seconds(String(v ?? "").trim()));
  // Snap to where lines really start and end (only when a line is close by).
  const snapStart = (sec: number) => {
    const near = segs.reduce((best, x) => (Math.abs(x.s - sec) < Math.abs(best - sec) ? x.s : best), segs[0].s);
    return Math.abs(near - sec) <= 6 ? near : sec;
  };
  const snapEnd = (sec: number) => {
    const near = segs.reduce((best, x) => (Math.abs(x.e - sec) < Math.abs(best - sec) ? x.e : best), segs[0].e);
    return Math.abs(near - sec) <= 6 ? near : sec;
  };
  let saved = 0;
  for (const m of moments) {
    const title = String(m.title ?? "").trim();
    let start = when(m.start ?? m.start_time ?? m.from);
    let end = when(m.end ?? m.end_time ?? m.to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !title) continue;
    if (end < start) [start, end] = [end, start];
    if (end - start < 15) end = start + 45; // an end too close: give it a fair length to trim
    start = snapStart(start);
    end = snapEnd(end);
    if (end - start > 95) end = start + 90;
    if (end - start < 15) continue;
    const tags = (Array.isArray(m.tags) ? m.tags : []).map((t) => String(t).toLowerCase().replace(/[^a-z0-9 -]/g, "").trim()).filter(Boolean).slice(0, 4);
    await sql.query(
      `insert into nuggets (source_id, speaker_id, title, tags, start_sec, end_sec, status, made_by, why) values ($1, $2, $3, $4, $5, $6, 'suggested', 'ai', $7)`,
      [sourceId, row.speaker_id, title.slice(0, 80), tags, start, end, String(m.why ?? "").slice(0, 200)],
    );
    saved += 1;
  }
  // Say why nothing came out, so the Studio can show it.
  const why = saved
    ? ""
    : !text
      ? `The AI gave no answer (${body.stop_reason ?? "empty"}).`
      : !moments.length
        ? `The AI's answer had no moments: “${text.replace(/\s+/g, " ").slice(0, 140)}”`
        : `The AI's ${moments.length} picks had unusable times (first: ${JSON.stringify(moments[0]).slice(0, 120)}).`;
  const heard = `Transcript: ${segs.length} lines, ${Math.round((segs[segs.length - 1]?.e ?? 0) / 60)} min.`;
  await sql.query("update nugget_sources set status = $2, error = $3 where id = $1", [sourceId, saved ? "done" : "failed", why ? `${why} ${heard}` : ""]);
  if (!saved) throw new Error(`${why} ${heard}`);
  return saved;
}

// ---- The audio worker ----------------------------------------------------------

async function send(path: string, body: Record<string, unknown>) {
  try {
    await fetch(`${audioWorkerBase()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, callback: `${siteOrigin()}/api/nugget-worker` }),
      // A sleeping free server takes up to a minute to wake; wait a little for it.
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    /* the free server may be waking up; the job usually still lands, and the Studio can retry */
  }
}

/** Have the worker turn an episode into text with times (Groq's Whisper). */
export async function requestTranscript(sql: Sql, sourceId: number, audioUrl: string, groqKey: string) {
  const token = randomBytes(24).toString("hex");
  await sql.query("update nugget_sources set job_token = $2, job_started_at = now(), status = 'transcribing', error = '', job_tries = job_tries + 1 where id = $1", [sourceId, token]);
  await send("/nugget/transcribe", { jobToken: token, sourceId, audioUrl, groqKey });
}

/** Have the worker cut an approved nugget out of its episode, evened out like the rest of the Radio. */
export async function requestCut(sql: Sql, nuggetId: number) {
  const rows = await sql.query<{ audio_url: string; start_sec: number; end_sec: number }>(
    "select s.audio_url, n.start_sec, n.end_sec from nuggets n join nugget_sources s on s.id = n.source_id where n.id = $1",
    [nuggetId],
  );
  const row = rows[0];
  if (!row?.audio_url) return false;
  const token = randomBytes(24).toString("hex");
  await sql.query("update nuggets set job_token = $2, job_started_at = now(), cut_error = '', url = '', duration_sec = 0, cut_tries = cut_tries + 1 where id = $1", [nuggetId, token]);
  await send("/nugget/cut", { jobToken: token, nuggetId, audioUrl: row.audio_url, startSec: Number(row.start_sec), endSec: Number(row.end_sec) });
  return true;
}

/** Is the audio server up, and does it have Nuggets? (Asking also wakes it if it was asleep.) */
export async function workerState(): Promise<"ready" | "old" | "asleep"> {
  try {
    const res = await fetch(`${audioWorkerBase()}/nugget/status`, { signal: AbortSignal.timeout(25000) });
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { queued?: unknown };
      return "queued" in json ? "ready" : "old";
    } catch {
      return "old"; // it answered with its plain page: an older version without Nuggets
    }
  } catch {
    return "asleep";
  }
}

let lastSweep = 0;
/**
 * Jobs the audio server never picked up (it was asleep or restarting) are sent again:
 * a cut not back after 3 minutes, a transcript after 20. After 5 tries it says so instead.
 */
export async function resendStuck(sql: Sql, force = false) {
  if (!force && Date.now() - lastSweep < 90_000) return;
  lastSweep = Date.now();
  try {
    const cuts = await sql.query<{ id: number; cut_tries: number }>(
      `select id, cut_tries from nuggets
        where status = 'approved' and url = '' and cut_error = '' and (job_started_at is null or job_started_at < now() - interval '3 minutes')
        order by id asc limit 3`,
    );
    for (const row of cuts) {
      if (Number(row.cut_tries) >= 5) {
        await sql.query("update nuggets set cut_error = 'The audio server didn''t answer. Tap Try again later.', job_token = null where id = $1", [row.id]);
        continue;
      }
      await requestCut(sql, Number(row.id));
    }
    const words = await sql.query<{ id: number; audio_url: string; job_tries: number }>(
      `select id, audio_url, job_tries from nugget_sources
        where status = 'transcribing' and job_started_at < now() - interval '20 minutes' order by id asc limit 1`,
    );
    for (const row of words) {
      if (Number(row.job_tries) >= 5) {
        await sql.query("update nugget_sources set status = 'failed', error = 'The audio server didn''t answer. Try again later.', job_token = null where id = $1", [row.id]);
        continue;
      }
      const keyRow = await sql.query<{ groq_key: string }>("select groq_key from nugget_settings where id = 1");
      if (keyRow[0]?.groq_key) await requestTranscript(sql, Number(row.id), row.audio_url, keyRow[0].groq_key);
    }
  } catch {
    /* tried again on the next look */
  }
}
