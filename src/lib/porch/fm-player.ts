import { useSyncExternalStore } from "react";
import { getFm, pingFm } from "@/lib/porch/fm";
import { attachBed, type Bed } from "@/lib/porch/devotion-bed";
import { isNewsIntro, onAirAt, type FmBreak, type FmProgramme, type FmTrack, type OnAir } from "@/lib/porch/fm-schedule";

/**
 * The one Porchbook Radio radio on this phone. It lives outside React so it keeps
 * playing while the member moves between pages. Like real radio it is always
 * "live": pausing and coming back jumps to what is on air now.
 */
export type FmStatus = "off" | "tuning" | "on" | "silent";
export type FmView = {
  status: FmStatus;
  onAir: OnAir | null;
  note: string;
  tracks: FmTrack[];
  /** Nuggets: short clips played between items, like station breaks. */
  nuggets: FmTrack[];
  programmes: FmProgramme[];
  breaks: FmBreak[];
  studio: boolean;
  founder?: boolean;
  /** The devotional's strings, played under items marked for it. */
  bed?: Bed;
  loaded: boolean;
};

let view: FmView = { status: "off", onAir: null, note: "", tracks: [], nuggets: [], programmes: [], breaks: [], studio: false, loaded: false };
const listeners = new Set<() => void>();
let audio: HTMLAudioElement | null = null;
let skewMs = 0; // server clock minus this phone's clock
let advanceTimer = 0;
let loading: Promise<void> | null = null;
let pingTimer = 0;
let fadeTimer = 0;
let tuneTurn = 0;
let fadeStep = 0;
const FADE_MS = 1000;

// A song stopped early for a jingle fades out over about a second.
// (iPhones don't allow volume changes on the web, so there it simply stops.)
function stopFade() {
  window.clearTimeout(fadeTimer);
  window.clearInterval(fadeStep);
  fadeTimer = 0;
  fadeStep = 0;
  if (audio) setLevel(audio, 1);
}

function fadeOutAt(atMs: number) {
  window.clearTimeout(fadeTimer);
  fadeTimer = window.setTimeout(() => {
    const node = audio;
    if (!node) return;
    const started = performance.now();
    window.clearInterval(fadeStep);
    fadeStep = window.setInterval(() => {
      const left = 1 - (performance.now() - started) / FADE_MS;
      try {
        setLevel(node, Math.max(0, Math.min(1, left)));
      } catch {
        /* read-only volume */
      }
      if (left <= 0) window.clearInterval(fadeStep);
    }, 40);
  }, Math.max(0, atMs - now()));
}

// While the radio plays, check in once a minute so the Studio can count listeners.
function startPings() {
  if (pingTimer) return;
  const ping = () => void pingFm({ data: { breakId: view.onAir?.breakId ?? 0 } }).catch(() => undefined);
  ping();
  pingTimer = window.setInterval(() => {
    if (view.status === "on" && audio && !audio.paused) ping();
  }, 60000);
}

function stopPings() {
  window.clearInterval(pingTimer);
  pingTimer = 0;
}

let heardBreak = 0;
function publish(patch: Partial<FmView>) {
  view = { ...view, ...patch };
  // A request starts playing while we listen: count us as having heard it, straight away.
  const breakId = view.onAir?.breakId ?? 0;
  if (view.status === "on" && breakId && breakId !== heardBreak) {
    heardBreak = breakId;
    void pingFm({ data: { breakId } }).catch(() => undefined);
  }
  listeners.forEach((fn) => fn());
  tellApp();
}

// In the Porchbook app: keep a "Now playing" notice (with Stop) so the radio keeps playing when minimised.
let told = "";
function tellApp() {
  if (typeof window === "undefined") return;
  const host = window as Window & { PorchApp?: { radio?: (playing: boolean, title: string) => void } };
  if (typeof host.PorchApp?.radio !== "function") return;
  const playing = view.status === "on";
  const title = playing ? (view.onAir?.track.title ?? "") : "";
  const key = `${playing}|${title}`;
  if (key === told) return;
  told = key;
  try {
    host.PorchApp.radio(playing, title);
  } catch {
    /* an older app */
  }
}
if (typeof window !== "undefined") {
  // The notice's Stop button.
  (window as Window & { __porchRadio?: (command: string) => void }).__porchRadio = (command: string) => {
    if (command === "stop") tuneOut();
  };
}

function now() {
  return Date.now() + skewMs;
}

