import { askLine } from "@/lib/porch/line-call";
import { useTopStyle } from "@/lib/porch/top-style";
import { crackOverlay, creak, shatterCard, smash } from "@/components/porch/shatter";
import { PresenceDot } from "@/components/porch/porch-online";
import { isDoNotDisturb } from "@/lib/porch/presence-store";
import { LitePhoto } from "@/components/porch/lite-bits";
import { PhotoViewer } from "@/components/porch/photo-viewer";
import { Link, useNavigate } from "@tanstack/react-router";
import { playBendSound, playButtonSound, stopBendSound } from "@/lib/porch/button-sound-play";
import { Phone, Video } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import porchButterfly from "@/assets/porch-butterfly.png";

const SIZES = {
  sm: "size-8 text-sm",
  md: "size-10 text-base",
  lg: "size-16 text-xl",
} as const;

export function PostWindow({
  className,
  children,
  shatter,
  onShattered,
}: {
  className?: string;
  children: ReactNode;
  /** Hold the post: it cracks and shatters. "delete" for your own post, "fun" for others'. */
  shatter?: "delete" | "fun";
  onShattered?: () => void;
}) {
  const card = useRef<HTMLElement>(null);
  const crack = useRef<{ timer: number; frame: number; overlay: ReturnType<typeof crackOverlay> | null; at: { x: number; y: number } } | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const sounding = useRef(false);
  const hold = useRef(0);
  const [bend, setBend] = useState("");
  const [flutter, setFlutter] = useState(0);

  useEffect(() => () => {
    window.clearTimeout(hold.current);
    stopCrack();
  }, []);

  // ---- Hold to shatter: cracks start after 0.6 s and cover the card by 3 s.
  const CRACK_START = 600;
  const CRACK_FULL = 3000;
  function stopCrack(heal = true) {
    const current = crack.current;
    if (!current) return;
    window.clearTimeout(current.timer);
    cancelAnimationFrame(current.frame);
    const overlay = current.overlay;
    crack.current = null;
    if (!overlay) return;
    if (!heal) {
      overlay.remove();
      return;
    }
    const svg = card.current?.querySelector(".post-cracks") as SVGElement | null;
    if (svg) {
      svg.style.transition = "opacity .35s";
      svg.style.opacity = "0";
      window.setTimeout(() => overlay.remove(), 380);
    } else overlay.remove();
  }
  function startCrack(event: PointerEvent<HTMLElement>) {
    if (!shatter || !card.current) return;
    stopCrack(false);
    const box = card.current.getBoundingClientRect();
    const at = { x: event.clientX - box.left, y: event.clientY - box.top };
    const begun = performance.now();
    const state: NonNullable<typeof crack.current> = { timer: 0, frame: 0, overlay: null, at };
    crack.current = state;
    let lastTick = 0;
    state.timer = window.setTimeout(() => {
      if (crack.current !== state || !card.current) return;
      state.overlay = crackOverlay(card.current, at);
      const step = () => {
        if (crack.current !== state) return;
        const progress = Math.min(1, (performance.now() - begun - CRACK_START) / (CRACK_FULL - CRACK_START));
        state.overlay?.set(progress);
        const tick = Math.floor(progress * 8);
        if (tick > lastTick) {
          lastTick = tick;
          creak(progress);
          tap(8 + Math.round(progress * 14));
        }
        if (progress >= 1) {
          finishShatter();
          return;
        }
        state.frame = requestAnimationFrame(step);
      };
      creak(0);
      tap(10);
      state.frame = requestAnimationFrame(step);
    }, CRACK_START);
  }
  function finishShatter() {
    const node = card.current;
    const state = crack.current;
    if (!node || !state) return;
    stopCrack(false);
    window.clearTimeout(hold.current);
    if (sounding.current) stopBendSound();
    sounding.current = false;
    setBend("");
    node.removeAttribute("data-bend");
    smash();
    tap(60);
    void shatterCard(node, state.at).then(() => {
      if (shatter === "delete") {
        onShattered?.();
        return;
      }
      // Just for fun: the post reassembles.
      node.style.visibility = "";
      node.animate([{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, transform: "scale(1)" }], { duration: 420, easing: "ease-out" });
    });
  }

  // The logo butterfly in the corner flutters when the post is bent or reacted to.
  function wake() {
    setFlutter((n) => n + 1);
  }

  function release() {
    stopCrack();
    window.clearTimeout(hold.current);
    if (sounding.current) stopBendSound();
    sounding.current = false;
    setBend("");
  }

  function press(event: PointerEvent<HTMLElement>) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const node = event.target instanceof Element ? event.target : null;
    if (node?.closest("a, button, input, textarea, select, label")) return;
    const box = card.current?.getBoundingClientRect();
    if (!box) return;
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const reach = 28;
    let kind = "";
    if (x <= reach) kind = "left";
    else if (box.width - x <= reach) kind = "right";
    else if (y <= reach) kind = "top";
    else if (box.height - y <= reach) kind = "bottom";
    start.current = { x: event.clientX, y: event.clientY };
    if (kind) {
      event.currentTarget.setPointerCapture(event.pointerId);
      sounding.current = true;
      setBend(kind);
      playBendSound();
      wake();
      return;
    }
    window.clearTimeout(hold.current);
    startCrack(event);
    hold.current = window.setTimeout(() => {
      sounding.current = true;
      setBend("out");
      playBendSound();
      wake();
    }, 220);
  }

  function follow(event: PointerEvent<HTMLElement>) {
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;
    if ((Math.abs(dy) > 36 && Math.abs(dy) > Math.abs(dx)) || (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy))) release();
  }

  return (
    <article
      ref={card}
      data-bend={bend || undefined}
      className={`post-bend ${shatter ? "can-shatter " : ""}${className ?? ""}`}
      onContextMenu={(event) => {
        if (crack.current) event.preventDefault();
      }}
      onPointerDown={press}
      onPointerMove={follow}
      onPointerUp={release}
      onPointerCancel={release}
      onClickCapture={(event) => {
        if (event.target instanceof Element && event.target.closest("button[aria-pressed]")) wake();
      }}
    >
      {children}
      <img
        key={flutter}
        src={porchButterfly}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={`post-butterfly ${flutter ? "is-fluttering" : ""}`}
      />
    </article>
  );
}

