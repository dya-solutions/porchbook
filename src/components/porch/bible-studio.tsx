import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BOOKS } from "@/lib/porch/bible-engine";
import { addBibleBook, bibleDesk, dropBibleBook, moveBiblePiece, saveBibleSettings, type BibleBookAudio } from "@/lib/porch/bible-radio";
import { playFmNow } from "@/lib/porch/fm";
import { refreshStation } from "@/lib/porch/fm-player";

/**
 * Studio → Bible readings: upload the Bible book by book. Each book is cut into ~3-minute pieces
 * (ending at pauses); with the readings on, one piece plays after every few Radio items, carrying on
 * from where the last stopped.
 */
type Desk = Extract<Awaited<ReturnType<typeof bibleDesk>>, { ok: true }>;
const BIBLE_ID_BASE = 20_000_000;
const short = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(Math.floor(sec % 60)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

/** Which book a file is, from its name: "01 Genesis.mp3", "Gen.mp3", "40_Matthew.mp3", "1 John.mp3"… */
export function bookFromName(fileName: string): number {
  const base = fileName.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_\-.]+/g, " ").trim().toLowerCase();
  const words = base.replace(/\s+/g, " ");
  // A name first (longest names first, so "1 John" wins over "John").
  const byName = [...BOOKS].sort((a, b) => b.name.length - a.name.length).find((b) => {
    const name = b.name.toLowerCase();
    const plain = name.replace(/^(\d) /, "$1");
    return words.includes(name) || words.replace(/\s/g, "").includes(plain.replace(/\s/g, "")) || new RegExp(`(^|\\s)${b.abbreviation.toLowerCase()}(\\s|$)`).test(words);
  });
  if (byName) return byName.number;
  // Otherwise a leading number 1–66 ("01", "40").
  const lead = /^(\d{1,2})(\s|$)/.exec(words);
  const n = lead ? Number(lead[1]) : 0;
  return n >= 1 && n <= 66 ? n : 0;
}

async function toStorage(file: File, path: string, onProgress: (p: number) => void) {
  const { uploadFile } = await import("@/lib/porch/upload-file");
  return uploadFile(path, file, { handleUploadUrl: "/api/fm-upload", contentType: file.type || "audio/mpeg", onProgress });
}

