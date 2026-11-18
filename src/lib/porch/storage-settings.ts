import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

/**
 * Studio: Cloudflare R2 for the Radio's files. Save its keys (checked with a test file first), then move
 * the files over from Vercel Blob in steps (the Radio keeps playing), then remove the Vercel copies.
 */
const rec = (input: unknown): Record<string, unknown> => (input && typeof input === "object" ? (input as Record<string, unknown>) : {});
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const BLOB_BASE = /^(https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com)\//i;

async function founder(sql: Sql, userId: string) {
  const rows = await sql.query<{ is_founder: unknown }>("select is_founder from profiles where user_id = $1", [userId]);
  const f = rows[0]?.is_founder;
  return f === true || f === 1 || f === "1" || f === "t" || f === "true";
}
async function studio(sql: Sql, userId: string) {
  const { canRunStudio } = await import("@/lib/porch/fm");
  return canRunStudio(sql, userId);
}

/** Where a phone should send a file: a signed Cloudflare link, or Vercel Blob as before. */
export const uploadPlace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ pathname: str(rec(input).pathname, 200) || "fm/file", contentType: str(rec(input).contentType, 100) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { mode: "none" as const };
    const { getR2, presign, publicUrl, freshKey } = await import("@/lib/porch/audio-store.server");
    const r2 = await getR2(sql);
    if (!r2) return { mode: "blob" as const };
    const key = freshKey(data.pathname);
    return { mode: "r2" as const, putUrl: presign(r2, "PUT", key, {}, 6 * 3600), url: publicUrl(r2, key) };
  });

/** What the Studio shows: whether R2 is on, and how many files are still on Vercel. */
export const storageInfo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await founder(sql, context.userId))) return { ok: false as const };
    const rows = await sql.query<{ r2_endpoint: string; r2_access_key: string; r2_bucket: string; r2_public: string; use_r2: unknown; moved_at: string | null }>(
      "select r2_endpoint, r2_access_key, r2_bucket, r2_public, use_r2, moved_at from storage_settings where id = 1",
    );
    const r = rows[0];
    return {
      ok: true as const,
      on: r?.use_r2 === true || r?.use_r2 === "t",
      hasKeys: Boolean(r?.r2_access_key),
      bucket: r?.r2_bucket ?? "porchbook-radio",
      publicBase: r?.r2_public ?? "",
      endpoint: r?.r2_endpoint ?? "",
      moved: Boolean(r?.moved_at),
    };
  });

/** Save the R2 keys (founder only). A small test file is written, read back publicly and removed first. */
export const saveStorageKeys = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const r = rec(input);
    return { endpoint: str(r.endpoint, 300), accessKey: str(r.accessKey, 200), secret: str(r.secret, 300), bucket: str(r.bucket, 80) || "porchbook-radio", publicBase: str(r.publicBase, 300) };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await founder(sql, context.userId))) return { ok: false as const, error: "Only the founder can do this." };
    const endpoint = data.endpoint.replace(/\/+$/, "").replace(/\/porchbook-radio$/i, "");
    if (!/^https:\/\/[a-z0-9]+\.(eu\.|fedramp\.)?r2\.cloudflarestorage\.com$/i.test(endpoint)) return { ok: false as const, error: "The endpoint should look like https://<account>.r2.cloudflarestorage.com" };
    if (!/^https:\/\/pub-[a-z0-9]+\.r2\.dev$/i.test(data.publicBase.replace(/\/+$/, "")) && !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(data.publicBase.replace(/\/+$/, "")))
      return { ok: false as const, error: "The public address should look like https://pub-….r2.dev" };
    if (data.accessKey.length < 16 || data.secret.length < 30) return { ok: false as const, error: "That Access Key ID or Secret doesn't look complete. Copy them again." };
    const store = await import("@/lib/porch/audio-store.server");
    const r2 = { endpoint, accessKey: data.accessKey, secret: data.secret, bucket: data.bucket, publicBase: data.publicBase.replace(/\/+$/, "") };
    // Test: write, read back through the public address, remove.
    try {
      const key = `porchbook-check-${Date.now()}.txt`;
      const url = await store.r2Put(r2, key, Buffer.from("porchbook"), "text/plain");
      const back = await fetch(url, { cache: "no-store" });
      await store.r2Delete(r2, key);
      if (!back.ok) return { ok: false as const, error: `The file saved, but the public address didn't give it back (${back.status}). Check Public Development URL is on and the address is right.` };
    } catch (error) {
      const why = error instanceof Error && !/fetch failed/i.test(error.message) ? error.message : "Couldn't reach Cloudflare.";
      return { ok: false as const, error: `${why} Check the keys, the endpoint and that the token can write to ${data.bucket}.` };
    }
    await sql.query(
      "update storage_settings set r2_endpoint = $1, r2_access_key = $2, r2_secret = $3, r2_bucket = $4, r2_public = $5, use_r2 = true where id = 1",
      [endpoint, data.accessKey, data.secret, data.bucket, r2.publicBase],
    );
    store.forgetR2();
    return { ok: true as const };
  });

