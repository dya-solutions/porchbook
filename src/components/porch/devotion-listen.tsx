import { useEffect, useRef, useState } from "react";
import { devotionVoice, devotionWords } from "@/lib/porch/devotion-voice";
import { holdRadio, releaseRadio } from "@/lib/porch/fm-player";
import { attachBed, type Bed } from "@/lib/porch/devotion-bed";
import { canPhoneSpeak, speakLines } from "@/lib/porch/phone-voice";

/** ▶ Listen bar at the top of the devotional. The audio is kept on the phone after the first play. */
const CACHE = "porch-devotion-audio";

async function keptAudio(url: string): Promise<string | null> {
  try {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (!hit) return null;
    return URL.createObjectURL(await hit.blob());
  } catch {
    return null;
  }
}

async function keepAudio(url: string) {
  try {
    const cache = await caches.open(CACHE);
    for (const old of await cache.keys()) if (old.url !== url) await cache.delete(old);
    if (!(await cache.match(url))) await cache.add(url);
  } catch {
    /* plays from the internet next time */
  }
}

function clock(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function DevotionListen() {
  const [state, setState] = useState<"off" | "making" | "ready" | "failed" | "checking">("checking");
  const [problem, setProblem] = useState("");
  const [phoneOn, setPhoneOn] = useState(false);
  const stopPhone = useRef<(() => void) | null>(null);
  useEffect(() => () => stopPhone.current?.(), []);
  async function togglePhone() {
    if (stopPhone.current) {
      stopPhone.current();
      return;
    }
    const words = await devotionWords().catch(() => null);
    if (!words?.ok || !words.lines.length) return;
    setPhoneOn(true);
    holdRadio("devotion", () => stopPhone.current?.());
    stopPhone.current = speakLines(words.lines, () => {
      stopPhone.current = null;
      setPhoneOn(false);
      releaseRadio("devotion");
    });
  }
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const local = useRef("");
  const bed = useRef<Bed>(null);
  const dropBed = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const ask = async () => {
      const result = await devotionVoice().catch(() => null);
      if (!alive) return;
      if (!result) {
        // Offline: use the copy on the phone if there is one.
        try {
          const cache = await caches.open(CACHE);
          const keys = await cache.keys();
          if (keys[0]) {
            setUrl(keys[0].url);
            setState("ready");
            return;
          }
        } catch {
          /* nothing kept */
        }
        setState("off");
        return;
      }
      bed.current = result.bed ?? null;
      setState(result.state);
      setProblem(result.state === "failed" ? ((result as { error?: string }).error ?? "") : "");
      // A failed reading is tried again after a while (the server retries after 10 minutes).
      if (result.state === "failed") timer = window.setTimeout(() => void ask(), 120000);
      if (result.state === "ready" && result.url) {
        setUrl(result.url);
        if (result.seconds) setLength(result.seconds);
      }
      if (result.state === "making") timer = window.setTimeout(() => void ask(), 15000);
    };
    void ask();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      audio.current?.pause();
      dropBed.current();
      releaseRadio("devotion");
      if (local.current) URL.revokeObjectURL(local.current);
    };
  }, []);

  async function toggle() {
    if (!url) return;
    if (!audio.current) {
      const kept = await keptAudio(url);
      if (kept) local.current = kept;
      const element = new Audio(kept ?? url);
      element.preload = "auto";
      element.addEventListener("timeupdate", () => setAt(element.currentTime));
      element.addEventListener("loadedmetadata", () => {
        if (Number.isFinite(element.duration)) setLength(element.duration);
      });
      element.addEventListener("play", () => {
        setPlaying(true);
        holdRadio("devotion", () => element.pause());
      });
      element.addEventListener("pause", () => {
        setPlaying(false);
        releaseRadio("devotion");
      });
      element.addEventListener("ended", () => {
        setPlaying(false);
        releaseRadio("devotion");
      });
      audio.current = element;
      dropBed.current = attachBed(element, bed.current);
      if (!kept) void keepAudio(url);
    }
    if (audio.current.paused) void audio.current.play();
    else audio.current.pause();
  }

  // No recording today: the phone's own voice reads it instead (free, never runs out).
  if (state === "off" || state === "failed") {
    if (!canPhoneSpeak()) return state === "failed" ? (
      <div className="devotion-listen">
        <span className="devotion-listen-title">Today's reading couldn't be prepared{problem ? `: ${problem}` : ""}.</span>
      </div>
    ) : null;
    return (
      <div className="devotion-listen">
        <button type="button" className="devotion-listen-key" onClick={() => void togglePhone()} aria-label={phoneOn ? "Stop reading" : "Listen with your phone's voice"}>
          {phoneOn ? "❚❚" : "▶"}
        </button>
        <span className="devotion-listen-title">{phoneOn ? "Reading with your phone's voice" : "Listen to today's devotional (phone voice)"}</span>
      </div>
    );
  }
  const share = length ? Math.min(1, at / length) : 0;
  return (
    <div className="devotion-listen">
      <button type="button" className="devotion-listen-key" disabled={state !== "ready"} onClick={() => void toggle()} aria-label={playing ? "Pause the reading" : "Listen to the devotional"}>
        {state !== "ready" ? "…" : playing ? "❚❚" : "▶"}
      </button>
      <div className="devotion-listen-body">
        <span className="devotion-listen-title">{state === "ready" ? (playing || at ? "Listening" : "Listen to today's devotional") : state === "making" ? "Preparing the reading…" : "Checking for the reading…"}</span>
        <span
          className="devotion-listen-line"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            if (audio.current && length) audio.current.currentTime = ((event.clientX - box.left) / box.width) * length;
          }}
        >
          <i style={{ width: `${share * 100}%` }} />
        </span>
      </div>
      <span className="devotion-listen-time">{state === "ready" ? `${clock(at)} / ${clock(length)}` : ""}</span>
    </div>
  );
}
