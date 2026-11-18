import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { isLite } from "@/lib/porch/lite";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getRhema, setRhema } from "@/lib/porch/rhema";
import { fieldClass, quietButtonClass } from "@/components/porch/bits";
import { carrySound } from "@/lib/porch/carry-sound";

function useSeed() {
  const user = useCurrentUser();
  return {
    id: user?.id ?? "",
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };
}

const SEEN_KEY = "porch-rhema-seen";

function seenClip(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function clipStamp(videoId: string | null, start: number, end: number | null, updatedAt: string | null) {
  if (!videoId) return "";
  return `${videoId}|${start}|${end ?? ""}|${updatedAt ?? ""}`;
}

function markSeen(stamp: string) {
  try {
    localStorage.setItem(SEEN_KEY, stamp);
  } catch {
    /* this phone can still play the clip */
  }
  window.dispatchEvent(new Event("porch-rhema-seen"));
}

export function RhemaChip({
  className = "inline-flex min-h-10 items-center rounded-full px-3 text-sm font-medium text-ink",
  near = false,
}: {
  className?: string;
  near?: boolean;
}) {
  const seed = useSeed();
  const [videoId, setVideoId] = useState<string | null>(null);
  const [stamp, setStamp] = useState("");
  const [missing, setMissing] = useState(false);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (!seed.id) return;
    let cancel = false;
    const load = () => {
      getRhema({ data: { displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl } })
        .then((result) => {
          if (cancel) return;
          setVideoId(result.videoId);
          setStamp(clipStamp(result.videoId, result.start, result.end, result.updatedAt));
        })
        .catch(() => undefined);
    };
    load();
    window.addEventListener("porch-rhema", load);
    return () => {
      cancel = true;
      window.removeEventListener("porch-rhema", load);
    };
  }, [seed.id, seed.displayName, seed.email, seed.imageUrl]);

  useEffect(() => {
    const sync = () => setSeen(Boolean(stamp) && seenClip() === stamp);
    sync();
    window.addEventListener("porch-rhema-seen", sync);
    return () => window.removeEventListener("porch-rhema-seen", sync);
  }, [stamp]);

  function tap() {
    if (!videoId) {
      setMissing(true);
      return;
    }
    setMissing(false);
    setSeen(true);
    markSeen(stamp);
    window.dispatchEvent(new CustomEvent("porch-rhema-play", { detail: videoId }));
  }

  return (
    <button type="button" className={`inline-flex items-center gap-1.5 ${near ? "rhemaclip-near" : ""} ${className}`} onClick={tap}>
      {videoId ? (
        <span
          aria-hidden="true"
          className={`size-2.5 shrink-0 rounded-full ${near ? "rhema-led " : ""}${seen ? "rhema-lamp-green" : "rhema-lamp-red"}`}
        />
      ) : null}
      {missing && !videoId ? "No clip yet" : "Rhemaclip"}
    </button>
  );
}