// ---- The listener's own sound: volume, mute, mono, and HI / MID / LOW, kept on this phone.
// Volume and mute work on the player itself. The tone controls (and the moving level bars) need the
// phone's sound engine, which is switched on the first time the listener uses one of them, and only
// when the audio files allow it (otherwise the radio would go silent).
export type FmSound = { volume: number; muted: boolean; mono: boolean; preset: "normal" | "voice" | "music"; hi: number; mid: number; low: number };
const SOUND_KEY = "porch-fm-sound";
const SOUND_DEFAULT: FmSound = { volume: 0.8, muted: false, mono: false, preset: "normal", hi: 0, mid: 0, low: 0 };
const PRESETS: Record<FmSound["preset"], { hi: number; mid: number; low: number }> = {
  normal: { hi: 0, mid: 0, low: 0 },
  voice: { hi: 2, mid: 5, low: -6 },
  music: { hi: 3, mid: -1, low: 5 },
};
let sound: FmSound = SOUND_DEFAULT;
if (typeof window !== "undefined") {
  try {
    sound = { ...SOUND_DEFAULT, ...(JSON.parse(localStorage.getItem(SOUND_KEY) || "{}") as Partial<FmSound>) };
  } catch {
    sound = SOUND_DEFAULT;
  }
}
const soundWatchers = new Set<() => void>();
const baseLevel = new WeakMap<HTMLAudioElement, number>();
let corsOk = false;
const clean = new WeakSet<HTMLAudioElement>(); // its current audio was loaded so the sound engine may read it
let engine: {
  ctx: AudioContext;
  input: GainNode;
  meter: AnalyserNode;
  leveler: GainNode;
  limiter: DynamicsCompressorNode;
  gain: GainNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  mono: GainNode;
  analyser: AnalyserNode;
  sources: WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>;
} | null = null;

/** The listener's radio volume (fader and mute), 0–1. */
export function radioLevel() {
  return userLevel();
}

function userLevel() {
  return sound.muted ? 0 : Math.max(0, Math.min(1, sound.volume));
}

function setLevel(node: HTMLAudioElement, base: number) {
  baseLevel.set(node, base);
  try {
    // With the sound engine on, the listener's volume is applied there.
    node.volume = Math.max(0, Math.min(1, engine ? base : base * userLevel()));
  } catch {
    /* iPhones: volume is read-only on the player */
  }
}

function setSource(node: HTMLAudioElement, url: string) {
  if (corsOk && !url.startsWith("data:")) {
    node.crossOrigin = "anonymous";
    clean.add(node);
  } else if (url.startsWith("data:") || new URL(url, window.location.origin).origin === window.location.origin) {
    clean.add(node);
  } else {
    clean.delete(node);
  }
  node.src = url;
}

async function probeSound(tracks: FmTrack[]) {
  if (corsOk) return;
  const first = tracks.find((track) => !/\.(mp4|m4v|mov|webm|mkv|3gp|avi)(\?|$)/i.test(track.url));
  if (!first) return;
  try {
    const response = await fetch(new URL(first.url, window.location.origin).href, { headers: { Range: "bytes=0-1" }, mode: "cors", cache: "no-store" });
    corsOk = response.ok || response.status === 206;
  } catch {
    corsOk = false;
  }
}

function applyTone() {
  if (!engine) return;
  const t = engine.ctx.currentTime;
  engine.gain.gain.setTargetAtTime(userLevel(), t, 0.05);
  engine.high.gain.setTargetAtTime(sound.hi + PRESETS[sound.preset].hi, t, 0.05);
  engine.mid.gain.setTargetAtTime(sound.mid + PRESETS[sound.preset].mid, t, 0.05);
  engine.low.gain.setTargetAtTime(sound.low + PRESETS[sound.preset].low, t, 0.05);
  engine.mono.channelCount = sound.mono ? 1 : 2;
}

function plug(node: HTMLAudioElement | null) {
  if (!engine || !node || engine.sources.has(node)) return;
  const source = engine.ctx.createMediaElementSource(node);
  source.connect(engine.input);
  engine.sources.set(node, source);
}

