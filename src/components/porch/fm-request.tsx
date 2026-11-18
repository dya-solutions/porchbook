import { useBackLayer } from "@/lib/porch/back-stack";
import { W, WHint, useWord } from "@/components/porch/words";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { dedicationLine, listFmRequests, missFmRequest, myFmRequests, playFmNow, radioPeople, requestHistoryPdf, sendFmRequest, type FmRequest } from "@/lib/porch/fm";
import { hearAgain, stopAgain } from "@/components/porch/radio-news";
import { refreshStation, useFm } from "@/lib/porch/fm-player";
import { isVideoFile } from "@/lib/porch/fm-schedule";

/**
 * Radio requests. A listener asks for a song or a sermon, with an optional message for the radio
 * screen. The studio plays it (the message then shows on every radio while it plays) or can't find it.
 */

function when(iso: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function savePdf(pdf: string, filename: string) {
  const host = window as Window & { PorchApp?: { saveFile?: (name: string, data: string) => void } };
  if (typeof host.PorchApp?.saveFile === "function") {
    host.PorchApp.saveFile(filename, pdf);
    return;
  }
  const binary = atob(pdf);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

function ago(iso: string) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${Math.max(1, min)} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function statusLabel(status: FmRequest["status"]) {
  return status === "played" ? "Played ✓" : status === "missing" ? "Can't find it" : "Waiting";
}

/** The listener's side: the request form and their own requests. */
export function RequestPanel({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<"song" | "sermon">("song");
  const [title, setTitle] = useState("");
  const [by, setBy] = useState("");
  const [message, setMessage] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [toUser, setToUser] = useState<{ id: string; name: string } | null>(null);
  const [people, setPeople] = useState<{ id: string; name: string; imageUrl: string | null }[] | null>(null);
  const [toOpen, setToOpen] = useState(false);
  const [againId, setAgainId] = useState(0);
  useEffect(() => () => stopAgain(), []);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [mine, setMine] = useState<FmRequest[]>([]);
  useBackLayer(true, onClose, "radio:request");
  const hSong = useWord("request.song-hint", "Song title");
  const hArtist = useWord("request.artist-hint", "Artist");
  const hTopic = useWord("request.topic-hint", "Title or topic");
  const hPreacher = useWord("request.preacher-hint", "Preacher");
  const hMessage = useWord("request.message-hint", "Happy birthday, I love you");
  const hFrom = useWord("request.from-hint", "From (your name)");
  const hTo = useWord("request.to-hint", "To (who it's for)");
  const sentNote = useWord("request.sent", "Sent. You'll see here when it's played.");

  function loadMine() {
    myFmRequests()
      .then((result) => {
        setMine(result.requests);
        if (result.name) setFrom((current) => current || result.name);
      })
      .catch(() => undefined);
  }
  useEffect(loadMine, []);

  // Keep the sheet above the phone's keyboard.
  const [lift, setLift] = useState(0);
  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    const fit = () => setLift(Math.max(0, window.innerHeight - view.height - view.offsetTop));
    fit();
    view.addEventListener("resize", fit);
    view.addEventListener("scroll", fit);
    return () => {
      view.removeEventListener("resize", fit);
      view.removeEventListener("scroll", fit);
    };
  }, []);

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNote("");
    const result = await sendFmRequest({ data: { kind, title, by, message, from, to, toUserId: toUser?.id ?? "" } }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't go through. Try again.");
      return;
    }
    setTitle("");
    setBy("");
    setMessage("");
    setTo("");
    setToUser(null);
    setNote(sentNote);
    loadMine();
  }

  return (
    createPortal(
    <>
    <div className="fm-req-shade" onClick={onClose} aria-hidden="true" />
    <form className="fm-req fm-req-sheet" style={{ bottom: lift }} onSubmit={(event) => void send(event)}>
      <div className="fm-req-head">
        <span><W k="request.title">REQUEST</W></span>
        <button type="button" onClick={onClose} aria-label="Close requests">
          ✕
        </button>
      </div>
      <div className="fm-req-seg" role="tablist">
        <button type="button" className={kind === "song" ? "is-on" : ""} onClick={() => setKind("song")}>
          <W k="request.song">Song</W>
        </button>
        <button type="button" className={kind === "sermon" ? "is-on" : ""} onClick={() => setKind("sermon")}>
          <W k="request.sermon">Sermon</W>
        </button>
      </div>
      <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder={kind === "song" ? hSong : hTopic} />
      <input value={by} onChange={(event) => setBy(event.target.value)} maxLength={80} placeholder={kind === "song" ? hArtist : hPreacher} />
      <WHint k="request.song-hint">Song title</WHint>
      <WHint k="request.artist-hint">Artist</WHint>
      <WHint k="request.topic-hint">Title or topic</WHint>
      <WHint k="request.preacher-hint">Preacher</WHint>
      <label><W k="request.dedication">Dedication (optional)</W></label>
      <div className="fm-req-pair">
        <input value={from} onChange={(event) => setFrom(event.target.value)} maxLength={40} placeholder={hFrom} aria-label="From" />
        <input
          value={to}
          onChange={(event) => {
            setTo(event.target.value);
            setToUser(null);
            setToOpen(true);
          }}
          onFocus={() => {
            setToOpen(true);
            if (!people) {
              radioPeople()
                .then((result) => setPeople(result.people))
                .catch(() => setPeople([]));
            }
          }}
          onBlur={() => window.setTimeout(() => setToOpen(false), 200)}
          maxLength={40}
          placeholder={hTo}
          aria-label="To"
        />
      </div>
      {toOpen && to.trim().length >= 2 && !toUser ? (
        <div className="fm-req-people">
          {(people ?? [])
            .filter((person) => person.name.toLowerCase().includes(to.trim().toLowerCase()))
            .slice(0, 5)
            .map((person) => (
              <button
                key={person.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setToUser({ id: person.id, name: person.name });
                  setTo(person.name.trim().split(/\s+/)[0] ?? person.name);
                  setToOpen(false);
                }}
              >
                {person.name}
              </button>
            ))}
        </div>
      ) : null}
      {toUser ? <p className="fm-req-tagged">✓ {toUser.name} is on Porchbook: they'll get a “tune in” alert when it plays.</p> : null}
      <WHint k="request.from-hint">From (your name)</WHint>
      <WHint k="request.to-hint">To (who it's for)</WHint>
      <input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={80} placeholder={hMessage} aria-label="Message" />
      <WHint k="request.message-hint">Happy birthday, I love you</WHint>
      {to.trim() || message.trim() ? (
        <p className="fm-req-preview">🎵 {dedicationLine(from.trim(), to.trim(), message.trim())}</p>
      ) : null}
      <button type="submit" className="fm-req-send" disabled={busy || !title.trim()}>
        {busy ? "Sending…" : <W k="request.send">Send request</W>}
      </button>
      {note ? <p className="fm-req-note">{note}</p> : null}
      {mine.length ? (
        <ul className="fm-req-mine">
          <li className="fm-req-mine-head"><W k="request.mine">Your requests</W></li>
          {mine.map((item) => (
            <li key={item.id} className={item.playedAt ? "is-played" : ""}>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.title}</span>
                {item.playedAt ? (
                  <small className="fm-req-heard">
                    {when(item.playedAt)} · {item.heard ?? 0} {item.heard === 1 ? "listener" : "listeners"} heard it
                  </small>
                ) : null}
              </span>
              {item.playedAt && item.url ? (
                <button
                  type="button"
                  className="fm-req-again"
                  onClick={() => {
                    if (againId === item.id) {
                      stopAgain();
                      setAgainId(0);
                    } else {
                      setAgainId(item.id);
                      hearAgain(item.url ?? "", () => setAgainId(0));
                    }
                  }}
                >
                  {againId === item.id ? "■" : "▶ Again"}
                </button>
              ) : null}
              <span className={`fm-req-status is-${item.status}`}>
                <W k={`request.status-${item.status}`}>{statusLabel(item.status)}</W>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
    </>,
    document.body,
    )
  );
}

/** The message riding on the "Play now" that's on air, if any. */
export function useOnAirMessage(breakId: number | undefined) {
  const fm = useFm();
  if (!breakId) return "";
  return fm.breaks.find((item) => item.id === breakId)?.message ?? "";
}

/** The studio's side: everyone's requests, with Play it now and Can't find it. */
export function StudioRequests() {
  const fm = useFm();
  const [requests, setRequests] = useState<FmRequest[]>([]);
  const [founder, setFounder] = useState(false);
  const [month, setMonth] = useState(() => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 7));
  const [making, setMaking] = useState(false);
  const [picking, setPicking] = useState<FmRequest | null>(null);
  const [query, setQuery] = useState("");
  const [withMessage, setWithMessage] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [showDone, setShowDone] = useState(false);

  function load() {
    listFmRequests()
      .then((result) => {
        setRequests(result.requests);
        setFounder(Boolean(result.founder));
      })
      .catch(() => undefined);
  }
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, []);

  // Everything that can go on air (newest uploads first), including ones still being prepared.
  const candidates = fm.tracks
    .filter((track) => !["jingle", "station", "newsintro"].includes(track.kind))
    .slice()
    .sort((a, b) => b.id - a.id);
  // Match by words, not letter for letter: "THE BLESSING OF DIVINE LEADERSHIP." finds
  // "The Blessing of Divine Leadership - Pr Masasi".
  const words = (text: string) =>
    text
      .toLowerCase()
      .replace(/\.[a-z0-9]{2,4}$/, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(" ")
      .filter((word) => word.length > 2 && !["the", "and", "for", "with", "from"].includes(word));
  const needle = words(query);
  const scored = useMemo(() => {
    if (!needle.length) return candidates.map((track) => ({ track, score: 0 }));
    return candidates
      .map((track) => {
        const have = new Set(words(track.title));
        const score = needle.filter((word) => have.has(word) || [...have].some((h) => h.startsWith(word) || word.startsWith(h))).length / needle.length;
        return { track, score };
      })
      .filter((item) => item.score >= 0.5)
      .sort((a, b) => b.score - a.score || b.track.id - a.track.id);
  }, [candidates, needle.join(" ")]); // eslint-disable-line react-hooks/exhaustive-deps
  const matches = scored.slice(0, 12).map((item) => item.track);
  // Nothing matches the words: show the newest uploads, so a file named differently can still be picked.
  const newest = matches.length ? [] : candidates.slice(0, 8);

  function startPick(request: FmRequest) {
    // The library as it is now (a file uploaded a moment ago included).
    void refreshStation().catch(() => undefined);
    setPicking(request);
    setQuery(request.title);
    setWithMessage(true);
    setNote("");
  }

  async function play(trackId: number, trackTitle: string) {
    if (!picking) return;
    const line = dedicationLine(picking.from, picking.to, picking.message);
    const shown = withMessage && line ? `\n\nOn every radio screen: "${line}"` : "";
    if (!window.confirm(`Play "${trackTitle}" for everyone now (in about 15 seconds)?${shown}`)) return;
    setBusy(true);
    const result = await playFmNow({ data: { trackId, requestId: picking.id, withMessage } }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't go through. Try again.");
      return;
    }
    setPicking(null);
    setNote("");
    load();
    await refreshStation();
  }

  async function miss(request: FmRequest) {
    const result = await missFmRequest({ data: { id: request.id } }).catch(() => null);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't go through. Try again.");
      return;
    }
    load();
  }

  const waiting = requests.filter((item) => item.status === "waiting");
  const done = requests.filter((item) => item.status !== "waiting");

  return (
    <section className="fm-reqs">
      <h3>Requests{waiting.length ? ` · ${waiting.length} waiting` : ""}</h3>
      {founder ? (
        // The founder's own record of every request, month by month.
        <div className="fm-reqs-history is-top">
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} aria-label="Month" />
          <button
            type="button"
            disabled={making}
            onClick={() => {
              setMaking(true);
              requestHistoryPdf({ data: { month } })
                .then((result) => {
                  if (result.ok) savePdf(result.pdf, result.filename);
                  else setNote(result.error);
                })
                .catch(() => setNote("The PDF didn't come. Try again."))
                .finally(() => setMaking(false));
            }}
          >
            {making ? "Making…" : "📄 Request history (PDF)"}
          </button>
        </div>
      ) : null}

      {waiting.length === 0 ? <p className="fm-reqs-empty">No requests waiting.</p> : null}
      {waiting.map((item) => (
        <div key={item.id} className="fm-reqs-item">
          <b>{item.kind === "song" ? "Song" : "Sermon"}</b>
          <p>
            {item.title}
            {item.by ? ` — ${item.by}` : ""}
          </p>
          {item.message || item.to || item.from ? <p className="fm-reqs-msg">On screen: “{dedicationLine(item.from, item.to, item.message)}”</p> : null}
          <p className="fm-reqs-who">
            {item.name} · {when(item.createdAt)}
          </p>
          {item.presence ? (
            <p className={`fm-reqs-here is-${item.presence}`}>
              {item.presence === "listening" ? "● Listening now: a good moment to play it" : item.presence === "online" ? "● Online now" : `○ ${item.seenAt ? `Last seen ${ago(item.seenAt)}` : "Not seen yet"}`}
            </p>
          ) : null}
          {picking?.id === item.id ? (
            <div className="fm-reqs-pick">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find it in the library" />
              {item.message || item.to || item.from ? (
                <label className="fm-reqs-check">
                  <input type="checkbox" checked={!withMessage} onChange={(event) => setWithMessage(!event.target.checked)} />
                  Play without the dedication
                </label>
              ) : null}
              {matches.length === 0 ? (
                <p className="fm-reqs-empty">{newest.length ? "No title matches those words. Your newest uploads:" : "Not in the library. Upload it above, or tap Can't find it."}</p>
              ) : null}
              {[...matches, ...newest].map((track) => {
                const preparing = Boolean(track.processing) || isVideoFile(track.url);
                return (
                  <button key={track.id} type="button" disabled={busy || preparing} onClick={() => void play(track.id, track.title)}>
                    {preparing ? "⏳ " : "▶ "}
                    {track.title}
                    {preparing ? " · still being prepared, try again in a minute" : ""}
                  </button>
                );
              })}
              <button type="button" className="fm-reqs-cancel" onClick={() => setPicking(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="fm-reqs-acts">
              <button type="button" className="is-play" onClick={() => startPick(item)}>
                ▶ Play it now
              </button>
              <button type="button" onClick={() => void miss(item)}>
                Can't find it
              </button>
            </div>
          )}
        </div>
      ))}
      {done.length ? (
        <>
          <button type="button" className="fm-reqs-done fm-reqs-fold" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
            Done ({done.length}) {showDone ? "▾" : "▸"}
          </button>
          {(showDone ? done : []).map((item) => (
            <div key={item.id} className="fm-reqs-item is-done">
              <p>
                {item.title}
                {item.by ? ` — ${item.by}` : ""} · {item.name}
              </p>
              <p className={`fm-req-status is-${item.status}`}>{statusLabel(item.status)}</p>
            </div>
          ))}
        </>
      ) : null}
      {note ? <p className="fm-req-note">{note}</p> : null}
    </section>
  );
}
