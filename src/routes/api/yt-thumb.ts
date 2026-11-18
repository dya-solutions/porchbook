import { createFileRoute } from "@tanstack/react-router";

/**
 * A YouTube video's picture, fetched here so the porch guy's screen can draw it
 * (pictures from another site can't be painted into his 3D screen directly).
 */
export const Route = createFileRoute("/api/yt-thumb")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const id = new URL(request.url).searchParams.get("id") ?? "";
        if (!/^[\w-]{11}$/.test(id)) return new Response("Missing.", { status: 404 });
        for (const name of ["maxresdefault_live.jpg", "hqdefault_live.jpg", "maxresdefault.jpg", "hqdefault.jpg"]) {
          try {
            const res = await fetch(`https://i.ytimg.com/vi/${id}/${name}`, { signal: AbortSignal.timeout(6000) });
            if (!res.ok) continue;
            const bytes = new Uint8Array(await res.arrayBuffer());
            if (bytes.length < 2000) continue; // YouTube's grey "no picture" placeholder
            return new Response(bytes, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=60, s-maxage=60" } });
          } catch {
            /* try the next size */
          }
        }
        return new Response("Missing.", { status: 404 });
      },
    },
  },
});
