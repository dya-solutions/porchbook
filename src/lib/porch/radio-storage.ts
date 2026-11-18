import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

/**
 * Studio: what takes the Radio's storage (Vercel Blob), and a clean-up of what isn't needed:
 * files nothing uses any more, the mixer's before/after samples, the bin, and (if chosen)
 * the originals kept so "evening out" a song can be undone.
 */
const rec = (input: unknown): Record<string, unknown> => (input && typeof input === "object" ? (input as Record<string, unknown>) : {});
const KINDS = ["unused", "samples", "bin", "originals"] as const;
type Kind = (typeof KINDS)[number];
const strip = (u: string) => u.split("?")[0];

async function studio(sql: Sql, userId: string) {
  const { canRunStudio } = await import("@/lib/porch/fm");
  return canRunStudio(sql, userId);
}

/** Every blob link written anywhere in the database (any table, any column). */
async function everyLinkInUse(sql: Sql, pattern: string) {
  const tables = await sql.query<{ name: string }>("select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'");
  const used = new Set<string>();
  for (const { name } of tables) {
    if (!/^[a-z0-9_]+$/i.test(name)) continue;
    const rows = await sql
      .query<{ u: string }>(
        `select distinct m[1] as u from (select regexp_matches(t::text, $1, 'g') as m from "${name}" t) x`,
        [pattern],
      )
      .catch(() => []);
    for (const r of rows) used.add(strip(r.u));
  }
  return used;
}

async function survey(sql: Sql) {
  const store = await import("@/lib/porch/audio-store.server");
  const r2 = await store.cloudStore(sql);
  const blobs = (await store.listStore(sql)).map((b) => ({ url: strip(b.url), size: b.size, uploadedAt: new Date(b.at) }));
  const host = r2 ? r2.publicBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "https://[a-z0-9.-]+\\.public\\.blob\\.vercel-storage\\.com";
  const pattern = `${host}/[^"\\\\ ,)<>]+`;
  const samples = new Set(
    (await sql.query<{ before_url: string | null; after_url: string | null }>("select before_url, after_url from fm_previews").catch(() => []))
      .flatMap((r) => [r.before_url, r.after_url])
      .filter((u): u is string => Boolean(u))
      .map(strip),
  );
  const bin = new Set((await sql.query<{ url: string }>("select url from fm_trash").catch(() => [])).map((r) => strip(r.url)));
  const originals = new Set(
    (await sql.query<{ original_url: string }>("select original_url from fm_tracks where original_url is not null and original_url <> url").catch(() => [])).map((r) => strip(r.original_url)),
  );
  const used = await everyLinkInUse(sql, pattern);
  const dayAgo = Date.now() - 24 * 3600_000;
  const groups: Record<Kind | "kept", { urls: string[]; bytes: number }> = {
    unused: { urls: [], bytes: 0 },
    samples: { urls: [], bytes: 0 },
    bin: { urls: [], bytes: 0 },
    originals: { urls: [], bytes: 0 },
    kept: { urls: [], bytes: 0 },
  };
  for (const b of blobs) {
    const kind: Kind | "kept" = samples.has(b.url)
      ? "samples"
      : bin.has(b.url)
        ? "bin"
        : originals.has(b.url)
          ? "originals"
          : !used.has(b.url) && b.uploadedAt.getTime() < dayAgo // a file from today may still be on its way into use
            ? "unused"
            : "kept";
    groups[kind].urls.push(b.url);
    groups[kind].bytes += b.size;
  }
  return { groups, total: blobs.reduce((n, b) => n + b.size, 0), files: blobs.length };
}

const summary = (g: Awaited<ReturnType<typeof survey>>) => ({
  total: g.total,
  files: g.files,
  groups: (["unused", "samples", "bin", "originals", "kept"] as const).map((k) => ({ kind: k, files: g.groups[k].urls.length, bytes: g.groups[k].bytes })),
});

/** Look: what takes the storage. Clean: delete the chosen kinds (never what's in use). */
export const radioStorage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const r = rec(input);
    const take = Array.isArray(r.take) ? (r.take as unknown[]).filter((k): k is Kind => (KINDS as readonly string[]).includes(String(k))) : [];
    return { clean: r.clean === true, take };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { ok: false as const, error: "Only the Studio can do this." };
    const cloud = await (await import("@/lib/porch/audio-store.server")).cloudStore(sql);
    if (!cloud && !process.env.BLOB_READ_WRITE_TOKEN) return { ok: false as const, error: "Audio storage isn't connected." };
    try {
      const before = await survey(sql);
      if (!data.clean || !data.take.length) return { ok: true as const, ...summary(before), freed: 0 };
      const { storeDelete } = await import("@/lib/porch/audio-store.server");
      let freed = 0;
      for (const kind of data.take) {
        const { urls, bytes } = before.groups[kind];
        await storeDelete(sql, urls);
        freed += bytes;
        if (kind === "samples") await sql.query("update fm_previews set before_url = null, after_url = null").catch(() => undefined);
        if (kind === "bin") await sql.query("delete from fm_trash").catch(() => undefined);
        if (kind === "originals") await sql.query("update fm_tracks set original_url = null where original_url is not null and original_url <> url").catch(() => undefined);
      }
      const after = await survey(sql);
      await sql.query("update radio_usage set storage_bytes = $1, files = $2, checked_at = now() where id = 1", [after.total, after.files]).catch(() => undefined);
      return { ok: true as const, ...summary(after), freed };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Couldn't read the storage." };
    }
  });
