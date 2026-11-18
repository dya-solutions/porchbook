export type BibleBook = { number: number; name: string; abbreviation: string; testament: "old" | "new"; chapters: number };

export type TranslationInfo = {
  id: string;
  name: string;
  abbreviation: string;
  language: string;
  description: string;
  license: string;
};

export type VerseHit = { book: number; chapter: number; verse: number; text: string };

export type BiblePlace = { translation: string; book: number; chapter: number; verse: number };

type RawBook = { abbrev?: string; name?: string; chapters: string[][] };
type Library = { info: TranslationInfo; books: RawBook[] };

const PLACE_KEY = "porch-bible-place";

export const BOOKS: BibleBook[] = [
  ["Genesis", "Gen", 50], ["Exodus", "Exod", 40], ["Leviticus", "Lev", 27], ["Numbers", "Num", 36], ["Deuteronomy", "Deut", 34],
  ["Joshua", "Josh", 24], ["Judges", "Judg", 21], ["Ruth", "Ruth", 4], ["1 Samuel", "1Sam", 31], ["2 Samuel", "2Sam", 24],
  ["1 Kings", "1Kgs", 22], ["2 Kings", "2Kgs", 25], ["1 Chronicles", "1Chr", 29], ["2 Chronicles", "2Chr", 36], ["Ezra", "Ezra", 10],
  ["Nehemiah", "Neh", 13], ["Esther", "Esth", 10], ["Job", "Job", 42], ["Psalms", "Ps", 150], ["Proverbs", "Prov", 31],
  ["Ecclesiastes", "Eccl", 12], ["Song of Solomon", "Song", 8], ["Isaiah", "Isa", 66], ["Jeremiah", "Jer", 52], ["Lamentations", "Lam", 5],
  ["Ezekiel", "Ezek", 48], ["Daniel", "Dan", 12], ["Hosea", "Hos", 14], ["Joel", "Joel", 3], ["Amos", "Amos", 9],
  ["Obadiah", "Obad", 1], ["Jonah", "Jonah", 4], ["Micah", "Mic", 7], ["Nahum", "Nah", 3], ["Habakkuk", "Hab", 3],
  ["Zephaniah", "Zeph", 3], ["Haggai", "Hag", 2], ["Zechariah", "Zech", 14], ["Malachi", "Mal", 4],
  ["Matthew", "Matt", 28], ["Mark", "Mark", 16], ["Luke", "Luke", 24], ["John", "John", 21], ["Acts", "Acts", 28],
  ["Romans", "Rom", 16], ["1 Corinthians", "1Cor", 16], ["2 Corinthians", "2Cor", 13], ["Galatians", "Gal", 6], ["Ephesians", "Eph", 6],
  ["Philippians", "Phil", 4], ["Colossians", "Col", 4], ["1 Thessalonians", "1Thess", 5], ["2 Thessalonians", "2Thess", 3], ["1 Timothy", "1Tim", 6],
  ["2 Timothy", "2Tim", 4], ["Titus", "Titus", 3], ["Philemon", "Phlm", 1], ["Hebrews", "Heb", 13], ["James", "Jas", 5],
  ["1 Peter", "1Pet", 5], ["2 Peter", "2Pet", 3], ["1 John", "1John", 5], ["2 John", "2John", 1], ["3 John", "3John", 1],
  ["Jude", "Jude", 1], ["Revelation", "Rev", 22],
].map(([name, abbreviation, chapters], index) => ({
  number: index + 1,
  name: String(name),
  abbreviation: String(abbreviation),
  testament: index < 39 ? "old" : "new",
  chapters: Number(chapters),
}));

const KJV: TranslationInfo = {
  id: "kjv",
  name: "King James Version",
  abbreviation: "KJV",
  language: "English",
  description: "The 1769 King James text.",
  license: "Public domain",
};

const memory = new Map<string, Library>();
let opening: Promise<void> | null = null;

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("porch-bible", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("texts")) db.createObjectStore("texts");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

type SavedText = { info: TranslationInfo; books: RawBook[] };