export function KeptPhoto({ src, compact = false, title = "" }: { src: string; compact?: boolean; title?: string }) {
  // Tap to see it full-screen (pinch or double-tap to zoom).
  const [open, setOpen] = useState(false);
  return (
    <LitePhoto>
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      className={`kept-photo mt-3 max-w-full cursor-zoom-in rounded-2xl object-contain ${compact ? "max-h-28" : "max-h-[42vh]"}`}
      onClick={(event) => {
        event.stopPropagation();
        setOpen(true);
      }}
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
    />
    {open ? <PhotoViewer src={src} title={title} onClose={() => setOpen(false)} /> : null}
    </LitePhoto>
  );
}

export function Avatar({
  name,
  imageUrl,
  size = "md",
  userId,
}: {
  name: string;
  imageUrl: string | null;
  size?: keyof typeof SIZES;
  userId?: string;
}) {
  // With a userId, a small dot shows while that person is on the porch.
  if (userId) {
    return (
      <span className="relative inline-flex shrink-0">
        <Avatar name={name} imageUrl={imageUrl} size={size} />
        <PresenceDot userId={userId} />
      </span>
    );
  }
  const letter = (name.trim().charAt(0) || "?").toUpperCase();
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        className={`${SIZES[size]} shrink-0 rounded-full object-cover`}
      />
    );
  }
  return (
    <span
      className={`${SIZES[size]} grid shrink-0 place-items-center rounded-full bg-pine-soft font-medium text-pine`}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

export function LinkText({
  text,
  className = "",
  linkClass = "text-pine underline decoration-pine/40 underline-offset-2",
}: {
  text: string;
  className?: string;
  linkClass?: string;
}) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p className={`text-pretty break-words whitespace-pre-wrap ${className}`}>
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noreferrer"
            className={linkClass}
          >
            {part}
          </a>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </p>
  );
}

