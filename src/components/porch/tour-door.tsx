// Stage 4b: the Tour doors in the new design (design-reference/Tour.dc.html): a card with an
// icon, the door's name and one line about it. What each door does has not changed.
import type { ReactNode } from "react";
import { useTourMode } from "@/lib/porch/tour-mode";

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ICONS: Record<string, ReactNode> = {
  pray: (
    <>
      <path d="M12 3c2 2 2 4 0 5-2-1-2-3 0-5z" />
      <path d="M9 10h6v11H9z" />
    </>
  ),
  twenty: <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />,
  events: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  groups: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 14a5 5 0 0 1 5 6" />
    </>
  ),
  serve: <path d="M7 11V5a1.5 1.5 0 0 1 3 0v5M10 10V4a1.5 1.5 0 0 1 3 0v6M13 10V5a1.5 1.5 0 0 1 3 0v7M16 12a1.5 1.5 0 0 1 3 0v1a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-2-4a1.5 1.5 0 0 1 2.5-1.5L7 13" />,
  transport: (
    <>
      <rect x="4" y="4" width="16" height="13" rx="2" />
      <path d="M4 11h16" />
      <circle cx="8" cy="19" r="1.5" />
      <circle cx="16" cy="19" r="1.5" />
    </>
  ),
  feedback: <path d="M4 4h16v12H8l-4 4z" />,
  offices: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4" />
    </>
  ),
  clinic: <path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z" />,
  call: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />,
  radio: (
    <>
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M7 8l10-5M8 14h.01M14 12h4M14 16h4" />
    </>
  ),
};

const TONES: Record<string, string> = {
  pray: "var(--pb-main)",
  twenty: "var(--pb-second)",
  events: "#E8C25A",
  groups: "var(--pb-second)",
  serve: "var(--pb-main)",
  transport: "#E8C25A",
  feedback: "#C9A27A",
};

/** The inside of one Tour door. */
export function DoorFace({ icon, name, hint }: { icon: string; name: ReactNode; hint: ReactNode }) {
  const tone = TONES[icon] ?? "var(--pb-second)";
  return (
    <>
      <span className="pb-door-tile" style={{ color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)` }}>
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
          {ICONS[icon] ?? ICONS.offices}
        </svg>
      </span>
      <span className="pb-door-words">
        <span className="pb-door-name">{name}</span>
        <span className="pb-door-hint">{hint}</span>
      </span>
    </>
  );
}

/** "Tour · Everything your church offers, in one place." (hidden while a door is open). */
export function TourTitle() {
  const mode = useTourMode();
  if (mode) return null;
  return (
    <div className="pb pb-tour-title">
      <h1 className="pb-ttl" style={{ fontSize: 28 }}>Tour</h1>
      <p className="pb-quiet" style={{ margin: "4px 0 0", fontSize: 15 }}>
        Everything your church offers, in one place.
      </p>
    </div>
  );
}
