import { createFileRoute } from "@tanstack/react-router";
import { readSite } from "@/lib/porch/phaneroo-site.server";
import { devotionPictureReport, phanerooPicture } from "@/lib/porch/devotion-page.server";
import { getSql } from "@/lib/db";

/** The devotional's daily picture, fetched from Phaneroo for the phone (Phaneroo's own pictures only). */
export const Route = createFileRoute("/api/devotion-picture")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // ?check=1 shows what today's devotional page offers as its picture (to find out why none shows).
        if (new URL(request.url).searchParams.get("check")) {
          const sql = await getSql();
          const rows = await sql.query<{ link: string }>("select link from read_docs where key = 'devotion' and porch_id = 1").catch(() => []);
          const report = await devotionPictureReport(rows[0]?.link ?? "");
          return new Response(JSON.stringify(report, null, 2), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
        }
        const target = phanerooPicture(new URL(request.url).searchParams.get("u") ?? "");
        if (!target) return new Response("Not a devotional picture.", { status: 400 });
        try {
          const response = await readSite(target, "image/*");
          const type = response.headers.get("content-type") ?? "";
          if (!response.ok || !type.startsWith("image/")) return new Response("No picture.", { status: 502 });
          const bytes = await response.arrayBuffer();
          if (bytes.byteLength > 3_000_000) return new Response("Too large.", { status: 413 });
          return new Response(bytes, { headers: { "content-type": type, "cache-control": "public, max-age=86400, immutable" } });
        } catch {
          return new Response("No picture.", { status: 502 });
        }
      },
    },
  },
});
