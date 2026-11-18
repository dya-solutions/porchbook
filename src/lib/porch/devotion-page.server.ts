import { readSite } from "@/lib/porch/phaneroo-site.server";

export function publicPage(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return null;
  }
  return url;
}

function codePoint(code: number) {
  if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function decode(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, digits: string) => codePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits: string) => codePoint(parseInt(digits, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&rsquo;|&lsquo;/gi, "\u2019")
    .replace(/&ldquo;/gi, "\u201c")
    .replace(/&rdquo;/gi, "\u201d")
    .replace(/&ndash;|&mdash;/gi, "\u2014")
    .replace(/&hellip;/gi, "\u2026")
    .replace(/&amp;/gi, "&");
}

function plain(value: string) {
  return decode(value.replace(/<[^>]+>/g, "").replace(/[\u200B\u200E\u200F\uFEFF]/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function escapeText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function paragraphs(html: string) {
  const expanded = html.replace(/<br\s*\/?>/gi, "</p><p>");
  return [...expanded.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => plain(match[1]))
    .filter((line) => line && line !== "\u2014" && line !== "-" && line !== "\u2013" && !/^loading\b/i.test(line) && !/^copyright\b/i.test(line));
}

function isSection(line: string) {
  const match = /^([^:]{2,48}):\s+\S/.exec(line);
  return Boolean(match && !/\d/.test(match[1]));
}

function sectionLabel(raw: string) {
  const trimmed = raw.trim();
  const known: Record<string, string> = {
    "further study": "Further study",
    "golden nugget": "Golden nugget",
    prayer: "Prayer",
  };
  const hit = known[trimmed.toLowerCase()];
  if (hit) return hit;
  if (trimmed === trimmed.toUpperCase()) {
    return trimmed.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => space + letter.toUpperCase());
  }
  return trimmed;
}

function articleBody(lines: string[], fallbackTitle: string) {
  let end = lines.length;
  while (end > 0 && isSection(lines[end - 1])) end -= 1;
  const run = lines.slice(end);
  const sections = run.length >= 1 && run.length <= 4 ? run : [];
  const head = sections.length ? lines.slice(0, end) : lines;
  const verse = (line: string) => /\d+\s*[:.,]\s*\d+/.test(line);
  const short = (line: string) => line.length <= 80 && !verse(line);
  let title = "";
  let author = "";
  let teaching = head;
  if (head.length >= 2 && !verse(head[0]) && head[0].length <= 140 && short(head[1])) {
    title = head[0];
    author = head[1];
    teaching = head.slice(2);
  } else if (head[0] && short(head[0])) {
    author = head[0];
    teaching = head.slice(1);
    title = fallbackTitle;
  } else {
    title = fallbackTitle;
  }
  return [
    title ? `<h1>${escapeText(title)}</h1>` : "",
    author ? `<p class="author">${escapeText(author)}</p>` : "",
    ...teaching.map((line) => `<p>${escapeText(line)}</p>`),
    ...sections.map((line) => {
      const match = /^([^:]{2,48}):\s*([\s\S]*)$/.exec(line);
      if (!match || /\d/.test(match[1])) return `<p>${escapeText(line)}</p>`;
      return `<h2>${escapeText(sectionLabel(match[1]))}</h2><p>${escapeText(match[2].trim())}</p>`;
    }),
  ].join("");
}

function tongueName(name: string) {
  const key = name.toLowerCase().replace(/[^a-z]/g, "");
  if (key === "runyankore" || key === "runyankole") return "Runyankole";
  if (key === "luganda") return "Luganda";
  return name;
}

function panelLines(section: string, id: string) {
  const at = section.indexOf(`id="elementor-tab-content-${id}"`);
  if (at < 0) return [];
  const start = section.indexOf(">", at);
  if (start < 0) return [];
  const rest = section.slice(start + 1);
  const next = /<div class="elementor-tab-title|<div id="elementor-tab-content-/i.exec(rest);
  return paragraphs(next ? rest.slice(0, next.index) : rest);
}

function placeRunyankole(found: { name: string; lines: string[] }[]) {
  const runya = found.findIndex((item) => item.name === "Runyankole");
  if (runya > 0) {
    const [item] = found.splice(runya, 1);
    const english = found.findIndex((tongue) => tongue.name.toLowerCase() === "english");
    found.splice(english >= 0 ? english + 1 : 0, 0, item);
  }
  return found;
}

function tonguesIn(section: string) {
  const titles = [...section.matchAll(/<div\b([^>]*\belementor-tab-desktop-title\b[^>]*)>([\s\S]*?)<\/div>/gi)];
  const found: { name: string; lines: string[] }[] = [];
  for (const title of titles) {
    const id = /id="elementor-tab-title-(\d+)"/i.exec(title[1])?.[1];
    const name = tongueName(plain(title[2]));
    if (!id || !name) continue;
    const lines = panelLines(section, id);
    if (lines.join(" ").length < 180) continue;
    const existing = found.findIndex((item) => item.name === name);
    if (existing >= 0) {
      if (lines.join(" ").length > found[existing].lines.join(" ").length) found[existing] = { name, lines };
      continue;
    }
    found.push({ name, lines });
  }
  if (!found.length) {
    for (const tab of section.matchAll(/\[restab[^\]]*title="([^"]+)"[^\]]*\]([\s\S]*?)\[\/restab\]/gi)) {
      const name = tongueName(plain(tab[1]));
      const lines = paragraphs(tab[2]);
      if (!name || lines.join(" ").length < 180) continue;
      found.push({ name, lines });
    }
  }
  return placeRunyankole(found);
}

function devotionSlice(html: string) {
  const bits = html.split(/<article\b/i);
  if (bits.length < 2) return html;
  const sections = bits.slice(1);
  const withRunya = sections.find((section) => tonguesIn(section).some((item) => item.name === "Runyankole"));
  return withRunya ?? sections.find((section) => /elementor-tab-desktop-title|\[restab/i.test(section)) ?? html;
}

export function tongues(html: string) {
  return tonguesIn(devotionSlice(html));
}

function pageTitle(html: string) {
  const heading = html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i) ?? html.match(/elementor-heading-title[^>]*>([\s\S]*?)<\//i);
  const titled = html.match(/<title>([\s\S]*?)<\/title>/i);
  let title = plain(heading?.[1] || titled?.[1] || "");
  title = title.replace(/^The Phaneroo Devotion:\s*/i, "").replace(/\s*[–—|-]\s*Phaneroo.*$/i, "").trim();
  if (/^you are being redirected/i.test(title) || /^one moment/i.test(title)) return "";
  return title;
}

function sheet(pieces: string[], names: string[]) {
  const articles = pieces
    .map((piece, index) => `<article data-i="${index}" class="${index === 0 ? "on" : ""}">${piece}</article>`)
    .join("");
  const bar = names.length
    ? `<nav><p>Translations</p><div class="row">${names
        .map(
          (name, index) =>
            `<button type="button" data-pick="${index}" class="${index === 0 ? "on" : ""}" aria-pressed="${index === 0 ? "true" : "false"}">${escapeText(name)}</button>`,
        )
        .join("")}</div></nav><script>
(function(){
  var buttons = document.querySelectorAll("[data-pick]");
  var pages = document.querySelectorAll("article[data-i]");
  function show(i){
    pages.forEach(function(page){ page.classList.toggle("on", page.getAttribute("data-i") === i); });
    buttons.forEach(function(button){
      var on = button.getAttribute("data-pick") === i;
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
    window.scrollTo(0, 0);
  }
  buttons.forEach(function(button){
    button.addEventListener("click", function(){ show(button.getAttribute("data-pick")); });
  });
})();
</script>`
    : "";
  const pad = names.length ? "7.5rem" : "3rem";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,620&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600&display=swap"><style>
body{margin:0;color:#2c2416;font-family:"Source Serif 4",Georgia,serif;background-color:#f3e6c8;background-image:linear-gradient(rgba(246,237,212,.64),rgba(246,237,212,.72)),url("/devotion-paper.jpg");background-size:cover;background-position:center;background-attachment:fixed}
main{max-width:40rem;margin:0 auto;padding:1.6rem 1.25rem ${pad}}
article{display:none}
article.on{display:block}
h1{margin:0 0 .35rem;font-family:Fraunces,Georgia,serif;font-size:2rem;font-weight:620;line-height:1.25;color:#8a5a12}
.author{margin:0 0 1.5rem;font-size:1.05rem;font-weight:600;color:#5c5140}
p{margin:0 0 1rem;font-size:1.18rem;font-weight:500;line-height:1.7}
h2{margin:1.7rem 0 .35rem;font-family:Fraunces,Georgia,serif;font-size:1.2rem;font-weight:620;color:#8a5a12}
nav{position:fixed;left:0;right:0;bottom:0;z-index:5;border-top:1px solid #c9b48a;background:rgba(246,237,216,.96);padding:.4rem .75rem calc(.55rem + env(safe-area-inset-bottom))}
nav p{margin:0 0 .25rem;font-size:11px;font-weight:600;letter-spacing:.04em;color:#8a5a12}
.row{display:flex;gap:.75rem;overflow-x:auto;overscroll-behavior-x:contain}
button{min-width:7rem;flex:0 0 auto;white-space:nowrap;border:1px solid #c9b48a;border-radius:.375rem;background:#f6edd8;color:#2c2416;padding:.75rem;font:600 .875rem/1.2 "Source Serif 4",Georgia,serif;cursor:pointer}
button.on{background:#8a5a12;color:#f6edd4;border-color:#8a5a12}
</style></head><body><main>${articles}</main>${bar}</body></html>`;
}

export function devotionPage(html: string) {
  const slice = devotionSlice(html);
  const title = pageTitle(slice);
  const found = tonguesIn(slice);
  if (found.length >= 1) {
    // English, plus Phaneroo's own Runyankore when the page has it (the reader offers it as a switch).
    const english = found.find((tongue) => tongue.name.toLowerCase() === "english") ?? found[0];
    // ...and Phaneroo's own Luganda too.
    const extra = [
      { tongue: found.find((tongue) => tongue.name === "Runyankole"), label: "Runyankore" },
      { tongue: found.find((tongue) => tongue.name === "Luganda"), label: "Luganda" },
    ].filter((x): x is { tongue: { name: string; lines: string[] }; label: string } => Boolean(x.tongue) && x.tongue !== english);
    if (extra.length) return sheet([articleBody(english.lines, title), ...extra.map((x) => articleBody(x.tongue.lines, title))], ["English", ...extra.map((x) => x.label)]);
    return sheet([articleBody(english.lines, title)], []);
  }
  const lines = paragraphs(slice);
  if (!lines.some((line) => /^further study:?/i.test(line))) return "";
  return sheet([articleBody(lines, title)], []);
}

export async function phanerooArticle(page: URL) {
  const host = page.hostname.toLowerCase();
  if (host !== "phaneroo.org" && host !== "www.phaneroo.org") return "";
  const path = page.pathname.replace(/\/+$/, "").toLowerCase();
  const parts = path.split("/").filter(Boolean);
  const slug = parts[parts.length - 1] ?? "";
  const listing =
    parts.length === 0 ||
    slug === "devotion" ||
    slug === "devotions" ||
    slug === "daily-devotion" ||
    slug === "daily_devotion" ||
    slug === "category" ||
    path.includes("/category/");
  const specific = path.includes("/daily_devotion/") || path.includes("/daily-devotion/");
  if (!listing && !specific) return "";
  const endpoint = specific
    ? `https://phaneroo.org/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_fields=title,content`
    : "https://phaneroo.org/wp-json/wp/v2/posts?per_page=6&categories=1665&_fields=title,content";
  try {
    const response = await readSite(endpoint, "application/json");
    if (!response.ok) return "";
    const rows = (await response.json()) as { title?: { rendered?: string }; content?: { rendered?: string } }[];
    if (!Array.isArray(rows) || !rows.length) return "";
    return rows
      .map((row) => `<article><h1>${escapeText(decode(row.title?.rendered ?? ""))}</h1>${row.content?.rendered ?? ""}</article>`)
      .join("");
  } catch {
    return "";
  }
}

export function inside(html: string, page: string) {
  const cleaned = html
    .replace(/<meta[^>]+http-equiv=["']content-security-policy["'][^>]*>/gi, "")
    .replace(/<meta[^>]+http-equiv=["']x-frame-options["'][^>]*>/gi, "");
  const theme = `<style id="porch-read">
html, body { background: #f6edd4 !important; color: #2c2416 !important; }
.elementor-section, .elementor-section-wrap, .elementor-widget-wrap, .e-con, .e-con-inner, #main-wrap, #content, article, .post {
  background-color: transparent !important;
  background-image: none !important;
}
h1, h2, h3, h4, .elementor-heading-title, .elementor-widget-theme-post-title, .elementor-widget-theme-post-title * { color: #8a5a12 !important; }
p, li, blockquote, .elementor-widget-theme-post-content, .elementor-widget-theme-post-content *, .elementor-widget-theme-post-excerpt, .elementor-widget-theme-post-excerpt * { color: #2c2416 !important; }
img, picture, svg, video, figure, object, embed, .elementor-widget-image, .elementor-widget-theme-post-featured-image, .wp-post-image,
header, #tt-header-wrap, nav, .menu, .sub-menu, .mobmenu, .mob-menu-header-holder, .mobmenu-overlay, .small_banner, .page-banner-heading, .breadcrumbs, .companyIdentity, .top-aside,
footer, #footer, .footer-content, .footer-copyright, .foot-copy { display: none !important; }
</style>`;
  const head = `<base href="${page}">${theme}<script>
(function(){
  function go(href){
    try {
      var next = new URL(href, document.baseURI);
      if (next.protocol !== "https:") return;
      var here = new URL(location.href);
      location.href = "/api/browse?url=" + encodeURIComponent(next.href) + (here.searchParams.get("t") ? "&t=" + encodeURIComponent(here.searchParams.get("t")) : "");
    } catch (e) {}
  }
  document.addEventListener("click", function(e){
    var node = e.target;
    var link = node && node.closest ? node.closest("a") : null;
    if (!link || !link.href || link.target === "_blank") return;
    e.preventDefault();
    go(link.href);
  }, true);
})();
</script>`;
  let pageHtml = /<head[^>]*>/i.test(cleaned) ? cleaned.replace(/<head[^>]*>/i, (match) => match + head) : head + cleaned;
  if (/<\/body>/i.test(pageHtml)) {
    pageHtml = pageHtml.replace(
      /<\/body>/i,
      `${theme}<script>document.querySelectorAll("header,footer,#footer,#tt-header-wrap,nav,.footer-content,.footer-copyright,.foot-copy,.small_banner,.breadcrumbs,.mobmenu,img,picture,svg,figure,video,object,embed").forEach(function(node){node.style.setProperty("display","none","important")});</script></body>`,
    );
  }
  return pageHtml;
}


/** The devotional page for a link, as the reader shows it (empty if it can't be read). */
export async function devotionSheet(link: string): Promise<string> {
  const page = publicPage(link);
  if (!page) return "";
  let raw = "";
  try {
    const response = await readSite(page, "text/html");
    if ((response.headers.get("content-type") ?? "").includes("text/html")) raw = await response.text();
  } catch {
    /* try the article feed instead */
  }
  const article = await phanerooArticle(page);
  const best =
    [raw, article]
      .filter((html) => html)
      .sort((left, right) => {
        const score = (html: string) => {
          const found = tongues(html);
          const runya = found.find((item) => item.name === "Runyankole");
          return found.length * 1000 + (runya ? runya.lines.join(" ").length : 0);
        };
        return score(right) - score(left);
      })[0] ?? "";
  return best ? devotionPage(best) : "";
}

/** Phaneroo's own pictures only (the devotional's daily picture), including WordPress's picture service. */
export function phanerooPicture(raw: string): URL | null {
  const url = publicPage(raw.replace(/&amp;/g, "&").trim());
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const ours = host === "phaneroo.org" || host.endsWith(".phaneroo.org");
  const wordpress = /^i[0-3]\.wp\.com$/.test(host) && url.pathname.toLowerCase().includes("phaneroo.org/");
  if (!ours && !wordpress) return null;
  if (!/\.(jpe?g|png|webp)$/i.test(url.pathname)) return null;
  return url;
}

/** Every picture the page offers as its main picture, best first. */
export function pictureCandidates(raw: string): string[] {
  const found: string[] = [];
  const add = (value: string | undefined) => {
    if (value && !found.includes(value)) found.push(value.replace(/&amp;/g, "&"));
  };
  for (const tag of raw.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["']/i.test(tag)) continue;
    add(/content=["']([^"']+)["']/i.exec(tag)?.[1]);
  }
  for (const tag of raw.match(/<img\b[^>]*>/gi) ?? []) {
    const src = /(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i.exec(tag)?.[1];
    if (/wp-post-image|attachment-full|featured/i.test(tag)) add(src);
  }
  for (const tag of raw.match(/<img\b[^>]*>/gi) ?? []) {
    const src = /(?:data-src|data-lazy-src|src)=["']([^"']+\/wp-content\/uploads\/[^"']+)["']/i.exec(tag)?.[1];
    if (src && !/logo|icon|avatar|-150x150/i.test(src)) add(src);
  }
  return found;
}

async function featuredPicture(page: URL): Promise<{ picture: string; note: string }> {
  const host = page.hostname.toLowerCase();
  if (host !== "phaneroo.org" && host !== "www.phaneroo.org") return { picture: "", note: "not phaneroo" };
  const parts = page.pathname.replace(/\/+$/, "").toLowerCase().split("/").filter(Boolean);
  const slug = parts[parts.length - 1] ?? "";
  const specific = page.pathname.includes("/daily_devotion/") || page.pathname.includes("/daily-devotion/");
  const endpoint = specific
    ? `https://phaneroo.org/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_fields=featured_media,content`
    : "https://phaneroo.org/wp-json/wp/v2/posts?per_page=1&categories=1665&_fields=featured_media,content";
  try {
    const listed = await readSite(endpoint, "application/json");
    if (!listed.ok) return { picture: "", note: `posts ${listed.status}` };
    const posts = (await listed.json()) as { featured_media?: number; content?: { rendered?: string } }[];
    const inContent = pictureCandidates(posts?.[0]?.content?.rendered ?? "").find((item) => phanerooPicture(item));
    const id = Number(posts?.[0]?.featured_media);
    if (!id) return { picture: inContent ?? "", note: "no featured picture" };
    const answer = await readSite(`https://phaneroo.org/wp-json/wp/v2/media/${id}?_fields=source_url,media_details`, "application/json");
    if (!answer.ok) return { picture: inContent ?? "", note: `media ${answer.status}` };
    const media = (await answer.json()) as { source_url?: string; media_details?: { sizes?: Record<string, { source_url?: string; width?: number }> } };
    const sizes = Object.values(media?.media_details?.sizes ?? {}).filter((size) => size.source_url && (size.width ?? 0) >= 600);
    sizes.sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
    const best = sizes[0]?.source_url ?? media?.source_url ?? "";
    return { picture: phanerooPicture(best) ? best : inContent ?? "", note: best ? "featured" : "media without a file" };
  } catch (caught) {
    return { picture: "", note: caught instanceof Error ? caught.message.slice(0, 120) : "failed" };
  }
}

/** The day's devotional picture: the page's share picture, or the article's featured picture. */
export async function devotionPicture(raw: string, page: URL): Promise<string> {
  const fromPage = pictureCandidates(raw).find((item) => phanerooPicture(item));
  if (fromPage) return fromPage;
  return (await featuredPicture(page)).picture;
}

/** For checking: what the devotional page offers as its picture, and why. */
export async function devotionPictureReport(link: string) {
  const page = publicPage(link);
  if (!page) return { link, error: "no page" };
  let status = 0;
  let type = "";
  let raw = "";
  try {
    const response = await readSite(page, "text/html");
    status = response.status;
    type = response.headers.get("content-type") ?? "";
    if (type.includes("text/html")) raw = await response.text();
  } catch (caught) {
    type = caught instanceof Error ? caught.message.slice(0, 120) : "failed";
  }
  const candidates = pictureCandidates(raw).slice(0, 6);
  const featured = await featuredPicture(page);
  return { link, status, type, length: raw.length, candidates, allowed: candidates.filter((item) => phanerooPicture(item)), featured, picture: await devotionPicture(raw, page) };
}

/** Put the day's picture at the top of each devotional page. */
export function withDevotionPicture(html: string, picture: string) {
  if (!picture) return html;
  const tag = `<img class="devotion-picture" src="/api/devotion-picture?u=${encodeURIComponent(picture)}" alt="">`;
  return html.replace(/(<article data-i="\d+"[^>]*>)/g, `$1${tag}`);
}
