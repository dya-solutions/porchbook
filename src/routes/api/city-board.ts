import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { getSql } from "@/lib/db";

const MAX_BYTES = 48 * 1024 * 1024;
const CHUNK_BYTES = 700_000;
const MAX_ITEMS = 24;

type Item = { id: string; kind: string; title: string; body: string };

function boolish(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

function clip(value: string, max: number) {
  return value.trim().slice(0, max);
}

function safeId(value: string) {
  return /^[0-9a-f-]{36}$/i.test(value) ? value : "";
}

function fileMime(kind: string, name: string, type: string) {
  const fileName = name.toLowerCase();
  const fileType = type.toLowerCase();
  if (kind === "flyer" || kind === "dash") {
    if (kind === "dash") return fileName.endsWith(".png") || fileType === "image/png" ? "image/png" : null;
    if (fileName.endsWith(".png") || fileType === "image/png") return "image/png";
    if (fileName.endsWith(".webp") || fileType === "image/webp") return "image/webp";
    if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg") || fileType === "image/jpg" || fileType === "image/jpeg" || fileType === "image/pjpeg") {
      return "image/jpeg";
    }
    return null;
  }
  if (kind === "video") {
    if (fileName.endsWith(".webm") || fileType === "video/webm") return "video/webm";
    if (fileName.endsWith(".mov") || fileName.endsWith(".qt") || fileType === "video/quicktime") return "video/quicktime";
    if (fileName.endsWith(".mp4") || fileName.endsWith(".m4v") || fileType === "video/mp4" || fileType === "video/x-m4v") return "video/mp4";
    return null;
  }
  return null;
}

function asBytes(value: unknown) {
  if (!value) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") {
    return value.startsWith("\\x") ? Buffer.from(value.slice(2), "hex") : Buffer.from(value, "base64");
  }
  return Buffer.alloc(0);
}

async function sessionOf(request: Request) {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  const token = url.searchParams.get("t");
  if (token && !headers.get("authorization")) headers.set("authorization", `Bearer ${token}`);
  return auth.api.getSession({ headers });
}

async function founder(userId: string) {
  const sql = await getSql();
  const me = await sql.query<{ is_founder: unknown }>("select is_porch_admin($1) as is_founder", [userId]);
  return boolish(me[0]?.is_founder);
}

async function ensure() {
  const sql = await getSql();
  await sql`
    create table if not exists city_board (
      id text primary key,
      kind text not null,
      title text not null default '',
      body text not null default '',
      mime text,
      bytes bytea,
      sort integer not null,
      created_at timestamptz not null default now()
    )
  `;
  await sql`alter table city_board add column if not exists bytes bytea`;
  await sql`alter table city_board add column if not exists dropped boolean not null default false`;
  await sql`
    create table if not exists city_board_part (
      id text not null,
      part integer not null,
      bytes bytea not null,
      primary key (id, part)
    )
  `;
  return sql;
}

async function dropItem(sql: Awaited<ReturnType<typeof ensure>>, id: string) {
  const marked = await sql.query<{ id: string }>(
    "update city_board set dropped = true where id = $1 returning id",
    [id],
  );
  if (!marked[0]) return false;
  await sql.query("delete from city_board_part where id = $1", [id]);
  void sql
    .query("update city_board set bytes = null where id = $1", [id])
    .then(() => sql.query("delete from city_board where id = $1", [id]))
    .catch(() => undefined);
  return true;
}

