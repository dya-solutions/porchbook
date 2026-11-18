export type BookBlock = {
  kind: "heading" | "text" | "scene" | "image";
  text: string;
  verse?: number;
  fresh?: boolean;
  sub?: boolean;
  italic?: boolean;
  quote?: boolean;
  lead?: boolean;
  reference?: string;
  src?: string;
  role?: "chapter" | "section" | "preface" | "copyright" | "dedication" | "back" | "kicker" | "numeral";
};
export type LibraryPages = BookBlock[][];

export type PageFit = "small" | "normal" | "large";

const FITS: Record<PageFit, { lines: number; words: number }> = {
  small: { lines: 17, words: 11 },
  normal: { lines: 14, words: 9 },
  large: { lines: 11, words: 8 },
};

function lineCount(text: string, words: number) {
  return Math.max(1, Math.ceil(wordCount(text) / words));
}

function sheetLines(sheet: BookBlock[], words: number) {
  return sheet.reduce((sum, block) => {
    if (block.kind === "heading") return sum + headingLines(block.text, Boolean(block.sub), words);
    if (block.kind === "scene" || block.kind === "image") return sum + 2;
    return sum + lineCount(block.text, words);
  }, 0);
}

function keepTogether(pages: LibraryPages, words: number, room: number) {
  const next = pages.map((page) => [...page]);
  while (next.length > 1) {
    const last = next[next.length - 1];
    const tail = sheetLines(last, words);
    if (tail > 4) break;
    const previous = next[next.length - 2];
    if (sheetLines(previous, words) + tail > room + 1) break;
    next[next.length - 2] = [...previous, ...last];
    next.pop();
  }
  return next;
}

function headingLines(text: string, sub: boolean, words: number) {
  return Math.max(sub ? 2 : 3, lineCount(text, words) + 1);
}

export function readLibrary(body: string): LibraryPages | null {
  if (!body.startsWith('{"v":1')) return null;
  try {
    const raw = JSON.parse(body) as { v?: number; pages?: LibraryPages };
    if (raw.v !== 1 || !Array.isArray(raw.pages) || !raw.pages.length) return null;
    const pages = raw.pages.filter((page) => Array.isArray(page) && page.some((block) => block?.text));
    return pages.length ? pages : null;
  } catch {
    return null;
  }
}

export function decodeEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => {
      const point = Number(code);
      return point > 0 && point < 0x110000 ? String.fromCodePoint(point) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => {
      const point = parseInt(code, 16);
      return point > 0 && point < 0x110000 ? String.fromCodePoint(point) : "";
    })
    .replaceAll("&" + "lt;", "<")
    .replaceAll("&" + "gt;", ">")
    .replaceAll("&" + "quot;", '"')
    .replaceAll("&" + "apos;", "'")
    .replaceAll("&" + "amp;", "&");
}

