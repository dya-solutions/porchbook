import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
// @ts-expect-error The PDF worker ships without type declarations.
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { decodeEntities, isPageNumber, layPages, type BookBlock, type LibraryPages } from "./pdf-book";

const MAX_PDF_PAGES = 500;

function arm() {
  const scope = globalThis as { pdfjsWorker?: { WorkerMessageHandler: typeof WorkerMessageHandler } };
  scope.pdfjsWorker = { WorkerMessageHandler };
  const worker = join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
  if (existsSync(worker)) GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href;
}

function fontUrl() {
  const fonts = join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/");
  return existsSync(fonts) ? pathToFileURL(fonts).href : undefined;
}

type Line = { text: string; size: number; gap: number };

function linesOf(items: { str?: string; transform: number[]; height?: number; width?: number }[]): Line[] {
  const marks = items
    .filter((item) => item.str && item.str.trim())
    .map((item) => {
      const size = Math.abs(item.height || item.transform[3] || 12) || 12;
      return { str: item.str as string, x: item.transform[4] || 0, y: item.transform[5] || 0, size, width: item.width || item.str!.length * size * 0.45 };
    })
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: { y: number; size: number; parts: typeof marks }[] = [];
  for (const mark of marks) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - mark.y) < Math.max(2, row.size * 0.45)) row.parts.push(mark);
    else rows.push({ y: mark.y, size: mark.size, parts: [mark] });
  }
  const lines: Line[] = [];
  for (const row of rows) {
    row.parts.sort((a, b) => a.x - b.x);
    let text = "";
    let end = 0;
    for (const part of row.parts) {
      if (text && part.x - end > part.size * 0.3) text += " ";
      text += part.str;
      end = part.x + part.width;
    }
    text = text.replace(/\s+/g, " ").trim();
    if (!text || isPageNumber(text)) continue;
    const previous = rows[rows.indexOf(row) - 1];
    const gap = previous ? previous.y - row.y : row.size * 1.2;
    lines.push({ text, size: row.size, gap });
  }
  return lines;
}

function blocksFrom(lines: Line[]): BookBlock[] {
  if (!lines.length) return [];
  const sizes = lines.map((line) => line.size).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] || 12;
  const blocks: BookBlock[] = [];
  let paragraph = "";
  const flush = () => {
    const text = paragraph.replace(/\s+/g, " ").trim();
    paragraph = "";
    if (text) blocks.push({ kind: "text", text, fresh: true });
  };
  for (const line of lines) {
    const caps = line.text.length < 70 && line.text.length > 2 && line.text === line.text.toUpperCase() && /[A-Z]/.test(line.text);
    const chapter = line.size >= median * 1.45 || (caps && line.text.length < 42);
    const sub = !chapter && ((line.size >= median * 1.18 && line.text.length < 90) || caps);
    if (chapter || sub) {
      flush();
      const text = line.text.replace(/\s+/g, " ").trim();
      const previous = blocks[blocks.length - 1];
      if (previous?.kind === "heading" && Boolean(previous.sub) === sub) {
        previous.text = `${previous.text} ${text}`;
        continue;
      }
      blocks.push({ kind: "heading", text, sub });
      continue;
    }
    if (paragraph && line.gap > line.size * 2.05) flush();
    if (paragraph.endsWith("-")) paragraph = `${paragraph.slice(0, -1)}${line.text}`;
    else paragraph = paragraph ? `${paragraph} ${line.text}` : line.text;
  }
  flush();
  return blocks;
}

function paginate(blocks: BookBlock[]): LibraryPages {
  return layPages([blocks]);
}

function normTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function looksLikeTitle(text: string) {
  const words = text.trim().split(/\s+/);
  if (!words.length || words.length > 10 || text.length > 68) return false;
  if (/[.!?]$/.test(text) && words.length > 4) return false;
  return true;
}

