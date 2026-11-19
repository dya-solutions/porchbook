import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { getSql } from "@/lib/db";

export const Route = createFileRoute("/api/office-pdf")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) return new Response("Sign in to read this.", { status: 401 });
        const url = new URL(request.url);
        const key = url.searchParams.get("key") ?? "";
        const part = url.searchParams.get("part") ?? "";
        if (!key || !part) return new Response("That book is not here.", { status: 404 });
        const view = url.searchParams.get("view") ?? "";
        const sql = await getSql();
        // Offices are locked: only that office's head, the founder and the H.O.O may open its books.
        const me = await sql.query<{ is_founder: boolean | string | number | null }>("select is_porch_admin($1) as is_founder", [session.user.id]);
        const heads = await sql.query<{ key: string; head_user_id: string | null }>("select key, head_user_id from offices where key in ('hoo', $1) and porch_id = my_porch($2)", [key, session.user.id]);
        const founder = [true, 1, "1", "t", "true"].includes(me[0]?.is_founder as never);
        const allowed = founder || heads.some((row) => (row.key === key || row.key === "hoo") && row.head_user_id === session.user.id);
        if (!allowed) return new Response("That office is locked.", { status: 403 });
        const rows = await sql.query<{ pdf: string | null; hoo_pdf: string | null }>(
          "select pdf, hoo_pdf from office_pdfs where office_key = $1 and part = $2 and porch_id = my_porch($3)",
          [key, part, session.user.id],
        );
        const row = rows[0];
        const pdf = view === "hoo" ? row?.pdf || row?.hoo_pdf : row?.pdf;
        if (!pdf) return new Response("That PDF is not here yet.", { status: 404 });
        return new Response(Buffer.from(pdf, "base64"), {
          headers: {
            "content-type": "application/pdf",
            "content-disposition": "inline",
            "cache-control": "private, no-store",
          },
        });
      },
    },
  },
});
