import { BOOKS, chapterVerses, openBible } from "@/lib/porch/bible-engine";
import { storedDevotion } from "@/lib/porch/devotion-cache";

/** The day's "Further study" scriptures, read from the devotional kept on the phone. */

export type StudyRef = { label: string; book: number; chapter: number; from: number; to: number };

const decode = (text: string) =>
  text
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/\s+/g, " ")
    .trim();

function findBook(raw: string) {
  const name = raw.replace(/\./g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const variants = [name, name.replace(/^(\d)\s*/, "$1 "), name.replace(/^psalm$/, "psalms"), name.replace(/^song of songs$/, "song of solomon"), name.replace(/^revelations$/, "revelation")];
  for (const v of variants) {
    const hit = BOOKS.find((b) => b.name.toLowerCase() === v);
    if (hit) return hit;
  }
  // Short forms: "Eph", "1 Cor", "Phil"…
  const compact = name.replace(/^(\d)\s*/, "$1 ");
  if (compact.replace(/^\d /, "").length >= 3) {
    const hit = BOOKS.find((b) => b.name.toLowerCase().startsWith(compact) || b.abbreviation.toLowerCase().replace(/\./g, "") === compact.replace(/ /g, ""));
    if (hit) return hit;
  }
  return null;
}

/** "Ephesians 1:11; Romans 8:28-30; 12:2" → references (a bare "12:2" keeps the book before it). */
export function parseFurtherStudy(text: string): StudyRef[] {
  const out: StudyRef[] = [];
  let lastBook: (typeof BOOKS)[number] | null = null;
  for (const piece of text.split(/[;,]|\band\b/)) {
    const part = piece.trim();
    if (!part) continue;
    const match = /^((?:[1-3]\s?)?[A-Za-z][A-Za-z.]*(?:\s(?:of\s)?[A-Za-z][a-z]+)*)?\s*(\d{1,3})\s*:\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?/.exec(part);
    if (!match) continue;
    const book: (typeof BOOKS)[number] | null = match[1] ? findBook(match[1]) : lastBook;
    if (!book) continue;
    lastBook = book;
    const chapter = Number(match[2]);
    const from = Number(match[3]);
    const to = Math.max(from, Number(match[4] ?? match[3]));
    if (chapter < 1 || chapter > book.chapters) continue;
    out.push({ label: `${book.name} ${chapter}:${from}${to > from ? `–${to}` : ""}`, book: book.number, chapter, from, to: Math.min(to, from + 9) });
  }
  return out;
}

export function todaysFurtherStudy(): StudyRef[] {
  const html = storedDevotion()?.html ?? "";
  const section = /<h2>\s*Further study\s*<\/h2>\s*<p[^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1] ?? /Further study:?\s*([^<]+)/i.exec(html)?.[1] ?? "";
  return parseFurtherStudy(decode(section));
}

/** The words of a reference (KJV, the Bible kept in Porchbook). */
export async function studyText(ref: StudyRef) {
  await openBible();
  const verses = chapterVerses("kjv", ref.book, ref.chapter) ?? [];
  return verses
    .slice(ref.from - 1, ref.to)
    .map((text, index) => (ref.to > ref.from ? `${ref.from + index} ${text}` : text))
    .join(" ");
}