function shapeReadBook(blocks: BookBlock[], outline: { title: string; depth: number }[]): BookBlock[] {
  const known = outline
    .map((item) => ({ ...item, key: normTitle(item.title) }))
    .filter((item) => item.key.length > 2);
  const next: BookBlock[] = [];
  for (const block of blocks) {
    if (block.kind !== "heading") {
      const text = block.text.trim();
      const hit = text.match(/^(chapter\s+(?:\d+|[ivxlcdm]+)\b[^\n.]{0,70}|part\s+(?:\d+|[ivxlcdm]+)\b[^\n.]{0,70})\s+([\s\S]+)$/i);
      if (hit && hit[2] && hit[2].trim().length > 40) {
        next.push({ kind: "heading", text: hit[1].trim(), role: "chapter" });
        next.push({ ...block, text: hit[2].trim(), fresh: true });
        continue;
      }
      next.push(block);
      continue;
    }
    const text = block.text.replace(/\s+/g, " ").trim();
    const key = normTitle(text);
    const listed = known.find((item) => item.key === key || item.key.startsWith(`${key} `) || key.startsWith(`${item.key} `));
    let role: BookBlock["role"];
    let sub = Boolean(block.sub);
    if (/^copyright\b|all rights reserved/i.test(text)) {
      role = "copyright";
      sub = false;
    } else if (/^dedication$/i.test(text)) {
      role = "dedication";
      sub = false;
    } else if (/^(foreword|preface|introduction|prologue)\b/i.test(text)) {
      role = "preface";
      sub = false;
    } else if (/^(epilogue|acknowledg(?:e)?ments?|glossary|index|about the author|afterword|appendix|bibliography)\b/i.test(text)) {
      role = "back";
      sub = false;
    } else if (/^(?:chapter|part)\s+(?:\d+|[ivxlcdm]+)\b/i.test(text)) {
      role = "chapter";
      sub = false;
    } else if (listed) {
      role = listed.depth > 0 ? "section" : "chapter";
      sub = listed.depth > 0;
    } else if (known.length) {
      if (!looksLikeTitle(text)) {
        next.push({ kind: "text", text, fresh: true });
        continue;
      }
      role = "section";
      sub = true;
    } else if (!looksLikeTitle(text)) {
      next.push({ kind: "text", text, fresh: true });
      continue;
    } else if (sub) {
      role = "section";
    } else {
      role = "chapter";
      sub = false;
    }
    next.push({ kind: "heading", text, sub, role });
  }
  return next;
}

