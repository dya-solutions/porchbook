import { getMessageSound } from "@/lib/porch/message-sound";
import { duckRadio } from "@/lib/porch/fm-player";

/**
 * The message sound, played gently: never during quiet hours (10 pm–6 am by the phone's own clock), never during
 * a call, not while you're already reading your messages, and at most once every 30 seconds.
 */

type Seed = { displayName: string; email: string | null; imageUrl: string | null };
const STORE = "porch-message-sound";
const QUIET_FROM = 22; // 10 pm
const QUIET_TO = 6; // 6 am
const REST_MS = 30_000;

let sound: { audio: string; mime: string; updatedAt: string } | null = null;
let asked = false;
let lastPlayed = 0;

if (typeof window !== "undefined") {
  try {
    sound = JSON.parse(localStorage.getItem(STORE) || "null");
  } catch {
    sound = null;
  }
}

export async function refreshMessageSound(seed: Seed, force = false) {
  if (asked && !force) return sound;
  asked = true;
  const result = await getMessageSound({ data: seed });
  if (!result.audio) {
    sound = null;
    try {
      localStorage.removeItem(STORE);
    } catch {
      /* fine */
    }
    return null;
  }
  if (sound?.updatedAt !== result.updatedAt) {
    sound = { audio: result.audio, mime: result.mime, updatedAt: result.updatedAt };
    try {
      localStorage.setItem(STORE, JSON.stringify(sound));
    } catch {
      /* it still plays this visit */
    }
  }
  return sound;
}

function quietNow() {
  // Night by the person's own phone clock, wherever they are.
  const h = new Date().getHours();
  return h >= QUIET_FROM || h < QUIET_TO;
}

/** Play it, if now is a kind moment. Returns whether it played. */
export function playMessageSound({ reading, inCall }: { reading: boolean; inCall: boolean }) {
  if (!sound?.audio || reading || inCall || quietNow()) return false;
  const now = Date.now();
  if (now - lastPlayed < REST_MS) return false;
  lastPlayed = now;
  playData(sound.mime, sound.audio);
  return true;
}

// ---- Ringing for unread messages: on opening Porchbook and when new ones come,
// then twice more, 10 seconds apart (3 rings), and quiet until another message arrives.
const RUNG_KEY = "porch-message-rung";
const RINGS = 3;
const GAP_MS = 10_000;
let rungFor = (() => {
  if (typeof window === "undefined") return 0;
  try {
    return Number(localStorage.getItem(RUNG_KEY)) || 0;
  } catch {
    return 0;
  }
})();
let ringsLeft = 0;
let ringTimer = 0;
let latest = { unread: 0, reading: false, inCall: false };
let waitingForTap = false;

function remember(count: number) {
  rungFor = count;
  try {
    localStorage.setItem(RUNG_KEY, String(count));
  } catch {
    /* this visit only */
  }
}

function canRing() {
  return Boolean(sound?.audio) && latest.unread > 0 && !latest.reading && !latest.inCall && !quietNow() && !document.hidden;
}

function ringOnce() {
  window.clearTimeout(ringTimer);
  if (ringsLeft <= 0) return;
  if (!canRing() || !sound) {
    // Reading, in a call, at night, or the app is hidden: stop this round.
    ringsLeft = 0;
    return;
  }
  ringsLeft -= 1;
  playData(sound.mime, sound.audio, () => {
    // The phone wants a touch before any sound: ring at the first tap instead.
    window.clearTimeout(ringTimer);
    ringsLeft += 1;
    if (waitingForTap) return;
    waitingForTap = true;
    const go = () => {
      window.removeEventListener("pointerdown", go, true);
      window.removeEventListener("keydown", go, true);
      waitingForTap = false;
      ringOnce();
    };
    window.addEventListener("pointerdown", go, true);
    window.addEventListener("keydown", go, true);
  });
  if (ringsLeft > 0) ringTimer = window.setTimeout(ringOnce, GAP_MS);
}

/** Called with the unread count each time it's checked (on opening and every few seconds). */
export function ringForUnread(unread: number, { reading, inCall }: { reading: boolean; inCall: boolean }) {
  if (typeof window === "undefined") return;
  latest = { unread, reading, inCall };
  if (unread < rungFor) remember(unread); // some were read
  if (unread === 0 || reading) {
    ringsLeft = 0;
    window.clearTimeout(ringTimer);
    if (reading) remember(unread);
    return;
  }
  if (unread > rungFor) {
    // Not a moment to ring (sound not loaded yet, hidden, night, in a call): try again on a later check,
    // so it rings when they come back to Porchbook.
    if (!sound?.audio || document.hidden || quietNow() || inCall) return;
    remember(unread);
    ringsLeft = RINGS;
    lastPlayed = Date.now();
    ringOnce();
  }
}

function playData(mime: string, audio: string, blocked?: () => void) {
  try {
    duckRadio(1800);
    const node = new Audio(`data:${mime || "audio/wav"};base64,${audio}`);
    node.volume = 0.7;
    void node.play().catch((error: unknown) => {
      if (blocked && error instanceof Error && error.name === "NotAllowedError") blocked();
    });
  } catch {
    /* no sound on this phone right now */
  }
}

/** For the founder's preview. */
export function previewMessageSound(mime: string, audio: string) {
  playData(mime, audio);
}

// ---- Shaping an uploaded sound so it's gentle: trimmed, levelled, faded, short.
const RATE = 22050;
const MAX_SECONDS = 1.5;

export async function shapeMessageSound(file: File): Promise<{ mime: string; audio: string; seconds: number }> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error("This phone can't prepare sounds.");
  const ctx = new Ctx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error("That sound couldn't be read. Try an mp3 or wav.");
  } finally {
    void ctx.close().catch(() => undefined);
  }
  // One channel at a small rate (small file); the phone mixes it down for us.
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * RATE)), RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const data = (await offline.startRendering()).getChannelData(0);
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  if (peak < 0.001) throw new Error("That sound is silent.");
  // Skip the silence at the start.
  let start = 0;
  while (start < data.length && Math.abs(data[start]) < peak * 0.04) start += 1;
  const length = Math.min(data.length - start, Math.round(MAX_SECONDS * RATE));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = data[start + i];
  // Level it: a calm loudness, never a loud peak.
  let sum = 0;
  let top = 0;
  for (const v of out) {
    sum += v * v;
    top = Math.max(top, Math.abs(v));
  }
  const rms = Math.sqrt(sum / Math.max(1, length));
  const gain = Math.min(0.12 / Math.max(rms, 1e-4), 0.55 / Math.max(top, 1e-4));
  // Soft start and a gentle fade at the end.
  const fadeIn = Math.round(0.015 * RATE);
  const fadeOut = Math.min(Math.round(0.35 * RATE), Math.floor(length * 0.4));
  for (let i = 0; i < length; i += 1) {
    let g = gain;
    if (i < fadeIn) g *= i / fadeIn;
    if (i > length - fadeOut) g *= Math.max(0, (length - i) / fadeOut) ** 1.5;
    out[i] *= g;
  }
  return { mime: "audio/wav", audio: wavBase64(out), seconds: length / RATE };
}

function wavBase64(samples: Float32Array) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
