import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { amIFounder } from "@/lib/porch/password-reset";
import { useTourMode } from "@/lib/porch/tour-mode";

/**
 * The founder's peep hole (Porchbook app, Android 11+): the page itself looks torn open. The torn
 * flaps fold back and show the back of the page (the page's picture, mirrored and dimmer); through the
 * hole you see the phone's home screen behind Porchbook. Tapping it opens WhatsApp.
 * ✕ hides it; "Peep" brings it back.
 */

type PeepApp = {
  canPeep?: () => boolean;
  peep?: (on: boolean) => void;
  openWhatsApp?: () => boolean;
  /** App 1.3.0+: the phone's apps, their icons, and opening one. */
  listApps?: () => string;
  appIcon?: (pkg: string) => string;
  openPackage?: (pkg: string) => boolean;
};
type Pick = { pkg: string; label: string };
const PICKS = "porch-peep-apps";
const readPicks = (): Pick[] => {
  try {
    const list = JSON.parse(localStorage.getItem(PICKS) || "[]") as Pick[];
    return Array.isArray(list) ? list.slice(0, 4) : [];
  } catch {
    return [];
  }
};
/** Where the chosen icons sit in the tear (px inside its box): two by two round the middle of the opening. */
const TILE = 34;
const GAP = 10;
function tiles(count: number, boxW: number, boxH: number) {
  const cx = (62 / 120) * boxW;
  const cy = (52 / 100) * boxH;
  const cols = count <= 2 ? count : 2;
  const rows = count <= 2 ? 1 : 2;
  const w = cols * TILE + (cols - 1) * GAP;
  const h = rows * TILE + (rows - 1) * GAP;
  return Array.from({ length: count }, (_, i) => ({
    x: cx - w / 2 + (i % cols) * (TILE + GAP),
    y: cy - h / 2 + Math.floor(i / cols) * (TILE + GAP),
  }));
}
/** The icons are part of the page, so the page's cut must leave them showing: a mask of their tiles. */
function tilesMask(spots: { x: number; y: number }[], boxW: number, boxH: number) {
  const kx = 120 / boxW;
  const ky = 100 / boxH;
  const pad = 0; // exactly the icon: the home screen shows right up to its edge
  const rects = spots
    .map(
      (t) =>
        `<rect x="${((t.x - pad) * kx).toFixed(2)}" y="${((t.y - pad) * ky).toFixed(2)}" width="${((TILE + pad * 2) * kx).toFixed(2)}" height="${((TILE + pad * 2) * ky).toFixed(2)}" rx="${(9 * kx).toFixed(2)}"/>`,
    )
    .join("");
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" preserveAspectRatio="none">${rects}</svg>`)}")`;
}
const app = () =>
  typeof window === "undefined"
    ? null
    : ((window as unknown as { PorchApp?: PeepApp }).PorchApp ?? null);

// ---- The tear, drawn in a 120 × 100 frame. Torn edges are jagged: each straight run is broken
// into small uneven steps (the same every time).
type P = [number, number];
let seed = 7;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
function jag(points: P[], close: boolean, size = 1.1, step = 2.2): P[] {
  const out: P[] = [];
  const n = close ? points.length : points.length - 1;
  for (let i = 0; i < n; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const parts = Math.max(1, Math.round(len / step));
    const nx = -(y2 - y1) / (len || 1);
    const ny = (x2 - x1) / (len || 1);
    for (let k = 0; k < parts; k += 1) {
      const t = k / parts;
      const off = k === 0 ? 0 : (rnd() - 0.5) * 2 * size;
      out.push([x1 + (x2 - x1) * t + nx * off, y1 + (y2 - y1) * t + ny * off]);
    }
  }
  if (!close) out.push(points[points.length - 1]);
  return out;
}
const d = (pts: P[], close = true) =>
  pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ") +
  (close ? " Z" : "");

// The hole: the shape of the tear in the reference (an uneven five-sided opening).
const HOLE_PTS: P[] = [
  [50, 19],
  [66, 22],
  [84, 27],
  [96, 31],
  [97, 52],
  [99, 74],
  [84, 78],
  [66, 81],
  [55, 82],
  [40, 70],
  [22, 52],
  [34, 38],
  [44, 26],
];
const HOLE = d(jag(HOLE_PTS, true, 0.9, 1.8));
// The flaps: each folds back along part of the hole's edge (fold line A→B) and ends in a torn edge.
const FLAPS: { fold: [P, P]; tip: P[] }[] = [
  {
    fold: [
      [34, 38],
      [50, 19],
    ],
    tip: [
      [44, 12],
      [33, 17],
      [26, 30],
    ],
  }, // upper left, the big curl
  {
    fold: [
      [50, 19],
      [66, 22],
    ],
    tip: [
      [60, 14],
      [53, 15],
    ],
  }, // a small one on top
  {
    fold: [
      [84, 27],
      [97, 52],
    ],
    tip: [
      [95, 22],
      [105, 32],
      [107, 46],
    ],
  }, // right
  {
    fold: [
      [99, 74],
      [55, 82],
    ],
    tip: [
      [63, 92],
      [80, 95],
      [96, 87],
    ],
  }, // bottom
  {
    fold: [
      [40, 70],
      [22, 52],
    ],
    tip: [
      [15, 58],
      [21, 69],
      [33, 79],
    ],
  }, // lower left
];
const FLAP_PATHS = FLAPS.map(({ fold: [a, b], tip: given }) => {
  // Bigger flaps read as real paper: push the torn tips further out from the fold.
  const mid: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const tip = given.map(
    ([x, y]) =>
      [
        Math.min(118, Math.max(2, mid[0] + (x - mid[0]) * 1.55)),
        Math.min(98, Math.max(2, mid[1] + (y - mid[1]) * 1.55)),
      ] as P,
  );
  const outer = jag([b, ...tip, a], false, 1.3, 2);
  const far = tip[Math.floor(tip.length / 2)];
  const vx = far[0] - 62,
    vy = far[1] - 52;
  const vl = Math.hypot(vx, vy) || 1;
  return {
    shape: d([a, ...outer.slice(0, -1)]),
    edge: d(outer, false),
    a,
    b,
    tip: far,
    lift: [(vx / vl) * 2.2 + 0.6, (vy / vl) * 2.2 + 1.2] as P,
  };
});
const MASK = `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" preserveAspectRatio="none"><path d="${HOLE}"/></svg>`)}")`;
const OFF = "porch-peep-off";

/** The page's own picture (the Tour ground), as a link, to show on the back of the flaps. */
function groundUrl() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--porch-ground").trim();
  const m = /^url\((["']?)(.*)\1\)$/.exec(raw);
  return m ? m[2] : "/porch-frames.jpg?v=1";
}

export function PeepHole() {
  const [founder, setFounder] = useState(false);
  const [able, setAble] = useState(false);
  const [off, setOff] = useState(() => {
    try {
      return localStorage.getItem(OFF) === "1";
    } catch {
      return false;
    }
  });
  const spot = useRef<HTMLButtonElement>(null);
  const [picks, setPicks] = useState<Pick[]>(readPicks);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [choosing, setChoosing] = useState(false);
  const canPick = typeof app()?.listApps === "function";
  // Where the page's picture lies under the tear (so the flaps' backs line up with the page).
  const [back, setBack] = useState<{
    href: string;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  useEffect(() => {
    let can = false;
    try {
      can = Boolean(app()?.canPeep?.());
    } catch {
      can = false;
    }
    setAble(can);
    if (!can) return; // only in the app
    let alive = true;
    amIFounder()
      .then((result) => alive && setFounder(Boolean(result.founder)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Only on the plain Tour screen: when Radio or any other part is open, the page stays whole.
  const tourPart = useTourMode();
  const on = founder && able && !off && !tourPart;
  const picksRef = useRef(picks);
  picksRef.current = picks;

  // Each chosen app's own icon, from the phone.
  useEffect(() => {
    if (!on) return;
    const next: Record<string, string> = {};
    for (const p of picks) {
      try {
        next[p.pkg] = icons[p.pkg] || app()?.appIcon?.(p.pkg) || "";
      } catch {
        next[p.pkg] = "";
      }
    }
    setIcons(next);
    window.dispatchEvent(new Event("resize")); // re-cut the page round the new icons
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, picks]);

  // The window goes see-through only while the hole shows (not while choosing apps); the hole follows its spot.
  const cutting = on && !choosing;
  useEffect(() => {
    if (!cutting) return;
    const root = document.documentElement;
    let frame = 0;
    let picture: HTMLImageElement | null = null;
    const href = groundUrl();
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = spot.current?.getBoundingClientRect();
        if (!box) return;
        root.style.setProperty("--peep-x", `${box.left}px`);
        root.style.setProperty("--peep-y", `${box.top}px`);
        root.style.setProperty("--peep-w", `${box.width}px`);
        root.style.setProperty("--peep-h", `${box.height}px`);
        root.style.setProperty(
          "--peep-icons",
          picksRef.current.length
            ? tilesMask(
                tiles(picksRef.current.length, box.width, box.height),
                box.width,
                box.height,
              )
            : "linear-gradient(transparent,transparent)",
        );
        // The ground covers the screen from the top: map it into the tear's 120 × 100 frame.
        if (picture?.naturalWidth) {
          const W = window.innerWidth;
          const H = window.innerHeight;
          const s = Math.max(W / picture.naturalWidth, H / picture.naturalHeight);
          const dw = picture.naturalWidth * s;
          const dh = picture.naturalHeight * s;
          const kx = 120 / box.width;
          const ky = 100 / box.height;
          setBack({
            href,
            x: ((W - dw) / 2 - box.left) * kx,
            y: -box.top * ky,
            w: dw * kx,
            h: dh * ky,
          });
        }
      });
    };
    picture = new Image();
    picture.onload = place;
    picture.src = href;
    root.style.setProperty("--peep-mask", MASK);
    root.classList.add("peeping");
    place();
    app()?.peep?.(true);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    const timer = window.setInterval(place, 1000);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      root.classList.remove("peeping");
      app()?.peep?.(false);
    };
  }, [cutting]);

  if (!founder || !able || tourPart) return null;
  const keep = (value: boolean) => {
    setOff(value);
    try {
      localStorage.setItem(OFF, value ? "1" : "0");
    } catch {
      /* this phone only */
    }
  };
  if (off) {
    return (
      <div className="peep-anchor">
        <button type="button" className="peep-back" onClick={() => keep(false)}>
          Peep
        </button>
      </div>
    );
  }
  return (
    <div className="peep-anchor">
      <button
        ref={spot}
        type="button"
        className="peep-hole"
        aria-label={canPick ? "Choose the apps in the peep hole" : "Open WhatsApp"}
        onClick={() => (canPick ? setChoosing(true) : app()?.openWhatsApp?.())}
      >
        <svg viewBox="0 0 120 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            {/* The back of the page: its own picture, mirrored, a little dimmer and greyer. */}
            <pattern
              id="peep-back"
              patternUnits="userSpaceOnUse"
              x="0"
              y="0"
              width="120"
              height="100"
            >
              <rect width="120" height="100" fill="#2a2620" />
              {back ? (
                <g transform="translate(120 0) scale(-1 1)">
                  <image
                    href={back.href}
                    x={120 - back.x - back.w}
                    y={back.y}
                    width={back.w}
                    height={back.h}
                    preserveAspectRatio="none"
                    filter="url(#peep-greyer)"
                  />
                </g>
              ) : null}
            </pattern>
            <filter id="peep-greyer">
              <feColorMatrix type="saturate" values="0.55" />
              <feComponentTransfer>
                <feFuncR type="linear" slope="0.72" />
                <feFuncG type="linear" slope="0.72" />
                <feFuncB type="linear" slope="0.72" />
              </feComponentTransfer>
            </filter>
            {/* Paper fibres: a torn edge is never smooth. */}
            <filter id="peep-fibre" x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" seed="3" />
              <feDisplacementMap in="SourceGraphic" scale="1.1" />
            </filter>
            <filter id="peep-lift" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow
                dx="0.8"
                dy="1.6"
                stdDeviation="1.4"
                floodColor="#000"
                floodOpacity="0.65"
              />
            </filter>
            {FLAP_PATHS.map((f, i) => (
              <filter key={i} id={`peep-lift-${i}`} x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow
                  dx={f.lift[0]}
                  dy={f.lift[1]}
                  stdDeviation="1.8"
                  floodColor="#000"
                  floodOpacity="0.7"
                />
              </filter>
            ))}
            <filter id="peep-soft">
              <feGaussianBlur stdDeviation="1.6" />
            </filter>
            <clipPath id="peep-in">
              <path d={HOLE} />
            </clipPath>
            {FLAP_PATHS.map((f, i) => (
              // Light along the fold, deeper shade towards the torn tip: the flap curls.
              <linearGradient
                key={i}
                id={`peep-curl-${i}`}
                gradientUnits="userSpaceOnUse"
                x1={(f.a[0] + f.b[0]) / 2}
                y1={(f.a[1] + f.b[1]) / 2}
                x2={f.tip[0]}
                y2={f.tip[1]}
              >
                <stop offset="0" stopColor="#000" stopOpacity="0.55" />
                <stop offset="0.07" stopColor="#000" stopOpacity="0.15" />
                <stop offset="0.16" stopColor="#fff" stopOpacity="0.38" />
                <stop offset="0.32" stopColor="#fff" stopOpacity="0.1" />
                <stop offset="0.62" stopColor="#000" stopOpacity="0.08" />
                <stop offset="1" stopColor="#000" stopOpacity="0.55" />
              </linearGradient>
            ))}
          </defs>
          {/* The page's thickness casts a soft shadow just inside the hole. */}
          <g clipPath="url(#peep-in)">
            <path
              d={HOLE}
              fill="none"
              stroke="#000"
              strokeOpacity="0.55"
              strokeWidth="6"
              filter="url(#peep-soft)"
            />
            <path
              d={HOLE}
              fill="none"
              stroke="#000"
              strokeOpacity="0.75"
              strokeWidth="5"
              filter="url(#peep-soft)"
              transform="translate(1.6 2.2)"
            />
          </g>
          {/* The flaps, folded back, showing the back of the page. */}
          {FLAP_PATHS.map((f, i) => (
            <g key={i} filter={`url(#peep-lift-${i})`}>
              {/* The paper's thickness, just showing under the lifted flap. */}
              <path d={f.shape} fill="#14110d" transform="translate(0.5 0.7)" />
              <path d={f.shape} fill="url(#peep-back)" />
              <path d={f.shape} fill={`url(#peep-curl-${i})`} />
              {/* The torn tip: rough, and only a touch darker than the paper (no white rim). */}
              <path
                d={f.edge}
                fill="none"
                stroke="#000"
                strokeOpacity="0.28"
                strokeWidth="0.5"
                filter="url(#peep-fibre)"
              />
            </g>
          ))}
        </svg>
      </button>
      {canPick
        ? tiles(picks.length, 176, 146).map((t, i) => {
            const p = picks[i];
            return (
              <button
                key={p.pkg}
                type="button"
                className="peep-app"
                style={{
                  left: `calc(100% - 6% - 176px + ${t.x}px)`,
                  top: `${10 + t.y}px`,
                  width: TILE,
                  height: TILE,
                }}
                aria-label={`Open ${p.label}`}
                onClick={() => app()?.openPackage?.(p.pkg)}
              >
                {icons[p.pkg] ? (
                  <img src={icons[p.pkg]} alt="" draggable={false} />
                ) : (
                  <span>{p.label.slice(0, 1)}</span>
                )}
              </button>
            );
          })
        : null}
      {canPick ? (
        <button
          type="button"
          className="peep-close peep-edit"
          aria-label="Choose the apps in the peep hole"
          onClick={() => setChoosing(true)}
        >
          ✎
        </button>
      ) : null}
      <button
        type="button"
        className="peep-close"
        aria-label="Hide the peep hole"
        onClick={() => keep(true)}
      >
        ✕
      </button>
      {choosing
        ? createPortal(
            <AppPicker
              picked={picks}
              onDone={(next) => {
                setPicks(next);
                try {
                  localStorage.setItem(PICKS, JSON.stringify(next));
                } catch {
                  /* this phone only */
                }
                setChoosing(false);
              }}
              onClose={() => setChoosing(false)}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

/** Choose up to 4 apps for the peep hole: tap to add or take out; the numbers are their order. */
function AppPicker({
  picked,
  onDone,
  onClose,
}: {
  picked: Pick[];
  onDone: (next: Pick[]) => void;
  onClose: () => void;
}) {
  const [apps, setApps] = useState<Pick[] | null>(null);
  const [chosen, setChosen] = useState<Pick[]>(picked);
  const [icons, setIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    // Let the sheet show first, then ask the phone (it can take a moment).
    const timer = window.setTimeout(() => {
      let list: Pick[] = [];
      try {
        list = JSON.parse(app()?.listApps?.() || "[]") as Pick[];
      } catch {
        list = [];
      }
      setApps(list);
      // Icons a few at a time, so the list stays smooth.
      let i = 0;
      const step = () => {
        const batch: Record<string, string> = {};
        for (const p of list.slice(i, i + 12)) {
          try {
            batch[p.pkg] = app()?.appIcon?.(p.pkg) || "";
          } catch {
            batch[p.pkg] = "";
          }
        }
        setIcons((now) => ({ ...now, ...batch }));
        i += 12;
        if (i < list.length) window.setTimeout(step, 30);
      };
      step();
    }, 60);
    return () => window.clearTimeout(timer);
  }, []);
  const toggle = (p: Pick) =>
    setChosen((now) =>
      now.some((x) => x.pkg === p.pkg)
        ? now.filter((x) => x.pkg !== p.pkg)
        : now.length >= 4
          ? now
          : [...now, p],
    );
  return (
    <div className="peep-pick" role="dialog" aria-label="Choose up to 4 apps">
      <div className="peep-pick-head">
        <b>CHOOSE UP TO 4 APPS</b>
        <button type="button" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="peep-pick-list">
        {apps === null ? <p className="peep-pick-wait">Finding your apps…</p> : null}
        {apps?.map((p) => {
          const n = chosen.findIndex((x) => x.pkg === p.pkg);
          return (
            <button key={p.pkg} type="button" className="peep-pick-row" onClick={() => toggle(p)}>
              {icons[p.pkg] ? <img src={icons[p.pkg]} alt="" /> : <i />}
              <span>{p.label}</span>
              <em className={n >= 0 ? "is-on" : ""}>{n >= 0 ? n + 1 : ""}</em>
            </button>
          );
        })}
      </div>
      <button type="button" className="peep-pick-done" onClick={() => onDone(chosen)}>
        Done
      </button>
    </div>
  );
}
