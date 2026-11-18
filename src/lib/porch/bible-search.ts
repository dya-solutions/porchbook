import { BOOKS, bibleText, chapterVerses, type BibleBook } from "@/lib/porch/bible-engine";

/**
 * The Bible's smart search (free, all on the phone):
 *  - references: "jn 3 16", "1 cor 13", "ps 23" → jump straight there
 *  - words in any order, every form of a word (forgive → forgave, forgiven, forgiveness),
 *    modern words find KJV ones (you → thee, thou, ye), small spelling slips forgiven
 *  - best matches first, with counts for All · Old · New · Gospels · Psalms · this book
 */

// ---- References

const ALIAS: Record<string, string> = {
  jn: "John", jhn: "John", joh: "John", mt: "Matthew", mat: "Matthew", mk: "Mark", mr: "Mark", mrk: "Mark", lk: "Luke", luk: "Luke",
  ps: "Psalms", psa: "Psalms", psm: "Psalms", pss: "Psalms", psalm: "Psalms", pr: "Proverbs", prv: "Proverbs", jg: "Judges", jdg: "Judges",
  sos: "Song of Solomon", song: "Song of Solomon", songs: "Song of Solomon", sng: "Song of Solomon", canticles: "Song of Solomon",
  php: "Philippians", phil: "Philippians", phl: "Philippians", phm: "Philemon", philem: "Philemon", jas: "James", jm: "James", jud: "Jude", jd: "Jude",
  ez: "Ezekiel", eze: "Ezekiel", ezk: "Ezekiel", ezr: "Ezra", dn: "Daniel", hos: "Hosea", jl: "Joel", am: "Amos", ob: "Obadiah", jon: "Jonah",
  mic: "Micah", na: "Nahum", nah: "Nahum", hab: "Habakkuk", zep: "Zephaniah", zeph: "Zephaniah", hag: "Haggai", zec: "Zechariah", zech: "Zechariah",
  mal: "Malachi", ac: "Acts", rm: "Romans", ro: "Romans", rom: "Romans", ga: "Galatians", gal: "Galatians", eph: "Ephesians", col: "Colossians",
  ti: "Titus", tit: "Titus", heb: "Hebrews", rev: "Revelation", re: "Revelation", rv: "Revelation", revelations: "Revelation", ge: "Genesis", gn: "Genesis",
  ex: "Exodus", lv: "Leviticus", nu: "Numbers", nm: "Numbers", dt: "Deuteronomy", jos: "Joshua", jsh: "Joshua", ru: "Ruth", est: "Esther",
  jb: "Job", ec: "Ecclesiastes", ecc: "Ecclesiastes", eccl: "Ecclesiastes", qoh: "Ecclesiastes", is: "Isaiah", isa: "Isaiah", jer: "Jeremiah",
  lam: "Lamentations", ne: "Nehemiah", neh: "Nehemiah",
  sa: "Samuel", sam: "Samuel", sm: "Samuel", ki: "Kings", kg: "Kings", kgs: "Kings", ch: "Chronicles", chr: "Chronicles", co: "Corinthians", cor: "Corinthians",
  th: "Thessalonians", thes: "Thessalonians", thess: "Thessalonians", tim: "Timothy", tm: "Timothy", pe: "Peter", pet: "Peter", pt: "Peter", jo: "John",
};
const ORDINAL: Record<string, string> = { "1": "1", "2": "2", "3": "3", i: "1", ii: "2", iii: "3", first: "1", second: "2", third: "3", "1st": "1", "2nd": "2", "3rd": "3" };

const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

function findBook(number: string, word: string): BibleBook | null {
  const w = word.toLowerCase();
  const named = ALIAS[w];
  const candidates = BOOKS.filter((b) => (number ? b.name.startsWith(`${number} `) : !/^\d /.test(b.name)));
  if (named) {
    const hit = candidates.find((b) => b.name.replace(/^\d /, "") === named);
    if (hit) return hit;
  }
  if (w.length < 2) return null;
  return candidates.find((b) => squash(b.name.replace(/^\d /, "")).startsWith(w)) ?? null;
}

export type Reference = { book: BibleBook; chapter: number; verse: number | null; label: string };

