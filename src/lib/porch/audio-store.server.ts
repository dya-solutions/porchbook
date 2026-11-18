import { createHash, createHmac } from "node:crypto";
import type { Sql } from "@/lib/db";

/**
 * Where Porchbook keeps audio and other files: Cloudflare R2 once its keys are saved
 * (free storage up to 10 GB, free listening), otherwise Vercel Blob as before.
 * R2 is spoken to with signed links (AWS Signature v4), so no extra package is needed.
 */
export type R2 = { endpoint: string; accessKey: string; secret: string; bucket: string; publicBase: string };

const BLOB_HOST = /^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\//i;
const bool = (v: unknown) => v === true || v === 1 || v === "1" || v === "t" || v === "true";

let memo: { at: number; r2: R2 | null } | null = null;
/** The saved R2 settings, when switched on (kept for a minute). */
export async function getR2(sql: Sql, fresh = false): Promise<R2 | null> {
  if (!fresh && memo && Date.now() - memo.at < 60_000) return memo.r2;
  const rows = await sql
    .query<{ r2_endpoint: string; r2_access_key: string; r2_secret: string; r2_bucket: string; r2_public: string; use_r2: unknown }>(
      "select r2_endpoint, r2_access_key, r2_secret, r2_bucket, r2_public, use_r2 from storage_settings where id = 1",
    )
    .catch(() => []);
  const r = rows[0];
  const r2 = r && bool(r.use_r2) && r.r2_access_key && r.r2_secret && r.r2_endpoint && r.r2_public
    ? { endpoint: r.r2_endpoint.replace(/\/+$/, ""), accessKey: r.r2_access_key, secret: r.r2_secret, bucket: r.r2_bucket || "porchbook-radio", publicBase: r.r2_public.replace(/\/+$/, "") }
    : null;
  memo = { at: Date.now(), r2 };
  return r2;
}
export const forgetR2 = () => {
  memo = null;
};

// ---- Signing ---------------------------------------------------------------------

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
const sha = (data: string) => createHash("sha256").update(data).digest("hex");

/** A signed link for one request to the bucket (valid for `expires` seconds). */
export function presign(r2: R2, method: string, key: string, query: Record<string, string> = {}, expires = 3600) {
  const url = new URL(r2.endpoint);
  const host = url.host;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/auto/s3/aws4_request`;
  const path = `/${r2.bucket}${key ? `/${key.split("/").map(enc).join("/")}` : ""}`;
  const params: Record<string, string> = {
    ...query,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${r2.accessKey}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${enc(k)}=${enc(params[k])}`)
    .join("&");
  const canonical = [method, path, canonicalQuery, `host:${host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${r2.secret}`, day), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  return `${url.protocol}//${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export const publicUrl = (r2: R2, key: string) => `${r2.publicBase}/${key.split("/").map(enc).join("/")}`;
/** The bucket key of one of our R2 links ("" if it isn't one). */
export function keyOf(r2: R2, url: string) {
  const base = `${r2.publicBase}/`;
  return url.startsWith(base) ? decodeURIComponent(url.slice(base.length).split("?")[0]) : "";
}
/** A safe, unique name for a new file, keeping its folder ("fm/", "bible/", …) and ending. */
export function freshKey(pathname: string) {
  const clean = pathname.replace(/^\/+/, "").replace(/[^a-zA-Z0-9/._-]+/g, "-").slice(-160);
  const dot = clean.lastIndexOf(".");
  const stem = dot > clean.lastIndexOf("/") ? clean.slice(0, dot) : clean;
  const ext = dot > clean.lastIndexOf("/") ? clean.slice(dot) : "";
  return `${stem}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${ext}`;
}

export async function r2Put(r2: R2, key: string, body: Buffer | Uint8Array, contentType: string) {
  const res = await fetch(presign(r2, "PUT", key), { method: "PUT", headers: { "content-type": contentType }, body: body as BodyInit });
  if (!res.ok) throw new Error(`Cloudflare didn't take the file (${res.status}).`);
  return publicUrl(r2, key);
}
export async function r2Delete(r2: R2, key: string) {
  await fetch(presign(r2, "DELETE", key), { method: "DELETE" }).catch(() => undefined);
}
/** Every file in the bucket, with its size. */
export async function r2List(r2: R2) {
  const out: { key: string; size: number; at: number }[] = [];
  let token = "";
  for (let page = 0; page < 50; page += 1) {
    const query: Record<string, string> = { "list-type": "2", "max-keys": "1000" };
    if (token) query["continuation-token"] = token;
    const res = await fetch(presign(r2, "GET", "", query));
    if (!res.ok) throw new Error(`Couldn't list the Cloudflare files (${res.status}).`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = /<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1] ?? "";
      const size = Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? 0);
      const at = Date.parse(/<LastModified>([^<]+)<\/LastModified>/.exec(m[1])?.[1] ?? "") || 0;
      if (key) out.push({ key: key.replace(/&amp;/g, "&"), size, at });
    }
    const next = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1];
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml) || !next) break;
    token = next.replace(/&amp;/g, "&");
  }
  return out;
}