export const Route = createFileRoute("/api/city-board")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await sessionOf(request);
        if (!session?.user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
        const url = new URL(request.url);
        const id = safeId(url.searchParams.get("id") ?? "");
        const sql = await ensure();
        if (!id) {
          const items = await sql.query<Item>(
            "select id, kind, title, body from city_board where kind <> 'dash' and dropped is not true order by sort, created_at",
          );
          const dash = await sql.query<{ id: string }>("select id from city_board where kind = 'dash' limit 1");
          const mine = await founder(session.user.id);
          return Response.json({ ok: true, founder: mine, dash: Boolean(dash[0]), items });
        }
        const rows = await sql.query<{ mime: string | null; kind: string; bytes: unknown }>(
          "select mime, kind, bytes from city_board where id = $1 and dropped is not true",
          [id],
        );
        const row = rows[0];
        const bytes = asBytes(row?.bytes);
        if (!row || row.kind === "note" || !bytes.byteLength) return new Response("That file is missing.", { status: 404 });
        return new Response(new Uint8Array(bytes), {
          headers: {
            "content-type": row.mime || "application/octet-stream",
            "cache-control": "private, no-store",
          },
        });
      },
      POST: async ({ request }) => {
        const session = await sessionOf(request);
        if (!session?.user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
        if (!(await founder(session.user.id))) {
          return Response.json({ ok: false, error: "Only the founder can add an event." }, { status: 403 });
        }
        const url = new URL(request.url);
        const id = safeId(url.searchParams.get("id") ?? "");
        if (url.searchParams.get("drop") === "all") {
          const sql = await ensure();
          const rows = await sql.query<{ id: string }>("select id from city_board where kind <> 'dash' and dropped is not true");
          for (const row of rows) await dropItem(sql, row.id);
          return Response.json({ ok: true });
        }
        if (url.searchParams.get("drop") === "1") {
          if (!id) return Response.json({ ok: false, error: "That event is not here." }, { status: 400 });
          const sql = await ensure();
          const gone = await dropItem(sql, id);
          if (!gone) return Response.json({ ok: false, error: "That event is not here." }, { status: 404 });
          return Response.json({ ok: true });
        }
        const kind = url.searchParams.get("kind") ?? "";
        if (kind !== "note" && kind !== "flyer" && kind !== "video" && kind !== "dash") {
          return Response.json({ ok: false, error: "Choose a video, a flyer, or an announcement." }, { status: 400 });
        }
        if (!id) return Response.json({ ok: false, error: "That event didn't save. Try again." }, { status: 400 });
        const title = clip(url.searchParams.get("title") ?? "", 80);
        const body = clip(url.searchParams.get("body") ?? "", 500);
        const sql = await ensure();
        const count = await sql.query<{ n: string }>("select count(*)::text as n from city_board where dropped is not true");
        const existing = await sql.query<{ id: string }>("select id from city_board where id = $1", [id]);
        if (!existing[0] && Number(count[0]?.n ?? 0) >= MAX_ITEMS) {
          return Response.json({ ok: false, error: "24 events is the limit. Remove one first." }, { status: 400 });
        }
        if (kind === "note") {
          if (!title && !body) return Response.json({ ok: false, error: "Write the announcement." }, { status: 400 });
          const next = await sql.query<{ n: string }>("select coalesce(max(sort), 0)::text as n from city_board");
          await sql`
            insert into city_board (id, kind, title, body, mime, sort)
            values (${id}, 'note', ${title}, ${body}, null, ${Number(next[0]?.n ?? 0) + 1})
            on conflict (id) do nothing
          `;
          return Response.json({ ok: true });
        }
        const part = Number(url.searchParams.get("part") ?? "0");
        const parts = Number(url.searchParams.get("parts") ?? "1");
        const mime = fileMime(kind, url.searchParams.get("name") ?? "", url.searchParams.get("type") ?? "");
        if (!mime) {
          const message = kind === "dash" ? "Use a PNG with the windshield cut out." : kind === "flyer" ? "Use a jpg, png, or webp flyer." : "Use an mp4, mov, or webm video.";
          return Response.json({ ok: false, error: message }, { status: 400 });
        }
        if (!Number.isInteger(part) || !Number.isInteger(parts) || parts < 1 || parts > 80 || part < 0 || part >= parts) {
          return Response.json({ ok: false, error: "That file didn't upload. Try it again." }, { status: 400 });
        }
        let bytes: Buffer;
        try {
          bytes = Buffer.from(await request.arrayBuffer());
        } catch {
          return Response.json({ ok: false, error: "That piece didn't arrive. Try again." }, { status: 400 });
        }
        if (!bytes.byteLength || bytes.byteLength > CHUNK_BYTES) {
          return Response.json({ ok: false, error: "That file didn't upload. Try a shorter one." }, { status: 400 });
        }
        try {
          if (part === 0) await sql`delete from city_board_part where id = ${id}`;
          await sql`
            insert into city_board_part (id, part, bytes)
            values (${id}, ${part}, ${bytes})
            on conflict (id, part) do update set bytes = ${bytes}
          `;
          if (part < parts - 1) return Response.json({ ok: true, part });
          const saved = await sql.query<{ part: number; bytes: unknown }>(
            "select part, bytes from city_board_part where id = $1 order by part",
            [id],
          );
          if (saved.length !== parts) {
            return Response.json({ ok: false, error: "A piece of that file was missing. Try again." }, { status: 400 });
          }
          const whole = Buffer.concat(saved.map((row) => asBytes(row.bytes)));
          if (!whole.byteLength || whole.byteLength > MAX_BYTES) {
            await sql`delete from city_board_part where id = ${id}`;
            return Response.json({ ok: false, error: "That file is larger than 48 MB." }, { status: 400 });
          }
          const next = await sql.query<{ n: string }>("select coalesce(max(sort), 0)::text as n from city_board");
          await sql`
            insert into city_board (id, kind, title, body, mime, bytes, sort)
            values (${id}, ${kind}, ${title}, ${body}, ${mime}, ${whole}, ${Number(next[0]?.n ?? 0) + 1})
            on conflict (id) do update
              set kind = ${kind}, title = ${title}, body = ${body}, mime = ${mime}, bytes = ${whole}
          `;
          await sql`delete from city_board_part where id = ${id}`;
          return Response.json({ ok: true });
        } catch (error) {
          console.error("city-board save", error);
          return Response.json({ ok: false, error: "That file didn't save. Try again." }, { status: 500 });
        }
      },
      DELETE: async ({ request }) => {
        const session = await sessionOf(request);
        if (!session?.user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
        if (!(await founder(session.user.id))) {
          return Response.json({ ok: false, error: "Only the founder can remove an event." }, { status: 403 });
        }
        const id = safeId(new URL(request.url).searchParams.get("id") ?? "");
        if (!id) return Response.json({ ok: false, error: "That event is not here." }, { status: 400 });
        const sql = await ensure();
        const gone = await dropItem(sql, id);
        if (!gone) return Response.json({ ok: false, error: "That event is not here." }, { status: 404 });
        return Response.json({ ok: true });
      },
    },
  },
});
