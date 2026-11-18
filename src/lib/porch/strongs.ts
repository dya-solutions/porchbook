const STUDY_KEY = "porch-word-study";

export type StrongEntry = {
  id: string;
  original: string;
  transliteration: string;
  pronunciation: string;
  grammar: string;
  origin: string;
  definition: string;
};

export type TaggedWord = { index: number; word: string; ids: string[] };

type RawEntry = { o?: string; tr?: string; ph?: string; pos?: string; et?: string; def?: string };

const books = new Map<number, string[][]>();
const buckets = new Map<string, Record<string, RawEntry>>();
const places = new Map<string, string[]>();
let index: { id: string; tr: string; o: string }[] | null = null;

export function normalizeStrong(raw: string): string | null {
  const match = raw.trim().toUpperCase().replace(/\s+/g, "").replace(/-/g, "").match(/^([GH])0*(\d+)$/);
  if (!match) return null;
  const number = Number(match[2]);
  if (!number) return null;
  return `${match[1]}${number}`;
}

export function displayWords(text: string) {
  return text.split(/\s+/).filter((part) => /[A-Za-z]/.test(part));
}

function fold(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ō/g, "o")
    .replace(/ē/g, "e")
    .replace(/[^a-z\u0370-\u03ff]/g, "");
}

async function bookTags(book: number) {
  const saved = books.get(book);
  if (saved) return saved;
  const response = await fetch(`/bible/study/tags/${String(book).padStart(2, "0")}.json`);
  if (!response.ok) return [];
  const body = (await response.json()) as string[][];
  books.set(book, body);
  return body;
}

export async function tagsForVerse(book: number, chapter: number, verse: number, text: string): Promise<TaggedWord[]> {
  const words = displayWords(text);
  const chapters = await bookTags(book);
  const line = chapters[chapter - 1]?.[verse - 1] ?? "";
  const marks = line ? line.split("|") : [];
  return words.map((word, index) => ({
    index,
    word,
    ids: (marks[index] ?? "").split("+").filter((id) => normalizeStrong(id)),
  }));
}

function shape(id: string, raw: RawEntry): StrongEntry {
  return {
    id,
    original: raw.o ?? "",
    transliteration: raw.tr ?? "",
    pronunciation: raw.ph ?? "",
    grammar: raw.pos ?? "",
    origin: raw.et ?? "",
    definition: raw.def ?? "",
  };
}

export async function strongEntry(id: string): Promise<StrongEntry | null> {
  const number = normalizeStrong(id);
  if (!number) return null;
  const letter = number[0];
  const bucket = Math.floor(Number(number.slice(1)) / 100);
  const key = `${letter}/${bucket}`;
  let file = buckets.get(key);
  if (!file) {
    const response = await fetch(`/bible/study/lex/${letter}/${bucket}.json`);
    if (!response.ok) return null;
    file = (await response.json()) as Record<string, RawEntry>;
    buckets.set(key, file);
  }
  const raw = file[number];
  return raw ? shape(number, raw) : null;
}

export async function occurrencesOf(id: string) {
  const number = normalizeStrong(id);
  if (!number) return [];
  if (places.has(number)) return places.get(number) ?? [];
  const letter = number[0];
  const bucket = Math.floor(Number(number.slice(1)) / 1000);
  const response = await fetch(`/bible/study/occ/${letter}/${bucket}.json`);
  if (!response.ok) return [];
  const body = (await response.json()) as Record<string, string[]>;
  for (const [name, refs] of Object.entries(body)) places.set(name, refs);
  if (!places.has(number)) places.set(number, []);
  return places.get(number) ?? [];
}

export async function searchOriginal(query: string) {
  const needle = fold(query.trim());
  if (needle.length < 2) return [];
  if (!index) {
    const response = await fetch("/bible/study/lex-index.json");
    if (!response.ok) return [];
    index = (await response.json()) as { id: string; tr: string; o: string }[];
  }
  const exact = index.filter((item) => fold(item.tr) === needle || fold(item.o) === needle);
  const partial = exact.length ? [] : index.filter((item) => fold(item.tr).startsWith(needle) || fold(item.o).includes(needle));
  const hits = (exact.length ? exact : partial).slice(0, 12);
  const entries = await Promise.all(hits.map((item) => strongEntry(item.id)));
  return entries.filter((item): item is StrongEntry => Boolean(item));
}

export function keepStudy(text: string) {
  try {
    sessionStorage.setItem(STUDY_KEY, text);
  } catch {
    /* the panel still shows the study */
  }
}

export function peekStudy() {
  try {
    return sessionStorage.getItem(STUDY_KEY) ?? "";
  } catch {
    return "";
  }
}

export function takeStudy() {
  const text = peekStudy();
  try {
    sessionStorage.removeItem(STUDY_KEY);
  } catch {
    /* already gone */
  }
  return text;
}

/** Split on a separator, but never inside brackets. */
function splitTop(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      separator.lastIndex = 0;
      const match = separator.exec(text.slice(at));
      if (match && match.index === 0) {
        parts.push(text.slice(start, at));
        at += match[0].length - 1;
        start = at + 1;
      }
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** A dictionary entry broken into short meanings and the KJV's own words for it. */
export function meaningsOf(entry: StrongEntry): { meanings: string[]; kjv: string[] } {
  const def = entry.definition || "";
  const cut = def.indexOf(":--");
  const head = cut >= 0 ? def.slice(0, cut) : def;
  const tail = cut >= 0 ? def.slice(cut + 3) : "";
  const clean = (part: string) => part.replace(/«0*(\d+)»/g, "$1").replace(/\s+/g, " ").trim().replace(/[.;,]+$/, "").trim();
  const origin = /^(probably |perhaps |apparently )?(from|a primary|akin|compare|cf\b|of (uncertain|foreign|hebrew|latin|chaldee|egyptian|persian)|the same as|a (prolonged|form|variation|contracted|reduplicated|derivative|root|collateral))/i;
  const meanings: string[] = [];
  for (const piece of splitTop(head, /^;/)) {
    const raw = piece.trim();
    if (!raw || origin.test(raw) || raw.includes("{") || (/«\d+»/.test(raw) && raw.length < 60)) continue;
    for (const bit of splitTop(raw, /^,?\s+i\.\s?e\.\s+/)) {
      const text = clean(bit.replace(/^(and|but|also|or)\s+/i, "").replace(/^(by implication|by extension|properly|specially|especially|specifically),?\s+/i, ""));
      if (text && !meanings.includes(text)) meanings.push(text);
    }
  }
  const kjvPart = tail.split(/\.\s+(?=[A-Z])/)[0] ?? "";
  const kjv = splitTop(kjvPart, /^,/)
    .map((word) => clean(word.replace(/^\s*[×X+]\s*/, "")))
    .filter((word) => word.length > 1 && word !== "do");
  return { meanings: meanings.slice(0, 6), kjv: [...new Set(kjv)].slice(0, 12) };
}