// ---- One way in, whichever store is in use -------------------------------------------

/** Is this one of our stored files (Blob, or our R2 bucket)? */
export async function isStoreUrl(sql: Sql, url: string, folder = "") {
  if (BLOB_HOST.test(url)) return !folder || new URL(url).pathname.startsWith(`/${folder}`);
  const r2 = await getR2(sql);
  if (!r2) return false;
  const key = keyOf(r2, url);
  return Boolean(key) && (!folder || key.startsWith(folder));
}

/** Save a file from the server; returns its public link. */
export async function storePut(sql: Sql, pathname: string, body: Buffer, contentType: string) {
  const r2 = await getR2(sql);
  if (r2) return r2Put(r2, freshKey(pathname), body, contentType);
  const { put } = await import("@vercel/blob");
  const saved = await put(pathname, body, { access: "public", contentType, addRandomSuffix: true, cacheControlMaxAge: 60 * 60 * 24 * 30 });
  return saved.url;
}

/** Remove stored files (either store). Never throws. */
export async function storeDelete(sql: Sql, urls: (string | null | undefined)[]) {
  const list = urls.filter((u): u is string => Boolean(u));
  if (!list.length) return;
  const blobs = list.filter((u) => BLOB_HOST.test(u));
  if (blobs.length && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { del } = await import("@vercel/blob");
      for (let i = 0; i < blobs.length; i += 100) await del(blobs.slice(i, i + 100));
    } catch {
      /* left; Clean up removes it */
    }
  }
  const r2 = await getR2(sql);
  if (r2) for (const u of list) if (keyOf(r2, u)) await r2Delete(r2, keyOf(r2, u));
}

/**
 * Where an upload goes. With R2: a signed link the phone (or audio server) PUTs the file to, and the
 * file's public link. Without: Vercel Blob's own one-off pass, as before.
 */
export async function uploadSpot(sql: Sql, pathname: string, opts: { contentTypes: string[]; maxBytes: number }) {
  const r2 = await getR2(sql);
  if (r2) {
    const key = freshKey(pathname);
    return { mode: "r2" as const, putUrl: presign(r2, "PUT", key, {}, 6 * 3600), url: publicUrl(r2, key), pathname: key };
  }
  const readWrite = process.env.BLOB_READ_WRITE_TOKEN;
  if (!readWrite) throw new Error("audio storage isn't connected");
  const { generateClientTokenFromReadWriteToken } = await import("@vercel/blob/client");
  const clientToken = await generateClientTokenFromReadWriteToken({
    token: readWrite,
    pathname,
    allowedContentTypes: opts.contentTypes,
    maximumSizeInBytes: opts.maxBytes,
    validUntil: Date.now() + 2 * 3600_000,
  });
  return { mode: "blob" as const, clientToken, pathname };
}

/** A quick (non-waiting) checker for our stored links, for filtering lists. */
export async function storeUrlChecker(sql: Sql) {
  const r2 = await getR2(sql);
  return (url: unknown, folder = "") => {
    if (typeof url !== "string") return false;
    if (BLOB_HOST.test(url)) return !folder || new URL(url).pathname.startsWith(`/${folder}`);
    const key = r2 ? keyOf(r2, url) : "";
    return Boolean(key) && (!folder || key.startsWith(folder));
  };
}

/** The R2 settings once the files have been moved there (Vercel is then no longer counted). */
export async function cloudStore(sql: Sql) {
  const moved = await sql.query<{ moved_at: string | null }>("select moved_at from storage_settings where id = 1").catch(() => []);
  return moved[0]?.moved_at ? getR2(sql) : null;
}

/** Every stored file in the store in use: link, size, when saved. */
export async function listStore(sql: Sql) {
  const r2 = await cloudStore(sql);
  if (r2) return (await r2List(r2)).map((o) => ({ url: publicUrl(r2, o.key), size: o.size, at: o.at }));
  const { list } = await import("@vercel/blob");
  const out: { url: string; size: number; at: number }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 30; page += 1) {
    const res = await list({ cursor, limit: 1000 });
    out.push(...res.blobs.map((b) => ({ url: b.url.split("?")[0], size: b.size, at: new Date(b.uploadedAt).getTime() })));
    if (!res.hasMore || !res.cursor) break;
    cursor = res.cursor;
  }
  return out;
}