async function idbGet(id: string): Promise<SavedText | null> {
  try {
    const db = await idb();
    return await new Promise((resolve) => {
      const tx = db.transaction("texts", "readonly");
      const request = tx.objectStore("texts").get(id);
      request.onsuccess = () => {
        const value = request.result as SavedText | RawBook[] | undefined;
        if (!value) return resolve(null);
        if (Array.isArray(value)) {
          const books = asBooks(value);
          return resolve(books ? { info: KJV, books } : null);
        }
        const books = asBooks(value.books);
        if (!books || !value.info?.id) return resolve(null);
        resolve({ info: value.info, books });
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbPut(id: string, saved: SavedText) {
  try {
    const db = await idb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction("texts", "readwrite");
      tx.objectStore("texts").put(saved, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* the text still lives in memory for this visit */
  }
}

async function idbDelete(id: string) {
  try {
    const db = await idb();
    db.transaction("texts", "readwrite").objectStore("texts").delete(id);
  } catch {
    /* nothing kept to clear */
  }
}

async function idbKeys(): Promise<string[]> {
  try {
    const db = await idb();
    return await new Promise((resolve) => {
      const tx = db.transaction("texts", "readonly");
      const request = tx.objectStore("texts").getAllKeys();
      request.onsuccess = () => resolve((request.result as IDBValidKey[]).map(String));
      request.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

function asBooks(value: unknown): RawBook[] | null {
  if (!Array.isArray(value) || value.length < 66) return null;
  const books = value.slice(0, 66) as RawBook[];
  if (!books.every((book) => Array.isArray(book?.chapters) && book.chapters.length > 0)) return null;
  return books;
}

async function loadKjv() {
  if (!memory.has("kjv")) {
    const cached = await idbGet("kjv");
    if (cached) memory.set("kjv", { info: KJV, books: cached.books });
    else {
      const response = await fetch("/bible/kjv.json");
      if (!response.ok) throw new Error("The Bible did not open.");
      const body = asBooks(await response.json());
      if (!body) throw new Error("The Bible did not open.");
      memory.set("kjv", { info: KJV, books: body });
      void idbPut("kjv", { info: KJV, books: body });
    }
  }
  // Only the KJV now: the demo versions once kept on this device are cleared off it.
  for (const key of await idbKeys()) if (key !== "kjv") void idbDelete(key);
}

export function openBible() {
  opening ??= loadKjv().catch((error) => {
    opening = null;
    throw error;
  });
  return opening;
}

export function translations(): TranslationInfo[] {
  return [KJV];
}
export function allTranslations(): TranslationInfo[] {
  const extra = [...memory.values()].map((item) => item.info).filter((item) => item.id !== "kjv");
  return [KJV, ...extra];
}

export function bookByNumber(number: number) {
  return BOOKS[number - 1] ?? BOOKS[0];
}

export function bookByName(name: string) {
  const needle = name.trim().toLowerCase();
  return BOOKS.find((book) => book.name.toLowerCase() === needle) ?? null;
}

export function chapterCount(translation: string, book: number) {
  const saved = memory.get(translation)?.books[book - 1]?.chapters.length;
  return saved || BOOKS[book - 1]?.chapters || 1;
}

export function chapterVerses(translation: string, book: number, chapter: number): string[] | null {
  const verses = memory.get(translation)?.books[book - 1]?.chapters[chapter - 1];
  return verses ?? null;
}

/** Every verse of a loaded Bible, book by book, chapter by chapter (for the smart search). */
export function bibleText(translation: string): string[][][] | null {
  const books = memory.get(translation)?.books;
  return books ? books.map((b) => b.chapters) : null;
}

export function searchBible(translation: string, query: string, limit = 60): VerseHit[] {
  const needle = query.trim().toLowerCase();
  const books = memory.get(translation)?.books;
  if (!books || needle.length < 2) return [];
  const hits: VerseHit[] = [];
  for (let book = 0; book < books.length; book += 1) {
    const chapters = books[book].chapters;
    for (let chapter = 0; chapter < chapters.length; chapter += 1) {
      const verses = chapters[chapter];
      for (let verse = 0; verse < verses.length; verse += 1) {
        const text = verses[verse];
        if (!text.toLowerCase().includes(needle)) continue;
        hits.push({ book: book + 1, chapter: chapter + 1, verse: verse + 1, text });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}

export async function verseLine(bookName: string, chapter: number, verse: number) {
  const book = bookByName(bookName);
  if (!book) return "";
  await openBible();
  return chapterVerses("kjv", book.number, chapter)?.[verse - 1] ?? "";
}

export function readPlace(): BiblePlace {
  const fallback = { translation: "kjv", book: 43, chapter: 3, verse: 16 };
  try {
    const saved = JSON.parse(localStorage.getItem(PLACE_KEY) || "null") as Partial<BiblePlace> | null;
    const book = saved?.book;
    const chapter = saved?.chapter;
    const verse = saved?.verse;
    if (!book || book < 1 || book > 66 || !chapter || chapter < 1) return fallback;
    const kept = saved?.translation;
    return { translation: kept && (kept === "kjv" || kept.startsWith("module:")) ? kept : "kjv", book, chapter, verse: verse && verse > 0 ? verse : 1 };
  } catch {
    return fallback;
  }
}

export function writePlace(place: BiblePlace) {
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify(place));
  } catch {
    /* this visit still keeps the place */
  }
}

export async function importTranslation(raw: string): Promise<{ ok: true; info: TranslationInfo; verses: number } | { ok: false; error: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "That file is not valid." };
  }
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  const body = asBooks(record?.books ?? parsed);
  if (!body) return { ok: false, error: "A translation needs 66 books, each with chapters and verses." };
  const info: TranslationInfo = {
    id: String(record?.id || record?.abbreviation || "custom").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "custom",
    name: String(record?.name || "Added translation").slice(0, 80),
    abbreviation: String(record?.abbreviation || record?.id || "TEXT").slice(0, 12).toUpperCase(),
    language: String(record?.language || "English").slice(0, 40),
    description: String(record?.description || "").slice(0, 160),
    license: String(record?.license || "").slice(0, 80),
  };
  if (info.id === "kjv") return { ok: false, error: "The King James text is already here." };
  let verses = 0;
  for (const book of body) for (const chapter of book.chapters) verses += chapter.length;
  if (verses < 1000) return { ok: false, error: "That file does not hold a whole Bible." };
  memory.set(info.id, { info, books: body });
  await idbPut(info.id, { info, books: body });
  return { ok: true, info, verses };
}
