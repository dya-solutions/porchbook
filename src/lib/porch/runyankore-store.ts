import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { touchProfile } from "@/lib/porch/api";
import type { Seed } from "@/lib/porch/model";
import { GLOSSARY, memoryKey } from "@/lib/porch/runyankore";

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

async function ensure(sql: Awaited<ReturnType<typeof getSql>>) {
  await sql`
    create table if not exists translation_memory (
      id text primary key,
      english_key text not null unique,
      english_text text not null,
      runyankore_text text not null,
      source text not null,
      domain text not null default 'devotional',
      approved boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
  await sql`
    create table if not exists christian_glossary (
      english_term text primary key,
      runyankore_term text not null,
      alternative_terms text not null default '',
      preferred_term text not null,
      context text not null default '',
      source text not null,
      approved boolean not null default false
    )
  `;
  await sql`
    create table if not exists devotional_translation (
      devotional_id text primary key,
      english_version text not null,
      runyankore_version text not null,
      translation_status text not null,
      translation_source text not null,
      translation_model text not null,
      translation_date timestamptz not null default now()
    )
  `;
  for (const term of GLOSSARY) {
    await sql`
      insert into christian_glossary (english_term, runyankore_term, alternative_terms, preferred_term, context, source, approved)
      values (${term.english}, ${term.runyankore}, ${term.alternatives}, ${term.preferred}, ${term.context}, ${term.source}, ${term.approved})
      on conflict (english_term) do nothing
    `;
  }
}

async function founderFlag(sql: Awaited<ReturnType<typeof getSql>>, userId: string) {
  const me = await sql.query<{ is_founder: boolean }>("select is_founder from profiles where user_id = $1", [userId]);
  return boolish(me[0]?.is_founder);
}

export const lookupRunyankore = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const lines = Array.isArray(raw.lines) ? raw.lines.filter((line): line is string => typeof line === "string").slice(0, 40) : [];
    return { lines, seed: parseSeed(raw) };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensure(sql);
    const keys = data.lines.map((line) => memoryKey(line)).filter(Boolean);
    if (!keys.length) return { pairs: [] as { english: string; runyankore: string }[] };
    const rows = await sql.query<{ english_text: string; runyankore_text: string }>(
      "select english_text, runyankore_text from translation_memory where approved = true and english_key = any($1::text[])",
      [keys],
    );
    return { pairs: rows.map((row) => ({ english: row.english_text, runyankore: row.runyankore_text })) };
  });

export const keepRunyankore = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const pairs = Array.isArray(raw.pairs) ? raw.pairs.slice(0, 40) : [];
    return {
      pairs: pairs.map((item) => {
        const row = asRecord(item);
        return {
          english: typeof row.english === "string" ? clip(row.english, 4000) : "",
          runyankore: typeof row.runyankore === "string" ? clip(row.runyankore, 4000) : "",
          source: typeof row.source === "string" ? clip(row.source, 40) : "correction",
        };
      }),
      devotionId: typeof raw.devotionId === "string" ? clip(raw.devotionId, 500) : "",
      englishVersion: typeof raw.englishVersion === "string" ? clip(raw.englishVersion, 20000) : "",
      runyankoreVersion: typeof raw.runyankoreVersion === "string" ? clip(raw.runyankoreVersion, 20000) : "",
      status: typeof raw.status === "string" ? clip(raw.status, 40) : "partial",
      model: typeof raw.model === "string" ? clip(raw.model, 40) : "porch-memory",
      approve: raw.approve === true,
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensure(sql);
    const founder = await founderFlag(sql, context.userId);
    for (const pair of data.pairs) {
      const key = memoryKey(pair.english);
      if (!key || !pair.runyankore) continue;
      const source = pair.source === "phaneroo" ? "phaneroo" : "correction";
      const approved = source === "phaneroo" || (founder && data.approve);
      const existing = await sql.query<{ approved: boolean }>("select approved from translation_memory where english_key = $1", [key]);
      if (!existing.length) {
        await sql`
          insert into translation_memory (id, english_key, english_text, runyankore_text, source, domain, approved, created_at, updated_at)
          values (${crypto.randomUUID()}, ${key}, ${pair.english}, ${pair.runyankore}, ${source}, 'devotional', ${approved}, now(), now())
        `;
        continue;
      }
      if (!(founder && data.approve)) continue;
      await sql`
        update translation_memory
        set runyankore_text = ${pair.runyankore}, source = 'correction', approved = true, updated_at = now()
        where english_key = ${key}
      `;
    }
    const stored = data.approve && founder ? "approved" : data.status;
    if (data.devotionId && data.englishVersion && data.runyankoreVersion) {
      await sql`
        insert into devotional_translation (devotional_id, english_version, runyankore_version, translation_status, translation_source, translation_model, translation_date)
        values (${data.devotionId}, ${data.englishVersion}, ${data.runyankoreVersion}, ${data.status}, ${stored}, ${data.model}, now())
        on conflict (devotional_id) do update set
          runyankore_version = excluded.runyankore_version,
          translation_status = excluded.translation_status,
          translation_source = ${stored},
          translation_model = excluded.translation_model,
          translation_date = now()
      `;
    }
    return { ok: true as const, approved: stored === "approved" };
  });
