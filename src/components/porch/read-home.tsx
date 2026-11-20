// Stage 4c: the Read screen in the new design (design-reference/Read.dc.html): the Bible with
// "Continue reading", the church's own books and devotional, and the member's notebook.
// Each one opens the same reader as before.
import { useEffect, useState } from "react";
import { bookByNumber, readPlace } from "@/lib/porch/bible-engine";
import type { ReadBook } from "@/lib/porch/read";

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Icon({ name, size = 22 }: { name: "bible" | "book" | "sun" | "pdf" | "note" | "arrow"; size?: number }) {
  const paths = {
    bible: (
      <>
        <path d="M5 4a2 2 0 0 1 2-2h12v18H7a2 2 0 0 0-2 2z" />
        <path d="M12 6v8M9 9h6" />
      </>
    ),
    book: (
      <>
        <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
        <path d="M4 21V5" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" />
      </>
    ),
    pdf: (
      <>
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M14 3v5h5" />
      </>
    ),
    note: (
      <>
        <path d="M6 3h12v18H6z" />
        <path d="M9 7h6M9 11h6M9 15h4" />
      </>
    ),
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  } as const;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      {paths[name]}
    </svg>
  );
}

const COVERS = ["#24331A", "#2A2F3E", "#3A2A2A", "#33301A", "#1F3333"];

function coverOf(key: string) {
  let sum = 0;
  for (const ch of key) sum = (sum + ch.charCodeAt(0)) % 997;
  return COVERS[sum % COVERS.length];
}

export function ReadHome({ books, onOpen, devotionTitle }: { books: ReadBook[]; onOpen: (key: string) => void; devotionTitle: string }) {
  // Where you stopped in the Bible (kept on this phone by the Bible reader).
  const [place, setPlace] = useState<{ book: string; chapter: number; verse: number } | null>(null);
  useEffect(() => {
    const saved = readPlace();
    setPlace({ book: bookByNumber(saved.book)?.name ?? "John", chapter: saved.chapter, verse: saved.verse });
  }, []);
  const today = new Date().toLocaleDateString(undefined, { day: "numeric", month: "long" });

  return (
    <div className="pb read-home">
      <h1 className="pb-ttl" style={{ fontSize: 28 }}>Read</h1>

      <button type="button" className="pb-card read-bible" onClick={() => onOpen("bible")}>
        <span className="pb-row" style={{ gap: 10 }}>
          <span style={{ color: "var(--pb-main)", display: "flex" }}>
            <Icon name="bible" />
          </span>
          <span className="read-bible-label">Holy Bible · KJV</span>
        </span>
        <span>
          <span className="pb-ttl" style={{ fontSize: 24, display: "block" }}>
            {place ? `${place.book} ${place.chapter}` : "The Bible"}
          </span>
          <span className="read-bible-hint">{place ? `Continue where you stopped · verse ${place.verse}` : "Open the Bible"}</span>
        </span>
        <span className="pb-btn" style={{ minHeight: 46, width: "fit-content", fontSize: 15 }}>Continue reading</span>
      </button>

      <p className="ofc-sec" style={{ margin: "4px 4px 0" }}>From your church</p>
      <div className="read-shelf">
        <button type="button" className="read-book" onClick={() => onOpen("devotion")}>
          <span className="read-cover" style={{ background: COVERS[0] }}>
            <Icon name="sun" />
          </span>
          <span className="read-book-name">{devotionTitle || "Today's devotional"}</span>
          <span className="read-book-hint">{today}</span>
        </button>
        {books.map((book) => (
          <button key={book.key} type="button" className="read-book" onClick={() => onOpen(book.key)}>
            <span className="read-cover" style={{ background: coverOf(book.key) }}>
              <Icon name={book.hasPdf ? "pdf" : "book"} />
            </span>
            <span className="read-book-name">{book.title}</span>
            <span className="read-book-hint">{book.hasPdf ? "PDF" : book.link ? "Link" : "Book"}</span>
          </button>
        ))}
      </div>

      <p className="ofc-sec" style={{ margin: "4px 4px 0" }}>Mine</p>
      <button type="button" className="pb-card ofc-row" style={{ width: "100%", textAlign: "left", font: "inherit" }} onClick={() => onOpen("notebook")}>
        <span className="ofc-tile" style={{ width: 42, height: 42, color: "var(--pb-second)", background: "var(--pb-second-soft)" }}>
          <Icon name="note" />
        </span>
        <span className="ofc-words">
          <span className="ofc-name">My notebook</span>
          <span className="ofc-hint">Your sermon notes · works offline</span>
        </span>
        <span className="pb-quiet">
          <Icon name="arrow" size={18} />
        </span>
      </button>
    </div>
  );
}
