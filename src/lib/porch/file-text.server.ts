import { inflateRawSync, inflateSync } from "node:zlib";

const MAX_BODY = 18000;

function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let i = 0;
  while (i + 30 < buf.length) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break;
    const flags = buf.readUInt16LE(i + 6);
    const method = buf.readUInt16LE(i + 8);
    let size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString("utf8");
    const start = i + 30 + nameLen + extraLen;
    if (flags & 0x8 && size === 0) {
      const next = buf.indexOf(Buffer.from([0x50, 0x4b]), start);
      size = next > start ? next - start : buf.length - start;
    }
    const data = buf.slice(start, start + size);
    if (method === 0) files.set(name, data);
    else if (method === 8) {
      try {
        files.set(name, inflateRawSync(data));
      } catch {
        /* a part that will not open is skipped */
      }
    }
    i = start + size;
  }
  return files;
}

function xmlText(xml: string): string {
  return xml
    .replace(/<w:p[ >]/g, "\n")
    .replace(/<a:p[ >]/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function docxText(buf: Buffer): string {
  const xml = unzip(buf).get("word/document.xml");
  return xml ? xmlText(xml.toString("utf8")) : "";
}

function pptxText(buf: Buffer): string {
  const files = unzip(buf);
  const names = [...files.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort();
  return names.map((name) => xmlText(files.get(name)!.toString("utf8"))).join("\n");
}

function sharedStrings(files: Map<string, Buffer>): string[] {
  const xml = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const strings: string[] = [];
  const re = /<si[\s>][\s\S]*?<\/si>/g;
  for (const match of xml.match(re) ?? []) strings.push(xmlText(match).replace(/\s+/g, " ").trim());
  return strings;
}

function xlsxText(buf: Buffer): string {
  const files = unzip(buf);
  const strings = sharedStrings(files);
  const sheets = [...files.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort();
  const lines: string[] = [];
  for (const name of sheets) {
    const xml = files.get(name)!.toString("utf8");
    const rows = xml.match(/<row[\s>][\s\S]*?<\/row>/g) ?? [];
    let headers: string[] = [];
    rows.forEach((row, index) => {
      const cells = [...row.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)].map((cell) => {
        const attr = cell[1] ?? "";
        const inner = cell[2] ?? "";
        const value = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
        if (attr.includes('t="s"')) return strings[Number(value)] ?? "";
        if (attr.includes('t="inlineStr"')) return xmlText(inner).trim();
        return value.trim();
      });
      if (cells.every((cell) => !cell)) return;
      if (index === 0 && cells.some((cell) => cell && !/^-?\d/.test(cell))) {
        headers = cells;
        return;
      }
      const parts = cells.flatMap((cell, cellIndex) => {
        if (!cell) return [];
        const head = headers[cellIndex];
        return [head ? `${head}: ${cell}` : cell];
      });
      if (parts.length) lines.push(parts.join(" | "));
    });
  }
  return lines.join("\n");
}

function pdfStrings(text: string): string {
  const found: string[] = [];
  const re = /\((?:\\.|[^\\)])*\)/g;
  for (const match of text.match(re) ?? []) {
    const raw = match.slice(1, -1);
    const word = raw
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\t/g, " ")
      .replace(/\\([()\\])/g, "$1")
      .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(Number.parseInt(octal, 8)))
      .replace(/[^\S\n]+/g, " ")
      .trim();
    if (word && /[A-Za-z0-9]/.test(word)) found.push(word);
  }
  return found.join(" ").replace(/ (?=\n)/g, "");
}

function pdfText(buf: Buffer): string {
  const latin = buf.toString("latin1");
  const chunks: string[] = [];
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(latin))) {
    const dict = latin.slice(Math.max(0, match.index - 300), match.index);
    const raw = Buffer.from(match[1] ?? "", "latin1");
    if (dict.includes("FlateDecode")) {
      try {
        chunks.push(inflateSync(raw).toString("latin1"));
      } catch {
        try {
          chunks.push(inflateRawSync(raw).toString("latin1"));
        } catch {
          /* this stream is not words */
        }
      }
    } else chunks.push(match[1] ?? "");
  }
  return pdfStrings(chunks.join("\n")).replace(/([.!?])\s+/g, "$1\n");
}