/** Switch on the phone's sound engine (call inside a tap). False if this radio's audio can't use it. */
export function engageSound(given?: AudioContext): boolean {
  if (engine) {
    void engine.ctx.resume().catch(() => undefined);
    return true;
  }
  const nodes = [audio, waiting].filter((node): node is HTMLAudioElement => Boolean(node));
  if (!nodes.length || nodes.some((node) => !clean.has(node))) return false;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx && !given) return false;
  try {
    const ctx = given ?? new Ctx();
    // The leveller: loud songs held down, quiet sermons lifted, so everything comes out at a similar loudness.
    const input = ctx.createGain();
    const meter = ctx.createAnalyser();
    meter.fftSize = 2048;
    const leveler = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 2;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    const gain = ctx.createGain();
    const low = ctx.createBiquadFilter();
    low.type = "lowshelf";
    low.frequency.value = 220;
    const mid = ctx.createBiquadFilter();
    mid.type = "peaking";
    mid.frequency.value = 1200;
    mid.Q.value = 0.9;
    const high = ctx.createBiquadFilter();
    high.type = "highshelf";
    high.frequency.value = 4200;
    const mono = ctx.createGain();
    mono.channelCountMode = "explicit";
    mono.channelInterpretation = "speakers";
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    input.connect(meter);
    input.connect(leveler).connect(gain).connect(low).connect(mid).connect(high).connect(limiter).connect(mono).connect(analyser).connect(ctx.destination);
    engine = { ctx, input, meter, leveler, limiter, gain, low, mid, high, mono, analyser, sources: new WeakMap() };
    startLeveler();
    nodes.forEach((node) => {
      plug(node);
      setLevel(node, baseLevel.get(node) ?? 1);
    });
    applyTone();
    void ctx.resume().catch(() => undefined);
    return true;
  } catch {
    engine = null;
    return false;
  }
}

// ---- Levelling: measure how loud the sound is over the last few seconds and ease the gain toward a
// steady loudness (at most 10 dB down or 12 dB up). Silence between items is ignored.
const TARGET_DB = -18;
let levelTimer = 0;
let loudness: number | null = null;
function startLeveler() {
  window.clearInterval(levelTimer);
  const samples = new Float32Array(2048);
  levelTimer = window.setInterval(() => {
    if (!engine || engine.ctx.state !== "running") return;
    engine.meter.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const v of samples) sum += v * v;
    const db = 10 * Math.log10(sum / samples.length + 1e-12);
    if (db < -50) return; // silence or a pause: keep the gain as it is
    loudness = loudness === null ? db : loudness + (db - loudness) * 0.08; // ~3 s memory
    const wantDb = Math.max(-10, Math.min(12, TARGET_DB - loudness));
    engine.leveler.gain.setTargetAtTime(Math.pow(10, wantDb / 20), engine.ctx.currentTime, 1.2);
  }, 250);
}

/** Switch the sound engine on by itself once the radio plays (only when it can't go silent). */
export async function autoEngageSound() {
  if (engine || typeof window === "undefined") return;
  const nodes = [audio, waiting].filter((node): node is HTMLAudioElement => Boolean(node));
  if (!nodes.length || nodes.some((node) => !clean.has(node))) return;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch {
    return;
  }
  // Only route the radio through it if the phone lets it run; otherwise the radio would go quiet.
  await Promise.race([ctx.resume().catch(() => undefined), new Promise((done) => window.setTimeout(done, 800))]);
  if (ctx.state !== "running" || engine) {
    void ctx.close().catch(() => undefined);
    return;
  }
  if (!engageSound(ctx)) void ctx.close().catch(() => undefined);
}

export function getSound() {
  return sound;
}

export function soundEngaged() {
  return Boolean(engine);
}

export function setSound(change: Partial<FmSound>) {
  sound = { ...sound, ...change };
  try {
    localStorage.setItem(SOUND_KEY, JSON.stringify(sound));
  } catch {
    /* fine */
  }
  [audio, waiting].forEach((node) => node && setLevel(node, baseLevel.get(node) ?? 1));
  applyTone();
  soundWatchers.forEach((fn) => fn());
}

export function useFmSound() {
  return useSyncExternalStore(
    (fn) => {
      soundWatchers.add(fn);
      return () => {
        soundWatchers.delete(fn);
      };
    },
    () => sound,
    () => SOUND_DEFAULT,
  );
}

/** Live sound levels for the display's bars (0–1 each), or null when the sound engine is off. */
export function readLevels(count: number): number[] | null {
  if (!engine || view.status !== "on") return null;
  const data = new Uint8Array(engine.analyser.frequencyBinCount);
  engine.analyser.getByteFrequencyData(data);
  const out: number[] = [];
  // Spread the bars over the useful part of the spectrum (low on the left, high on the right).
  const usable = Math.floor(data.length * 0.7);
  for (let k = 0; k < count; k += 1) {
    const from = Math.floor(Math.pow(k / count, 1.6) * usable);
    const to = Math.max(from + 1, Math.floor(Math.pow((k + 1) / count, 1.6) * usable));
    let peak = 0;
    for (let i = from; i < to; i += 1) peak = Math.max(peak, data[i]);
    out.push(peak / 255);
  }
  return out;
}

