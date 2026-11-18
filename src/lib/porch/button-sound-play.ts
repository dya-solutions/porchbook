import { loadButtonSound } from "@/lib/porch/button-sound";

type SoundSeed = { displayName: string; email: string | null; imageUrl: string | null };

let clip: HTMLAudioElement | null = null;
let signClip: HTMLAudioElement | null = null;
let openClip: HTMLAudioElement | null = null;
let bellClip: HTMLAudioElement | null = null;
let bendClip: HTMLAudioElement | null = null;
let extraClip: HTMLAudioElement | null = null;
let stamp = "";
let signStamp = "";
let openStamp = "";
let bellStamp = "";
let bendStamp = "";
let extraStamp = "";
let extraBelongs: "tap" | "sign" | "open" | "bell" | "bend" | "drop" = "drop";
let loading: Promise<void> | null = null;
let generation = 0;
let opened = false;
let waitingTap = false;
let skipNextButton = false;
const BUTTON_LOUD = 0.32;

function quiet(node: HTMLAudioElement) {
  node.volume = BUTTON_LOUD;
}

function put(which: "tap" | "sign" | "open" | "bell" | "bend" | "extra", mime: string, audio: string, updatedAt: string) {
  const current =
    which === "tap" ? clip : which === "sign" ? signClip : which === "open" ? openClip : which === "bell" ? bellClip : which === "bend" ? bendClip : extraClip;
  const known =
    which === "tap" ? stamp : which === "sign" ? signStamp : which === "open" ? openStamp : which === "bell" ? bellStamp : which === "bend" ? bendStamp : extraStamp;
  if (!audio) {
    if (which === "tap") {
      clip = null;
      stamp = "";
    } else if (which === "sign") {
      signClip = null;
      signStamp = "";
    } else if (which === "open") {
      openClip = null;
      openStamp = "";
    } else if (which === "bell") {
      bellClip = null;
      bellStamp = "";
    } else if (which === "bend") {
      bendClip = null;
      bendStamp = "";
    } else {
      extraClip = null;
      extraStamp = "";
    }
    return;
  }
  if (known === updatedAt && current) return;
  const binary = atob(audio);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (which === "tap" || which === "extra") {
    rawClick[which] = bytes.buffer.slice(0);
    decodedClick[which] = null;
    decodeClick(which);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime || "audio/mpeg" }));
  const next = current ?? new Audio();
  next.src = url;
  next.preload = "auto";
  quiet(next);
  if (which === "tap") {
    clip = next;
    stamp = updatedAt;
  } else if (which === "sign") {
    signClip = next;
    signStamp = updatedAt;
  } else if (which === "open") {
    openClip = next;
    openStamp = updatedAt;
  } else if (which === "bell") {
    bellClip = next;
    bellStamp = updatedAt;
  } else if (which === "bend") {
    bendClip = next;
    bendStamp = updatedAt;
  } else {
    extraClip = next;
    extraStamp = updatedAt;
  }
}

function own(action: typeof extraBelongs) {
  return extraBelongs === action ? extraClip : null;
}

function armOpeningTap() {
  const node = own("open") ?? openClip;
  if (waitingTap || opened || !node) return;
  waitingTap = true;
  const once = () => {
    window.removeEventListener("pointerdown", once, true);
    if (!waitingTap || !node) return;
    waitingTap = false;
    opened = true;
    skipNextButton = true;
    quiet(node);
    try {
      node.currentTime = 0;
    } catch {
      return;
    }
    void node.play().catch(() => undefined);
  };
  window.addEventListener("pointerdown", once, true);
}

export function playOpeningSound() {
  const node = own("open") ?? openClip;
  if (opened || !node) return;
  try {
    quiet(node);
    node.currentTime = 0;
  } catch {
    armOpeningTap();
    return;
  }
  void node.play().then(() => {
    opened = true;
  }).catch(() => {
    armOpeningTap();
  });
}

export function refreshButtonSound(seed: SoundSeed) {
  generation += 1;
  stamp = "";
  signStamp = "";
  openStamp = "";
  bellStamp = "";
  bendStamp = "";
  extraStamp = "";
  loading = null;
  void ensureButtonSound(seed);
}

