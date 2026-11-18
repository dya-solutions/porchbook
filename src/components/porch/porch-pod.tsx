import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

/**
 * The porch guy's pocket device: a deep-green player you can turn around in 3D with a finger.
 * Its glass and body catch the light as it turns; let go and it settles back to face you.
 * The porch guy lives on its screen. The wheel: MENU (top), ⏮ (left), ⏭ (right), ▶❚❚ (bottom),
 * the centre button, and circling a finger round the ring to scroll.
 * Built from the page itself (no 3D engine), so it is light on every phone.
 */

export type PodKey = "menu" | "prev" | "next" | "play" | "centre";

export function PorchPod({
  screen,
  centreLabel,
  onKey,
  onSpin,
  onBack,
}: {
  screen: ReactNode;
  centreLabel: string;
  onKey: (key: PodKey) => void;
  /** Circling the wheel: + clockwise, − anticlockwise (degrees). */
  onSpin: (degrees: number) => void;
  /** The back was tapped. */
  onBack: () => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [angle, setAngle] = useState(0);
  const [settling, setSettling] = useState(false);
  const drag = useRef<{ x: number; from: number; moved: boolean } | null>(null);
  const flipTimer = useRef(0);
  // Its size, worked out here in pixels (some phone browsers don't understand the screen-height units).
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const fit = () => {
      const box = node.getBoundingClientRect();
      const byWidth = Math.min(box.width * 0.74, 330);
      const byHeight = (box.height - 120) / 1.82; // room for the hint below and the chips above
      setSize(Math.max(150, Math.round(Math.min(byWidth, byHeight))));
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(node);
    return () => watch.disconnect();
  }, []);


  // Zoom: pinch with two fingers, or double-tap an empty spot (in and out again).
  const [zoom, setZoom] = useState(1);
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; from: number } | null>(null);
  const lastTap = useRef(0);
  const spread = () => {
    const [a, b] = [...fingers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  function down(event: ReactPointerEvent<HTMLDivElement>) {
    fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (fingers.current.size === 2) {
      drag.current = null;
      pinch.current = { dist: spread(), from: zoom };
      return;
    }
    if ((event.target as HTMLElement).closest(".pod-wheel, .pod-screen button, .pod-screen a, .pod-screen video, .pod-screen iframe, .pod-scroll")) return;
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      setZoom((z) => (z > 1.05 ? 1 : 1.4));
      return;
    }
    lastTap.current = now;
    drag.current = { x: event.clientX, from: angle, moved: false };
    setSettling(false);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (fingers.current.has(event.pointerId)) fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && fingers.current.size >= 2) {
      const next = pinch.current.from * (spread() / Math.max(1, pinch.current.dist));
      setZoom(Math.max(1, Math.min(2.4, next)));
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    if (Math.abs(dx) > 4) d.moved = true;
    setAngle(d.from + dx * 0.75);
  }
  function up(event?: ReactPointerEvent<HTMLDivElement>) {
    if (event) fingers.current.delete(event.pointerId);
    if (fingers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    // Settle facing you (or its back, if you left it turned round).
    const turns = Math.round(angle / 360);
    const facing = ((angle % 360) + 360) % 360;
    const showBack = facing > 90 && facing < 270;
    setSettling(true);
    setAngle(turns * 360 + (showBack ? 180 * Math.sign(angle - turns * 360 || 1) : 0));
    if (showBack) {
      window.clearTimeout(flipTimer.current);
      flipTimer.current = window.setTimeout(() => {
        setAngle((now) => Math.round(now / 360) * 360);
      }, 2600);
    }
  }
  useEffect(() => () => window.clearTimeout(flipTimer.current), []);

  function tapBack() {
    if (drag.current?.moved) return;
    onBack();
    setSettling(true);
    setAngle((now) => Math.round(now / 360) * 360);
  }
  function flipOver() {
    setSettling(true);
    setAngle((now) => now + 360);
  }

  const shown = angle;
  const facing = ((shown % 360) + 360) % 360;
  // The light: a bright band that slides across the glass and body as it turns.
  const shine = 50 - Math.sin((shown * Math.PI) / 180) * 70;

  return (
    <div ref={stage} className="pod-stage" style={size ? ({ ["--w" as string]: `${size}px`, ["--h" as string]: `${Math.round(size * 1.82)}px`, ["--d" as string]: `${Math.round(size * 0.04)}px`, ["--r" as string]: `${Math.round(size * 0.11)}px` } as React.CSSProperties) : undefined} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {/* A slow sway while nobody touches it, so the light plays over it. */}
      <div className="pod-zoom" style={{ transform: `scale(${zoom})` }}>
      <div className={`pod-float${drag.current ? " is-held" : ""}`}>
      <div
        ref={body}
        className={`pod${settling ? " is-settling" : ""}`}
        style={{ transform: `rotateX(4deg) rotateY(${shown}deg)`, ["--shine" as string]: `${shine}%`, ["--edge" as string]: `${Math.abs(Math.sin((shown * Math.PI) / 180))}` }}
        onTransitionEnd={() => setSettling(false)}
      >
        {/* The body's thickness: four polished side panels standing at right angles to the faces
            (phone browsers draw these reliably; stacked layers got drawn through the face). */}
        <div className="pod-side is-left" />
        <div className="pod-side is-right" />
        <div className="pod-side is-top" />
        <div className="pod-side is-bottom" />
        <div className="pod-face pod-back" onClick={tapBack} role="button" aria-label="The back of the porch guy's device: tap to turn it round">
          <span className="pod-screw is-a" />
          <span className="pod-screw is-b" />
          <img src="/logo.png?v=5" alt="" draggable={false} />
          <span className="pod-sheen" />
        </div>
        <div className="pod-face pod-front">
          <div className="pod-screen">
            {screen}
            <span className="pod-glass" />
          </div>
          <Wheel centreLabel={centreLabel} onKey={onKey} onSpin={onSpin} />
          <span className="pod-sheen" />
        </div>
      </div>
      </div>
      </div>
      {zoom > 1.05 ? (
        <button type="button" className="pod-unzoom" onClick={() => setZoom(1)} aria-label="Zoom back out">
          − Zoom out
        </button>
      ) : null}
      <div className="pod-floor" style={{ ["--shine" as string]: `${shine}%` }} />
      <button type="button" className="pod-turn" onClick={flipOver} aria-label="Turn the device round">
        ↻ {facing > 90 && facing < 270 ? "Turn back" : "Drag to turn · pinch or double-tap to zoom"}
      </button>
    </div>
  );
}

export function Wheel({ centreLabel, onKey, onSpin }: { centreLabel: string; onKey: (key: PodKey) => void; onSpin: (degrees: number) => void }) {
  const ring = useRef<HTMLDivElement>(null);
  const spin = useRef<{ last: number; total: number } | null>(null);
  const angleAt = (event: ReactPointerEvent) => {
    const box = ring.current?.getBoundingClientRect();
    if (!box) return 0;
    return (Math.atan2(event.clientY - (box.top + box.height / 2), event.clientX - (box.left + box.width / 2)) * 180) / Math.PI;
  };
  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".pod-hub")) return;
    spin.current = { last: angleAt(event), total: 0 };
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const s = spin.current;
    if (!s) return;
    const now = angleAt(event);
    let delta = now - s.last;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    s.last = now;
    s.total += Math.abs(delta);
    if (s.total > 12) {
      event.currentTarget.setPointerCapture(event.pointerId);
      onSpin(delta);
    }
  }
  function up() {
    window.setTimeout(() => (spin.current = null), 0);
  }
  const press = (key: PodKey) => () => {
    if (spin.current && spin.current.total > 12) return; // that was a spin, not a press
    onKey(key);
  };
  return (
    <div ref={ring} className="pod-wheel" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <button type="button" className="pod-wkey is-top" onClick={press("menu")} aria-label="Menu">
        MENU
      </button>
      <button type="button" className="pod-wkey is-left" onClick={press("prev")} aria-label="Previous">
        ⏮
      </button>
      <button type="button" className="pod-wkey is-right" onClick={press("next")} aria-label="Next">
        ⏭
      </button>
      <button type="button" className="pod-wkey is-bottom" onClick={press("play")} aria-label="Play or pause">
        ▶❚❚
      </button>
      <button type="button" className="pod-hub" onClick={() => onKey("centre")} aria-label={centreLabel}>
        {centreLabel}
      </button>
    </div>
  );
}
