import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { getSql, ensureDbReady } from "@/lib/db";
import { canRunStudio } from "@/lib/porch/fm";

const MAX_AUDIO = 1024 * 1024 * 1024; // 1 GB: a long sermon, or a video whose sound is taken out
const FALLBACK_MAX = 4 * 1024 * 1024; // without Blob, small files only (tests)

async function studioUser(request: Request) {
  await ensureDbReady();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return null;
  const sql = await getSql();
  return (await canRunStudio(sql, session.user.id)) ? session.user.id : null;
}

/**
 * Porchbook Radio uploads.
 * - With a Vercel Blob store connected: hands the phone a one-off token so the
 *   audio goes straight to Blob (big files never pass through this server).
 * - Without one: accepts small files into the database (local testing).
 * GET ?mode reports which is available.
 */
export const Route = createFileRoute("/api/fm-upload")({
  server: {
    handlers: {
      GET: async () => {
        await ensureDbReady();
        const { getR2 } = await import("@/lib/porch/audio-store.server");
        const r2 = await getR2(await getSql()).catch(() => null);
        return Response.json({ blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN) || Boolean(r2) });
      },
      POST: async ({ request }) => {
        if (process.env.BLOB_READ_WRITE_TOKEN && (request.headers.get("content-type") || "").includes("application/json")) {
          const { handleUpload } = await import("@vercel/blob/client");
          const body = await request.json();
          try {
            const result = await handleUpload({
              body,
              request,
              onBeforeGenerateToken: async () => {
                if (!(await studioUser(request))) throw new Error("Only the studio can upload.");
                return {
                  allowedContentTypes: ["audio/*", "video/*"],
                  maximumSizeInBytes: MAX_AUDIO,
                  addRandomSuffix: true,
                  cacheControlMaxAge: 60 * 60 * 24 * 365,
                };
              },
            });
            return Response.json(result);
          } catch (error) {
            return Response.json({ error: error instanceof Error ? error.message : "Upload refused." }, { status: 400 });
          }
        }
        // Fallback: small file straight into the database.
        if (!(await studioUser(request))) return Response.json({ error: "Only the studio can upload." }, { status: 403 });
        const mime = request.headers.get("content-type") || "";
        if (!mime.startsWith("audio/")) return Response.json({ error: "Choose an audio file." }, { status: 400 });
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.length > FALLBACK_MAX) {
          return Response.json({ error: "Audio storage isn't connected yet, so only small files fit for now." }, { status: 413 });
        }
        const sql = await getSql();
        const rows = await sql.query<{ id: number }>("insert into fm_files (mime, data) values ($1, $2) returning id", [
          mime,
          Buffer.from(bytes).toString("base64"),
        ]);
        return Response.json({ url: `/api/fm-file?id=${rows[0].id}` });
      },
    },
  },
});
