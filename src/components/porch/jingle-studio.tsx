import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { jingleDesk, jingleDraft, makeJingle, type JingleDraft, type JingleVoice } from "@/lib/porch/jingle-maker";
import { saveFmTrack } from "@/lib/porch/fm";

/** Studio → Jingle maker: type the words, pick a voice and music, hear it, save it to the Radio's jingles. */
type Desk = Extract<Awaited<ReturnType<typeof jingleDesk>>, { ok: true }>;
const STYLE_NAMES: Record<string, string> = {
  cheerful: "Cheerful",
  excited: "Excited",
  friendly: "Friendly",
  hopeful: "Hopeful",
  newscast: "Newsreader",
  advertisement_upbeat: "Upbeat advert",
  calm: "Calm",
  gentle: "Gentle",
  warm: "Warm",
  "narration-relaxed": "Relaxed",
  whispering: "Whisper",
  shouting: "Shout",
};
const LEVELS = [
  { v: 0.15, label: "Soft" },
  { v: 0.25, label: "Medium" },
  { v: 0.4, label: "Loud" },
];

function Maker({ desk, onDone }: { desk: Desk; onDone: () => void }) {
  const [words, setWords] = useState("");
  const [voice, setVoice] = useState(desk.voices[0]?.name ?? "");
  const [style, setStyle] = useState("");
  const [music, setMusic] = useState<"none" | "last" | "upload">(desk.lastBed ? "last" : "none");
  const [file, setFile] = useState<File | null>(null);
  const [level, setLevel] = useState(0.25);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<JingleDraft | null>(null);
  const [title, setTitle] = useState("");
  const timer = useRef(0);
  const chosen: JingleVoice | undefined = desk.voices.find((v) => v.name === voice);
  useEffect(() => () => window.clearInterval(timer.current), []);
  useEffect(() => {
    if (style && !chosen?.styles.includes(style)) setStyle("");
  }, [voice]); // eslint-disable-line react-hooks/exhaustive-deps

  async function make() {
    setNote("");
    setDraft(null);
    setBusy("make");
    try {
      let bedUrl = "";
      if (music === "last") bedUrl = desk.lastBed;
      if (music === "upload") {
        if (!file) throw new Error("Choose the music file first.");
        setNote("Uploading the music…");
        const { uploadFile } = await import("@/lib/porch/upload-file");
        const safe = file.name.replace(/[^a-z0-9._-]+/gi, "-").slice(-60) || "bed.mp3";
        bedUrl = await uploadFile(`jingles/bed-${safe}`, file, { handleUploadUrl: "/api/fm-upload", contentType: file.type || "audio/mpeg" });
      }
      setNote(bedUrl ? "The voice is reading… then the music is mixed in (up to a minute)." : "The voice is reading…");
      const made = await makeJingle({ data: { words, voice, style, bedUrl, bedLevel: level } });
      if (!made.ok) throw new Error(made.error);
      const poll = async () => {
        const r = await jingleDraft({ data: { id: made.id } }).catch(() => null);
        if (!r?.ok) return;
        if (r.draft.status === "making" || r.draft.status === "mixing") return;
        window.clearInterval(timer.current);
        setBusy("");
        setDraft(r.draft);
        setNote(r.draft.status === "ready" ? "" : r.draft.error);
        if (r.draft.status === "ready") setTitle(words.slice(0, 60));
        onDone();
      };
      window.clearInterval(timer.current);
      timer.current = window.setInterval(() => void poll(), 3000);
      await poll();
    } catch (error) {
      window.clearInterval(timer.current);
      setBusy("");
      setNote(error instanceof Error ? error.message : "That didn't work. Try again.");
    }
  }
  async function save() {
    if (!draft?.url) return;
    setBusy("save");
    const r = await saveFmTrack({ data: { title: title.trim() || "Jingle", kind: "jingle", url: draft.url, durationSec: draft.durationSec } }).catch(() => null);
    setBusy("");
    if (r?.ok) {
      setNote("✅ Saved. It's now one of the Radio's jingles.");
      setDraft(null);
      setWords("");
    } else setNote(r && !r.ok ? r.error : "Couldn't save it. Try again.");
  }

  const accents = [...new Set(desk.voices.map((v) => v.accent))];
  return (
    <div className="ns-card">
      <p className="ns-sec-in">Make a jingle</p>
      <textarea
        className="ns-tags"
        rows={3}
        maxLength={400}
        placeholder="You're tuned in to Porchbook Radio, faith on the porch!"
        value={words}
        onChange={(e) => setWords(e.target.value)}
      />
      <select className="ns-tags" value={voice} onChange={(e) => setVoice(e.target.value)} aria-label="Voice">
        {accents.map((a) => (
          <optgroup key={a} label={a}>
            {desk.voices
              .filter((v) => v.accent === a)
              .map((v) => (
                <option key={v.name} value={v.name}>
                  {v.label} · {v.gender === "Female" ? "woman" : "man"}
                  {v.styles.length ? " · can sound cheerful" : ""}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {chosen?.styles.length ? (
        <select className="ns-tags" value={style} onChange={(e) => setStyle(e.target.value)} aria-label="How it sounds">
          <option value="">Normal</option>
          {chosen.styles.map((s) => (
            <option key={s} value={s}>
              {STYLE_NAMES[s] ?? s}
            </option>
          ))}
        </select>
      ) : null}
      <p className="ns-sec-in">Music under it</p>
      <div className="jm-pills">
        {desk.lastBed ? (
          <button type="button" className={music === "last" ? "is-on" : ""} onClick={() => setMusic("last")}>
            Last music
          </button>
        ) : null}
        <button type="button" className={music === "upload" ? "is-on" : ""} onClick={() => setMusic("upload")}>
          Upload music
        </button>
        <button type="button" className={music === "none" ? "is-on" : ""} onClick={() => setMusic("none")}>
          No music
        </button>
      </div>
      {music === "upload" ? <input type="file" accept="audio/*" className="ns-tags" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /> : null}
      {music !== "none" ? (
        <div className="jm-pills">
          {LEVELS.map((l) => (
            <button key={l.v} type="button" className={level === l.v ? "is-on" : ""} onClick={() => setLevel(l.v)}>
              Music {l.label.toLowerCase()}
            </button>
          ))}
        </div>
      ) : null}
      <div className="ns-acts">
        <button type="button" className="ns-ok" disabled={Boolean(busy) || words.trim().length < 3 || !voice} onClick={() => void make()}>
          {busy === "make" ? "Making…" : "🎙 Make it"}
        </button>
      </div>
      {note ? <p className={draft?.status === "failed" ? "ns-err" : "ns-src"}>{note}</p> : null}
      {draft?.status === "ready" && draft.url ? (
        <div className="ns-air">
          <audio controls src={draft.url} style={{ width: "100%" }} autoPlay />
          <input className="ns-tags" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Jingle name" maxLength={120} />
          <div className="ns-acts">
            <button type="button" className="ns-ok" disabled={busy === "save"} onClick={() => void save()}>
              {busy === "save" ? "Saving…" : "Save as jingle"}
            </button>
            <button type="button" className="ns-dr" disabled={Boolean(busy)} onClick={() => void make()}>
              Make again
            </button>
          </div>
          <p className="ns-src">Not right? Change the words, voice or music, then Make again.</p>
        </div>
      ) : null}
    </div>
  );
}

export function JingleStudio() {
  const [open, setOpen] = useState(false);
  const [desk, setDesk] = useState<Desk | null>(null);
  const load = useCallback(() => {
    void jingleDesk()
      .then((r) => r.ok && setDesk(r))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (open) load();
  }, [open, load]);
  const sheet = (
    <div className="ns-shade">
      <div className="ns-sheet" role="dialog" aria-label="Jingle maker">
        <div className="ns-head">
          <div>
            <p>STUDIO</p>
            <h2>Jingle maker</h2>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="ns-body">
          {!desk ? <p className="ns-empty">Loading…</p> : null}
          {desk && !desk.voices.length ? <p className="ns-note">{desk.problem || "No voices yet."}</p> : null}
          {desk && desk.voices.length ? <Maker desk={desk} onDone={load} /> : null}
        </div>
      </div>
    </div>
  );
  return (
    <>
      <button type="button" className="cr-enter ns-enter" onClick={() => setOpen(true)}>
        🎙 Jingle maker · type it, hear it, put it on air
      </button>
      {open && typeof document !== "undefined" ? createPortal(sheet, document.body) : null}
    </>
  );
}