function makeNode() {
  const node = new Audio();
  node.preload = "auto";
  if (corsOk) node.crossOrigin = "anonymous";
  queueMicrotask(() => plug(node));
  node.addEventListener("ended", () => {
    if (node === audio && view.status === "on") void playLive();
  });
  node.addEventListener("error", () => {
    if (node !== audio) return; // the waiting (pre-loading) player: ignore
    if (view.status !== "on" && view.status !== "tuning") return;
    publish({ note: "That audio couldn't play. Trying what's next…" });
    window.clearTimeout(advanceTimer);
    // The studio may have replaced it (e.g. a processed version): reload the station first.
    advanceTimer = window.setTimeout(() => void loadStation(true).then(() => playLive()), 4000);
  });
  return node;
}

// Two players: one plays, the other quietly loads what comes next, so the
// next item starts the moment this one ends instead of waiting to download.
let waiting: HTMLAudioElement | null = null;
let waitingFor = "";
let preloadTimer = 0;
const SILENT = "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjE2LjEwMAAAAAAAAAAAAAAA//NwwAAAAAAAAAAAAEluZm8AAAAPAAAACAAAA/oAR0dHR0dHR0dHR0dHYmJiYmJiYmJiYmJifHx8fHx8fHx8fHx8fJaWlpaWlpaWlpaWlrGxsbGxsbGxsbGxsbHLy8vLy8vLy8vLy8vl5eXl5eXl5eXl5eXl////////////////AAAAAExhdmM2MC4zMQAAAAAAAAAAAAAAACQC1AAAAAAAAAP6yysejgAAAAAAAAAAAAAAAAD/80DEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsRbAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMSkAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxKMAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxKQAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LEowAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DEpAAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsSjAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==";

function player() {
  if (audio) return audio;
  audio = makeNode();
  return audio;
}

// Keep the sound engine's context awake when listening starts again.
function wakeEngine() {
  if (engine) void engine.ctx.resume().catch(() => undefined);
}

/** Call inside a tap: lets phones (iPhone especially) play the second player later. */
function unlockWaiting() {
  if (waiting) return;
  waiting = makeNode();
  try {
    setSource(waiting, SILENT);
    void waiting.play().then(() => waiting?.pause()).catch(() => undefined);
  } catch {
    /* it still pre-loads; the first switch may just take a moment */
  }
}

function preloadNext(fresh: OnAir) {
  window.clearTimeout(preloadTimer);
  const lead = Math.max(0, fresh.endsAtMs - now() - 25000); // start loading ~25 s before the change
  preloadTimer = window.setTimeout(() => {
    const next = onAirAt([...view.tracks, ...view.nuggets], view.programmes, fresh.endsAtMs + 120, view.breaks);
    if (!next || !waiting) return;
    const url = new URL(next.track.url, window.location.origin).href;
    if (url === audio?.src) return; // same file continues: nothing to load
    if (waitingFor !== url) {
      waitingFor = url;
      setSource(waiting, url);
      waiting.load();
    }
  }, lead);
}
// The station is kept on the phone, so pressing power doesn't wait for the server.
const STATION_KEY = "porch-fm-station";
let fromKept = false;
function keepStation() {
  try {
    const { tracks, nuggets, programmes, breaks, bed } = view;
    localStorage.setItem(STATION_KEY, JSON.stringify({ tracks, nuggets, programmes, breaks, bed: bed ?? null, skewMs, corsOk, at: Date.now() }));
  } catch {
    /* the phone is full: it still works, just a moment slower */
  }
}
function seedStation() {
  if (typeof window === "undefined" || view.loaded) return;
  try {
    const kept = JSON.parse(localStorage.getItem(STATION_KEY) || "null") as
      | { tracks: FmTrack[]; nuggets?: FmTrack[]; programmes: FmProgramme[]; breaks: FmBreak[]; bed: Bed | null; skewMs: number; corsOk: boolean; at: number }
      | null;
    if (!kept || !Array.isArray(kept.tracks) || !kept.tracks.length || Date.now() - kept.at > 7 * 86400000) return;
    skewMs = Number(kept.skewMs) || 0;
    if (kept.corsOk) corsOk = true;
    view = { ...view, tracks: kept.tracks, nuggets: kept.nuggets ?? [], programmes: kept.programmes ?? [], breaks: kept.breaks ?? [], bed: kept.bed ?? null, loaded: true };
    fromKept = true;
    warmOnAir();
  } catch {
    /* nothing kept */
  }
}