/** "jn 3 16", "John 3:16", "1 cor 13", "First Corinthians 13 verse 4", "ps 23" → a place, or null. */
export function parseReference(query: string): Reference | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  const m = /^(?:(1|2|3|i{1,3}|first|second|third|1st|2nd|3rd)\s*)?([a-z]+(?: of (?:solomon|songs))?)\.?\s*(?:chapter\s*)?(\d{1,3})(?:\s*(?::|\.|,|\s|\s*verses?\s*)\s*(\d{1,3}))?(?:\s*[-–]\s*\d{1,3})?$/.exec(q);
  if (!m) return null;
  const number = m[1] ? ORDINAL[m[1]] : "";
  const word = m[2].replace(/ of (solomon|songs)$/, "");
  const book = findBook(number, word);
  if (!book) return null;
  let chapter = Number(m[3]);
  let verse = m[4] ? Number(m[4]) : null;
  // One-chapter books: "Jude 3" is Jude 1:3.
  if (book.chapters === 1 && !verse && chapter > 1) {
    verse = chapter;
    chapter = 1;
  }
  if (chapter < 1 || chapter > book.chapters) return null;
  return { book, chapter, verse: verse && verse > 0 ? verse : null, label: `${book.name} ${chapter}${verse ? `:${verse}` : ""}` };
}

/** The first words of the verse (or chapter) a reference points to, if this Bible is loaded. */
export function referencePreview(translation: string, ref: Reference) {
  const verses = chapterVerses(translation, ref.book.number, ref.chapter);
  if (!verses) return "";
  const text = verses[(ref.verse ?? 1) - 1] ?? "";
  return text.length > 90 ? `${text.slice(0, 88).replace(/\s+\S*$/, "")}…` : text;
}

// ---- Words

const IRREGULAR: Record<string, string[]> = {
  forgive: ["forgave"], give: ["gave"], take: ["took"], see: ["saw"], go: ["went", "gone"], come: ["came"], speak: ["spake", "spoke", "spoken"],
  run: ["ran"], bear: ["bare", "born", "borne"], eat: ["ate"], rise: ["rose", "risen"], arise: ["arose"], write: ["wrote", "written"], know: ["knew", "known"],
  fall: ["fell", "fallen"], fly: ["flew"], sing: ["sang", "sung"], weep: ["wept"], sleep: ["slept"], keep: ["kept"], seek: ["sought"], bring: ["brought"],
  think: ["thought"], teach: ["taught"], buy: ["bought"], fight: ["fought"], catch: ["caught"], begin: ["began", "begun"], drink: ["drank", "drunk"],
  break: ["brake", "broke", "broken"], choose: ["chose", "chosen"], forsake: ["forsook", "forsaken"], smite: ["smote", "smitten"], shine: ["shone"],
  stand: ["stood"], understand: ["understood"], sit: ["sat"], find: ["found"], hear: ["heard"], say: ["said", "saith"], tell: ["told"], sell: ["sold"],
  lead: ["led"], feed: ["fed"], flee: ["fled"], send: ["sent"], build: ["built"], spend: ["spent"], lose: ["lost"], leave: ["left"], mean: ["meant"],
  meet: ["met"], hold: ["held"], win: ["won"], hide: ["hid", "hidden"], ride: ["rode"], drive: ["drove", "driven"], grow: ["grew", "grown"],
  throw: ["threw", "thrown"], draw: ["drew", "drawn"], slay: ["slew", "slain"], lie: ["lay", "lain"], lay: ["laid"], pay: ["paid"], wear: ["wore", "worn"],
  swear: ["sware", "swore", "sworn"], tear: ["tare", "tore", "torn"], have: ["had", "hath", "hast"],
  do: ["did", "done", "doth", "dost"], child: ["children"], man: ["men"], woman: ["women"], foot: ["feet"], tooth: ["teeth"], ox: ["oxen"],
};
// Modern words → the KJV's own.
const MODERN: Record<string, string[]> = {
  you: ["ye", "thee", "thou"], your: ["thy", "thine"], yours: ["thine"], yourself: ["thyself"], yourselves: ["yourselves"],
  has: ["hath"], does: ["doth"], says: ["saith"], said: ["spake"], spoke: ["spake"], are: ["art"], will: ["wilt", "shall", "shalt"],
  neighbor: ["neighbour"], savior: ["saviour"], honor: ["honour"], labor: ["labour"], favor: ["favour"], color: ["colour"], behavior: ["behaviour"],
  counselor: ["counsellor"], splendor: ["splendour"], harbor: ["harbour"], odor: ["odour"], vapor: ["vapour"], fervor: ["fervour"],
  holy: ["holy", "hallowed"], spirit: ["ghost"], before: ["ere"], often: ["oft"], began: ["begun"],
};
// Small words: they must be there, but they don't steer the ranking.
const LIGHT = new Set(["you", "your", "yours", "ye", "thee", "thou", "thy", "thine", "are", "is", "was", "be", "will", "has", "have", "had", "i", "me", "my", "we", "us", "our", "he", "him", "his", "she", "her", "they", "them", "their", "not", "no", "all", "this", "who", "what", "when", "from", "shall"]);
const STOP = new Set(["the", "and", "of", "a", "an", "to", "in", "is", "it", "that", "for", "on", "with", "as", "be", "at", "by", "or", "so", "but"]);

