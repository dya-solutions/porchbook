import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { shown } from "@/lib/porch/on-hold";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AppFrame } from "@/components/porch/frame";
import { fmNow, loadStation, peekOnAir, refreshStation, useFm } from "@/lib/porch/fm-player";
import { clockLabel, todaysProgrammes } from "@/lib/porch/fm-schedule";
import { getFmListeners, missFmRequest, playFmNow, saveFmProgramme, setFmTrackKind, setFmTrackStrings, setLiveVideo, skipFmNext, stopFmBreak } from "@/lib/porch/fm";
import { planRadio, type RadioAction } from "@/lib/porch/radio-command";
import { getMixer, mixTracks, saveMixer, undoMix } from "@/lib/porch/fm-mixer";
import { cleanMix } from "@/lib/porch/fm-mix-settings";
import { BeforeAfter, MixerPanel, MixProgress, PlanMeters, type MixerView } from "@/components/porch/cr-mixer";

export const Route = createFileRoute("/control-room")({
  // The radio's control room is on hold (BUILD-BRIEF.md section 4): the page is kept but old links go to the porch.
  beforeLoad: () => {
    if (!shown("radio")) throw redirect({ to: "/", search: { room: "all" } });
  },
  component: ControlRoomPage,
});

type Turn = { role: "user" | "assistant"; text: string; plan?: string[]; actions?: RadioAction[]; state?: "ask" | "done" | "cancelled" | "failed" };

const CHIPS = ["Master everything ", "Same loudness for ", "Measure ", "Play next ", "Strings on ", "Go live with ", "New programme: "];
const KEEP = "porch-control-room";