function csvText(raw: string): string {
  const rows = raw.split(/\r?\n/).filter((line) => line.trim());
  if (!rows.length) return "";
  const split = (line: string) => line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
  const headers = split(rows[0] ?? "");
  const headed = headers.some((cell) => cell && !/^-?\d/.test(cell));
  return rows
    .slice(headed ? 1 : 0)
    .map((line) => {
      const cells = split(line);
      return cells
        .flatMap((cell, index) => {
          if (!cell) return [];
          const head = headed ? headers[index] : "";
          return [head ? `${head}: ${cell}` : cell];
        })
        .join(" | ");
    })
    .join("\n");
}

function plainText(buf: Buffer): string {
  return buf.toString("utf8").replace(/^\uFEFF/, "");
}

function kindOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function titleOf(name: string): string {
  const dot = name.lastIndexOf(".");
  const bare = (dot > 0 ? name.slice(0, dot) : name).replace(/[_]+/g, " ").trim();
  return bare.slice(0, 80) || "Document";
}

function breakLines(text: string): string {
  return text
    .replace(
      /\s+(?=(?:total collected|total principles|expenditure|balance|tithe|offertory|general partnership|seed\s*\/\s*love offering|thanksgiving|first fruit|others|final position|month totals)\b)/gi,
      "\n",
    )
    .replace(/\s+(?=\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b)/gi, "\n");
}

type Row = { label: string; value: string };
type Section = { heading: string; rows: Row[] };
type ReadingPage = {
  v: 1;
  title: string;
  subtitle: string;
  sections: Section[];
  final?: { label: string; value: string };
  kind?: "day";
  service?: string;
  date?: string;
  lines?: Row[];
};

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

function linesOf(text: string): string[] {
  return breakLines(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line, index, all) => line !== all[index - 1]);
}

export function sameMonthYear(left: string, right: string): boolean {
  const key = (title: string) => {
    const month = title.match(new RegExp(`\\b(${MONTHS})\\b`, "i"));
    const year = title.match(/\b(20\d{2})\b/);
    if (!month?.[1] || !year?.[1]) return "";
    const num = MONTH_NUMBER[month[1].toLowerCase()];
    if (num === undefined) return "";
    return `${num}-${year[1]}`;
  };
  const a = key(left);
  const b = key(right);
  return a !== "" && a === b;
}

function monthPhrase(line: string): string | null {
  const match = line.match(
    new RegExp(`\\b(?:${MONTHS})\\b(?:\\s+\\d{1,2})?[,\\s]+\\b20\\d{2}\\b|\\b20\\d{2}\\b[,\\s]+\\b(?:${MONTHS})\\b`, "i"),
  );
  return match ? match[0].replace(/\s+/g, " ").trim() : null;
}

function splitRow(line: string): Row | null {
  const match = line.match(/(?:UGX|USD|KES|USH|\$|£)\s*\d|\d{1,3}(?:,\d{3})+/i);
  if (!match || match.index === undefined || match.index < 1) return null;
  const label = line
    .slice(0, match.index)
    .replace(/[|:—\-\s]+$/g, "")
    .trim();
  const value = line.slice(match.index).trim();
  if (!label || !value) return null;
  return { label, value };
}

const MONTH_NUMBER: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

function isDated(label: string): boolean {
  return /^\d{1,2}\s+[A-Za-z]{3,}/.test(label);
}

function datePhrase(label: string): string {
  return label.match(/^(\d{1,2}\s+[A-Za-z]+)/)?.[1] ?? label;
}

function dateOf(label: string, year: number): Date | null {
  const match = label.match(/^(\d{1,2})\s+([A-Za-z]+)/);
  if (!match) return null;
  const month = MONTH_NUMBER[match[2].toLowerCase()];
  if (month === undefined) return null;
  return new Date(year, month, Number(match[1]));
}

function groupWeeks(rows: Row[], year: number): { title: string; rows: Row[] }[] {
  const weeks: { title: string; rows: Row[]; start: number }[] = [];
  for (const row of rows) {
    const when = dateOf(row.label, year);
    const phrase = datePhrase(row.label);
    const last = weeks[weeks.length - 1];
    const gap = last && when ? (when.getTime() - last.start) / 86400000 : 99;
    if (last && when && last.rows.length < 2 && gap >= 0 && gap <= 4) {
      if (!last.title.split(" ").slice(0, 2).join(" ").includes(phrase) && !last.title.endsWith(phrase)) last.title = `${last.title} ${phrase}`;
      last.rows.push(row);
    } else {
      weeks.push({ title: phrase, rows: [row], start: when ? when.getTime() : 0 });
    }
  }
  return weeks;
}