export function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function sentencesOf(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const sentences: string[] = [];
  let start = 0;
  for (let index = 0; index < cleaned.length; index += 1) {
    const mark = cleaned[index];
    if ((mark === "." || mark === "!" || mark === "?") && (index === cleaned.length - 1 || /\s/.test(cleaned[index + 1] ?? ""))) {
      const sentence = cleaned.slice(start, index + 1).trim();
      if (sentence) sentences.push(sentence);
      start = index + 1;
    }
  }
  const rest = cleaned.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

export function isPageNumber(text: string) {
  return /^\d{1,4}[.]?$/.test(text.trim());
}

export function isReference(text: string) {
  const line = text.trim();
  if (!line || line.length > 80) return false;
  return /^(?:[—–-]\s*)?(?:[1-3]\s+)?[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?\s+\d+:\d+/.test(line);
}

function placeOf(text: string): BookBlock["role"] {
  if (/^copyright\b/i.test(text)) return "copyright";
  if (/^dedication$/i.test(text)) return "dedication";
  if (/^(foreword|preface|introduction|prologue)$/i.test(text)) return "preface";
  if (/^(epilogue|acknowledg|notes|glossary|index|about the author|afterword|appendix)/i.test(text)) return "back";
  return "chapter";
}

function isScene(text: string) {
  return /^(?:\* \* \*|\*\*\*|• • •|· · ·)$/.test(text.trim());
}

function splitSpeakers(text: string) {
  const sentences = sentencesOf(text);
  if (sentences.length < 2) return [text];
  const parts: string[] = [];
  let buf = "";
  const opens = (line: string) => /^[\u201C"]/.test(line);
  const closed = (line: string) => /[\u201D"]/.test(line);
  for (const sentence of sentences) {
    if (opens(sentence) && buf && closed(buf)) {
      parts.push(buf.trim());
      buf = sentence;
    } else buf = buf ? `${buf} ${sentence}` : sentence;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.length > 1 ? parts : [text];
}

export function layPages(pages: LibraryPages, fit: PageFit = "normal"): LibraryPages {
  const budget = FITS[fit];
  const blocks = pages.flat().filter((block) => {
    if (!block) return false;
    if (block.kind === "image") return Boolean(block.src);
    return Boolean(block.text?.trim()) && !(block.kind === "text" && isPageNumber(block.text));
  });
  const merged: BookBlock[] = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (block.kind === "image") {
      merged.push(block);
      continue;
    }
    if (isScene(block.text)) {
      merged.push({ kind: "scene", text: "* * *" });
      continue;
    }
    if (isReference(block.text) && previous && (previous.kind === "text" || previous.quote)) {
      previous.reference = block.text.trim();
      previous.quote = true;
      continue;
    }
    const heading = block.kind === "heading";
    if (heading && previous?.kind === "heading" && !previous.sub && !block.sub && (previous.role ?? "chapter") === "chapter" && (block.role ?? placeOf(block.text)) === "chapter") {
      previous.text = `${previous.text} ${block.text.trim()}`;
      continue;
    }
    if (heading) {
      const sub = Boolean(block.sub);
      merged.push({ kind: "heading", text: block.text.trim(), sub, role: block.role ?? (sub ? "section" : placeOf(block.text)) });
      continue;
    }
    merged.push({ ...block, quote: Boolean(block.quote) });
  }
  const next: LibraryPages = [];
  let sheet: BookBlock[] = [];
  let used = 0;
  const room = Math.max(7, budget.lines - 4);
  let limit = room;
  let held: BookBlock | null = null;
  let follow: BookBlock["kind"] | "start" = "start";
  const ship = () => {
    if (sheet.some((block) => block.kind === "text" || block.kind === "scene" || block.kind === "image" || block.verse)) next.push(sheet);
    else if (sheet[0]?.kind === "heading") held = sheet[0];
    sheet = [];
    used = 0;
    limit = room;
  };
  const release = (lines: number) => {
    if (!held) return;
    const cost = held.kind === "heading" ? headingLines(held.text, Boolean(held.sub), budget.words) : 2;
    if (used > 0 && used + cost + lines > limit) ship();
    if (held.role === "chapter") limit = Math.max(6, Math.round(room * 0.62));
    sheet.push(held);
    used += cost;
    follow = held.kind;
    held = null;
  };
  for (const block of merged) {
    if (block.kind === "image") {
      if (held) release(8);
      if (used > 0 && used + 8 > limit) ship();
      if (held) release(8);
      sheet.push(block);
      used += 8;
      follow = "image";
      continue;
    }
    if (block.kind === "heading" || block.kind === "scene") {
      const opensChapter = block.role === "chapter" || block.role === "back" || block.role === "copyright" || block.role === "dedication" || block.role === "preface";
      if (opensChapter && sheet.some((part) => part.kind === "text" || part.kind === "image")) ship();
      const snapshot = held as BookBlock | null;
      const sameChapter = snapshot !== null && snapshot.kind === "heading" && block.kind === "heading" && snapshot.role === "chapter" && block.role === "chapter";
      if (snapshot && !sameChapter) release(2);
      if (sameChapter && snapshot && block.kind === "heading") held = { kind: "heading", text: `${snapshot.text} ${block.text}`, sub: snapshot.sub, role: "chapter" };
      else held = block;
      continue;
    }
    const pieces = block.verse ? [block.text] : splitSpeakers(block.text);
    for (const piece of pieces) {
      const sentences = sentencesOf(piece);
      sentences.forEach((sentence, index) => {
        if (isPageNumber(sentence)) return;
        let pending = sentence.trim();
        let pieceIndex = 0;
        while (pending) {
          const words = pending.split(/\s+/).filter(Boolean);
          if (!words.length) break;
          release(1);
          const roomWords = Math.max(budget.words, (limit - used) * budget.words);
          const take = Math.min(words.length, roomWords);
          const piece = words.slice(0, take).join(" ");
          const lines = lineCount(piece, budget.words);
          if (used > 0 && used + lines > limit) {
            ship();
            continue;
          }
          const starts = pieceIndex === 0 && index === 0 && (block.fresh === true || pieces.length > 1);
          const lead = starts && !block.quote && (follow === "start" || follow === "heading" || follow === "scene");
          const more = words.slice(take).join(" ");
          sheet.push({
            kind: "text",
            text: piece,
            fresh: starts,
            lead,
            verse: block.verse,
            italic: block.italic,
            quote: block.quote,
            reference: !more && index === sentences.length - 1 ? block.reference : undefined,
          });
          used += lines;
          follow = "text";
          pending = more;
          pieceIndex += 1;
        }
      });
    }
  }
  ship();
  if (held) {
    if (next.length) next[next.length - 1].push(held);
    else next.push([held]);
  }
  const kept = keepTogether(next, budget.words, room);
  return kept.length ? kept : pages;
}

export function writtenPages(pages: string[]): LibraryPages {
  const blocks: BookBlock[] = [];
  for (const page of pages) {
    for (const chunk of page.split(/\n+/)) {
      const text = chunk.replace(/[ \t]+/g, " ").trim();
      if (text) blocks.push({ kind: "text", text, fresh: true });
    }
  }
  if (!blocks.length) return [];
  return layPages([blocks]);
}

export function layChapter(name: string, chapter: number, verses: string[], fit: PageFit = "normal"): LibraryPages {
  const budget = FITS[fit];
  const room = Math.max(7, budget.lines - 4);
  const title = `${name} ${chapter}`;
  const sheets: LibraryPages = [];
  let sheet: BookBlock[] = [{ kind: "heading", text: title }];
  let used = headingLines(title, false, budget.words);
  const ship = () => {
    if (!sheet.some((block) => block.verse || block.kind === "text")) return;
    sheets.push(sheet);
    sheet = [];
    used = 0;
  };
  verses.forEach((verse, index) => {
    const text = verse.replace(/\s+/g, " ").trim();
    if (!text) return;
    const lines = lineCount(text, budget.words);
    if (sheet.some((block) => block.verse) && used + lines > room) ship();
    sheet.push({ kind: "text", text, verse: index + 1 });
    used += lines;
  });
  ship();
  const kept = keepTogether(sheets.length ? sheets : [[{ kind: "heading", text: title }]], budget.words, room);
  return kept.length ? kept : [[{ kind: "heading", text: title }]];
}

export function pageOfVerse(pages: LibraryPages | DisplayPage[], verse: number) {
  const index = pages.findIndex((sheet) => {
    const blocks = Array.isArray(sheet) ? sheet : sheet.blocks;
    return blocks.some((block) => block.verse === verse);
  });
  return index < 0 ? 0 : index;
}

export type PageFace = "cover" | "title" | "copyright" | "dedication" | "contents" | "preface" | "chapter" | "text" | "back" | "rear";

export type DisplayPage = {
  face: PageFace;
  blocks: BookBlock[];
  number: number | null;
  running: boolean;
  bookTitle: string;
  author: string;
  summary: string;
  tone: string;
  cover: string;
  entries: { title: string; page: number; printed: number | null }[];
};

const CLOTH = ["#6E4B3A", "#3E4C3A", "#243044", "#6B3A3A", "#3F3A4A", "#1F3A4D", "#5C4A32", "#2F3D38"];

export function clothOf(title: string) {
  let hash = 0;
  for (const char of title) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return CLOTH[hash % CLOTH.length];
}

export type BookMeta = { author: string; summary: string; cover: string };

export function readBookMeta(body: string): BookMeta {
  const empty: BookMeta = { author: "", summary: "", cover: "" };
  if (!body.startsWith('{"v":1')) return empty;
  try {
    const raw = JSON.parse(body) as { author?: unknown; summary?: unknown; cover?: unknown };
    const cover = typeof raw.cover === "string" && raw.cover.startsWith("data:image/") ? raw.cover.slice(0, 400_000) : "";
    return {
      author: typeof raw.author === "string" ? raw.author.replace(/\s+/g, " ").trim().slice(0, 160) : "",
      summary: typeof raw.summary === "string" ? raw.summary.replace(/\s+/g, " ").trim().slice(0, 700) : "",
      cover,
    };
  } catch {
    return empty;
  }
}

function blankPage(face: PageFace, meta: { title: string; author: string; summary: string; tone: string; cover: string }): DisplayPage {
  return { face, blocks: [], number: null, running: false, bookTitle: meta.title, author: meta.author, summary: meta.summary, tone: meta.tone, cover: meta.cover, entries: [] };
}

export function dressBook(pages: LibraryPages, fit: PageFit, meta: { title: string; author?: string; summary?: string; cover?: string }): DisplayPage[] {
  const laid = pages.length ? layPages(pages, fit) : [];
  const author = meta.author?.trim() ?? "";
  const summary = meta.summary?.trim() ?? "";
  const tone = clothOf(meta.title || "Book");
  const cover = meta.cover?.startsWith("data:image/") ? meta.cover : "";
  const book = { title: meta.title || "Untitled", author, summary, tone, cover };
  const body: DisplayPage[] = [];
  let count = 0;
  let started = false;
  let chapterNo = 0;
  for (const source of laid) {
    const heading = source.find((block) => block.kind === "heading");
    const role = heading?.role;
    const opens = source[0]?.kind === "heading";
    let face: PageFace = "text";
    if (opens && role === "chapter") face = "chapter";
    else if (opens && role === "back") face = "back";
    else if (opens && role === "copyright") face = "copyright";
    else if (opens && role === "dedication") face = "dedication";
    else if (opens && role === "preface") face = "preface";
    let blocks = source;
    if (face === "chapter") {
      chapterNo += 1;
      const head = blocks.find((block) => block.kind === "heading" && block.role === "chapter");
      if (head && !/^chapter\s+\d+/i.test(head.text)) blocks = [{ kind: "heading", text: `Chapter ${chapterNo}`, role: "kicker", sub: true }, ...blocks];
      started = true;
    }
    const counts = started && (face === "chapter" || face === "text" || face === "back");
    if (counts) count += 1;
    const show = counts && face !== "chapter";
    body.push({ face, blocks, number: counts ? count : null, running: show, bookTitle: book.title, author, summary, tone, cover, entries: [] });
  }
  const prelim = body.filter((page) => page.face === "copyright" || page.face === "dedication");
  const rest = body.filter((page) => page.face !== "copyright" && page.face !== "dedication");
  const front = [blankPage("cover", book), blankPage("title", book), ...prelim];
  if (rest.some((page) => page.face === "chapter" || page.face === "back" || page.face === "preface")) front.push(blankPage("contents", book));
  const pagesOut = [...front, ...rest, blankPage("rear", book)];
  const listed = pagesOut.flatMap((page, index) => {
    if (page.face !== "chapter" && page.face !== "back" && page.face !== "preface") return [];
    const heading = page.blocks.find((block) => block.kind === "heading" && block.role !== "section" && block.role !== "kicker");
    return heading ? [{ title: heading.text, page: index, printed: page.number }] : [];
  });
  const perSheet = fit === "large" ? 6 : fit === "small" ? 11 : 8;
  const sheets = [];
  for (let start = 0; start < listed.length; start += perSheet) sheets.push(listed.slice(start, start + perSheet));
  if (sheets.length > 1) {
    const at = pagesOut.findIndex((page) => page.face === "contents");
    if (at >= 0) {
      const extra = sheets.slice(1).map(() => blankPage("contents", book));
      pagesOut.splice(at + 1, 0, ...extra);
      sheets.forEach((entries, index) => {
        const page = pagesOut[at + index];
        if (page) page.entries = entries.map((entry) => ({ ...entry, page: entry.page + extra.length }));
      });
    }
  } else {
    for (const page of pagesOut) if (page.face === "contents") page.entries = listed;
  }
  return pagesOut;
}

export function biblePages(name: string, chapter: number, verses: string[], fit: PageFit = "normal"): DisplayPage[] {
  const laid = layChapter(name, chapter, verses, fit);
  const tone = clothOf(name);
  return laid.map((blocks, index) => {
    const opener = chapter === 1 && index === 0;
    const next = blocks.filter((block) => block.kind !== "heading");
    if (opener) next.unshift({ kind: "heading", text: name, role: "chapter" });
    else if (index === 0) next.unshift({ kind: "heading", text: String(chapter), role: "numeral" });
    return {
      face: opener ? "chapter" : "text",
      blocks: next,
      number: opener ? null : index + 1,
      running: !opener,
      bookTitle: name,
      author: "",
      summary: "",
      tone,
      cover: "",
      entries: [],
    };
  });
}

export function htmlBlocks(html: string): BookBlock[] {
  const blocks: BookBlock[] = [];
  for (const match of html.matchAll(/<(h1|h2|h3|p|blockquote|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = decodeEntities(match[2].replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const tag = match[1].toLowerCase();
    if (tag === "h1") blocks.push({ kind: "heading", text, role: "chapter" });
    else if (tag === "h2" || tag === "h3") blocks.push({ kind: "heading", text, sub: true, role: "section" });
    else blocks.push({ kind: "text", text, fresh: true, quote: tag === "blockquote", italic: /<(em|i)\b/i.test(match[2]) && tag !== "blockquote" });
  }
  if (!blocks.length) {
    const text = decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (text) blocks.push({ kind: "text", text, fresh: true });
  }
  return blocks;
}

export function dayPages(html: string, dateLabel: string, fit: PageFit = "normal"): DisplayPage[] {
  const blocks = htmlBlocks(html);
  const titleBlock = blocks.find((block) => block.kind === "heading" && block.role === "chapter");
  const title = titleBlock?.text || "Devotional";
  const rest = blocks.filter((block) => block !== titleBlock);
  const laid = layPages([[{ kind: "heading", text: dateLabel, role: "kicker", sub: true }, { kind: "heading", text: title, role: "chapter" }, ...rest]], fit);
  const tone = clothOf(title);
  return laid.map((sheet, index) => {
    const opener = index === 0;
    return {
      face: opener ? "chapter" : "text",
      blocks: sheet,
      number: opener ? null : index,
      running: !opener,
      bookTitle: title,
      author: "",
      summary: "",
      tone,
      cover: "",
      entries: [],
    };
  });
}

export function contentsOf(pages: DisplayPage[]) {
  return pages.find((page) => page.face === "contents")?.entries ?? [];
}
