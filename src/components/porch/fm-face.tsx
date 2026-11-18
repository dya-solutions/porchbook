import { W, WHint, useWord } from "@/components/porch/words";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { refreshDevotion } from "@/lib/porch/devotion-cache";
import { studyText, todaysFurtherStudy, type StudyRef } from "@/lib/porch/further-study";
import { todaysProgrammes, type FmProgramme } from "@/lib/porch/fm-schedule";
import { attachBed } from "@/lib/porch/devotion-bed";
import { canPhoneSpeak, speakLines } from "@/lib/porch/phone-voice";
import { fmNow, followVolume, holdRadio, radioLevel, peekOnAir, readLevels, refreshStation, releaseRadio, setSound, tuneIn, tuneOut, useFm, useFmSound } from "@/lib/porch/fm-player";
import { devotionVoice, devotionWords } from "@/lib/porch/devotion-voice";
import { skipFmNext } from "@/lib/porch/fm";
import { useLite } from "@/lib/porch/lite";
import { WAVE_COLUMNS, drawWave, fakeWave, spreadLevels } from "@/lib/porch/fm-wave";
import { RequestPanel, useOnAirMessage } from "@/components/porch/fm-request";
import { PorchLoader } from "@/components/porch/porch-loader";
import { BibleScreen, NuggetScreen } from "@/components/porch/nugget-bits";

/**
 * Porchbook Radio's face: a hi-fi unit with a level display, a power button, a glowing volume
 * fader, a reminder bell and a button bar. Power turns this phone's radio off; the station plays on.
 */

const KIND_LABEL: Record<string, string> = { bible: "Bible reading", nugget: "Nugget", music: "Music", preaching: "Preaching", news: "News", reading: "Reading", other: "Other", jingle: "Jingle", station: "Station ID", newsintro: "News intro" };
type Mode = "bars" | "word" | "today" | "clock";
const BibleReader = lazy(() => import("@/components/porch/bible-reader").then((mod) => ({ default: mod.BibleReader })));

