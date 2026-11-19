import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

function parseSeed(input: unknown): Seed {
  const raw = asRecord(input);
  return {
    displayName: typeof raw.displayName === "string" ? clip(raw.displayName, 80) : "",
    email: typeof raw.email === "string" ? clip(raw.email, 200) : null,
    imageUrl: typeof raw.imageUrl === "string" ? clip(raw.imageUrl, 500) : null,
  };
}

function secondsOf(value: string | null): number | null {
  if (!value) return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  let total = 0;
  if (/^\d+$/.test(raw)) total = Number(raw);
  else {
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
    if (!match || match[0] === "") return null;
    total = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  }
  if (!Number.isFinite(total) || total < 0 || total > 12 * 60 * 60) return null;
  return Math.floor(total);
}

function youtubeClip(value: string): { videoId: string; start: number; end: number | null; tall: boolean } | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    let id = "";
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    else if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/")) {
        id = url.pathname.split("/")[2] ?? "";
      } else if (url.pathname === "/watch") id = url.searchParams.get("v") ?? "";
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const start = secondsOf(url.searchParams.get("start") ?? url.searchParams.get("t") ?? hash.get("t")) ?? 0;
    const end = secondsOf(url.searchParams.get("end") ?? hash.get("end"));
    return { videoId: id, start, end: end !== null && end > start ? end : null, tall: url.pathname.includes("/shorts/") };
  } catch {
    return null;
  }
}

type SavedClip = { kind: "youtube" | "short" | "tiktok" | "instagram"; videoId: string; start: number; end: number | null };

function siteHost(url: URL) {
  return url.hostname.replace(/^www\./, "").toLowerCase();
}

