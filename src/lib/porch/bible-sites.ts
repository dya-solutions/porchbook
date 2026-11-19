import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

/**
 * The Bible's "other versions" window: the founder chooses which website each version opens
 * (for everyone). A link can carry the verse in it:
 *   {book} John · {ch} 3 · {v} 16 · {code} JHN · {ref} John 3:16
 */

export type BibleSite = { id: number; label: string; url: string; /** Words on the page it opens scrolled to (📍 Start here). */ startText: string };

const boolish = (v: unknown) => v === true || v === "t" || v === "true" || v === 1;

async function founder(sql: Awaited<ReturnType<typeof getSql>>, userId: string) {
  const me = await sql.query<{ is_founder: unknown }>("select is_porch_admin($1) as is_founder", [userId]);
  return boolish(me[0]?.is_founder);
}

export const getBibleSites = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql
      .query<{ id: number; label: string; url: string; start_text: string | null }>("select id, label, url, start_text from bible_sites where porch_id = my_porch($1) order by sort asc, id asc", [context.userId])
      .catch(() => []);
    return { ok: true as const, sites: rows.map((r) => ({ id: Number(r.id), label: r.label, url: r.url, startText: r.start_text ?? "" })), canEdit: await founder(sql, context.userId) };
  });

export const saveBibleSites = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = (input && typeof input === "object" ? (input as { sites?: unknown }).sites : null) ?? [];
    const sites = (Array.isArray(raw) ? raw : [])
      .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
      .map((s) => ({ label: String(s.label ?? "").trim().slice(0, 24), url: String(s.url ?? "").trim().slice(0, 500), startText: String(s.startText ?? "").trim().slice(0, 120) }))
      .filter((s) => s.label && /^https:\/\/[^\s]+$/i.test(s.url))
      .slice(0, 20);
    return { sites };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await founder(sql, context.userId))) return { ok: false as const, error: "Only an admin can choose the versions." };
    // Only this church's list is replaced.
    await sql.query("delete from bible_sites where porch_id = my_porch($1)", [context.userId]);
    let sort = 0;
    for (const s of data.sites) await sql.query("insert into bible_sites (porch_id, label, url, sort, start_text) values (my_porch($5), $1, $2, $3, $4)", [s.label, s.url, sort++, s.startText || null, context.userId]);
    return { ok: true as const, count: data.sites.length };
  });

/** 📍 Start here: the words a version's page opens scrolled to (founder only). */
export const setBibleSiteStart = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    return { id: Number(raw.id) || 0, text: String(raw.text ?? "").replace(/\s+/g, " ").trim().slice(0, 120) };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await founder(sql, context.userId))) return { ok: false as const, error: "Only an admin can set where a version starts." };
    await sql.query("update bible_sites set start_text = $2, updated_at = now() where id = $1 and porch_id = my_porch($3)", [data.id, data.text || null, context.userId]);
    return { ok: true as const };
  });

// The standard short codes of the 66 books (as many Bible sites use in their links).
const CODES = "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV".split(" ");

/** A book's short code (JHN), as many Bible sites mark their verses. */
export const bookCode = (number: number) => CODES[number - 1] ?? "";

/** A book as sites write it in an address: "galatians", "1-samuel", "song-of-solomon". */
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A saved link that already points at a place (…/galatians/5/20): the place swapped for ours. */
const PLACE_IN_PATH = /^(https?:\/\/[^?#]+?\/)([a-z0-9-]+)\/(\d+)\/(\d+)(\/?)([?#].*)?$/i;
/** The founder's own Bible sites (….grok.me/ampc): a version's address with no place yet. */
const VERSION_ONLY = /^(https?:\/\/[a-z0-9-]+\.grok\.me\/[a-z0-9-]+)\/?$/i;
export const linkCarriesVerse = (template: string) =>
  /\{(v|ref)\}/i.test(template) || (!/\{[a-z]+\}/i.test(template) && (PLACE_IN_PATH.test(template) || VERSION_ONLY.test(template)));

/** A version's link for one verse. */
export function siteLink(template: string, book: { number: number; name: string }, chapter: number, verse: number) {
  const ref = `${book.name} ${chapter}:${verse}`;
  if (!/\{[a-z]+\}/i.test(template)) {
    const m = PLACE_IN_PATH.exec(template);
    if (m) return `${m[1]}${slugOf(book.name)}/${chapter}/${verse}${m[5]}${m[6] ?? ""}`;
    const v = VERSION_ONLY.exec(template);
    if (v) return `${v[1]}/${slugOf(book.name)}/${chapter}/${verse}`;
  }
  return template
    .replace(/\{slug\}/gi, slugOf(book.name))
    .replace(/\{book\}/gi, encodeURIComponent(book.name))
    .replace(/\{ch\}/gi, String(chapter))
    .replace(/\{v\}/gi, String(verse))
    .replace(/\{code\}/gi, CODES[book.number - 1] ?? "")
    .replace(/\{ref\}/gi, encodeURIComponent(ref));
}
