import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { ensureDbReady, getSql } from "@/lib/db";

/**
 * Backup route for calls. Phones whose network blocks the direct connection
 * to the call server (seen on MTN mobile data) send their call messages here;
 * this forwards them to the call server over plain HTTP and hands back what
 * is waiting for them. Signed-in members only, and a phone can only join the
 * line as its own account.
 */
const RELAY_URL = (process.env.CALL_RELAY_URL || "https://porchbook-calls.onrender.com/relay").trim();

function about(request: Request) {
  const ua = (request.headers.get("user-agent") || "").replace(/\s+/g, " ");
  const device = (ua.match(/\(([^)]*)\)/)?.[1] ?? "").split(";").slice(0, 3).join(";").trim();
  const browser = ua.match(/(Chrome|Firefox|Safari|SamsungBrowser|wv)\/?[\d.]*/)?.[0] ?? "";
  return `${device} | ${browser} | via porchbook`;
}

export const Route = createFileRoute("/api/line-relay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        await ensureDbReady();
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) return Response.json({ error: "Sign in first." }, { status: 401 });
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ error: "Bad request." }, { status: 400 });
        }
        const op = body.op;
        let forward: Record<string, unknown>;
        if (op === "register") {
          const sql = await getSql();
          const rows = await sql.query<{ display_name: string }>("select display_name from profiles where user_id = $1", [session.user.id]);
          forward = {
            op,
            name: session.user.id,
            label: rows[0]?.display_name || session.user.name || "",
            about: about(request),
          };
        } else if (op === "poll" || op === "send" || op === "leave") {
          forward = { op, session: String(body.session || "").slice(0, 64) };
          if (op === "send") forward.message = body.message;
        } else {
          return Response.json({ error: "Bad request." }, { status: 400 });
        }
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (process.env.RELAY_KEY) headers["x-relay-key"] = process.env.RELAY_KEY;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 9000);
        try {
          const response = await fetch(RELAY_URL, { method: "POST", headers, body: JSON.stringify(forward), signal: controller.signal });
          const text = await response.text();
          return new Response(text, { status: response.ok ? 200 : 502, headers: { "content-type": "application/json", "cache-control": "no-store" } });
        } catch {
          // The call server is asleep (free plan) and waking up; the phone retries.
          return Response.json({ waking: true }, { headers: { "cache-control": "no-store" } });
        } finally {
          clearTimeout(timer);
        }
      },
    },
  },
});