// What's on air is made ready before power is pressed (just its details and first moments).
let warmTimer = 0;
function warmOnAir() {
  if (typeof window === "undefined") return;
  window.clearTimeout(warmTimer);
  warmTimer = window.setTimeout(() => {
    if (view.status !== "off" || holds.size) return;
    const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    const onAir = airNow();
    if (!onAir) return;
    const node = player();
    const absolute = new URL(onAir.track.url, window.location.origin).href;
    if (node.src === absolute) return;
    node.preload = "metadata";
    setSource(node, absolute);
  }, 1500);
}

/** Load (or reload) the station: tracks, programmes, and the server clock. */
export function loadStation(force = false) {
  if (typeof window === "undefined") return Promise.resolve();
  if (loading && !force) return loading;
  const sent = Date.now();
  loading = getFm()
    .then((result) => {
      const back = Date.now();
      skewMs = result.serverNow - (sent + back) / 2;
      publish({ tracks: result.tracks, nuggets: (result as { nuggets?: FmTrack[] }).nuggets ?? [], programmes: result.programmes, breaks: result.breaks ?? [], studio: result.studio, founder: Boolean((result as { founder?: boolean }).founder), bed: (result as { bed?: Bed }).bed ?? null, loaded: true });
      fromKept = false;
      void probeSound(result.tracks).then(() => {
        keepStation();
        warmOnAir();
      });
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}

function setMediaSession(onAir: OnAir) {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: onAir.track.title,
      artist: onAir.programme,
      album: "Porchbook Radio",
      artwork: [{ src: "/logo.png?v=5", sizes: "512x512", type: "image/png" }],
    });
    navigator.mediaSession.setActionHandler("play", () => void tuneIn());
    navigator.mediaSession.setActionHandler("pause", () => tuneOut());
  } catch {
    /* lock-screen controls are optional */
  }
}

seedStation();

function airNow() {
  return onAirAt([...view.tracks, ...view.nuggets], view.programmes, now(), view.breaks);
}

// While listening, check about every 10 seconds for a studio "Play now".
let breakPoll = 0;
let lastStationLoad = 0;
function startBreakPoll() {
  if (breakPoll) return;
  breakPoll = window.setInterval(() => {
    void checkBreaks();
    // Every few minutes pick up studio changes (new uploads, processed audio).
    if (Date.now() - lastStationLoad > 5 * 60 * 1000 && view.status === "on") {
      lastStationLoad = Date.now();
      const before = JSON.stringify([...view.tracks, ...view.nuggets].map((t) => [t.id, t.url, t.durationSec]));
      void loadStation(true).then(() => {
        const after = JSON.stringify([...view.tracks, ...view.nuggets].map((t) => [t.id, t.url, t.durationSec]));
        if (after !== before && view.status === "on") carryOn();
      });
    }
  }, 10000);
}
function stopBreakPoll() {
  window.clearInterval(breakPoll);
  breakPoll = 0;
}
async function checkBreaks() {
  if (view.status !== "on") return;
  let breaks: FmBreak[];
  try {
    const response = await fetch("/api/fm-breaks", { cache: "no-store" });
    breaks = ((await response.json()) as { breaks?: FmBreak[] }).breaks ?? [];
  } catch {
    return;
  }
  if (JSON.stringify(breaks) === JSON.stringify(view.breaks)) return;
  // A recording we don't have yet (just uploaded), or the studio changed the
  // list (a new "hold"): reload the station first.
  const known = new Set([...view.tracks, ...view.nuggets].map((t) => t.id));
  const seen = new Set(view.breaks.map((b) => b.id));
  if (breaks.some((b) => !known.has(b.trackId) || (b.hold && !seen.has(b.id)))) {
    await loadStation(true);
    lastStationLoad = Date.now();
  }
  publish({ breaks });
  if (view.status !== "on") return;
  const next = airNow();
  if (next && view.onAir && next.track.id === view.onAir.track.id && next.breakId === view.onAir.breakId) {
    // Same thing still playing; only its end moved (a break is coming): re-arm the timers.
    stopFade();
    armEnd(next);
    publish({ onAir: next });
  } else {
    void playLive();
  }
}

