/**
 * "Read in…": open a verse in a copyrighted translation on its publisher's partner sites
 * (Bible Gateway, or the YouVersion Bible App for TPT). Porchbook never stores these texts.
 */

// Book codes the YouVersion Bible App uses, in Bible order (Genesis = 1).
const USFM = "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV".split(" ");

export const READ_IN = [
  { code: "NKJV", name: "New King James Version" },
  { code: "AMPC", name: "Amplified Bible, Classic Edition" },
  { code: "MSG", name: "The Message" },
  { code: "NIV", name: "New International Version" },
  { code: "TPT", name: "The Passion Translation" },
  { code: "TLB", name: "The Living Bible" },
] as const;

export type ReadInCode = (typeof READ_IN)[number]["code"];

export function readInLink(code: ReadInCode, bookNumber: number, bookName: string, chapter: number, verse?: number | null) {
  if (code === "TPT") {
    const usfm = USFM[bookNumber - 1] ?? "JHN";
    return `https://www.bible.com/bible/1849/${usfm}.${chapter}${verse ? `.${verse}` : ""}.TPT`;
  }
  const where = `${bookName} ${chapter}${verse ? `:${verse}` : ""}`;
  return `https://www.biblegateway.com/passage/?search=${encodeURIComponent(where)}&version=${code}`;
}