export function tap(ms = 14) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* this browser has no vibration */
  }
  const bridge = (window as unknown as { PorchMic?: { vibrate?: (n: number) => void } }).PorchMic;
  try {
    bridge?.vibrate?.(ms);
  } catch {
    /* the page is not inside the Porchbook app */
  }
}

let toneStop: (() => void) | null = null;

export function startTone(kind: "out" | "in") {
  stopTone();
  // Do not disturb: the call still shows, it just doesn't ring.
  if (kind === "in" && isDoNotDisturb()) return;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const gain = ctx.createGain();
  gain.gain.value = 0.045;
  gain.connect(ctx.destination);
  const pulse = () => {
    if (ctx.state === "closed") return;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = kind === "in" ? 523 : 466;
    osc.connect(gain);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
  };
  void ctx.resume().then(pulse).catch(() => undefined);
  const id = window.setInterval(pulse, kind === "in" ? 1300 : 1700);
  toneStop = () => {
    window.clearInterval(id);
    void ctx.close().catch(() => undefined);
  };
}

export function stopTone() {
  toneStop?.();
  toneStop = null;
}

export function openNamedCall(name: string, video: boolean) {
  askLine(name, video);
}

export function CallLink({
  userId,
  name,
  video = false,
  className = "grid min-h-11 min-w-11 place-items-center",
}: {
  userId: string;
  name: string;
  video?: boolean;
  className?: string;
}) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className={className}
      aria-label={video ? `Video call ${name}` : `Call ${name}`}
      onClick={() => {
        playButtonSound();
        void navigate({ to: "/calls", search: { to: userId, name, video: video ? "1" : "" } });
      }}
    >
      {video ? <Video className="size-5 text-[#f5a018]" aria-hidden="true" /> : <Phone className="size-5 text-[#7ed321]" aria-hidden="true" />}
    </button>
  );
}

export function PersonLink({
  userId,
  name,
  imageUrl,
  children,
}: {
  userId: string;
  name: string;
  imageUrl: string | null;
  children?: ReactNode;
}) {
  return (
    <Link
      to="/people/$userId"
      params={{ userId }}
      className="group flex min-w-0 items-center gap-3 rounded-lg"
    >
      <Avatar name={name} imageUrl={imageUrl} userId={userId} />
      <span className="min-w-0">{children}</span>
    </Link>
  );
}

export const fieldClass =
  "w-full rounded-lg glass-edge bg-card px-3 py-2.5 text-base text-ink outline-none placeholder:text-faint";

export const primaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-pine px-4 text-sm font-semibold text-on-pine transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export const quietButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-medium text-muted transition-colors duration-150 hover:bg-line hover:text-ink disabled:opacity-50";

/**
 * Brightness. Normally a vertical slider at the screen's edge; `flat` makes it a dark, sideways
 * hi-fi fader that sits in the page (the Tour page puts it between its buttons and the open panel).
 */