/** The root of a word, so its other forms match: forgiveness → forgiv, loveth → lov. */
function stem(word: string) {
  let w = word;
  for (const end of ["fulness", "fully", "ness", "ings", "ing", "eth", "est", "edst", "ed", "ers", "er", "ful", "ly", "es", "s", "e"]) {
    if (w.endsWith(end) && w.length - end.length >= 3) {
      w = w.slice(0, -end.length);
      break;
    }
  }
  // Doubled last letter (running → run, sinned → sin).
  if (/([bdgklmnprt])\1$/.test(w) && w.length > 3) w = w.slice(0, -1);
  return w;
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Term = { typed: string; pattern: RegExp; fixed?: string };

function termFor(word: string, fixed?: string): Term {
  const base = word.toLowerCase();
  const root = stem(base);
  const extra = new Set<string>([...(IRREGULAR[base] ?? []), ...(MODERN[base] ?? [])]);
  // Irregular forms of a related base (forgiveness → forgive → forgave).
  for (const [key, forms] of Object.entries(IRREGULAR)) {
    if (stem(key) === root) forms.forEach((f) => extra.add(f));
    if (forms.includes(base)) {
      extra.add(key);
      forms.forEach((f) => extra.add(f));
    }
  }
  const short = base.length <= 3 || STOP.has(base);
  const alternatives = [short ? escape(base) : `${escape(root)}[a-z]*`, ...[...extra].map((x) => (x.length <= 3 ? escape(x) : `${escape(stem(x))}[a-z]*`))];
  return { typed: word, fixed, pattern: new RegExp(`\\b(?:${[...new Set(alternatives)].join("|")})\\b`, "gi") };
}

// Every word in a Bible, to forgive spelling slips.
const vocab = new Map<string, Set<string>>();
function wordsOf(translation: string, text: string[][][]) {
  let known = vocab.get(translation);
  if (known) return known;
  known = new Set<string>();
  for (const book of text) for (const chapter of book) for (const verse of chapter) for (const w of verse.toLowerCase().match(/[a-z]+/g) ?? []) known.add(w);
  vocab.set(translation, known);
  return known;
}
function distance(a: string, b: string, cap: number) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      low = Math.min(low, cur[j]);
    }
    if (low > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}
function closest(word: string, known: Set<string>) {
  const cap = word.length >= 9 ? 2 : 1;
  let best = "";
  let bestD = cap + 1;
  for (const k of known) {
    if (k[0] !== word[0] && cap === 1) continue;
    const d = distance(word, k, cap);
    if (d < bestD || (d === bestD && best && k.length === word.length && best.length !== word.length)) {
      best = k;
      bestD = d;
    }
  }
  return bestD <= cap ? best : "";
}

export type SmartHit = { book: number; chapter: number; verse: number; text: string; score: number };
export type Group = "all" | "old" | "new" | "gospels" | "psalms" | "book";
export type SmartResult = {
  hits: SmartHit[];
  /** Words this Bible never uses (left out of the search). */
  missing: string[];
  counts: Record<Group, number>;
  /** Other forms of the words that were found (forgave, forgiven…). */
  also: string[];
  /** Spelling slips put right: [typed, used]. */
  fixed: [string, string][];
  /** What to highlight in a verse. */
  marks: RegExp[];
};

export function inGroup(group: Group, book: number, current: number) {
  if (group === "old") return book <= 39;
  if (group === "new") return book >= 40;
  if (group === "gospels") return book >= 40 && book <= 43;
  if (group === "psalms") return book === 19;
  if (group === "book") return book === current;
  return true;
}

