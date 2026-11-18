import type { Sql } from "@/lib/db";

/** Phaneroo's YouTube channel. */
export const PHANEROO_CHANNEL = "https://www.youtube.com/@phaneroo/live";

export type LiveInfo = {
  live: boolean;
  videoId: string;
  source: "studio" | "youtube" | "none";
  /** "Phaneroo is live now" / "Apostle Grace is live now" / the studio's own words. */
  label?: string;
  /** The video's YouTube title (where he's preaching). */
  title?: string;
};

export type LiveLabel = "auto" | "phaneroo" | "grace" | "custom";

/**
 * Phaneroo's own services: Thursday and Sunday. Until the exact times are given,
 * from 4 PM (Kampala) to midnight on those days; any other live is Apostle Grace elsewhere.
 */
// Phaneroo services (Kampala time): Thursday from 5:00 pm, Sunday from 11:00 am, until midnight.
const SERVICE_START_MIN: Record<number, number> = { 4: 17 * 60, 0: 11 * 60 };

export function phanerooServiceNow(nowMs = Date.now()) {
  const local = new Date(nowMs + 3 * 60 * 60 * 1000);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const start = SERVICE_START_MIN[local.getUTCDay()];
  return start !== undefined && minutes >= start && minutes < 24 * 60;
}

export function liveLabel(choice: string, custom: string, nowMs = Date.now()) {
  if (choice === "custom" && custom.trim()) return custom.trim();
  if (choice === "phaneroo") return "Phaneroo is live now";
  if (choice === "grace") return "Apostle Grace is live now";
  return phanerooServiceNow(nowMs) ? "Phaneroo is live now" : "Apostle Grace is live now";
}

/** The video's title, from YouTube's public oEmbed (no key needed). */
export async function videoTitle(videoId: string): Promise<string> {
  try {
    const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`, {
      headers: YT_HEADERS,
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return "";
    const data = (await response.json()) as { title?: string };
    return (data.title ?? "").slice(0, 160);
  } catch {
    return "";
  }
}

export async function ensureLiveColumns(sql: Sql) {
  await sql.query("alter table fm_live_video add column if not exists label text not null default 'auto'");
  await sql.query("alter table fm_live_video add column if not exists custom text not null default ''");
  await sql.query("alter table fm_live_video add column if not exists title text not null default ''");
  await sql.query("alter table fm_live_video add column if not exists was_live boolean not null default false");
  await sql.query("alter table fm_live_video add column if not exists checked_at timestamptz");
}

/** The 11-character YouTube video id in a link (watch, live, youtu.be, shorts, embed), or "". */
export function videoIdOf(link: string): string {
  const text = link.trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  const match =
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/i.exec(text);
  return match?.[1] ?? "";
}

type Pick = { videoId: string; label: string; custom: string; title: string; wasLive: boolean; checkedMs: number };

async function studioPick(sql: Sql): Promise<Pick | null> {
  try {
    await ensureLiveColumns(sql);
    const rows = await sql.query<{ video_id: string; label: string; custom: string; title: string; was_live: boolean | string; checked_ms: string | number | null }>(
      `select video_id, label, custom, title, was_live, (extract(epoch from checked_at) * 1000)::bigint as checked_ms
         from fm_live_video where id = 1 and set_at > now() - interval '6 hours'`,
    );
    const row = rows[0];
    if (!row) return null;
    return {
      videoId: row.video_id,
      label: row.label,
      custom: row.custom,
      title: row.title,
      wasLive: row.was_live === true || row.was_live === "t" || row.was_live === "true",
      checkedMs: Number(row.checked_ms ?? 0),
    };
  } catch {
    return null;
  }
}

/** A pasted stream that has ended clears itself (checked at most every 3 minutes). */
async function streamEnded(sql: Sql, pick: Pick): Promise<boolean> {
  if (Date.now() - pick.checkedMs < 3 * 60 * 1000) return false;
  try {
    await sql.query("update fm_live_video set checked_at = now() where id = 1");
    const watch = await page(`https://www.youtube.com/watch?v=${pick.videoId}`);
    const liveNow = /"isLiveNow":\s*true/.test(watch.html);
    const saysEnded = /"isLiveNow":\s*false/.test(watch.html);
    if (liveNow && !pick.wasLive) await sql.query("update fm_live_video set was_live = true where id = 1");
    // Only a stream we saw live, and YouTube now plainly says isn't: an ordinary video just stays its 6 hours.
    if ((pick.wasLive || liveNow) && saysEnded && !liveNow) {
      await sql.query("delete from fm_live_video where id = 1");
      return true;
    }
  } catch {
    /* can't tell: keep showing it */
  }
  return false;
}

