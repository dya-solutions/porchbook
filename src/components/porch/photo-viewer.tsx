import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBackLayer } from "@/lib/porch/back-stack";

/**
 * A photo, big, in a Porchbook window (the name on top, ✕): pinch or double-tap to zoom,
 * drag to look around, swipe down (or ✕, Back, or a tap outside) to close.
 * Like the post, it can't be long-pressed to save.
 */
export function PhotoViewer({ src, title = "", onClose }: { src: string; title?: string; onClose: () => void }) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [drop, setDrop] = useState(0); // swipe-down distance while not zoomed
  const [smooth, setSmooth] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ scale: number; x: number; y: number; dist: number; cx: number; cy: number; px: number; py: number } | null>(null);
  const lastTap = useRef(0);
  const moved = useRef(false);

  useBackLayer(true, onClose, "photo");
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  const clampScale = (s: number) => Math.max(1, Math.min(5, s));
  const img = useRef<HTMLImageElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // The middle of the window's photo area, on screen.
  const centre = () => {
    const box = body.current?.getBoundingClientRect();
    return box ? { ox: box.left + box.width / 2, oy: box.top + box.height / 2, w: box.width, h: box.height } : { ox: window.innerWidth / 2, oy: window.innerHeight / 2, w: window.innerWidth, h: window.innerHeight };
  };
  // Keep the zoomed photo filling the window: no empty gaps at its edges.
  const fit = (next: { scale: number; x: number; y: number }) => {
    const el = img.current;
    if (!el) return next;
    const { w, h } = centre();
    const maxX = Math.max(0, (el.offsetWidth * next.scale - w) / 2);
    const maxY = Math.max(0, (el.offsetHeight * next.scale - h) / 2);
    return { scale: next.scale, x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) };
  };

  function begin() {
    const pts = [...pointers.current.values()];
    const [a, b] = pts;
    const dist = b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    const cx = b ? (a.x + b.x) / 2 : a.x;
    const cy = b ? (a.y + b.y) / 2 : a.y;
    start.current = { scale: view.scale, x: view.x, y: view.y, dist, cx, cy, px: a.x, py: a.y };
  }

  function down(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".pv-close")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setSmooth(false);
    moved.current = false;
    begin();
  }

  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId) || !start.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pts = [...pointers.current.values()];
    const s = start.current;
    if (pts.length >= 2 && s.dist > 0) {
      // Pinch: zoom around the point between the fingers.
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const scale = clampScale(s.scale * (dist / s.dist));
      const k = scale / s.scale;
      const { ox, oy } = centre();
      setView({ scale, x: cx - ox - (s.cx - ox - s.x) * k, y: cy - oy - (s.cy - oy - s.y) * k });
      moved.current = true;
      return;
    }
    const dx = event.clientX - s.px;
    const dy = event.clientY - s.py;
    if (Math.abs(dx) + Math.abs(dy) > 6) moved.current = true;
    if (view.scale > 1.01) setView(fit({ scale: s.scale, x: s.x + dx, y: s.y + dy }));
    else setDrop(Math.max(0, dy));
  }

  function up(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size) {
      begin();
      return;
    }
    setSmooth(true);
    setView((now) => fit(now));
    if (view.scale <= 1.01) {
      if (drop > 120) {
        onClose();
        return;
      }
      setDrop(0);
      setView({ scale: 1, x: 0, y: 0 });
    }
    if (!moved.current) {
      // Double-tap: zoom in where tapped, or back out.
      const now = Date.now();
      if (now - lastTap.current < 300) {
        lastTap.current = 0;
        if (view.scale > 1.01) setView({ scale: 1, x: 0, y: 0 });
        else {
          const scale = 2.5;
          const { ox, oy } = centre();
          setView(fit({ scale, x: -(event.clientX - ox) * (scale - 1), y: -(event.clientY - oy) * (scale - 1) }));
        }
      } else lastTap.current = now;
    }
    start.current = null;
  }

  return createPortal(
    <div
      className="pv"
      style={{ background: `rgba(0,0,0,${Math.max(0.3, 0.78 - drop / 600)})` }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onContextMenu={(event) => event.preventDefault()}
      role="dialog"
      aria-label={title ? `Photo · ${title}` : "Photo"}
    >
      <div className="pv-frame" style={{ transform: drop ? `translateY(${drop * 0.6}px)` : undefined, transition: smooth ? "transform .2s ease-out" : "none" }}>
        <div className="pv-head">
          <span className="pv-title">{title}</span>
          <button type="button" className="pv-close" aria-label="Close photo" onClick={onClose}>
            ✕
          </button>
        </div>
        <div ref={body} className="pv-body" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <img
            ref={img}
            src={src}
            alt=""
            draggable={false}
            className="pv-img"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transition: smooth ? "transform .2s ease-out" : "none",
            }}
            onDragStart={(event) => event.preventDefault()}
          />
        </div>
        <p className="pv-hint">Pinch or double-tap to zoom</p>
      </div>
    </div>,
    document.body,
  );
}