function Upload({ onDone }: { onDone: () => void }) {
  const box = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<{ file: File; book: number }[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  function choose() {
    const files = [...(box.current?.files ?? [])];
    setPicked(files.map((file) => ({ file, book: bookFromName(file.name) })).sort((a, b) => (a.book || 99) - (b.book || 99)));
    setNote("");
  }
  async function go() {
    const ready = picked.filter((p) => p.book);
    if (!ready.length) return setNote("Choose the book files (and the book for any file Porchbook couldn't name).");
    setBusy(true);
    try {
      for (let i = 0; i < ready.length; i += 1) {
        const { file, book } = ready[i];
        const name = BOOKS[book - 1].name;
        setNote(`Uploading ${name} (${i + 1} of ${ready.length})…`);
        const url = await toStorage(file, `bible/${name.replace(/\s+/g, "-")}-book.mp3`, (p) => setNote(`Uploading ${name} (${i + 1} of ${ready.length})… ${p}%`));
        const r = await addBibleBook({ data: { book, url } });
        if (!r.ok) {
          setNote(`${name}: ${r.error}`);
          return;
        }
      }
      setNote(`Uploaded ${ready.length} book${ready.length === 1 ? "" : "s"}. Porchbook is cutting them into 3-minute readings (a few minutes each).`);
      setPicked([]);
      if (box.current) box.current.value = "";
      onDone();
    } catch {
      setNote("The upload stopped. Check your data and try again; books already uploaded are kept.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ns-card">
      <p className="ns-sec-in">Upload books</p>
      <input ref={box} type="file" accept="audio/*" multiple className="ns-tags" onChange={choose} />
      <p className="ns-src">Choose one or many book files at once. Porchbook names them from the file names (like “01 Genesis.mp3”) and puts them in Bible order.</p>
      {picked.length ? (
        <ul className="bs-list">
          {picked.map((p, i) => (
            <li key={`${p.file.name}-${i}`}>
              <span className="bs-ch">
                {p.file.name}
                <small>{Math.round(p.file.size / 1048576)} MB</small>
              </span>
              <select
                className="ns-tags"
                style={{ width: 150 }}
                value={p.book}
                onChange={(e) => setPicked((all) => all.map((x, k) => (k === i ? { ...x, book: Number(e.target.value) } : x)))}
                aria-label={`Book for ${p.file.name}`}
              >
                <option value={0}>Which book?</option>
                {BOOKS.map((b) => (
                  <option key={b.number} value={b.number}>
                    {b.name}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      ) : null}
      {note ? <p className="ns-note ns-note-in">{note}</p> : null}
      <div className="ns-acts">
        <button type="button" className="ns-ok" disabled={busy || !picked.length} onClick={() => void go()}>
          ⬆ Upload {picked.filter((p) => p.book).length || ""}
        </button>
      </div>
    </div>
  );
}

function Book({ b, onDone }: { b: BibleBookAudio; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(0);
  const [note, setNote] = useState("");
  const [moves, setMoves] = useState<Record<number, number>>({});
  const audio = useRef<HTMLAudioElement | null>(null);
  const stopAt = useRef(0);
  useEffect(() => () => audio.current?.pause(), []);
  /** Hear where a reading would start after moving it: from the new start, about 8 seconds. */
  const hear = (index: number) => {
    const p = b.pieces[index];
    const prev = b.pieces[index - 1];
    const delta = moves[p.id] ?? 0;
    audio.current?.pause();
    // Moving earlier: the last moments of the reading before, then on into this one.
    let phase: "prev" | "cur" = delta < 0 && prev ? "prev" : "cur";
    const node = new Audio(phase === "prev" ? prev.url : p.url);
    audio.current = node;
    let seekTo = phase === "prev" ? Math.max(0, prev.durationSec + delta) : Math.max(0, delta);
    stopAt.current = phase === "prev" ? prev.durationSec - 0.05 : seekTo + 8;
    node.addEventListener("loadedmetadata", () => {
      node.currentTime = seekTo;
      void node.play().then(() => setPlaying(-p.id)).catch(() => setPlaying(0));
    });
    node.addEventListener("timeupdate", () => {
      if (node.currentTime < stopAt.current) return;
      if (phase === "prev") {
        phase = "cur";
        seekTo = 0;
        stopAt.current = 6;
        node.src = p.url;
        return;
      }
      node.pause();
      setPlaying(0);
    });
  };
  const listen = (id: number, url: string) => {
    audio.current?.pause();
    if (playing === id) return setPlaying(0);
    const node = new Audio(url);
    audio.current = node;
    node.onended = () => setPlaying(0);
    void node.play().then(() => setPlaying(id)).catch(() => setPlaying(0));
  };
  return (
    <div className="ns-card">
      <div className="ns-sec" style={{ padding: 0 }}>
        <span>{b.name}</span>
        <b className="bs-state">
          {b.status === "splitting" ? "cutting into readings…" : b.status === "moving" ? "moving a start…" : b.status === "failed" ? "didn't finish" : `${b.pieces.length} readings · ${short(b.durationSec)}`}
        </b>
      </div>
      {b.error ? <p className="ns-err">{b.error}</p> : null}
      {note ? <p className="ns-note ns-note-in">{note}</p> : null}
      <div className="ns-acts">
        {b.pieces.length ? (
          <button type="button" className="ns-ed" onClick={() => setOpen(!open)}>
            {open ? "Hide readings" : "Listen to the readings"}
          </button>
        ) : null}
        <button
          type="button"
          className="ns-dr"
          onClick={async () => {
            const r = await dropBibleBook({ data: { id: b.id } }).catch(() => null);
            setNote(r?.ok ? "Removed." : "Couldn't remove it.");
            onDone();
            void refreshStation();
          }}
        >
          Remove book
        </button>
      </div>
      {open ? (
        <ul className="bs-list">
          {b.pieces.map((p) => (
            <li key={p.id}>
              <button type="button" className="ns-ep-play" onClick={() => listen(p.id, p.url)} aria-label={`Listen to reading ${p.piece}`}>
                {playing === p.id ? "❚❚" : "▶"}
              </button>
              <span className="bs-ch">
                Reading {p.piece}
                <small>
                  from {short(p.startSec)} · {short(p.durationSec)}
                  {moves[p.id] ? ` · start ${moves[p.id] > 0 ? "+" : ""}${moves[p.id]}s` : ""}
                </small>
              </span>
              {p.piece > 1 ? (
                <span className="ns-nudge" title="Move where this reading starts">
                  <button type="button" aria-label="Start earlier" onClick={() => setMoves((m) => ({ ...m, [p.id]: Math.max(-60, (m[p.id] ?? 0) - 1) }))}>
                    ‹
                  </button>
                  <button type="button" aria-label="Start later" onClick={() => setMoves((m) => ({ ...m, [p.id]: Math.min(60, (m[p.id] ?? 0) + 1) }))}>
                    ›
                  </button>
                </span>
              ) : null}
              {moves[p.id] ? (
                <>
                  <button type="button" className="bs-mini" onClick={() => hear(b.pieces.indexOf(p))}>
                    {playing === -p.id ? "…" : "▶ Hear"}
                  </button>
                  <button
                    type="button"
                    className="bs-mini is-save"
                    onClick={async () => {
                      const r = await moveBiblePiece({ data: { id: p.id, deltaSec: moves[p.id] } }).catch(() => null);
                      setNote(r?.ok ? `Moving the start of reading ${p.piece} (a minute or two)…` : r && !r.ok ? r.error : "Couldn't move it.");
                      if (r?.ok) setMoves((m) => ({ ...m, [p.id]: 0 }));
                      onDone();
                    }}
                  >
                    Save
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="bs-mini"
                onClick={async () => {
                  const r = await playFmNow({ data: { trackId: BIBLE_ID_BASE + p.id } }).catch(() => null);
                  setNote(r?.ok ? `${b.name} reading ${p.piece} plays for everyone in about 15 seconds.` : "Couldn't play it.");
                  void refreshStation();
                }}
              >
                Play now
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Settings({ settings, ready, onDone }: { settings: Desk["settings"]; ready: number; onDone: () => void }) {
  const [on, setOn] = useState(settings.on);
  const [every, setEvery] = useState(settings.every);
  const [note, setNote] = useState("");
  const save = async (next: { on: boolean; every: number }) => {
    setNote("");
    const r = await saveBibleSettings({ data: next }).catch(() => null);
    setNote(r?.ok ? (next.on ? "On: a reading plays after every " + next.every + " items." : "Off.") : "Couldn't save. Check your data.");
    onDone();
    void refreshStation();
  };
  return (
    <div className="ns-card">
      <label className="ns-check">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            void save({ on: e.target.checked, every });
          }}
        />{" "}
        Bible readings on the Radio {ready ? "" : "(upload a book first)"}
      </label>
      <div className="ns-time">
        <span>A 3-minute reading after every</span>
        <span className="ns-nudge">
          <button type="button" onClick={() => setEvery((v) => Math.max(1, v - 1))}>
            ‹
          </button>
          {every}
          <button type="button" onClick={() => setEvery((v) => Math.min(20, v + 1))}>
            ›
          </button>
        </span>
        <span>items</span>
        {every !== settings.every ? (
          <button type="button" className="ns-ok ns-small" onClick={() => void save({ on, every })}>
            Save
          </button>
        ) : null}
      </div>
      <p className="ns-src">Readings go in Bible order and carry on from where the last one stopped. While they are on, the automatic nugget breaks pause (Play now still works).</p>
      {note ? <p className="ns-note ns-note-in">{note}</p> : null}
    </div>
  );
}

export function BibleStudio() {
  const [open, setOpen] = useState(false);
  const [desk, setDesk] = useState<Desk | null>(null);
  const load = useCallback(() => {
    void bibleDesk()
      .then((r) => r.ok && setDesk(r))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!open) return;
    load();
    const timer = window.setInterval(load, 20000);
    return () => window.clearInterval(timer);
  }, [open, load]);
  const ready = desk?.books.reduce((n, b) => n + b.pieces.length, 0) ?? 0;
  const sheet = (
    <div className="ns-shade">
      <div className="ns-sheet" role="dialog" aria-label="Bible readings">
        <div className="ns-head">
          <div>
            <p>STUDIO</p>
            <h2>Bible readings</h2>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="ns-body">
          {!desk ? <p className="ns-empty">Loading…</p> : null}
          {desk ? (
            <>
              <Settings settings={desk.settings} ready={ready} onDone={load} />
              {desk.settings.on && desk.coming.length ? (
                <div className="ns-card">
                  <p className="ns-sec-in">Coming up</p>
                  <ul className="bs-coming">
                    {desk.coming.map((c) => (
                      <li key={`${c.at}-${c.title}`}>
                        at {new Date(c.at).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Kampala" })} · <b>{c.title}</b> ·{" "}
                        {Math.max(1, Math.round(c.durationSec / 60))} min
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <Upload onDone={load} />
              {desk.books.map((b) => (
                <Book key={b.id} b={b} onDone={load} />
              ))}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
  return (
    <>
      <button type="button" className="cr-enter ns-enter" onClick={() => setOpen(true)}>
        📖 Bible readings · 3 minutes between items
      </button>
      {open && typeof document !== "undefined" ? createPortal(sheet, document.body) : null}
    </>
  );
}
