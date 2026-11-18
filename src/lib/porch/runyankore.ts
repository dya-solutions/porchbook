export type GlossaryTerm = {
  english: string;
  runyankore: string;
  alternatives: string;
  preferred: string;
  context: string;
  source: string;
  approved: boolean;
};

/** Established Runyankore-Rukiga church words. Unapproved terms are not forced into a translation. */
export const GLOSSARY: GlossaryTerm[] = [
  ["God", "Ruhanga", "", "Ruhanga", "name", "Runyankore-Rukiga church usage", true],
  ["Lord", "Mukama", "", "Mukama", "name", "Runyankore-Rukiga church usage", true],
  ["Jesus Christ", "Yesu Kristo", "", "Yesu Kristo", "name", "Runyankore-Rukiga church usage", true],
  ["Jesus", "Yesu", "", "Yesu", "name", "Runyankore-Rukiga church usage", true],
  ["Christ", "Kristo", "", "Kristo", "name", "Runyankore-Rukiga church usage", true],
  ["Holy Spirit", "Omwoyo Mutukuvu", "", "Omwoyo Mutukuvu", "name", "Runyankore-Rukiga church usage", true],
  ["Prayer", "Okushaba", "", "Okushaba", "heading", "Runyankore-Rukiga church usage", true],
  ["faith", "okwikiriza", "", "okwikiriza", "teaching", "Runyankore-Rukiga church usage", false],
  ["grace", "embabazi", "ekigongwe", "embabazi", "teaching", "Runyankore-Rukiga church usage", false],
  ["salvation", "okujunwa", "", "okujunwa", "teaching", "Runyankore-Rukiga church usage", false],
  ["sin", "ekibi", "", "ekibi", "teaching", "Runyankore-Rukiga church usage", false],
  ["church", "ekerezia", "", "ekerezia", "teaching", "Runyankore-Rukiga church usage", false],
  ["love", "okukunda", "", "okukunda", "teaching", "Runyankore-Rukiga church usage", false],
  ["worship", "okuramya", "", "okuramya", "teaching", "Runyankore-Rukiga church usage", false],
  ["praise", "okuhimbisa", "", "okuhimbisa", "teaching", "Runyankore-Rukiga church usage", false],
  ["cross", "omusharaba", "", "omusharaba", "teaching", "Runyankore-Rukiga church usage", false],
  ["blood", "eshagama", "", "eshagama", "teaching", "Runyankore-Rukiga church usage", false],
].map(([english, runyankore, alternatives, preferred, context, source, approved]) => ({
  english: String(english),
  runyankore: String(runyankore),
  alternatives: String(alternatives),
  preferred: String(preferred),
  context: String(context),
  source: String(source),
  approved: Boolean(approved),
}));

export const SALT_NOTICE = "SALT English–Runyankole sentences, Sunbird AI, CC BY-SA 4.0. They are not bundled. Approved sentences can be added to the translation memory later.";

export type Chunk = { kind: "title" | "author" | "h2" | "p"; text: string };

export type TranslatedChunk = Chunk & {
  runyankore: string;
  source: "published" | "memory" | "bible" | "heading" | "missing";
  note: string;
};

export type VerseLookup = (book: number, chapter: number, verse: number) => string | null;

const BOOK_ALIASES: [string, number][] = ([
  ["genesis", 1], ["gen", 1], ["exodus", 2], ["exod", 2], ["ex", 2], ["leviticus", 3], ["lev", 3],
  ["numbers", 4], ["num", 4], ["deuteronomy", 5], ["deut", 5], ["joshua", 6], ["josh", 6],
  ["judges", 7], ["judg", 7], ["ruth", 8], ["1 samuel", 9], ["1samuel", 9], ["1 sam", 9], ["2 samuel", 10], ["2samuel", 10], ["2 sam", 10],
  ["1 kings", 11], ["1kings", 11], ["1 kgs", 11], ["2 kings", 12], ["2kings", 12], ["2 kgs", 12],
  ["1 chronicles", 13], ["1chron", 13], ["1 chr", 13], ["2 chronicles", 14], ["2chron", 14], ["2 chr", 14],
  ["ezra", 15], ["nehemiah", 16], ["neh", 16], ["esther", 17], ["esth", 17], ["job", 18],
  ["psalms", 19], ["psalm", 19], ["ps", 19], ["proverbs", 20], ["prov", 20], ["ecclesiastes", 21], ["eccl", 21],
  ["song of solomon", 22], ["song of songs", 22], ["song", 22], ["isaiah", 23], ["isa", 23], ["jeremiah", 24], ["jer", 24],
  ["lamentations", 25], ["lam", 25], ["ezekiel", 26], ["ezek", 26], ["daniel", 27], ["dan", 27],
  ["hosea", 28], ["hos", 28], ["joel", 29], ["amos", 30], ["obadiah", 31], ["obad", 31], ["jonah", 32],
  ["micah", 33], ["mic", 33], ["nahum", 34], ["nah", 34], ["habakkuk", 35], ["hab", 35],
  ["zephaniah", 36], ["zeph", 36], ["haggai", 37], ["hag", 37], ["zechariah", 38], ["zech", 38], ["malachi", 39], ["mal", 39],
  ["matthew", 40], ["matt", 40], ["mt", 40], ["mark", 41], ["mk", 41], ["luke", 42], ["lk", 42],
  ["john", 43], ["jn", 43], ["acts", 44], ["romans", 45], ["rom", 45],
  ["1 corinthians", 46], ["1corinthians", 46], ["1 cor", 46], ["2 corinthians", 47], ["2corinthians", 47], ["2 cor", 47],
  ["galatians", 48], ["gal", 48], ["ephesians", 49], ["eph", 49], ["philippians", 50], ["phil", 50],
  ["colossians", 51], ["col", 51], ["1 thessalonians", 52], ["1thess", 52], ["1 thess", 52],
  ["2 thessalonians", 53], ["2thess", 53], ["2 thess", 53], ["1 timothy", 54], ["1tim", 54], ["1 tim", 54],
  ["2 timothy", 55], ["2tim", 55], ["2 tim", 55], ["titus", 56], ["philemon", 57], ["phlm", 57],
  ["hebrews", 58], ["heb", 58], ["james", 59], ["jas", 59], ["1 peter", 60], ["1pet", 60], ["1 pet", 60],
  ["2 peter", 61], ["2pet", 61], ["2 pet", 61], ["1 john", 62], ["1john", 62], ["1 jn", 62],
  ["2 john", 63], ["2john", 63], ["2 jn", 63], ["3 john", 64], ["3john", 64], ["3 jn", 64],
  ["jude", 65], ["revelation", 66], ["rev", 66],
] as [string, number][]).sort((a, b) => b[0].length - a[0].length);

