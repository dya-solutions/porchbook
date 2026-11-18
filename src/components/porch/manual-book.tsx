import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { MANUAL_CHAPTERS, type ManualItem } from "@/lib/porch/manual-chapters";
import { manualOpened } from "@/lib/porch/manual-card";

/**
 * The Porchbook Manual as a book you turn: a green leather cover, then white pages with
 * Porchbook green and orange touches (the same look as the printed manual).
 * Each chapter is one page; a long page scrolls.
 */
type Page = { id: string; title: string; edge: string; hard?: boolean; chapter?: number };

const PAGES: Page[] = [
  { id: "cover", title: "Porchbook Manual", edge: "#0c2410", hard: true },
  { id: "welcome", title: "Welcome to the porch", edge: "#e8e2d0" },
  { id: "contents", title: "Contents", edge: "#e8e2d0" },
  ...MANUAL_CHAPTERS.map((chapter, n) => ({ id: `ch${n + 1}`, title: chapter.title, edge: n % 2 ? "#f8a018" : "#7dff2a", chapter: n })),
  { id: "close", title: "Close the book", edge: "#0c2410", hard: true },
];

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const BOLD = /(▶ Listen|REQUEST|BIBLES|KJV|MENU|Lite|Reset)/g;
function Ink({ text }: { text: string }) {
  return <>{text.split(BOLD).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))}</>;
}

function Item({ item }: { item: ManualItem }) {
  if (item.kind === "q")
    return (
      <div className={`mb-qa${item.a ? "" : " is-lead"}`}>
        <h3>{item.q}</h3>
        {item.a ? <p><Ink text={item.a} /></p> : null}
      </div>
    );
  if (item.kind === "topic")
    return (
      <div className="mb-topic">
        <h3>{item.title}</h3>
        {item.note ? <p className="mb-note">{item.note}</p> : null}
        <p><Ink text={item.text} /></p>
      </div>
    );
  if (item.kind === "list")
    return (
      <ul className="mb-list">
        {item.lines.map((line, i) => (
          <li key={i} style={{ marginLeft: line.depth * 16 }} className={line.depth ? "is-sub" : ""}>
            <Ink text={line.text} />
          </li>
        ))}
      </ul>
    );
  if (item.kind === "table")
    return (
      <table className="mb-table">
        <thead><tr>{item.head.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{item.rows.map((row) => <tr key={row[0]}>{row.map((c, i) => <td key={i}><Ink text={c} /></td>)}</tr>)}</tbody>
      </table>
    );
  return <p><Ink text={item.text} /></p>;
}

function Leather({ children }: { children: ReactNode }) {
  return (
    <div className="mb-leather">
      <span className="mb-stitch" aria-hidden="true" />
      {children}
    </div>
  );
}

function PageBody({ page, onJump }: { page: Page; onJump: (id: string) => void }) {
  if (page.id === "cover")
    return (
      <Leather>
        <div className="mb-cover">
          <img src="/icon-512.png" alt="" className="mb-fly" />
          <p className="mb-eyebrow">Phaneroo Ministries Mbarara</p>
          <h1>Porchbook<em>Manual</em></h1>
          <span className="mb-rule" aria-hidden="true" />
          <p className="mb-sub">How to use Porchbook, in our own words</p>
          <p className="mb-hint">Turn the page ›</p>
        </div>
      </Leather>
    );
  if (page.id === "close")
    return (
      <Leather>
        <div className="mb-cover">
          <img src="/icon-512.png" alt="" className="mb-fly is-small" />
          <h1 className="is-small">Share what God is saying.</h1>
          <span className="mb-rule" aria-hidden="true" />
          <p className="mb-sub">You can ask the porch guy anything in this book.</p>
        </div>
      </Leather>
    );
  if (page.id === "welcome")
    return (
      <article className="mb-page">
        <h2 className="mb-title">Welcome to the porch</h2>
        <p className="mb-lead">This book is for you, a member of Phaneroo Ministries.</p>
        <p>Porchbook is a place where believers in Christ come to share and receive inspiration from one another.</p>
        <p>Each chapter answers the questions people ask most, in plain words. What you read here is what the porch guy tells you in the app, so you can always ask him too.</p>
        <p>We only describe what is ready. Parts we are still building are marked, so nobody is promised what isn&apos;t there yet.</p>
        <p className="mb-sig">The Porchbook team</p>
      </article>
    );
  if (page.id === "contents")
    return (
      <article className="mb-page">
        <h2 className="mb-title">Contents</h2>
        <p className="mb-lead">Five short chapters. Tap one to go there.</p>
        <ol className="mb-toc">
          {MANUAL_CHAPTERS.map((chapter, n) => (
            <li key={chapter.title}>
              <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => onJump(`ch${n + 1}`)}>
                <span className="mb-toc-n">{String(n + 1).padStart(2, "0")}</span>
                <span className="mb-toc-t">{chapter.title}</span>
                <span aria-hidden="true">{chapter.icon}</span>
              </button>
            </li>
          ))}
        </ol>
      </article>
    );
  const n = page.chapter ?? 0;
  const chapter = MANUAL_CHAPTERS[n];
  return (
    <article className="mb-page is-chapter">
      <header className="mb-head">
        <span className="mb-num">{String(n + 1).padStart(2, "0")}</span>
        <div>
          <p className="mb-kicker">Chapter {n + 1}</p>
          <h2>{chapter.title}</h2>
          <p className="mb-intro">{chapter.intro}</p>
        </div>
        <span className="mb-icon" aria-hidden="true">{chapter.icon}</span>
      </header>
      {chapter.items.map((item, i) => <Item key={i} item={item} />)}
    </article>
  );
}

