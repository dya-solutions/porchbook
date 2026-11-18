import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  addNugget,
  findNuggetMoments,
  nuggetDesk,
  refreshNuggetFeed,
  saveNugget,
  saveNuggetSettings,
  saveNuggetSpeaker,
  saveGroqKey,
  setNuggetInBreaks,
  nuggetWorker,
  type Nugget,
  type NuggetSource,
  type NuggetSpeaker,
} from "@/lib/porch/nuggets";
import { fmNow, peekOnAir, refreshStation } from "@/lib/porch/fm-player";
import { playFmNow } from "@/lib/porch/fm";

const NUGGET_ID_BASE = 10_000_000; // nugget ids on the radio (as on the server)

/**
 * Studio → Nuggets: speakers, their newest episodes ("Find moments"), the AI's suggestions to approve,
 * edit or drop, nuggets added by hand, the library, and the station-break settings.
 */
type Desk = Extract<Awaited<ReturnType<typeof nuggetDesk>>, { ok: true }>;
type Tab = "suggested" | "episodes" | "library" | "speakers" | "breaks";

const clock = (sec: number) => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, "0")}`;
const short = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
function parseClock(text: string) {
  const parts = text.trim().split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  return parts.reduce((sum, n) => sum * 60 + n, 0);
}
const dateOf = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

/** Plays an episode from start to end (a plain player, no effects), so the clip can be checked before approving. */
function usePreview() {
  const node = useRef<HTMLAudioElement | null>(null);
  const [on, setOn] = useState<string>("");
  const stopAt = useRef(0);
  useEffect(() => () => node.current?.pause(), []);
  const play = (key: string, url: string, start: number, end: number) => {
    if (on === key) {
      node.current?.pause();
      setOn("");
      return;
    }
    node.current?.pause();
    const audio = new Audio(url);
    node.current = audio;
    stopAt.current = end;
    audio.addEventListener("timeupdate", () => {
      if (audio.currentTime >= stopAt.current) {
        audio.pause();
        setOn("");
      }
    });
    audio.addEventListener("loadedmetadata", () => {
      audio.currentTime = start;
      void audio.play().catch(() => setOn(""));
    });
    audio.addEventListener("error", () => setOn(""));
    setOn(key);
  };
  return { on, play };
}

function NuggetCard({ n, onDone, preview }: { n: Nugget; onDone: () => void; preview: ReturnType<typeof usePreview> }) {
  const [title, setTitle] = useState(n.title);
  const [tags, setTags] = useState(n.tags.join(", "));
  const [start, setStart] = useState(n.startSec);
  const [end, setEnd] = useState(n.endSec);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const changed = title !== n.title || tags !== n.tags.join(", ") || start !== n.startSec || end !== n.endSec;
  async function save(status?: "approved" | "dropped") {
    setBusy(true);
    setNote("");
    const r = await saveNugget({
      data: { id: n.id, title, tags: tags.split(/[,\s]+/).filter(Boolean), startSec: start, endSec: end, status: status ?? "" },
    }).catch(() => null);
    setBusy(false);
    if (r?.ok) onDone();
    else setNote(r && !r.ok ? r.error : "Couldn't save it. Check your data.");
  }
  const nudge = (which: "start" | "end", by: number) => (which === "start" ? setStart((v) => Math.max(0, Math.round((v + by) * 10) / 10)) : setEnd((v) => Math.max(0, Math.round((v + by) * 10) / 10)));
  const key = `n${n.id}`;
  return (
    <div className="ns-card">
      <p className="ns-src">
        {n.episode ? `From “${n.episode}”` : "Added by hand"} · {n.madeBy === "ai" ? "AI pick" : "by you"}
        {n.status === "approved" ? (n.url ? " · ✓ on air" : n.cutError ? " · didn't finish" : " · being cut (a few minutes)…") : ""}
      </p>
      <input className="ns-title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
      {n.why ? <p className="ns-why">Why: {n.why}</p> : null}
      <div className="ns-time">
        <button type="button" className="ns-play" onClick={() => n.audioUrl && preview.play(key, n.audioUrl, start, end)} aria-label="Listen">
          {preview.on === key ? "❚❚" : "▶"}
        </button>
        <span>Start</span>
        <span className="ns-nudge">
          <button type="button" onClick={() => nudge("start", -1)}>
            ‹
          </button>
          {clock(start)}
          <button type="button" onClick={() => nudge("start", 1)}>
            ›
          </button>
        </span>
        <span>End</span>
        <span className="ns-nudge">
          <button type="button" onClick={() => nudge("end", -1)}>
            ‹
          </button>
          {clock(end)}
          <button type="button" onClick={() => nudge("end", 1)}>
            ›
          </button>
        </span>
        <b>{short(end - start)}</b>
      </div>
      <input className="ns-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, separated by commas" aria-label="Tags" />
      {n.cutError ? <p className="ns-err">Didn&apos;t finish: {n.cutError}</p> : null}
      {note ? <p className="ns-err">{note}</p> : null}
      <div className="ns-acts">
        {n.status === "approved" ? (
          <button type="button" className="ns-ok" disabled={busy || (!changed && !n.cutError)} onClick={() => void save("approved")}>
            {n.cutError ? "Try again" : "Save changes"}
          </button>
        ) : (
          <button type="button" className="ns-ok" disabled={busy} onClick={() => void save("approved")}>
            ✓ Approve
          </button>
        )}
        {n.status !== "approved" ? (
          <button type="button" className="ns-ed" disabled={busy || !changed} onClick={() => void save()}>
            Save edits
          </button>
        ) : null}
        <button type="button" className="ns-dr" disabled={busy} onClick={() => void save("dropped")}>
          {n.status === "approved" ? "Take off air" : "Drop"}
        </button>
      </div>
      {n.status === "approved" && n.url ? <OnAirControls n={n} onDone={onDone} /> : null}
      {n.status === "approved" && n.saves ? <p className="ns-src">♥ saved by {n.saves}</p> : null}
    </div>
  );
}

/** Add a nugget by hand: play the sermon here, mark where the moment starts and ends, listen to just that piece, then add it. */
function AddByHand({ sources, onDone, play }: { sources: NuggetSource[]; onDone: () => void; play: { id: number; turn: number } | null }) {
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? 0);
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // The sermon player.
  const audio = useRef<HTMLAudioElement | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(0);
  const clipEnd = useRef(0); // while playing just the clip: where to stop
  const source = sources.find((s) => s.id === sourceId);

  useEffect(() => {
    audio.current?.pause();
    setPlaying(false);
    setAt(0);
    setLength(source?.durationSec ?? 0);
    if (!source?.audioUrl) return;
    const node = new Audio();
    node.preload = "none";
    node.src = source.audioUrl;
    audio.current = node;
    node.addEventListener("timeupdate", () => {
      setAt(node.currentTime);
      if (clipEnd.current && node.currentTime >= clipEnd.current) {
        clipEnd.current = 0;
        node.pause();
      }
    });
    node.addEventListener("loadedmetadata", () => setLength(node.duration || source.durationSec));
    node.addEventListener("playing", () => {
      setPlaying(true);
      setLoading(false);
    });
    node.addEventListener("pause", () => setPlaying(false));
    node.addEventListener("waiting", () => setLoading(true));
    node.addEventListener("error", () => {
      setLoading(false);
      setPlaying(false);
      setNote("That sermon couldn't play. Check your data and try again.");
    });
    return () => node.pause();
  }, [source?.audioUrl, source?.durationSec]);

  // ▶ on an episode: choose it here and start playing.
  useEffect(() => {
    if (!play) return;
    setSourceId(play.id);
    card.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      clipEnd.current = 0;
      setLoading(true);
      void audio.current?.play().catch(() => setLoading(false));
    }, 120);
  }, [play]);

  const toggle = () => {
    const node = audio.current;
    if (!node) return;
    if (playing) node.pause();
    else {
      clipEnd.current = 0;
      setLoading(true);
      void node.play().catch(() => setLoading(false));
    }
  };
  const jump = (to: number) => {
    const node = audio.current;
    if (!node) return;
    node.currentTime = Math.max(0, Math.min(length || to, to));
    setAt(node.currentTime);
  };
  const playClip = () => {
    const s = parseClock(start);
    const e = parseClock(end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return setNote("Mark a start and an end first.");
    setNote("");
    const node = audio.current;
    if (!node) return;
    clipEnd.current = e;
    setLoading(true);
    node.currentTime = s;
    void node.play().catch(() => setLoading(false));
  };
  const mark = (which: "start" | "end") => {
    const text = clock(Math.max(0, at)).replace(/\.\d$/, "");
    if (which === "start") setStart(text);
    else setEnd(text);
  };

  return (
    <div className="ns-card" ref={card}>
      <p className="ns-sec-in">Add a nugget by hand</p>
      <select className="ns-tags" value={sourceId} onChange={(e) => setSourceId(Number(e.target.value))} aria-label="Sermon">
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title} ({dateOf(s.publishedAt)})
          </option>
        ))}
      </select>
      <div className="ns-player">
        <button type="button" className="ns-play" onClick={toggle} aria-label={playing ? "Pause" : "Listen"}>
          {loading ? "…" : playing ? "❚❚" : "▶"}
        </button>
        <div className="ns-player-mid">
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.round(length))}
            step={1}
            value={Math.round(at)}
            onChange={(e) => jump(Number(e.target.value))}
            aria-label="Position in the sermon"
          />
          <span>
            {short(at)} / {short(length)}
          </span>
        </div>
      </div>
      <div className="ns-skip">
        <button type="button" onClick={() => jump(at - 30)}>
          « 30s
        </button>
        <button type="button" onClick={() => jump(at - 5)}>
          ‹ 5s
        </button>
        <button type="button" onClick={() => jump(at + 5)}>
          5s ›
        </button>
        <button type="button" onClick={() => jump(at + 30)}>
          30s »
        </button>
      </div>
      <div className="ns-marks">
        <button type="button" onClick={() => mark("start")}>
          ⤓ Mark start
        </button>
        <button type="button" onClick={() => mark("end")}>
          ⤒ Mark end
        </button>
      </div>
      <div className="ns-time">
        <span>Start</span>
        <input className="ns-clock" value={start} onChange={(e) => setStart(e.target.value)} placeholder="41:06" inputMode="numeric" />
        <span>End</span>
        <input className="ns-clock" value={end} onChange={(e) => setEnd(e.target.value)} placeholder="42:18" inputMode="numeric" />
        <button type="button" className="ns-clip" onClick={playClip}>
          ▶ Listen to this piece
        </button>
      </div>
      <input className="ns-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
      <input className="ns-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, separated by commas" />
      {note ? <p className="ns-err">{note}</p> : null}
      <div className="ns-acts">
        <button
          type="button"
          className="ns-ok"
          disabled={busy || !sourceId}
          onClick={async () => {
            const s = parseClock(start);
            const e = parseClock(end);
            if (!Number.isFinite(s) || !Number.isFinite(e)) return setNote("Mark a start and an end (or write them like 41:06).");
            setBusy(true);
            setNote("");
            const r = await addNugget({ data: { sourceId, title, tags: tags.split(/[,\s]+/).filter(Boolean), startSec: s, endSec: e } }).catch(() => null);
            setBusy(false);
            if (r?.ok) {
              audio.current?.pause();
              setTitle("");
              setTags("");
              setStart("");
              setEnd("");
              setNote("Added: it will be on air in a few minutes (see Library).");
              onDone();
            } else setNote(r && !r.ok ? r.error : "Couldn't add it. Check your data.");
          }}
        >
          ✓ Add and approve
        </button>
      </div>
    </div>
  );
}

function SpeakerCard({ s, onDone }: { s: NuggetSpeaker | null; onDone: () => void }) {
  const [name, setName] = useState(s?.name ?? "");
  const [feed, setFeed] = useState(s?.feedUrl ?? "");
  const [permission, setPermission] = useState(s?.permission ?? "");
  const [onAir, setOnAir] = useState(s?.onAir ?? true);
  const [note, setNote] = useState("");
  return (
    <div className="ns-card">
      <input className="ns-title" value={name} onChange={(e) => setName(e.target.value)} placeholder="Speaker's name" />
      <input className="ns-tags" value={feed} onChange={(e) => setFeed(e.target.value)} placeholder="Podcast feed link (RSS)" />
      <textarea className="ns-tags" rows={2} value={permission} onChange={(e) => setPermission(e.target.value)} placeholder="Permission: who agreed, and when" />
      <label className="ns-check">
        <input type="checkbox" checked={onAir} onChange={(e) => setOnAir(e.target.checked)} /> Their nuggets play on the Radio
      </label>
      {note ? <p className="ns-err">{note}</p> : null}
      <div className="ns-acts">
        <button
          type="button"
          className="ns-ok"
          onClick={async () => {
            const r = await saveNuggetSpeaker({ data: { id: s?.id ?? 0, name, feedUrl: feed, permission, onAir } }).catch(() => null);
            if (r?.ok) {
              setNote("Saved.");
              onDone();
            } else setNote(r && !r.ok ? r.error : "Couldn't save. Check your data.");
          }}
        >
          Save speaker
        </button>
      </div>
    </div>
  );
}

export function NuggetStudio() {
  const [open, setOpen] = useState(false);
  const [desk, setDesk] = useState<Desk | null>(null);
  const [tab, setTab] = useState<Tab>("suggested");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(0);
  const [play, setPlay] = useState<{ id: number; turn: number } | null>(null);
  const [worker, setWorker] = useState<"checking" | "ready" | "old" | "asleep" | "unknown">("checking");
  useEffect(() => {
    if (!open) return;
    setWorker("checking");
    // Checking also wakes the audio server and sends again anything it didn't pick up; repeated every minute.
    const check = () =>
      void nuggetWorker()
        .then((r) => setWorker(r.state))
        .catch(() => setWorker("asleep"));
    check();
    const timer = window.setInterval(check, 60_000);
    return () => window.clearInterval(timer);
  }, [open]);
  const preview = usePreview();
  const load = useCallback(() => {
    void nuggetDesk()
      .then((r) => r.ok && setDesk(r))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!open) return;
    load();
    // While something is being transcribed or cut, look again every 15 seconds.
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [open, load]);

  const suggested = desk?.nuggets.filter((n) => n.status === "suggested") ?? [];
  const library = desk?.nuggets.filter((n) => n.status === "approved") ?? [];
  const after = () => {
    load();
    void refreshStation();
  };

  const sheet = (
    <div className="ns-shade">
      <div className="ns-sheet" role="dialog" aria-label="Nuggets">
        <div className="ns-head">
          <div>
            <p>STUDIO</p>
            <h2>Nuggets</h2>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close">
            ✕
          </button>
        </div>
        <p className={`ns-worker is-${worker}`}>
          {worker === "checking" ? "Audio server: checking (waking it if asleep)…" : null}
          {worker === "ready" ? "Audio server: ✓ ready" : null}
          {worker === "old" ? "Audio server: ⚠ not updated. In Render open porchbook-audio → Manual Deploy → Deploy latest commit." : null}
          {worker === "asleep" ? "Audio server: didn't answer. It may be waking up; nuggets waiting will be sent again automatically." : null}
        </p>
        <div className="ns-tabs">
          {(
            [
              ["suggested", `Suggestions${suggested.length ? ` · ${suggested.length}` : ""}`],
              ["episodes", "Episodes"],
              ["library", `Library${library.length ? ` · ${library.length}` : ""}`],
              ["speakers", "Speakers"],
              ["breaks", "Breaks"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" className={tab === key ? "is-on" : ""} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="ns-body">
          {!desk ? <p className="ns-empty">Loading…</p> : null}
          {note ? <p className="ns-note">{note}</p> : null}

          {desk && tab === "suggested" ? (
            <>
              {suggested.length ? null : <p className="ns-empty">No suggestions waiting. Open Episodes and tap Find moments.</p>}
              {suggested.map((n) => (
                <NuggetCard key={`${n.id}-${n.startSec}-${n.endSec}-${n.title}`} n={n} onDone={after} preview={preview} />
              ))}
            </>
          ) : null}

          {desk && tab === "episodes" ? (
            <>
              {desk.speakers.map((s) => (
                <div key={s.id} className="ns-sec">
                  <span>{s.name}</span>
                  <button
                    type="button"
                    disabled={busy === -s.id}
                    onClick={async () => {
                      setBusy(-s.id);
                      setNote("");
                      const r = await refreshNuggetFeed({ data: { speakerId: s.id } }).catch(() => null);
                      setBusy(0);
                      setNote(r?.ok ? (r.added ? `${r.added} new episode${r.added === 1 ? "" : "s"}.` : "No new episodes.") : r && !r.ok ? r.error : "Couldn't read the podcast.");
                      load();
                    }}
                  >
                    {busy === -s.id ? "Checking…" : "↻ Check for new episodes"}
                  </button>
                </div>
              ))}
              {desk.sources.length ? <AddByHand sources={desk.sources} onDone={after} play={play} /> : null}
              {desk.sources.length ? null : <p className="ns-empty">No episodes yet. Tap “Check for new episodes”.</p>}
              {desk.sources.map((src) => {
                const working = src.status === "transcribing" || src.status === "finding" || busy === src.id;
                return (
                  <div key={src.id} className="ns-ep">
                    <button type="button" className="ns-ep-play" aria-label={`Listen to ${src.title}`} onClick={() => setPlay((p) => ({ id: src.id, turn: (p?.turn ?? 0) + 1 }))}>
                      ▶
                    </button>
                    <div className="ns-ep-mid">
                      {src.title}
                      <small>
                        {dateOf(src.publishedAt)}
                        {src.durationSec ? ` · ${Math.round(src.durationSec / 60)} min` : ""}
                        {src.found ? ` · ${src.found} found` : ""}
                        {src.status === "transcribing" ? " · listening to it (a few minutes)…" : ""}
                        {src.status === "finding" ? " · finding moments…" : ""}
                        {src.status === "failed" && src.error ? ` · ${src.error}` : ""}
                      </small>
                    </div>
                    <button
                      type="button"
                      className={src.found && !working ? "is-done" : ""}
                      disabled={working}
                      onClick={async () => {
                        setBusy(src.id);
                        setNote("");
                        const r = await findNuggetMoments({ data: { sourceId: src.id } }).catch(() => null);
                        setBusy(0);
                        if (r?.ok) setNote(r.waiting ? "Transcribing it first; the moments will appear in Suggestions in a few minutes." : `${r.found} moment${r.found === 1 ? "" : "s"} found: see Suggestions.`);
                        else setNote(r && !r.ok ? r.error : "Couldn't find moments.");
                        load();
                      }}
                    >
                      {working ? "Working…" : src.found ? "Find more" : "Find moments"}
                    </button>
                  </div>
                );
              })}
              {!desk.canTranscribe ? <GroqKey saved={false} onDone={load} /> : null}
            </>
          ) : null}

          {desk && tab === "library" ? (
            <>
              {library.length ? null : <p className="ns-empty">No approved nuggets yet.</p>}
              {library.map((n) => (
                <NuggetCard key={`${n.id}-${n.startSec}-${n.endSec}-${n.title}-${n.url}`} n={n} onDone={after} preview={preview} />
              ))}
            </>
          ) : null}

          {desk && tab === "speakers" ? (
            <>
              {desk.speakers.map((s) => (
                <SpeakerCard key={s.id} s={s} onDone={load} />
              ))}
              <GroqKey saved={desk.canTranscribe} onDone={load} />
              <p className="ns-sec-in">Add a speaker</p>
              <SpeakerCard s={null} onDone={load} />
            </>
          ) : null}

          {desk && tab === "breaks" ? <Breaks settings={desk.settings} onDone={after} /> : null}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button type="button" className="cr-enter ns-enter" onClick={() => setOpen(true)}>
        ✨ Nuggets · station breaks
      </button>
      {open && typeof document !== "undefined" ? createPortal(sheet, document.body) : null}
    </>
  );
}

function Breaks({ settings, onDone }: { settings: Desk["settings"]; onDone: () => void }) {
  const [on, setOn] = useState(settings.breaksOn);
  const [every, setEvery] = useState(settings.every);
  const [live, setLive] = useState(settings.live);
  const [note, setNote] = useState("");
  const save = async (next: { breaksOn: boolean; every: number; live: boolean }) => {
    setNote("");
    const r = await saveNuggetSettings({ data: next }).catch(() => null);
    setNote(r?.ok ? "Saved." : "Couldn't save. Check your data.");
    onDone();
  };
  return (
    <div className="ns-card">
      <label className="ns-check">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            void save({ breaksOn: e.target.checked, every, live });
          }}
        />{" "}
        Play nuggets between Radio items
      </label>
      <div className="ns-time">
        <span>A nugget after every</span>
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
          <button type="button" className="ns-ok ns-small" onClick={() => void save({ breaksOn: on, every, live })}>
            Save
          </button>
        ) : null}
      </div>
      <label className="ns-check">
        <input
          type="checkbox"
          checked={live}
          onChange={(e) => {
            setLive(e.target.checked);
            void save({ breaksOn: on, every, live: e.target.checked });
          }}
        />{" "}
        On the Radio for everyone {live ? "" : "(off: try one first with Play now in Library)"}
      </label>
      {note ? <p className="ns-note">{note}</p> : null}
    </div>
  );
}

/** The Groq key: Groq turns a sermon into text (about 4 US cents an hour) so the AI can pick its moments. */
function GroqKey({ saved, onDone }: { saved: boolean; onDone: () => void }) {
  const [key, setKey] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="ns-card">
      <p className="ns-sec-in">Groq key {saved ? "· ✓ saved" : ""}</p>
      <p className="ns-src">
        Groq turns each sermon into text (about 4 US cents an hour of sermon), so the AI can find the strongest moments. Make a key at console.groq.com → API Keys, then paste it here.
      </p>
      <input className="ns-tags" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={saved ? "Paste a new key to replace it" : "gsk_…"} />
      {note ? <p className="ns-err">{note}</p> : null}
      <div className="ns-acts">
        <button
          type="button"
          className="ns-ok"
          disabled={busy || !key.trim()}
          onClick={async () => {
            setBusy(true);
            setNote("");
            const r = await saveGroqKey({ data: { key: key.trim() } }).catch(() => null);
            setBusy(false);
            if (r?.ok) {
              setKey("");
              setNote("Saved.");
              onDone();
            } else setNote(r && !r.ok ? r.error : "Couldn't save it. Check your data.");
          }}
        >
          {busy ? "Checking…" : "Save key"}
        </button>
      </div>
    </div>
  );
}

/** For an approved nugget: play it on the Radio now or next, and whether the automatic breaks use it. */
function OnAirControls({ n, onDone }: { n: Nugget; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function play(when: "now" | "next") {
    setBusy(true);
    setNote("");
    const playing = peekOnAir();
    const inSec = when === "next" && playing ? Math.max(15, Math.round((playing.endsAtMs - fmNow()) / 1000)) : 15;
    const r = await playFmNow({ data: { trackId: NUGGET_ID_BASE + n.id, inSec } }).catch(() => null);
    setBusy(false);
    if (r?.ok) {
      setNote(when === "now" ? "It plays for everyone in about 15 seconds." : `It plays when the current item ends (in about ${Math.max(1, Math.round(inSec / 60))} min).`);
      void refreshStation();
    } else setNote(r && !r.ok && "error" in r ? String(r.error) : "Couldn't play it. Check your data.");
  }
  return (
    <div className="ns-air">
      <div className="ns-acts">
        <button type="button" className="ns-ok" disabled={busy} onClick={() => void play("now")}>
          ▶ Play now
        </button>
        <button type="button" className="ns-ed" disabled={busy} onClick={() => void play("next")}>
          ⏭ Play next
        </button>
      </div>
      <label className="ns-check">
        <input
          type="checkbox"
          checked={n.inBreaks}
          onChange={async (e) => {
            const on = e.target.checked;
            const r = await setNuggetInBreaks({ data: { id: n.id, on } }).catch(() => null);
            if (r?.ok) {
              onDone();
              void refreshStation();
            } else setNote("Couldn't change it. Check your data.");
          }}
        />{" "}
        In the automatic breaks {n.inBreaks ? "" : "(plays only when you choose it)"}
      </label>
      {note ? <p className="ns-note ns-note-in">{note}</p> : null}
    </div>
  );
}