export function ThemePlate({ flat = false }: { flat?: boolean } = {}) {
  const [level, setLevel] = useState(readBright);
  const [hot, setHot] = useState(false);
  const [mounted, setMounted] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const step = useRef(Math.round(readBright() / 5) * 5);
  const fade = useRef(0);

  useEffect(() => {
    setMounted(true);
    applyBright(level);
  }, [level]);

  useEffect(() => () => window.clearTimeout(fade.current), []);
  // The roller's ridges turn with your finger (it never slides).
  const [roll, setRoll] = useState(0);
  const spin = useRef<{ x: number; level: number; roll: number } | null>(null);

  function showReadout() {
    setHot(true);
    window.clearTimeout(fade.current);
    fade.current = window.setTimeout(() => setHot(false), 700);
  }

  function fromPointer(clientY: number, clientX = 0) {
    const node = track.current;
    if (!node) return level;
    if (flat) {
      const box = node.getBoundingClientRect();
      const span = Math.max(1, box.width - 40);
      const x = Math.min(span, Math.max(0, clientX - box.left - 20));
      return Math.round((x / span) * 100);
    }
    const rect = node.getBoundingClientRect();
    const travel = Math.max(1, rect.height - 34);
    const y = Math.min(travel, Math.max(0, clientY - rect.top - 17));
    return Math.round((1 - y / travel) * 100);
  }

  function move(next: number, haptic: boolean) {
    const held = Math.max(0, Math.min(100, next));
    setLevel(held);
    applyBright(held);
    if (!haptic) return;
    const mark = Math.round(held / 5) * 5;
    if (mark === step.current) return;
    step.current = mark;
    const strong = mark === 0 || mark === 50 || mark === 100;
    // In the app, the phone vibrates only on ring or vibrate (never on silent); in a browser, the phone decides.
    try {
      const app = (window as Window & { PorchApp?: { tick?: (strong: boolean) => void } }).PorchApp;
      if (typeof app?.tick === "function") app.tick(strong);
      else navigator.vibrate?.(strong ? [14, 18, 12] : 7);
    } catch {
      /* this phone has no vibration */
    }
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    showReadout();
    move(fromPointer(event.clientY, event.clientX), true);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    showReadout();
    move(fromPointer(event.clientY, event.clientX), true);
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    dragging.current = false;
    const next = Math.round(fromPointer(event.clientY, event.clientX) / 5) * 5;
    move(next, true);
    showReadout();
  }

  function nudge(by: number) {
    setRoll((value) => value + by * 2);
    const next = Math.round((level + by) / 5) * 5;
    move(Math.max(0, Math.min(100, next)), true);
    showReadout();
  }

  const control = (
    <div className="bright-slider">
      <p className={`bright-readout${hot ? " is-hot" : ""}`}>{level}%</p>
      <div className="bright-housing">
        <div
          ref={track}
          className="bright-track"
          role="slider"
          tabIndex={0}
          aria-label="Brightness"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={level}
          aria-orientation="vertical"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowRight") {
              event.preventDefault();
              nudge(5);
            } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
              event.preventDefault();
              nudge(-5);
            } else if (event.key === "Home") {
              event.preventDefault();
              move(100, true);
              showReadout();
            } else if (event.key === "End") {
              event.preventDefault();
              move(0, true);
              showReadout();
            }
          }}
        >
          <span className="bright-knob" style={{ top: `calc(${100 - level}% - ${(100 - level) * 0.34}px)` }} />
        </div>
      </div>
    </div>
  );

  if (flat) {
    // A small fader: tick marks above and below, a twin-pill knob; the track lights up to the knob.
    return (
      <div className="pb-fader-wrap">
        <div
          ref={track}
          className="pb-fader"
          role="slider"
          tabIndex={0}
          aria-label="Brightness"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={level}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowRight") {
              event.preventDefault();
              nudge(5);
            } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
              event.preventDefault();
              nudge(-5);
            }
          }}
        >
          <span className="pb-fader-ticks is-up" aria-hidden="true" />
          <span className="pb-fader-ticks is-down" aria-hidden="true" />
          <span className="pb-fader-groove" aria-hidden="true">
            <i style={{ width: `${level}%` }} />
          </span>
          <span className="pb-fader-knob" aria-hidden="true" style={{ left: `calc(20px + (100% - 40px) * ${level / 100})` }}>
            <b>|||</b>
            <b>|||</b>
          </span>
        </div>
        <p className="pb-fader-read" aria-hidden="true">
          <span>MIN</span>
          <b>{level}%</b>
          <span>MAX</span>
        </p>
      </div>
    );
  }
  if (!mounted) return null;
  return createPortal(control, document.body);
}

function readBright() {
  if (typeof window === "undefined") return 100;
  try {
    const saved = localStorage.getItem("porch-bright");
    if (saved != null && saved !== "") {
      const value = Number(saved);
      if (Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value)));
    }
    const feel = localStorage.getItem("porch-feel");
    if (feel === "lamp") return 8;
    if (feel === "quiet") return 46;
  } catch {
    /* this phone keeps full brightness */
  }
  return 100;
}

