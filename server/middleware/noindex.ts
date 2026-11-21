/**
 * The private test site (PORCH_NOINDEX=1 in Vercel's settings) asks search engines not to list it:
 * every page carries "X-Robots-Tag: noindex, nofollow", and /robots.txt says "Disallow: /".
 * A future real site leaves PORCH_NOINDEX unset, so nothing here applies to it.
 */
interface NoIndexEvent {
  url: URL;
  req: { method: string; headers: Headers };
}

export default async function noIndexMiddleware(event: NoIndexEvent, next: () => unknown | Promise<unknown>): Promise<unknown> {
  if (process.env.PORCH_NOINDEX !== "1") return next();
  if (event.url.pathname === "/robots.txt") {
    return new Response("User-agent: *\nDisallow: /\n", {
      headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, nofollow" },
    });
  }
  const result = await next();
  if (result instanceof Response) {
    const headers = new Headers(result.headers);
    headers.set("x-robots-tag", "noindex, nofollow");
    return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
  }
  return result;
}
