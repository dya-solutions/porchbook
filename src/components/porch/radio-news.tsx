import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { myRadioNews, type RadioNews as News } from "@/lib/porch/fm";
import { holdRadio, releaseRadio, tuneIn, tuneOut, useFm } from "@/lib/porch/fm-player";
import { W } from "@/components/porch/words";

/**
 * Your request (or a dedication to you) on Porchbook Radio:
 * while it plays, a gold strip with "Tune in"; afterwards, how many heard it, or "Hear it again".
 */

const SEEN = "porch-radio-news-seen";

function readSeen(): number[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN) ?? "[]") as number[];
  } catch {
    return [];
  }
}

function clock(ms: number) {
  const left = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

/** Play a recording once, just for you: the radio steps aside, and comes back by itself when it ends or is stopped. */
let again: HTMLAudioElement | null = null;
export function hearAgain(url: string, onEnd: () => void, startSec = 0) {
  stopAgain();
  const node = new Audio(url);
  again = node;
  holdRadio("hear-again", () => {
    if (again !== node) return;
    node.pause();
    again = null;
    onEnd();
  });
  if (startSec > 0) {
    node.addEventListener("loadedmetadata", () => {
      node.currentTime = startSec;
    }, { once: true });
  }
  const finish = () => {
    if (again !== node) return;
    again = null;
    releaseRadio("hear-again");
    onEnd();
  };
  node.onended = finish;
  void node.play().catch(finish);
}
export function stopAgain() {
  if (again) {
    again.pause();
    again = null;
  }
  releaseRadio("hear-again");
}

export function RadioNews() {
  const fm = useFm();
  const navigate = useNavigate();
  const [news, setNews] = useState<News[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [seen, setSeen] = useState<number[]>([]);
  const [playing, setPlaying] = useState(0);
  const loading = useRef(false);

  useEffect(() => {
    setSeen(readSeen());
    function load() {
      if (loading.current || document.visibilityState === "hidden") return;
      loading.current = true;
      myRadioNews()
        .then((result) => setNews(result.news))
        .catch(() => undefined)
        .finally(() => (loading.current = false));
    }
    load();
    const timer = window.setInterval(load, 90000);
    const onShow = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);

  const onAir = news.find((item) => item.startsAtMs - 20000 <= now && now < item.endsAtMs);
  const done = news.find((item) => now >= item.endsAtMs && !seen.includes(item.breakId));
  useEffect(() => {
    if (!onAir && !done) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [onAir, done]);
  // When the one on air finishes, fetch again for the final "heard it" count.
  const endsAt = onAir?.endsAtMs ?? 0;
  useEffect(() => {
    if (!endsAt) return;
    const timer = window.setTimeout(() => {
      myRadioNews()
        .then((result) => setNews(result.news))
        .catch(() => undefined);
    }, Math.max(0, endsAt - Date.now()) + 4000);
    return () => window.clearTimeout(timer);
  }, [endsAt]);

  function dismiss(id: number) {
    const next = [...seen, id].slice(-30);
    setSeen(next);
    try {
      localStorage.setItem(SEEN, JSON.stringify(next));
    } catch {
      /* for this visit */
    }
  }

  function tune() {
    void tuneIn();
    void navigate({ to: "/next", search: { tune: "1" } as never });
  }

  if (onAir && fm.status !== "on" && fm.status !== "tuning") {
    const starting = now < onAir.startsAtMs;
    return (
      <div className="radio-news is-live" role="status">
        <span className="radio-news-text">
          🎵 {onAir.mine ? <>Your request <b>“{onAir.title}”</b></> : <><b>{onAir.from}</b> dedicated <b>“{onAir.title}”</b> to you</>}
          {starting ? " is about to play" : <> is on air · {clock(onAir.endsAtMs - now)} left</>}
        </span>
        <button type="button" onClick={tune}>
          <W k="radio-news.tune">Tune in</W>
        </button>
      </div>
    );
  }
  if (!onAir && done) {
    const missed = !done.iHeard;
    return (
      <div className="radio-news" role="status">
        <span className="radio-news-text">
          {missed ? (
            <>
              🎵 {done.mine ? "You missed your request" : `You missed ${done.from}'s dedication`} <b>“{done.title}”</b>
            </>
          ) : (
            <>
              🎵 <b>“{done.title}”</b> played
            </>
          )}
          {done.heard ? ` · ${done.heard} ${done.heard === 1 ? "listener" : "listeners"} heard it` : ""}
        </span>
        {missed && done.url ? (
          <button
            type="button"
            onClick={() => {
              if (playing === done.breakId) {
                stopAgain();
                setPlaying(0);
              } else {
                setPlaying(done.breakId);
                hearAgain(done.url, () => setPlaying(0));
              }
            }}
          >
            {playing === done.breakId ? "■ Stop" : "▶ Hear it again"}
          </button>
        ) : null}
        <button
          type="button"
          className="radio-news-x"
          aria-label="Close"
          onClick={() => {
            stopAgain();
            setPlaying(0);
            dismiss(done.breakId);
          }}
        >
          ✕
        </button>
      </div>
    );
  }
  return null;
}