export function ensureButtonSound(seed: SoundSeed) {
  if (typeof window === "undefined") return Promise.resolve();
  if (loading) return loading;
  const mine = generation;
  loading = loadButtonSound({ data: seed })
    .then((result) => {
      if (mine !== generation) return;
      put("tap", result.mime, result.audio, result.updatedAt);
      put("sign", result.signMime, result.signAudio, result.signUpdatedAt);
      put("open", result.openMime, result.openAudio, result.openUpdatedAt);
      put("bell", result.bellMime, result.bellAudio, result.bellUpdatedAt);
      put("bend", result.bendMime, result.bendAudio, result.bendUpdatedAt);
      extraBelongs = result.extraBelongs === "tap" || result.extraBelongs === "sign" || result.extraBelongs === "open" || result.extraBelongs === "bell" || result.extraBelongs === "bend" || result.extraBelongs === "drop" ? result.extraBelongs : "drop";
      put("extra", result.extraMime, result.extraAudio, result.extraUpdatedAt);
      playOpeningSound();
    })
    .catch(() => {
      if (mine === generation) loading = null;
    });
  return loading;
}

let bendCtx: AudioContext | null = null;
let bendGain: GainNode | null = null;
let bendWired: HTMLAudioElement | null = null;
let bendHold = 0;

function bendNode() {
  return own("bend") ?? bendClip;
}

function bendAudio() {
  const node = bendNode();
  if (!node) return null;
  if (bendWired !== node) {
    const ctx = bendCtx ?? new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    ctx.createMediaElementSource(node).connect(gain).connect(ctx.destination);
    bendCtx = ctx;
    bendGain = gain;
    bendWired = node;
  }
  return bendCtx;
}

export function playBendSound() {
  const node = bendNode();
  if (!node) return;
  quiet(node);
  const ctx = bendAudio();
  if (!ctx || !bendGain) return;
  bendHold += 1;
  void ctx.resume();
  const now = ctx.currentTime;
  bendGain.gain.cancelScheduledValues(now);
  bendGain.gain.setValueAtTime(0, now);
  bendGain.gain.linearRampToValueAtTime(BUTTON_LOUD, now + 0.01);
  try {
    node.currentTime = 0;
  } catch {
    return;
  }
  void node.play().catch(() => undefined);
}

export function stopBendSound() {
  const node = bendNode();
  if (!node || !bendCtx || !bendGain) {
    node?.pause();
    return;
  }
  const mine = bendHold;
  const now = bendCtx.currentTime;
  bendGain.gain.cancelScheduledValues(now);
  bendGain.gain.setValueAtTime(bendGain.gain.value, now);
  bendGain.gain.linearRampToValueAtTime(0, now + 0.016);
  window.setTimeout(() => {
    if (mine !== bendHold || !node) return;
    node.pause();
  }, 20);
}

export function playDropSound() {
  const node = own("drop");
  if (node) {
    try {
      quiet(node);
      node.currentTime = 0;
    } catch {
      return;
    }
    void node.play().catch(() => undefined);
    return;
  }
  const ctx = bendCtx ?? new AudioContext();
  bendCtx = ctx;
  void ctx.resume();
  const now = ctx.currentTime;
  const tone = ctx.createOscillator();
  const gain = ctx.createGain();
  tone.type = "sine";
  tone.frequency.setValueAtTime(1120, now);
  tone.frequency.exponentialRampToValueAtTime(210, now + 0.22);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.07, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
  tone.connect(gain).connect(ctx.destination);
  tone.start(now);
  tone.stop(now + 0.27);
}

export function playOfficeBell() {
  const node = own("bell") ?? bellClip;
  if (!node) return;
  quiet(node);
  try {
    node.currentTime = 0;
  } catch {
    return;
  }
  void node.play().catch(() => undefined);
}

// The tap/switch click plays through Web Audio: every press starts a fresh
// copy from the very beginning, so no leftover "tail" of the previous play
// can sound first (HTMLAudio rewinds are not clean on phones). It is kept to
// a short click with a quick fade, whatever length was uploaded.
const CLICK_MAX = 0.09; // the longest a click may last, in seconds
const CLICK_MIN = 0.02;
const CLICK_FADE = 0.012;
// Where the click is inside the uploaded sound: its start and length.
const clickWindow: Record<"tap" | "extra", { start: number; length: number } | null> = { tap: null, extra: null };

/**
 * Find just the click in an uploaded sound: skip any silence at the start,
 * then stop as soon as the sound has dropped well below its peak (the
 * ringing "tail" after the click), and never longer than CLICK_MAX.
 */
