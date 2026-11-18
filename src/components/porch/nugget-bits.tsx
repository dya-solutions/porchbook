import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getNugget, mySavedNuggets, toggleNuggetSave } from "@/lib/porch/nuggets";
import { holdRadio, releaseRadio } from "@/lib/porch/fm-player";
import type { OnAir } from "@/lib/porch/fm-schedule";

/**
 * Nuggets for listeners: the radio screen while a nugget plays (Save, Share),
 * a nugget opened from a shared link, and the list of saved nuggets.
 */
const time = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.max(0, Math.floor(sec % 60))).padStart(2, "0")}`;

export function nuggetLink(id: number) {
  const origin = typeof window === "undefined" ? "https://porchbook.vercel.app" : window.location.origin;
  return `${origin}/?nugget=${id}`;
}

/** Share a nugget: the phone's share sheet, or the link copied. Says "copied" when it was. */
async function shareNugget(id: number, title: string, speaker: string): Promise<boolean> {
  const url = nuggetLink(id);
  const text = `“${title}” · ${speaker} · a nugget on Porchbook Radio`;
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
    } catch {
      /* closed the share sheet */
    }
    return false;
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    return true;
  } catch {
    return false;
  }
}

function ShareButton({ id, title, speaker }: { id: number; title: string; speaker: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="nug-btn"
      onClick={() =>
        void shareNugget(id, title, speaker).then((done) => {
          if (!done) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2500);
        })
      }
    >
      {copied ? "✓ Link copied" : "↗ Share"}
    </button>
  );
}

function SaveButton({ id, saved, onChange }: { id: number; saved: boolean; onChange: (saved: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`nug-btn${saved ? " is-on" : ""}`}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void toggleNuggetSave({ data: { id } })
          .then((r) => r.ok && onChange(r.saved))
          .finally(() => setBusy(false));
      }}
    >
      {saved ? "♥ Saved" : "♡ Save"}
    </button>
  );
}

/** The radio screen while a nugget plays as a station break. */
export function NuggetScreen({ onAir }: { onAir: OnAir }) {
  const n = onAir.track.nugget;
  const [saved, setSaved] = useState(false);
  const [now, setNow] = useState(onAir.offsetSec);
  useEffect(() => {
    if (!n) return;
    void getNugget({ data: { id: n.id } }).then((r) => r.ok && setSaved(r.saved)).catch(() => undefined);
  }, [n]);
  useEffect(() => {
    const started = Date.now() - onAir.offsetSec * 1000;
    const timer = window.setInterval(() => setNow((Date.now() - started) / 1000), 500);
    return () => window.clearInterval(timer);
  }, [onAir.offsetSec, onAir.track.id]);
  if (!n) return null;
  const len = onAir.track.durationSec;
  return (
    <div className="nug-screen" role="status">
      <p className="nug-head">
        NUGGET · STATION BREAK <i>{`${time(Math.min(now, len))} / ${time(len)}`}</i>
      </p>
      <p className="nug-title">{onAir.track.title}</p>
      <p className="nug-speaker">{n.speaker}</p>
      <div className="nug-row">
        {n.tags.slice(0, 3).map((t) => (
          <span key={t} className="nug-tag">
            #{t}
          </span>
        ))}
        <span className="nug-gap" />
        <SaveButton id={n.id} saved={saved} onChange={setSaved} />
        <ShareButton id={n.id} title={onAir.track.title} speaker={n.speaker} />
      </div>
      <div className="nug-bar">
        <i style={{ width: `${Math.min(100, (now / len) * 100)}%` }} />
      </div>
    </div>
  );
}

type Item = { id: number; title: string; speaker: string; tags: string[]; url: string; durationSec: number };

/** A little player for one nugget (a shared link, or one from Saved). The radio waits while it plays. */
function NuggetPlayer({ item, saved, onSaved, onClose }: { item: Item; saved: boolean; onSaved: (s: boolean) => void; onClose: () => void }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  useEffect(() => {
    const node = new Audio(item.url);
    audio.current = node;
    node.addEventListener("timeupdate", () => setAt(node.currentTime));
    node.addEventListener("ended", () => {
      setPlaying(false);
      releaseRadio("nugget");
    });
    return () => {
      node.pause();
      releaseRadio("nugget");
    };
  }, [item.url]);
  const toggle = () => {
    const node = audio.current;
    if (!node) return;
    if (playing) {
      node.pause();
      setPlaying(false);
      releaseRadio("nugget");
    } else {
      holdRadio("nugget", () => {
        node.pause();
        setPlaying(false);
      });
      void node.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };
  return (
    <div className="nug-card">
      <p className="nug-head">NUGGET · PORCHBOOK RADIO</p>
      <p className="nug-title">{item.title}</p>
      <p className="nug-speaker">{item.speaker}</p>
      <div className="nug-row">
        {item.tags.slice(0, 3).map((t) => (
          <span key={t} className="nug-tag">
            #{t}
          </span>
        ))}
      </div>
      <div className="nug-play">
        <button type="button" className="nug-big" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="nug-bar is-wide">
          <i style={{ width: `${Math.min(100, (at / Math.max(1, item.durationSec)) * 100)}%` }} />
        </div>
        <span className="nug-time">{`${time(at)} / ${time(item.durationSec)}`}</span>
      </div>
      <div className="nug-row">
        <SaveButton id={item.id} saved={saved} onChange={onSaved} />
        <ShareButton id={item.id} title={item.title} speaker={item.speaker} />
        <span className="nug-gap" />
        <button type="button" className="nug-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** Opens a nugget from a shared link (?nugget=ID). Mounted once in the app frame. */
export function NuggetLink() {
  const [item, setItem] = useState<Item | null>(null);
  const [saved, setSaved] = useState(false);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("nugget"));
    if (!id) return;
    void getNugget({ data: { id } })
      .then((r) => {
        if (r.ok) {
          setItem(r.nugget);
          setSaved(r.saved);
        } else setMissing(true);
      })
      .catch(() => setMissing(true));
  }, []);
  const close = () => {
    setItem(null);
    setMissing(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("nugget");
    window.history.replaceState(window.history.state, "", url.toString());
  };
  if (!item && !missing) return null;
  return createPortal(
    <div className="nug-shade" onClick={close}>
      <div onClick={(e) => e.stopPropagation()}>
        {item ? (
          <NuggetPlayer item={item} saved={saved} onSaved={setSaved} onClose={close} />
        ) : (
          <div className="nug-card">
            <p className="nug-title">That nugget isn&apos;t on Porchbook any more.</p>
            <div className="nug-row">
              <span className="nug-gap" />
              <button type="button" className="nug-btn" onClick={close}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** "Saved nuggets" under the radio: the ones I've saved, each playable. */
export function SavedNuggets() {
  const [list, setList] = useState<Item[] | null>(null);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState<Item | null>(null);
  useEffect(() => {
    void mySavedNuggets().then(setList).catch(() => setList([]));
  }, [open]);
  if (!list?.length && !open) return null;
  return (
    <div className="nug-saved">
      <button type="button" className="nug-saved-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        ♥ Saved nuggets <b>{list?.length ?? 0}</b>
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <ul>
          {(list ?? []).map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => setPlaying(item)}>
                <span className="nug-mini">▶</span>
                <span>
                  <b>{item.title}</b>
                  <small>
                    {item.speaker} · {time(item.durationSec)}
                  </small>
                </span>
              </button>
            </li>
          ))}
          {list && !list.length ? <li className="nug-none">Nothing saved yet. Tap ♡ Save when a nugget plays.</li> : null}
        </ul>
      ) : null}
      {playing
        ? createPortal(
            <div className="nug-shade" onClick={() => setPlaying(null)}>
              <div onClick={(e) => e.stopPropagation()}>
                <NuggetPlayer
                  item={playing}
                  saved
                  onSaved={(s) => {
                    if (!s) setList((l) => (l ?? []).filter((x) => x.id !== playing.id));
                  }}
                  onClose={() => setPlaying(null)}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** The radio screen during a Bible reading: where in the book we are (chapter and verse, KJV), moving along as it is read. */
export function BibleScreen({ onAir, onOpen }: { onAir: OnAir; onOpen: (ref: { label: string; book: number; chapter: number; from: number; to: number }) => void }) {
  const b = onAir.track.bible;
  const [book, setBook] = useState<string[][] | null>(null);
  const [now, setNow] = useState(onAir.offsetSec);
  useEffect(() => {
    if (!b) return;
    let alive = true;
    void import("@/lib/porch/bible-engine").then(async (engine) => {
      await engine.openBible().catch(() => undefined);
      const chapters: string[][] = [];
      for (let c = 1; c <= engine.chapterCount("kjv", b.book); c += 1) chapters.push(engine.chapterVerses("kjv", b.book, c) ?? []);
      if (alive) setBook(chapters);
    });
    return () => {
      alive = false;
    };
  }, [b]);
  useEffect(() => {
    const started = Date.now() - onAir.offsetSec * 1000;
    const timer = window.setInterval(() => setNow((Date.now() - started) / 1000), 1000);
    return () => window.clearInterval(timer);
  }, [onAir.offsetSec, onAir.track.id]);
  if (!b) return null;
  const len = Math.max(1, onAir.track.durationSec);
  // How far into the whole book this moment is, laid over the book's words: about which chapter and verse is being read.
  let chapter = b.chapter || 1;
  let verse = 0;
  if (book?.length) {
    const share = b.bookSec ? Math.min(1, ((b.fromSec ?? 0) + Math.min(now, len)) / b.bookSec) : 0;
    const total = book.reduce((sum, ch) => sum + ch.reduce((n, v) => n + v.length, 0), 0);
    let left = share * total;
    let c = 0;
    for (; c < book.length - 1; c += 1) {
      const size = book[c].reduce((n, v) => n + v.length, 0);
      if (left <= size) break;
      left -= size;
    }
    chapter = c + 1;
    const verses = book[c] ?? [];
    for (verse = 0; verse < verses.length - 1 && left > verses[verse].length; verse += 1) left -= verses[verse].length;
  }
  const line = book?.[chapter - 1]?.[verse];
  return (
    <div className="nug-screen" role="status">
      <p className="nug-head">
        📖 BIBLE READING · KJV <i>{`${time(Math.min(now, len))} / ${time(len)}`}</i>
      </p>
      <p className="nug-title">
        {b.name} {chapter}
      </p>
      {line ? (
        <p key={`${chapter}-${verse}`} className="bible-line">
          <sup>{verse + 1}</sup> {line}
        </p>
      ) : null}
      <div className="nug-row">
        <span className="nug-gap" />
        <button type="button" className="nug-btn" onClick={() => onOpen({ label: `${b.name} ${chapter}`, book: b.book, chapter, from: verse + 1, to: verse + 1 })}>
          📖 Open in the Bible
        </button>
      </div>
      <div className="nug-bar">
        <i style={{ width: `${Math.min(100, (now / len) * 100)}%` }} />
      </div>
    </div>
  );
}
