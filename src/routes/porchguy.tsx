import { EditWordsButton } from "@/components/porch/words";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useCovers } from "@/components/porch/covers";
import { AppFrame } from "@/components/porch/frame";
import { askPorchGuy, CRISIS_LINES, CRISIS_WORDS } from "@/lib/porch/porch-guy";
import { GuyMeter } from "@/components/porch/guy-meter";
import { type PodKey } from "@/components/porch/porch-pod";
import { PorchSpin } from "@/components/porch/porch-spin";
import { getBearerToken } from "@/lib/auth/client";
import { isLite } from "@/lib/porch/lite";
import { holdRadio, releaseRadio } from "@/lib/porch/fm-player";
import { setLiveVideo } from "@/lib/porch/fm";
import { useBackLayer } from "@/lib/porch/back-stack";
import { amIFounder } from "@/lib/porch/password-reset";

/** The porch guy's background is kept with the book covers under this name. */
const GUY_BG = "porchguy-bg";
const GUY_BG_COLOURS = ["#000000", "#0f1a14", "#101827", "#1f1410", "#1a1024", "#2a2a2a"];

export const Route = createFileRoute("/porchguy")({
  validateSearch: (search: Record<string, unknown>) =>
    ({
      film: typeof search.film === "string" ? search.film : "",
      worship: typeof search.worship === "string" ? search.worship : "",
      // A Clinic sermon to watch on his screen, and the Clinic card to go back to.
      ...(typeof search.watch === "string" ? { watch: search.watch } : {}),
      ...(typeof search.back === "string" ? { back: search.back } : {}),
    }) as { film: string; worship: string; watch?: string; back?: string },
  component: PorchGuyPage,
});

type Turn = { role: "user" | "assistant"; text: string };
type Clip = "idle" | "talk" | "think" | "wave" | "laugh" | "bible" | "phone" | "point" | "thumbs" | "tea";
type Watchable = { key: string; label: string; youtube?: string; file?: string };
type View = "chat" | "menu" | "watch" | "suggest" | "video";