function Face({ page, side, onJump }: { page: Page; side: "front" | "back"; onJump: (id: string) => void }) {
  return (
    <div
      className={`absolute inset-0 overflow-hidden rounded-[2px] ${page.hard ? "" : "mb-paper"}`}
      style={{ backfaceVisibility: "hidden", transform: side === "back" ? "rotateY(180deg)" : undefined }}
    >
      <div className={`absolute inset-0 ${page.hard ? "" : "overflow-y-auto overscroll-contain pb-12"}`}>
        <PageBody page={page} onJump={onJump} />
      </div>
      {page.hard ? null : (
        <p className="mb-foot">
          <span>Property of Phaneroo Ministries Mbarara</span>
          <span>{PAGES.findIndex((item) => item.id === page.id) + 1}</span>
        </p>
      )}
    </div>
  );
}

export function PorchManual({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [wide, setWide] = useState(false);
  const [angle, setAngle] = useState(0);
  const [dir, setDir] = useState<"next" | "prev" | null>(null);
  const angleRef = useRef(0);
  const bookRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);
  const drag = useRef<{ x: number; y: number; dir: "next" | "prev" | null; width: number } | null>(null);
  const frame = useRef(0);

  // Opening the book counts as reading it: the welcome card won't come back.
  useEffect(() => {
    void manualOpened().catch(() => undefined);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 900px)");
    const apply = () => setWide(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  function setTurn(next: number) {
    angleRef.current = next;
    setAngle(next);
  }

  function settle(from: number, to: number, nextIndex: number) {
    cancelAnimationFrame(frame.current);
    if (reducedMotion()) {
      setDir(null);
      setTurn(0);
      setIndex(nextIndex);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 280);
      const eased = 1 - (1 - t) * (1 - t);
      setTurn(from + (to - from) * eased);
      if (t < 1) frame.current = requestAnimationFrame(step);
      else {
        setDir(null);
        setTurn(0);
        setIndex(nextIndex);
      }
    };
    frame.current = requestAnimationFrame(step);
  }

  function jump(id: string) {
    const next = PAGES.findIndex((page) => page.id === id);
    const at = indexRef.current;
    if (next < 0 || next === at) return;
    if (next > at) {
      setDir("next");
      settle(0, -180, next);
    } else {
      setDir("prev");
      settle(-180, 0, next);
    }
  }

  function begin(clientX: number, clientY: number) {
    const width = bookRef.current?.getBoundingClientRect().width ?? 320;
    drag.current = { x: clientX, y: clientY, dir: null, width: wide && indexRef.current > 0 ? width / 2 : width };
  }

  function move(clientX: number) {
    const current = drag.current;
    if (!current) return;
    const dx = clientX - current.x;
    if (!current.dir) {
      if (Math.abs(dx) < 10) return;
      const way = dx < 0 ? "next" : "prev";
      if (way === "next" && indexRef.current >= PAGES.length - 1) return;
      if (way === "prev" && indexRef.current <= 0) return;
      current.dir = way;
      setDir(way);
      setTurn(way === "prev" ? -180 : 0);
    }
    const raw = current.dir === "next" ? (dx / current.width) * -180 : -180 + (Math.max(0, dx) / current.width) * 180;
    setTurn(Math.max(-180, Math.min(0, raw)));
  }

  function finish(clientX: number, clientY: number) {
    const current = drag.current;
    drag.current = null;
    const at = indexRef.current;
    if (!current?.dir) {
      const box = bookRef.current?.getBoundingClientRect();
      const moved = Math.hypot(clientX - (current?.x ?? clientX), clientY - (current?.y ?? clientY));
      if (box && moved < 12) {
        const local = clientX - box.left;
        if (local > box.width * 0.72 && at < PAGES.length - 1) {
          setDir("next");
          settle(0, -180, at + 1);
        } else if (local < box.width * 0.28 && at > 0) {
          setDir("prev");
          settle(-180, 0, at - 1);
        }
      }
      return;
    }
    const shown = angleRef.current;
    if (current.dir === "next") settle(shown, shown < -50 ? -180 : 0, shown < -50 ? at + 1 : at);
    else if (shown > -130) settle(shown, 0, at - 1);
    else {
      setDir(null);
      setTurn(0);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const at = indexRef.current;
      if (event.key === "ArrowRight" && at < PAGES.length - 1) {
        setDir("next");
        settle(0, -180, at + 1);
      }
      if (event.key === "ArrowLeft" && at > 0) {
        setDir("prev");
        settle(-180, 0, at - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wide]);

  const at = index;
  const closed = at === 0 && !dir;
  const rightPage = dir === "prev" ? PAGES[Math.max(0, at - 1)] : PAGES[at];
  const backPage = wide
    ? rightPage
    : dir === "prev"
      ? PAGES[at]
      : PAGES[Math.min(PAGES.length - 1, at + 1)];
  const underPage = dir === "prev" ? PAGES[at] : PAGES[Math.min(PAGES.length - 1, at + 1)];
  const leftPage = at === 0 ? null : at === 1 ? "board" : PAGES[at - 1];
  const shade = Math.sin((Math.abs(angle) * Math.PI) / 180) * 0.35;

  return (
    <div className="fixed inset-0 z-[300] flex flex-col bg-[#10180c]">
      <div className="flex items-center justify-between px-3 py-2 text-[#f6edd8]">
        <button type="button" onClick={onClose} aria-label="Close the book" className="grid size-11 place-items-center">
          <X className="size-5" />
        </button>
        <p className="text-sm">Drag a page, or tap the edge</p>
      </div>
      <div className="flex flex-1 items-center justify-center px-3 pb-6">
        <div
          ref={bookRef}
          className="relative h-[min(78dvh,680px)] transition-[width] duration-300"
          style={{ width: closed || !wide ? "min(92vw, 420px)" : "min(94vw, 920px)", perspective: "1800px" }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            begin(event.clientX, event.clientY);
          }}
          onPointerMove={(event) => move(event.clientX)}
          onPointerUp={(event) => finish(event.clientX, event.clientY)}
          onPointerCancel={(event) => finish(event.clientX, event.clientY)}
        >
          <div className="absolute top-1 bottom-1 right-[-6px] flex">
            {PAGES.slice(at + 1).map((page) => (
              <span key={page.id} className="w-1 rounded-r-sm" style={{ background: page.edge }} />
            ))}
          </div>
          {wide && !closed && leftPage ? (
            <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden rounded-l-md shadow-[-12px_16px_30px_rgba(0,0,0,0.35)]">
              {leftPage === "board" ? (
                <Leather><span /></Leather>
              ) : (
                <Face page={leftPage} side="front" onJump={jump} />
              )}
            </div>
          ) : null}
          <div className={`absolute inset-y-0 ${wide && !closed ? "left-1/2 w-1/2" : "inset-x-0"}`}>
            <div className="absolute inset-0 overflow-hidden rounded-r-md shadow-[12px_16px_30px_rgba(0,0,0,0.35)]">
              <Face page={underPage} side="front" onJump={jump} />
            </div>
            <div
              className="absolute inset-0"
              style={{
                transformStyle: "preserve-3d",
                transformOrigin: "left center",
                transform: `rotateY(${angle}deg)`,
              }}
            >
              <Face page={rightPage} side="front" onJump={jump} />
              <Face page={backPage} side="back" onJump={jump} />
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background: "linear-gradient(90deg, rgba(0,0,0,0.28), transparent 28%)",
                  opacity: shade,
                  backfaceVisibility: "hidden",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