function kampalaMinutes(ms: number) {
  const d = new Date(ms + 3 * 3600000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** "6:05 AM" style, for programme times. */
function clockLabel(minutes: number) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Uganda time that ticks: hours and minutes, a colon that blinks each second, and AM/PM. */
// Seven-segment digits: which bars light for each figure.
const SEGMENTS: Record<string, string> = { "0": "abcdef", "1": "bc", "2": "abdeg", "3": "abcdg", "4": "bcfg", "5": "acdfg", "6": "acdefg", "7": "abc", "8": "abcdefg", "9": "abcdfg" };
const DIGIT_W = 30;
const DIGIT_H = 56;
const BARS: Record<string, string> = (() => {
  const w = DIGIT_W;
  const h = DIGIT_H;
  const t = w * 0.17;
  const s = w * 0.07;
  const g = t * 0.2;
  const m = h / 2;
  const pts: Record<string, number[][]> = {
    a: [[s + g, 0], [w - s - g, 0], [w - s - t - g, t], [s + t + g, t]],
    d: [[s + t + g, h - t], [w - s - t - g, h - t], [w - s - g, h], [s + g, h]],
    g: [[s + t / 2 + g, m], [s + t + g, m - t / 2], [w - s - t - g, m - t / 2], [w - s - t / 2 - g, m], [w - s - t - g, m + t / 2], [s + t + g, m + t / 2]],
    f: [[s, g], [s + t, t + g], [s + t, m - t / 2 - g], [s, m - g]],
    b: [[w - s, g], [w - s, m - g], [w - s - t, m - t / 2 - g], [w - s - t, t + g]],
    e: [[s, m + g], [s + t, m + t / 2 + g], [s + t, h - t - g], [s, h - g]],
    c: [[w - s, m + g], [w - s, h - g], [w - s - t, h - t - g], [w - s - t, m + t / 2 + g]],
  };
  return Object.fromEntries(Object.entries(pts).map(([k, list]) => [k, list.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ")]));
})();

function Digit({ figure, x }: { figure: string; x: number }) {
  const lit = SEGMENTS[figure] ?? "";
  return (
    <g transform={`translate(${x} 0) skewX(-7)`}>
      {Object.entries(BARS).map(([bar, points]) => (
        <polygon key={bar} points={points} className={lit.includes(bar) ? "seg-on" : "seg-off"} />
      ))}
    </g>
  );
}

const WEEK = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/** Uganda time as a glowing digital clock (green), with the day of the week on the big one. */
function UgandaClock({ className, big = false }: { className: string; big?: boolean }) {
  const [ms, setMs] = useState(() => fmNow());
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      const now = fmNow();
      setMs(now);
      timer = window.setTimeout(tick, 1000 - (now % 1000) + 5); // on the second
    };
    tick();
    return () => window.clearTimeout(timer);
  }, []);
  const d = new Date(ms + 3 * 3600000);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const even = d.getUTCSeconds() % 2 === 0;
  const hour = String(h % 12 || 12).padStart(2, " ");
  const mins = String(m).padStart(2, "0");
  const step = DIGIT_W + 6;
  const colonX = step * 2 + 2;
  const width = step * 4 + 14;
  const today = (d.getUTCDay() + 6) % 7; // Monday first
  return (
    <span className={`${className} seg-clock`} aria-label={`Uganda time ${h % 12 || 12}:${mins} ${h < 12 ? "AM" : "PM"}`}>
      <span className="seg-row">
        <svg viewBox={`-4 -2 ${width + 6} ${DIGIT_H + 4}`} className="seg-svg" aria-hidden="true">
          <Digit figure={hour[0] === " " ? "" : hour[0]} x={0} />
          <Digit figure={hour[1]} x={step} />
          <g className={even ? "seg-on" : "seg-off"}>
            <rect x={colonX} y={DIGIT_H * 0.27} width={5.5} height={5.5} />
            <rect x={colonX - 2} y={DIGIT_H * 0.64} width={5.5} height={5.5} />
          </g>
          <Digit figure={mins[0]} x={step * 2 + 14} />
          <Digit figure={mins[1]} x={step * 3 + 14} />
        </svg>
        <small className="seg-ampm">{h < 12 ? "AM" : "PM"}</small>
      </span>
      {big ? (
        <span className="seg-days" aria-hidden="true">
          {WEEK.map((day, index) => (
            <i key={day} className={index === today ? "is-today" : ""}>
              {day}
            </i>
          ))}
        </span>
      ) : null}
    </span>
  );
}

/** How long a verse takes to glide across the screen at a calm reading pace (right to left). */
function tickerSeconds(words: string) {
  return Math.max(6, (words.length * 8.5 + 320) / 48);
}

function isOn(p: FmProgramme, nowMin: number) {
  return p.endMin > p.startMin ? nowMin >= p.startMin && nowMin < p.endMin : nowMin >= p.startMin || nowMin < p.endMin;
}

// ---- Reminders: tap 🔔 on a programme; when it starts (Porchbook open), a strip and a notification say so.
const REMIND_KEY = "porch-fm-remind";
function readReminders(): number[] {
  try {
    return (JSON.parse(localStorage.getItem(REMIND_KEY) || "[]") as number[]).filter((n) => typeof n === "number");
  } catch {
    return [];
  }
}
function writeReminders(ids: number[]) {
  try {
    localStorage.setItem(REMIND_KEY, JSON.stringify(ids));
  } catch {
    /* fine */
  }
}

/** The programme you asked to be reminded about, as it starts (checked every 20 s while Porchbook is open). */
export function useRadioReminder() {
  const fm = useFm();
  const [due, setDue] = useState<FmProgramme | null>(null);
  const told = useRef(new Set<string>());
  useEffect(() => {
    const check = () => {
      const wanted = readReminders();
      if (!wanted.length || !fm.programmes.length) return;
      const now = fmNow();
      const nowMin = kampalaMinutes(now);
      const day = new Date(now + 3 * 3600000).toISOString().slice(0, 10);
      for (const p of todaysProgrammes(fm.programmes, now)) {
        if (!wanted.includes(p.id)) continue;
        const since = (nowMin - p.startMin + 1440) % 1440;
        const key = `${day}:${p.id}`;
        if (since > 5 || told.current.has(key)) continue;
        told.current.add(key);
        setDue(p);
        try {
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("Porchbook Radio", { body: `${p.name} is starting now. Tap to listen.`, icon: "/logo.png?v=5", tag: key });
          }
        } catch {
          /* the strip still shows */
        }
      }
    };
    check();
    const timer = window.setInterval(check, 20000);
    return () => window.clearInterval(timer);
  }, [fm.programmes]);
  return { due, dismiss: () => setDue(null) };
}

/** A rotary control: drag around it (or up/down) to turn it. value 0..1. */
/** The volume fader: a black keycap on a slot that glows orange up to the level (and breathes with the sound). */
function VolumeFader({ live }: { live: boolean }) {
  const sound = useFmSound();
  const track = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const lastTap = useRef(0);
  const lastStep = useRef(Math.round(sound.volume * 10));

  // The glow breathes with what's playing.
  useEffect(() => {
    const el = glow.current;
    if (!el) return;
    if (!live || sound.muted) {
      el.style.setProperty("--beat", "0");
      return;
    }
    let frame = 0;
    let last = 0;
    const run = (time: number) => {
      frame = window.requestAnimationFrame(run);
      if (time - last < 60) return;
      last = time;
      const levels = readLevels(6);
      const level = levels ? levels.reduce((sum, v) => sum + v, 0) / levels.length : 0.35 + 0.15 * Math.sin(time / 380);
      el.style.setProperty("--beat", Math.max(0, Math.min(1, level * 1.4)).toFixed(2));
    };
    frame = window.requestAnimationFrame(run);
    return () => window.cancelAnimationFrame(frame);
  }, [live, sound.muted]);

  function setFrom(clientY: number) {
    const box = track.current?.getBoundingClientRect();
    if (!box) return;
    const value = Math.max(0, Math.min(1, (box.bottom - clientY) / box.height));
    const rounded = Math.round(value * 100) / 100;
    const step = Math.round(rounded * 10);
    if (step !== lastStep.current) {
      lastStep.current = step;
      try {
        navigator.vibrate?.(4);
      } catch {
        /* no buzz on this phone */
      }
    }
    setSound({ volume: rounded, muted: false });
  }

  const drag = useRef<{ id: number; knob: boolean; startY: number; moved: boolean } | null>(null);
  function down(event: ReactPointerEvent<HTMLDivElement>) {
    const knob = Boolean((event.target as HTMLElement).closest(".rf-knob"));
    drag.current = { id: event.pointerId, knob, startY: event.clientY, moved: false };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* fine without */
    }
    // A tap on the slot jumps there; the knob is dragged from where it is.
    if (!knob) setFrom(event.clientY);
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const now = drag.current;
    if (!now || now.id !== event.pointerId) return;
    if (!now.moved && Math.abs(event.clientY - now.startY) < 4) return;
    now.moved = true;
    setFrom(event.clientY);
  }
  function up(event: ReactPointerEvent<HTMLDivElement>) {
    const now = drag.current;
    drag.current = null;
    if (!now || now.id !== event.pointerId) return;
    // Double-tap the knob: mute this phone (double-tap again to bring the sound back).
    if (now.knob && !now.moved) {
      const at = Date.now();
      if (at - lastTap.current < 350) {
        lastTap.current = 0;
        setSound({ muted: !sound.muted });
      } else lastTap.current = at;
    }
  }

  const level = sound.volume;
  const percent = Math.round(level * 100);
  return (
    <div className={`rf-fader${sound.muted ? " is-muted" : ""}${live ? " is-live" : ""}`}>
      <div
        ref={track}
        className="rf-track"
        role="slider"
        tabIndex={0}
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={sound.muted ? "Muted" : `${percent}%`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowRight") setSound({ volume: Math.min(1, level + 0.05), muted: false });
          if (event.key === "ArrowDown" || event.key === "ArrowLeft") setSound({ volume: Math.max(0, level - 0.05), muted: false });
        }}
        style={{ touchAction: "none", ["--lvl" as string]: String(level) }}
      >
        <span className="rf-slot" />
        <span className="rf-rail" />
        <span ref={glow} className="rf-lit" />
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <span key={t} className="rf-ticks" style={{ ["--t" as string]: String(t) }} />
        ))}
        <span className="rf-knob">
          <i />
        </span>
      </div>
      <p className="rf-read">
        {sound.muted ? (
          <b className="is-red">MUTED</b>
        ) : (
          <>
            VOL<b>{percent}</b>
          </>
        )}
      </p>
    </div>
  );
}

