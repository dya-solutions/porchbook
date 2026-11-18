import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";

const MAX_BYTES = 400_000;
const TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/webm", "audio/mp4", "audio/aac", "audio/x-m4a"]);

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

const BELONGS = new Set(["tap", "sign", "open", "bell", "bend", "drop"]);

function parseBelongs(value: unknown) {
  return typeof value === "string" && BELONGS.has(value) ? value : "drop";
}

function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

async function ensure(sql: Awaited<ReturnType<typeof getSql>>) {
  await sql`
    create table if not exists button_sound (
      id integer primary key,
      mime text not null,
      audio text not null,
      updated_at timestamptz not null default now()
    )
  `;
  await sql`alter table button_sound add column if not exists belongs text not null default ''`;
}

async function founderFlag(sql: Awaited<ReturnType<typeof getSql>>, userId: string) {
  const me = await sql.query<{ is_founder: boolean }>("select is_founder from profiles where user_id = $1", [userId]);
  return boolish(me[0]?.is_founder);
}

export const loadButtonSound = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await ensure(sql);
    const founder = await founderFlag(sql, context.userId);
    const rows = await sql.query<{ id: number; mime: string; audio: string; updated_at: string; belongs: string }>(
      `select id, mime, audio, belongs, to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
       from button_sound where id in (1, 2, 3, 4, 5, 6)`,
    );
    const tap = rows.find((row) => Number(row.id) === 1);
    const leave = rows.find((row) => Number(row.id) === 2);
    const open = rows.find((row) => Number(row.id) === 3);
    const bell = rows.find((row) => Number(row.id) === 4);
    const bend = rows.find((row) => Number(row.id) === 5);
    const extra = rows.find((row) => Number(row.id) === 6);
    return {
      founder,
      mime: tap?.mime ?? "",
      audio: tap?.audio ?? "",
      updatedAt: tap?.updated_at ?? "",
      signMime: leave?.mime ?? "",
      signAudio: leave?.audio ?? "",
      signUpdatedAt: leave?.updated_at ?? "",
      openMime: open?.mime ?? "",
      openAudio: open?.audio ?? "",
      openUpdatedAt: open?.updated_at ?? "",
      bellMime: bell?.mime ?? "",
      bellAudio: bell?.audio ?? "",
      bellUpdatedAt: bell?.updated_at ?? "",
      bendMime: bend?.mime ?? "",
      bendAudio: bend?.audio ?? "",
      bendUpdatedAt: bend?.updated_at ?? "",
      extraMime: extra?.mime ?? "",
      extraAudio: extra?.audio ?? "",
      extraUpdatedAt: extra?.updated_at ?? "",
      extraBelongs: parseBelongs(extra?.belongs),
    };
  });

export const setButtonSound = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      mime: typeof raw.mime === "string" ? clip(raw.mime, 40) : "",
      audio: typeof raw.audio === "string" ? raw.audio.replace(/\s/g, "").slice(0, 700_000) : "",
      slot: raw.slot === 2 ? 2 : raw.slot === 3 ? 3 : raw.slot === 4 ? 4 : raw.slot === 5 ? 5 : raw.slot === 6 ? 6 : 1,
      belongs: parseBelongs(raw.belongs),
      belongsOnly: raw.belongsOnly === true,
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensure(sql);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "button-sound", "Tried to set the button sound.");
      return { ok: false as const, error: "Only the founder can set this sound." };
    }
    if (data.slot === 6 && data.belongsOnly) {
      await sql`update button_sound set belongs = ${data.belongs} where id = 6`;
      return { ok: true as const };
    }
    if (!data.audio) {
      await sql`delete from button_sound where id = ${data.slot}`;
      return { ok: true as const };
    }
    if (!TYPES.has(data.mime)) return { ok: false as const, error: "Use an mp3, m4a, wav, or webm sound." };
    let bytes = 0;
    try {
      bytes = atob(data.audio).length;
    } catch {
      return { ok: false as const, error: "That sound could not be read." };
    }
    if (bytes > MAX_BYTES) return { ok: false as const, error: "Keep the sound under 400 KB." };
    const belongs = data.slot === 6 ? data.belongs : "";
    await sql`
      insert into button_sound (id, mime, audio, belongs, updated_at)
      values (${data.slot}, ${data.mime}, ${data.audio}, ${belongs}, now())
      on conflict (id) do update set mime = ${data.mime}, audio = ${data.audio}, belongs = ${belongs}, updated_at = now()
    `;
    return { ok: true as const };
  });