function clock(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function ControlRoomPage() {
  return (
    <AppFrame>
      <ControlRoom />
    </AppFrame>
  );
}

function ControlRoom() {
  const fm = useFm();
  const [, setTick] = useState(0);
  const [listening, setListening] = useState<number | null>(null);
  const [turns, setTurns] = useState<Turn[]>(() => {
    try {
      return (JSON.parse(sessionStorage.getItem(KEEP) ?? "[]") as Turn[]).slice(-20);
    } catch {
      return [];
    }
  });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [mixer, setMixer] = useState<MixerView | null>(null);
  const [panel, setPanel] = useState(false);
  const [watchBatch, setWatchBatch] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadStation();
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000);
    const count = () =>
      getFmListeners()
        .then((r) => r.ok && setListening(r.now))
        .catch(() => undefined);
    count();
    const counter = window.setInterval(count, 30000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(counter);
    };
  }, []);
  // The mixer: every 5 seconds while it's working, otherwise every 30.
  const working = Boolean(mixer?.batch && mixer.batch.done < mixer.batch.total);
  useEffect(() => {
    let gone = false;
    const read = () =>
      getMixer()
        .then((r) => {
          if (!gone && r.ok) setMixer({ settings: r.settings, auto: r.auto, worker: r.worker, tracks: r.tracks, batch: r.batch });
        })
        .catch(() => undefined);
    read();
    const t = window.setInterval(read, working ? 5000 : 30000);
    return () => {
      gone = true;
      window.clearInterval(t);
    };
  }, [working]);
  const refreshMixer = () =>
    getMixer()
      .then((r) => r.ok && setMixer({ settings: r.settings, auto: r.auto, worker: r.worker, tracks: r.tracks, batch: r.batch }))
      .catch(() => undefined);

  useEffect(() => {
    try {
      sessionStorage.setItem(KEEP, JSON.stringify(turns.slice(-20)));
    } catch {
      /* this visit only */
    }
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns]);

  if (fm.loaded && !fm.studio) {
    return (
      <div className="cr-room">
        <p className="cr-empty">The Control Room is for the radio studio only.</p>
        <Link to="/next" className="cr-back">
          ← Back
        </Link>
      </div>
    );
  }

  const now = fmNow();
  const onAir = fm.onAir ?? (fm.loaded ? peekOnAir() : null);
  const left = onAir ? (onAir.endsAtMs - now) / 1000 : 0;
  const share = onAir && onAir.track.durationSec ? Math.min(1, Math.max(0, 1 - left / onAir.track.durationSec)) : 0;
  const nowMin = new Date(now + 3 * 3600_000).getUTCHours() * 60 + new Date(now + 3 * 3600_000).getUTCMinutes();
  const next = todaysProgrammes(fm.programmes, now).find((p) => p.startMin > nowMin);
  const live = fm.status === "on" || Boolean(onAir);

  async function send(event?: FormEvent, said?: string) {
    event?.preventDefault();
    const line = (said ?? text).trim();
    if (!line || busy) return;
    setText("");
    setBusy(true);
    const before = turns.slice(-6).map((t) => ({ role: t.role, text: t.role === "assistant" ? [t.text, ...(t.plan ?? [])].join(" · ") : t.text }));
    setTurns((all) => [...all, { role: "user", text: line }]);
    const result = await planRadio({ data: { text: line, before } }).catch(() => null);
    setBusy(false);
    if (!result || !result.ok) {
      setTurns((all) => [...all, { role: "assistant", text: result?.error ?? "That didn't go through. Try again." }]);
      return;
    }
    setTurns((all) => [...all, { role: "assistant", text: result.reply, plan: result.plan, actions: result.actions, state: result.actions.length ? "ask" : undefined }]);
  }

  async function doIt(index: number) {
    const turn = turns[index];
    if (!turn?.actions?.length || busy) return;
    setBusy(true);
    const problems: string[] = [];
    const station = fm;
    for (const action of turn.actions) {
      try {
        let r: { ok: boolean; error?: string } | undefined;
        if (action.type === "play_now") r = await playFmNow({ data: { trackId: action.trackId, requestId: action.requestId ?? 0, withMessage: action.withMessage !== false } });
        else if (action.type === "request_missing") r = await missFmRequest({ data: { id: action.requestId } });
        else if (action.type === "play_next") {
          const playing = peekOnAir();
          const wait = playing ? Math.max(15, Math.round((playing.endsAtMs - fmNow()) / 1000)) : 15;
          r = await playFmNow({ data: { trackId: action.trackId, inSec: wait } });
        } else if (action.type === "skip") r = await skipFmNext();
        else if (action.type === "stop_break") r = await stopFmBreak({ data: { id: action.breakId } });
        else if (action.type === "strings") {
          for (const id of action.trackIds) {
            const one = await setFmTrackStrings({ data: { id, on: action.on } });
            if (!one.ok) r = one;
          }
        } else if (action.type === "set_kind") {
          for (const id of action.trackIds) {
            const one = await setFmTrackKind({ data: { id, kind: action.kind } });
            if (!one.ok) r = one;
          }
        } else if (action.type === "live_on") r = await setLiveVideo({ data: { link: action.link, label: "auto" } });
        else if (action.type === "live_off") r = await setLiveVideo({ data: { link: "" } });
        else if (action.type === "programme") r = await saveFmProgramme({ data: { ...action, id: 0 } });
        else if (action.type === "mixer_settings") r = await saveMixer({ data: { settings: action.settings, remaster: action.remaster } });
        else if (action.type === "auto_master") r = await saveMixer({ data: { auto: action.on } });
        else if (action.type === "measure" || action.type === "master") {
          r = await mixTracks({ data: { mode: action.type, ids: action.trackIds } });
          if (r.ok) setWatchBatch(true);
        } else if (action.type === "undo_master") r = await undoMix({ data: { ids: action.trackIds } });
        if (action.type === "mixer_settings" && action.remaster && r?.ok) setWatchBatch(true);
        if (r && !r.ok) problems.push(r.error ?? "One step didn't go through.");
      } catch {
        problems.push("One step didn't go through.");
      }
    }
    void station;
    await refreshStation().catch(() => undefined);
    void refreshMixer();
    setBusy(false);
    setTurns((all) => {
      const copy = [...all];
      copy[index] = { ...copy[index], state: problems.length ? "failed" : "done" };
      copy.push({ role: "assistant", text: problems.length ? `Some of it didn't work: ${problems.join(" ")}` : `Done ✓ ${(turn.plan ?? []).join(" · ")}` });
      return copy;
    });
  }

  function cancel(index: number) {
    setTurns((all) => {
      const copy = [...all];
      copy[index] = { ...copy[index], state: "cancelled" };
      copy.push({ role: "assistant", text: "Okay, nothing changed." });
      return copy;
    });
  }

  return (
    <div className="cr-room">
      <div className="cr-top">
        <Link to="/next" className="cr-title" aria-label="Back to the radio">
          ← 🎛 CONTROL ROOM
        </Link>
        <span className={`cr-onair${live ? " is-on" : ""}`}>
          <i />
          ON AIR
        </span>
      </div>
      <div className="cr-wall" aria-live="polite">
        <p className="cr-now">{onAir ? `▶ ${onAir.track.title}` : fm.loaded ? "Nothing on air right now" : "…"}</p>
        <span className="cr-line">
          <i style={{ width: `${share * 100}%` }} />
        </span>
        <p className="cr-row">
          <span>
            {onAir ? `${clock(left)} left` : ""}
            {next ? ` · Next: ${next.name} ${clockLabel(next.startMin)}` : ""}
          </span>
          {listening !== null ? <b>{listening} listening</b> : null}
        </p>
      </div>
      <div className="cr-chat">
        {turns.length ? null : <p className="cr-hint">Tell the radio what you want, in your own words. It shows you its plan first; nothing changes until you tap Do it.</p>}
        {turns.map((turn, index) =>
          turn.role === "user" ? (
            <p key={index} className="cr-me">
              {turn.text}
            </p>
          ) : (
            <div key={index} className="cr-ra">
              <small>RADIO</small>
              <p>{turn.text}</p>
              {turn.plan?.length ? (
                <ul className="cr-plan">
                  {turn.plan.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              ) : null}
              {turn.state === "ask" && mixer ? <MixPlan actions={turn.actions ?? []} mixer={mixer} /> : null}
              {turn.state === "ask" ? (
                <span className="cr-act">
                  <button type="button" className="cr-do" disabled={busy} onClick={() => void doIt(index)}>
                    {busy ? "…" : "Do it"}
                  </button>
                  <button type="button" className="cr-no" disabled={busy} onClick={() => cancel(index)}>
                    Cancel
                  </button>
                </span>
              ) : null}
            </div>
          ),
        )}
        {busy && turns.at(-1)?.role === "user" ? <p className="cr-ra cr-thinking">Thinking…</p> : null}
        {mixer?.batch && (working || watchBatch) ? <MixProgress batch={mixer.batch} worker={mixer.worker} /> : null}
        <div ref={end} />
      </div>
      {panel && mixer ? (
        <MixerPanel
          view={mixer}
          onClose={() => setPanel(false)}
          onSaved={(note) => {
            setPanel(false);
            setWatchBatch(true);
            setTurns((all) => [...all, { role: "assistant", text: note }]);
            void refreshMixer();
          }}
        />
      ) : null}
      <div className="cr-chips">
        <button type="button" className="is-mixer" onClick={() => setPanel((v) => !v)} disabled={!mixer}>
          🎚 Mixer
        </button>
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => {
              setText(chip);
              box.current?.focus();
            }}
          >
            {chip.trim()}…
          </button>
        ))}
      </div>
      <form className="cr-box" onSubmit={(event) => void send(event)}>
        <input ref={box} value={text} onChange={(event) => setText(event.target.value.slice(0, 600))} placeholder="Tell the radio…" aria-label="Tell the radio" autoComplete="off" enterKeyHint="send" />
        <button type="submit" disabled={busy || !text.trim()} aria-label="Send">
          ➤
        </button>
      </form>
    </div>
  );
}

