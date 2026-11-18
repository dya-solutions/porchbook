import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Music } from "lucide-react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { addWorship, dropWorship, getWorship, worshipTitles } from "@/lib/porch/worship";
import { fieldClass, quietButtonClass } from "@/components/porch/bits";
import { carrySound } from "@/lib/porch/carry-sound";
import { playButtonSound } from "@/lib/porch/button-sound-play";
import { TourSlot, getTourMode, toggleTourMode, useTourMode } from "@/lib/porch/tour-mode";

type Song = { id: string; url: string };

function youtubeId(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    let id = "";
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/")) id = url.pathname.split("/")[2] ?? "";
      else if (url.pathname === "/watch") id = url.searchParams.get("v") ?? "";
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function songName(url: string) {
  const id = youtubeId(url);
  if (id) return `YouTube · ${id}`;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const tail = parsed.pathname.split("/").filter(Boolean).pop();
    return tail ? `${host} · ${decodeURIComponent(tail).slice(0, 32)}` : host;
  } catch {
    return "Song";
  }
}

const PLAYLIST_LINK = "https://open.spotify.com/playlist/37i9dQZF1DZ06evO3JRQyP";

function playlistUri(link: string) {
  const mark = "/playlist/";
  const at = link.indexOf(mark);
  if (at < 0) return "";
  const id = link.slice(at + mark.length).split("?")[0]?.split("/")[0]?.split("#")[0]?.trim() ?? "";
  return /^[A-Za-z0-9]+$/.test(id) ? `spotify:playlist:${id}` : "";
}

const PLAYLIST_URI = playlistUri(PLAYLIST_LINK);

type SpotifyController = {
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  destroy: () => void;
  addListener: (name: "playback_update", cb: (event: unknown) => void) => void;
};

type SpotifyApi = {
  createController: (
    element: HTMLElement,
    options: { uri: string; width: string; height: number },
    callback: (controller: SpotifyController) => void,
  ) => void;
};

let spotifyApi: SpotifyApi | null = null;
const spotifyWaiters: ((api: SpotifyApi) => void)[] = [];

function whenSpotify(ready: (api: SpotifyApi) => void) {
  if (spotifyApi) {
    ready(spotifyApi);
    return;
  }
  spotifyWaiters.push(ready);
  const host = window as Window & { onSpotifyIframeApiReady?: (api: SpotifyApi) => void };
  host.onSpotifyIframeApiReady = (api) => {
    spotifyApi = api;
    const queued = spotifyWaiters.splice(0);
    queued.forEach((fn) => fn(api));
  };
  if (!document.querySelector("script[src='https://open.spotify.com/embed/iframe-api/v1']")) {
    const script = document.createElement("script");
    script.src = "https://open.spotify.com/embed/iframe-api/v1";
    script.async = true;
    document.body.appendChild(script);
  }
}

function spotifyIsPlaying(event: unknown) {
  const record = event && typeof event === "object" ? (event as { data?: { isPaused?: boolean }; isPaused?: boolean }) : null;
  const data = record && record.data && typeof record.data === "object" ? record.data : record;
  return Boolean(data && data.isPaused === false);
}

function shuffle(songs: Song[], avoid: string) {
  const list = [...songs];
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const held = list[index];
    list[index] = list[swap];
    list[swap] = held;
  }
  if (list.length > 1 && list[0]?.id === avoid) {
    const first = list.shift();
    if (first) list.push(first);
  }
  return list;
}