// ---- "It's now 7:45 in the morning, here in Uganda. And this is Porchbook Radio News."
// Spoken by the phone's own voice over the last seconds of the news intro.
const TIME_LINE_LEAD_SEC = 4.5;
let timeLineTimer = 0;

export function newsTimeLine(ms: number) {
  const local = new Date(ms + 3 * 3600_000); // Kampala
  const h = local.getUTCHours();
  const m = local.getUTCMinutes();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const clock = m === 0 ? `${hour12} o'clock` : `${hour12}:${String(m).padStart(2, "0")}`;
  const part = h < 5 || h >= 21 ? "at night" : h < 12 ? "in the morning" : h < 17 ? "in the afternoon" : "in the evening";
  return `It's now ${clock} ${part}, here in Uganda. And this is Porchbook Radio News.`;
}

function speakVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  return voices.find((v) => /en[-_]GB/i.test(v.lang)) ?? voices.find((v) => /^en/i.test(v.lang)) ?? null;
}

function armTimeLine(node: HTMLAudioElement, playing: OnAir) {
  window.clearTimeout(timeLineTimer);
  if (!isNewsIntro(playing.track) || typeof window.speechSynthesis === "undefined") return;
  const waitMs = (playing.track.durationSec - TIME_LINE_LEAD_SEC - playing.offsetSec) * 1000;
  if (waitMs < -1500) return; // tuned in too late for it
  timeLineTimer = window.setTimeout(() => {
    if (audio !== node || view.status !== "on" || view.onAir?.track.id !== playing.track.id) return;
    const line = new SpeechSynthesisUtterance(newsTimeLine(now()));
    const voice = speakVoice();
    if (voice) line.voice = voice;
    line.lang = voice?.lang ?? "en-GB";
    line.rate = 1;
    // The intro dips under the voice (iPhones can't change volume, so there it just plays on).
    try {
      setLevel(node, 0.35);
    } catch {
      /* read-only volume */
    }
    line.onend = line.onerror = () => {
      try {
        if (audio === node) setLevel(node, 1);
      } catch {
        /* read-only volume */
      }
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(line);
  }, Math.max(0, waitMs));
}

function armEnd(fresh: OnAir) {
  window.clearTimeout(advanceTimer);
  const naturalEnd = now() + (fresh.track.durationSec - fresh.offsetSec) * 1000;
  if (fresh.cutEarly || fresh.endsAtMs < naturalEnd - 500) fadeOutAt(fresh.endsAtMs - FADE_MS);
  advanceTimer = window.setTimeout(() => void playLive(), Math.max(300, fresh.endsAtMs - now() + 40));
  preloadNext(fresh);
}

// iPhones often ignore the jump to "now" made before sound starts, and play
// from the beginning instead. Once it is playing, check and jump to the live
// moment if it is more than 2 seconds off (checked twice, then left alone).
let stepTimers: number[] = [];
function keepInStep(node: HTMLAudioElement, playing: OnAir) {
  stepTimers.forEach((t) => window.clearTimeout(t));
  stepTimers = [700, 2500].map((delay) =>
    window.setTimeout(() => {
      if (audio !== node || node.paused || view.status !== "on") return;
      const live = airNow();
      if (!live || live.track.id !== playing.track.id || live.breakId !== playing.breakId) return;
      if (Math.abs(node.currentTime - live.offsetSec) <= 2) return;
      try {
        node.currentTime = Math.max(0, Math.min(live.offsetSec, (node.duration || live.offsetSec + 1) - 0.5));
      } catch {
        /* try again on the next check */
      }
    }, delay),
  );
}

// The strings under a sermon marked for them (stopped whenever the item changes or the radio stops).
let dropStrings = () => {};
function stringsFor(node: HTMLAudioElement, onAir: OnAir) {
  dropStrings();
  dropStrings = () => {};
  if (!onAir.track.strings || !view.bed?.url) return;
  dropStrings = attachBed(node, view.bed, userLevel);
}

// ---- Watchdog: if the radio says it's on but no sound has moved for 4 seconds
// (a stalled download, a phone that paused the player), start what's on air again.
let watchTimer = 0;
let watchLast = -1;
let watchStill = 0;
function startWatchdog() {
  if (watchTimer) return;
  watchLast = -1;
  watchStill = 0;
  watchTimer = window.setInterval(() => {
    const node = audio;
    if (view.status !== "on" || !node || holds.size) {
      watchStill = 0;
      return;
    }
    const t = node.currentTime;
    const stuck = node.paused || node.ended || Math.abs(t - watchLast) < 0.05;
    watchLast = t;
    watchStill = stuck ? watchStill + 1 : 0;
    if (watchStill >= 2) {
      watchStill = 0;
      watchLast = -1;
      void playLive();
    }
  }, 2000);
}
function stopWatchdog() {
  window.clearInterval(watchTimer);
  watchTimer = 0;
}

async function playLive() {
  // Something holds the sound (the devotional, a replay): stay quiet.
  if (holds.size) return;
  const turn = tuneTurn;
  window.clearTimeout(advanceTimer);
  dropStrings();
  dropStrings = () => {};
  stopFade();
  const onAir = airNow();
  if (!onAir) {
    audio?.pause();
    publish({ status: "silent", onAir: null, note: "" });
    return;
  }
  let node = player();
  const absolute = new URL(onAir.track.url, window.location.origin).href;
  // The next item was loaded ahead of time: switch players instead of waiting.
  if (node.src !== absolute && waiting && waitingFor === absolute) {
    const previous = node;
    node = waiting;
    audio = node;
    waiting = previous;
    waitingFor = "";
    try {
      previous.pause();
    } catch {
      /* it stops either way */
    }
    setLevel(previous, 1);
  }
  node.preload = "auto";
  if (node.src !== absolute) setSource(node, absolute);
  if (node.readyState < 1) {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      node.addEventListener("loadedmetadata", done, { once: true });
      node.addEventListener("error", done, { once: true });
      window.setTimeout(done, 5000);
    });
  }
  // Re-read the clock after loading, so a slow connection still lands "live".
  // The radio was stopped or held while loading: don't play over it.
  if (turn !== tuneTurn || holds.size) return;
  const fresh = airNow() ?? onAir;
  if (fresh.track.id !== onAir.track.id) return playLive();
  try {
    node.currentTime = Math.max(0, Math.min(fresh.offsetSec, (node.duration || fresh.offsetSec + 1) - 0.5));
  } catch {
    /* some phones seek once playing */
  }
  try {
    await node.play();
  } catch {
    publish({ status: "off", note: "Tap the power button to start Porchbook Radio." });
    return;
  }
  setLevel(node, 1);
  stringsFor(node, fresh);
  publish({ status: "on", onAir: fresh, note: "" });
  startWatchdog();
  if (!engine) window.setTimeout(() => void autoEngageSound(), 1500);
  setMediaSession(fresh);
  startPings();
  startBreakPoll();
  keepInStep(node, fresh);
  armTimeLine(node, fresh);
  // Fade if stopped early (a song before its jingle, a break, a slot change); move on at the end.
  armEnd(fresh);
}

