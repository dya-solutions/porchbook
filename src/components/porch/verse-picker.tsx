import { useEffect, useState } from "react";
import { BOOKS, chapterVerses, openBible } from "@/lib/porch/bible-engine";

/**
 * Pick a Bible verse without typing: Book ▾ · Ch ▾ · V ▾ (and "to" for a few verses).
 * Each pick opens the next one, the same way as in the Bible.
 */

type Step = "book" | "chapter" | "verse" | "to" | null;

function short(name: string, abbreviation: string) {
  if (name.length <= 5) return name;
  return abbreviation.replace(/^(\d)(\D)/, "$1 $2");
}

export function VersePicker({ onAdd }: { onAdd: (text: string) => void }) {
  const [book, setBook] = useState(0);
  const [chapter, setChapter] = useState(0);
  const [verse, setVerse] = useState(0);
  const [to, setTo] = useState(0);
  const [step, setStep] = useState<Step>("book");
  const [count, setCount] = useState(0);
  const [note, setNote] = useState("");

  const info = book ? BOOKS[book - 1] : null;

  // How many verses this chapter has (from the King James Bible on this phone).
  useEffect(() => {
    if (!book || !chapter) return;
    let live = true;
    setCount(0);
    openBible()
      .then(() => {
        if (live) setCount(chapterVerses("kjv", book, chapter)?.length ?? 0);
      })
      .catch(() => {
        if (live) setNote("The Bible is still opening. Try again in a moment.");
      });
    return () => {
      live = false;
    };
  }, [book, chapter]);

  function add() {
    if (!info || !chapter || !verse) return;
    const verses = chapterVerses("kjv", info.number, chapter);
    const last = to > verse ? to : verse;
    const words = verses?.slice(verse - 1, last).join(" ");
    if (!words) {
      setNote("Couldn't find that verse. Try another.");
      return;
    }
    onAdd(`“${words}” — ${info.name} ${chapter}:${verse}${last > verse ? `-${last}` : ""}`);
  }

  const numbers = (from: number, upto: number) => Array.from({ length: Math.max(0, upto - from + 1) }, (_, i) => from + i);

  return (
    <div className="vp">
      <div className="vp-row">
        <button type="button" className={`vp-key${step === "book" ? " is-open" : ""}`} onMouseDown={(event) => event.preventDefault()} onClick={() => setStep(step === "book" ? null : "book")}>
          {info ? short(info.name, info.abbreviation) : "Book"} <small>▾</small>
        </button>
        <button
          type="button"
          className={`vp-key is-ch${step === "chapter" ? " is-open" : ""}`}
          disabled={!info}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setStep(step === "chapter" ? null : "chapter")}
        >
          <i>CH</i> {chapter || "–"} <small>▾</small>
        </button>
        <button
          type="button"
          className={`vp-key is-v${step === "verse" ? " is-open" : ""}`}
          disabled={!chapter}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setStep(step === "verse" ? null : "verse")}
        >
          <i>V</i> {verse || "–"}
          {to > verse ? `–${to}` : ""} <small>▾</small>
        </button>
        <button type="button" className="vp-add" disabled={!verse} onMouseDown={(event) => event.preventDefault()} onClick={add}>
          Add
        </button>
      </div>
      {step === "book" ? (
        <div className="vp-grid is-books">
          {BOOKS.map((item) => (
            <button
              key={item.number}
              type="button"
              className={`${item.number === book ? "is-on" : ""}${item.number === 40 ? " is-nt" : ""}`}
              aria-label={item.name}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setBook(item.number);
                setChapter(0);
                setVerse(0);
                setTo(0);
                setStep("chapter");
              }}
            >
              {short(item.name, item.abbreviation)}
            </button>
          ))}
        </div>
      ) : null}
      {step === "chapter" && info ? (
        <div className="vp-grid is-chapters">
          {numbers(1, info.chapters).map((item) => (
            <button
              key={item}
              type="button"
              className={item === chapter ? "is-on" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setChapter(item);
                setVerse(0);
                setTo(0);
                setStep("verse");
              }}
            >
              {item}
            </button>
          ))}
        </div>
      ) : null}
      {step === "verse" ? (
        count ? (
          <div className="vp-grid is-verses">
            {numbers(1, count).map((item) => (
              <button
                key={item}
                type="button"
                className={item === verse ? "is-on" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setVerse(item);
                  setTo(0);
                  setStep(item < count ? "to" : null);
                }}
              >
                {item}
              </button>
            ))}
          </div>
        ) : (
          <p className="vp-wait">Opening the chapter…</p>
        )
      ) : null}
      {step === "to" ? (
        <div className="vp-to">
          <p>
            Just verse {verse}, or up to:
          </p>
          <div className="vp-grid is-verses">
            <button type="button" className="is-on vp-just" onMouseDown={(event) => event.preventDefault()} onClick={() => setStep(null)}>
              Just {verse}
            </button>
            {numbers(verse + 1, Math.min(count, verse + 30)).map((item) => (
              <button
                key={item}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setTo(item);
                  setStep(null);
                }}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {note ? <p className="vp-wait">{note}</p> : null}
    </div>
  );
}