/** Under a plan that masters: loudness meters and a before/after sample. */
function MixPlan({ actions, mixer }: { actions: RadioAction[]; mixer: MixerView }) {
  const master = actions.find((a): a is Extract<RadioAction, { type: "master" }> => a.type === "master");
  const newSettings = actions.find((a): a is Extract<RadioAction, { type: "mixer_settings" }> => a.type === "mixer_settings");
  if (!master && !newSettings?.remaster) return null;
  const settings = newSettings ? cleanMix(newSettings.settings, mixer.settings) : mixer.settings;
  const usable = mixer.tracks.filter((t) => !t.video);
  const ids = master && master.trackIds !== "all" ? master.trackIds : null;
  const list = ids ? usable.filter((t) => ids.includes(t.id)) : usable;
  if (!list.length) return null;
  // Sample the item that will change most (or the first sermon), so the difference is clear.
  const sample =
    [...list].filter((t) => t.before?.i !== null && t.before?.i !== undefined).sort((a, b) => Math.abs((b.before?.i ?? 0) - settings.lufs) - Math.abs((a.before?.i ?? 0) - settings.lufs))[0] ??
    list.find((t) => t.kind === "preaching") ??
    list[0];
  return (
    <div className="crm-plan">
      <PlanMeters tracks={[...list].sort((a, b) => Math.abs((b.before?.i ?? settings.lufs) - settings.lufs) - Math.abs((a.before?.i ?? settings.lufs) - settings.lufs))} target={settings.lufs} />
      {mixer.worker === "old" ? <p className="crm-warn">The audio server needs updating first.</p> : <BeforeAfter key={`${sample.id}-${JSON.stringify(settings)}`} track={sample} settings={settings} />}
    </div>
  );
}
