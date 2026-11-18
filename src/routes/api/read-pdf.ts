import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { getSql } from "@/lib/db";
import { bookFromFile } from "@/lib/porch/pdf-book.server";

const KEPT = new Set(["bible", "devotion", "notebook"]);

export const Route = createFileRoute("/api/read-pdf")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const headers = new Headers(request.headers);
        const token = url.searchParams.get("t");
        if (token && !headers.get("authorization")) headers.set("authorization", `Bearer ${token}`);
        const session = await auth.api.getSession({ headers });
        if (!session?.user) return new Response("Sign in to read this.", { status: 401 });
        const key = url.searchParams.get("key") ?? "";
        if (!key || key.length > 40) return new Response("That book is not here.", { status: 404 });
        const sql = await getSql();
        const rows = await sql.query<{ pdf: string | null }>("select pdf from read_docs where key = $1", [key]);
        const pdf = rows[0]?.pdf;
        if (!pdf) return new Response("That PDF is not here yet.", { status: 404 });
        return new Response(Buffer.from(pdf, "base64"), {
          headers: {
            "content-type": "application/pdf",
            "content-disposition": "inline",
            "cache-control": "private, no-store",
          },
        });
      },
      POST: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) return Response.json({ ok: false, error: "Sign in." }, { status: 401 });
        const sql = await getSql();
        const me = await sql.query<{ is_founder: boolean }>("select is_founder from profiles where user_id = $1", [session.user.id]);
        const flag = me[0]?.is_founder;
        const founder = flag === true || String(flag) === "t" || String(flag) === "true" || String(flag) === "1";
        if (!founder) return Response.json({ ok: false, error: "Only the pastor can add a book." }, { status: 403 });
        const form = await request.formData();
        const key = String(form.get("key") ?? "").trim().slice(0, 40);
        const file = form.get("file");
        if (!key || KEPT.has(key) || !(file instanceof File)) {
          return Response.json({ ok: false, error: "Open one of your books, then choose a file." }, { status: 400 });
        }
        const kind = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (!["pdf", "txt", "text", "docx", "epub"].includes(kind)) {
          return Response.json({ ok: false, error: "Use a PDF, Word, EPUB, or text file." }, { status: 400 });
        }
        if (file.size > 8_000_000) return Response.json({ ok: false, error: "That file is too large." }, { status: 400 });
        const bytes = Buffer.from(await file.arrayBuffer());
        const found = await sql.query<{ key: string }>("select key from read_docs where key = $1", [key]);
        if (!found.length) return Response.json({ ok: false, error: "That book is not here." }, { status: 404 });
        const book = await bookFromFile(file.name, bytes, kind === "pdf" ? "book" : "plain");
        if ("error" in book) return Response.json({ ok: false, error: book.error }, { status: 400 });
        const pdf = kind === "pdf" ? bytes.toString("base64") : "";
        await sql`update read_docs set pdf = ${pdf}, body = ${book.body} where key = ${key}`;
        return Response.json({ ok: true, body: book.body });
      },
    },
  },
});