/** Is this about Porchbook itself: something broken, or praise? */
function feedbackWish(line: string): "__problem" | "__praise" | "" {
  const q = line.toLowerCase();
  if (/\b(feedback|report a problem|report a bug)\b/.test(q)) return "__problem";
  if (/\b(porchbook|the app|this app|the site|the radio|the page|it)\b/.test(q) && /\b(not working|isn'?t working|doesn'?t work|didn'?t work|won'?t (open|load|play|work)|can'?t (open|load|play|log ?in|sign ?in|see|send|post)|broken|bug|error|crash(es|ed)?|stuck|freez(es|ing))\b/.test(q)) return "__problem";
  if (/\b(i love|we love|thank you for|thanks for|well done|great job|amazing|awesome|so good)\b/.test(q) && /\b(porchbook|the app|this app|the radio|the site|this)\b/.test(q)) return "__praise";
  return "";
}

const GREETING = "Hi! Ask me anything about Porchbook, or what's on this week.";
const SUGGESTIONS = [
  "What's on this week?",
  "What time are services?",
  "How do I request a song on the radio?",
  "How do I post on Porchbook?",
  "Give me a scripture for today",
  "How do I call someone?",
];
const MENU = ["Ask", "Watch", "What's on", "Ideas to ask", "Help", "Feedback"] as const;
const LOOPS: Clip[] = ["idle", "talk", "think"];
const ONCE: Clip[] = ["wave", "laugh", "bible", "phone", "point", "thumbs", "tea"];

/**
 * The porch guy on his pocket device's screen: his real motion clips (still pictures in Lite),
 * acting out each reply; his words typed out below him.
 */
function GuyOnScreen({ clip, mood, onDone }: { clip: Clip; mood: "happy" | "neutral" | "caring" | "thinking"; onDone: () => void }) {
  const lite = isLite();
  const [kind] = useState(() => (typeof document !== "undefined" && document.createElement("video").canPlayType('video/mp4; codecs="avc1.4D401E"') ? "mp4" : "webm"));
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState<Clip[]>(["idle", "talk", "think", "wave"]);
  useEffect(() => {
    if (lite) return;
    const timer = window.setTimeout(() => setLoaded([...LOOPS, ...ONCE]), 5000);
    return () => window.clearTimeout(timer);
  }, [lite]);
  const videos = useRef<Record<string, HTMLVideoElement | null>>({});
  const want = mood === "caring" ? null : ready[clip] ? clip : ready.idle ? "idle" : null;
  useEffect(() => {
    for (const [name, node] of Object.entries(videos.current)) {
      if (!node) continue;
      if (name === want) {
        if (!LOOPS.includes(name as Clip)) node.currentTime = 0;
        void node.play().catch(() => undefined);
      } else node.pause();
    }
  }, [want]);
  const still = mood === "caring" ? "caring" : mood === "thinking" ? "thinking" : mood === "neutral" ? "neutral" : "happy";
  return (
    <div className="pod-guy">
      <img src={`/porchguy/${still}.webp`} alt="" className={`pod-guy-still${want ? " is-under" : ""}`} draggable={false} />
      {lite
        ? null
        : loaded.map((name) => (
            <video
              key={name}
              ref={(node) => {
                videos.current[name] = node;
              }}
              className={`pod-guy-clip${want === name ? " is-on" : ""}`}
              src={`/porchguy/clips/${name}.${kind}`}
              muted
              playsInline
              preload="auto"
              loop={LOOPS.includes(name)}
              onLoadedData={() => setReady((now) => ({ ...now, [name]: true }))}
              onEnded={() => {
                if (name === clip) onDone();
              }}
            />
          ))}
    </div>
  );
}

function PorchGuyPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(""); // his answer, typed out on the screen
  const [care, setCare] = useState(false);
  const [gentle, setGentle] = useState(false);
  const [view, setView] = useState<View>("chat");
  const [pick, setPick] = useState(0); // the highlighted line in a list
  const [back, setBack] = useState(0); // 0 = his latest answer; 1 = the one before…
  const [playing, setPlaying] = useState<Watchable | null>(null);
  const [paused, setPaused] = useState(false);
  const [founder, setFounder] = useState(false);
  const [live, setLive] = useState<Watchable | null>(null);
  const [events, setEvents] = useState<Watchable[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const film = useRef<HTMLVideoElement>(null);

  const answers = turns.filter((turn) => turn.role === "assistant").map((turn) => turn.text);
  const questions = turns.filter((turn) => turn.role === "user").map((turn) => turn.text);
  const said = answers.at(-1) ?? "";

  // Type his latest answer onto the screen, a word at a time (a long answer in about 2 seconds).
  useEffect(() => {
    if (!said) return;
    let at = 0;
    setShown("");
    setBack(0);
    const step = Math.max(3, Math.ceil(said.length / 60));
    const timer = window.setInterval(() => {
      at = Math.min(said.length, at + step);
      const cut = said.indexOf(" ", at);
      at = cut === -1 || cut - at > 12 ? at : cut;
      setShown(said.slice(0, at));
      if (at >= said.length) window.clearInterval(timer);
    }, 33);
    return () => window.clearInterval(timer);
  }, [said]);
  const typing = Boolean(said) && shown.length < said.length;

  // His motion: thinking while he works it out, talking while his words appear, then back to idle.
  const [acting, setActing] = useState<Clip | null>("wave"); // a wave as you arrive
  const clip: Clip = acting ?? (busy ? "think" : typing ? "talk" : "idle");
  // An action lasts a few seconds at most (and when a clip can't play, he just carries on).
  useEffect(() => {
    if (!acting) return;
    const timer = window.setTimeout(() => setActing(null), 7000);
    return () => window.clearTimeout(timer);
  }, [acting]);
  // Now and then, while nobody is talking to him, he does something by himself.
  useEffect(() => {
    if (busy || typing || acting) return;
    const timer = window.setTimeout(() => setActing((["tea", "phone", "bible"] as Clip[])[Math.floor(Math.random() * 3)]), 35000 + Math.random() * 30000);
    return () => window.clearTimeout(timer);
  }, [busy, typing, acting]);
  const mood = care || gentle ? "caring" : busy ? "thinking" : said ? "neutral" : "happy";

  // A Clinic sermon to watch (opened from the Clinic), the live service, and event videos.
  const clinic = useRef<{ id: string; back: string } | null>(null);
  if (typeof window !== "undefined" && clinic.current === null) {
    const params = new URL(window.location.href).searchParams;
    const id = params.get("watch") ?? "";
    clinic.current = /^[\w-]{11}$/.test(id) ? { id, back: params.get("back") ?? "" } : { id: "", back: "" };
  }
  useEffect(() => {
    const sermon = clinic.current;
    if (sermon?.id) {
      setPlaying({ key: `clinic-${sermon.id}`, label: "Self Medication with the Word", youtube: sermon.id });
      setView("video");
    }
  }, []);
  const [liveTick, setLiveTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/yt-live")
        .then((res) => res.json() as Promise<{ live: boolean; videoId: string; label?: string; title?: string }>)
        .then((info) => {
          if (!alive) return;
          setLive(info.live && info.videoId ? { key: `live-${info.videoId}`, label: `● LIVE · ${info.label || "Live now"}`, youtube: info.videoId } : null);
        })
        .catch(() => undefined);
    load();
    const timer = window.setInterval(load, 60000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [liveTick]);
  useEffect(() => {
    let alive = true;
    const token = getBearerToken();
    const auth: HeadersInit | undefined = token ? { Authorization: `Bearer ${token}` } : undefined;
    const fileUrl = (id: string) => `/api/city-board?id=${encodeURIComponent(id)}${token ? `&t=${encodeURIComponent(token)}` : ""}`;
    fetch("/api/city-board", { headers: auth })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { items?: { id: string; kind: string; title: string }[] } | null) => {
        if (!alive) return;
        setEvents(
          (data?.items ?? [])
            .filter((item) => item.kind === "video")
            .slice(0, 12)
            .map((item) => ({ key: `event-${item.id}`, label: item.title || "Event video", file: fileUrl(item.id) })),
        );
      })
      .catch(() => undefined);
    amIFounder()
      .then((result) => alive && setFounder(result.founder))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const watchList = [...(live ? [live] : []), ...events];

  // Watching: the radio steps aside; Back (or MENU) leaves the video.
  useEffect(() => {
    if (!playing) return;
    holdRadio("pod-video");
    return () => releaseRadio("pod-video");
  }, [playing]);
  function stopWatching() {
    setPlaying(null);
    setPaused(false);
    setView("chat");
    // Finished a Clinic sermon: back to the Clinic card it came from.
    const from = clinic.current;
    if (from?.id) {
      clinic.current = { id: "", back: "" };
      window.location.replace(`/next?clinic=${encodeURIComponent(from.back || "1")}`);
    }
  }
  useBackLayer(view === "video" || view === "menu" || view === "watch" || view === "suggest", () => (view === "video" ? stopWatching() : setView("chat")), "guy:pod");

  async function ask(line: string) {
    if (!line || busy) return;
    setView("chat");
    if (CRISIS_WORDS.test(line)) setCare(true);
    // Something not working, or praise for Porchbook: he opens Feedback for them.
    const wish = feedbackWish(line);
    if (wish) {
      setTurns((current) => [
        ...current,
        { role: "user", text: line },
        { role: "assistant", text: wish === "__praise" ? "Thank you! Tell the team what you enjoy most, I'll pass it on." : "Sorry about that. Tell me what went wrong, and I'll pass it to the team." },
      ]);
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("porch-trouble", { detail: wish })), 700);
      return;
    }
    setBusy(true);
    const before = turns.slice(-6);
    setTurns((current) => [...current, { role: "user", text: line }]);
    const result = await askPorchGuy({ data: { text: line, before } }).catch(() => null);
    setBusy(false);
    const reply = result?.ok ? result.text : result?.error ?? "I didn't catch that. Try again in a moment.";
    const action = result?.ok && "action" in result ? String(result.action ?? "talk") : "talk";
    setGentle(action === "care");
    if ((ONCE as string[]).includes(action)) setActing(action as Clip);
    setTurns((current) => [...current, { role: "assistant", text: reply }]);
  }
  function send(event: FormEvent) {
    event.preventDefault();
    const line = text.trim();
    setText("");
    void ask(line);
  }

  function choose(index: number) {
    if (view === "menu") {
      const item = MENU[index];
      if (item === "Ask") {
        setView("chat");
        input.current?.focus();
      } else if (item === "Watch") {
        setView("watch");
        setPick(0);
      } else if (item === "What's on") void ask("What's on this week?");
      else if (item === "Ideas to ask") {
        setView("suggest");
        setPick(0);
      } else if (item === "Help") void ask("How do I use Porchbook?");
      else if (item === "Feedback") {
        setView("chat");
        window.dispatchEvent(new CustomEvent("porch-trouble", { detail: "__choose" }));
      }
    } else if (view === "watch") {
      const item = watchList[index];
      if (!item) return;
      setPlaying(item);
      setPaused(false);
      setView("video");
    } else if (view === "suggest") {
      void ask(SUGGESTIONS[index]);
    }
  }
  const listLength = view === "menu" ? MENU.length : view === "watch" ? watchList.length : view === "suggest" ? SUGGESTIONS.length : 0;

  function togglePlay() {
    if (view !== "video" || !playing) {
      // Nothing on: the live service if there is one, otherwise the list of videos.
      if (live) {
        setPlaying(live);
        setPaused(false);
        setView("video");
      } else {
        setView("watch");
        setPick(0);
      }
      return;
    }
    const next = !paused;
    setPaused(next);
    if (film.current) {
      if (next) film.current.pause();
      else void film.current.play();
    }
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: next ? "pauseVideo" : "playVideo", args: "" }), "*");
  }

  function onKey(key: PodKey) {
    if (key === "menu") {
      if (view === "video") stopWatching();
      else if (view === "chat") {
        setView("menu");
        setPick(0);
      } else setView(view === "menu" ? "chat" : "menu");
      return;
    }
    if (key === "play") return togglePlay();
    if (key === "centre") {
      if (listLength) return choose(pick);
      if (view === "video") return togglePlay();
      input.current?.focus();
      return;
    }
    // ⏮ ⏭: move through a list, or through his earlier answers; ⏭ on a fresh screen shows ideas to ask.
    if (listLength) {
      setPick((now) => (now + (key === "next" ? 1 : -1) + listLength) % listLength);
      return;
    }
    if (view === "chat") {
      if (key === "prev") setBack((now) => Math.min(Math.max(0, answers.length - 1), now + 1));
      else if (back > 0) setBack((now) => now - 1);
      else {
        setView("suggest");
        setPick(0);
      }
    }
  }
  const spinCarry = useRef(0);
  function onSpin(degrees: number) {
    if (listLength) {
      spinCarry.current += degrees;
      while (Math.abs(spinCarry.current) >= 30) {
        const step = Math.sign(spinCarry.current);
        spinCarry.current -= step * 30;
        setPick((now) => (now + step + listLength) % listLength);
      }
      return;
    }
    scroller.current?.scrollBy({ top: degrees * 1.6 });
  }

  // What's on the screen.
  const earlier = back > 0 ? answers[answers.length - 1 - back] : null;
  const asked = back > 0 ? questions[questions.length - 1 - back] : questions.at(-1);
  const words = earlier ?? (busy ? "" : said ? shown : GREETING);
  const listItems = view === "menu" ? [...MENU] : view === "watch" ? watchList.map((item) => item.label) : SUGGESTIONS;
  const screen =
    view === "video" && playing ? (
      <div className="pod-view is-video">
        {playing.youtube ? (
          <iframe
            ref={frame}
            title={playing.label}
            // YouTube's normal player, told it's playing on Porchbook (the no-cookie player
            // was refused for lives inside the app as "restricted").
            src={`https://www.youtube.com/embed/${encodeURIComponent(playing.youtube)}?autoplay=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}&widget_referrer=${encodeURIComponent(window.location.origin)}`}
            referrerPolicy="strict-origin-when-cross-origin"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <video ref={film} src={playing.file} autoPlay playsInline controls onEnded={stopWatching} />
        )}
        <span className="pod-bar is-over">
          <span>{playing.label}</span>
          <span>MENU · BACK</span>
        </span>
      </div>
    ) : (
      <div className="pod-view">
        <span className="pod-bar">
          <span>PORCHGUY</span>
          <span className="pod-online">● ONLINE</span>
        </span>
        {listLength || view === "watch" ? (
          <div className="pod-list" role="listbox" aria-label={view === "menu" ? "Menu" : view === "watch" ? "Watch" : "Ideas to ask"}>
            <p className="pod-list-head">{view === "menu" ? "MENU" : view === "watch" ? "WATCH" : "IDEAS TO ASK"}</p>
            {listItems.length ? (
              listItems.map((item, index) => (
                <button key={item} type="button" role="option" aria-selected={index === pick} className={index === pick ? "is-on" : ""} onClick={() => choose(index)}>
                  {item}
                </button>
              ))
            ) : (
              <p className="pod-empty">Nothing to watch right now.</p>
            )}
          </div>
        ) : (
          <>
            <GuyOnScreen clip={clip} mood={mood} onDone={() => setActing(null)} />
            <div ref={scroller} className="pod-scroll" aria-live="polite">
              {asked ? <p className="pod-asked">You: {asked}</p> : null}
              <p className="pod-said">
                <b>PORCH GUY{earlier ? ` · EARLIER ${answers.length - back}/${answers.length}` : ""}</b>
                {busy && !earlier ? <span className="pod-dots">Thinking</span> : words}
                {typing && !earlier ? <span className="pod-caret" /> : null}
              </p>
            </div>
          </>
        )}
      </div>
    );

  // Founder tools (behind ⋯): edit words, show a YouTube live to everyone.
  const [toolsOpen, setToolsOpen] = useState(false);
  const [demoLink, setDemoLink] = useState("");
  const [demoNote, setDemoNote] = useState("");
  // The background behind the player: a photo or a plain colour the founder chose (everyone sees it).
  const covers = useCovers();
  const [bgNote, setBgNote] = useState("");
  const backdrop = covers.backdropOf(GUY_BG);
  const pageStyle: CSSProperties | undefined = backdrop?.photo
    ? { backgroundImage: `linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.45)),url("${backdrop.photo}")`, backgroundSize: "cover", backgroundPosition: "center" }
    : backdrop?.color
      ? { background: backdrop.color }
      : undefined;

  return (
    <AppFrame>
      <div className="pg-pod-page" style={pageStyle}>
        <PorchSpin
          screen={screen}
          centreLabel={listLength ? "OK" : view === "video" ? "❚❚" : "ASK"}
          onKey={onKey}
          onSpin={onSpin}
          onBack={() => {
            setActing("wave");
            setTurns((current) => [...current, { role: "assistant", text: "Hello again! I'm right here. What would you like to know?" }]);
          }}
        />
        <GuyMeter refreshKey={turns.length} />
        {founder ? (
          <>
            <button type="button" className={`pg-more${toolsOpen ? " is-open" : ""}`} aria-label="Founder tools" aria-expanded={toolsOpen} onClick={() => setToolsOpen((open) => !open)}>
              {toolsOpen ? "✕" : "⋯"}
            </button>
            <div className={`pg-founder${toolsOpen ? " is-open" : ""}`}>
              <span className="pg-founder-lab">Founder</span>
              <EditWordsButton className="porchguy-wall-open" />
              <div className="pg-bg">
                <p>Background</p>
                <div className="pg-bg-row">
                  <label className="pg-bg-photo">
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        setBgNote("Putting it up…");
                        void covers.choose(GUY_BG, file, 1100).then((error) => setBgNote(error));
                      }}
                    />
                    Photo
                  </label>
                  {GUY_BG_COLOURS.map((colour) => (
                    <button
                      key={colour}
                      type="button"
                      className={`pg-bg-swatch${backdrop?.color === colour ? " is-on" : ""}`}
                      style={{ background: colour }}
                      aria-label={`Background colour ${colour}`}
                      onClick={() => void covers.chooseColor(GUY_BG, colour).then(setBgNote)}
                    />
                  ))}
                  <button type="button" className="pg-bg-reset" aria-label="Put back the usual background" onClick={() => void covers.reset(GUY_BG).then(setBgNote)}>
                    ↺
                  </button>
                </div>
                {bgNote ? <p className="pg-demo-note">{bgNote}</p> : null}
              </div>
              {live ? (
                <button
                  type="button"
                  className="porchguy-wall-open"
                  onClick={() => {
                    void setLiveVideo({ data: { link: "" } })
                      .then(() => setLiveTick((n) => n + 1))
                      .catch(() => undefined);
                  }}
                >
                  ■ Stop showing live
                </button>
              ) : (
                <div className="pg-demo">
                  <p>Show a YouTube live on everyone's porch guy screen (and the radio). Paste its link:</p>
                  <input value={demoLink} onChange={(event) => setDemoLink(event.target.value)} placeholder="https://youtu.be/…" autoComplete="off" />
                  <button
                    type="button"
                    className="pg-reset-yes"
                    onClick={() => {
                      setDemoNote("Showing…");
                      setLiveVideo({ data: { link: demoLink, label: "auto" } })
                        .then((result) => {
                          if (!result.ok) {
                            setDemoNote(result.error);
                            return;
                          }
                          setDemoNote("");
                          setDemoLink("");
                          setToolsOpen(false);
                          setLiveTick((n) => n + 1);
                        })
                        .catch(() => setDemoNote("That didn't go through. Try again."));
                    }}
                  >
                    Show to everyone
                  </button>
                  {demoNote ? <p className="pg-demo-note">{demoNote}</p> : null}
                </div>
              )}
            </div>
          </>
        ) : null}
        {care ? (
          <div className="pg-care" role="dialog" aria-label="Help is near">
            <div className="pg-care-head">
              <b>You don't have to go through this alone</b>
              <button type="button" aria-label="Close" onClick={() => setCare(false)}>
                ✕
              </button>
            </div>
            <p>Talk to someone now. These calls are free:</p>
            {CRISIS_LINES.map((item) => (
              <a key={item.number} href={`tel:${item.number}`} className="pg-care-call">
                <span>📞 {item.name}</span>
                <small>
                  {item.number} · {item.note}
                </small>
              </a>
            ))}
            <a href="/messages" className="pg-care-friend">
              💬 Message someone you trust on Porchbook
            </a>
          </div>
        ) : null}
        <form autoComplete="off" role="search" className="porchguy-talk pg-talk pod-talk" onSubmit={send}>
          <input
            ref={input}
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, 240))}
            placeholder="Talk to the porch guy…"
            aria-label="Talk to the porch guy"
            type="search"
            name="porchguy-chat"
            autoComplete="off"
            autoCorrect="on"
            spellCheck
            enterKeyHint="send"
            inputMode="text"
            data-form-type="other"
            data-lpignore="true"
          />
          <button type="submit" disabled={busy || !text.trim()}>
            {busy ? "…" : "Send"}
          </button>
        </form>
      </div>
    </AppFrame>
  );
}