/** 📖 DEVOTIONAL: today's devotional read aloud. The radio steps aside and comes back by itself. */
let devotionAudio: HTMLAudioElement | null = null;
/** When each word of the playing devotional is heard (from the server, with the reading). */
type DevotionTiming = { exact: boolean; lines: { t: string; w: number[] }[] };
let devotionTiming: DevotionTiming | null = null;
let unfollow = () => {};
const devotionListeners = new Set<() => void>();
const tellDevotion = () => devotionListeners.forEach((fn) => fn());
function stopDevotion() {
  if (!devotionAudio) return;
  devotionAudio.pause();
  devotionAudio = null;
  unfollow();
  releaseRadio("radio-devotion");
  tellDevotion();
}
function DevotionKey({ onNote }: { onNote: (text: string) => void }) {
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    devotionListeners.add(fn);
    return () => {
      devotionListeners.delete(fn);
    };
  }, []);
  const [phoneReading, setPhoneReading] = useState(false);
  const stopPhone = useRef<(() => void) | null>(null);
  useEffect(() => () => stopPhone.current?.(), []);
  const playing = Boolean(devotionAudio) || phoneReading;
  /** No recording: read it with the phone's own voice (free, never runs out). */
  async function readWithPhone(why: string) {
    if (!canPhoneSpeak()) {
      onNote(why);
      return;
    }
    setBusy(true);
    const words = await devotionWords().catch(() => null);
    setBusy(false);
    if (!words?.ok || !words.lines.length) {
      onNote(why);
      return;
    }
    setPhoneReading(true);
    holdRadio("radio-devotion", () => stopPhone.current?.());
    stopPhone.current = speakLines(words.lines, () => {
      stopPhone.current = null;
      setPhoneReading(false);
      releaseRadio("radio-devotion");
      onNote("");
    });
    onNote("📖 Reading today's devotional with your phone's voice. Tap 📖 to stop.");
  }
  async function tap() {
    if (stopPhone.current) {
      stopPhone.current();
      return;
    }
    if (devotionAudio) {
      stopDevotion();
      onNote("");
      return;
    }
    // The player is made on the tap itself, so the phone lets it play even if the server takes a while.
    const node = new Audio();
    node.preload = "auto";
    setBusy(true);
    // Making today's reading can take a few minutes: don't keep the button waiting that long.
    const result = await Promise.race([
      devotionVoice().catch(() => null),
      new Promise<{ state: "making" }>((resolve) => window.setTimeout(() => resolve({ state: "making" }), 20000)),
    ]);
    setBusy(false);
    if (!result || result.state !== "ready" || !result.url) {
      await readWithPhone(
        result?.state === "making"
          ? "Today's devotional is being prepared. Try again in a few minutes."
          : result?.state === "failed" && result.error
            ? `Today's devotional couldn't be made: ${result.error}`
            : "Today's devotional isn't ready to listen to yet.",
      );
      return;
    }
    node.src = result.url;
    devotionAudio = node;
    devotionTiming = (result as { timing?: DevotionTiming | null }).timing ?? null;
    const stopFollow = followVolume(node);
    const stopBed = attachBed(node, result.bed ?? null, radioLevel);
    unfollow = () => {
      stopFollow();
      stopBed();
    };
    holdRadio("radio-devotion", () => {
      if (devotionAudio !== node) return;
      node.pause();
      devotionAudio = null;
      unfollow();
      tellDevotion();
      onNote("");
    });
    const finish = () => {
      if (devotionAudio !== node) return;
      devotionAudio = null;
      unfollow();
      releaseRadio("radio-devotion");
      tellDevotion();
      onNote("");
    };
    const started = Date.now();
    node.onended = () => {
      const short = Date.now() - started < 4000;
      finish();
      if (short) onNote("Today's devotional recording came out empty. It's being made again: try again in a few minutes.");
    };
    void node.play().catch((error: unknown) => {
      finish();
      onNote(`The devotional couldn't play on this phone (${error instanceof Error ? error.name : "unknown"}). Tap 📖 again.`);
    });
    onNote("📖 Today's devotional is playing. Tap 📖 to stop; the radio comes back after.");
    tellDevotion();
  }
  return (
    <div className="rf-side">
      <button
        type="button"
        className={`rf-round${playing ? " is-pressed" : ""}`}
        aria-label={playing ? "Stop the devotional" : "Listen to today's devotional"}
        aria-pressed={playing}
        disabled={busy}
        onClick={() => void tap()}
      >
        <span className="rf-cap rf-bell">{busy ? "…" : playing ? "■" : "📖"}</span>
      </button>
      <span className="rf-lbl rf-lbl-dev">HEAR THE DEVOTIONAL</span>
    </div>
  );
}