function repeated(pageLines: string[][]): Set<string> {
  const counts = new Map<string, number>();
  for (const lines of pageLines) {
    const edges = [lines[0], lines[lines.length - 1]].filter(Boolean);
    for (const line of new Set(edges)) {
      if (line.length > 60) continue;
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }
  const drop = new Set<string>();
  const need = Math.max(3, Math.ceil(pageLines.length * 0.6));
  for (const [line, count] of counts) if (count >= need) drop.add(line);
  return drop;
}

export async function bookFromPdf(bytes: Uint8Array, shape: "plain" | "book" = "plain"): Promise<{ body: string } | { error: string }> {
  arm();
  let doc: Awaited<ReturnType<typeof getDocument>["promise"]> | null = null;
  try {
    doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, standardFontDataUrl: fontUrl() }).promise;
    const total = Math.min(doc.numPages, MAX_PDF_PAGES);
    const gathered: Line[][] = [];
    for (let number = 1; number <= total; number += 1) {
      const page = await doc.getPage(number);
      try {
        const content = await page.getTextContent();
        gathered.push(linesOf(content.items as { str?: string; transform: number[]; height?: number; width?: number }[]));
      } catch {
        gathered.push([]);
      }
    }
    const drop = repeated(gathered.map((lines) => lines.map((line) => line.text)));
    const blocks = blocksFrom(gathered.flat().filter((line) => !drop.has(line.text)));
    const letters = blocks.reduce((sum, block) => sum + block.text.replace(/[^A-Za-z]/g, "").length, 0);
    if (letters < 40) return { error: "This PDF is a scan. It has no words to set as a book." };
    let outline: { title: string; depth: number }[] = [];
    if (shape === "book") {
      try {
        const tree = await doc.getOutline();
        const walk = (items: unknown, depth: number) => {
          if (!Array.isArray(items)) return;
          for (const item of items) {
            if (!item || typeof item !== "object") continue;
            const node = item as { title?: unknown; items?: unknown };
            const title = typeof node.title === "string" ? node.title.replace(/\s+/g, " ").trim() : "";
            if (title) outline.push({ title, depth });
            walk(node.items, depth + 1);
          }
        };
        walk(tree, 0);
      } catch {
        outline = [];
      }
    }
    const shaped = shape === "book" ? shapeReadBook(blocks, outline) : blocks;
    const pages = paginate(shaped);
    if (!pages.length) return { error: "This PDF is a scan. It has no words to set as a book." };
    let author = "";
    let summary = "";
    try {
      const meta = await doc.getMetadata();
      const info = (meta?.info ?? {}) as { Author?: string; Subject?: string };
      author = (info.Author ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
      summary = (info.Subject ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
    } catch {
      author = "";
    }
    return { body: pack(pages, { author, summary }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/password/i.test(message)) return { error: "This PDF is locked." };
    return { error: "This PDF could not be read." };
  } finally {
    await doc?.destroy();
  }
}

const RASTER: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };

function pack(pages: LibraryPages, extra: { author?: string; summary?: string; cover?: string }) {
  const body: Record<string, unknown> = { v: 1, pages };
  if (extra.author) body.author = extra.author;
  if (extra.summary) body.summary = extra.summary;
  if (extra.cover?.startsWith("data:image/")) body.cover = extra.cover;
  return JSON.stringify(body);
}

function imageUrl(bytes: Buffer, name: string, limit = 160_000) {
  if (bytes.length < 40 || bytes.length > limit) return "";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const mime = RASTER[ext];
  if (!mime) return "";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function inside(root: string, file: string) {
  const base = resolve(root);
  const full = resolve(file);
  return full === base || full.startsWith(`${base}/`) ? full : "";
}

async function unzipTo(bytes: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), "book-"));
  const file = join(dir, "book.bin");
  await writeFile(file, bytes);
  await new Promise<void>((resolvePromise, reject) => {
    execFile("unzip", ["-qq", file, "-d", dir], (error) => (error ? reject(error) : resolvePromise()));
  });
  return dir;
}

function plainBlocks(text: string): BookBlock[] {
  const blocks: BookBlock[] = [];
  for (const chunk of text.split(/\n+/)) {
    const line = chunk.replace(/[ \t]+/g, " ").trim();
    if (!line || isPageNumber(line)) continue;
    if (/^(?:\* \* \*|\*\*\*|• • •|· · ·)$/.test(line)) {
      blocks.push({ kind: "scene", text: "* * *" });
      continue;
    }
    const heading = /^(?:chapter|part)\s+(?:\d+|[ivxlc]+)\b/i.test(line) || /^(?:foreword|preface|introduction|prologue|epilogue|acknowledg|dedication|copyright|glossary|about the author|afterword|appendix)\b/i.test(line);
    if (heading) blocks.push({ kind: "heading", text: line });
    else blocks.push({ kind: "text", text: line, fresh: true });
  }
  return blocks;
}

function pullImages(inner: string, imageAt: (src: string) => string) {
  const images: BookBlock[] = [];
  for (const img of inner.matchAll(/<img\b([^>]*?)\/?>/gi)) {
    const src = img[1].match(/\bsrc="([^"]+)"/i)?.[1] ?? "";
    const alt = decodeEntities(img[1].match(/\balt="([^"]*)"/i)?.[1] ?? "");
    const url = src ? imageAt(src) : "";
    if (url) images.push({ kind: "image", text: alt, src: url });
  }
  return images;
}