/** Start listening (must be called from a tap). */
export async function tuneIn() {
  // Starting the radio yourself while something holds it: that thing keeps
  // its hold, but the radio no longer waits to come back.
  resumeAfterHold = false;
  // Only one thing plays at a time: turning the radio on stops the devotional or a replay.
  for (const [reason, stop] of [...holdStops]) {
    holdStops.delete(reason);
    holds.delete(reason);
    try {
      stop();
    } catch {
      /* already stopped */
    }
  }
  player();
  unlockWaiting(); // create inside the tap so phones allow sound
  wakeEngine();
  try {
    // Wake the phone's voice inside the tap too, for the news time line later.
    window.speechSynthesis?.speak(new SpeechSynthesisUtterance(""));
  } catch {
    /* no voice on this phone */
  }
  stopFade();
  publish({ status: "tuning", note: "" });
  claimTab();
  const mine = ++tuneTurn;
  if (!view.loaded) {
    await loadStation(true);
  } else {
    // Already known (kept on the phone): play now; the fresh list follows quietly.
    const before = JSON.stringify([...view.tracks, ...view.nuggets].map((t) => [t.id, t.url, t.durationSec]));
    void loadStation(true).then(() => {
      const after = JSON.stringify([...view.tracks, ...view.nuggets].map((t) => [t.id, t.url, t.durationSec]));
      if (after !== before || fromKept) carryOn();
    });
  }
  if (mine !== tuneTurn || view.status !== "tuning") return;
  await playLive();
  // The leveller and tone knobs work from the start, where the phone allows it.
  window.setTimeout(() => void autoEngageSound(), 1500);
}

/** The listener turns the radio off. */
export function tuneOut() {
  resumeAfterHold = false;
  stopRadio();
}