function weekStart(when: Date): number {
  const sinceThu = (when.getDay() + 3) % 7;
  return new Date(when.getFullYear(), when.getMonth(), when.getDate() - sinceThu).getTime();
}

function isMonthClose(label: string): boolean {
  return /month total|final position|total collected|total principles|^expenditure\b|^balance\b/i.test(label);
}

function hofBookFromLines(title: string, lines: string[]): { pages: string[]; dates: { label: string; value: string; rows: Row[]; when: number | null; week: string }[] } {
  const year = Number(title.match(/20\d{2}/)?.[0] ?? "");
  let subtitle = "";
  let heading = "";
  const overview: Section[] = [];
  const closing: Section[] = [];
  const dates: { label: string; value: string; rows: Row[]; when: number | null; week: string }[] = [];
  let phase: "overview" | "dates" | "close" = "overview";

  const put = (bucket: Section[], row: Row) => {
    if (!bucket.length || bucket[bucket.length - 1]?.heading !== heading) bucket.push({ heading, rows: [] });
    bucket[bucket.length - 1]?.rows.push(row);
  };

  for (const line of lines) {
    if (monthPhrase(line) === title) continue;
    const row = splitRow(line);
    if (!row) {
      if (isDated(line)) {
        phase = "dates";
        const when = Number.isFinite(year) ? dateOf(line, year) : null;
        dates.push({ label: line, value: "", rows: [], when: when ? when.getTime() : null, week: /week/i.test(heading) ? heading : "" });
        continue;
      }
      if (/week/i.test(line) && line.length <= 60) {
        heading = line;
        continue;
      }
      if (!subtitle && line.length <= 60 && !/^\d+\s+/.test(line)) {
        subtitle = line;
        continue;
      }
      if (line.length <= 60) heading = line;
      continue;
    }
    if (isDated(row.label)) {
      phase = "dates";
      const when = Number.isFinite(year) ? dateOf(row.label, year) : null;
      dates.push({ label: row.label, value: row.value, rows: [], when: when ? when.getTime() : null, week: /week/i.test(heading) ? heading : "" });
      continue;
    }
    if (phase === "dates" && isMonthClose(row.label)) {
      phase = "close";
      heading = "";
    }
    if (phase === "close") {
      put(closing, row);
      continue;
    }
    if (phase === "dates" && dates.length) {
      dates[dates.length - 1]?.rows.push(row);
      continue;
    }
    put(overview, row);
  }

  const pages: ReadingPage[] = [];
  for (const date of dates) {
    const taken = datePhrase(date.label);
    const service = date.label.slice(taken.length).replace(/^[\s—\-–:]+/, "").trim();
    const pick = (pattern: RegExp) => date.rows.find((row) => pattern.test(row.label))?.value ?? "";
    const total = pick(/\btotal\b/i);
    pages.push({
      v: 1,
      kind: "day",
      title: date.label,
      subtitle: "",
      service,
      date: taken,
      sections: [],
      lines: [
        { label: "Tithe", value: pick(/\btithe\b/i) },
        { label: "Offertory", value: pick(/\boffertory\b/i) },
        { label: "Seed / Love Offering", value: pick(/\bseed\b|\blove offering\b/i) },
        { label: "Others", value: pick(/^others\b/i) },
        { label: "TOTAL", value: total || (date.rows.length === 0 ? date.value : "") },
      ],
    });
  }
  const monthSections: Section[] = [
    ...overview.filter((section) => section.rows.length),
    ...dates.map((date) => ({
      heading: date.label,
      rows: date.rows.length ? date.rows : date.value ? [{ label: date.label, value: date.value }] : [],
    })),
    ...closing.filter((section) => section.rows.length),
  ].filter((section) => section.heading || section.rows.length);
  if (monthSections.length) pages.push({ v: 1, title, subtitle, sections: monthSections });
  return { pages: pages.map((page) => JSON.stringify(page)), dates };
}

