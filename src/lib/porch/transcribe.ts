import { BOOKS } from "@/lib/porch/bible-engine";

/**
 * The notebook's live transcriber (free): the phone's own speech recognition.
 *  - In Chrome: the browser's speech recognition.
 *  - In the Porchbook app (1.2.1 and up): Android's speech recognition through window.PorchSpeech.
 * Both stop after a pause, so it starts listening again by itself until Stop.
 */

export type Hearing = {
  /** Words still being heard (they may change). */
  onPartial: (text: string) => void;
  /** Words settled. */
  onFinal: (text: string) => void;
  /** A quiet moment (a pause between sentences). */
  onPause: () => void;
  onError: (message: string) => void;
};

type AppSpeech = { available?: () => boolean; start: (lang: string) => void; stop: () => void };
type Recog = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function appSpeech(): AppSpeech | null {
  const w = window as unknown as { PorchSpeech?: AppSpeech };
  return w.PorchSpeech && typeof w.PorchSpeech.start === "function" ? w.PorchSpeech : null;
}
function webSpeech(): (new () => Recog) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recog; webkitSpeechRecognition?: new () => Recog };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
const inApp = () => typeof document !== "undefined" && document.documentElement.classList.contains("porch-app");

/** "ready" · "update" (the app is too old) · "none" (this phone/browser can't). */
export function transcriberState(): "ready" | "update" | "none" {
  if (typeof window === "undefined") return "none";
  if (appSpeech()) return "ready";
  if (inApp()) return "update"; // the app's web viewer has no speech recognition of its own
  return webSpeech() ? "ready" : "none";
}

const LANG = "en-GB";

/** The languages the notebook can write. English is heard on the phone; the others go to Sunbird AI. */
export const HEAR_LANGS = [
  { id: "eng", name: "English" },
  { id: "lug", name: "Luganda" },
  { id: "nyn", name: "Runyankole" },
] as const;
export type HearLang = (typeof HEAR_LANGS)[number]["id"];

/**
 * Luganda and Runyankole: record, cut at each pause, and send each sentence
 * to be written out. The words arrive a moment after each pause, in order.
 */
function startSunbird(h: Hearing, language: HearLang): () => void {
  let live = true;
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let rec: MediaRecorder | null = null;
  let timer = 0;
  let queue: Promise<void> = Promise.resolve();
  let waiting = 0;
  const show = () => h.onPartial(waiting ? "…" : "");

  const send = (blob: Blob) => {
    waiting += 1;
    show();
    const form = new FormData();
    form.append("audio", blob, "said");
    form.append("language", language);
    const answer: Promise<{ ok: boolean; body: { text?: string; error?: string } }> = fetch("/api/hear", { method: "POST", body: form, credentials: "include" })
      .then(async (res) => ({ ok: res.ok, body: (await res.json().catch(() => ({}))) as { text?: string; error?: string } }))
      .catch(() => ({ ok: false, body: { error: "No internet. Check it, then tap Transcribe again." } }));
    // Write each sentence in the order it was said.
    queue = queue.then(async () => {
      const { ok, body } = await answer;
      waiting -= 1;
      if (!live && !ok) return;
      if (ok && body.text) h.onFinal(body.text);
      else if (!ok && live) {
        stop();
        h.onError(body.error ?? "The transcriber didn't answer. Try again.");
      }
      show();
    });
  };

  const stop = () => {
    live = false;
    window.clearInterval(timer);
    try {
      if (rec && rec.state !== "inactive") rec.stop();
    } catch {
      /* already stopped */
    }
    stream?.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => undefined);
  };

  void (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      live = false;
      h.onError("Porchbook needs the microphone. Allow it, then tap Transcribe again.");
      return;
    }
    if (!live) return stop();
    if (typeof MediaRecorder === "undefined") {
      stop();
      h.onError("This phone can't record here. Open Porchbook in Chrome.");
      return;
    }
    ctx = new AudioContext();
    const meter = ctx.createAnalyser();
    meter.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(meter);
    const buf = new Float32Array(meter.fftSize);
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";

    let spoke = 0; // ms of speech in this piece
    let quiet = 0; // ms of quiet since the last speech
    let began = 0;
    let said = false; // this piece has words in it
    let floor = 0.01; // the room's own noise, learnt as it goes

    const next = () => {
      if (!live || !stream) return;
      const chunks: Blob[] = [];
      const piece = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      rec = piece;
      piece.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      piece.onstop = () => {
        if (said && chunks.length) send(new Blob(chunks, { type: piece.mimeType || type }));
        if (live) next();
      };
      spoke = 0;
      quiet = 0;
      said = false;
      began = Date.now();
      piece.start();
    };
    next();

    const STEP = 100;
    timer = window.setInterval(() => {
      if (!rec || rec.state !== "recording") return;
      meter.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const level = Math.sqrt(sum / buf.length);
      const loud = level > Math.max(0.015, floor * 2.5);
      if (!loud) floor = floor * 0.95 + level * 0.05;
      if (loud) {
        spoke += STEP;
        quiet = 0;
      } else quiet += STEP;
      if (spoke >= 400) said = true;
      const long = Date.now() - began;
      // Cut after a pause once something was said, or at 25 seconds; drop long silences.
      if ((said && quiet >= 900) || long >= 25000 || (!said && long >= 8000)) {
        if (!said) h.onPause();
        rec.stop();
      }
    }, STEP);
  })();

  return stop;
}

