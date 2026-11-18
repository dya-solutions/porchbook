import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { playButtonSound } from "@/lib/porch/button-sound-play";

/**
 * The Bible "meter": chapter and verse on rolling drums, like a fuel pump
 * counter. Flick a drum to roll it (one soft click per number); rolling past
 * 9 carries into the next drum (099 → 100). GO jumps there. While you read,
 * the drums follow the verse you're on.
 */

const STEP_PX = 12; // finger travel for one number
let lastClick = 0;
function click() {
  // During a fast spin, don't click on every number (it would buzz).
  const now = performance.now();
  if (now - lastClick < 60) return;
  lastClick = now;
  playButtonSound();
}

function Drum({ digit, onRoll, onTap, label }: { digit: number; onRoll: (steps: number) => void; onTap: () => void; label: string }) {
  const [drag, setDrag] = useState(0); // live finger offset, for the rolling look
  const start = useRef<{ y: number; t: number; taken: number; moved: number } | null>(null);
  const spin = useRef(0);

  useEffect(() => () => window.clearInterval(spin.current), []);

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    window.clearInterval(spin.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { y: event.clientY, t: performance.now(), taken: 0, moved: 0 };
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const s = start.current;
    if (!s) return;
    const dy = event.clientY - s.y;
    s.moved = Math.max(s.moved, Math.abs(dy));
    // Drag down = numbers roll down = smaller; drag up = larger (like turning a wheel).
    const steps = Math.trunc(-dy / STEP_PX);
    if (steps !== s.taken) {
      onRoll(steps - s.taken);
      click();
      s.taken = steps;
    }
    setDrag(dy + steps * STEP_PX);
  }

  function up(event: ReactPointerEvent<HTMLDivElement>) {
    const s = start.current;
    start.current = null;
    setDrag(0);
    if (!s) return;
    const dy = event.clientY - s.y;
    const ms = Math.max(1, performance.now() - s.t);
    // A tap (no real movement) opens the number picker instead.
    if (s.moved < 6 && ms < 400) {
      onTap();
      return;
    }
    const speed = -dy / ms; // px per ms, + = up
    // A flick keeps spinning, quickly at first, then slowing to a stop.
    let extra = Math.min(30, Math.floor(Math.abs(speed) * 14));
    if (Math.abs(speed) < 0.35 || extra < 2) return;
    const dir = speed > 0 ? 1 : -1;
    let gap = 16;
    const tick = () => {
      if (extra <= 0) return;
      onRoll(dir);
      click();
      extra -= 1;
      gap += 5;
      spin.current = window.setTimeout(tick, gap);
    };
    spin.current = window.setTimeout(tick, gap);
  }

  const prev = (digit + 9) % 10;
  const next = (digit + 1) % 10;
  return (
    <div
      role="spinbutton"
      aria-label={label}
      aria-valuenow={digit}
      className="bible-drum"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <div className="bible-drum-roll" style={{ transform: `translateY(${drag * 0.6}px)` }}>
        <span className="bible-drum-side">{prev}</span>
        <span className="bible-drum-now">{digit}</span>
        <span className="bible-drum-side">{next}</span>
      </div>
    </div>
  );
}

function Digits({ value, max, onChange, onTap, label }: { value: number; max: number; onChange: (next: number) => void; onTap: () => void; label: string }) {
  const digits = String(Math.max(0, Math.min(999, value))).padStart(3, "0").split("").map(Number);
  const places = [100, 10, 1];
  return (
    <div className="bible-drums">
      {digits.map((d, i) => (
        <Drum
          key={i}
          digit={d}
          label={`${label}, ${["hundreds", "tens", "units"][i]}`}
          onTap={onTap}
          onRoll={(steps) => onChange(Math.max(1, Math.min(max, value + steps * places[i])))}
        />
      ))}
    </div>
  );
}

function todayKey() {
  const d = new Date(Date.now() + 3 * 3600 * 1000); // Kampala day
  return `porch-chapters-${d.toISOString().slice(0, 10)}`;
}

/** Chapters read today (a chapter counts after you've stayed on it 30 seconds). */
export function useChaptersToday(book: number, chapter: number) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const read = () => {
      try {
        const list = JSON.parse(localStorage.getItem(todayKey()) || "[]") as string[];
        setCount(list.length);
        return list;
      } catch {
        return [];
      }
    };
    read();
    const timer = window.setTimeout(() => {
      const list = read();
      const id = `${book}:${chapter}`;
      if (list.includes(id)) return;
      try {
        localStorage.setItem(todayKey(), JSON.stringify([...list, id]));
      } catch {
        /* still counts on screen */
      }
      setCount(list.length + 1);
    }, 30000);
    return () => window.clearTimeout(timer);
  }, [book, chapter]);
  return count;
}

export function BibleCounter({
  chapter,
  verse,
  chapters,
  versesIn,
  readToday,
  onGo,
  onPick,
}: {
  chapter: number;
  verse: number;
  chapters: number;
  versesIn: (chapter: number) => number;
  readToday: number;
  onGo: (chapter: number, verse: number) => void;
  onPick: (what: "chapter" | "verse") => void;
}) {
  const [draft, setDraft] = useState({ chapter, verse });
  const touched = useRef(0);

  // Follow the reading position, unless the reader has just been rolling.
  useEffect(() => {
    if (Date.now() - touched.current < 5000) return;
    setDraft({ chapter, verse });
  }, [chapter, verse]);

  const maxVerse = Math.max(1, versesIn(draft.chapter));

  function change(next: { chapter?: number; verse?: number }) {
    touched.current = Date.now();
    setDraft((current) => {
      const c = next.chapter ?? current.chapter;
      const limit = Math.max(1, versesIn(c));
      const v = next.chapter !== undefined && next.chapter !== current.chapter ? 1 : Math.min(next.verse ?? current.verse, limit);
      return { chapter: c, verse: v };
    });
  }

  return (
    <div className="bible-meter">
      <p className="bible-meter-total">
        CHAPTERS READ TODAY <b>{String(readToday).padStart(4, "0")}</b>
      </p>
      <div className="bible-meter-window">
        <Digits value={draft.chapter} max={chapters} label="Chapter" onChange={(c) => change({ chapter: c })} onTap={() => onPick("chapter")} />
        <span className="bible-meter-colon">:</span>
        <Digits value={draft.verse} max={maxVerse} label="Verse" onChange={(v) => change({ verse: v })} onTap={() => onPick("verse")} />
        <button
          type="button"
          className="bible-meter-go"
          onClick={() => {
            playButtonSound();
            touched.current = 0;
            onGo(draft.chapter, draft.verse);
          }}
        >
          GO
        </button>
      </div>
      <div className="bible-meter-foot">
        <span>CHAPTER</span>
        <span className="bible-meter-label">ROLL OR TAP THE NUMBERS</span>
        <span>VERSE</span>
      </div>
    </div>
  );
}
