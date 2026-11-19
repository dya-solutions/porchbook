import { createServerFn } from "@tanstack/react-start";
import { shown } from "@/lib/porch/on-hold";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

/**
 * The devotional in Runyankore: Phaneroo's own translation when the page has one, otherwise
 * machine translated by Sunbird AI (labelled so). Each day's copy is kept, so it's made only once.
 */
const rec = (input: unknown): Record<string, unknown> => (input && typeof input === "object" ? (input as Record<string, unknown>) : {});

async function isFounder(sql: Sql, userId: string) {
  const rows = await sql.query<{ is_founder: unknown }>("select is_founder from profiles where user_id = $1", [userId]);
  const f = rows[0]?.is_founder;
  return f === true || f === 1 || f === "1" || f === "t" || f === "true";
}

export type Tongue = "nyn" | "lug";
const TONGUE_NAME: Record<Tongue, string> = { nyn: "Runyankore", lug: "Luganda" };

/** Phaneroo's own Runyankore or Luganda article inside a devotional sheet, if they published one. */
function phanerooCopyOf(sheet: string, lang: Tongue) {
  const bodies = [...sheet.matchAll(/<article data-i="(\d+)"[^>]*>([\s\S]*?)<\/article>/g)];
  const names = [...sheet.matchAll(/data-pick="(\d+)"[^>]*>([^<]*)</g)];
  const wanted = lang === "lug" ? /^luganda/i : /^runyank(o|ole|ore)/i;
  const at = names.find((match) => wanted.test(match[2].trim()))?.[1];
  return at ? (bodies.find((item) => item[1] === at)?.[2] ?? "") : "";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…" };
const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|[a-z]+);/gi, (whole, name: string) => (name.startsWith("#") ? String.fromCharCode(Number(name.slice(1))) : (ENTITIES[name.toLowerCase()] ?? whole)))
    .trim();
const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function sunbird(token: string, text: string, lang: Tongue = "nyn") {
  const response = await fetch("https://api.sunbird.ai/tasks/translate", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ source_language: "eng", target_language: lang, text }),
  });
  const body = (await response.json().catch(() => ({}))) as { output?: { translated_text?: string }; detail?: unknown };
  if (!response.ok || !body.output?.translated_text) {
    if (response.status === 401 || response.status === 403) throw new Error("The Sunbird key has expired or is wrong: paste a new one on the Devotional voice page.");
    throw new Error(`Sunbird couldn't translate it (${response.status}).`);
  }
  return body.output.translated_text.trim();
}

/** Each heading and paragraph translated on its own (keeps the page's shape; the Bible card and picture stay out). */
async function machineTranslate(token: string, englishHtml: string, lang: Tongue) {
  const blocks = [...englishHtml.replace(/<img[^>]*>/g, "").matchAll(/<(h1|h2|p)(\s[^>]*)?>([\s\S]*?)<\/\1>/g)];
  const out: string[] = new Array(blocks.length);
  let next = 0;
  const lane = async () => {
    while (next < blocks.length) {
      const at = next++;
      const [, tag, attrs = ""] = blocks[at];
      const text = plain(blocks[at][3]);
      out[at] = text ? `<${tag}${attrs}>${escapeText(await sunbird(token, text, lang))}</${tag}>` : "";
    }
  };
  await Promise.all([lane(), lane(), lane()]);
  return out.join("");
}

const tongueOf = (v: unknown): Tongue => (v === "lug" ? "lug" : "nyn");
/** Where a copy came from: Phaneroo's own, Sunbird AI, or typed in by the founder. */
type Source = "phaneroo" | "machine" | "founder";

/** Today's devotional in Runyankore or Luganda (lang: "nyn" | "lug"). */
export const devotionRunyankore = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ link: String(rec(input).link ?? "").slice(0, 600), lang: tongueOf(rec(input).lang) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const founder = await isFounder(sql, context.userId);
    // A machine translation waits for the founder's check; until then others see English only.
    const shownTo = (html: string, source: Source, approved: boolean) =>
      source === "machine" && !approved
        ? founder
          ? { ok: true as const, html, source, review: true }
          : { ok: false as const, error: `Today's ${TONGUE_NAME[data.lang]} isn't ready yet. Please read it in English for now.` }
        : { ok: true as const, html, source, review: false };
    // Only the devotional Porchbook is showing (today's, or a day kept on file).
    const docs = await sql.query<{ link: string }>("select link from read_docs where key = 'devotion'");
    const link = data.link || docs[0]?.link || "";
    const { publicPage } = await import("@/lib/porch/devotion-page.server");
    if (!link || !publicPage(link)) return { ok: false as const, error: "No devotional to translate." };
    const kept = await sql.query<{ html: string; source: string; approved: boolean; stale: unknown }>(
      "select html, source, approved, (made_at < now() - interval '30 minutes') as stale from devotion_translations where link = $1 and lang = $2",
      [link, data.lang],
    );
    const { devotionSheet } = await import("@/lib/porch/devotion-page.server");
    if (kept[0]?.html) {
      // A copy of our own (Sunbird's or the founder's) gives way when Phaneroo publishes theirs (looked for every half hour).
      const staleRow = kept[0].stale === true || kept[0].stale === "t" || kept[0].stale === 1;
      if (kept[0].source !== "phaneroo" && staleRow) {
        const theirs = phanerooCopyOf(await devotionSheet(link).catch(() => ""), data.lang);
        if (theirs) {
          await sql.query("update devotion_translations set html = $3, source = 'phaneroo', approved = true, made_at = now() where link = $1 and lang = $2", [link, data.lang, theirs]);
          return shownTo(theirs, "phaneroo", true);
        }
        await sql.query("update devotion_translations set made_at = now() where link = $1 and lang = $2", [link, data.lang]);
      }
      return shownTo(kept[0].html, kept[0].source as Source, Boolean(kept[0].approved));
    }

    const { englishOf } = await import("@/lib/porch/devotion-text");
    const sheet = await devotionSheet(link);
    let html = phanerooCopyOf(sheet, data.lang);
    let source: Source = "phaneroo";
    if (!html) {
      const settings = await sql.query<{ sunbird_key: string }>("select sunbird_key from devotion_voice_settings where id = 1").catch(() => []);
      // While machine translation is on hold, only Phaneroo's own (or a typed-in) copy is offered.
      const token = shown("machineTranslation") ? (settings[0]?.sunbird_key ?? "") : "";
      if (!token) return { ok: false as const, error: `Phaneroo hasn't published today's devotional in ${TONGUE_NAME[data.lang]} yet.` };
      try {
        html = await machineTranslate(token, englishOf(sheet), data.lang);
        source = "machine";
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : "Couldn't translate it." };
      }
    }
    if (!html) return { ok: false as const, error: `No ${TONGUE_NAME[data.lang]} copy today.` };
    await sql.query(
      `insert into devotion_translations (link, lang, html, source, approved) values ($1, $5, $2, $3, $4)
       on conflict (link, lang) do update set html = excluded.html, source = excluded.source, approved = excluded.approved, made_at = now()`,
      [link, html, source, source === "phaneroo", data.lang],
    );
    return shownTo(html, source, source === "phaneroo");
  });