function htmlFileBlocks(html: string, imageAt: (src: string) => string): BookBlock[] {
  const blocks: BookBlock[] = [];
  const pattern = /<(h1|h2|h3|p|blockquote)\b[^>]*>([\s\S]*?)<\/\1>|<img\b([^>]*?)\/?>/gi;
  for (const match of html.matchAll(pattern)) {
    if (match[0].toLowerCase().startsWith("<img")) {
      blocks.push(...pullImages(match[0], imageAt));
      continue;
    }
    const raw = match[2] ?? "";
    blocks.push(...pullImages(raw, imageAt));
    const text = decodeEntities(raw.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!text || isPageNumber(text)) continue;
    const tag = (match[1] ?? "").toLowerCase();
    if (tag === "h1") blocks.push({ kind: "heading", text, role: "chapter" });
    else if (tag === "h2" || tag === "h3") blocks.push({ kind: "heading", text, sub: true, role: "section" });
    else blocks.push({ kind: "text", text, fresh: true, quote: tag === "blockquote", italic: /<(em|i)\b/i.test(raw) && tag !== "blockquote" });
  }
  return blocks;
}

async function docxBook(dir: string) {
  const xml = await readFile(join(dir, "word", "document.xml"), "utf8");
  let rels = "";
  try {
    rels = await readFile(join(dir, "word", "_rels", "document.xml.rels"), "utf8");
  } catch {
    rels = "";
  }
  const relMap = new Map<string, string>();
  for (const rel of rels.matchAll(/<Relationship\b([^>]*)\/?>/gi)) {
    const id = rel[1].match(/\bId="([^"]+)"/)?.[1];
    const target = rel[1].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) relMap.set(id, decodeEntities(target));
  }
  let author = "";
  try {
    const core = await readFile(join(dir, "docProps", "core.xml"), "utf8");
    author = decodeEntities(core.match(/<dc:creator[^>]*>([^<]*)<\/dc:creator>/)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  } catch {
    author = "";
  }
  let cover = "";
  for (const name of ["thumbnail.jpeg", "thumbnail.jpg", "thumbnail.png"]) {
    try {
      cover = imageUrl(await readFile(join(dir, "docProps", name)), name, 280_000);
      if (cover) break;
    } catch {
      cover = "";
    }
  }
  const blocks: BookBlock[] = [];
  let images = 0;
  for (const paragraph of xml.split(/<w:p[ >]/).slice(1)) {
    const style = paragraph.match(/<w:pStyle[^>]*w:val="([^"]+)"/)?.[1] ?? "";
    const heading = /heading/i.test(style);
    const runs: { text: string; italic: boolean }[] = [];
    for (const run of paragraph.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
      const text = decodeEntities([...run[1].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((item) => item[1]).join(""));
      if (!text) continue;
      runs.push({ text, italic: /<w:i(?:\s[^>]*)?\/?>/.test(run[1]) });
    }
    const joined = runs.map((run) => run.text).join("").replace(/\s+/g, " ").trim();
    for (const draw of paragraph.matchAll(/r:embed="(rId\d+)"/g)) {
      if (images >= 12) break;
      const target = relMap.get(draw[1]);
      if (!target) continue;
      const file = inside(dir, target.startsWith("/") ? join(dir, target.replace(/^\/+/, "")) : join(dir, "word", target));
      if (!file) continue;
      try {
        const url = imageUrl(await readFile(file), file);
        if (!url) continue;
        images += 1;
        if (!cover && !joined) {
          cover = url;
          continue;
        }
        const caption = decodeEntities(paragraph.match(/<wp:docPr\b[^>]*\bdescr="([^"]*)"/)?.[1] ?? "");
        blocks.push({ kind: "image", text: caption, src: url });
      } catch {
        /* a missing picture is skipped */
      }
    }
    if (!joined || isPageNumber(joined)) continue;
    if (heading) {
      const sub = /heading\s*[2-9]/i.test(style);
      blocks.push({ kind: "heading", text: joined, sub, role: sub ? "section" : undefined });
      continue;
    }
    let started = false;
    for (const run of runs) {
      const text = run.text.replace(/\s+/g, " ").trim();
      if (!text) continue;
      blocks.push({ kind: "text", text, fresh: !started, italic: run.italic });
      started = true;
    }
  }
  return { blocks, author, cover };
}

async function walkFiles(dir: string, pattern: RegExp) {
  const found: string[] = [];
  const walk = async (folder: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (pattern.test(entry.name)) found.push(path);
    }
  };
  await walk(dir);
  return found;
}

