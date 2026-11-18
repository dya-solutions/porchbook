import { SavedNuggets } from "@/components/porch/nugget-bits";
import { NuggetStudio } from "@/components/porch/nugget-studio";
import { getRadioUsage } from "@/lib/porch/credit-watch";
import { radioStorage } from "@/lib/porch/radio-storage";
import { JingleStudio } from "@/components/porch/jingle-studio";
import { storageInfo, saveStorageKeys, moveStep, finishMove } from "@/lib/porch/storage-settings";
import { BibleStudio } from "@/components/porch/bible-studio";
import { Link } from "@tanstack/react-router";
import { W, WHint, useWord } from "@/components/porch/words";
import { StudioRequests } from "@/components/porch/fm-request";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { createPortal } from "react-dom";
import fmArt from "@/assets/fm-key.jpg";
import { Play, Radio, X } from "lucide-react";
import { playButtonSound } from "@/lib/porch/button-sound-play";
import { fieldClass, quietButtonClass } from "@/components/porch/bits";
import { TourSlot, toggleTourMode, useTourMode } from "@/lib/porch/tour-mode";
import { dropFmProgramme, dropFmTrack, getFmListeners, listenersPdf, setFmPlayLength, setFmTrackKind, setFmTrackStrings, setLiveVideo, checkLiveNow, processFmAudio, playFmNow, stopFmBreak, saveFmProgramme, saveFmTrack } from "@/lib/porch/fm";
import { DAY_NAMES, breakLengthSec, clockLabel, isJingle, isNewsIntro, isStationId, isVideoFile, type FmProgramme } from "@/lib/porch/fm-schedule";
import { audibleEndOfUrl, audibleEndSec } from "@/lib/porch/fm-trim";
import { fmNow, holdRadio, loadStation, refreshStation, releaseRadio, tuneIn, tuneOut, useFm } from "@/lib/porch/fm-player";
import { hangUp, useLine } from "@/lib/porch/line-call";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { DevotionVoiceBox } from "@/components/porch/devotion-voice-box";
import { RadioFace, useRadioReminder } from "@/components/porch/fm-face";
import { CallBar, useCallMinimized, useCallPreview, useGlassCalls } from "@/components/porch/call-card";

const KIND_LABEL: Record<string, string> = { music: "Music", preaching: "Preaching", news: "News", reading: "Reading", other: "Other", jingle: "Jingle", station: "Station ID", newsintro: "News intro" };

function minutesOf(value: string) {
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return -1;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : -1;
}

function lengthLabel(sec: number) {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/** A server call that never answers must not leave the Studio stuck. */
function withTimeout<T>(work: Promise<T>, ms = 30000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), ms);
    work.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function audioLength(file: File) {
  return new Promise<number>((resolve) => {
    const url = URL.createObjectURL(file);
    const probe: HTMLMediaElement = file.type.startsWith("video/") ? document.createElement("video") : new Audio();
    probe.preload = "metadata";
    const finish = (value: number) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    probe.addEventListener("loadedmetadata", () => finish(Number.isFinite(probe.duration) ? probe.duration : 0), { once: true });
    probe.addEventListener("error", () => finish(0), { once: true });
    window.setTimeout(() => finish(0), 15000);
    probe.src = url;
  });
}

/** The station's tour key (replaces Worship). */
export function FmButton() {
  const mode = useTourMode();
  const open = mode === "worship";
  const fm = useFm();
  const [down, setDown] = useState(false);
  const live = fm.status === "on";
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        className={`tour-key fm-key no-sink${down || open ? " is-down" : ""}${live || fm.status === "tuning" ? " is-live" : ""}`}
        style={{ "--fm-art": `url(${fmArt})` } as CSSProperties}
        onPointerDown={() => {
          playButtonSound();
          setDown(true);
        }}
        onPointerUp={() => setDown(false)}
        onPointerLeave={() => setDown(false)}
        onPointerCancel={() => setDown(false)}
        onClick={() => {
          const opening = !open;
          toggleTourMode("worship");
          // Like switching on a radio: opening the station starts it.
          if (opening && fm.status === "off") void tuneIn();
        }}
      >
        <Radio className="size-4 text-[#7dff2a]" aria-hidden="true" />
        <span className="fm-label-long"><W k="tour.radio-long">Porchbook Radio</W>{live ? " ●" : ""}</span>
        <span className="fm-label-short"><W k="tour.radio">Radio</W>{live ? " ●" : ""}</span>
      </button>
      {open ? (
        <TourSlot>
          <FmSheet />
        </TourSlot>
      ) : null}
    </>
  );
}

function FmSheet() {
  const fm = useFm();
  useEffect(() => {
    void loadStation();
  }, []);
  const empty = fm.loaded && fm.tracks.length === 0;

  return (
    <div className="tour-sheet fm-sheet w-full pb-20">
      <LiveService />

      {empty ? (
        <div className="rounded-2xl bg-black p-4">
          <p className="text-sm text-muted">Porchbook Radio is coming soon.</p>
          <button type="button" className={quietButtonClass} onClick={() => toggleTourMode("worship")}>
            Close
          </button>
        </div>
      ) : (
        <RadioFace onClose={() => toggleTourMode("worship")} />
      )}
      <SavedNuggets />

      {fm.studio ? <RadioUsage /> : null}
      {fm.studio ? <StudioRequests /> : null}
      {fm.studio ? <NuggetStudio /> : null}
      {fm.studio ? <BibleStudio /> : null}
      {fm.studio ? <JingleStudio /> : null}
      {fm.studio ? <Studio /> : null}
    </div>
  );
}

