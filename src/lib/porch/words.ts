import { createServerFn } from "@tanstack/react-start";
import { myPorchId, porchTables } from "@/lib/porch/porch-foundation";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

/**
 * Words the founder has reworded: headings, button labels and help lines, by key.
 * Everyone reads them; only the founder changes them. An empty word puts the original back.
 */

const KEY = /^[a-z0-9][a-z0-9._-]{1,79}$/;

let ready = false;
async function ensure(sql: Sql) {
  if (ready) return;
  await sql.query(`create table if not exists porch_words (
    key text primary key,
    text text not null,
    updated_at timestamptz not null default now()
  )`);
  await porchTables(sql, { key: [["porch_words", "key"]] });
  ready = true;
}

/** Wording that names Phaneroo or its events; blank for other churches until they write their own. */
export const PHANEROO_ONLY_WORDS = ["serve.subtitle", "serve.intro", "my20.event", "transport.venue-pmi", "transport.venue-pmm", "transport.venue-manifest"];

export const getWords = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await ensure(sql);
    const rows = await sql.query<{ key: string; text: string }>(`select key, text from porch_words where porch_id = ${porch}`);
    const words = Object.fromEntries(rows.map((r) => [r.key, r.text])) as Record<string, string>;
    // Stage 5a: Phaneroo's own wording on the Serve, My 20 and Transport sheets is Phaneroo's only.
    // Other churches start with these blank (their admins can write their own with Edit words).
    if (porch !== 1) for (const key of PHANEROO_ONLY_WORDS) if (!(key in words)) words[key] = "";
    return { words };
  });

export const setWord = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const key = typeof raw.key === "string" ? raw.key : "";
    const text = typeof raw.text === "string" ? raw.text.replace(/[\u0000-\u0009\u000b-\u001f]/g, " ").trim().slice(0, 600) : "";
    return { key: KEY.test(key) ? key : "", text };
  })
  .handler(async ({ context, data }) => {
    if (!data.key) return { ok: false as const, error: "That words can't be changed." };
    const sql = await getSql();
    const porch = await myPorchId(sql, context.userId);
    await ensure(sql);
    const me = await sql.query<{ is_founder: unknown }>("select is_porch_admin($1) as is_founder", [context.userId]);
    const founder = me[0]?.is_founder === true || me[0]?.is_founder === "t" || me[0]?.is_founder === "true";
    if (!founder) return { ok: false as const, error: "Only an admin rewords Porchbook." };
    if (!data.text) await sql.query(`delete from porch_words where porch_id = ${porch} and key = $1`, [data.key]);
    else
      await sql.query(`insert into porch_words (porch_id, key, text) values (${porch}, $1, $2) on conflict (porch_id, key) do update set text = excluded.text, updated_at = now()`,
        [data.key, data.text],
      );
    return { ok: true as const };
  });
