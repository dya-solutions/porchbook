import { createFileRoute } from "@tanstack/react-router";
import { appendFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "@/lib/auth/server";
import { getSql } from "@/lib/db";
import { myPorchId, porchTables } from "@/lib/porch/porch-foundation";

const MAX_BYTES = 48 * 1024 * 1024;
const CHUNK_BYTES = 700_000;

function videoMime(name: string, type: string): string | null {
  const fileName = name.toLowerCase();
  const fileType = type.toLowerCase();
  if (fileName.endsWith(".webm") || fileType === "video/webm") return "video/webm";
  if (fileName.endsWith(".mov") || fileName.endsWith(".qt") || fileType === "video/quicktime") return "video/quicktime";
  if (
    fileName.endsWith(".mp4") ||
    fileName.endsWith(".m4v") ||
    fileType === "video/mp4" ||
    fileType === "video/x-m4v" ||
    fileType === "application/mp4"
  ) {
    return "video/mp4";
  }
  if (fileType.startsWith("video/")) return fileType.slice(0, 40);
  return null;
}

function videoDir() {
  return path.join(process.cwd(), "data", "previously");
}

/** One video per church porch (Phaneroo keeps the original file name). */
function videoPath(porch: number) {
  return path.join(videoDir(), porch === 1 ? "video" : `video-${porch}`);
}

function partPath(porch: number) {
  return path.join(videoDir(), porch === 1 ? "upload.bin" : `upload-${porch}.bin`);
}

async function founder(userId: string) {
  const sql = await getSql();
  const me = await sql.query<{ is_founder: unknown }>("select is_porch_admin($1) as is_founder", [userId]);
  const value = me[0]?.is_founder;
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

/** After a Blob upload: record the video's address for the admin's church porch. */
async function saveBlobVideo(request: Request, body: Record<string, unknown>) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  if (!(await founder(session.user.id))) return Response.json({ ok: false, error: "Only an admin can upload this video." }, { status: 403 });
  const url = typeof body.url === "string" ? body.url : "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  if (!host.endsWith(".blob.vercel-storage.com")) return Response.json({ ok: false, error: "That video address isn't ours." }, { status: 400 });
  const mime = videoMime(String(body.name ?? "video.mp4"), String(body.type ?? "")) ?? "video/mp4";
  const sql = await getSql();
  const porch = await myPorchId(sql, session.user.id);
  if (!porch) return Response.json({ ok: false, error: "Join a porch first." }, { status: 403 });
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
  await sql`
    insert into previous_clip (porch_id, id, kind, youtube_id, url, mime, updated_at)
    values (${porch}, 1, 'file', null, ${url}, ${mime}, now())
    on conflict (porch_id, id) do update
      set kind = 'file', youtube_id = null, url = ${url}, mime = ${mime}, updated_at = now()
  `;
  return Response.json({ ok: true });
}

export const Route = createFileRoute("/api/previously")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) return new Response("Sign in to watch.", { status: 401 });
        const sql = await getSql();
        const porch = await myPorchId(sql, session.user.id);
        const rows = await sql.query<{ mime: string | null; kind: string; url: string | null }>(
          "select mime, kind, url from previous_clip where id = 1 and porch_id = $1",
          [porch],
        );
        if (rows[0]?.kind !== "file") return new Response("No uploaded video.", { status: 404 });
        // Online, the video lives in Vercel Blob (files on disk don't survive on Vercel).
        if (rows[0].url) return Response.redirect(rows[0].url, 302);
        try {
          const bytes = await readFile(videoPath(porch));
          return new Response(bytes, {
            headers: {
              "content-type": rows[0].mime || "video/mp4",
              "cache-control": "private, no-store",
            },
          });
        } catch {
          return new Response("That video is missing.", { status: 404 });
        }
      },
      POST: async ({ request }) => {
        // Online (a Vercel Blob store is connected): the phone sends the video straight to Blob
        // with a one-off token, then tells us its address. Big files never pass through here.
        if (process.env.BLOB_READ_WRITE_TOKEN && (request.headers.get("content-type") || "").includes("application/json")) {
          const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
          if (body && body.action === "saved") return saveBlobVideo(request, body);
          const { handleUpload } = await import("@vercel/blob/client");
          try {
            const result = await handleUpload({
              body: body as never,
              request,
              onBeforeGenerateToken: async () => {
                const session = await auth.api.getSession({ headers: request.headers });
                if (!session?.user || !(await founder(session.user.id))) throw new Error("Only an admin can upload this video.");
                return { allowedContentTypes: ["video/*"], maximumSizeInBytes: MAX_BYTES, addRandomSuffix: true };
              },
            });
            return Response.json(result);
          } catch (error) {
            return Response.json({ error: error instanceof Error ? error.message : "Upload refused." }, { status: 400 });
          }
        }
        if (process.env.VERCEL) return Response.json({ ok: false, error: "Video storage isn't connected yet." }, { status: 503 });
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
        if (!(await founder(session.user.id))) {
          return Response.json({ ok: false, error: "Only an admin can upload this video." }, { status: 403 });
        }
        const url = new URL(request.url);
        const part = Number(url.searchParams.get("part") ?? "0");
        const parts = Number(url.searchParams.get("parts") ?? "1");
        const name = (url.searchParams.get("name") ?? "video.mp4").slice(0, 120);
        const mime = videoMime(name, url.searchParams.get("type") ?? "");
        if (!mime) return Response.json({ ok: false, error: "Use an mp4, mov, or webm video." }, { status: 400 });
        if (!Number.isInteger(part) || !Number.isInteger(parts) || parts < 1 || parts > 80 || part < 0 || part >= parts) {
          return Response.json({ ok: false, error: "That video didn't upload. Try it again." }, { status: 400 });
        }
        const porch = await myPorchId(await getSql(), session.user.id);
        if (!porch) return Response.json({ ok: false, error: "Join a porch first." }, { status: 403 });
        let bytes: Uint8Array;
        try {
          bytes = new Uint8Array(await request.arrayBuffer());
        } catch {
          return Response.json({ ok: false, error: "That piece of the video didn't arrive. Try again." }, { status: 400 });
        }
        if (!bytes.byteLength || bytes.byteLength > CHUNK_BYTES) {
          return Response.json({ ok: false, error: "That video didn't upload. Try a shorter one." }, { status: 400 });
        }
        try {
          await mkdir(videoDir(), { recursive: true });
          if (part === 0) await writeFile(partPath(porch), bytes);
          else await appendFile(partPath(porch), bytes);
          if (part < parts - 1) return Response.json({ ok: true, part });
          const saved = await stat(partPath(porch));
          if (saved.size > MAX_BYTES) {
            await unlink(partPath(porch)).catch(() => undefined);
            return Response.json({ ok: false, error: "That video is larger than 48 MB." }, { status: 400 });
          }
          await rename(partPath(porch), videoPath(porch));
          const sql = await getSql();
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
          await sql`
            insert into previous_clip (porch_id, id, kind, youtube_id, url, mime, updated_at)
            values (${porch}, 1, 'file', null, null, ${mime}, now())
            on conflict (porch_id, id) do update
              set kind = 'file', youtube_id = null, url = null, mime = ${mime}, updated_at = now()
          `;
        } catch {
          return Response.json({ ok: false, error: "The video could not be saved. Try it again." }, { status: 500 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});