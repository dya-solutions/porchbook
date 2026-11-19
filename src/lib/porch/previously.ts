import { createServerFn } from "@tanstack/react-start";
import { myPorchId, porchTables } from "@/lib/porch/porch-foundation";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function parseSeed(input: unknown): Seed {
  const raw = asRecord(input);
  return {
    displayName: typeof raw.displayName === "string" ? clip(raw.displayName, 80) : "",
    email: typeof raw.email === "string" ? clip(raw.email, 200) : null,
    imageUrl: typeof raw.imageUrl === "string" ? clip(raw.imageUrl, 500) : null,
  };
}

function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

export function youtubeId(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    let id = "";
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    else if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/")) id = url.pathname.split("/")[2] ?? "";
      else if (url.pathname === "/watch") id = url.searchParams.get("v") ?? "";
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

async function ensurePrevious(sql: Awaited<ReturnType<typeof getSql>>) {
  await sql`
    create table if not exists previous_clip (
      id integer primary key,
      kind text not null,
      youtube_id text,
      url text,
      mime text,
      updated_at timestamptz not null default now()
    )
  `;
  await porchTables(sql, { key: [["previous_clip", "id"]] });
}

async function founderFlag(sql: Awaited<ReturnType<typeof getSql>>, userId: string) {
  const me = await sql.query<{ is_founder: boolean }>("select is_porch_admin($1) as is_founder", [userId]);
  return boolish(me[0]?.is_founder);
}

export type PreviousClip = {
  kind: "youtube" | "link" | "file";
  youtubeId: string | null;
  url: string | null;
  mime: string | null;
  updatedAt: string | null;
};

export const getPrevious = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, seed);
    await ensurePrevious(sql);
    const founder = await founderFlag(sql, context.userId);
    const rows = await sql.query<{ kind: string; youtube_id: string | null; url: string | null; mime: string | null; updated_at: string | null }>(`select kind, youtube_id, url, mime,
              to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
       from previous_clip where porch_id = ${porch} and id = 1`,
    );
    const row = rows[0];
    const clip: PreviousClip | null = row
      ? {
          kind: row.kind === "file" || row.kind === "link" ? row.kind : "youtube",
          youtubeId: row.youtube_id,
          url: row.url,
          mime: row.mime,
          updatedAt: row.updated_at,
        }
      : null;
    return { founder, clip };
  });

export const setPreviousLink = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { url: typeof raw.url === "string" ? clip(raw.url, 500) : "", seed: parseSeed(raw) };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await touchProfile(sql, context.userId, data.seed);
    await ensurePrevious(sql);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "previous", "Tried to set Previously in Phaneroo.");
      return { ok: false as const, error: "Only an admin can set this video." };
    }
    if (!data.url) {
      await sql`delete from previous_clip where porch_id = ${porch} and id = 1`;
      return { ok: true as const };
    }
    let parsed: URL;
    try {
      parsed = new URL(data.url);
    } catch {
      return { ok: false as const, error: "Paste a full link." };
    }
    if (parsed.protocol !== "https:") return { ok: false as const, error: "The link has to start with https." };
    const video = youtubeId(data.url);
    if (video) {
      await sql`
        insert into previous_clip (porch_id, id, kind, youtube_id, url, mime, updated_at)
        values (${porch}, 1, 'youtube', ${video}, ${data.url}, null, now())
        on conflict (porch_id, id) do update
          set kind = 'youtube', youtube_id = ${video}, url = ${data.url}, mime = null, updated_at = now()
      `;
    } else {
      await sql`
        insert into previous_clip (porch_id, id, kind, youtube_id, url, mime, updated_at)
        values (${porch}, 1, 'link', null, ${data.url}, null, now())
        on conflict (porch_id, id) do update
          set kind = 'link', youtube_id = null, url = ${data.url}, mime = null, updated_at = now()
      `;
    }
    return { ok: true as const };
  });