function findClick(buffer: AudioBuffer) {
  const rate = buffer.sampleRate;
  const total = buffer.length;
  const env = new Float32Array(total);
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < total; i += 1) env[i] = Math.max(env[i], Math.abs(data[i]));
  }
  let peak = 0;
  for (let i = 0; i < total; i += 1) if (env[i] > peak) peak = env[i];
  if (peak <= 0) return { start: 0, length: Math.min(buffer.duration, CLICK_MAX) };
  // Smooth over 3 ms so single samples don't fool the edges.
  const win = Math.max(1, Math.round(rate * 0.003));
  const smooth = new Float32Array(total);
  let run = 0;
  for (let i = 0; i < total; i += 1) {
    run += env[i];
    if (i >= win) run -= env[i - win];
    smooth[i] = run / Math.min(i + 1, win);
  }
  let loud = 0;
  let loudAt = 0;
  for (let i = 0; i < total; i += 1) {
    if (smooth[i] > loud) {
      loud = smooth[i];
      loudAt = i;
    }
  }
  // The click is the loudest moment. Walk back to where it begins (at most
  // 20 ms) so any leftover ring BEFORE it is skipped...
  let onset = loudAt;
  const back = Math.max(0, loudAt - Math.round(rate * 0.02));
  while (onset > back && smooth[onset - 1] > loud * 0.45) onset -= 1;
  onset = Math.max(0, onset - win);
  // ...and forward to where it has died down, so the ring AFTER it is cut.
  const limit = Math.min(total, onset + Math.round(rate * CLICK_MAX));
  let end = limit;
  for (let i = loudAt; i < limit; i += 1) {
    if (i - onset > rate * CLICK_MIN && smooth[i] < loud * 0.35) {
      end = i;
      break;
    }
  }
  const start = onset / rate;
  const length = Math.min(CLICK_MAX, Math.max(CLICK_MIN, (end - onset) / rate + CLICK_FADE));
  return { start, length };
}
const rawClick: Record<"tap" | "extra", ArrayBuffer | null> = { tap: null, extra: null };
const decodedClick: Record<"tap" | "extra", AudioBuffer | null> = { tap: null, extra: null };
const decodingClick: Record<"tap" | "extra", boolean> = { tap: false, extra: false };
let clickCtx: AudioContext | null = null;

function clickContext() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  clickCtx ??= new Ctor();
  return clickCtx;
}

function decodeClick(which: "tap" | "extra") {
  const raw = rawClick[which];
  const ctx = clickContext();
  if (!raw || !ctx || decodedClick[which] || decodingClick[which]) return;
  decodingClick[which] = true;
  void ctx
    .decodeAudioData(raw.slice(0))
    .then((buffer) => {
      if (rawClick[which] === raw) {
        decodedClick[which] = buffer;
        clickWindow[which] = findClick(buffer);
      }
    })
    .catch(() => undefined)
    .finally(() => {
      decodingClick[which] = false;
    });
}

function playClick(which: "tap" | "extra") {
  const buffer = decodedClick[which];
  const ctx = clickCtx;
  if (!buffer || !ctx) {
    decodeClick(which);
    return false;
  }
  void ctx.resume();
  const now = ctx.currentTime;
  const window_ = clickWindow[which] ?? { start: 0, length: Math.min(buffer.duration, CLICK_MAX) };
  const length = window_.length;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(BUTTON_LOUD, now);
  gain.gain.setValueAtTime(BUTTON_LOUD, now + Math.max(0, length - CLICK_FADE));
  gain.gain.linearRampToValueAtTime(0, now + length);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(gain).connect(ctx.destination);
  source.start(now, window_.start, length);
  return true;
}

export function playButtonSound() {
  if (skipNextButton) {
    skipNextButton = false;
    return;
  }
  const which = own("tap") ? "extra" : "tap";
  if (playClick(which)) return;
  const node = own("tap") ?? clip;
  if (!node) return;
  // First press only (before the click is ready): play it short.
  window.setTimeout(() => node.pause(), CLICK_MAX * 1000);
  quiet(node);
  try {
    node.currentTime = 0;
  } catch {
    return;
  }
  void node.play().catch(() => undefined);
}

export function playSignOutSound() {
  const node = own("sign") ?? signClip;
  if (!node) return Promise.resolve();
  quiet(node);
  try {
    node.currentTime = 0;
  } catch {
    return Promise.resolve();
  }
  const done = new Promise<void>((resolve) => {
    const finish = () => resolve();
    node.addEventListener("ended", finish, { once: true });
    window.setTimeout(finish, 8000);
    void node.play().catch(finish);
  });
  return done;
}