export function RhemaSetter() {
  const seed = useSeed();
  const [founder, setFounder] = useState(false);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!seed.id) return;
    let cancel = false;
    getRhema({ data: { displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl } })
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
    const result = await setRhema({
      data: { url, displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl },
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setUrl("");
    setOpen(false);
    window.dispatchEvent(new Event("porch-rhema"));
  }

  async function clear() {
    setPending(true);
    await setRhema({ data: { url: "", displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl } });
    setPending(false);
    setOpen(false);
    window.dispatchEvent(new Event("porch-rhema"));
  }

  if (!open) {
    return (
      <button type="button" className={`${quietButtonClass} mt-3 px-0`} onClick={() => setOpen(true)}>
        Set Rhemaclip
      </button>
    );
  }

  return (
    <form onSubmit={save} className="mt-3 grid gap-2">
      <label className="grid gap-1 text-sm font-medium text-ink">
        YouTube, TikTok, or Instagram
        <input
          className={fieldClass}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Paste a YouTube, TikTok, or Instagram link"
        />
      </label>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={quietButtonClass} disabled={pending || !url.trim()}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className={quietButtonClass} disabled={pending} onClick={() => void clear()}>
          Remove
        </button>
        <button type="button" className={quietButtonClass} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function useWide() {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia("(min-width: 1024px)");
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => false,
  );
}

export function useRhemaPlay() {
  const seed = useSeed();
  const [videoId, setVideoId] = useState<string | null>(null);
  const [kind, setKind] = useState("youtube");
  const [stamp, setStamp] = useState("");
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!seed.id) return;
    let cancel = false;
    const load = () => {
      getRhema({ data: { displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl } })
        .then((result) => {
          if (cancel) return;
          setVideoId(result.videoId);
          setKind(result.kind);
          setStart(result.start);
          setEnd(result.end);
          setStamp(clipStamp(result.videoId, result.start, result.end, result.updatedAt));
          if (!result.videoId) setOpen(false);
        })
        .catch(() => undefined);
    };
    load();
    const onPlay = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (typeof id === "string" && id) {
        setVideoId(id);
        setOpen(true);
        setOver(false);
        setRun((value) => value + 1);
      }
    };
    window.addEventListener("porch-rhema", load);
    window.addEventListener("porch-rhema-play", onPlay);
    return () => {
      cancel = true;
      window.removeEventListener("porch-rhema", load);
      window.removeEventListener("porch-rhema-play", onPlay);
    };
  }, [seed.id, seed.displayName, seed.email, seed.imageUrl]);

  return {
    videoId,
    kind,
    start,
    end,
    open,
    over,
    run,
    close: () => setOpen(false),
    markOver: () => {
      setOver(true);
      if (stamp) markSeen(stamp);
    },
  };
}

function tellYoutube(frame: HTMLIFrameElement | null, func: string, args: unknown[] = []) {
  frame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
}

function playerState(info: unknown): number {
  if (typeof info === "number") return info;
  if (info && typeof info === "object" && "playerState" in info) {
    const value = (info as { playerState?: unknown }).playerState;
    if (typeof value === "number") return value;
  }
  return -1;
}

function useNow(on: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!on) return;
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}

export function DigitalClock() {
  const now = useNow(true);
  const label = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  return <span className="block text-xs font-semibold tabular-nums text-ink">{label}</span>;
}

function ClockFace({ now }: { now: Date }) {
  const seconds = now.getSeconds();
  const minutes = now.getMinutes();
  const hours = now.getHours() % 12;
  const secondDeg = seconds * 6;
  const minuteDeg = minutes * 6 + seconds * 0.1;
  const hourDeg = hours * 30 + minutes * 0.5;
  const dots = [1, 2, 4, 5, 7, 8, 10, 11].map((hour) => {
    const turn = (hour * Math.PI) / 6;
    return { hour, x: 50 + Math.sin(turn) * 40, y: 50 - Math.cos(turn) * 40 };
  });
  return (
    <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
      {dots.map((dot) => (
        <circle key={dot.hour} cx={dot.x} cy={dot.y} r="1.5" fill="#fff" />
      ))}
      <text x="50" y="16" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="700">
        12
      </text>
      <text x="86" y="53" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="700">
        3
      </text>
      <text x="50" y="90" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="700">
        6
      </text>
      <text x="14" y="53" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="700">
        9
      </text>
      <line
        x1="50"
        y1="50"
        x2="50"
        y2="30"
        stroke="#f8a018"
        strokeWidth="2.4"
        strokeLinecap="round"
        transform={`rotate(${hourDeg} 50 50)`}
      />
      <line
        x1="50"
        y1="50"
        x2="50"
        y2="18"
        stroke="#90c840"
        strokeWidth="1.6"
        strokeLinecap="round"
        transform={`rotate(${minuteDeg} 50 50)`}
      />
      <line
        x1="50"
        y1="56"
        x2="50"
        y2="14"
        stroke="#fff"
        strokeWidth="0.9"
        strokeLinecap="round"
        transform={`rotate(${secondDeg} 50 50)`}
      />
      <circle cx="50" cy="50" r="1.8" fill="#111" />
    </svg>
  );
}

