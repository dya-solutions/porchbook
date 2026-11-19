import { useEffect, useRef, useState, type FormEvent } from "react";
import { dropDemoBibles } from "@/lib/porch/demo-bibles";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import {
  BOOKS,
  bookByName,
  bookByNumber,
  chapterCount,
  chapterVerses,
  importTranslation,
  openBible,
  readPlace,
  searchBible,
  translations,
  writePlace,
  type BiblePlace,
  type VerseHit,
} from "@/lib/porch/bible-engine";
import { dictionaryWord, searchDictionary, type DictEntry } from "@/lib/porch/bible-dictionary";
import { BibleWindow } from "@/components/porch/bible-window";
import { inGroup, keepSearch, markVerse, parseReference, recentSearches, referencePreview, smartSearch, type Group, type SmartResult } from "@/lib/porch/bible-search";
import { keepStudy, meaningsOf, normalizeStrong, searchOriginal, strongEntry, tagsForVerse, occurrencesOf, type StrongEntry, type TaggedWord } from "@/lib/porch/strongs";
import { WordStudyPanel } from "@/components/porch/word-study";
import { useChaptersToday } from "@/components/porch/bible-counter";
import { StudyTrio, type StudyPlace } from "@/components/porch/study-trio";
import { PorchLoader } from "@/components/porch/porch-loader";

type ModuleFile = { file: string; title: string };
type ModuleBook = { number: number; name: string; chapters: number };

type BibleBridge = {
  prepareBibles?: () => string;
  listBibles?: () => string;
  bibleBooks?: (name: string) => string;
  bibleChapter?: (name: string, book: number, chapter: number) => string;
  bibleSearch?: (name: string, query: string) => string;
};

function bridge(): BibleBridge | null {
  const host = window as Window & { PorchApp?: BibleBridge };
  return host.PorchApp ?? null;
}

function readJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** The book key: the whole name, cut with "…" past 12 letters. */
function keyBook(name: string) {
  return name.length <= 12 ? name : `${name.slice(0, 11).trimEnd()}…`;
}

/** Short book names on the reading key: John and Acts stay whole; Ephesians becomes Eph. */
function shortBook(book: { name: string; abbreviation: string }) {
  if (book.name.length <= 6) return book.name;
  return book.abbreviation.replace(/^(\d)(\D)/, "$1 $2");
}

export function passageOf(label: string): { book: number; chapter: number; verse: number } | null {
  const match = label.trim().match(/^(.+?)\s+(\d+):(\d+)$/);
  if (!match) return null;
  const book = bookByName(match[1]);
  if (!book) return null;
  const chapter = Number(match[2]);
  const verse = Number(match[3]);
  if (chapter < 1 || chapter > book.chapters || verse < 1) return null;
  return { book: book.number, chapter, verse };
}

function Words({ text, onPick, study, mark = -1 }: { text: string; onPick: (index: number, word: string) => void; study: boolean; mark?: number }) {
  // Study off: plain reading, tapping words does nothing.
  if (!study) return <span>{text}</span>;
  let wordIndex = -1;
  return text.split(/(\s+)/).map((part, index) => {
    if (!/[A-Za-z]/.test(part)) return <span key={index}>{part}</span>;
    wordIndex += 1;
    const at = wordIndex;
    return (
      <button
        key={index}
        type="button"
        className={`bible-study-word rounded-sm px-px text-left hover:bg-white/10 ${at === mark ? "is-marked" : ""}`}
        onClick={() => onPick(at, part)}
        onContextMenu={(event) => {
          event.preventDefault();
          onPick(at, part);
        }}
      >
        {part}
      </button>
    );
  });
}

