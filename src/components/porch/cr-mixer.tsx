import { useEffect, useRef, useState } from "react";
import { getMixPreview, previewMix, saveMixer, type MixTrack } from "@/lib/porch/fm-mixer";
import { DEFAULT_MIX, describeMix, type MixSettings } from "@/lib/porch/fm-mix-settings";

/** The Control Room's mixer pieces: loudness meters, before/after samples, progress, settings. */

export type MixerView = {
  settings: MixSettings;
  auto: boolean;
  worker: "ready" | "old" | "asleep";
  tracks: MixTrack[];
  batch: { mode: string; total: number; done: number; failed: number } | null;
};

// −30 … −8 LUFS across the meter.
const spot = (lufs: number) => Math.max(0, Math.min(100, ((lufs + 30) / 22) * 100));

/** One item's loudness: where it is now, and where it will land. */
export function MeterRow({ track, target }: { track: MixTrack; target: number }) {
  const now = track.mastered ? track.after?.i : track.before?.i;
  const from = track.before?.i ?? null;
  return (
    <li className="crm-meter">
      <span className="crm-name">{track.title}</span>
      <span className="crm-bar" aria-hidden="true">
        {now !== null && now !== undefined ? <i style={{ width: `${spot(now)}%` }} /> : null}
        <b style={{ left: `${spot(target)}%` }} />
      </span>
      <span className="crm-num">
        {from !== null ? `${from}` : "?"} → {target}
      </span>
    </li>
  );
}

/** Meters for the items a plan will master (the first few, then a count). */
export function PlanMeters({ tracks, target }: { tracks: MixTrack[]; target: number }) {
  if (!tracks.length) return null;
  const shown = tracks.slice(0, 3);
  const rest = tracks.length - shown.length;
  return (
    <ul className="crm-meters">
      {shown.map((t) => (
        <MeterRow key={t.id} track={t} target={target} />
      ))}
      {rest > 0 ? (
        <li className="crm-meter is-more">
          <span className="crm-name">
            {rest} more item{rest === 1 ? "" : "s"}
          </span>
          <span className="crm-bar" aria-hidden="true">
            <b style={{ left: `${spot(target)}%` }} />
          </span>
          <span className="crm-num">→ {target}</span>
        </li>
      ) : null}
    </ul>
  );
}

/**
 * "Hear before / after": the worker cuts the same 20 seconds before and after mastering.
 * Switching keeps the place, so the difference is easy to hear.
 */
export function BeforeAfter({ track, settings }: { track: MixTrack; settings: MixSettings }) {
  const [state, setState] = useState<"idle" | "making" | "ready" | "failed">("idle");
  const [note, setNote] = useState("");
  const [urls, setUrls] = useState({ before: "", after: "" });
  const [side, setSide] = useState<"before" | "after">("after");
  const player = useRef<HTMLAudioElement>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function make() {
    setState("making");
    setNote("");
    const r = await previewMix({ data: { id: track.id, settings } }).catch(() => null);
    if (!r || !r.ok) {
      setState("failed");
      setNote(r && !r.ok ? r.error : "That didn't go through.");
      return;
    }
    if (r.waking) setNote("Waking the audio worker…");
    const started = Date.now();
    const check = async () => {
      const p = await getMixPreview({ data: { id: track.id } }).catch(() => null);
      if (p?.ok && p.before && p.after) {
        setUrls({ before: p.before, after: p.after });
        setState("ready");
        setNote("");
        return;
      }
      if (p?.ok && p.error) {
        setState("failed");
        setNote(p.error);
        return;
      }
      if (Date.now() - started > 8 * 60 * 1000) {
        setState("failed");
        setNote("The sample is taking too long. Try again in a minute.");
        return;
      }
      timer.current = window.setTimeout(() => void check(), 3000);
    };
    timer.current = window.setTimeout(() => void check(), 4000);
  }

  function hear(which: "before" | "after") {
    const node = player.current;
    if (!node) return;
    const at = node.currentTime || 0;
    setSide(which);
    node.src = urls[which];
    node.addEventListener(
      "loadedmetadata",
      () => {
        try {
          node.currentTime = Math.min(at, (node.duration || 20) - 0.2);
        } catch {
          /* starts from the top */
        }
        void node.play().catch(() => undefined);
      },
      { once: true },
    );
    node.load();
  }

  if (state === "idle" || state === "failed")
    return (
      <span className="crm-ba">
        <button type="button" className="cr-no" onClick={() => void make()}>
          ▶ Hear before / after
        </button>
        {note ? <small className="crm-note">{note}</small> : null}
      </span>
    );
  if (state === "making")
    return (
      <span className="crm-ba">
        <span className="crm-note">🎚 Making a 20-second sample of “{track.title}”… {note}</span>
      </span>
    );
  return (
    <span className="crm-ba is-ready">
      <span className="crm-sw" role="group" aria-label={`Before or after: ${track.title}`}>
        <button type="button" className={side === "before" ? "is-on" : ""} onClick={() => hear("before")}>
          Before
        </button>
        <button type="button" className={side === "after" ? "is-on" : ""} onClick={() => hear("after")}>
          After
        </button>
      </span>
      <audio ref={player} src={urls[side]} controls preload="auto" className="crm-audio" />
    </span>
  );
}