// Only one Porchbook tab plays the radio: starting it in one tab stops it in the others
// (two tabs playing slightly out of step sound like echo and stutter).
const TAB_ID = Math.random().toString(36).slice(2);
let tabs: BroadcastChannel | null = null;
function tabChannel() {
  if (tabs || typeof window === "undefined" || typeof BroadcastChannel === "undefined") return tabs;
  tabs = new BroadcastChannel("porch-radio");
  tabs.onmessage = (event: MessageEvent<{ type?: string; tab?: string }>) => {
    if (event.data?.type !== "playing" || event.data.tab === TAB_ID) return;
    if (view.status === "on" || view.status === "tuning") {
      tuneOut();
      publish({ note: "Playing in another Porchbook tab." });
    }
  };
  return tabs;
}
tabChannel();
function claimTab() {
  try {
    tabChannel()?.postMessage({ type: "playing", tab: TAB_ID });
  } catch {
    /* one tab only: nothing to tell */
  }
}

// Something else needs the sound (a call, a film, PorchWay's music…): the radio
// steps aside while it lasts, and comes back by itself afterwards if it was on.
const holds = new Set<string>();
let resumeAfterHold = false;

/** Whatever holds the radio (the devotional, a replay) can be stopped when the listener turns the radio on. */
const holdStops = new Map<string, () => void>();
export function holdRadio(reason: string, stop?: () => void) {
  if (stop) holdStops.set(reason, stop);
  if (holds.has(reason)) return;
  if (view.status === "on" || view.status === "tuning" || view.status === "silent") {
    resumeAfterHold = true;
    stopRadio();
  }
  holds.add(reason);
}

export function releaseRadio(reason: string) {
  holdStops.delete(reason);
  if (!holds.delete(reason) || holds.size) return;
  if (resumeAfterHold) {
    resumeAfterHold = false;
    void tuneIn();
  }
}

function stopRadio() {
  stopWatchdog();
  dropStrings();
  dropStrings = () => {};
  tuneTurn += 1;
  window.clearTimeout(timeLineTimer);
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* nothing speaking */
  }
  window.clearTimeout(preloadTimer);
  waiting?.pause();
  stopBreakPoll();
  window.clearTimeout(advanceTimer);
  stopFade();
  stopPings();
  audio?.pause();
  publish({ status: "off" });
}

/**
 * The list changed: if the same item is still on air (the studio's change
 * keeps it playing to its end), leave the sound alone and only re-arm the
 * timers; otherwise move to what is on now.
 */
function carryOn() {
  if (view.status !== "on") return;
  const next = airNow();
  const node = audio;
  const same =
    next &&
    view.onAir &&
    node &&
    !node.paused &&
    next.track.id === view.onAir.track.id &&
    next.breakId === view.onAir.breakId &&
    Math.abs(node.currentTime - next.offsetSec) <= 3;
  if (same && next) {
    stopFade();
    armEnd(next);
    publish({ onAir: next });
  } else {
    void playLive();
  }
}

/** After the studio changes something, refresh and keep playing live (without a jump). */
export async function refreshStation() {
  await loadStation(true);
  lastStationLoad = Date.now();
  if (view.status === "on") carryOn();
  else publish({ onAir: airNow() });
}

/** What's on air right now (without playing), for the sheet. */
export function peekOnAir() {
  return airNow();
}

export function fmNow() {
  return now();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const serverView: FmView = view;
export function useFm() {
  return useSyncExternalStore(subscribe, () => view, () => serverView);
}

/** A message sound is about to play: the radio dips under it for a moment, then comes back. */
let duckTimer = 0;
export function duckRadio(ms: number) {
  if (!audio || view.status !== "on") return;
  const node = audio;
  setLevel(node, 0.3);
  window.clearTimeout(duckTimer);
  duckTimer = window.setTimeout(() => {
    if (audio === node) setLevel(node, 1);
  }, ms);
}

/** Whether the radio is playing (or starting) on this phone. */
export function radioPlaying() {
  return view.status === "on" || view.status === "tuning";
}

/** Another player (the devotional) follows the radio's volume fader and mute. Returns a function to stop following. */
export function followVolume(node: HTMLAudioElement): () => void {
  const apply = () => {
    try {
      node.volume = Math.max(0, Math.min(1, userLevel()));
    } catch {
      /* iPhones: volume is read-only on the player */
    }
  };
  apply();
  soundWatchers.add(apply);
  return () => {
    soundWatchers.delete(apply);
  };
}
