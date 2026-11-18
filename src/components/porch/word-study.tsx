import { useEffect, useState, type FormEvent } from "react";
import { bookByNumber } from "@/lib/porch/bible-engine";
import { strongEntry, type StrongEntry, type TaggedWord } from "@/lib/porch/strongs";

export function WordStudyPanel({
  reference,
  english,
  ids,
  entry,
  missing,
  words,
  occurrences,
  onWord,
  onOpen,
  onDictionary,
  onSearch,
  onInsert,
  onFind,
  language,
}: {
  reference: string;
  english: string;
  ids: string[];
  entry: StrongEntry | null;
  missing: boolean;
  words: TaggedWord[];
  occurrences: string[];
  onWord: (word: TaggedWord) => void;
  onOpen: (ref: string) => void;
  onDictionary: () => void;
  onSearch: (id: string) => void;
  onInsert: () => void;
  onFind: (query: string) => void;
  language: "Greek" | "Hebrew";
}) {
  const [only, setOnly] = useState(false);
  const [find, setFind] = useState("");
  const [table, setTable] = useState<{ english: string; entry: StrongEntry }[]>([]);
  const shown = only ? words.filter((word) => word.ids.length > 0) : words;
  useEffect(() => {
    if (!only) return;
    let cancel = false;
    void Promise.all(
      words.filter((word) => word.ids[0]).map(async (word) => ({ english: word.word, entry: await strongEntry(word.ids[0]) })),
    ).then((rows) => {
      if (!cancel) setTable(rows.filter((row): row is { english: string; entry: StrongEntry } => Boolean(row.entry)));
    });
    return () => {
      cancel = true;
    };
  }, [only, words]);
  return (
    <div>
      <p className="text-xs font-black tracking-wide text-[#d7ecb0]">Word study</p>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (find.trim()) onFind(find.trim());
        }}
      >
        <input value={find} onChange={(event) => setFind(event.target.value)} placeholder="G25 or agapao" className="min-h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 text-sm" />
        <button type="submit" className="min-h-10 rounded-xl bg-white/10 px-3 text-sm">Find</button>
      </form>
      <p className="mt-1 text-sm text-white/50">{reference}</p>
      {words.length ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {shown.map((word) => (
            <button key={word.index} type="button" className={`rounded-full px-2 py-1 text-sm ${word.word === english ? "bg-[#24510f] text-[#d7ecb0]" : "bg-white/10"}`} onClick={() => onWord(word)}>
              {word.word}
            </button>
          ))}
        </div>
      ) : null}
      {words.some((word) => word.ids.length > 0) ? (
        <button type="button" className="mt-2 text-sm font-semibold text-[#d7ecb0]" onClick={() => setOnly(true)}>
          Show all {language} words in this verse
        </button>
      ) : null}
      {only && table.length ? (
        <ul className="mt-3 space-y-2">
          {table.map((row) => (
            <li key={`${row.english}-${row.entry.id}`} className="text-sm">
              <span className="font-semibold">{row.english}</span>
              <span className="text-white/70"> · {row.entry.original} · {row.entry.transliteration} · {row.entry.id}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <h3 className="mt-4 font-display text-3xl capitalize">{english || "Word"}</h3>
      {entry ? (
        <>
          {entry.original ? <p className="mt-2 text-2xl" lang={entry.id.startsWith("H") ? "he" : "grc"}>{entry.original}</p> : null}
          {entry.transliteration ? <p className="text-sm text-white/70">{entry.transliteration}</p> : null}
          <p className="mt-1 text-sm font-black text-[#d7ecb0]">{entry.id}</p>
          {ids.filter((id) => id !== entry.id).map((id) => (
            <button key={id} type="button" className="mr-2 text-sm font-semibold text-[#d7ecb0]" onClick={() => onFind(id)}>
              Also {id}
            </button>
          ))}
          <p className="text-xs text-white/45">Strong-Lite</p>
          {entry.pronunciation ? <p className="mt-3 text-sm text-white/70">Pronunciation · {entry.pronunciation}</p> : null}
          {entry.definition ? <p className="mt-3 leading-relaxed">{entry.definition}</p> : <p className="mt-3 text-sm text-white/60">This Strong-Lite entry has no definition.</p>}
          {entry.grammar ? <p className="mt-4 text-sm"><span className="text-white/45">Grammar · </span>{entry.grammar}</p> : null}
          {entry.origin ? <p className="mt-1 text-sm"><span className="text-white/45">Origin · </span>{entry.origin}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="min-h-9 rounded-full bg-white/10 px-3 text-xs font-semibold" onClick={() => onSearch(entry.id)}>Search {entry.id}</button>
            <button type="button" className="min-h-9 rounded-full bg-white/10 px-3 text-xs font-semibold" onClick={onDictionary}>Open dictionary</button>
            <button type="button" className="min-h-9 rounded-full bg-white/10 px-3 text-xs font-semibold" onClick={onInsert}>Add to study</button>
          </div>
          {occurrences.length ? (
            <div className="mt-4">
              <p className="text-xs font-black tracking-wide text-[#d7ecb0]">Other occurrences · {occurrences.length}</p>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {occurrences.slice(0, 80).map((ref) => {
                  const [book, chapter, verse] = ref.split(":").map(Number);
                  return (
                    <li key={ref}>
                      <button type="button" className="text-sm text-white/80" onClick={() => onOpen(ref)}>
                        {bookByNumber(book).name} {chapter}:{verse}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <p className="mt-3 text-xs text-white/40">The original shown is the {language} dictionary form, not a guessed spelling of this verse.</p>
        </>
      ) : missing ? (
        <p className="mt-3 text-sm text-white/70">Original-language information is not available for this word.</p>
      ) : (
        <p className="mt-3 text-sm text-white/50">Opening the study…</p>
      )}
    </div>
  );
}
