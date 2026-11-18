import { chapterVerses, translations } from "@/lib/porch/bible-engine";

const NYN = /runyank|rukiga|\bnyn\b|runyoro/;

/** Only a Runyankore Bible already loaded in Porchbook. Nothing is downloaded. */
export function officialVerse(book: number, chapter: number, verse: number) {
  for (const info of translations()) {
    const label = `${info.id} ${info.name} ${info.language}`.toLowerCase();
    if (!NYN.test(label)) continue;
    const line = chapterVerses(info.id, book, chapter)?.[verse - 1]?.trim();
    if (line) return line;
  }
  return null;
}