/**
 * One step of the move: copy Vercel files to R2 (same names) for about 40 seconds, and say how far it got.
 * When everything is copied, every link in the database is switched to the R2 copy in one go.
 */
export const moveStep = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await founder(sql, context.userId))) return { ok: false as const, error: "Only the founder can do this." };
    if (!process.env.BLOB_READ_WRITE_TOKEN) return { ok: false as const, error: "Vercel storage isn't connected." };
    const store = await import("@/lib/porch/audio-store.server");
    const r2 = await store.getR2(sql, true);
    if (!r2) return { ok: false as const, error: "Save the Cloudflare keys first." };
    const started = Date.now();
    const { list } = await import("@vercel/blob");
    const blobs: { url: string; pathname: string; size: number; contentType?: string }[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 30; page += 1) {
      const res = await list({ cursor, limit: 1000 });
      blobs.push(...res.blobs.map((b) => ({ url: b.url, pathname: b.pathname, size: b.size })));
      if (!res.hasMore || !res.cursor) break;
      cursor = res.cursor;
    }
    const there = new Set((await store.r2List(r2)).map((o) => o.key));
    const todo = blobs.filter((b) => !there.has(b.pathname));
    let copied = 0;
    for (const b of todo) {
      if (Date.now() - started > 40_000) break;
      const res = await fetch(b.url);
      if (!res.ok) continue; // gone in the meantime
      const body = Buffer.from(await res.arrayBuffer());
      await store.r2Put(r2, b.pathname, body, res.headers.get("content-type") || "application/octet-stream");
      copied += 1;
    }
    const left = todo.length - copied;
    if (left > 0) return { ok: true as const, total: blobs.length, left, switched: false };
    // All copied: switch every link (any table, any text column) from Vercel to R2.
    const bases = [...new Set(blobs.map((b) => BLOB_BASE.exec(b.url)?.[1]).filter((x): x is string => Boolean(x)))];
    const cols = await sql.query<{ table_name: string; column_name: string; data_type: string }>(
      `select table_name, column_name, data_type from information_schema.columns
        where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb', 'json')`,
    );
    for (const base of bases) {
      for (const c of cols) {
        if (!/^[a-z0-9_]+$/i.test(c.table_name) || !/^[a-z0-9_]+$/i.test(c.column_name)) continue;
        const cast = c.data_type === "jsonb" ? "::jsonb" : c.data_type === "json" ? "::json" : "";
        await sql
          .query(
            `update "${c.table_name}" set "${c.column_name}" = replace("${c.column_name}"::text, $1, $2)${cast} where "${c.column_name}"::text like $3`,
            [`${base}/`, `${r2.publicBase}/`, `%${base}/%`],
          )
          .catch(() => undefined);
      }
    }
    await sql.query("update storage_settings set moved_at = now() where id = 1");
    await sql.query("update radio_usage set checked_at = null where id = 1").catch(() => undefined);
    return { ok: true as const, total: blobs.length, left: 0, switched: true };
  });

/** After the move (and a check that the Radio plays): remove every file still on Vercel. */
export const finishMove = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await founder(sql, context.userId))) return { ok: false as const, error: "Only the founder can do this." };
    const rows = await sql.query<{ moved_at: string | null }>("select moved_at from storage_settings where id = 1");
    if (!rows[0]?.moved_at) return { ok: false as const, error: "Move the files first." };
    const { list, del } = await import("@vercel/blob");
    let removed = 0;
    for (let page = 0; page < 30; page += 1) {
      const res = await list({ limit: 1000 });
      if (!res.blobs.length) break;
      const urls = res.blobs.map((b) => b.url);
      for (let i = 0; i < urls.length; i += 100) await del(urls.slice(i, i + 100));
      removed += urls.length;
      if (!res.hasMore) break;
    }
    await sql.query("update radio_usage set checked_at = null where id = 1").catch(() => undefined);
    return { ok: true as const, removed };
  });