async function epubBook(dir: string) {
  const opfs = await walkFiles(dir, /\.opf$/i);
  const opfPath = opfs[0];
  if (!opfPath) return { blocks: [] as BookBlock[], author: "", summary: "", cover: "" };
  const opf = await readFile(opfPath, "utf8");
  const base = dirname(opfPath);
  const author = decodeEntities(opf.match(/<dc:creator[^>]*>([^<]*)<\/dc:creator>/i)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  const summary = decodeEntities((opf.match(/<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i)?.[1] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 700);
  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const item of opf.matchAll(/<item\b([^>]*)\/?>/gi)) {
    const tag = item[1];
    const id = tag.match(/\bid="([^"]+)"/i)?.[1];
    const href = tag.match(/\bhref="([^"]+)"/i)?.[1];
    if (!id || !href) continue;
    manifest.set(id, {
      href: decodeEntities(href),
      type: tag.match(/\bmedia-type="([^"]+)"/i)?.[1] ?? "",
      props: tag.match(/\bproperties="([^"]+)"/i)?.[1] ?? "",
    });
  }
  const coverId = opf.match(/<meta[^>]*name="cover"[^>]*content="([^"]+)"/i)?.[1] ?? [...manifest.entries()].find(([, item]) => /cover-image/.test(item.props))?.[0] ?? "";
  const coverItem = coverId ? manifest.get(coverId) : undefined;
  let cover = "";
  if (coverItem && /image\//.test(coverItem.type)) {
    const file = inside(dir, resolve(base, decodeURIComponent(coverItem.href)));
    if (file) {
      try {
        cover = imageUrl(await readFile(file), file, 280_000);
      } catch {
        cover = "";
      }
    }
  }
  const order = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/gi)].map((match) => match[1]);
  const ids = order.length ? order : [...manifest.keys()];
  const blocks: BookBlock[] = [];
  for (const id of ids) {
    const item = manifest.get(id);
    if (!item || !/html|xml/.test(item.type)) continue;
    if (id === coverId || /cover-image|\bnav\b/.test(item.props) || /(?:^|\/)(?:toc|nav|cover)\b/i.test(item.href)) continue;
    const file = inside(dir, resolve(base, decodeURIComponent(item.href)));
    if (!file) continue;
    const imageAt = (src: string) => {
      const clean = src.split("#")[0]?.split("?")[0] ?? "";
      if (!clean || clean.startsWith("data:")) return "";
      const picture = inside(dir, resolve(dirname(file), decodeURIComponent(clean)));
      if (!picture) return "";
      try {
        return imageUrl(readFileSync(picture), picture);
      } catch {
        return "";
      }
    };
    try {
      blocks.push(...htmlFileBlocks(await readFile(file, "utf8"), imageAt));
    } catch {
      /* skip a broken chapter */
    }
  }
  return { blocks, author, summary, cover };
}

export async function bookFromFile(name: string, bytes: Buffer, shape: "plain" | "book" = "plain"): Promise<{ body: string } | { error: string }> {
  const kind = name.split(".").pop()?.toLowerCase() ?? "";
  if (kind === "pdf" || bytes.subarray(0, 5).toString() === "%PDF-") return bookFromPdf(bytes, shape);
  if (kind === "txt" || kind === "text") {
    const blocks = plainBlocks(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    const pages = paginate(blocks);
    if (!pages.length) return { error: "That file has no words to set as a book." };
    return { body: pack(pages, {}) };
  }
  let dir = "";
  try {
    dir = await unzipTo(bytes);
    if (kind === "docx") {
      const made = await docxBook(dir);
      const pages = paginate(made.blocks);
      if (!pages.length) return { error: "That document has no words to set as a book." };
      return { body: pack(pages, { author: made.author, cover: made.cover }) };
    }
    if (kind === "epub") {
      const made = await epubBook(dir);
      const pages = paginate(made.blocks);
      if (!pages.length) return { error: "That book has no words to set as a book." };
      return { body: pack(pages, { author: made.author, summary: made.summary, cover: made.cover }) };
    }
  } catch {
    return { error: "That file could not be read." };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
  return { error: "Use a PDF, Word, EPUB, or text file." };
}
