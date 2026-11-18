import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { isLite } from "@/lib/porch/lite";
import { BOOKS, bookByNumber } from "@/lib/porch/bible-engine";

/** The stone: 72 pictures taken round it; each carved panel's corners are known on every picture. */
type Corners = [number, number][];
type Zoom = { x: number; y: number; z: number };
type Faces = { w: number; h: number; frames: number; faces: Record<FaceName, Corners[]>; zoom: Record<FaceName, Zoom> };
type FaceName = "front" | "right" | "back" | "left";
const ORDER: FaceName[] = ["front", "right", "back", "left"];
const V = "?v=2";
/** Each panel is laid out at this size, then fitted onto the picture. */
const PW = 280;
const PH = 400;
const REST: Record<FaceName, number> = { front: 0, right: 18, back: 36, left: 54 };

/** CSS matrix3d that maps a w×h rectangle onto four points (top-left, top-right, bottom-right, bottom-left). */
function fit(q: Corners, W: number, H: number) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  const m = [a / W, d / W, 0, g / W, b / H, e / H, 0, h / H, 0, 0, 1, 0, c, f, 0, 1];
  return `matrix3d(${m.map((n) => n.toFixed(6)).join(",")})`;
}
const area = (q: Corners) => q.reduce((sum, [x, y], i) => sum + x * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * y, 0) / 2;
const shortName = (name: string, abbreviation: string) => (name.length <= 7 ? name : abbreviation.replace(/^(\d)(\D)/, "$1 $2"));

export type StoneProps = {
  book: number;
  chapter: number;
  verse: number;
  chapters: number;
  verses: number;
  night: boolean;
  readToday: number;
  onBook: (book: number) => void;
  onChapter: (chapter: number) => void;
  onVerse: (verse: number) => void;
  onSearch: () => void;
  onNight: () => void;
  onDictionary: () => void;
  onShift: (step: number) => void;
  onClose: () => void;
};

