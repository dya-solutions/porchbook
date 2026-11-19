import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";

/** The founder's message sound: one gentle sound everyone hears when a private message arrives. */

const MAX_BYTES = 300_000;

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
async function ensure(sql: Awaited<ReturnType<typeof getSql>>) {
  await sql`
    create table if not exists message_sound (
      id integer primary key,
      mime text not null,
      audio text not null,
      updated_at timestamptz not null default now()
    )
  `;
}
async function founderFlag(sql: Awaited<ReturnType<typeof getSql>>, userId: string) {
  const me = await sql.query<{ is_founder: boolean }>("select is_porch_admin($1) as is_founder", [userId]);
  return boolish(me[0]?.is_founder);
}

export const getMessageSound = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    await ensure(sql);
    const founder = await founderFlag(sql, context.userId);
    const rows = await sql.query<{ mime: string; audio: string; updated_at: string }>(
      `select mime, audio, to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at from message_sound where id = 1`,
    );
    return { founder, mime: rows[0]?.mime ?? "", audio: rows[0]?.audio ?? "", updatedAt: rows[0]?.updated_at ?? "" };
  });

export const setMessageSound = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      mime: typeof raw.mime === "string" ? clip(raw.mime, 40) : "",
      audio: typeof raw.audio === "string" ? raw.audio.replace(/\s/g, "").slice(0, 500_000) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensure(sql);
    if (!(await founderFlag(sql, context.userId))) {
      noteAttempt(context.userId, "message-sound", "Tried to change the message sound.");
      return { ok: false as const, error: "Only the founder can change the message sound." };
    }
    if (!data.audio) {
      await sql`delete from message_sound where id = 1`;
      return { ok: true as const };
    }
    if (data.mime !== "audio/wav") return { ok: false as const, error: "That sound could not be prepared." };
    let bytes = 0;
    try {
      bytes = atob(data.audio).length;
    } catch {
      return { ok: false as const, error: "That sound could not be read." };
    }
    if (bytes > MAX_BYTES) return { ok: false as const, error: "That sound is too long." };
    await sql`
      insert into message_sound (id, mime, audio, updated_at) values (1, ${data.mime}, ${data.audio}, now())
      on conflict (id) do update set mime = ${data.mime}, audio = ${data.audio}, updated_at = now()
    `;
    return { ok: true as const };
  });
