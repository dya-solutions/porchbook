import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/**
 * The butterfly of the Porchbook logo: when someone starts writing a post it flies down and rests
 * on the post box's bottom corner (a tap makes it flap); when they post (or clear the box) it flies home.
 */

type Phase = "home" | "out" | "landed" | "back";
let phase: Phase = "home";
let flight: { from: DOMRect; to: DOMRect; going: Phase } | null = null;
const listeners = new Set<() => void>();
function set(next: Phase) {
  phase = next;
  listeners.forEach((fn) => fn());
}
function usePhase() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => phase,
    () => "home" as Phase,
  );
}

/** Where the butterfly sits in the logo at the top (the visible one). */
function logoSpot(): DOMRect | null {
  const logo = [...document.querySelectorAll<HTMLImageElement>("img.head-logo")].find((img) => img.offsetParent && img.getBoundingClientRect().width > 0);
  if (!logo) return null;
  const r = logo.getBoundingClientRect();
  // In the logo picture the butterfly spans about 26–74% across and 9–65% down.
  const w = r.width * 0.48;
  const h = r.height * 0.56;
  return new DOMRect(r.left + r.width * 0.26, r.top + r.height * 0.09, w, h);
}

/** Its resting place on the post box's bottom-right corner. */
function restSpot(box: HTMLElement): DOMRect {
  const r = box.getBoundingClientRect();
  const size = 38;
  return new DOMRect(r.right - size - 8, r.bottom - size - 6, size, size * 0.67);
}

let restingBox: HTMLElement | null = null;

/** Someone started writing: fly down to their post box. */
export function flyToBox(box: HTMLElement | null) {
  if (!box || phase === "out" || phase === "landed") return;
  restingBox = box;
  const from = logoSpot();
  const to = restSpot(box);
  if (!from) {
    set("landed");
    return;
  }
  flight = { from, to, going: "out" };
  set("out");
}

/** Posted, or the box was cleared: fly home to the logo. */
export function flyHome() {
  if (phase === "home" || phase === "back") return;
  const resting = document.querySelector<HTMLElement>(".lf-rest");
  const from = resting?.getBoundingClientRect() ?? (restingBox ? restSpot(restingBox) : null);
  const to = logoSpot();
  if (!from || !to) {
    set("home");
    return;
  }
  flight = { from, to, going: "back" };
  set("back");
}

/** The logo at the top: without its butterfly while it's away. */
export function useLogoAway() {
  const now = usePhase();
  return now !== "home";
}

function Wings({ flapping }: { flapping: boolean }) {
  return (
    <>
      <img src="/wing-left.png?v=5" alt="" className={`butterfly-wing butterfly-left${flapping ? " lf-flap" : ""}`} draggable={false} />
      <img src="/wing-right.png?v=5" alt="" className={`butterfly-wing butterfly-right${flapping ? " lf-flap" : ""}`} draggable={false} />
    </>
  );
}

/** The butterfly in flight. Only the first one mounted flies (the frame has a logo for phones and one for computers). */
let owner = 0;
let nextId = 1;
export function LogoFlyer() {
  const now = usePhase();
  const [, setTick] = useState(0);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [id] = useState(() => nextId++);
  const [mine, setMine] = useState(false);
  useEffect(() => {
    if (!owner) owner = id;
    setMine(owner === id);
    return () => {
      if (owner === id) owner = 0;
    };
  }, [id]);
  useEffect(() => {
    if (!node || !flight || (now !== "out" && now !== "back")) return;
    const { from, to, going } = flight;
    const size = (r: DOMRect) => Math.max(r.width, r.height * 1.5);
    const a = { x: from.left + from.width / 2, y: from.top + from.height / 2, s: size(from) };
    const b = { x: to.left + to.width / 2, y: to.top + to.height / 2, s: size(to) };
    const box = Math.max(a.s, b.s);
    // A gentle, curving flight with a little rise and sway.
    const point = (t: number) => {
      const sway = Math.sin(t * Math.PI * 2) * 28 * (1 - t) * (going === "out" ? 1 : -1);
      const lift = Math.sin(t * Math.PI) * -70;
      const x = a.x + (b.x - a.x) * t + sway;
      const y = a.y + (b.y - a.y) * (t * t * (3 - 2 * t)) + lift;
      const s = (a.s + (b.s - a.s) * t) / box;
      const tilt = Math.sin(t * Math.PI * 3) * 12;
      return { transform: `translate(${x - box / 2}px, ${y - box / 2}px) rotate(${tilt}deg) scale(${s})` };
    };
    const frames = Array.from({ length: 13 }, (_, i) => point(i / 12));
    node.style.width = `${box}px`;
    node.style.height = `${box}px`;
    const run = node.animate(frames, { duration: going === "out" ? 1500 : 1300, easing: "ease-in-out", fill: "forwards" });
    run.onfinish = () => {
      flight = null;
      set(going === "out" ? "landed" : "home");
      setTick((n) => n + 1);
    };
    return () => run.cancel();
  }, [node, now]);
  if (!mine || (now !== "out" && now !== "back")) return null;
  return createPortal(
    <div ref={setNode} className="lf-flyer butterfly" aria-hidden="true">
      <Wings flapping />
    </div>,
    document.body,
  );
}

/** The butterfly resting on the post box's corner. A tap makes it flap. */
export function RestingFly() {
  const now = usePhase();
  const [flap, setFlap] = useState(false);
  useEffect(() => {
    if (!flap) return;
    const timer = window.setTimeout(() => setFlap(false), 1100);
    return () => window.clearTimeout(timer);
  }, [flap]);
  if (now !== "landed") return null;
  return (
    <button type="button" className="lf-rest butterfly" aria-label="The Porchbook butterfly" onClick={() => setFlap(true)} onMouseDown={(event) => event.preventDefault()}>
      <Wings flapping={flap} />
    </button>
  );
}