export function PowerMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden="true">
      <path d="M12 3.2v6.2" fill="none" stroke="#39ff14" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M7.1 6.6a7 7 0 1 0 9.8 0" fill="none" stroke="#39ff14" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function RhemaStage({
  videoId,
  kind,
  start,
  end,
  open,
  run,
  onClose,
  onEnded,
}: {
  videoId: string | null;
  kind: string;
  start: number;
  end: number | null;
  open: boolean;
  run: number;
  onClose: () => void;
  onEnded: () => void;
}) {
  const wide = useWide();
  const frame = useRef<HTMLIFrameElement>(null);
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  const [done, setDone] = useState(false);
  const now = useNow(open && !done && Boolean(videoId));
  // The player loads only when the Rhemaclip is opened, and is let go a minute
  // after it closes (at once in Lite), so it isn't using data all day.
  const [keep, setKeep] = useState(open);
  useEffect(() => {
    if (open) {
      setKeep(true);
      return;
    }
    const timer = window.setTimeout(() => setKeep(false), isLite() ? 0 : 60_000);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    const host = window as Window & { PorchApp?: { rhema?: (on: boolean) => void } };
    host.PorchApp?.rhema?.(Boolean(open && videoId));
    window.dispatchEvent(new CustomEvent("porch-rhema-open", { detail: Boolean(open && videoId) }));
  }, [open, videoId]);

  useEffect(() => {
    setDone(false);
  }, [open, videoId, start, run]);

  useEffect(() => {
    if ((kind !== "youtube" && kind !== "short") || !videoId || !open) return;
    let timer = 0;
    let poll = 0;
    let restarting = false;
    let lastReport = 0; // when YouTube last said where it is
    const restart = () => {
      if (restarting) return;
      restarting = true;
      window.setTimeout(() => {
        restarting = false;
      }, 600);
      tellYoutube(frame.current, "seekTo", [start, true]);
      tellYoutube(frame.current, "playVideo");
      tellYoutube(frame.current, "unMute");
      window.setTimeout(() => {
        tellYoutube(frame.current, "playVideo");
        tellYoutube(frame.current, "unMute");
      }, 280);
      arm();
    };
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
      } else if (raw && typeof raw === "object") {
        data = raw as { event?: string; info?: unknown };
      }
      if (!data?.event) return;
      if (data.event === "onReady") {
        // A freshly loaded player: start the clip with sound.
        tellYoutube(frame.current, "seekTo", [start, true]);
        tellYoutube(frame.current, "playVideo");
        tellYoutube(frame.current, "unMute");
      }
      if (data.event === "onReady" || data.event === "initialDelivery") {
        tellYoutube(frame.current, "addEventListener", ["onStateChange"]);
      }
      if (data.event === "infoDelivery" && data.info && typeof data.info === "object" && "currentTime" in data.info) {
        const current = (data.info as { currentTime?: unknown }).currentTime;
        if (typeof current === "number") {
          lastReport = Date.now();
          // Loop on the video's own position: only when it really reaches the end.
          if (end && end > start && current >= end - 0.25) restart();
        }
      }
      if (data.event === "onStateChange") {
        // Only a real ending starts it over; a pause is not the end.
        if (playerState(data.info) === 0) restart();
      }
    };
    const arm = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
      if (!(end && end > start)) return;
      // Backup only: if YouTube stops reporting its position, fall back to the clock.
      const check = () => {
        if (Date.now() - lastReport > 4000) restart();
        else timer = window.setTimeout(check, 2000);
      };
      timer = window.setTimeout(check, (Math.max(1, end - start) + 3) * 1000);
    };
    const listen = () => {
      frame.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "listening", id: "rhema-player" }),
        "*",
      );
      tellYoutube(frame.current, "getCurrentTime");
    };
    window.addEventListener("message", onMessage);
    listen();
    arm();
    poll = window.setInterval(listen, 500);
    return () => {
      window.removeEventListener("message", onMessage);
      if (timer) window.clearTimeout(timer);
      if (poll) window.clearInterval(poll);
    };
  }, [open, videoId, start, end, run, kind]);

  useEffect(() => {
    if (!videoId || (kind !== "youtube" && kind !== "short")) return;
    const run = () => {
      if (open) {
        tellYoutube(frame.current, "seekTo", [start, true]);
        tellYoutube(frame.current, "playVideo");
        tellYoutube(frame.current, "unMute");
        return;
      }
      tellYoutube(frame.current, "mute");
      tellYoutube(frame.current, "pauseVideo");
    };
    run();
    const timer = window.setTimeout(run, 350);
    if (!open) return () => window.clearTimeout(timer);
    let yielded = false;
    const release = carrySound({
      title: "RhemaClip",
      play: () => {
        yielded = false;
        tellYoutube(frame.current, "playVideo");
        tellYoutube(frame.current, "unMute");
      },
      pause: () => {
        yielded = true;
        tellYoutube(frame.current, "pauseVideo");
      },
    });
    const onHide = () => {
      if (yielded) return;
      tellYoutube(frame.current, "playVideo");
      tellYoutube(frame.current, "unMute");
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onHide);
      release();
    };
  }, [open, videoId, start, run, kind]);

  if (!videoId || !keep) return null;

  const place = open
    ? wide
      ? "fixed top-80 right-6 z-30 w-36"
      : "fixed right-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 w-36"
    : "rhema-parked pointer-events-none";
  const query = new URLSearchParams({
    enablejsapi: "1",
    autoplay: "1",
    mute: "1",
    playsinline: "1",
    rel: "0",
    loop: "1",
    controls: "0",
    playlist: videoId,
  });
  if (start > 0) query.set("start", String(start));
  const frameClass =
    kind === "youtube"
      ? "pointer-events-none absolute top-[42%] left-1/2 h-[124%] w-[220%] -translate-x-1/2 -translate-y-1/2"
      : kind === "instagram"
        ? "absolute top-0 left-1/2 h-[430%] w-[230%] -translate-x-1/2 -translate-y-[16%]"
        : "absolute top-0 left-1/2 h-[220%] w-[124%] -translate-x-1/2 -translate-y-[6%]";
  const src =
    kind === "tiktok"
      ? `https://www.tiktok.com/player/v1/${videoId}?autoplay=1&loop=1&controls=0&progress_bar=0&play_button=0&volume_control=0&fullscreen_button=0&description=0&music_info=0&rel=0`
      : kind === "instagram"
        ? `https://www.instagram.com/${videoId}/embed`
        : `https://www.youtube-nocookie.com/embed/${videoId}?${query.toString()}`;

  return (
    <div className={`rhema-hold ${place}`}>
      <div className="relative w-36">
        {open ? (
          <button
            type="button"
            aria-label="Turn off"
            onClick={onClose}
            className="absolute top-0 right-0 z-20 grid size-6 place-items-center rounded-full bg-black shadow-[0_0_8px_#39ff14]"
          >
            <PowerMark />
          </button>
        ) : null}
        <div className="relative aspect-square w-36 overflow-hidden rounded-full border-2 border-[#f8a018] bg-black shadow-[inset_0_2px_0_rgba(255,226,170,0.95),inset_0_-3px_0_rgba(92,36,0,0.95),0_0_10px_rgba(248,160,24,0.45)]">
          <iframe
            key={src}
            ref={frame}
            id="rhema-player"
            title="Rhemaclip"
            src={src}
            className={frameClass}
            allow="autoplay; accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          />
          {open && !done ? <ClockFace now={now} /> : null}
        </div>
      </div>
    </div>
  );
}
