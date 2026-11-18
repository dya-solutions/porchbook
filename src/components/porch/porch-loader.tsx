import { useEffect, useRef, useState } from "react";

/**
 * Porchbook's loader: a ring that counts up, Porchbook green turning Porchbook orange,
 * with twinkling dots that take the ring's colour as it fills.
 * Give `progress` (0–100) when the real amount is known; otherwise it counts on its own:
 * steadily at first, slowing near 90%, never claiming 100% until the thing is ready.
 */
const GREEN = [125, 255, 42];
const ORANGE = [248, 160, 24];
const DOTS = 36;

export const loaderColour = (share: number) => `rgb(${GREEN.map((g, i) => Math.round(g + (ORANGE[i] - g) * Math.min(1, Math.max(0, share)))).join(",")})`;

/** A count that creeps up while waiting: fast early, slower and slower towards 92%. */
export function useCreep(running = true) {
  const [pct, setPct] = useState(0);
  const start = useRef(0);
  useEffect(() => {
    if (!running) return;
    start.current = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const s = (t - start.current) / 1000;
      // Reaches ~60% in 2s, ~85% in 6s, and creeps under 92% after.
      setPct(Math.min(92, Math.round(92 * (1 - Math.exp(-s / 2.6)))));
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [running]);
  return pct;
}

export function PorchLoader({ label, progress, size = 168, className = "" }: { label?: string; progress?: number | null; size?: number; className?: string }) {
  const creep = useCreep(progress == null);
  const pct = Math.round(progress == null ? creep : Math.max(0, Math.min(100, progress)));
  const share = pct / 100;
  const colour = loaderColour(share);
  const r = 70;
  const circ = 2 * Math.PI * r;
  return (
    <div className={`porch-loader ${className}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label ?? "Loading"}>
      <svg width={size} height={size} viewBox="0 0 300 300" aria-hidden="true">
        {Array.from({ length: DOTS }, (_, i) => {
          const a = (i / DOTS) * 2 * Math.PI - Math.PI / 2;
          const lit = i / DOTS < share;
          return [
            [96, 3.2, 0.9],
            [112, 2, 0.55],
          ].map(([rr, sz, op], k) => (
            <circle
              key={`${i}-${k}`}
              className="porch-loader-dot"
              style={{ animationDelay: `${((i * 7 + k * 3) % 18) * 0.11}s`, ["--op" as string]: String(op) }}
              cx={150 + rr * Math.cos(a)}
              cy={150 + rr * Math.sin(a)}
              r={sz}
              fill={lit ? colour : "#fff"}
            />
          ));
        })}
        <circle cx="150" cy="150" r={r} fill="none" stroke="#3a3f39" strokeWidth="9" />
        <circle
          cx="150"
          cy="150"
          r={r}
          fill="none"
          stroke={colour}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${circ * share} ${circ}`}
          transform="rotate(-90 150 150)"
          style={{ filter: `drop-shadow(0 0 8px ${colour})`, transition: "stroke-dasharray .25s linear" }}
        />
        <text x="150" y="162" textAnchor="middle" className="porch-loader-num">
          {pct}%
        </text>
      </svg>
      {label ? <p className="porch-loader-label">{label}</p> : null}
    </div>
  );
}