function tiktokId(value: string): string | null {
  try {
    const url = new URL(value);
    const host = siteHost(url);
    if (host !== "tiktok.com" && host !== "m.tiktok.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const at = parts.indexOf("video");
    const id = at >= 0 ? parts[at + 1] : parts[0] === "v" ? parts[1] : "";
    return /^\d{8,22}$/.test(id ?? "") ? id : null;
  } catch {
    return null;
  }
}

function shortTikTok(value: string): boolean {
  try {
    const url = new URL(value);
    const host = siteHost(url);
    return host === "vm.tiktok.com" || host === "vt.tiktok.com" || (host === "tiktok.com" && url.pathname.startsWith("/t/"));
  } catch {
    return false;
  }
}

function instagramPost(value: string): string | null {
  try {
    const url = new URL(value);
    const host = siteHost(url);
    if (host !== "instagram.com" && host !== "instagr.am") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const at = parts.findIndex((part) => part === "reel" || part === "reels" || part === "p" || part === "tv");
    if (at < 0) return null;
    const code = parts[at + 1] ?? "";
    if (!/^[A-Za-z0-9_-]{5,}$/.test(code)) return null;
    const kind = parts[at] === "p" ? "p" : parts[at] === "tv" ? "tv" : "reel";
    return `${kind}/${code}`;
  } catch {
    return null;
  }
}

async function readClip(value: string): Promise<SavedClip | { error: string }> {
  const youtube = youtubeClip(value);
  if (youtube) return { kind: youtube.tall ? "short" : "youtube", videoId: youtube.videoId, start: youtube.start, end: youtube.end };
  const direct = tiktokId(value);
  if (direct) return { kind: "tiktok", videoId: direct, start: 0, end: null };
  if (shortTikTok(value)) {
    try {
      const response = await fetch(value, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0" } });
      const id = tiktokId(response.url);
      if (id) return { kind: "tiktok", videoId: id, start: 0, end: null };
    } catch {
      return { error: "That TikTok link could not be opened. Paste the full video link." };
    }
    return { error: "That TikTok link could not be opened. Paste the full video link." };
  }
  const post = instagramPost(value);
  if (post) return { kind: "instagram", videoId: post, start: 0, end: null };
  try {
    const host = siteHost(new URL(value));
    if (host === "instagram.com" || host === "instagr.am") {
      try {
        const response = await fetch(value, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0" } });
        const shared = instagramPost(response.url);
        if (shared) return { kind: "instagram", videoId: shared, start: 0, end: null };
      } catch {
        /* the full reel link is still needed */
      }
      return { error: "Paste an Instagram reel or post." };
    }
    if (host.endsWith("tiktok.com")) return { error: "Paste a TikTok video link." };
  } catch {
    /* not a link */
  }
  return { error: "Paste a YouTube, TikTok, or Instagram link." };
}

async function ensureRhema(sql: Awaited<ReturnType<typeof getSql>>) {
  await sql`
    create table if not exists rhema_clip (
      id integer primary key,
      video_id text,
      updated_at timestamptz not null default now()
    )
  `;
  await sql`alter table rhema_clip add column if not exists start_at integer`;
  await sql`alter table rhema_clip add column if not exists end_at integer`;
  await sql`alter table rhema_clip add column if not exists kind text`;
}

async function founderFlag(sql: Awaited<ReturnType<typeof getSql>>, userId: string): Promise<boolean> {
  const me = await sql.query<{ is_founder: boolean }>("select is_porch_admin($1) as is_founder", [userId]);
  return boolish(me[0]?.is_founder);
}

export const getRhema = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await ensureRhema(sql);
    const rows = await sql.query<{
      video_id: string | null;
      start_at: number | null;
      end_at: number | null;
      kind: string | null;
      updated_at: string | null;
    }>(
      `select video_id, start_at, end_at, kind,
              to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
       from rhema_clip where id = 1`,
    );
    const founder = await founderFlag(sql, context.userId);
    const row = rows[0];
    const kind = row?.kind === "tiktok" || row?.kind === "instagram" || row?.kind === "short" ? row.kind : "youtube";
    const timed = kind === "youtube" || kind === "short";
    const start = timed && row?.start_at && row.start_at > 0 ? row.start_at : 0;
    const end = timed && row?.end_at && row.end_at > start ? row.end_at : null;
    return { kind, videoId: row?.video_id ?? null, start, end, updatedAt: row?.updated_at ?? null, founder };
  });

export const setRhema = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      url: typeof raw.url === "string" ? clip(raw.url, 800) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensureRhema(sql);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "rhema", "Tried to change the Rhemaclip.");
      return { ok: false as const, error: "Only the founder can set the Rhemaclip." };
    }
    if (!data.url) {
      await sql`delete from rhema_clip where id = 1`;
      return { ok: true as const, videoId: null };
    }
    const found = await readClip(data.url);
    if ("error" in found) return { ok: false as const, error: found.error };
    await sql`
      insert into rhema_clip (id, video_id, start_at, end_at, kind, updated_at)
      values (1, ${found.videoId}, ${found.start}, ${found.end}, ${found.kind}, now())
      on conflict (id) do update
        set video_id = excluded.video_id,
            start_at = excluded.start_at,
            end_at = excluded.end_at,
            kind = excluded.kind,
            updated_at = now()
    `;
    return { ok: true as const, videoId: found.videoId };
  });

async function ensurePrayer(sql: Awaited<ReturnType<typeof getSql>>) {
  await sql`
    create table if not exists prayer_track (
      id integer primary key,
      video_id text,
      start_at integer,
      updated_at timestamptz not null default now()
    )
  `;
}

export const getPrayer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await ensurePrayer(sql);
    const rows = await sql.query<{ video_id: string | null; start_at: number | null }>(
      "select video_id, start_at from prayer_track where id = 1",
    );
    const founder = await founderFlag(sql, context.userId);
    const row = rows[0];
    return {
      videoId: row?.video_id ?? null,
      start: row?.start_at && row.start_at > 0 ? row.start_at : 0,
      founder,
    };
  });

export const setPrayer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      url: typeof raw.url === "string" ? clip(raw.url, 300) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensurePrayer(sql);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "prayer", "Tried to change the prayer music.");
      return { ok: false as const, error: "Only the founder can set the prayer music." };
    }
    if (!data.url) {
      await sql`delete from prayer_track where id = 1`;
      return { ok: true as const, videoId: null };
    }
    const track = youtubeClip(data.url);
    if (!track) return { ok: false as const, error: "Paste a YouTube link." };
    await sql`
      insert into prayer_track (id, video_id, start_at, updated_at)
      values (1, ${track.videoId}, ${track.start}, now())
      on conflict (id) do update
        set video_id = excluded.video_id,
            start_at = excluded.start_at,
            updated_at = now()
    `;
    return { ok: true as const, videoId: track.videoId };
  });