/** The smart search over a loaded Bible. A phrase in "quotes" must appear exactly. */
export function smartSearch(translation: string, query: string, currentBook: number): SmartResult | null {
  const text = bibleText(translation);
  if (!text) return null;
  const quoted = [...query.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim().toLowerCase()).filter(Boolean);
  const loose = query.replace(/"[^"]*"/g, " ").toLowerCase().match(/[a-z']+/g)?.map((w) => w.replace(/'/g, "")) ?? [];
  let words = loose.filter((w) => w.length > 1 && !STOP.has(w));
  if (!words.length && !quoted.length) words = loose.filter((w) => w.length > 1);
  if (!words.length && !quoted.length) return { hits: [], missing: [], counts: { all: 0, old: 0, new: 0, gospels: 0, psalms: 0, book: 0 }, also: [], fixed: [], marks: [] };

  const known = wordsOf(translation, text);
  const fixed: [string, string][] = [];
  const missing: string[] = [];
  const all = words.map((w) => {
    const term = termFor(w);
    // A word this Bible never uses (in any form): try the nearest real word.
    let seen = false;
    for (const k of known) {
      term.pattern.lastIndex = 0;
      if (term.pattern.test(k)) {
        seen = true;
        break;
      }
    }
    if (seen) return term;
    const near = w.length >= 4 ? closest(w, known) : "";
    if (!near) {
      // Never in this Bible: search the other words instead (said on screen).
      if (words.length > 1 || quoted.length) {
        missing.push(w);
        return null;
      }
      return term;
    }
    fixed.push([w, near]);
    return termFor(near, w);
  });
  const terms = all.filter((t): t is Term => Boolean(t));
  const phrases = quoted.map((q) => new RegExp(`\\b${escape(q).replace(/\s+/g, "\\s+")}\\b`, "i"));
  // The words in the order typed, close together ("ye are the light" for "you are the light").
  const whole = terms.length > 1 ? new RegExp(terms.map((t) => `(?:${t.pattern.source})`).join("(?:\\W+[a-z]+){0,2}?\\W+"), "i") : null;
  const typed = new Set([...words, ...fixed.map(([, used]) => used)]);
  const roots = terms.map((t) => stem((t.fixed ? t.typed : t.typed).toLowerCase())).filter((r) => r.length >= 3);
  const irregular = new Set(terms.flatMap((t) => IRREGULAR[t.typed.toLowerCase()] ?? []));

  const hits: SmartHit[] = [];
  const forms = new Map<string, number>();
  for (let b = 0; b < text.length; b++) {
    for (let c = 0; c < text[b].length; c++) {
      const verses = text[b][c];
      for (let v = 0; v < verses.length; v++) {
        const line = verses[v];
        if (!phrases.every((p) => p.test(line))) continue;
        let score = phrases.length * 40;
        let ok = true;
        const found: string[] = [];
        for (const term of terms) {
          term.pattern.lastIndex = 0;
          const seenHere = line.match(term.pattern);
          if (!seenHere) {
            ok = false;
            break;
          }
          found.push(...seenHere);
          const light = LIGHT.has(term.typed.toLowerCase());
          score += light ? 2 : 10 + Math.min(seenHere.length - 1, 3) * 4;
          // The very word typed counts more than another form of it.
          if (!light && seenHere.some((x) => x.toLowerCase() === term.typed.toLowerCase())) score += 6;
        }
        if (!ok) continue;
        if (whole?.test(line)) score += 30;
        // Words close together count more.
        const heavy = terms.filter((t) => !LIGHT.has(t.typed.toLowerCase()));
        if (heavy.length > 1) {
          const spots = heavy.map((t) => {
            t.pattern.lastIndex = 0;
            return line.search(t.pattern);
          });
          score += Math.max(0, 12 - (Math.max(...spots) - Math.min(...spots)) / 12);
        }
        score += Math.max(0, 8 - line.length / 40); // short, direct verses first
        for (const f of found) {
          const low = f.toLowerCase();
          if (typed.has(low) || LIGHT.has(low)) continue;
          // Only true forms of the words typed (not "thy" for "your").
          if (!roots.some((r) => low.startsWith(r)) && !irregular.has(low)) continue;
          forms.set(low, (forms.get(low) ?? 0) + 1);
        }
        hits.push({ book: b + 1, chapter: c + 1, verse: v + 1, text: line, score });
      }
    }
  }
  hits.sort((x, y) => y.score - x.score || x.book - y.book || x.chapter - y.chapter || x.verse - y.verse);
  const counts: Record<Group, number> = { all: hits.length, old: 0, new: 0, gospels: 0, psalms: 0, book: 0 };
  for (const h of hits) for (const g of ["old", "new", "gospels", "psalms", "book"] as Group[]) if (inGroup(g, h.book, currentBook)) counts[g] += 1;
  const also = [...forms.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 6);
  return { hits, missing, counts, also, fixed, marks: [...terms.map((t) => new RegExp(t.pattern.source, "gi")), ...phrases.map((p) => new RegExp(p.source, "gi"))] };
}

/** A verse cut into plain and highlighted pieces. */
export function markVerse(text: string, marks: RegExp[]): { text: string; hit: boolean }[] {
  const spans: [number, number][] = [];
  for (const mark of marks) {
    mark.lastIndex = 0;
    for (const m of text.matchAll(mark)) spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  if (!spans.length) return [{ text, hit: false }];
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [a, b] of merged) {
    if (a > at) out.push({ text: text.slice(at, a), hit: false });
    out.push({ text: text.slice(a, b), hit: true });
    at = b;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

// ---- Recent searches (this phone)

const RECENT = "porch-bible-recent";
export function recentSearches(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT) ?? "[]") as unknown;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}
export function keepSearch(query: string) {
  const q = query.trim();
  if (q.length < 2) return recentSearches();
  const list = [q, ...recentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 6);
  try {
    localStorage.setItem(RECENT, JSON.stringify(list));
  } catch {
    /* this visit only */
  }
  return list;
}