function Studio() {
  const fm = useFm();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileBox = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<FmProgramme | "new" | null>(null);

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (uploading) return;
    // Some phones don't report the chosen file to the page; read it from the box itself.
    const picked = file ?? fileBox.current?.files?.[0] ?? null;
    if (!picked) {
      setNote("Choose an audio or video file first (tap the orange Choose File).");
      return;
    }
    if (picked !== file) setFile(picked);
    const name = title.trim() || picked.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
    if (!name) {
      setNote("Give it a title.");
      return;
    }
    if (!kind) {
      setNote("Choose a type: Music, Preaching, News…");
      return;
    }
    setUploading(true);
    setNote("Reading the audio…");
    setProgress(0);
    try {
      const durationSec = await audioLength(picked);
      if (durationSec < 1) {
        setNote("Couldn't read that file. Try an MP3, M4A or MP4.");
        return;
      }
      setNote("Uploading…");
      const mode = (await fetch("/api/fm-upload").then((r) => r.json())) as { blob?: boolean };
      let url = "";
      if (mode.blob) {
        const { uploadFile } = await import("@/lib/porch/upload-file");
        let safe = picked.name.replace(/[^a-z0-9._-]+/gi, "-").slice(-80) || "audio";
        // Keep a video's ending (.mp4…) so Porchbook knows to take its sound out first.
        if (picked.type.startsWith("video/") && !/\.[a-z0-9]{2,4}$/i.test(safe)) safe += ".mp4";
        url = await uploadFile(`fm/${safe}`, picked, { handleUploadUrl: "/api/fm-upload", contentType: picked.type || "audio/mpeg", onProgress: setProgress });
      } else {
        const response = await fetch("/api/fm-upload", { method: "POST", headers: { "content-type": picked.type || "audio/mpeg" }, body: picked });
        const data = (await response.json()) as { url?: string; error?: string };
        if (!response.ok || !data.url) {
          setNote(data.error || "Upload failed. Try again.");
          return;
        }
        url = data.url;
      }
      const saved = await saveFmTrack({ data: { title: name, kind, url, durationSec } });
      if (!saved.ok) {
        setNote(saved.error);
        return;
      }
      // Jingles and station IDs stop where their sound ends (no quiet tail).
      const added = saved.tracks.find((t) => t.url === url);
      if (added && (isJingle(added) || isStationId(added) || isNewsIntro(added))) {
        const end = await audibleEndSec(await picked.arrayBuffer());
        if (end) await setFmPlayLength({ data: { id: added.id, playSec: end } });
      }
      setFile(null);
      if (fileBox.current) fileBox.current.value = "";
      setTitle("");
      setKind("");
      setNote(isVideoFile(url) ? "Added. Its sound is being taken out; it joins the radio when that's done." : `Added. It's now in the rotation.`);
      await refreshStation();
    } catch (error) {
      console.warn("Radio upload failed", error);
      setNote("Upload failed. Try again.");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  async function playNow(id: number, name: string) {
    if (!window.confirm(`Interrupt Porchbook Radio for everyone: the station ID, then "${name}"?`)) return;
    setBusy(true);
    let result: { ok: boolean; error?: string };
    try {
      result = await withTimeout(playFmNow({ data: { trackId: id } }));
    } catch {
      result = { ok: false, error: "That didn't go through. Check your connection and try again." };
    } finally {
      setBusy(false);
    }
    if (!result.ok) {
      setNote(result.error ?? "That didn't go through.");
      return;
    }
    setNote(""); // the Interruptions box above shows the countdown
    await refreshStation();
  }

  // Videos: send any whose sound hasn't been taken out yet (audio plays as uploaded),
  // and keep the list fresh while that's going on.
  useEffect(() => {
    if (!open) return;
    void processFmAudio()
      .then((result) => {
        if (result.ok && result.sent) void refreshStation();
      })
      .catch(() => undefined);
  }, [open]);
  const anyProcessing = fm.tracks.some((t) => t.processing);
  useEffect(() => {
    if (!open || !anyProcessing) return;
    const timer = window.setInterval(() => void refreshStation(), 30000);
    return () => window.clearInterval(timer);
  }, [open, anyProcessing]);

  // Trim existing jingles and station IDs that haven't been measured yet.
  useEffect(() => {
    if (!open) return;
    const todo = fm.tracks.filter((t) => !t.trimmed && (isJingle(t) || isStationId(t) || isNewsIntro(t)));
    if (!todo.length) return;
    let cancel = false;
    void (async () => {
      let changed = false;
      for (const t of todo) {
        const end = await audibleEndOfUrl(new URL(t.url, window.location.origin).href);
        if (cancel) return;
        if (end) {
          const result = await setFmPlayLength({ data: { id: t.id, playSec: end } });
          changed = changed || result.ok;
        }
      }
      if (changed && !cancel) await refreshStation();
    })();
    return () => {
      cancel = true;
    };
  }, [open, fm.tracks]);

  async function changeKind(id: number, next: string) {
    setBusy(true);
    let result: { ok: boolean; error?: string };
    try {
      result = await withTimeout(setFmTrackKind({ data: { id, kind: next } }));
    } catch {
      result = { ok: false, error: "That didn't go through. Check your connection and try again." };
    } finally {
      setBusy(false);
    }
    if (!result.ok) setNote(result.error ?? "That didn't go through.");
    await refreshStation();
  }

  async function toggleStrings(id: number, on: boolean) {
    setBusy(true);
    let result: { ok: boolean; error?: string };
    try {
      result = await withTimeout(setFmTrackStrings({ data: { id, on } }));
    } catch {
      result = { ok: false, error: "That didn't go through. Check your connection and try again." };
    } finally {
      setBusy(false);
    }
    if (!result.ok) setNote(result.error ?? "That didn't go through.");
    else setNote(on ? "Strings will play softly under it (from the next time it plays)." : "");
    await refreshStation();
  }

  async function removeTrack(id: number) {
    if (!window.confirm("Remove this audio from Porchbook Radio?")) return;
    setBusy(true);
    let result: { ok: boolean; error?: string };
    try {
      result = await withTimeout(dropFmTrack({ data: { id } }));
    } catch {
      result = { ok: false, error: "That didn't go through. Check your connection and try again." };
    } finally {
      setBusy(false);
    }
    if (!result.ok) setNote(result.error ?? "That didn't go through.");
    await refreshStation();
  }

  return (
    <div className="mt-4 border-t border-white/10 pt-3">
      <Link to="/control-room" className="cr-enter">🎛 Control Room · tell the radio what to do</Link>
      <button type="button" className={`${quietButtonClass} px-0`} onClick={() => setOpen((v) => !v)}>
        {open ? "Close studio" : "Studio"}
      </button>
      {open ? (
        <div className="mt-2 space-y-4">
          <form className="grid gap-2" onSubmit={(event) => void upload(event)}>
            <h3 className="text-sm font-bold text-ink">Add audio or video</h3>
            <p className="text-xs text-muted">A video's sound is taken out for the radio; the picture isn't kept.</p>
            <input
              ref={fileBox}
              type="file"
              accept="audio/*,video/*"
              className="text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-[#f8a018] file:px-3 file:py-1.5 file:font-bold file:!text-black"
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null;
                setFile(picked);
                if (picked && !title) setTitle(picked.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim());
              }}
            />
            <input className={fieldClass} placeholder="Title, e.g. Sunday sermon: Grace" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} />
            <select className={fieldClass} value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="" disabled>
                Choose a type…
              </option>
              {Object.entries(KIND_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button type="submit" className="min-h-11 rounded-full bg-[#f8a018] px-4 font-bold text-black disabled:opacity-50" disabled={uploading}>
              {uploading ? (progress ? `Uploading ${progress}%` : "Working…") : "Upload"}
            </button>
            {note ? <p className="text-sm text-muted">{note}</p> : null}
          </form>

          <Listeners />

          <BreaksNow />

          <LiveVideoForm />

          <DevotionVoiceBox />

          <div>
            <h3 className="text-sm font-bold text-ink">Audio ({fm.tracks.length})</h3>
            {fm.tracks.length ? null : <p className="text-sm text-muted">Nothing uploaded yet.</p>}
            <ul className="mt-1 space-y-1">
              {fm.tracks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{t.title}</span>
                    <span className="flex items-center gap-1 text-xs text-muted">
                      <select
                        aria-label={`Type of ${t.title}`}
                        className="rounded-md border border-white/15 bg-black/40 px-1.5 py-1 text-xs text-ink"
                        value={KIND_LABEL[t.kind] ? t.kind : "other"}
                        disabled={busy}
                        onChange={(event) => void changeKind(t.id, event.target.value)}
                      >
                        {Object.entries(KIND_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      · {lengthLabel(t.durationSec)}
                      {!isVideoFile(t.url) ? null : t.processing ? (
                        <span className="text-[#f8a018]"> · Taking out the sound…</span>
                      ) : t.processError ? (
                        <span className="text-[#ff6b5c]" title={t.processError}> · Sound not taken out yet</span>
                      ) : null}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center">
                    {t.kind === "preaching" || t.kind === "reading" || t.strings ? (
                      <button
                        type="button"
                        className={`${quietButtonClass}${t.strings ? " font-bold text-[#7ad14a]" : ""}`}
                        aria-pressed={Boolean(t.strings)}
                        title={t.strings ? "Strings play under this sermon. Tap to stop." : "Play the devotional's strings under this sermon"}
                        disabled={busy}
                        onClick={() => void toggleStrings(t.id, !t.strings)}
                      >
                        🎻{t.strings ? " On" : ""}
                      </button>
                    ) : null}
                    <button type="button" className={`${quietButtonClass} font-bold text-[#f8a018]`} disabled={busy || isVideoFile(t.url)} onClick={() => void playNow(t.id, t.title)}>
                      Play now
                    </button>
                    <button type="button" className={quietButtonClass} disabled={busy} onClick={() => void removeTrack(t.id)}>
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">Programmes</h3>
              <button type="button" className={quietButtonClass} disabled={!fm.tracks.length} onClick={() => setEditing("new")}>
                New
              </button>
            </div>
            {fm.programmes.length ? null : <p className="text-sm text-muted">No programmes yet. Everything plays in rotation.</p>}
            <ul className="mt-1 space-y-1">
              {fm.programmes.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <button type="button" className="min-w-0 truncate text-left text-ink underline-offset-2 hover:underline" onClick={() => setEditing(p)}>
                    {p.name}{" "}
                    <span className="text-muted">
                      · {p.days.length === 7 ? "Daily" : p.days.map((d) => DAY_NAMES[d]).join(" ")} · {clockLabel(p.startMin)}–{clockLabel(p.endMin)}
                      {p.shuffle ? " · Shuffle" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {editing ? <ProgrammeForm programme={editing === "new" ? null : editing} onDone={() => setEditing(null)} /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type LiveInfo = { live: boolean; videoId: string; source: string; label?: string; title?: string };

function useLiveService(refreshKey = 0) {
  const [info, setInfo] = useState<LiveInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/yt-live")
        .then((r) => r.json() as Promise<LiveInfo>)
        .then((next) => alive && setInfo(next))
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(() => void load(), 60000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [refreshKey]);
  return info;
}

function watchLink(videoId: string) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/** When Phaneroo is live on YouTube: an announcement with a link to join on YouTube. */
function LiveService() {
  const info = useLiveService();
  if (!info?.live || !info.videoId) return null;
  return (
    <div className="mt-3 rounded-xl border border-[#ff4d3d]/50 bg-[#ff4d3d]/10 p-3">
      <p className="text-xs font-bold tracking-[0.18em] text-[#ff6b5c]">● LIVE NOW</p>
      <p className="mt-1 text-base font-semibold text-white">{info.label || "Phaneroo is live now"}</p>
      {info.title ? <p className="mt-0.5 text-sm text-white/70">{info.title}</p> : null}
      <a
        href={watchLink(info.videoId)}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#ff4d3d] px-5 text-base font-bold text-white"
        onClick={() => tuneOut()}
      >
        <Play className="size-4" aria-hidden="true" />
        Join on YouTube
      </a>
    </div>
  );
}

/** Studio: paste a YouTube live link by hand, in case the automatic check misses it. */
function LiveVideoForm() {
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [label, setLabel] = useState<"auto" | "phaneroo" | "grace" | "custom">("auto");
  const [custom, setCustom] = useState("");
  const info = useLiveService(refresh);

  async function save(value: string, choice = label) {
    setBusy(true);
    const result = await setLiveVideo({ data: { link: value, label: choice, custom } });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setLink("");
    setNote(
      result.videoId
        ? `Showing to everyone: “${result.label}”${result.title ? ` · ${result.title}` : ""}. It clears by itself when the stream ends (or after 6 hours).`
        : "Cleared. Porchbook goes back to checking YouTube by itself.",
    );
    setRefresh((n) => n + 1);
  }

  return (
    <div>
      <h3 className="text-sm font-bold text-ink">Live on YouTube</h3>
      <p className="text-xs text-muted">
        {info?.live
          ? `Showing now: “${info.label ?? "Live now"}”${info.title ? ` · ${info.title}` : ""}`
          : "Paste any YouTube live link (Phaneroo, or Apostle Grace preaching anywhere). Thursday and Sunday services say “Phaneroo is live”; other times “Apostle Grace is live”."}
      </p>
      <form
        className="mt-1 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save(link);
        }}
      >
        <input className={fieldClass} placeholder="YouTube live link" value={link} onChange={(event) => setLink(event.target.value)} />
        <button type="submit" className={quietButtonClass} disabled={busy || !link.trim()}>
          Show
        </button>
      </form>
      <div className="live-label-pick" role="radiogroup" aria-label="What it says">
        {(
          [
            ["auto", "Automatic"],
            ["phaneroo", "Phaneroo service"],
            ["grace", "Apostle Grace"],
            ["custom", "Other…"],
          ] as const
        ).map(([value, text]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={label === value}
            className={label === value ? "is-on" : ""}
            disabled={busy}
            onClick={() => {
              setLabel(value);
              // Already showing one: change its words straight away.
              if (info?.source === "studio" && info.videoId && value !== "custom") void save(info.videoId, value);
            }}
          >
            {text}
          </button>
        ))}
      </div>
      {label === "custom" ? (
        <div className="mt-1 flex gap-2">
          <input className={fieldClass} placeholder="e.g. Pr. Masasi is live now" value={custom} maxLength={60} onChange={(event) => setCustom(event.target.value)} />
          {info?.source === "studio" && info.videoId ? (
            <button type="button" className={quietButtonClass} disabled={busy || !custom.trim()} onClick={() => void save(info.videoId, "custom")}>
              Use
            </button>
          ) : null}
        </div>
      ) : null}
      {info?.source === "studio" ? (
        <button type="button" className={`${quietButtonClass} px-0`} disabled={busy} onClick={() => void save("")}>
          Stop showing it
        </button>
      ) : null}
      <button
        type="button"
        className={`${quietButtonClass} px-0`}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setNote("Checking YouTube…");
          void checkLiveNow()
            .then((result) => setNote(result.report || "No answer."))
            .catch(() => setNote("The check failed."))
            .finally(() => setBusy(false));
        }}
      >
        Check YouTube now
      </button>
      {note ? <p className="break-words text-sm text-muted">{note}</p> : null}
    </div>
  );
}

/** Studio: a "Play now" that is waiting or on air, with a way to stop it. */
function BreaksNow() {
  const fm = useFm();
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const at = fmNow();
  // Uploaded audio, nuggets and Bible readings are all known here.
  const every = [...fm.tracks, ...fm.nuggets];
  const byId = new Map(every.map((t) => [t.id, t]));
  const live = fm.breaks
    .filter((b) => !b.hold)
    .map((b) => ({ b, track: byId.get(b.trackId) }))
    // On air now, or starting within the hour (Bible readings are planned hours ahead).
    .filter((x) => x.track && x.b.startsAtMs + (x.b.plain ? x.track.durationSec : breakLengthSec(x.track, fm.tracks, x.b.id)) * 1000 > at && x.b.startsAtMs < at + 3600_000);
  if (!live.length) return null;

  async function stop(id: number) {
    const result = await stopFmBreak({ data: { id } });
    if (result.ok) await refreshStation();
  }

  return (
    <div className="rounded-2xl border border-[#f8a018]/40 bg-[#f8a018]/10 p-3">
      <h3 className="text-sm font-bold text-ink">Interruptions</h3>
      <ul className="mt-1 space-y-1">
        {live.map(({ b, track }) => {
          const wait = Math.ceil((b.startsAtMs - at) / 1000);
          return (
            <li key={b.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-ink">
                {track!.kind === "bible" ? "📖 " : track!.kind === "nugget" ? "✨ " : ""}
                {track!.title}{" "}
                <span className="text-muted">
                  ·{" "}
                  {wait > 0
                    ? b.plain
                      ? `in ${wait >= 120 ? `${Math.round(wait / 60)} min` : `${wait}s`}`
                      : `jingle, then this, in ${wait >= 120 ? `${Math.round(wait / 60)} min` : `${wait}s`}`
                    : "on air now"}
                </span>
              </span>
              <button type="button" className={quietButtonClass} onClick={() => void stop(b.id)}>
                Stop
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type ListenerData = { now: number; daysOfData: number; hours: Record<"all" | "week" | "sat" | "sun", number[]> };
const LISTEN_GROUPS: [keyof ListenerData["hours"], string][] = [
  ["all", "All days"],
  ["week", "Weekdays"],
  ["sat", "Saturday"],
  ["sun", "Sunday"],
];

function hourLabel(h: number) {
  return `${String(h).padStart(2, "0")}:00`;
}

/** Studio only: who is listening now and the busiest hours (Kampala time). */
function savePdfFile(pdf: string, filename: string) {
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
  window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}

/** For the founder: everyone who has listened, and the whole history, as a PDF. */
function ListenersPdfButton() {
  const fm = useFm();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  if (!fm.founder) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        className={quietButtonClass}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setNote("");
          listenersPdf()
            .then((result) => {
              if (!result.ok) {
                setNote(result.error);
                return;
              }
              savePdfFile(result.pdf, result.filename);
              setNote(`📄 ${result.people} ${result.people === 1 ? "listener" : "listeners"} in the PDF.`);
            })
            .catch(() => setNote("Couldn't make the PDF. Try again."))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Making the PDF…" : "📄 Listeners PDF (since the start)"}
      </button>
      {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
    </div>
  );
}

function Listeners() {
  const [data, setData] = useState<ListenerData | null>(null);
  const [group, setGroup] = useState<keyof ListenerData["hours"]>("all");
  const [note, setNote] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () =>
      getFmListeners()
        .then((result) => {
          if (!alive) return;
          if (result.ok) setData(result);
          else setNote(result.error);
        })
        .catch(() => alive && setNote("Couldn't load listeners."));
    void load();
    const timer = window.setInterval(() => void load(), 60000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const hours = data?.hours[group] ?? [];
  const top = Math.max(0, ...hours);
  const peaks = top > 0 ? hours.map((v, h) => ({ v, h })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 3) : [];

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink">Listeners</h3>
        <span className="text-sm text-ink">
          <span className="mr-1 inline-block size-2 rounded-full bg-[#7ed321] align-middle" aria-hidden="true" />
          {data ? `${data.now} listening now` : "…"}
        </span>
      </div>
      <ListenersPdfButton />
      {note ? <p className="text-sm text-muted">{note}</p> : null}
      {data ? (
        <>
          <div className="mt-2 flex flex-wrap gap-1">
            {LISTEN_GROUPS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`min-h-9 rounded-full px-3 text-xs font-semibold ${group === key ? "bg-[#f8a018] text-black" : "text-muted hover:bg-white/10"}`}
                onClick={() => setGroup(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {top > 0 ? (
            <>
              <div className="mt-2 flex h-24 items-end gap-[2px]" role="img" aria-label="Average listeners by hour">
                {hours.map((v, h) => (
                  <div
                    key={h}
                    title={`${hourLabel(h)}: ${v} on average`}
                    className="flex-1 rounded-t-sm bg-[#f8a018]"
                    style={{ height: `${Math.max(v ? 6 : 1, (v / top) * 100)}%`, opacity: v ? 0.9 : 0.15 }}
                  />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-muted">
                <span>00</span>
                <span>06</span>
                <span>12</span>
                <span>18</span>
                <span>23</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                Busiest: {peaks.map((p) => `${hourLabel(p.h)} (${p.v})`).join(", ")} · average listeners per hour over {data.daysOfData}{" "}
                {data.daysOfData === 1 ? "day" : "days"}, Kampala time.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">No listening recorded yet{group === "all" ? "" : " for these days"}. Counts start building as people tune in.</p>
          )}
        </>
      ) : null}
    </div>
  );
}

function ProgrammeForm({ programme, onDone }: { programme: FmProgramme | null; onDone: () => void }) {
  const fm = useFm();
  const [name, setName] = useState(programme?.name ?? "");
  const [days, setDays] = useState<number[]>(programme?.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [start, setStart] = useState(programme ? clockLabel(programme.startMin) : "06:00");
  const [end, setEnd] = useState(programme ? clockLabel(programme.endMin) : "07:00");
  const [picked, setPicked] = useState<number[]>(programme?.trackIds ?? []);
  const [shuffle, setShuffle] = useState(Boolean(programme?.shuffle));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function save() {
    setBusy(true);
    const result = await saveFmProgramme({
      data: { id: programme?.id ?? 0, name, days, startMin: minutesOf(start), endMin: minutesOf(end), trackIds: picked, shuffle },
    });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    await refreshStation();
    onDone();
  }

  async function remove() {
    if (!programme || !window.confirm(`Delete the programme "${programme.name}"?`)) return;
    setBusy(true);
    await dropFmProgramme({ data: { id: programme.id } });
    setBusy(false);
    await refreshStation();
    onDone();
  }

  return (
    <div className="mt-2 grid gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
      <input className={fieldClass} placeholder="Programme name, e.g. Morning Devotion" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
      <div className="flex flex-wrap gap-1">
        {DAY_NAMES.map((label, day) => {
          const on = days.includes(day);
          return (
            <button
              key={label}
              type="button"
              className={`min-h-9 rounded-full px-3 text-sm font-semibold ${on ? "bg-[#90c840] text-black" : "bg-white/10 text-white"}`}
              onClick={() => setDays((current) => (on ? current.filter((d) => d !== day) : [...current, day].sort()))}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 text-sm text-ink">
        <label className="grid gap-1">
          Starts
          <input type="time" className={fieldClass} value={start} onChange={(event) => setStart(event.target.value)} />
        </label>
        <label className="grid gap-1">
          Ends
          <input type="time" className={fieldClass} value={end} onChange={(event) => setEnd(event.target.value)} />
        </label>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
        <input type="checkbox" className="size-5 accent-[#f8a018]" checked={shuffle} onChange={(event) => setShuffle(event.target.checked)} />
        Shuffle: a fresh order each time round (nothing repeats close together)
      </label>
      <p className="text-sm font-semibold text-ink">{shuffle ? "Plays (shuffled; tap to add or remove):" : "Plays, in this order (tap to add or remove):"}</p>
      <ul className="max-h-48 space-y-1 overflow-y-auto">
        {fm.tracks.map((t) => {
          const at = picked.indexOf(t.id);
          return (
            <li key={t.id}>
              <button
                type="button"
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${at >= 0 ? "bg-[#90c840]/20 text-white" : "text-muted"}`}
                onClick={() => setPicked((current) => (at >= 0 ? current.filter((id) => id !== t.id) : [...current, t.id]))}
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-black/40 text-xs">{at >= 0 ? at + 1 : ""}</span>
                <span className="min-w-0 truncate">{t.title}</span>
                <span className="ml-auto shrink-0 text-xs">{lengthLabel(t.durationSec)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {note ? <p className="text-sm text-danger">{note}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="min-h-10 rounded-full bg-[#f8a018] px-4 font-bold text-black disabled:opacity-50" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save programme"}
        </button>
        <button type="button" className={quietButtonClass} onClick={onDone}>
          Cancel
        </button>
        {programme ? (
          <button type="button" className={`${quietButtonClass} text-danger`} disabled={busy} onClick={() => void remove()}>
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Small "On air" bar shown on every page while the radio is playing. */
const LIVE_SEEN_KEY = "porch-live-dismissed";

export function OnAirBar() {
  const fm = useFm();
  const line = useLine();
  const inCall = Boolean(line.call);
  const live = useLiveService();
  const [dismissed, setDismissed] = useState("");
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(LIVE_SEEN_KEY) ?? "");
    } catch {
      /* shows until closed */
    }
  }, []);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // A call always wins: the radio steps aside, and comes back after the call.
  useEffect(() => {
    if (inCall) holdRadio("call");
    else releaseRadio("call");
  }, [inCall]);
  const showRadio = !inCall && (fm.status === "on" || fm.status === "tuning");
  const liveId = live?.live ? live.videoId : "";
  const showLive = !inCall && Boolean(liveId) && dismissed !== liveId;
  // An ongoing call shows here too (at the top), so it never covers a chat box.
  const glassCalls = useGlassCalls();
  const callSmall = useCallMinimized();
  const previewing = useCallPreview();
  const showCall = previewing ? callSmall : glassCalls ? Boolean(line.call && callSmall) : Boolean(line.call && !line.call.incoming && pathname !== "/calls");
  const reminder = useRadioReminder();
  const showRemind = Boolean(reminder.due) && !inCall && fm.status !== "on";
  const rows = (showRadio ? 1 : 0) + (showLive ? 1 : 0) + (showCall ? 1 : 0) + (showRemind ? 1 : 0);
  // The strips sit at the very top of every screen; everything else moves down to make room.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("radio-on", rows > 0);
    if (rows > 0) root.style.setProperty("--radio-strip", `calc(${rows * 2.1}rem + env(safe-area-inset-top))`);
    else root.style.removeProperty("--radio-strip");
    return () => {
      root.classList.remove("radio-on");
      root.style.removeProperty("--radio-strip");
    };
  }, [rows]);
  if (!rows) return null;
  return createPortal(
    <div className="radio-strips">
      {showCall && (glassCalls || previewing) ? <CallBar /> : null}
      {showCall && line.call && !glassCalls && !previewing ? (
        <div className="radio-strip call-strip" role="region" aria-label="Call in progress">
          <span className="radio-strip-live" aria-hidden="true">
            <span className="call-strip-dot" />
            Call
          </span>
          <span className="radio-strip-text">
            <b>{line.call.name}</b>
            <span> · {line.call.status}</span>
          </span>
          <button type="button" className="call-strip-back" onClick={() => void navigate({ to: "/calls", search: { to: "", name: "", video: "" } })}>
            Back
          </button>
          <button type="button" className="call-strip-end" onClick={() => hangUp()}>
            End
          </button>
        </div>
      ) : null}
      {showLive ? (
        <div className="radio-strip live-strip" role="region" aria-label="Service is live">
          <span className="radio-strip-live" aria-hidden="true">
            <span className="fm-onair-dot" />
            Live
          </span>
          <span className="radio-strip-text">
            <b>{live?.label || "Phaneroo is live now"}</b>
            <span> · {live?.title || "on YouTube"}</span>
          </span>
          <a className="live-strip-join" href={watchLink(liveId)} target="_blank" rel="noreferrer" onClick={() => tuneOut()}>
            Join
          </a>
          <button
            type="button"
            className="radio-strip-stop"
            aria-label="Hide this announcement"
            onClick={() => {
              setDismissed(liveId);
              try {
                localStorage.setItem(LIVE_SEEN_KEY, liveId);
              } catch {
                /* hidden for now */
              }
            }}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {showRemind && reminder.due ? (
        <div className="radio-strip" role="region" aria-label="Programme starting">
          <span className="radio-strip-live" aria-hidden="true">
            🔔
          </span>
          <span className="radio-strip-text">
            <b>{reminder.due.name}</b>
            <span> · starting on Porchbook Radio</span>
          </span>
          <button
            type="button"
            className="live-strip-join"
            onClick={() => {
              reminder.dismiss();
              void tuneIn();
            }}
          >
            Listen
          </button>
          <button type="button" className="radio-strip-stop" aria-label="Hide this reminder" onClick={reminder.dismiss}>
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {showRadio ? (
        <div className="radio-strip" role="region" aria-label="Porchbook Radio">
          <span className="radio-strip-live" aria-hidden="true">
            <span className="fm-onair-dot" />
            On air
          </span>
          <span className="radio-strip-text">
            <b>{fm.status === "tuning" ? "Tuning in…" : fm.onAir?.track.title}</b>
            <span> · {fm.onAir?.programme ?? "Porchbook Radio"}</span>
          </span>
          <button type="button" className="radio-strip-stop" aria-label="Turn off Porchbook Radio" onClick={tuneOut}>
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

/** Studio: how much of the free storage and listening the Radio has used this month. */
function RadioUsage() {
  const [u, setU] = useState<Extract<Awaited<ReturnType<typeof getRadioUsage>>, { ok: true }> | null>(null);
  useEffect(() => {
    void getRadioUsage()
      .then((r) => r.ok && setU(r))
      .catch(() => undefined);
  }, []);
  if (!u) return null;
  const bar = (used: number, limit: number) => {
    const share = Math.min(1, used / limit);
    return (
      <span className="ru-bar" aria-hidden="true">
        <i style={{ width: `${share * 100}%`, background: share >= 0.9 ? "#e53935" : share >= 0.7 ? "#f8a018" : "#7dff2a" }} />
      </span>
    );
  };
  return (
    <div className="ru-card">
      <p className="ru-title">Radio limits (free plan{u.cloud ? ", Cloudflare" : ""})</p>
      <p className="ru-row">
        <span>Storage</span>
        {bar(u.storedGb, u.storageLimit)}
        <b>{u.measured ? `${u.storedGb.toFixed(2)} of ${u.storageLimit} GB` : "measuring…"}</b>
      </p>
      {u.transferLimit ? (
        <p className="ru-row">
          <span>Listening this month</span>
          {bar(u.usedGb, u.transferLimit)}
          <b>
            about {u.usedGb.toFixed(1)} of {u.transferLimit} GB
          </b>
        </p>
      ) : null}
      <p className="ru-note">
        {u.cloud
          ? `${u.hours} listening hours this month. Listening is free on Cloudflare; you'll be warned when storage reaches 70%.`
          : `${u.hours} listening hours so far. Past either limit, the Radio stops for 30 days; you'll be warned from 70%.`}
      </p>
      <CleanUp />
      <CloudStore />
    </div>
  );
}

/** Founder: Cloudflare R2 for the Radio's files. Keys saved here (never in chat), then the files moved over. */
function CloudStore() {
  const [info, setInfo] = useState<Extract<Awaited<ReturnType<typeof storageInfo>>, { ok: true }> | null>(null);
  const [form, setForm] = useState({ endpoint: "", accessKey: "", secret: "", publicBase: "" });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const load = () =>
    void storageInfo()
      .then((r) => {
        if (!r.ok) return;
        setInfo(r);
        setForm((f) => ({ ...f, endpoint: f.endpoint || r.endpoint, publicBase: f.publicBase || r.publicBase }));
      })
      .catch(() => undefined);
  useEffect(load, []);
  if (!info) return null;
  async function save() {
    setBusy(true);
    setNote("Checking the keys with a test file…");
    const r = await saveStorageKeys({ data: { ...form, bucket: info?.bucket ?? "porchbook-radio" } }).catch(() => null);
    setBusy(false);
    if (r?.ok) {
      setForm((f) => ({ ...f, accessKey: "", secret: "" }));
      setOpen(false);
      setNote("✅ Cloudflare works. New uploads now go there. Next: move the old files.");
      load();
    } else setNote(r && !r.ok ? r.error : "Couldn't check the keys. Check your data.");
  }
  async function move() {
    setBusy(true);
    setNote("Copying files to Cloudflare… keep this open.");
    for (let round = 0; round < 200; round += 1) {
      const r = await moveStep().catch(() => null);
      if (!r?.ok) {
        setNote(r && !r.ok ? r.error : "The move paused (connection). Tap Move again; it carries on where it stopped.");
        break;
      }
      if (r.switched) {
        setNote(`✅ All ${r.total} files are on Cloudflare and the Radio now plays from there. Listen for a bit; then remove the Vercel copies.`);
        load();
        break;
      }
      setNote(`Copying… ${r.total - r.left} of ${r.total} files done.`);
    }
    setBusy(false);
  }
  async function finish() {
    setBusy(true);
    setNote("Removing the Vercel copies…");
    const r = await finishMove().catch(() => null);
    setBusy(false);
    setNote(r?.ok ? `✅ Removed ${r.removed} files from Vercel.` : r && !r.ok ? r.error : "Couldn't remove them. Try again.");
  }
  const field = (key: keyof typeof form, label: string, secret = false) => (
    <label className="ru-field">
      <span>{label}</span>
      <input
        type={secret ? "password" : "text"}
        autoComplete="off"
        spellCheck={false}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
    </label>
  );
  return (
    <div className="ru-clean">
      <p className="ru-title">Cloudflare storage {info.on ? "· on ✅" : "· off"}</p>
      <p className="ru-note">
        {info.on
          ? info.moved
            ? "The Radio plays from Cloudflare: 10 GB free, listening free."
            : "New uploads go to Cloudflare. Move the old files over next."
          : "Paste the R2 token's keys here (only you can see this box)."}
      </p>
      {open || !info.hasKeys ? (
        <div className="ru-form">
          {field("endpoint", "Endpoint (…r2.cloudflarestorage.com)")}
          {field("accessKey", "Access Key ID", true)}
          {field("secret", "Secret Access Key", true)}
          {field("publicBase", "Public address (…r2.dev)")}
        </div>
      ) : null}
      {note ? <p className="ru-note">{note}</p> : null}
      <div className="ru-acts">
        {open || !info.hasKeys ? (
          <button type="button" className="is-go" disabled={busy || !form.endpoint || !form.accessKey || !form.secret || !form.publicBase} onClick={() => void save()}>
            Check and save
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => setOpen(true)}>
            Change keys
          </button>
        )}
        {info.on && !info.moved ? (
          <button type="button" className="is-go" disabled={busy} onClick={() => void move()}>
            Move the files to Cloudflare
          </button>
        ) : null}
        {info.moved ? (
          <button type="button" disabled={busy} onClick={() => void finish()}>
            Remove the Vercel copies
          </button>
        ) : null}
      </div>
    </div>
  );
}

const STORE_NAMES: Record<string, [string, string]> = {
  unused: ["Not used anywhere", "Old uploads nothing plays or shows any more."],
  samples: ["Before/after samples", "The mixer's short listening samples."],
  bin: ["The bin", "Deleted items waiting to be emptied."],
  originals: ["Originals of evened-out songs", "Kept so evening-out can be undone. Removing them means no Undo."],
  kept: ["In use", "Everything the Radio and Porchbook use: never removed."],
};

/** Studio: see what takes the Radio's storage, and clean up what isn't needed. */
function CleanUp() {
  const [look, setLook] = useState<Extract<Awaited<ReturnType<typeof radioStorage>>, { ok: true }> | null>(null);
  const [take, setTake] = useState<string[]>(["unused", "samples", "bin"]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const gb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${Math.round(b / 1024 ** 2)} MB`);
  async function run(clean: boolean) {
    setBusy(true);
    setNote(clean ? "Cleaning up…" : "Looking at the storage…");
    const r = await radioStorage({ data: { clean, take } }).catch(() => null);
    setBusy(false);
    if (r?.ok) {
      setLook(r);
      setNote(clean ? `Freed ${gb(r.freed)}. Storage is now ${gb(r.total)}.` : "");
    } else setNote(r && !r.ok ? r.error : "Couldn't read the storage. Check your data.");
  }
  return (
    <div className="ru-clean">
      {look ? (
        <ul>
          {look.groups.map((g) => (
            <li key={g.kind}>
              {g.kind === "kept" ? (
                <span className="ru-box" />
              ) : (
                <input
                  type="checkbox"
                  checked={take.includes(g.kind)}
                  disabled={!g.files}
                  onChange={(e) => setTake((t) => (e.target.checked ? [...t, g.kind] : t.filter((k) => k !== g.kind)))}
                  aria-label={STORE_NAMES[g.kind][0]}
                />
              )}
              <span className="ru-what">
                {STORE_NAMES[g.kind][0]} <small>{STORE_NAMES[g.kind][1]}</small>
              </span>
              <b>
                {gb(g.bytes)}
                <small>{g.files} files</small>
              </b>
            </li>
          ))}
        </ul>
      ) : null}
      {note ? <p className="ru-note">{note}</p> : null}
      <div className="ru-acts">
        <button type="button" disabled={busy} onClick={() => void run(false)}>
          {look ? "Look again" : "See what takes the space"}
        </button>
        {look ? (
          <button type="button" className="is-go" disabled={busy || !take.length} onClick={() => void run(true)}>
            🧹 Clean up the ticked
          </button>
        ) : null}
      </div>
    </div>
  );
}
