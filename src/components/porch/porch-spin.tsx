import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { isLite } from "@/lib/porch/lite";
import { Wheel, type PodKey } from "@/components/porch/porch-pod";

/**
 * The porch guy's device as a real 360° spin: 72 rendered pictures of a glossy model, one every 5°,
 * turned by your finger. The live screen (him, his words, videos) and the wheel's buttons sit on top,
 * fitted to the front of the device at every angle. Let go and it settles facing you (or its back).
 * In Lite only the front and back pictures load.
 */

type Spin = { w: number; h: number; frames: number; face: [number, number][][] };
const FW = 220; // the front face's layout size (px); the overlay is fitted from this
const FH = 400;

/** CSS matrix3d that maps the FW×FH rectangle onto four points (top-left, top-right, bottom-right, bottom-left). */
function fit(q: [number, number][]) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  // From the unit square to the quad; then scale the unit square up to FW×FH.
  const m = [a / FW, d / FW, 0, g / FW, b / FH, e / FH, 0, h / FH, 0, 0, 1, 0, c, f, 0, 1];
  return `matrix3d(${m.map((n) => n.toFixed(6)).join(",")})`;
}
const area = (q: [number, number][]) => q.reduce((sum, [x, y], i) => sum + x * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * y, 0) / 2;

export function PorchSpin({
  screen,
  centreLabel,
  onKey,
  onSpin,
  onBack,
}: {
  screen: ReactNode;
  centreLabel: string;
  onKey: (key: PodKey) => void;
  onSpin: (degrees: number) => void;
  onBack: () => void;
}) {
  const [spin, setSpin] = useState<Spin | null>(null);
  const pictures = useRef<HTMLImageElement[]>([]);
  const [ready, setReady] = useState(false);
  const lite = isLite();
  useEffect(() => {
    let alive = true;
    void fetch("/porchguy/spin/face.json?v=3")
      .then((res) => res.json() as Promise<Spin>)
      .then((data) => {
        if (!alive) return;
        setSpin(data);
        const wanted = lite ? [0, data.frames / 2] : Array.from({ length: data.frames }, (_, i) => i);
        // The front first, then the rest in the background.
        const order = [0, ...wanted.filter((i) => i !== 0)];
        order.forEach((i, n) => {
          const img = new Image();
          img.decoding = "async";
          img.src = `/porchguy/spin/${String(i).padStart(2, "0")}.webp?v=3`;
          if (n === 0) img.addEventListener("load", () => alive && setReady(true), { once: true });
          pictures.current[i] = img;
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [lite]);

  // Size: fit the picture to the space, in pixels.
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 300, h: 450 });
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const measure = () => {
      const r = node.getBoundingClientRect();
      // The device fills about 65% of each picture's width and 80% of its height (the rest is clear margin).
      const w = Math.max(220, Math.min(r.width * 1.3, ((r.height - 96) / 0.8) / 1.5));
      setBox({ w: Math.round(w), h: Math.round(w * 1.5) });
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(node);
    return () => watch.disconnect();
  }, []);

  // Turning: an angle in degrees, eased back to front (0) or back (180) on release.
  const [angle, setAngle] = useState(0);
  const angleRef = useRef(0);
  angleRef.current = angle;
  const drag = useRef<{ x: number; from: number; moved: boolean } | null>(null);
  const ease = useRef(0);
  const settleTo = (target: number) => {
    cancelAnimationFrame(ease.current);
    const from = angleRef.current;
    const start = performance.now();
    const run = (t: number) => {
      const k = Math.min(1, (t - start) / 650);
      const s = 1 - Math.pow(1 - k, 3);
      setAngle(from + (target - from) * s);
      if (k < 1) ease.current = requestAnimationFrame(run);
    };
    ease.current = requestAnimationFrame(run);
  };
  const backTimer = useRef(0);
  useEffect(() => () => {
    cancelAnimationFrame(ease.current);
    window.clearTimeout(backTimer.current);
  }, []);

  // Zoom (pinch or double-tap).
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
    cancelAnimationFrame(ease.current);
    window.clearTimeout(backTimer.current);
    drag.current = { x: event.clientX, from: angleRef.current, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (fingers.current.has(event.pointerId)) fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && fingers.current.size >= 2) {
      setZoom(Math.max(1, Math.min(2.4, pinch.current.from * (spread() / Math.max(1, pinch.current.dist)))));
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    if (Math.abs(dx) > 4) d.moved = true;
    setAngle(d.from + dx * 0.8);
  }
  function up(event: ReactPointerEvent<HTMLDivElement>) {
    fingers.current.delete(event.pointerId);
    if (fingers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      // A tap on the back: he says hello again.
      const facing = ((angleRef.current % 360) + 360) % 360;
      if (facing > 90 && facing < 270) {
        onBack();
        settleTo(Math.round(angleRef.current / 360) * 360);
      }
      return;
    }
    const turns = Math.round(angleRef.current / 360) * 360;
    const rest = angleRef.current - turns;
    const showBack = Math.abs(rest) > 90;
    settleTo(turns + (showBack ? 180 * Math.sign(rest) : 0));
    if (showBack) backTimer.current = window.setTimeout(() => settleTo(Math.round(angleRef.current / 360) * 360), 2600);
  }

  // Which picture, and where the front face is on it.
  const frames = spin?.frames ?? 72;
  let index = ((Math.round(-angle / (360 / frames)) % frames) + frames) % frames;
  if (lite) index = index > frames / 4 && index < (frames * 3) / 4 ? frames / 2 : 0;
  const scale = spin ? box.w / spin.w : 1;
  const quad = spin ? (spin.face[index].map(([x, y]) => [x * scale, y * scale]) as [number, number][]) : null;
  const facingArea = quad ? area(quad) : 0;
  const fullArea = spin ? area(spin.face[0].map(([x, y]) => [x * scale, y * scale]) as [number, number][]) : 1;
  const show = quad && facingArea > fullArea * 0.08;
  const live = show && facingArea > fullArea * 0.7;

  // Each picture's solid device (its see-through shadow left out) and where its bottom is, worked out once.
  const solids = useRef(new Map<number, { mask: HTMLCanvasElement; edge: HTMLCanvasElement; left: number; right: number; top: number; bottom: number }>());
  const solidOf = (i: number, img: HTMLImageElement) => {
    const kept = solids.current.get(i);
    if (kept) return kept;
    const W = 200;
    const H = Math.round((W * img.naturalHeight) / img.naturalWidth);
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const p = c.getContext("2d", { willReadFrequently: true });
    if (!p) return null;
    p.drawImage(img, 0, 0, W, H);
    const data = p.getImageData(0, 0, W, H);
    // The rim's light lines: a band just inside the device's outline (the orange key kept as it is).
    const px = data.data;
    const solidAt = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && px[(y * W + x) * 4 + 3] > 230;
    const edgeData = p.createImageData(W, H);
    const R = 3;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const k = (y * W + x) * 4;
        if (px[k + 3] <= 230) continue;
        const r = px[k], g = px[k + 1], b = px[k + 2];
        if (r > 150 && r > g + 30 && b < 120) continue; // the orange key
        let near = false;
        for (let dy = -R; dy <= R && !near; dy += 1) for (let dx = -R; dx <= R && !near; dx += 1) if (!solidAt(x + dx, y + dy)) near = true;
        if (near) edgeData.data[k + 3] = 255;
      }
    }
    const edge = document.createElement("canvas");
    edge.width = W;
    edge.height = H;
    edge.getContext("2d")?.putImageData(edgeData, 0, 0);
    let left = W, right = 0, top = H, bottom = 0;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const k = (y * W + x) * 4;
        // The device is solid; its baked floor shadow is see-through.
        const solid = data.data[k + 3] > 230;
        data.data[k] = data.data[k + 1] = data.data[k + 2] = 0;
        data.data[k + 3] = solid ? 255 : 0;
        if (solid) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    p.putImageData(data, 0, 0);
    if (right <= left || bottom <= top) return null;
    const done = { mask: c, edge, left: left / W, right: (right + 1) / W, top: top / H, bottom: (bottom + 1) / H };
    solids.current.set(i, done);
    return done;
  };
  const layer = useRef<HTMLCanvasElement | null>(null);
  // The pictures without the white shine on the cameras (lens glints, the chrome ring, the flash):
  // bright, colourless spots are toned down to a dark glassy grey. Made once per picture.
  const cleaned = useRef(new Map<number, HTMLCanvasElement>());
  const cleanOf = (i: number, img: HTMLImageElement): CanvasImageSource => {
    const kept = cleaned.current.get(i);
    if (kept) return kept;
    try {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const x = c.getContext("2d", { willReadFrequently: true });
      if (!x) return img;
      x.drawImage(img, 0, 0);
      // Only on the back (where the cameras are): the front's glossy top rim stays as it is.
      const total = pictures.current.length || 72;
      const turned = (i * 360) / total;
      if (turned < 95 || turned > 265) return img;
      // Only where the cameras sit: the top quarter of the device, away from its rim
      // (the rim's own light edge is part of the phone's look and stays).
      const solid = solidOf(i, img);
      if (!solid) return img;
      const inset = (solid.right - solid.left) * c.width * 0.025;
      const x0 = Math.round(solid.left * c.width + inset);
      const x1 = Math.round(solid.right * c.width - inset);
      const y0 = Math.round(solid.top * c.height + inset);
      const y1 = Math.round(solid.top * c.height + (solid.bottom - solid.top) * c.height * 0.26);
      if (x1 <= x0 || y1 <= y0) return img;
      const data = x.getImageData(x0, y0, x1 - x0, y1 - y0);
      const d = data.data;
      for (let k = 0; k < d.length; k += 4) {
        if (d[k + 3] < 200) continue;
        const r = d[k], g = d[k + 1], b = d[k + 2];
        const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
        const lum = 0.3 * r + 0.59 * g + 0.11 * b;
        if (lum < 120 || hi - lo > 48) continue;
        // How far into "white shine" this pixel is (0 at the edge of it, 1 for pure white).
        const t = Math.min(1, (lum - 120) / 60);
        const target = 62 + (lum - 120) * 0.12;
        const scale = (lum + (target - lum) * t) / Math.max(1, lum);
        d[k] = r * scale;
        d[k + 1] = g * scale;
        d[k + 2] = b * scale;
      }
      x.putImageData(data, x0, y0);
      cleaned.current.set(i, c);
      return c;
    } catch {
      return img;
    }
  };

  // Draw the picture.
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = canvas.current;
    if (!node || !spin) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.round(box.w * dpr);
    const h = Math.round(box.h * dpr);
    if (node.width !== w || node.height !== h) {
      node.width = w;
      node.height = h;
    }
    const pen = node.getContext("2d");
    const img = pictures.current[index] ?? pictures.current[0];
    if (!pen || !img) return;
    const paint = () => {
      pen.clearRect(0, 0, w, h);
      if (!(img.complete && img.naturalWidth)) return;
      pen.drawImage(cleanOf(index, img), 0, 0, w, h);
      try {
        polish(img);
      } catch {
        /* the plain picture is fine */
      }
    };
    // Polished glass: no white shine along the bottom, a clean deep green, and a soft glassy sheen,
    // only on the solid device (never its shadow or the air around it).
    const polish = (pic: HTMLImageElement) => {
      const solid = solidOf(index, pic);
      if (!solid) return;
      const devL = solid.left * w, devR = solid.right * w, devT = solid.top * h, devB = solid.bottom * h;
      const devH = devB - devT;
      const L = layer.current ?? (layer.current = document.createElement("canvas"));
      if (L.width !== w || L.height !== h) {
        L.width = w;
        L.height = h;
      }
      const lp = L.getContext("2d");
      if (!lp) return;
      // 1. The white shine along the bottom turns green: "darken" leaves the green and the black wheel alone.
      lp.globalCompositeOperation = "source-over";
      lp.clearRect(0, 0, w, h);
      const band = devH * 0.12;
      const edge = lp.createLinearGradient(0, devB - band, 0, devB);
      edge.addColorStop(0, "rgba(46,128,32,0)");
      edge.addColorStop(0.5, "rgba(46,128,32,.85)");
      edge.addColorStop(1, "rgba(40,116,28,1)");
      lp.fillStyle = edge;
      lp.fillRect(0, devB - band, w, band + 2);
      lp.globalCompositeOperation = "destination-in";
      lp.drawImage(solid.mask, 0, 0, w, h);
      // ...and all round the rim (the light lines on the sides and top edges), softly.
      lp.globalCompositeOperation = "source-over";
      lp.save();
      lp.filter = `blur(${Math.max(1, w / 260)}px)`;
      lp.drawImage(solid.edge, 0, 0, w, h);
      lp.restore();
      lp.globalCompositeOperation = "source-in";
      lp.fillStyle = "rgb(40,118,28)";
      lp.fillRect(0, 0, w, h);
      lp.globalCompositeOperation = "destination-in";
      lp.drawImage(solid.mask, 0, 0, w, h);
      pen.save();
      pen.globalCompositeOperation = "darken";
      pen.drawImage(L, 0, 0);
      pen.restore();
      // 2. Glassy depth and sheen: brighter where light falls (top), deeper towards the bottom,
      //    and one soft diagonal reflection, like light across polished glass.
      lp.globalCompositeOperation = "source-over";
      lp.clearRect(0, 0, w, h);
      const depth = lp.createLinearGradient(0, devT, 0, devB);
      depth.addColorStop(0, "rgba(255,255,255,.16)");
      depth.addColorStop(0.35, "rgba(255,255,255,.04)");
      depth.addColorStop(1, "rgba(255,255,255,0)");
      lp.fillStyle = depth;
      lp.fillRect(devL, devT, devR - devL, devH);
      // (no white streak: the shine across the phone is gone)
      lp.globalCompositeOperation = "destination-in";
      lp.drawImage(solid.mask, 0, 0, w, h);
      pen.save();
      pen.globalCompositeOperation = "screen";
      pen.drawImage(L, 0, 0);
      pen.restore();
      // 3. A deeper green towards the bottom, so it reads as thick glass rather than paint.
      lp.globalCompositeOperation = "source-over";
      lp.clearRect(0, 0, w, h);
      const deep = lp.createLinearGradient(0, devT + devH * 0.5, 0, devB);
      deep.addColorStop(0, "rgba(0,40,0,0)");
      deep.addColorStop(1, "rgba(0,40,0,.28)");
      lp.fillStyle = deep;
      lp.fillRect(devL, devT + devH * 0.5, devR - devL, devH * 0.5 + 2);
      lp.globalCompositeOperation = "destination-in";
      lp.drawImage(solid.mask, 0, 0, w, h);
      pen.save();
      pen.globalCompositeOperation = "multiply";
      pen.drawImage(L, 0, 0);
      pen.restore();
    };
    if (img.complete) paint();
    else img.addEventListener("load", paint, { once: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, box.w, box.h, spin, ready]);

  const facing = ((angle % 360) + 360) % 360;
  return (
    <div ref={stage} className="spin-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="spin-zoom" style={{ width: box.w, height: box.h, transform: `scale(${zoom})` }}>
        <canvas ref={canvas} className={`spin-pic${ready ? " is-ready" : ""}`} style={{ width: box.w, height: box.h }} aria-label="The porch guy's device. Drag to turn it round." role="img" />
        {/* Always mounted, so a video keeps playing while the device turns (only hidden when it faces away). */}
        {quad ? (
          <div
            className={`spin-face${live ? " is-live" : ""}`}
            style={{
              width: FW,
              height: FH,
              transform: show ? fit(quad) : "none",
              opacity: show ? Math.min(1, (facingArea / fullArea - 0.08) * 3) : 0,
              visibility: show ? "visible" : "hidden",
            }}
          >
            <div className="pod-screen">
              {screen}
              <span className="pod-glass" />
            </div>
            <Wheel centreLabel={centreLabel} onKey={onKey} onSpin={onSpin} />
          </div>
        ) : null}
      </div>
      {zoom > 1.05 ? (
        <button type="button" className="pod-unzoom" onClick={() => setZoom(1)} aria-label="Zoom back out">
          − Zoom out
        </button>
      ) : null}
      <button type="button" className="pod-turn spin-turn" onClick={() => settleTo(angleRef.current + 360)} aria-label="Turn the device round">
        ↻ {facing > 90 && facing < 270 ? "Turn back" : lite ? "Lite: drag to see the back" : "Drag to turn · pinch or double-tap to zoom"}
      </button>
    </div>
  );
}