const YT_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
  cookie: "CONSENT=YES+1; SOCS=CAI",
};

// What the last check saw, for the Studio's "Check now" (helps fix it if YouTube changes).
let lastSeen = "";
let channelId = "";

async function page(url: string) {
  const response = await fetch(url, { headers: YT_HEADERS, redirect: "follow" });
  const html = await response.text();
  return { status: response.status, url: response.url, html };
}

function liveIdIn(html: string): string {
  const liveNow = /"isLiveNow":\s*true/.test(html) || /"isLive":\s*true/.test(html) || /"isLiveContent":\s*true[^}]*"isLiveNow"/.test(html);
  if (!liveNow) return "";
  return (
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/.exec(html)?.[1] ??
    /"videoDetails":\{"videoId":"([\w-]{11})"/.exec(html)?.[1] ??
    /<meta itemprop="identifier" content="([\w-]{11})"/.exec(html)?.[1] ??
    ""
  );
}

/** Is Phaneroo live on YouTube right now? Tries the channel's /live page, then the live embed. */
async function channelLive(): Promise<string> {
  const notes: string[] = [];
  try {
    const live = await page(PHANEROO_CHANNEL);
    notes.push(`/live: ${live.status}, ${live.html.length} bytes${/consent\.youtube|before you continue/i.test(live.html) ? ", consent page" : ""}${/unusual traffic|captcha/i.test(live.html) ? ", bot check" : ""}`);
    const found = liveIdIn(live.html);
    if (found) {
      lastSeen = `${new Date().toISOString()} live ${found} (${notes.join("; ")})`;
      return found;
    }
    channelId ||= /"externalId":"(UC[\w-]{22})"/.exec(live.html)?.[1] ?? /channel_id=(UC[\w-]{22})/.exec(live.html)?.[1] ?? /"channelId":"(UC[\w-]{22})"/.exec(live.html)?.[1] ?? "";
    if (!channelId) {
      const home = await page("https://www.youtube.com/@phaneroo");
      channelId = /"externalId":"(UC[\w-]{22})"/.exec(home.html)?.[1] ?? /channel_id=(UC[\w-]{22})/.exec(home.html)?.[1] ?? "";
      notes.push(`home: ${home.status}, channel ${channelId || "not found"}`);
    }
    if (channelId) {
      const embed = await page(`https://www.youtube.com/embed/live_stream?channel=${channelId}`);
      const id = /"videoId":"([\w-]{11})"/.exec(embed.html)?.[1] ?? /\/vi\/([\w-]{11})\//.exec(embed.html)?.[1] ?? "";
      notes.push(`embed: ${embed.status}, video ${id || "none"}`);
      if (id) {
        const watch = await page(`https://www.youtube.com/watch?v=${id}`);
        const isLive = /"isLiveNow":\s*true/.test(watch.html);
        notes.push(`watch: ${watch.status}, live ${isLive}`);
        if (isLive) {
          lastSeen = `${new Date().toISOString()} live ${id} (${notes.join("; ")})`;
          return id;
        }
      }
    }
  } catch (error) {
    notes.push(`error: ${error instanceof Error ? error.message : "unknown"}`);
  }
  lastSeen = `${new Date().toISOString()} not live (${notes.join("; ")})`;
  return "";
}

export async function liveCheckReport() {
  await channelLive();
  return lastSeen;
}

export async function phanerooLive(sql: Sql): Promise<LiveInfo> {
  const picked = await studioPick(sql);
  if (picked && !(await streamEnded(sql, picked))) {
    return { live: true, videoId: picked.videoId, source: "studio", label: liveLabel(picked.label, picked.custom), title: picked.title };
  }
  const found = await channelLive();
  if (found) return { live: true, videoId: found, source: "youtube", label: liveLabel("auto", ""), title: await videoTitle(found) };
  return { live: false, videoId: "", source: "none" };
}

/** For the studio: a plain-words answer instead of what YouTube sent back. */
export function plainReport(report: string) {
  const at = /^(\S+)/.exec(report)?.[1] ?? "";
  const when = at ? new Date(at).toLocaleTimeString("en-US", { timeZone: "Africa/Kampala", hour: "numeric", minute: "2-digit" }) : "";
  if (/ live [\w-]{11}/.test(report)) return `Phaneroo is live on YouTube now${when ? ` · checked ${when}` : ""}.`;
  if (/bot check|consent/.test(report)) return `YouTube didn't answer clearly just now${when ? ` (${when})` : ""}. If a service is on, paste its link.`;
  return `Phaneroo isn't live right now${when ? ` · checked ${when}` : ""}.`;
}