function pack(title: string, subtitle: string, sections: Section[], final?: { label: string; value: string }): string[] {
  const room = 14;
  const pages: ReadingPage[] = [];
  let current: ReadingPage = { v: 1, title, subtitle, sections: [] };
  let used = 0;
  const push = () => {
    if (current.sections.length) pages.push(current);
    current = { v: 1, title, subtitle, sections: [] };
    used = 0;
  };
  for (const section of sections) {
    let rows = section.rows;
    while (rows.length) {
      const space = room - used - 1;
      if (space <= 0) {
        push();
        continue;
      }
      const take = rows.slice(0, space);
      rows = rows.slice(take.length);
      current.sections.push({ heading: section.heading, rows: take });
      used += 1 + take.length;
      if (rows.length) push();
    }
  }
  if (current.sections.length) pages.push(current);
  if (!pages.length) pages.push({ v: 1, title, subtitle, sections: [] });
  if (final?.value) pages[pages.length - 1]!.final = final;
  return pages.map((page) => JSON.stringify(page));
}

function bookFromLines(title: string, lines: string[]): string[] {
  const year = Number(title.match(/20\d{2}/)?.[0] ?? "");
  let subtitle = "";
  let heading = "";
  let datedHeading = "";
  let final: { label: string; value: string } | undefined;
  const sections: Section[] = [];
  const dated: Row[] = [];
  for (const line of lines) {
    if (monthPhrase(line) === title) continue;
    const row = splitRow(line);
    if (!row) {
      if (!subtitle && line.length <= 60 && !/^\d+\s+/.test(line)) {
        subtitle = line;
        continue;
      }
      if (line.length <= 60) heading = line;
      continue;
    }
    if (/^final position\b/i.test(row.label)) {
      final = { label: row.label, value: row.value };
      continue;
    }
    if (isDated(row.label)) {
      if (!datedHeading) datedHeading = heading;
      dated.push(row);
      continue;
    }
    if (!sections.length || sections[sections.length - 1]?.heading !== heading) sections.push({ heading, rows: [] });
    sections[sections.length - 1]?.rows.push(row);
  }
  const monthPages = pack(title, subtitle, sections.filter((section) => section.rows.length > 0), final);
  const weekPages = groupWeeks(dated, Number.isFinite(year) ? year : 2000).flatMap((week) =>
    pack(week.title, "", [{ heading: datedHeading, rows: week.rows }]),
  );
  return [...monthPages, ...weekPages];
}

function booksIn(title: string, text: string): { title: string; pages: string[] }[] {
  const lines = linesOf(text);
  const groups: { title: string; lines: string[] }[] = [];
  const before: string[] = [];
  for (const line of lines) {
    const phrase = monthPhrase(line);
    if (phrase && !splitRow(line)) {
      groups.push({ title: phrase, lines: [] });
      continue;
    }
    if (groups.length) groups[groups.length - 1]?.lines.push(line);
    else before.push(line);
  }
  if (!groups.length) {
    const pages = bookFromLines(title, lines);
    return [{ title, pages }];
  }
  if (before.length && groups[0]) groups[0].lines = [...before, ...groups[0].lines];
  return groups.map((group) => ({ title: group.title, pages: bookFromLines(group.title, group.lines) }));
}

function weeklyPages(
  month: string,
  dates: { label: string; value: string; rows: Row[]; when: number | null; week: string }[],
): string[] {
  const groups: { key: string; title: string; dates: typeof dates }[] = [];
  for (const date of dates) {
    const key = date.week || (date.when ? String(weekStart(new Date(date.when))) : date.label);
    let group = groups.find((item) => item.key === key);
    if (!group) {
      group = { key, title: date.week || datePhrase(date.label), dates: [] };
      groups.push(group);
    }
    group.dates.push(date);
    if (!date.week && group.dates.length > 1) {
      const first = datePhrase(group.dates[0]?.label ?? "");
      const last = datePhrase(group.dates[group.dates.length - 1]?.label ?? "");
      group.title = first === last ? first : `${first} — ${last}`;
    }
  }
  return groups.map((group) =>
    JSON.stringify({
      v: 1,
      title: group.title,
      subtitle: month,
      sections: group.dates.map((date) => ({
        heading: date.rows.length ? date.label : "",
        rows: date.rows.length ? date.rows : date.value ? [{ label: date.label, value: date.value }] : [],
      })),
    }),
  );
}

