import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { readSite } from "@/lib/porch/phaneroo-site.server";
import { devotionPage, devotionPicture, inside, phanerooArticle, publicPage, tongues, withDevotionPicture } from "@/lib/porch/devotion-page.server";

export const Route = createFileRoute("/api/browse")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const headers = new Headers(request.headers);
        const token = url.searchParams.get("t");
        if (token && !headers.get("authorization")) headers.set("authorization", `Bearer ${token}`);
        const session = await auth.api.getSession({ headers });
        if (!session?.user) return new Response("Sign in to open this page.", { status: 401 });
        const page = publicPage(url.searchParams.get("url") ?? "");
        if (!page) return new Response("That page cannot be opened here.", { status: 400 });
        let response: Response;
        try {
          response = await readSite(page, "text/html");
        } catch {
          const article = await phanerooArticle(page);
          const devotion = article ? devotionPage(article) : "";
          if (devotion) {
            return new Response(devotion.slice(0, 1_500_000), {
              headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
            });
          }
          return new Response("That page did not open.", { status: 502 });
        }
        const type = response.headers.get("content-type") ?? "";
        const raw = type.includes("text/html") ? await response.text() : "";
        const article = await phanerooArticle(page);
        const best = [raw, article]
          .filter((html) => html)
          .sort((left, right) => {
            const score = (html: string) => {
              const found = tongues(html);
              const runya = found.find((item) => item.name === "Runyankole");
              return found.length * 1000 + (runya ? runya.lines.join(" ").length : 0);
            };
            return score(right) - score(left);
          })[0] ?? "";
        const plain = best ? devotionPage(best) : "";
        const devotion = plain ? withDevotionPicture(plain, await devotionPicture(raw, page).catch(() => "")) : "";
        if (!devotion && !raw) {
          return new Response(type.includes("text/html") ? "That page did not open." : "That page cannot be shown inside Porchbook.", {
            status: type.includes("text/html") ? 502 : 415,
          });
        }
        const html = devotion || inside(raw, response.url || page.href);
        return new Response(html.slice(0, 1_500_000), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      },
    },
  },
});