const BOOK_RE = new RegExp(
  `(?<![A-Za-z])(${BOOK_ALIASES.map(([name]) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s+(\\d{1,3})\\s*[:.]\\s*(\\d{1,3})`,
  "gi",
);

export function plainText(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/&#39;|'/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function memoryKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function chunksOf(html: string): Chunk[] {
  const chunks: Chunk[] = [];
  for (const match of html.matchAll(/<(h1|h2|p)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const text = plainText(match[3] ?? "");
    if (!text) continue;
    const tag = match[1].toLowerCase();
    if (tag === "h1") chunks.push({ kind: "title", text });
    else if (tag === "h2") chunks.push({ kind: "h2", text });
    else if (/class="author"/i.test(match[2] ?? "")) chunks.push({ kind: "author", text });
    else chunks.push({ kind: "p", text });
  }
  return chunks;
}

export type BibleRef = { book: number; chapter: number; verse: number; index: number; length: number };

export function bibleRefs(text: string): BibleRef[] {
  const found: BibleRef[] = [];
  for (const match of text.matchAll(BOOK_RE)) {
    const name = (match[1] ?? "").toLowerCase().replace(/\s+/g, " ");
    const book = BOOK_ALIASES.find(([alias]) => alias === name)?.[1];
    const chapter = Number(match[2]);
    const verse = Number(match[3]);
    if (!book || chapter < 1 || verse < 1) continue;
    found.push({ book, chapter, verse, index: match.index ?? 0, length: match[0].length });
  }
  return found;
}

function sentencesOf(text: string) {
  const parts = text.split(/(?<=[.!?])\s+(?=[“"A-Z])/);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function headingOf(text: string) {
  const term = GLOSSARY.find((item) => item.approved && item.english.toLowerCase() === text.toLowerCase());
  return term?.preferred ?? "";
}

export type TranslationEngine = {
  id: string;
  translate: (text: string, memory: Map<string, string>) => string | null;
};

/** Uses an approved sentence as a whole. It does not swap single English words. */
export const memoryEngine: TranslationEngine = {
  id: "porch-memory",
  translate(text, memory) {
    return memory.get(memoryKey(text)) ?? null;
  },
};

export function translateChunks(chunks: Chunk[], memory: Map<string, string>, verseOf: VerseLookup, engine: TranslationEngine = memoryEngine): TranslatedChunk[] {
  return chunks.map((chunk) => {
    if (chunk.kind === "h2" || chunk.kind === "title") {
      const heading = headingOf(chunk.text);
      if (heading) return { ...chunk, runyankore: heading, source: "heading", note: "" };
    }
    const remembered = engine.translate(chunk.text, memory);
    if (remembered) return { ...chunk, runyankore: remembered, source: "memory", note: "" };
    if (chunk.kind !== "p") return { ...chunk, runyankore: chunk.text, source: "missing", note: "" };
    const pieces: string[] = [];
    let bible = false;
    let known = false;
    let missing = false;
    for (const sentence of sentencesOf(chunk.text)) {
      const hit = engine.translate(sentence, memory);
      if (hit) {
        pieces.push(hit);
        known = true;
        continue;
      }
      const refs = bibleRefs(sentence);
      if (refs.length === 1) {
        const verse = verseOf(refs[0].book, refs[0].chapter, refs[0].verse);
        if (verse) {
          pieces.push(verse);
          bible = true;
          known = true;
          continue;
        }
        pieces.push(sentence);
        missing = true;
        bible = true;
        continue;
      }
      pieces.push(sentence);
      missing = true;
    }
    return {
      ...chunk,
      runyankore: pieces.join(" "),
      source: bible && !missing ? "bible" : known && !missing ? "memory" : "missing",
      note: missing && bible ? "The Runyankore Bible is not in Porchbook, so this verse was left as written." : missing ? "Not yet in the Runyankore memory." : "",
    };
  });
}

export function consistencyNotes(english: string, runyankore: string) {
  const notes: string[] = [];
  for (const term of GLOSSARY) {
    if (!term.approved) continue;
    const word = new RegExp(`(?<![A-Za-z])${term.english.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`, "i");
    if (word.test(english) && !runyankore.toLowerCase().includes(term.preferred.toLowerCase())) {
      notes.push(`${term.english} is kept as ${term.preferred}.`);
    }
  }
  return notes.slice(0, 6);
}