function hofBooksIn(title: string, text: string): { title: string; pages: string[] }[] {
  const lines = linesOf(text);
  const groups: { title: string; lines: string[] }[] = [];
  const before: string[] = [];
  for (const line of lines) {
    const phrase = monthPhrase(line);
    if (phrase && !splitRow(line)) {
      groups.push({ title: phrase, lines: [] });
      continue;
    }
    if (groups.length) groups[groups.length - 1]?.lines.push(line);
    else before.push(line);
  }
  if (!groups.length) groups.push({ title, lines });
  else if (before.length && groups[0]) groups[0].lines = [...before, ...groups[0].lines];

  const daily: string[] = [];
  const weekly: string[] = [];
  const monthly: string[] = [];
  for (const group of groups) {
    const read = hofBookFromLines(group.title, group.lines);
    for (const page of read.pages) {
      try {
        const raw = JSON.parse(page) as { kind?: string };
        if (raw.kind === "day") daily.push(page);
        else monthly.push(page);
      } catch {
        monthly.push(page);
      }
    }
    weekly.push(...weeklyPages(group.title, read.dates));
  }
  return [
    { title: "Daily Report", pages: daily },
    { title: "Weekly Report", pages: weekly },
    { title: "Monthly Report", pages: monthly },
  ].filter((book) => book.pages.length);
}

export function booksFromUpload(
  name: string,
  base64: string,
  weeks = false,
): { ok: true; books: { title: string; pages: string[] }[] } | { ok: false; error: string } {
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) return { ok: false, error: "That file is empty." };
  const kind = kindOf(name);
  let text = "";
  if (kind === "docx") text = docxText(bytes);
  else if (kind === "xlsx") text = xlsxText(bytes);
  else if (kind === "pptx") text = pptxText(bytes);
  else if (kind === "pdf") text = pdfText(bytes);
  else if (kind === "csv") text = csvText(plainText(bytes));
  else if (kind === "txt" || kind === "md" || kind === "json") text = plainText(bytes);
  else if (kind === "doc" || kind === "xls" || kind === "ppt") {
    return { ok: false, error: "Save that file as PDF, Word, Excel, or text, then upload it." };
  } else return { ok: false, error: "Save that file as PDF, Word, Excel, or text, then upload it." };
  const books = (weeks ? hofBooksIn : booksIn)(titleOf(name), text).filter((book) =>
    book.pages.some((page) => {
      try {
        const raw = JSON.parse(page) as { kind?: string; lines?: { value?: string }[]; sections?: { rows: unknown[] }[]; final?: { value?: string } };
        return raw.kind === "day" || Boolean(raw.final?.value) || (raw.sections ?? []).some((section) => section.rows.length > 0);
      } catch {
        return page.trim().length > 0;
      }
    }),
  );
  if (!books.length) return { ok: false, error: "That file has no words the book can read." };
  return { ok: true, books };
}

type StoredPage = {
  v: 1;
  title: string;
  subtitle: string;
  sections: Section[];
  final?: { label: string; value: string };
  kind?: "day";
  service?: string;
  date?: string;
  lines?: Row[];
};

function storedPage(text: string): StoredPage | null {
  try {
    const raw = JSON.parse(text) as StoredPage;
    if (raw?.v === 1 && Array.isArray(raw.sections)) return raw;
  } catch {
    return null;
  }
  return null;
}

export function mergeBook(current: string, pages: string[]): { ok: true; body: string } | { ok: false; error: string } {
  const existing = current.split("\f").map(storedPage).filter((page): page is StoredPage => page !== null);
  for (const page of pages.map(storedPage)) {
    if (!page) continue;
    const found = existing.find((item) => item.title === page.title);
    if (!found) {
      existing.push(page);
      continue;
    }
    if (page.kind === "day" && found.kind === "day" && page.lines && found.lines) {
      for (const line of page.lines) {
        const slot = found.lines.find((item) => item.label === line.label);
        if (slot && line.value) slot.value = line.value;
        else if (!slot) found.lines.push(line);
      }
      continue;
    }
    if (!found.final && page.final) found.final = page.final;
    for (const section of page.sections) {
      let dest = found.sections.find((item) => item.heading === section.heading);
      if (!dest) {
        dest = { heading: section.heading, rows: [] };
        found.sections.push(dest);
      }
      for (const row of section.rows) {
        if (!dest.rows.some((item) => item.label === row.label && item.value === row.value)) dest.rows.push(row);
      }
    }
  }
  const body = existing.map((page) => JSON.stringify(page)).join("\f");
  if (body.length > MAX_BODY) return { ok: false, error: "That month is full. What was already there stays. This one did not fit." };
  return { ok: true, body };
}