/** The devotional playing on this phone (or null), kept in step with the 📖 key. */
function useDevotionNode() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    devotionListeners.add(fn);
    return () => {
      devotionListeners.delete(fn);
    };
  }, []);
  return devotionAudio;
}

function clockLeft(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The devotional's words rolling up the screen in step with the voice: the word being said in gold. */
function DevotionWords({ node, timing }: { node: HTMLAudioElement; timing: DevotionTiming }) {
  // Every word, in order, with when it is heard and which line it belongs to.
  const words = useMemo(() => {
    const out: { text: string; at: number; line: number }[] = [];
    timing.lines.forEach((line, li) => line.t.split(/\s+/).filter(Boolean).forEach((text, wi) => out.push({ text, at: line.w[wi] ?? 0, line: li })));
    return out;
  }, [timing]);
  const [now, setNow] = useState(-1);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      // The word being said: the last one whose time has come.
      const t = node.currentTime;
      let lo = 0;
      let hi = words.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (words[mid].at <= t + 0.05) {
          found = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      setNow((prev) => (prev === found ? prev : found));
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [node, words]);
  // Keep the word being said in the middle of the window.
  const win = useRef<HTMLDivElement>(null);
  const roll = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useEffect(() => {
    const box = win.current;
    const inner = roll.current;
    if (!box || !inner || now < 0) return;
    const word = inner.querySelector<HTMLElement>(`[data-w="${now}"]`);
    if (!word) return;
    const target = Math.max(0, word.offsetTop + word.offsetHeight / 2 - box.clientHeight / 2);
    setShift((prev) => (Math.abs(prev - target) < 2 ? prev : target));
  }, [now]);
  let index = 0;
  return (
    <div ref={win} className="hifi-prompt" aria-live="off">
      <div ref={roll} className="hifi-prompt-roll" style={{ transform: `translateY(${-shift}px)` }}>
        {timing.lines.map((line, li) => (
          <p key={li}>
            {line.t
              .split(/\s+/)
              .filter(Boolean)
              .map((text) => {
                const i = index++;
                return (
                  <span key={i} data-w={i} className={i === now ? "is-now" : i < now ? "is-read" : ""}>
                    {text}{" "}
                  </span>
                );
              })}
          </p>
        ))}
      </div>
    </div>
  );
}

/** While the devotional is read: its words rolling up (or its Further Study scriptures), a progress line, time left. */
function DevotionScreen({ node, refs, onOpen }: { node: HTMLAudioElement; refs: StudyRef[]; onOpen: (ref: StudyRef) => void }) {
  const [at, setAt] = useState(0);
  const [words, setWords] = useState("");
  const [time, setTime] = useState({ now: 0, length: 0 });
  const shown = refs.length ? refs[((at % refs.length) + refs.length) % refs.length] : null;
  useEffect(() => {
    const timer = window.setInterval(() => setTime({ now: node.currentTime, length: Number.isFinite(node.duration) ? node.duration : 0 }), 500);
    return () => window.clearInterval(timer);
  }, [node]);
  useEffect(() => {
    if (!shown) return;
    let alive = true;
    setWords("");
    void studyText(shown).then((text) => alive && setWords(text)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [shown?.label]);
  // Move on by itself, so each scripture gets its share of the reading (at least 20 seconds).
  useEffect(() => {
    if (refs.length < 2) return;
    const share = time.length ? Math.max(20, time.length / refs.length) : 30;
    const timer = window.setTimeout(() => setAt((n) => n + 1), share * 1000);
    return () => window.clearTimeout(timer);
  }, [at, refs.length, Math.round(time.length)]);
  const share = time.length ? Math.min(1, time.now / time.length) : 0;
  return (
    <div className="hifi-dev" role="status">
      <span className="hifi-word-head">
        📖 TODAY'S DEVOTIONAL{refs.length ? " · FURTHER STUDY" : ""}
        {refs.length > 1 ? <i>{`${(((at % refs.length) + refs.length) % refs.length) + 1}/${refs.length}`}</i> : null}
      </span>
      {devotionTiming?.lines.length ? <DevotionWords node={node} timing={devotionTiming} /> : null}
      {shown ? (
        <>
          <span className={`hifi-dev-row${devotionTiming?.lines.length ? " is-small" : ""}`}>
            {refs.length > 1 ? (
              <button type="button" className="hifi-dev-step" aria-label="Previous scripture" onClick={() => setAt((n) => n - 1)}>
                ◀
              </button>
            ) : null}
            <button type="button" className="hifi-dev-ref" onClick={() => onOpen(shown)} aria-label={`Open ${shown.label} in the Bible`}>
              {shown.label} <small>TAP TO OPEN</small>
            </button>
            {refs.length > 1 ? (
              <button type="button" className="hifi-dev-step" aria-label="Next scripture" onClick={() => setAt((n) => n + 1)}>
                ▶
              </button>
            ) : null}
          </span>
          {devotionTiming?.lines.length ? null : <span className="hifi-dev-words">{words || "…"}</span>}
        </>
      ) : devotionTiming?.lines.length ? null : (
        <span className="hifi-dev-words">Listening to today's devotional.</span>
      )}
      <span className="hifi-dev-time">
        <span className="hifi-dev-line">
          <i style={{ width: `${share * 100}%` }} />
        </span>
        <b>{time.length ? `${clockLeft(time.length - time.now)} left` : ""}</b>
      </span>
      <span className="hifi-dev-note">● Reading now</span>
    </div>
  );
}

export function RadioFace({ onClose }: { onClose?: () => void } = {}) {
  const fm = useFm();
  const sound = useFmSound();
  const lite = useLite();
  const [mode, setMode] = useState<Mode>("bars");
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [reminders, setReminders] = useState<number[]>([]);
  const [, setTick] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = fm.status === "on";
  const onAir = fm.onAir ?? (fm.loaded ? peekOnAir() : null);
  const [skipping, setSkipping] = useState(false);
  const screenMessage = useOnAirMessage(onAir?.breakId);

  useEffect(() => {
    setReminders(readReminders());
    const timer = window.setInterval(() => setTick((n) => n + 1), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const now = fmNow();
  const nowMin = kampalaMinutes(now);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read with the clock
  const today = useMemo(() => todaysProgrammes(fm.programmes, now), [fm.programmes, Math.floor(now / 60000)]);
  const next = today.find((p) => p.startMin > nowMin);

  // "Further study": the day's devotional scriptures, one at a time, with their words scrolling.
  const { user } = useCurrentUserState();
  const [refs, setRefs] = useState<StudyRef[]>([]);
  const [refAt, setRefAt] = useState(0);
  const [refWords, setRefWords] = useState("");
  const [reading, setReading] = useState<StudyRef | null>(null);
  useEffect(() => {
    const found = todaysFurtherStudy();
    setRefs(found);
    if (found.length || !user?.id) return;
    // Not kept on this phone yet: fetch today's devotional quietly, then read it.
    const seed = { displayName: user.displayName ?? "", email: user.primaryEmail ?? null, imageUrl: user.profileImageUrl ?? null };
    void refreshDevotion(seed).then(() => setRefs(todaysFurtherStudy())).catch(() => undefined);
  }, [user?.id]);
  const shownRef = refs.length ? refs[refAt % refs.length] : null;
  const devNode = useDevotionNode();
  useEffect(() => {
    if (mode !== "word" || !shownRef) return;
    let alive = true;
    setRefWords("");
    void studyText(shownRef).then((words) => alive && setRefWords(words)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [mode, shownRef?.label]);
  useEffect(() => {
    if (mode !== "word" || refs.length < 2) return;
    // Long passages stay up longer, so they can be read as they scroll.
    const hold = tickerSeconds(refWords) * 1000 + 600;
    const timer = window.setTimeout(() => setRefAt((n) => n + 1), hold);
    return () => window.clearTimeout(timer);
  }, [mode, refAt, refs.length, refWords.length]);
  const modes: Mode[] = ["bars", ...(refs.length ? (["word"] as Mode[]) : []), ...(today.length ? (["today"] as Mode[]) : []), "clock"];
  useEffect(() => {
    if (mode === "today" && !today.length) setMode("bars");
    if (mode === "word" && !refs.length) setMode("bars");
  }, [mode, today.length, refs.length]);
  const nextMode = () => setMode((m) => modes[(modes.indexOf(m) + 1) % modes.length] ?? "bars");

  // The level bars: the real sound when the sound engine is on, otherwise a lively stand-in while playing.
  useEffect(() => {
    const el = canvas.current;
    if (!el || mode !== "bars") return;
    const pen = el.getContext("2d");
    if (!pen) return;
    let frame = 0;
    let last = 0;
    const fake = Array.from({ length: WAVE_COLUMNS }, () => 0.02);
    const draw = (time: number) => {
      frame = window.requestAnimationFrame(draw);
      if (time - last < 50) return;
      last = time;
      const real = readLevels(12);
      const playing = fm.status === "on" && !sound.muted && !lite;
      const levels = real && !sound.muted ? spreadLevels(real.map((v) => Math.min(1, v * 1.15))) : fakeWave(time, playing, fake);
      drawWave(pen, el.width, el.height, levels);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [mode, fm.status, sound.muted, lite]);

  // The EQ, MONO and tone knobs are gone: anyone who had changed them gets the plain sound back.
  useEffect(() => {
    if (sound.preset !== "normal" || sound.mono || sound.hi || sound.mid || sound.low) setSound({ preset: "normal", mono: false, hi: 0, mid: 0, low: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on opening
  }, []);
  const powered = live || fm.status === "tuning";

  return (
    <div className={`hifi${lite ? " is-lite" : ""}`}>
      <p className="hifi-brand">
        <span className="butterfly butterfly-still hifi-brand-fly" aria-hidden="true">
          <img src="/wing-left.png?v=5" alt="" className="butterfly-wing butterfly-left" />
          <img src="/wing-right.png?v=5" alt="" className="butterfly-wing butterfly-right" />
        </span>
        <span>PORCHBOOK RADIO</span>
      </p>
      <div className={`hifi-screen${devNode ? " is-devotion" : ""}`}>
        <div className="hifi-line" />
        {devNode ? <DevotionScreen node={devNode} refs={refs} onOpen={setReading} /> : null}
        {/* A nugget (station break) takes the screen while it plays. */}
        {!devNode && fm.status === "on" && onAir?.track.kind === "nugget" ? <NuggetScreen key={onAir.track.id} onAir={onAir} /> : null}
        {!devNode && fm.status === "on" && onAir?.track.kind === "bible" ? <BibleScreen key={onAir.track.id} onAir={onAir} onOpen={setReading} /> : null}
        {fm.status === "tuning" && !devNode ? (
          <div className="hifi-tuning">
            <PorchLoader size={112} label="Tuning in" />
          </div>
        ) : null}
        {!screenMessage && mode === "bars" && fm.status !== "tuning" ? <canvas ref={canvas} className="hifi-bars" width={480} height={150} aria-hidden="true" /> : null}
        {screenMessage ? (
          // A request on air takes the screen: it runs across like the scripture does.
          <div className="hifi-word is-request" role="status">
            <span className="hifi-word-head">
              {/^Dedication/.test(screenMessage) ? "DEDICATION · NOW PLAYING" : "REQUEST · NOW PLAYING"}
              <i>🎵</i>
            </span>
            <span className="hifi-word-ref">{onAir?.track.title ?? ""}</span>
            <span className="hifi-word-window">
              <span key={screenMessage} className="hifi-word-text is-looping" style={{ animationDuration: `${tickerSeconds(screenMessage)}s` }}>
                {screenMessage.replace(/^Request · from /, "Requested by ").replace(/^Dedication · /, "A dedication ")}
              </span>
            </span>
          </div>
        ) : null}
        {!screenMessage && mode === "word" && shownRef ? (
          <button type="button" className="hifi-word" onClick={() => setReading(shownRef)} aria-label={`Open ${shownRef.label} in the Bible`}>
            <span className="hifi-word-head">
              FURTHER STUDY · TODAY
              {refs.length > 1 ? <i>{`${(refAt % refs.length) + 1}/${refs.length}`}</i> : null}
            </span>
            <span className="hifi-word-ref">{shownRef.label}</span>
            <span className="hifi-word-window">
              <span key={shownRef.label + refWords.length} className={`hifi-word-text${refs.length < 2 ? " is-looping" : ""}`} style={{ animationDuration: `${tickerSeconds(refWords)}s` }}>
                {refWords || "…"}
              </span>
            </span>
          </button>
        ) : null}
        {!screenMessage && mode === "today" && today.length ? (
          <ul className="hifi-today">
            {today.map((p) => {
              const on = reminders.includes(p.id);
              return (
                <li key={p.id} className={isOn(p, nowMin) ? "is-now" : ""}>
                  <button
                    type="button"
                    className="hifi-today-bell"
                    aria-label={on ? `Stop reminding me about ${p.name}` : `Remind me when ${p.name} starts`}
                    aria-pressed={on}
                    onClick={() => {
                      const nextList = on ? reminders.filter((id) => id !== p.id) : [...reminders, p.id];
                      setReminders(nextList);
                      writeReminders(nextList);
                      setNote(on ? "" : `You'll be told when ${p.name} starts (while Porchbook is open).`);
                      try {
                        if (!on && "Notification" in window && Notification.permission === "default") void Notification.requestPermission();
                      } catch {
                        /* the strip still shows */
                      }
                    }}
                  >
                    {on ? "🔔" : "🔕"}
                  </button>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span>
                    {clockLabel(p.startMin)}–{clockLabel(p.endMin)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
        {!screenMessage && mode === "clock" ? (
          <p className="hifi-bigclock">
            <UgandaClock className="hifi-bigclock-time" big />
          </p>
        ) : null}
        <div className="hifi-info">
          <div className="min-w-0">
            <p className={`hifi-air${live ? " is-live" : ""}`}>{live ? "● ON AIR" : fm.status === "tuning" ? "TUNING IN…" : sound.muted ? "MUTED" : "○ OFF"}</p>
            <p className="hifi-now">{onAir?.track.title ?? (fm.loaded ? "Nothing on air right now" : "Loading…")}</p>
            <p className="hifi-next">
              {onAir ? `${onAir.programme} · ${KIND_LABEL[onAir.track.kind] ?? "Audio"}` : ""}
              {next ? ` · Next ${clockLabel(next.startMin)} ${next.name}` : ""}
            </p>
          </div>
          {mode !== "clock" ? <UgandaClock className="hifi-clock" /> : null}
        </div>
        <div className="hifi-line" />
        {!powered && fm.loaded ? (
          <button type="button" className="rf-listen" onClick={() => void tuneIn()}>
            ▶ TAP TO LISTEN
          </button>
        ) : null}
      </div>

      <div className="hifi-mid rf-mid">
        <div className="rf-side">
          <button
            type="button"
            className={`rf-round rf-power${powered ? " is-on" : ""}`}
            aria-label={powered ? "Turn the radio off" : "Turn the radio on"}
            aria-pressed={powered}
            disabled={!fm.loaded}
            onClick={() => {
              if (powered) tuneOut();
              else void tuneIn();
            }}
          >
            <span className="rf-cap">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M7.2 6.8a7.5 7.5 0 1 0 9.6 0" strokeWidth="2.4" strokeLinecap="round" />
                <path d="M12 3v8" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </span>
          </button>
          <span className="rf-lbl">POWER</span>
        </div>

        <VolumeFader live={live} />

        <DevotionKey onNote={setNote} />
      </div>

      <div className="hifi-bar">
        <button type="button" onClick={nextMode}>
          MODE
        </button>
        {/* Always REQUEST: you can ask for a song or sermon whether the radio is on or off. */}
        <button
          type="button"
          className={`hifi-ask${asking ? " is-open" : ""}`}
          aria-label="Request a song or sermon"
          aria-expanded={asking}
          onClick={() => {
            setAsking((value) => !value);
          }}
        >
          <W k="radio.request">REQUEST</W>
        </button>
        {fm.founder ? (
          <button
            type="button"
            className={`hifi-next-key${skipping ? " is-busy" : ""}`}
            aria-label="Play the next item (for everyone)"
            disabled={skipping || !fm.loaded}
            onClick={() => {
              setSkipping(true);
              skipFmNext()
                .then(async (result) => {
                  if (!result.ok) {
                    window.alert(result.error);
                    return;
                  }
                  await refreshStation();
                  window.setTimeout(() => setSkipping(false), result.inSec * 1000 + 1500);
                })
                .catch(() => setSkipping(false))
                .finally(() => window.setTimeout(() => setSkipping(false), 12000));
            }}
          >
            {skipping ? "…" : "⏭ NEXT"}
          </button>
        ) : null}
        {onClose ? (
          <button type="button" aria-label="Close the radio (it keeps playing)" onClick={onClose}>
            ✕ CLOSE
          </button>
        ) : null}
      </div>

      {reading
        ? createPortal(
            <Suspense fallback={null}>
              <BibleReader onBack={() => setReading(null)} passage={{ book: reading.book, chapter: reading.chapter, verse: reading.from }} />
            </Suspense>,
            document.body,
          )
        : null}
      {note ? <p className="hifi-note">{note}</p> : null}
      {fm.note ? <p className="hifi-note">{fm.note}</p> : null}

      {asking ? <RequestPanel onClose={() => setAsking(false)} /> : null}
    </div>
  );
}