/** Start listening. Returns stop(). */
export function startHearing(h: Hearing, language: HearLang = "eng"): () => void {
  if (language !== "eng") return startSunbird(h, language);
  const app = appSpeech();
  if (app) {
    let live = true;
    const w = window as unknown as { __porchSpeech?: (m: { type: string; text: string }) => void; __porchAllow?: ((ok: boolean) => void) | null; PorchMic?: { ask: (kind: string) => void } };
    w.__porchSpeech = (m) => {
      if (!live) return;
      if (m.type === "partial") h.onPartial(m.text);
      else if (m.type === "final") h.onFinal(m.text);
      else if (m.type === "pause") h.onPause();
      else if (m.type === "error") {
        live = false;
        h.onError(m.text === "not-allowed" ? "Porchbook needs the microphone. Allow it, then tap Transcribe again." : "This phone's speech recognition isn't available.");
      }
    };
    const go = () => {
      if (live) app.start(LANG);
    };
    // Ask Android for the microphone first (the app's own prompt), then listen.
    if (w.PorchMic?.ask) {
      w.__porchAllow = (ok) => {
        w.__porchAllow = null;
        if (ok) go();
        else {
          live = false;
          h.onError("Porchbook needs the microphone. Allow it, then tap Transcribe again.");
        }
      };
      try {
        w.PorchMic.ask("audio");
      } catch {
        go();
      }
    } else go();
    return () => {
      live = false;
      try {
        app.stop();
      } catch {
        /* already stopped */
      }
    };
  }

  const Ctor = webSpeech();
  if (!Ctor) {
    h.onError("This browser can't transcribe. Open Porchbook in Chrome, or update the app.");
    return () => undefined;
  }
  let live = true;
  let rec: Recog | null = null;
  let quick = 0; // ends in a row that came straight away (a broken engine): don't spin
  let startedAt = 0;
  // Chrome on Android sends each growing piece of a sentence as "settled"
  // ("Had", "Had to", "Had to find"…). Hold the latest one, let a longer copy
  // replace it, and only write it once the sentence is really done.
  const android = /Android/i.test(navigator.userAgent);
  let held = "";
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9' ]+/g, "").replace(/\s+/g, " ").trim();
  const flush = () => {
    if (held.trim()) h.onFinal(held);
    held = "";
  };
  const settle = (text: string) => {
    if (!text.trim()) return;
    if (held && norm(text).startsWith(norm(held))) held = text;
    else if (held && norm(held).startsWith(norm(text))) return; // a shorter repeat
    else {
      flush();
      held = text;
    }
  };
  const begin = () => {
    if (!live) return;
    rec = new Ctor();
    rec.lang = LANG;
    // On Android, one sentence per listen (it starts again by itself after each pause).
    rec.continuous = !android;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let partial = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i];
        const text = piece[0]?.transcript ?? "";
        if (piece.isFinal) settle(text);
        else partial += text;
      }
      h.onPartial(partial ? partial : held);
      if (!android) flush();
    };
    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        live = false;
        h.onError("Porchbook needs the microphone. Allow it in the browser, then tap Transcribe again.");
      } else if (event.error === "no-speech") h.onPause();
    };
    rec.onend = () => {
      flush();
      if (!live) return;
      h.onPause();
      quick = Date.now() - startedAt < 1500 ? quick + 1 : 0;
      if (quick > 5) {
        live = false;
        h.onError("Listening keeps stopping. Check the internet, then tap Transcribe again.");
        return;
      }
      window.setTimeout(begin, quick ? 600 : 150);
    };
    startedAt = Date.now();
    try {
      rec.start();
    } catch {
      window.setTimeout(begin, 600);
    }
  };
  begin();
  return () => {
    live = false;
    flush();
    try {
      rec?.stop();
    } catch {
      /* already stopped */
    }
  };
}

// ---- Scriptures the preacher quotes ("John 3:16", "First Corinthians 13 verse 4", "Psalm 23").

const NUMBERED: Record<string, string> = { first: "1", second: "2", third: "3", "1st": "1", "2nd": "2", "3rd": "3", i: "1", ii: "2", iii: "3" };
function bookPattern() {
  const names = new Set<string>();
  for (const b of BOOKS) {
    const m = /^([123]) (.+)$/.exec(b.name);
    names.add(m ? `(?:${m[1]}|First|Second|Third|1st|2nd|3rd) ${m[2]}` : b.name);
  }
  names.add("Psalm");
  names.add("Song of Songs");
  return [...names].sort((a, b) => b.length - a.length).join("|");
}
let REF: RegExp | null = null;
/** Pieces of text, with the scripture references marked. */
export function spotScriptures(text: string): { text: string; ref: boolean }[] {
  REF ??= new RegExp(`\\b(${bookPattern()})\\s+(?:chapter\\s+)?(\\d{1,3})(?:\\s*(?::|,|\\s|verses?\\s+)\\s*(\\d{1,3})(?:\\s*(?:-|to)\\s*(\\d{1,3}))?)?\\b`, "g");
  const out: { text: string; ref: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(REF)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), ref: false });
    const book = m[1].replace(/^(First|Second|Third|1st|2nd|3rd)\b/i, (w) => NUMBERED[w.toLowerCase()] ?? w);
    const shown = `${book} ${m[2]}${m[3] ? `:${m[3]}${m[4] ? `-${m[4]}` : ""}` : ""}`;
    out.push({ text: shown, ref: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), ref: false });
  return out;
}
