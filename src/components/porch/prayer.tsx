import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getPrayer, setPrayer } from "@/lib/porch/rhema";
import { fieldClass, quietButtonClass } from "@/components/porch/bits";
import { carrySound } from "@/lib/porch/carry-sound";

type PrayerState = { on: boolean; videoId: string | null; start: number };

let state: PrayerState = { on: false, videoId: null, start: 0 };
let at = 0;
let lastTap = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot() {
  return state;
}

function bed() {
  return document.getElementById("prayer-bed") as HTMLIFrameElement | null;
}

function tell(frame: HTMLIFrameElement | null, func: string, args: unknown[] = []) {
  frame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
}

function remember(info: unknown) {
  if (!info || typeof info !== "object" || !("currentTime" in info)) return;
  const time = (info as { currentTime?: unknown }).currentTime;
  if (typeof time === "number" && Number.isFinite(time)) at = time;
}

function playFrom(seconds: number) {
  const frame = bed();
  at = seconds;
  tell(frame, "seekTo", [seconds, true]);
  tell(frame, "playVideo");
  tell(frame, "unMute");
  tell(frame, "setVolume", [80]);
  state = { ...state, on: true };
  emit();
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: "Prayer", artist: "Porchbook" });
    navigator.mediaSession.playbackState = "playing";
  }
}

function pauseHere() {
  const frame = bed();
  tell(frame, "getCurrentTime");
  tell(frame, "pauseVideo");
  state = { ...state, on: false };
  emit();
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
}

export function setPrayerTrack(videoId: string | null, start: number) {
  if (videoId !== state.videoId) at = start;
  state = { on: videoId ? state.on : false, videoId, start };
  emit();
}

export function pressPray() {
  if (!state.videoId) return false;
  const now = Date.now();
  if (now - lastTap < 320) {
    lastTap = 0;
    playFrom(state.start);
    return true;
  }
  lastTap = now;
  if (state.on) pauseHere();
  else playFrom(at || state.start);
  return true;
}

export function usePrayerOn() {
  return useSyncExternalStore(subscribe, snapshot, snapshot).on;
}

function useSeed() {
  const user = useCurrentUser();
  return {
    id: user?.id ?? "",
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };
}

export function PrayerBed() {
  const seed = useSeed();
  const playing = usePrayerOn();
  const track = useSyncExternalStore(subscribe, snapshot, snapshot);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!seed.id) return;
    let cancel = false;
    const load = () => {
      getPrayer({ data: { displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl } })
        .then((result) => {
          if (!cancel) setPrayerTrack(result.videoId, result.start);
        })
        .catch(() => undefined);
    };
    load();
    window.addEventListener("porch-prayer", load);
    return () => {
      cancel = true;
      window.removeEventListener("porch-prayer", load);
    };
  }, [seed.id, seed.displayName, seed.email, seed.imageUrl]);

  useEffect(() => {
    if (!track.videoId || !playing) {
      if (!playing) {
        tell(frame.current, "pauseVideo");
      }
      return;
    }
    const run = () => {
      tell(frame.current, "playVideo");
      tell(frame.current, "unMute");
    };
    const timer = window.setTimeout(run, 500);
    const clock = window.setInterval(() => tell(frame.current, "getCurrentTime"), 2000);
    let yielded = false;
    const release = carrySound({
      title: "Prayer",
      play: () => {
        yielded = false;
        tell(frame.current, "playVideo");
        tell(frame.current, "unMute");
      },
      pause: () => {
        yielded = true;
        tell(frame.current, "pauseVideo");
      },
    });
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const raw = event.data;
      let data: { event?: string; info?: unknown } | null = null;
      if (typeof raw === "string") {
        try {
          data = JSON.parse(raw) as { event?: string; info?: unknown };
        } catch {
          return;
        }
      } else if (raw && typeof raw === "object") data = raw as { event?: string; info?: unknown };
      if (data?.event === "infoDelivery") remember(data.info);
    };
    const onHide = () => {
      if (!state.on || yielded) return;
      tell(frame.current, "playVideo");
      tell(frame.current, "unMute");
    };
    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(clock);
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onHide);
      release();
    };
  }, [playing, track.videoId]);

  if (!track.videoId) return null;

  const query = new URLSearchParams({
    enablejsapi: "1",
    autoplay: "0",
    mute: "1",
    playsinline: "1",
    loop: "1",
    playlist: track.videoId,
    rel: "0",
  });
  if (track.start > 0) query.set("start", String(track.start));

  return (
    <iframe
      id="prayer-bed"
      ref={frame}
      title="Prayer music"
      src={`https://www.youtube-nocookie.com/embed/${track.videoId}?${query.toString()}`}
      className="pointer-events-none"
      width={1}
      height={1}
      style={{ position: "fixed", left: "-9999px", top: 0, width: 1, height: 1, opacity: 0, border: 0 }}
      allow="autoplay"
    />
  );
}

export function PrayerSetter() {
  const seed = useSeed();
  const [founder, setFounder] = useState(false);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!seed.id) return;
    let cancel = false;
    getPrayer({ data: { displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl } })
      .then((result) => {
        if (!cancel) setFounder(result.founder);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [seed.id, seed.displayName, seed.email, seed.imageUrl]);

  if (!founder) return null;

  async function save(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const result = await setPrayer({
      data: { url, displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl },
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setUrl("");
    setOpen(false);
    window.dispatchEvent(new Event("porch-prayer"));
  }

  if (!open) {
    return (
      <button type="button" className={`${quietButtonClass} tour-foot mt-2 block px-0 text-left`} onClick={() => setOpen(true)}>
        Set prayer music
      </button>
    );
  }

  return (
    <form onSubmit={save} className="mx-auto mt-3 grid max-w-md gap-2">
      <label className="grid gap-1 text-sm font-medium text-ink">
        YouTube link
        <input
          className={fieldClass}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.youtube.com/watch?v="
        />
      </label>
      {error ? <p className="text-sm text-muted">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" className={quietButtonClass} disabled={pending || !url.trim()}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className={quietButtonClass} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
