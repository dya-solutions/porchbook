import { createFileRoute } from "@tanstack/react-router";
import { appendFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "@/lib/auth/server";
import { getSql } from "@/lib/db";

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

function videoPath() {
  return path.join(videoDir(), "video");
}

function partPath() {
  return path.join(videoDir(), "upload.bin");
}

async function founder(userId: string) {
  const sql = await getSql();
  const me = await sql.query<{ is_founder: unknown }>("select is_porch_admin($1) as is_founder", [userId]);
  const value = me[0]?.is_founder;
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

export const Route = createFileRoute("/api/previously")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) return new Response("Sign in to watch.", { status: 401 });
        const sql = await getSql();
        const rows = await sql.query<{ mime: string | null; kind: string }>(
          "select mime, kind from previous_clip where id = 1",
        );
        if (rows[0]?.kind !== "file") return new Response("No uploaded video.", { status: 404 });
        try {
          const bytes = await readFile(videoPath());
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
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
        if (!(await founder(session.user.id))) {
          return Response.json({ ok: false, error: "Only the founder can upload this video." }, { status: 403 });
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
          if (part === 0) await writeFile(partPath(), bytes);
          else await appendFile(partPath(), bytes);
          if (part < parts - 1) return Response.json({ ok: true, part });
          const saved = await stat(partPath());
          if (saved.size > MAX_BYTES) {
            await unlink(partPath()).catch(() => undefined);
            return Response.json({ ok: false, error: "That video is larger than 48 MB." }, { status: 400 });
          }
          await rename(partPath(), videoPath());
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
          await sql`
            insert into previous_clip (id, kind, youtube_id, url, mime, updated_at)
            values (1, 'file', null, null, ${mime}, now())
            on conflict (id) do update
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