/** Founder: the Sunbird AI key for machine translation (empty clears it). */
export const saveSunbirdKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ key: String(rec(input).key ?? "").trim().slice(0, 2000) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { ok: false as const, error: "Only the founder can set this." };
    if (data.key) {
      try {
        await sunbird(data.key, "Good morning.");
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : "Sunbird didn't accept that key." };
      }
    }
    await sql.query(
      `insert into devotion_voice_settings (id, sunbird_key, updated_at) values (1, $1, now())
       on conflict (id) do update set sunbird_key = excluded.sunbird_key, updated_at = now()`,
      [data.key],
    );
    return { ok: true as const };
  });

/** Founder: whether a Sunbird key is saved. */
export const sunbirdKeySaved = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { saved: false };
    const rows = await sql.query<{ sunbird_key: string }>("select sunbird_key from devotion_voice_settings where id = 1").catch(() => []);
    return { saved: Boolean(rows[0]?.sunbird_key) };
  });

/** Founder: the checked (and maybe corrected) machine translation, now shown to everyone. */
export const approveRunyankore = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ link: String(rec(input).link ?? "").slice(0, 600), html: String(rec(input).html ?? "").slice(0, 200_000), lang: tongueOf(rec(input).lang) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { ok: false as const, error: "Only the founder can approve it." };
    // Only headings and paragraphs are kept, as plain text (whatever the editing left behind).
    const blocks = [...data.html.matchAll(/<(h1|h2|p)(\s[^>]*)?>([\s\S]*?)<\/\1>/g)];
    const html = blocks
      .map(([, tag, attrs = ""]) => [tag, /class="author"/.test(attrs) ? ' class="author"' : ""] as const)
      .map(([tag, cls], index) => {
        const text = plain(blocks[index][3].replace(/<br\s*\/?>/gi, " "));
        return text ? `<${tag}${cls}>${escapeText(text)}</${tag}>` : "";
      })
      .join("");
    if (!html) return { ok: false as const, error: "Nothing to approve." };
    const done = await sql.query<{ link: string }>(
      "update devotion_translations set html = $2, approved = true, made_at = now() where link = $1 and lang = $3 returning link",
      [data.link, html, data.lang],
    );
    return done.length ? { ok: true as const, html } : { ok: false as const, error: "That translation wasn't found." };
  });

/** Founder: today's Runyankore or Luganda typed or pasted in (blank lines make paragraphs; a short line ending in ":" a heading). Everyone sees it at once. */
export const addOwnDevotion = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ link: String(rec(input).link ?? "").slice(0, 600), lang: tongueOf(rec(input).lang), text: String(rec(input).text ?? "").slice(0, 60_000) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { ok: false as const, error: "Only the founder can add it." };
    const docs = await sql.query<{ link: string }>("select link from read_docs where key = 'devotion'");
    const link = data.link || docs[0]?.link || "";
    const { publicPage } = await import("@/lib/porch/devotion-page.server");
    if (!link || !publicPage(link)) return { ok: false as const, error: "No devotional today to add it to." };
    const blocks = data.text.replace(/\r/g, "").split(/\n\s*\n/).map((b) => b.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
    if (!blocks.length) return { ok: false as const, error: "Paste the devotional first." };
    const html = blocks
      .map((b, i) => {
        if (i === 0 && b.length <= 90 && !/[.:]$/.test(b)) return `<h1>${escapeText(b)}</h1>`;
        if (b.length <= 60 && /:$/.test(b)) return `<h2>${escapeText(b.replace(/:$/, ""))}</h2>`;
        const lead = /^([^:]{2,40}):\s+([\s\S]+)$/.exec(b);
        if (lead && /^(further study|golden nugget|prayer|confession|reflection|scripture|bible reading)/i.test(lead[1])) return `<h2>${escapeText(lead[1])}</h2><p>${escapeText(lead[2])}</p>`;
        return `<p>${escapeText(b)}</p>`;
      })
      .join("");
    await sql.query(
      `insert into devotion_translations (link, lang, html, source, approved) values ($1, $2, $3, 'founder', true)
       on conflict (link, lang) do update set html = excluded.html, source = 'founder', approved = true, made_at = now()`,
      [link, data.lang, html],
    );
    return { ok: true as const, html };
  });