/** The background work: "7 of 18 done". */
export function MixProgress({ batch, worker }: { batch: NonNullable<MixerView["batch"]>; worker: MixerView["worker"] }) {
  const doing = batch.mode === "measure" ? "MEASURING" : "MASTERING";
  const finished = batch.done >= batch.total;
  return (
    <div className="cr-ra crm-progress" aria-live="polite">
      <small>RADIO · {finished ? (batch.mode === "measure" ? "MEASURED" : "MASTERED") : doing}</small>
      <span className="crm-line">
        <i style={{ width: `${(batch.done / Math.max(1, batch.total)) * 100}%` }} />
      </span>
      <p>
        {finished ? `All ${batch.total} done ✓` : `${batch.done} of ${batch.total} done`}
        {batch.failed ? ` · ${batch.failed} didn't work` : ""}
        {!finished && worker === "asleep" ? " · waking the audio worker…" : ""}
      </p>
      {!finished && batch.mode !== "measure" ? <p className="crm-note">Listeners aren't interrupted: each item changes over once it's off air.</p> : null}
    </div>
  );
}

const STEPS = ["Off", "Gentle", "Medium", "Strong"];
const HISS = ["Off", "Light", "Medium", "Strong"];

/** The mixer's settings, set by hand (the radio can also change them in plain words). */
export function MixerPanel({ view, onClose, onSaved }: { view: MixerView; onClose: () => void; onSaved: (note: string) => void }) {
  const [s, setS] = useState<MixSettings>(view.settings);
  const [auto, setAuto] = useState(view.auto);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof MixSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setS((now) => ({ ...now, [k]: Number(e.target.value) }));

  async function save(remaster: boolean) {
    setBusy(true);
    setError("");
    const r = await saveMixer({ data: { settings: s, auto, remaster } }).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) {
      setError(r && !r.ok ? r.error : "That didn't save. Try again.");
      return;
    }
    onSaved(remaster ? `Mixer saved: ${describeMix(r.settings)}. Re-mastering ${r.sent} items in the background.` : `Mixer saved: ${describeMix(r.settings)}.`);
  }

  const tilt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return (
    <div className="crm-panel" role="dialog" aria-label="Mixer settings">
      <div className="crm-head">
        <b>🎚 MIXER</b>
        <button type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {view.worker === "old" ? <p className="crm-warn">The audio server needs updating before mastering can run.</p> : null}
      <label className="crm-set">
        <span>Loudness</span>
        <input type="range" min={-24} max={-10} step={0.5} value={s.lufs} onChange={set("lufs")} />
        <em>{s.lufs} LUFS</em>
      </label>
      <label className="crm-set">
        <span>Peak limit</span>
        <input type="range" min={-3} max={-0.5} step={0.1} value={s.peak} onChange={set("peak")} />
        <em>{s.peak} dB</em>
      </label>
      <label className="crm-set">
        <span>Warmth</span>
        <input type="range" min={-3} max={3} step={1} value={s.warmth} onChange={set("warmth")} />
        <em>{tilt(s.warmth)}</em>
      </label>
      <label className="crm-set">
        <span>Clarity</span>
        <input type="range" min={-3} max={3} step={1} value={s.clarity} onChange={set("clarity")} />
        <em>{tilt(s.clarity)}</em>
      </label>
      <label className="crm-set">
        <span>Compression</span>
        <input type="range" min={0} max={3} step={1} value={s.comp} onChange={set("comp")} />
        <em>{STEPS[s.comp]}</em>
      </label>
      <label className="crm-set">
        <span>Hiss clean-up</span>
        <input type="range" min={0} max={3} step={1} value={s.hiss} onChange={set("hiss")} />
        <em>{HISS[s.hiss]}</em>
      </label>
      <label className="crm-auto">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> ✨ Auto-master new uploads
      </label>
      {error ? <p className="crm-warn">{error}</p> : null}
      <div className="crm-btns">
        <button type="button" className="cr-do" disabled={busy} onClick={() => void save(true)}>
          Save & re-master everything
        </button>
        <button type="button" className="cr-no" disabled={busy} onClick={() => void save(false)}>
          Save only
        </button>
        <button type="button" className="cr-no" disabled={busy} onClick={() => setS(DEFAULT_MIX)}>
          Standard
        </button>
      </div>
    </div>
  );
}