export function WorshipButton({ placed = false }: { placed?: boolean } = {}) {
  const { user } = useCurrentUserState();
  const mode = useTourMode();
  const [down, setDown] = useState(false);
  const [held, setHeld] = useState(placed);
  const open = placed ? held : mode === "worship";
  const [founder, setFounder] = useState(false);
  const [songs, setSongs] = useState<Song[]>([]);
  const [current, setCurrent] = useState<Song | null>(null);
  const [links, setLinks] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const queue = useRef<Song[]>([]);
  const songsRef = useRef<Song[]>([]);
  const currentRef = useRef<Song | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const moving = useRef(false);
  const yielded = useRef(false);
  const awayRef = useRef(false);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [spotifyMounted, setSpotifyMounted] = useState(false);
  const [spotifyBar, setSpotifyBar] = useState(false);
  const [spotifyHint, setSpotifyHint] = useState(false);
  const [spotifyOn, setSpotifyOn] = useState(false);
  const spotifyHost = useRef<HTMLDivElement>(null);
  const spotifyBarRef = useRef<HTMLDivElement>(null);
  const spotifyControl = useRef<SpotifyController | null>(null);
  const spotifyOnRef = useRef(false);
  const spotifyHintTimer = useRef<number | null>(null);
  songsRef.current = songs;
  currentRef.current = current;

  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    getWorship({ data: seed })
      .then((result) => {
        if (cancel) return;
        setFounder(result.founder);
        setSongs(result.songs);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    const urls = songs.map((song) => song.url).filter((url) => youtubeId(url));
    if (!urls.length) return;
    let cancel = false;
    const cached: Record<string, string> = {};
    try {
      Object.assign(cached, JSON.parse(sessionStorage.getItem("porch-worship-titles") || "{}") as Record<string, string>);
      if (!cancel) setTitles((current) => ({ ...cached, ...current }));
    } catch {
      /* titles still load */
    }
    worshipTitles({ data: { urls, ...seed } })
      .then((result) => {
        if (cancel) return;
        setTitles((current) => {
          const next = { ...current, ...result.titles };
          try {
            sessionStorage.setItem("porch-worship-titles", JSON.stringify(next));
          } catch {
            /* the names still show */
          }
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs]);

  function takeNext() {
    const ready = songsRef.current.filter((song) => youtubeId(song.url));
    const ids = new Set(ready.map((song) => song.id));
    queue.current = queue.current.filter((song) => ids.has(song.id));
    if (!queue.current.length) queue.current = shuffle(ready, currentRef.current?.id ?? "");
    return queue.current.shift() ?? null;
  }

  function watch(song: Song) {
    const id = youtubeId(song.url);
    if (!id) return;
    yielded.current = false;
    queue.current = queue.current.filter((item) => item.id !== song.id);
    setCurrent(song);
    setNote("");
  }

  useEffect(() => {
    const ready = songs.filter((song) => youtubeId(song.url));
    const ids = new Set(ready.map((song) => song.id));
    queue.current = queue.current.filter((song) => ids.has(song.id));
    const known = new Set(queue.current.map((song) => song.id));
    if (currentRef.current) known.add(currentRef.current.id);
    const fresh = ready.filter((song) => !known.has(song.id));
    if (fresh.length) queue.current.push(...shuffle(fresh, ""));
  }, [songs]);

  const playing = youtubeId(current?.url ?? "");

  useEffect(() => {
    const video = frameRef.current;
    if (!video || !playing) return;
    moving.current = false;
    const tell = (func: string, args: unknown[] = []) => {
      video.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== video.contentWindow) return;
      const raw = event.data;
      let data: { event?: string; info?: unknown } | null = null;
      if (typeof raw === "string") {
        try {
          data = JSON.parse(raw) as { event?: string; info?: unknown };
        } catch {
          return;
        }
      } else if (raw && typeof raw === "object") data = raw as { event?: string; info?: unknown };
      if (!data?.event) return;
      if (data.event === "onReady" || data.event === "initialDelivery") tell("addEventListener", ["onStateChange"]);
      const state = typeof data.info === "number" ? data.info : data.info && typeof data.info === "object" && "playerState" in data.info ? (data.info as { playerState?: unknown }).playerState : null;
      if (data.event === "onStateChange" && state === 2 && awayRef.current && !yielded.current) {
        tell("playVideo");
        tell("unMute");
      }
      if (data.event === "onStateChange" && state === 0) {
        if (moving.current) return;
        moving.current = true;
        const next = takeNext();
        if (next) setCurrent(next);
        else moving.current = false;
      }
    };
    const listen = () => {
      video.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: "worship-player" }), "*");
    };
    window.addEventListener("message", onMessage);
    listen();
    const poll = window.setInterval(listen, 700);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(poll);
    };
  }, [playing, current?.id]);

  useEffect(() => {
    const video = frameRef.current;
    if (!open || !playing || !video) return;
    const tell = (func: string) => {
      video.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args: [] }), "*");
    };
    const keep = () => {
      if (yielded.current) return;
      tell("playVideo");
      tell("unMute");
    };
    const release = carrySound({
      title: titles[playing] || songName(current?.url ?? "") || "Worship",
      play: () => {
        yielded.current = false;
        keep();
      },
      pause: () => {
        yielded.current = true;
        tell("pauseVideo");
      },
    });
    const kicks: number[] = [];
    const onHide = () => {
      const hidden = document.visibilityState === "hidden";
      awayRef.current = hidden;
      if (!hidden || yielded.current) return;
      keep();
      kicks.forEach((id) => window.clearTimeout(id));
      kicks.splice(0, kicks.length, window.setTimeout(keep, 400), window.setTimeout(keep, 1200));
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      kicks.forEach((id) => window.clearTimeout(id));
      document.removeEventListener("visibilitychange", onHide);
      release();
    };
  }, [open, playing, current?.id, current?.url, titles]);

  useEffect(() => {
    setSpotifyMounted(true);
  }, []);

  useEffect(() => {
    if (placed || !spotifyMounted) return;
    const el = spotifyHost.current;
    if (!el || !PLAYLIST_URI) return;
    let gone = false;
    let created: SpotifyController | null = null;
    const onUpdate = (event: unknown) => {
      if (gone) return;
      const playingNow = spotifyIsPlaying(event);
      spotifyOnRef.current = playingNow;
      setSpotifyOn(playingNow);
      if (!playingNow) return;
      if (spotifyHintTimer.current) window.clearTimeout(spotifyHintTimer.current);
      spotifyHintTimer.current = null;
      setSpotifyHint(false);
    };
    whenSpotify((api) => {
      if (gone) return;
      api.createController(el, { uri: PLAYLIST_URI, width: "100%", height: 80 }, (controller) => {
        if (gone) {
          controller.destroy();
          return;
        }
        created = controller;
        spotifyControl.current = controller;
        controller.addListener("playback_update", onUpdate);
      });
    });
    return () => {
      gone = true;
      if (spotifyHintTimer.current) window.clearTimeout(spotifyHintTimer.current);
      created?.destroy();
      if (spotifyControl.current === created) spotifyControl.current = null;
    };
  }, [placed, spotifyMounted]);

  function pressWorshipMusic() {
    spotifyBarRef.current?.classList.remove("is-hidden");
    void spotifyBarRef.current?.offsetHeight;
    setSpotifyBar(true);
    const controller = spotifyControl.current;
    if (spotifyOnRef.current && controller) {
      controller.togglePlay();
      return;
    }
    setSpotifyHint(false);
    if (spotifyHintTimer.current) window.clearTimeout(spotifyHintTimer.current);
    controller?.play();
    spotifyHintTimer.current = window.setTimeout(() => {
      if (!spotifyOnRef.current) setSpotifyHint(true);
    }, 2000);
  }

  function hideWorshipMusic() {
    spotifyControl.current?.pause();
    spotifyOnRef.current = false;
    setSpotifyOn(false);
    setSpotifyBar(false);
    setSpotifyHint(false);
    if (spotifyHintTimer.current) window.clearTimeout(spotifyHintTimer.current);
    spotifyHintTimer.current = null;
  }

  async function add() {
    setBusy(true);
    setNote("");
    const result = await addWorship({ data: { links, ...seed } });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setSongs(result.songs);
    setLinks("");
  }

  async function remove(id: string) {
    setBusy(true);
    const result = await dropWorship({ data: { id, ...seed } });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setSongs(result.songs);
    if (current?.id === id) setCurrent(null);
  }

  const dialSongs = songs.filter((song) => youtubeId(song.url));

  const panel = (
    <div className={placed ? "porchguy-worship" : "tour-sheet glass-edge w-full rounded-2xl bg-black p-4"}>
      {placed ? null : (
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-xl text-ink">Worship</h2>
          <button type="button" className={quietButtonClass} onClick={() => (placed ? setHeld(false) : toggleTourMode("worship"))}>
            Close
          </button>
        </div>
      )}
      {dialSongs.length ? null : <p className="mt-2 text-sm text-muted">No song yet.</p>}
      {playing ? (
        <iframe
          ref={frameRef}
          key={current?.id}
          title="Worship"
          src={`https://www.youtube-nocookie.com/embed/${playing}?autoplay=1&playsinline=1&rel=0&controls=0&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`}
          className="mt-3 aspect-video w-full rounded-xl"
          sandbox="allow-scripts allow-same-origin allow-presentation"
          allow="autoplay; encrypted-media; picture-in-picture"
        />
      ) : null}
      {founder ? (
        <div className="mt-4">
          <label className="grid gap-1 text-sm font-semibold text-ink">
            Song links
            <textarea
              value={links}
              onChange={(event) => setLinks(event.target.value)}
              placeholder="Paste a YouTube link, or several, one on each line"
              rows={3}
              className={fieldClass}
            />
          </label>
          <button type="button" className={`${quietButtonClass} mt-2`} disabled={busy || !links.trim()} onClick={() => void add()}>
            {busy ? "Saving…" : "Add"}
          </button>
          <ul className="mt-3 space-y-2">
            {songs.map((song) => (
              <li key={song.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm text-ink">{titles[youtubeId(song.url) ?? ""] || songName(song.url)}</span>
                <button type="button" className={quietButtonClass} disabled={busy} onClick={() => void remove(song.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
    </div>
  );

  if (placed) return panel;

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        className={`tour-key no-sink${down || open ? " is-down" : ""}`}
        onPointerDown={() => {
          playButtonSound();
          setDown(true);
        }}
        onPointerUp={() => setDown(false)}
        onPointerLeave={() => setDown(false)}
        onPointerCancel={() => setDown(false)}
        onClick={() => {
          const opening = getTourMode() !== "worship";
          if (opening) {
            const ready = songsRef.current.filter((song) => youtubeId(song.url));
            if (ready.length) watch(currentRef.current ?? ready[0]);
          }
          toggleTourMode("worship");
          pressWorshipMusic();
        }}
      >
        <Music className="size-4 text-[#7dff2a]" aria-hidden="true" />
        {spotifyOn ? "Worship ⏸" : "Worship"}
      </button>
      {open ? <TourSlot>{panel}</TourSlot> : null}
      {spotifyMounted
        ? createPortal(
            <div ref={spotifyBarRef} className={`worship-spotify${spotifyBar ? "" : " is-hidden"}`}>
              <div className="worship-spotify-player">
                <div ref={spotifyHost} />
                {spotifyHint ? <p className="worship-spotify-hint">Tap ▶ to start worship</p> : null}
              </div>
              <button type="button" className="worship-spotify-x" aria-label="Pause and hide worship" onClick={hideWorshipMusic}>
                X
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