export function BibleReader({ onBack, passage, onSwitch }: { onBack: () => void; passage?: { book: number; chapter: number; verse: number }; onSwitch?: (to: StudyPlace) => void }) {
  const saved = passage ? { translation: "kjv", book: passage.book, chapter: passage.chapter, verse: passage.verse } : readPlace();
  const [place, setPlace] = useState<BiblePlace>(saved);
  const [rows, setRows] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState("");
  const [sheet, setSheet] = useState<"books" | "chapters" | "verses" | "versions" | "search" | "dictionary" | "study" | null>(null);
  const [picked, setPicked] = useState<number | null>(passage?.verse ?? null);
  const [entry, setEntry] = useState<DictEntry | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<VerseHit[] | null>(null);
  // The smart search: what was searched, its result, the filter, how many are shown, recent searches.
  // ⇄ Other versions: the verse open in the window below the chapter (null = closed).
  const [versionsAt, setVersionsAt] = useState<number | null>(null);
  const [smart, setSmart] = useState<(SmartResult & { query: string }) | null>(null);
  const [group, setGroup] = useState<Group>("all");
  const [shown, setShown] = useState(80);
  const [recent, setRecent] = useState<string[]>(() => (typeof window === "undefined" ? [] : recentSearches()));
  const [dictQuery, setDictQuery] = useState("");
  const [modules, setModules] = useState<ModuleFile[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [, setTick] = useState(0);
  const [moduleBooks, setModuleBooks] = useState<ModuleBook[]>([]);
  const [talk, setTalk] = useState<{ id: number; name: string; members: number; posts: number }[] | null>(null);
  const [studyWords, setStudyWords] = useState<TaggedWord[]>([]);
  const [studyWord, setStudyWord] = useState<TaggedWord | null>(null);
  const [quick, setQuick] = useState<{ verse: number; index: number; word: TaggedWord; all: TaggedWord[]; entry: StrongEntry | null; done: boolean } | null>(null);
  const [strong, setStrong] = useState<StrongEntry | null>(null);
  const [strongMissing, setStrongMissing] = useState(false);
  const [strongPlaces, setStrongPlaces] = useState<string[]>([]);
  const navigate = useNavigate();
  const scroller = useRef<HTMLElement>(null);
  const book = bookByNumber(place.book);
  // Only the KJV is listed (the demo versions are removed and hidden).
  const versions = translations().filter((item) => item.id === "kjv");
  const version = versions.find((item) => item.id === place.translation) ?? versions[0];
  const local = !place.translation.startsWith("module:");
  const count = local ? chapterCount(place.translation, place.book) : moduleBooks.find((item) => item.number === place.book)?.chapters ?? book.chapters;
  const dictHits = searchDictionary(dictQuery);
  const readToday = useChaptersToday(place.book, place.chapter);
  useEffect(() => setQuick(null), [place.book, place.chapter, place.translation]);
  const [night, setNight] = useState(() => {
    try {
      return localStorage.getItem("porch-bible-night") === "1";
    } catch {
      return false;
    }
  });
  const [study, setStudy] = useState(() => {
    try {
      return localStorage.getItem("porch-bible-study") === "1";
    } catch {
      return false;
    }
  });
  function flipStudy() {
    setStudy((current) => {
      try {
        localStorage.setItem("porch-bible-study", current ? "0" : "1");
      } catch {
        /* still flips on screen */
      }
      return !current;
    });
  }
  function flipNight() {
    setNight((current) => {
      try {
        localStorage.setItem("porch-bible-night", current ? "0" : "1");
      } catch {
        /* still flips on screen */
      }
      return !current;
    });
  }
  // The book, chapter and verse controls can be folded away for more room to read (remembered).
  const [tucked, setTucked] = useState(() => {
    try {
      return localStorage.getItem("porch-bible-tucked") === "1";
    } catch {
      return false;
    }
  });
  function flipTucked() {
    setTucked((current) => {
      try {
        localStorage.setItem("porch-bible-tucked", current ? "0" : "1");
      } catch {
        /* still folds on screen */
      }
      return !current;
    });
  }
  // The verse at the top of the screen: the meter rolls along as you read.
  const [readingVerse, setReadingVerse] = useState(passage?.verse ?? 1);
  const pinnedUntil = useRef(0); // after picking a verse, show it while the page glides there
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (Date.now() < pinnedUntil.current) return;
      const sticky = box.querySelector(".sticky") as HTMLElement | null;
      const line = box.getBoundingClientRect().top + (sticky?.offsetHeight ?? 0) + 8;
      const items = box.querySelectorAll<HTMLElement>("li[id^='verse-']");
      let current = 1;
      for (const item of items) {
        if (item.getBoundingClientRect().bottom > line + 40) {
          current = Number(item.id.slice(6)) || 1;
          break;
        }
      }
      setReadingVerse(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => {
      box.removeEventListener("scroll", onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [rows.length, place.book, place.chapter]);

  useEffect(() => {
    let cancel = false;
    openBible()
      .then(async () => {
        if (!cancel) setReady(true);
        // The demo versions are removed: their saved copies are cleared too.
        void dropDemoBibles().catch(() => undefined);
        if (!cancel) setTick((n) => n + 1);
      })
      .catch(() => {
        if (!cancel) setNote("The Bible did not open.");
      });
    const app = bridge();
    app?.prepareBibles?.();
    const listed = readJson<ModuleFile[]>(app?.listBibles?.());
    if (Array.isArray(listed)) setModules(listed.filter((item) => item.file && item.title));
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !local) return;
    const verses = chapterVerses(place.translation, place.book, place.chapter);
    if (!verses) {
      setRows([]);
      setNote("That chapter is not in this translation.");
      return;
    }
    setNote("");
    setRows(verses);
  }, [ready, local, place.translation, place.book, place.chapter]);

  useEffect(() => {
    if (local) return;
    const file = place.translation.slice(7);
    const listed = readJson<{ ok?: boolean; books?: ModuleBook[] }>(bridge()?.bibleBooks?.(file));
    const books = listed?.ok ? listed.books ?? [] : [];
    setModuleBooks(books);
    const moduleBook = books.find((item) => item.number === place.book) ?? books[place.book - 1];
    const result = readJson<{ ok?: boolean; error?: string; verses?: { verse: string; text: string }[] }>(
      moduleBook ? bridge()?.bibleChapter?.(file, moduleBook.number, place.chapter) : undefined,
    );
    if (!result?.ok) {
      setRows([]);
      setNote(result?.error || "That chapter did not open.");
      return;
    }
    setNote("");
    setRows((result.verses ?? []).map((item) => item.text));
  }, [local, place.translation, place.book, place.chapter]);

  useEffect(() => {
    writePlace(place);
  }, [place]);

  useEffect(() => {
    if (!picked || rows.length === 0) return;
    scroller.current?.querySelector(`#verse-${picked}`)?.scrollIntoView({ block: "nearest" });
  }, [picked, place.book, place.chapter, rows.length]);

  function go(next: Partial<BiblePlace>) {
    setTalk(null);
    setHits(null);
    setEntry(null);
    setPicked(next.verse ?? null);
    setPlace((current) => ({ ...current, ...next }));
  }

  /** Change translation and stay on the same chapter and verse (the one you picked, or the one you're reading). */
  function switchTo(translation: string) {
    const verse = picked ?? readingVerse ?? 1;
    const chapter = Math.min(place.chapter, Math.max(1, chapterCount(translation, place.book)));
    go({ translation, chapter, verse });
    // Once the new translation's verses are on screen, bring that verse to the top.
    const bring = (tries: number) => {
      const node = scroller.current?.querySelector<HTMLElement>(`#verse-${verse}`);
      if (node) node.scrollIntoView({ block: "start" });
      else if (tries > 0) window.setTimeout(() => bring(tries - 1), 80);
    };
    window.setTimeout(() => bring(15), 60);
  }

  function shift(step: number) {
    const next = place.chapter + step;
    if (next >= 1 && next <= count) {
      go({ chapter: next, verse: 1 });
      return;
    }
    const bookNumber = place.book + (step > 0 ? 1 : -1);
    if (bookNumber < 1 || bookNumber > 66) return;
    const chapters = chapterCount(place.translation, bookNumber);
    go({ book: bookNumber, chapter: step > 0 ? 1 : chapters, verse: 1 });
  }

  function openWord(word: string) {
    const found = dictionaryWord(word);
    setEntry(found);
    setDictQuery(found?.word ?? word.replace(/[^A-Za-z]/g, ""));
    setSheet("dictionary");
  }

  async function showStrong(id: string, word: TaggedWord, all: TaggedWord[], verse: number) {
    setSheet("study");
    setStudyWord(word);
    setStudyWords(all);
    setPicked(verse);
    setStrong(null);
    setStrongMissing(false);
    setStrongPlaces([]);
    if (!id) {
      setStrongMissing(true);
      return;
    }
    const [entryFound, places] = await Promise.all([strongEntry(id), occurrencesOf(id)]);
    setStrong(entryFound);
    setStrongMissing(!entryFound);
    const here = `${place.book}:${place.chapter}:${verse}`;
    setStrongPlaces(places.filter((ref) => ref !== here));
  }

  async function quickAt(verse: number, text: string, index: number, word: string) {
    const tagged = place.translation === "kjv" ? await tagsForVerse(place.book, place.chapter, verse, text).catch(() => []) : [];
    const all = tagged.length ? tagged : text.split(/\s+/).filter((part) => /[A-Za-z]/.test(part)).map((part, at) => ({ index: at, word: part, ids: [] as string[] }));
    const chosen = all[index] ?? { index, word, ids: [] };
    setQuick({ verse, index, word: chosen, all, entry: null, done: false });
    // Keep the tapped verse above the card.
    const row = scroller.current?.querySelector<HTMLElement>(`#verse-${verse}`);
    const box = scroller.current;
    if (row && box) {
      const top = row.getBoundingClientRect().top;
      if (top > window.innerHeight * 0.42) box.scrollBy({ top: top - window.innerHeight * 0.25, behavior: "smooth" });
    }
    const id = chosen.ids[0];
    const found = id ? await strongEntry(id).catch(() => null) : null;
    setQuick((current) => (current && current.verse === verse && current.index === index ? { ...current, entry: found, done: true } : current));
  }

  async function studyAt(verse: number, text: string, index: number, word: string) {
    const tagged = place.translation === "kjv" ? await tagsForVerse(place.book, place.chapter, verse, text).catch(() => []) : [];
    const all = tagged.length ? tagged : text.split(/\s+/).filter((part) => /[A-Za-z]/.test(part)).map((part, at) => ({ index: at, word: part, ids: [] as string[] }));
    const pickedWord = all[index] ?? { index, word, ids: [] };
    await showStrong(pickedWord.ids[0] ?? "", pickedWord, all, verse);
  }

  async function search(event: FormEvent | null, said?: string) {
    event?.preventDefault();
    const term = (said ?? query).trim();
    if (said !== undefined) setQuery(said);
    // A reference ("jn 3 16", "1 cor 13", "ps 23") goes straight there.
    const ref = parseReference(term);
    if (ref) {
      setRecent(keepSearch(term));
      go({ book: ref.book.number, chapter: ref.chapter, verse: ref.verse ?? 1 });
      setSheet(null);
      setNote("");
      return;
    }
    if (term.length < 2 && !normalizeStrong(term)) {
      setNote("Write a word or a phrase.");
      return;
    }
    const strongId = normalizeStrong(term);
    if (strongId) {
      const found = await strongEntry(strongId);
      const places = await occurrencesOf(strongId);
      setStrong(found);
      setStrongMissing(!found);
      setStrongPlaces(places);
      setStudyWord({ index: -1, word: found?.transliteration || strongId, ids: found ? [strongId] : [] });
      setStudyWords([]);
      setSheet("study");
      setNote("");
      return;
    }
    if (/[^\u0000-\u007F]/.test(term)) {
      const found = await searchOriginal(term);
      if (found[0]) {
        const places = await occurrencesOf(found[0].id);
        setStrong(found[0]);
        setStrongMissing(false);
        setStrongPlaces(places);
        setStudyWord({ index: -1, word: found[0].transliteration || found[0].original, ids: [found[0].id] });
        setStudyWords([]);
        setSheet("study");
        setNote("");
        return;
      }
    }
    if (!local) {
      const file = place.translation.slice(7);
      const result = readJson<{ ok?: boolean; hits?: { number: number; chapter: number; verse: number; text: string }[] }>(bridge()?.bibleSearch?.(file, term));
      setSmart(null);
      setHits((result?.hits ?? []).map((hit) => ({ book: hit.number, chapter: hit.chapter, verse: hit.verse, text: hit.text })));
      setSheet("search");
      return;
    }
    setRecent(keepSearch(term));
    const found = smartSearch(place.translation, term, place.book);
    if (found) {
      setSmart({ ...found, query: term });
      setGroup("all");
      setShown(80);
      setHits(found.hits);
    } else {
      setSmart(null);
      setHits(searchBible(place.translation, term));
    }
    setSheet("search");
    setNote("");
  }

  async function copyVerse(verse: number) {
    const text = `${book.name} ${place.chapter}:${verse} ${rows[verse - 1] ?? ""}`.trim();
    try {
      await navigator.clipboard.writeText(text);
      setNote("Copied.");
    } catch {
      setNote("Could not copy that verse.");
    }
  }

  async function shareVerse(verse: number) {
    const text = `${book.name} ${place.chapter}:${verse} ${rows[verse - 1] ?? ""}`.trim();
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        /* the copy still stands */
      }
    }
    await copyVerse(verse);
  }

  return (
    <div className="pc-book fixed inset-0 z-[80] flex h-dvh flex-col bg-[#070907] text-[#f4efe4]">
      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
        <button type="button" className="flex min-h-11 items-center gap-1 text-sm font-semibold text-[#d7ecb0]" onClick={onBack}>
          <ChevronLeft className="size-5" aria-hidden="true" />
          Library
        </button>
        <button type="button" className="ml-auto min-h-11 rounded-full border border-white/15 px-3 text-sm font-black" onClick={() => setSheet("versions")}>
          {version?.abbreviation ?? "KJV"}
        </button>
        <button type="button" className="min-h-11 rounded-full border border-white/15 px-3 text-sm font-semibold" onClick={() => setSheet("dictionary")}>
          Dictionary
        </button>
      </header>
      {onSwitch ? <StudyTrio current="bible" onPick={onSwitch} /> : null}
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-white/10 p-3 md:block">
          <BookList onPick={(number) => go({ book: number, chapter: 1, verse: 1 })} />
        </aside>
        <main ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-28 md:px-10" style={{ touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}>
          <div className="mx-auto max-w-2xl">
            <div className="bible-desk sticky top-0 z-10 -mx-4 bg-[#070907] px-4 pt-2 md:-mx-10 md:px-10">
              {tucked ? (
                <button type="button" className="bible-slim" onClick={flipTucked} aria-label={`${book.name} ${place.chapter}:${readingVerse}. Show the book, chapter and verse controls`}>
                  <span>
                    📖 {shortBook(book)} <em>{place.chapter} : {readingVerse}</em>
                  </span>
                  <i>▼ show</i>
                </button>
              ) : (
              <>
              <div className="flex items-center gap-2 pb-2">
              <button type="button" className="bible-book-key is-two" aria-label={`${book.name} ${place.chapter}: pick a book, chapter and verse`} onClick={() => setSheet("books")}>
                <span>
                  {keyBook(book.name)} <small>▾</small>
                </span>
                <small className="bible-key-ch">CHAPTER {place.chapter}</small>
              </button>
              <span className="ml-auto flex items-center gap-1">
                <button type="button" aria-label="Search the Bible" aria-expanded={searchOpen} className={`bible-tool ${searchOpen ? "is-on" : ""}`} onClick={() => setSearchOpen((open) => !open)}>
                  <Search className="size-[1.05rem]" aria-hidden="true" />
                </button>
                <button type="button" className="bible-tool" aria-label={night ? "Paper page" : "Night page"} onClick={flipNight}>
                  {night ? "☀" : "☾"}
                </button>
                <button type="button" aria-label="Previous chapter" className="grid size-11 place-items-center rounded-full bg-white/10" onClick={() => shift(-1)}>
                  <ChevronLeft className="size-5" />
                </button>
                <button type="button" aria-label="Next chapter" className="grid size-11 place-items-center rounded-full bg-white/10" onClick={() => shift(1)}>
                  <ChevronRight className="size-5" />
                </button>
              </span>
              </div>
              {searchOpen ? (
                <form className="bible-search-row flex gap-2 pb-2" onSubmit={(event) => { search(event); setSearchOpen(false); }}>
                  <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the Bible" className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/15 bg-black/40 px-3 text-sm text-[#f4efe4]" />
                  <button type="submit" className="min-h-11 rounded-xl bg-[#17300c] px-3 text-sm font-semibold text-[#d7ecb0]">
                    Search
                  </button>
                </form>
              ) : null}
              {searchOpen ? <SearchHelp query={query} translation={place.translation} local={local} recent={recent} onGo={() => { void search(null); setSearchOpen(false); }} onRecent={(q) => { void search(null, q); setSearchOpen(false); }} /> : null}
              <button type="button" className="bible-tuck" onClick={flipTucked} aria-label="Hide the book, chapter and verse controls">
                ▲
              </button>
              </>
              )}
            </div>
            {versionsAt !== null ? <BibleWindow book={book} chapter={place.chapter} verse={versionsAt} onClose={() => setVersionsAt(null)} /> : null}
            <div className={`bible-paper ${night ? "is-night" : ""}`}>

            <h2 className="font-display text-3xl text-[#d7ecb0]">
              {book.name} {place.chapter}
            </h2>
            {note ? <p className="mt-3 text-sm text-[#d7ecb0]">{note}</p> : null}
            {!ready && local && !note ? <PorchLoader size={140} label="Opening the chapter" /> : null}
            <ol className="mt-5 space-y-4">
              {rows.map((text, index) => {
                const verse = index + 1;
                const on = picked === verse;
                return (
                  <li id={`verse-${verse}`} key={verse} className={`rounded-xl px-2 py-1 text-lg leading-relaxed ${on ? "bg-white/10 is-picked" : ""}`} style={{ fontFamily: "Georgia, Palatino, serif" }}>
                    <button type="button" className={`bible-vnum mr-2 align-super text-xs font-semibold ${on ? "text-[#b6f36a]" : "text-[#7ea85a]"}`} onClick={() => setPicked(verse)}>
                      {verse}
                    </button>
                    <Words study={study} mark={quick?.verse === verse ? quick.index : -1} text={text} onPick={(index, word) => void quickAt(verse, text, index, word)} />
                    {on ? (
                      <span className="mt-2 flex flex-wrap gap-2">
                        <button type="button" className="min-h-9 rounded-full bg-white/10 px-3 text-xs font-semibold" onClick={() => void copyVerse(verse)}>Copy</button>
                        <button type="button" className="min-h-9 rounded-full bg-white/10 px-3 text-xs font-semibold" onClick={() => void shareVerse(verse)}>Share</button>
                        <button type="button" className="min-h-9 rounded-full bg-white/10 px-3 text-xs font-semibold" onClick={() => setSheet("dictionary")}>Dictionary</button>
                        <button type="button" className="min-h-9 rounded-full bg-white/10 px-3 text-xs font-semibold" aria-pressed={study} onClick={flipStudy}>{study ? "Study ✓" : "Study"}</button>
                        <button type="button" className="min-h-9 rounded-full bg-white/10 px-3 text-xs font-semibold" onClick={() => void studyAt(verse, text, 0, text.split(/\s+/).find((part) => /[A-Za-z]/.test(part)) ?? "")}>Word study</button>
                        <button type="button" className="min-h-9 rounded-full bg-white/10 px-3 text-xs font-semibold" onClick={() => {
                          const word = text.split(/\s+/).map((part) => part.replace(/[^A-Za-z]/g, "")).find((part) => part.length > 4) ?? "";
                          setQuery(word);
                          if (local && word.length > 1) {
                            setSmart(null);
                            setHits(searchBible(place.translation, word));
                          }
                          setSheet("search");
                        }}>Search</button>
                      </span>
                    ) : null}
                    
                  </li>
                );
              })}
            </ol>
            <p className="bible-read-today mt-8 text-center">
              READ TODAY <b>{String(readToday).padStart(4, "0")}</b>
            </p>
            <button
              type="button"
              className="mt-8 text-sm font-semibold text-[#d7ecb0]"
              onClick={() => {
                void import("@/lib/porch/groups").then(({ groupsOnPassage }) =>
                  groupsOnPassage({ data: { scripture: `${book.name} ${place.chapter}` } }).then((result) => setTalk(result.groups)),
                );
              }}
            >
              Discuss this Scripture
            </button>
            {talk ? (
              <div className="mt-3">
                {talk.length === 0 ? <p className="text-sm text-white/60">No public group is on this chapter yet.</p> : null}
                <ul className="mt-2 space-y-2">
                  {talk.map((group) => (
                    <li key={group.id}>
                      <button
                        type="button"
                        className="text-left"
                        onClick={() => {
                          onBack();
                          void navigate({ to: "/groups/$groupId", params: { groupId: String(group.id) } });
                        }}
                      >
                        <span className="block font-semibold">{group.name}</span>
                        <span className="block text-sm text-white/60">{group.members} members · {group.posts} discussions</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            </div>
          </div>
        </main>
      </div>
      {quick ? (
        <div className={`bible-quick ${night ? "is-night" : ""}`} role="dialog" aria-label="Word">
          <span className="bible-quick-grip" />
          <div className="bible-quick-head">
            <b className="bible-quick-en">{quick.word.word.replace(/[^A-Za-z'-]/g, "")}</b>
            <span className="bible-quick-arrow">→</span>
            <span className="bible-quick-orig">{quick.entry?.original ?? (quick.done ? "—" : "…")}</span>
            <button type="button" className="bible-quick-x" aria-label="Close" onClick={() => setQuick(null)}>
              ✕
            </button>
          </div>
          {quick.entry ? (
            <p className="bible-quick-sub">
              {[quick.entry.transliteration, quick.entry.pronunciation ? `said ${quick.entry.pronunciation}` : ""].filter(Boolean).join(" · ")} · <b>{quick.entry.id}</b>
            </p>
          ) : null}
          {quick.done && !quick.entry ? (
            <p className="bible-quick-sub">{place.translation === "kjv" ? "No Hebrew or Greek word is linked to this one." : "Hebrew and Greek words are linked in the KJV. Switch to KJV to study this word."}</p>
          ) : null}
          {quick.entry
            ? (() => {
                const { meanings, kjv } = meaningsOf(quick.entry);
                return (
                  <>
                    {meanings.length ? (
                      <>
                        <p className="bible-quick-label">MEANINGS</p>
                        <ol className="bible-quick-list">
                          {meanings.map((meaning) => (
                            <li key={meaning}>{meaning}</li>
                          ))}
                        </ol>
                      </>
                    ) : (
                      <p className="bible-quick-text">{quick.entry.definition}</p>
                    )}
                    {kjv.length ? (
                      <p className="bible-quick-kjv">
                        In the KJV: {kjv.map((word, at) => (
                          <span key={word}>
                            {at ? ", " : ""}
                            <b>{word}</b>
                          </span>
                        ))}
                      </p>
                    ) : null}
                  </>
                );
              })()
            : null}
          <button
            type="button"
            className="bible-quick-study"
            onClick={() => {
              const chosen = quick;
              setQuick(null);
              void showStrong(chosen.word.ids[0] ?? "", chosen.word, chosen.all, chosen.verse);
            }}
          >
            Study this verse →
          </button>
        </div>
      ) : null}
      {sheet ? (
        <div className="absolute inset-0 z-20 flex items-end bg-black/50 md:items-center md:justify-center" onClick={() => setSheet(null)}>
          <div className="max-h-[78%] w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-[#10140f]/95 p-4 backdrop-blur md:max-w-lg md:rounded-3xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-black tracking-wide text-[#d7ecb0]">
                {sheet === "books" ? "Books" : sheet === "chapters" ? "Chapters" : sheet === "verses" ? `${book.name} ${place.chapter} · Verses` : sheet === "versions" ? "Translation" : sheet === "search" ? (smart ? `Search · ${smart.query} · ${smart.counts.all} verse${smart.counts.all === 1 ? "" : "s"}` : "Search") : sheet === "study" ? "Word study" : "Dictionary"}
              </p>
              <button type="button" className="text-sm text-white/70" onClick={() => setSheet(null)}>Close</button>
            </div>
            {sheet === "books" ? <BookKeys current={place.book} onPick={(number) => { go({ book: number, chapter: 1, verse: 1 }); setSheet("chapters"); }} /> : null}
            {sheet === "chapters" ? (
              <div className="bible-number-grid is-chapters">
                {Array.from({ length: count }, (_, n) => n + 1).map((item) => (
                  <button key={item} type="button" className={item === place.chapter ? "is-on" : ""} onClick={() => { go({ chapter: item, verse: 1 }); setSheet("verses"); }}>
                    {item}
                  </button>
                ))}
              </div>
            ) : null}
            {sheet === "verses" ? (
              <div className="bible-number-grid is-verses">
                {rows.map((_, n) => n + 1).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={item === readingVerse ? "is-on" : ""}
                    onClick={() => {
                      setSheet(null);
                      setPicked(item);
                      setReadingVerse(item);
                      pinnedUntil.current = Date.now() + 1200;
                      window.setTimeout(() => scroller.current?.querySelector(`#verse-${item}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : null}
            {sheet === "versions" ? (
              <div className="grid gap-2">
                {versions.map((item) => (
                  <button key={item.id} type="button" className="rounded-xl bg-white/10 px-3 py-3 text-left" onClick={() => { switchTo(item.id); setSheet(null); }}>
                    <span className="block font-semibold">{item.abbreviation}</span>
                    <span className="block text-sm text-white/60">{item.name}</span>
                  </button>
                ))}
                {modules.map((item) => (
                  <button key={item.file} type="button" className="rounded-xl bg-white/10 px-3 py-3 text-left" onClick={() => { switchTo(`module:${item.file}`); setSheet(null); }}>
                    <span className="block font-semibold">{item.title}</span>
                    <span className="block text-sm text-white/60">On this phone</span>
                  </button>
                ))}
                {/* BIBLES: the verse you're on, in other versions online (an admin's chosen sites). */}
                <button
                  type="button"
                  className="rounded-xl border border-[#f8c46a]/45 bg-white/10 px-3 py-3 text-left"
                  aria-label={`${book.name} ${place.chapter}:${picked ?? readingVerse ?? 1} in other versions`}
                  onClick={() => {
                    setSheet(null);
                    setVersionsAt(picked ?? readingVerse ?? 1);
                  }}
                >
                  <span className="block font-semibold tracking-[0.08em] text-[#f8c46a]">BIBLES</span>
                  <span className="block text-sm text-white/60">This verse in other versions, online</span>
                </button>
              </div>
            ) : null}
            {sheet === "search" && smart ? (
              <SmartResults
                result={smart}
                group={group}
                currentBook={place.book}
                currentName={shortBook(book)}
                shown={shown}
                onGroup={(g) => {
                  setGroup(g);
                  setShown(80);
                }}
                onMore={() => setShown((n) => n + 80)}
                onOpen={(hit) => {
                  go({ book: hit.book, chapter: hit.chapter, verse: hit.verse });
                  setSheet(null);
                }}
              />
            ) : sheet === "search" ? (
              hits && hits.length ? (
                <ul className="space-y-3">
                  {hits.map((hit) => (
                    <li key={`${hit.book}-${hit.chapter}-${hit.verse}`}>
                      <button type="button" className="w-full text-left" onClick={() => { go({ book: hit.book, chapter: hit.chapter, verse: hit.verse }); setSheet(null); }}>
                        <span className="text-sm font-semibold text-[#d7ecb0]">{bookByNumber(hit.book).name} {hit.chapter}:{hit.verse}</span>
                        <span className="mt-1 block text-sm leading-snug">{hit.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-white/60">{hits ? "That is not in this Bible." : "Search a word, then the verses open here."}</p>
              )
            ) : null}
            {sheet === "study" && studyWord ? (
              <WordStudyPanel
                reference={`${book.name} ${place.chapter}${picked ? `:${picked}` : ""}`}
                english={studyWord.word}
                ids={studyWord.ids}
                entry={strong}
                missing={strongMissing}
                words={studyWords}
                occurrences={strongPlaces}
                onWord={(word) => void showStrong(word.ids[0] ?? "", word, studyWords, picked ?? place.verse)}
                onOpen={(ref) => {
                  const [nextBook, nextChapter, nextVerse] = ref.split(":").map(Number);
                  if (nextBook && nextChapter && nextVerse) go({ book: nextBook, chapter: nextChapter, verse: nextVerse });
                  setSheet(null);
                }}
                onDictionary={() => openWord(studyWord.word)}
                onSearch={(id) => {
                  setQuery(id);
                  void occurrencesOf(id).then(setStrongPlaces);
                }}
                onInsert={() => {
                  if (!strong) return;
                  keepStudy([`${book.name} ${place.chapter}${picked ? `:${picked}` : ""} · ${studyWord.word}`, [strong.original, strong.transliteration, strong.id].filter(Boolean).join(" · "), strong.definition].filter(Boolean).join("\n"));
                  setNote("Added to your study. Open a notebook page to insert it.");
                  setSheet(null);
                }}
                language={place.book <= 39 ? "Hebrew" : "Greek"}
                onFind={(value) => {
                  const id = normalizeStrong(value);
                  if (id) {
                    void showStrong(id, { index: -1, word: id, ids: [id] }, studyWords, picked ?? place.verse);
                    return;
                  }
                  void searchOriginal(value).then(async (found) => {
                    const first = found[0];
                    if (!first) {
                      setStrong(null);
                      setStrongMissing(true);
                      setStudyWord({ index: -1, word: value, ids: [] });
                      return;
                    }
                    const places = await occurrencesOf(first.id);
                    setStrong(first);
                    setStrongMissing(false);
                    setStrongPlaces(places);
                    setStudyWord({ index: -1, word: first.transliteration || first.original, ids: [first.id] });
                  });
                }}
              />
            ) : null}
            {sheet === "dictionary" ? (
              <DictionaryPane
                query={dictQuery}
                hits={dictHits}
                entry={entry}
                onQuery={(value) => {
                  setDictQuery(value);
                  setEntry(dictionaryWord(value));
                }}
                onOpen={(item) => {
                  setEntry(item);
                  setDictQuery(item.word);
                }}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Book picker: Old / New Testament tabs, every book as a key; the current one lit. */
function BookKeys({ current, onPick }: { current: number; onPick: (number: number) => void }) {
  const [testament, setTestament] = useState<"old" | "new">(bookByNumber(current).testament === "new" ? "new" : "old");
  return (
    <div>
      <div className="bible-books-tabs">
        <button type="button" className={testament === "old" ? "is-on" : ""} onClick={() => setTestament("old")}>
          Old Testament
        </button>
        <button type="button" className={testament === "new" ? "is-on" : ""} onClick={() => setTestament("new")}>
          New Testament
        </button>
      </div>
      <div className="bible-books-grid">
        {BOOKS.filter((item) => item.testament === testament).map((item) => (
          <button key={item.number} type="button" className={item.number === current ? "is-on" : ""} onClick={() => onPick(item.number)}>
            {item.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function BookList({ onPick }: { onPick: (number: number) => void }) {
  return (
    <div className="grid gap-4">
      {(["old", "new"] as const).map((testament) => (
        <div key={testament}>
          <p className="mb-2 text-xs font-black tracking-wide text-[#d7ecb0]">{testament === "old" ? "Old Testament" : "New Testament"}</p>
          <div className="grid grid-cols-2 gap-1 md:grid-cols-1">
            {BOOKS.filter((item) => item.testament === testament).map((item) => (
              <button key={item.number} type="button" className="min-h-10 rounded-lg px-2 text-left text-sm hover:bg-white/10" onClick={() => onPick(item.number)}>
                {item.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DictionaryPane({
  query,
  hits,
  entry,
  onQuery,
  onOpen,
}: {
  query: string;
  hits: DictEntry[];
  entry: DictEntry | null;
  onQuery: (value: string) => void;
  onOpen: (entry: DictEntry) => void;
}) {
  return (
    <div>
      <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="faith, love, grace" className="min-h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm" />
      {entry ? (
        <article className="mt-4">
          <h3 className="font-display text-2xl">{entry.word}</h3>
          {entry.pronunciation ? <p className="text-sm text-white/50">{entry.pronunciation}</p> : null}
          <p className="mt-2 leading-relaxed">{entry.definition}</p>
          {entry.references.length ? <p className="mt-3 text-sm text-[#d7ecb0]">{entry.references.join(" · ")}</p> : null}
          {entry.related.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {entry.related.map((word) => {
                const next = dictionaryWord(word);
                return (
                  <button key={word} type="button" className="rounded-full bg-white/10 px-3 py-1 text-sm" onClick={() => next && onOpen(next)}>
                    {word}
                  </button>
                );
              })}
            </div>
          ) : null}
        </article>
      ) : query ? (
        <ul className="mt-3 space-y-2">
          {hits.length === 0 ? <li className="text-sm text-white/60">That word is not in the dictionary yet.</li> : null}
          {hits.map((item) => (
            <li key={item.word}>
              <button type="button" className="w-full rounded-lg px-2 py-2 text-left hover:bg-white/10" onClick={() => onOpen(item)}>
                <span className="font-semibold">{item.word}</span>
                <span className="mt-1 block text-sm text-white/60">{item.definition}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-white/60">Tap a word in the chapter, or search here.</p>
      )}
    </div>
  );
}

/** Under the search box: "Go to John 3:16" for a reference, and recent searches. */
function SearchHelp({ query, translation, local, recent, onGo, onRecent }: { query: string; translation: string; local: boolean; recent: string[]; onGo: () => void; onRecent: (q: string) => void }) {
  const ref = parseReference(query);
  const preview = ref && local ? referencePreview(translation, ref) : "";
  return (
    <>
      {ref ? (
        <button type="button" className="bible-go" onClick={onGo}>
          <span aria-hidden="true">→</span>
          <span>
            Go to {ref.label}
            {preview ? <small>{preview}</small> : null}
          </span>
        </button>
      ) : null}
      {recent.length ? (
        <div className="bible-recent" aria-label="Recent searches">
          {recent.map((q) => (
            <button key={q} type="button" onClick={() => onRecent(q)}>
              🕘 {q}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

const GROUPS: { key: Group; label: string }[] = [
  { key: "all", label: "All" },
  { key: "old", label: "Old" },
  { key: "new", label: "New" },
  { key: "gospels", label: "Gospels" },
  { key: "psalms", label: "Psalms" },
  { key: "book", label: "" },
];

/** Smart results: counts and filters, the word forms found, best first, words highlighted. */
function SmartResults({ result, group, currentBook, currentName, shown, onGroup, onMore, onOpen }: { result: SmartResult & { query: string }; group: Group; currentBook: number; currentName: string; shown: number; onGroup: (g: Group) => void; onMore: () => void; onOpen: (hit: SmartResult["hits"][number]) => void }) {
  const list = result.hits.filter((h) => inGroup(group, h.book, currentBook));
  return (
    <div>
      {result.counts.all ? (
        <div className="bible-groups" role="group" aria-label="Show verses from">
          {GROUPS.map(({ key, label }) =>
            key === "all" || result.counts[key] ? (
              <button key={key} type="button" className={group === key ? "is-on" : ""} onClick={() => onGroup(key)}>
                {key === "book" ? currentName : label} {result.counts[key]}
              </button>
            ) : null,
          )}
        </div>
      ) : null}
      {result.fixed.length ? <p className="bible-also">Searching for {result.fixed.map(([typed, used]) => `“${used}” (you typed “${typed}”)`).join(", ")}</p> : null}
      {result.missing.length ? <p className="bible-also">Not in this Bible: {result.missing.join(", ")}. Showing the other words.</p> : null}
      {result.also.length ? <p className="bible-also">Also finding: {result.also.join(", ")}</p> : null}
      {list.length ? (
        <ul className="space-y-3">
          {list.slice(0, shown).map((hit) => (
            <li key={`${hit.book}-${hit.chapter}-${hit.verse}`}>
              <button type="button" className="w-full text-left" onClick={() => onOpen(hit)}>
                <span className="text-sm font-semibold text-[#d7ecb0]">
                  {bookByNumber(hit.book).name} {hit.chapter}:{hit.verse}
                </span>
                <span className="mt-1 block text-sm leading-snug">
                  {markVerse(hit.text, result.marks).map((piece, i) => (piece.hit ? <b key={i} className="bible-hl">{piece.text}</b> : <span key={i}>{piece.text}</span>))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-white/60">That is not in this Bible. Try other words, or fewer.</p>
      )}
      {list.length > shown ? (
        <button type="button" className="bible-more" onClick={onMore}>
          Show more ({list.length - shown} left)
        </button>
      ) : null}
    </div>
  );
}