export function BibleStone(props: StoneProps) {
  const { book, chapter, verse, chapters, verses, night, readToday } = props;
  const lite = isLite();
  const [data, setData] = useState<Faces | null>(null);
  const pictures = useRef<HTMLImageElement[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetch(`/bible/stone/faces.json${V}`)
      .then((res) => res.json() as Promise<Faces>)
      .then((faces) => {
        if (!alive) return;
        setData(faces);
        const n = faces.frames;
        // The four faces first (so a quick turn always lands), then the rest.
        const facesFirst = [0, n / 4, n / 2, (n * 3) / 4];
        const order = lite ? facesFirst : [...facesFirst, ...Array.from({ length: n }, (_, i) => i).filter((i) => !facesFirst.includes(i))];
        order.forEach((i, k) => {
          const img = new Image();
          img.decoding = "async";
          img.src = `/bible/stone/${String(i).padStart(2, "0")}.webp${V}`;
          if (k === 0) img.addEventListener("load", () => alive && setReady(true), { once: true });
          pictures.current[i] = img;
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [lite]);

  // Size: the picture fitted to the space.
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 320, h: 480 });
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const measure = () => {
      const r = node.getBoundingClientRect();
      // A little wider than the space: the stone itself fills only the middle of each picture.
      const w = Math.max(220, Math.min(r.width * 1.08, (r.height - 8) / 1.5));
      setBox({ w: Math.round(w), h: Math.round(w * 1.5) });
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(node);
    return () => watch.disconnect();
  }, []);

  // Turning: an angle in degrees; 0 = BOOKS, -90 = CHAPTER, -180 = VERSE, -270 = TOOLS.
  const [angle, setAngle] = useState(38);
  const angleRef = useRef(38);
  angleRef.current = angle;
  const ease = useRef(0);
  // Close up: once the stone rests on a face, the view moves in on its panel.
  const [zoomed, setZoomed] = useState(false);
  const settleTo = (target: number, ms = 700) => {
    cancelAnimationFrame(ease.current);
    setZoomed(false);
    const from = angleRef.current;
    const start = performance.now();
    const run = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const s = 1 - Math.pow(1 - k, 3);
      setAngle(from + (target - from) * s);
      if (k < 1) ease.current = requestAnimationFrame(run);
      else if (Math.abs(target / 90 - Math.round(target / 90)) < 0.01) setZoomed(true);
    };
    ease.current = requestAnimationFrame(run);
  };
  /** Turn the shortest way round to a face (0 BOOKS, 1 CHAPTER, 2 VERSE, 3 TOOLS). */
  const turnTo = (face: number, ms?: number) => {
    const base = -face * 90;
    const now = angleRef.current;
    const target = base + Math.round((now - base) / 360) * 360;
    settleTo(target, ms);
  };
  useEffect(() => {
    // It arrives turning, and comes to rest on BOOKS.
    if (ready) turnTo(0, 900);
    return () => cancelAnimationFrame(ease.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Drag sideways to turn; a tap (no sideways drag) presses what's under the finger.
  const drag = useRef<{ x: number; y: number; from: number; on: boolean; id: number } | null>(null);
  const swallowClick = useRef(false);
  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current) return;
    cancelAnimationFrame(ease.current);
    drag.current = { x: event.clientX, y: event.clientY, from: angleRef.current, on: false, id: event.pointerId };
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.on) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
      d.on = true;
      setPressed(null);
      setZoomed(false);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* fine */
      }
    }
    setAngle(d.from + dx * 0.55);
  }
  function up(event: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    if (d.on) {
      swallowClick.current = true;
      window.setTimeout(() => (swallowClick.current = false), 0);
      turnTo(((Math.round(-angleRef.current / 90) % 4) + 4) % 4);
    } else if (Math.abs(angleRef.current - Math.round(angleRef.current / 90) * 90) > 1) {
      turnTo(((Math.round(-angleRef.current / 90) % 4) + 4) % 4);
    }
  }

  // Pressing: the key sinks into the stone while held.
  const [pressed, setPressed] = useState<string | null>(null);
  const press = (key: string) => ({
    onPointerDown: () => setPressed(key),
    onPointerUp: () => setPressed(null),
    onPointerLeave: () => setPressed((p) => (p === key ? null : p)),
  });
  const keyClass = (key: string, on: boolean) => `stone-key${on ? " is-on" : ""}${pressed === key ? " is-pressed" : ""}`;
  /** After a press is seen sinking, act. */
  const act = (fn: () => void) => () => window.setTimeout(fn, 140);

  const [testament, setTestament] = useState<"old" | "new">(bookByNumber(book).testament === "new" ? "new" : "old");

  const panels: Record<FaceName, ReactNode> = {
    front: (
      <>
        <p className="stone-title">BOOKS</p>
        <div className="stone-tabs">
          {(["old", "new"] as const).map((t) => (
            <button key={t} type="button" className={keyClass(`t-${t}`, testament === t)} {...press(`t-${t}`)} onClick={() => setTestament(t)}>
              {t === "old" ? "OLD" : "NEW"}
            </button>
          ))}
        </div>
        <div className="stone-scroll stone-books">
          {BOOKS.filter((item) => item.testament === testament).map((item) => (
            <button
              key={item.number}
              type="button"
              aria-label={item.name}
              className={keyClass(`b-${item.number}`, item.number === book)}
              {...press(`b-${item.number}`)}
              onClick={act(() => {
                props.onBook(item.number);
                turnTo(1);
              })}
            >
              {shortName(item.name, item.abbreviation)}
            </button>
          ))}
        </div>
      </>
    ),
    right: (
      <>
        <p className="stone-title">CHAPTER</p>
        <p className="stone-sub">{bookByNumber(book).name}</p>
        <div className="stone-scroll stone-nums">
          {Array.from({ length: chapters }, (_, n) => n + 1).map((n) => (
            <button
              key={n}
              type="button"
              className={keyClass(`c-${n}`, n === chapter)}
              {...press(`c-${n}`)}
              onClick={act(() => {
                props.onChapter(n);
                turnTo(2);
              })}
            >
              {n}
            </button>
          ))}
        </div>
      </>
    ),
    back: (
      <>
        <p className="stone-title">VERSE</p>
        <p className="stone-sub">
          {shortName(bookByNumber(book).name, bookByNumber(book).abbreviation)} {chapter}
        </p>
        <div className="stone-scroll stone-nums">
          {verses === 0 ? <span className="stone-wait">…</span> : null}
          {Array.from({ length: verses }, (_, n) => n + 1).map((n) => (
            <button key={n} type="button" className={keyClass(`v-${n}`, n === verse)} {...press(`v-${n}`)} onClick={act(() => props.onVerse(n))}>
              {n}
            </button>
          ))}
        </div>
      </>
    ),
    left: (
      <>
        <p className="stone-title">TOOLS</p>
        <div className="stone-tools">
          <button type="button" className={keyClass("search", false)} {...press("search")} onClick={act(props.onSearch)}>
            SEARCH
          </button>
          <button type="button" className={keyClass("night", false)} {...press("night")} onClick={act(props.onNight)}>
            {night ? "PAPER" : "NIGHT"}
          </button>
          <button type="button" className={keyClass("dict", false)} {...press("dict")} onClick={act(props.onDictionary)}>
            DICTIONARY
          </button>
          <span className="stone-pair">
            <button type="button" aria-label="Previous chapter" className={keyClass("prev", false)} {...press("prev")} onClick={act(() => props.onShift(-1))}>
              ‹ CH
            </button>
            <button type="button" aria-label="Next chapter" className={keyClass("next", false)} {...press("next")} onClick={act(() => props.onShift(1))}>
              CH ›
            </button>
          </span>
          <p className="stone-today">
            READ TODAY
            <b>{String(readToday).padStart(4, "0")}</b>
          </p>
        </div>
      </>
    ),
  };

  // Which picture is showing.
  const frames = data?.frames ?? 72;
  let index = ((Math.round(-angle / (360 / frames)) % frames) + frames) % frames;
  if (lite) index = (Math.round(index / (frames / 4)) * (frames / 4)) % frames;
  const scale = data ? box.w / data.w : 1;

  // Draw it.
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = canvas.current;
    if (!node || !data) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.round(box.w * dpr);
    const h = Math.round(box.h * dpr);
    if (node.width !== w || node.height !== h) {
      node.width = w;
      node.height = h;
    }
    const pen = node.getContext("2d");
    // Not loaded yet: the nearest loaded face stands in.
    let img = pictures.current[index];
    if (!(img?.complete && img.naturalWidth)) {
      const q = frames / 4;
      img = pictures.current[(Math.round(index / q) * q) % frames];
    }
    if (!pen || !img) return;
    const paint = () => {
      pen.clearRect(0, 0, w, h);
      if (img.complete && img.naturalWidth) pen.drawImage(img, 0, 0, w, h);
    };
    if (img.complete) paint();
    else img.addEventListener("load", paint, { once: true });
  }, [index, box.w, box.h, data, ready, frames]);

  const faceName = ORDER[((Math.round(-angle / 90) % 4) + 4) % 4];
  const closeUp =
    data && zoomed
      ? (() => {
          const z = data.zoom[faceName];
          return { name: faceName, transform: `scale(${z.z}) translate(${-z.x * scale}px, ${-z.y * scale}px)` };
        })()
      : null;
  return (
    <div className={`stone-wrap${night ? " is-night" : ""}`} role="dialog" aria-label="The Bible stone: turn it, then tap a book, chapter and verse">
      <div className="stone-head">
        <span>{faceName === "front" ? "Choose a book" : faceName === "right" ? "Choose a chapter" : faceName === "back" ? "Choose a verse" : "Tools"}</span>
        <button type="button" className="stone-close" onClick={props.onClose} aria-label="Close the stone">
          ✕
        </button>
      </div>
      <div
        ref={stage}
        className="stone-stage"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClickCapture={(event) => {
          if (swallowClick.current) {
            event.stopPropagation();
            event.preventDefault();
          }
        }}
      >
        <div className="stone-box" style={{ width: box.w, height: box.h, transform: closeUp ? closeUp.transform : "none" }}>
          <canvas ref={canvas} className={`stone-pic${ready ? " is-ready" : ""}`} style={{ width: box.w, height: box.h }} aria-hidden="true" />
          {data
            ? ORDER.map((name) => {
                const z = data.zoom[name];
                return (
                  <img
                    key={name}
                    src={`/bible/stone/zoom-${name}.webp${V}`}
                    alt=""
                    aria-hidden="true"
                    className={`stone-close-pic${closeUp?.name === name ? " is-on" : ""}`}
                    style={{ left: z.x * scale, top: z.y * scale, width: (data.w / z.z) * scale, height: (data.h / z.z) * scale }}
                  />
                );
              })
            : null}
          {data
            ? ORDER.map((name) => {
                const W = PW;
                const H = PH;
                const q = data.faces[name][index].map(([x, y]) => [x * scale, y * scale]) as Corners;
                const fullArea = area(data.faces[name][REST[name]].map(([x, y]) => [x * scale, y * scale]) as Corners);
                const seen = area(q) / fullArea;
                const show = seen > 0.12;
                const live = seen > 0.8 && name === faceName;
                return (
                  <div
                    key={name}
                    className={`stone-face is-${name}${live ? " is-live" : ""}`}
                    aria-hidden={!live}
                    style={{
                      width: W,
                      height: H,
                      transform: show ? fit(q, W, H) : "none",
                      opacity: show ? Math.min(1, (seen - 0.12) * 2.2) : 0,
                      visibility: show ? "visible" : "hidden",
                    }}
                  >
                    {panels[name]}
                  </div>
                );
              })
            : null}
        </div>
      </div>
      <div className="stone-dots" aria-hidden="true">
        {ORDER.map((name, i) => (
          <button key={name} type="button" tabIndex={-1} className={name === faceName ? "is-on" : ""} onClick={() => turnTo(i)}>
            {["BOOKS", "CHAPTER", "VERSE", "TOOLS"][i]}
          </button>
        ))}
      </div>
    </div>
  );
}
