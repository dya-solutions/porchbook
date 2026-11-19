import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";

function clip(value: string, max: number) {
  return value.trim().slice(0, max);
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function boolish(value: unknown) {
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

function youtubeId(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    let id = "";
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/") || url.pathname.startsWith("/live/")) {
        id = url.pathname.split("/")[2] ?? "";
      } else if (url.pathname === "/watch") id = url.searchParams.get("v") ?? "";
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

function linksOf(value: string) {
  const seen = new Set<string>();
  const links: string[] = [];
  let refused = false;
  for (const part of value.split(/[\s,]+/)) {
    const url = part.trim().slice(0, 500);
    if (!/^https?:\/\//i.test(url)) continue;
    if (!youtubeId(url)) {
      refused = true;
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    links.push(url);
    if (links.length === 40) break;
  }
  return { links, refused };
}

async function ensure(sql: Awaited<ReturnType<typeof getSql>>) {
  await sql`
    create table if not exists worship_songs (
      id text primary key,
      url text not null,
      created_at timestamptz not null default now()
    )
  `;
}

async function founderFlag(sql: Awaited<ReturnType<typeof getSql>>, userId: string) {
  const me = await sql.query<{ is_founder: boolean }>("select is_porch_admin($1) as is_founder", [userId]);
  return boolish(me[0]?.is_founder);
}

async function listed(sql: Awaited<ReturnType<typeof getSql>>) {
  return sql.query<{ id: string; url: string }>("select id, url from worship_songs order by created_at asc");
}

export const getWorship = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await ensure(sql);
    const founder = await founderFlag(sql, context.userId);
    return { founder, songs: await listed(sql) };
  });

const titleCache = new Map<string, string>();

export const worshipTitles = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const urls = Array.isArray(raw.urls) ? raw.urls.filter((item): item is string => typeof item === "string").slice(0, 40) : [];
    return { urls, seed: parseSeed(raw) };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    const titles: Record<string, string> = {};
    await Promise.all(
      data.urls.map(async (url) => {
        const id = youtubeId(url);
        if (!id) return;
        const known = titleCache.get(id);
        if (known) {
          titles[id] = known;
          return;
        }
        try {
          const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, {
            signal: AbortSignal.timeout(4000),
          });
          if (!response.ok) return;
          const body = (await response.json()) as { title?: string };
          const title = (body.title ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
          if (!title) return;
          titleCache.set(id, title);
          titles[id] = title;
        } catch {
          /* the dial still shows a plain name */
        }
      }),
    );
    return { titles };
  });

export const addWorship = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      links: typeof raw.links === "string" ? clip(raw.links, 8000) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensure(sql);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "worship", "Tried to add a worship song.");
      return { ok: false as const, error: "Only the founder can add worship songs." };
    }
    const found = linksOf(data.links);
    if (!found.links.length) {
      return { ok: false as const, error: found.refused ? "Paste a YouTube link. Other links stay out." : "Paste a song link." };
    }
    const have = new Set((await listed(sql)).map((song) => song.url));
    if (have.size >= 80) return { ok: false as const, error: "The worship library is full." };
    for (const url of found.links) {
      if (have.has(url) || have.size >= 80) continue;
      have.add(url);
      await sql`
        insert into worship_songs (id, url, created_at)
        values (${crypto.randomUUID()}, ${url}, now())
      `;
    }
    return { ok: true as const, songs: await listed(sql) };
  });

export const dropWorship = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      id: typeof raw.id === "string" ? clip(raw.id, 80) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensure(sql);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "worship", "Tried to remove a worship song.");
      return { ok: false as const, error: "Only the founder can remove a worship song." };
    }
    if (data.id) await sql`delete from worship_songs where id = ${data.id}`;
    return { ok: true as const, songs: await listed(sql) };
  });