function applyBright(level: number) {
  const t = Math.max(0, Math.min(100, level)) / 100;
  const dim = (1 - t) * 0.9;
  const gain = 1 + Math.pow(t, 1.5) * 1.05;
  const wash = Math.pow(t, 2.4) * 0.48;
  const root = document.documentElement.style;
  root.setProperty("--porch-dim", dim.toFixed(3));
  root.setProperty("--porch-gain", gain.toFixed(3));
  root.setProperty("--porch-wash", wash.toFixed(3));
  delete document.documentElement.dataset.feel;
  try {
    localStorage.setItem("porch-bright", String(level));
    localStorage.removeItem("porch-feel");
  } catch {
    /* the level still holds for this visit */
  }
}

const SWITCH_FACE = {
  home: "/switch-off.jpg?v=11",
  tour: "/switch-tour.jpg?v=11",
  read: "/switch-read.jpg?v=12",
} as const;

if (typeof window !== "undefined") {
  for (const src of Object.values(SWITCH_FACE)) {
    const img = new Image();
    img.src = src;
  }
}

// All three switch pictures stay loaded and stacked; only the one for the
// current page is visible. Moving between pages then never blanks the switch
// while a picture loads.
function SwitchFace({ which }: { which: "home" | "tour" | "read" }) {
  return (
    <>
      {(Object.keys(SWITCH_FACE) as (keyof typeof SWITCH_FACE)[]).map((key) => (
        <img
          key={key}
          src={SWITCH_FACE[key]}
          alt=""
          draggable={false}
          decoding="sync"
          fetchPriority="high"
          style={{ opacity: key === which ? 1 : 0 }}
        />
      ))}
    </>
  );
}

export function HomeTourSwitch({ side }: { side: "home" | "tour" | "read" | "away" }) {
  const navigate = useNavigate();
  const [pressed, setPressed] = useState(side);
  const busy = useRef(false);
  const homeOn = pressed === "home";
  const face = pressed === "read" ? "read" : pressed === "tour" ? "tour" : "home";
  const glass = useTopStyle() === "glass";

  useEffect(() => setPressed(side), [side]);

  function go(next: "home" | "tour" | "read") {
    playButtonSound();
    const path = window.location.pathname;
    if (busy.current || (next === "tour" && path === "/next") || (next === "home" && path === "/") || (next === "read" && path === "/read")) return;
    busy.current = true;
    setPressed(next);
    if (next === "home") navigate({ to: "/", search: { room: "all" } });
    else if (next === "tour") navigate({ to: "/next" });
    else navigate({ to: "/read" });
    window.setTimeout(() => {
      busy.current = false;
    }, 160);
  }

  return (
    <div className="porch-switch">
      <button
        type="button"
        onPointerDown={() => go("home")}
        aria-current={side === "home" ? "page" : undefined}
        className={`porch-switch-home porch-nav-pill no-sink${homeOn ? " is-on" : ""}`}
      >
        Home
      </button>
      {glass ? (
        <div className="gl-seg" role="group" aria-label="Tour or Read">
          <button type="button" onPointerDown={() => go("tour")} aria-current={side === "tour" ? "page" : undefined} className={`gl-seg-tour no-sink${face === "tour" ? " is-on" : ""}`}>
            TOUR
          </button>
          <button type="button" onPointerDown={() => go("read")} aria-current={side === "read" ? "page" : undefined} className={`gl-seg-read no-sink${face === "read" ? " is-on" : ""}`}>
            READ
          </button>
        </div>
      ) : (
      <div className="porch-switch-face">
        <SwitchFace which={face} />
        <div className="porch-switch-hits">
          <button
            type="button"
            onPointerDown={() => go("tour")}
            aria-label="Tour"
            aria-current={side === "tour" ? "page" : undefined}
            className="no-sink"
          />
          <button
            type="button"
            onPointerDown={() => go("read")}
            aria-label="Read"
            aria-current={side === "read" ? "page" : undefined}
            className="no-sink"
          />
        </div>
      </div>
      )}
    </div>
  );
}
