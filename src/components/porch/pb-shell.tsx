import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { myPorchLook, type PorchLook } from "@/lib/porch/porch-look";
import { THEME_CACHE_KEY, themeOf, themeVars, type ThemeId } from "@/lib/porch/themes";
import { brandVars, type AccentId, type LookMode } from "@/lib/porch/brand";
import { shown as featureOn } from "@/lib/porch/on-hold";
import { usePorch } from "@/lib/porch/presence-store";
import { LIGHT_LEVELS, currentBrightness, setBrightness } from "@/components/porch/bits";

/* ---------------- The porch's theme ---------------- */

const LOOK_KEY = "porch-look-v1";

function readCachedLook(): PorchLook | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LOOK_KEY);
    return raw ? (JSON.parse(raw) as PorchLook) : null;
  } catch {
    return null;
  }
}

/** Put colours on the page, and remember them for next time (so they show before anything loads). */
function putColours(vars: Record<string, string>, mode: LookMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  root.dataset.pbMode = mode;
  root.classList.add("pb-on");
  root.classList.toggle("pb-dark", mode === "dark");
  try {
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(vars));
    localStorage.setItem("porch-mode-v1", mode);
  } catch {
    /* this visit still has the colours */
  }
}

/**
 * Stage 4e: the Porchbook brand. Olive frame, the church's accent, and the member's own Light or
 * Dark. (The six church themes are kept but switched off: the churchThemes switch in on-hold.ts.)
 */
export function applyLook(look: { theme: ThemeId; accent?: AccentId; mode?: LookMode }) {
  if (featureOn("churchThemes")) {
    applyTheme(look.theme);
    return;
  }
  const mode = look.mode ?? "light";
  putColours(brandVars(mode, look.accent), mode);
}

/** The six church themes (Stage 4a, now switched off). */
export function applyTheme(id: ThemeId) {
  if (typeof document === "undefined") return;
  if (!featureOn("churchThemes")) return;
  const vars = themeVars(themeOf(id));
  const root = document.documentElement;
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  root.dataset.pbTheme = id;
  root.classList.add("pb-on");
  try {
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(vars));
  } catch {
    /* this visit still has the colours */
  }
}

let lookLoad: Promise<PorchLook> | null = null;
const lookWatchers = new Set<(look: PorchLook) => void>();

/** Reload the porch's look (after the admin changes the theme). */
export function reloadPorchLook() {
  lookLoad = null;
  void loadLook();
}

function loadLook() {
  lookLoad ??= myPorchLook()
    .then((look) => {
      applyLook(look);
      try {
        localStorage.setItem(LOOK_KEY, JSON.stringify(look));
      } catch {
        /* fine */
      }
      lookWatchers.forEach((fn) => fn(look));
      return look;
    })
    .catch((error) => {
      lookLoad = null;
      throw error;
    });
  return lookLoad;
}

/** The viewer's church porch: name, initials, theme. Applies the theme as soon as it's known. */
export function usePorchLook(): PorchLook | null {
  const [look, setLook] = useState<PorchLook | null>(null);
  useEffect(() => {
    const cached = readCachedLook();
    if (cached) {
      setLook(cached);
      applyLook(cached);
    }
    lookWatchers.add(setLook);
    void loadLook().then(setLook).catch(() => undefined);
    return () => {
      lookWatchers.delete(setLook);
    };
  }, []);
  return look;
}

/* ---------------- Icons (from design-reference) ---------------- */

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function PbIcon({ name, size = 24 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    porch: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
    tour: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="1.5" />
        <circle cx="15" cy="12" r="1" />
      </>
    ),
    offices: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="1.5" />
        <path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4" />
      </>
    ),
    read: (
      <>
        <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
        <path d="M4 21V5" />
      </>
    ),
    chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" />,
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
      </>
    ),
    bell: (
      <>
        <path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4z" />
        <path d="M10 21h4" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    eyeOff: (
      <>
        <path d="M3 3l18 18" />
        <path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.1 6.6C3.6 8.3 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 4.4-1" />
      </>
    ),
    photo: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="9" cy="10" r="1.5" />
        <path d="M21 16l-5-5-8 8" />
      </>
    ),
    star: <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />,
    bulb: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z" />,
    ask: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01" />
      </>
    ),
    heart: <path d="M12 20s-7-4.5-9-9a4.5 4.5 0 0 1 9-2 4.5 4.5 0 0 1 9 2c-2 4.5-9 9-9 9z" />,
    back: <path d="M15 5l-7 7 7 7" />,
    phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
    person: (
      <>
        <circle cx="12" cy="9" r="3.2" />
        <path d="M6 19c1.3-2.6 3.3-3.8 6-3.8s4.7 1.2 6 3.8" />
      </>
    ),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      {paths[name] ?? null}
    </svg>
  );
}

/* ---------------- People's faces ---------------- */

export function initialsOf(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?"
  );
}

/** A soft colour per person (the same person always gets the same one). */
export function toneOf(key: string) {
  let sum = 0;
  for (const ch of key) sum = (sum + ch.charCodeAt(0)) % 997;
  return `tone-${(sum % 4) + 1}`;
}

export function PbAvatar({ name, imageUrl, id, size }: { name: string; imageUrl?: string | null; id?: string; size?: number }) {
  const style = size ? { width: size, height: size, borderRadius: size / 2, fontSize: Math.round(size * 0.36) } : undefined;
  return (
    <span className={`pb-av ${imageUrl ? "" : toneOf(id || name)}`} style={style}>
      {imageUrl ? <img src={imageUrl} alt="" draggable={false} /> : initialsOf(name)}
    </span>
  );
}

/* ---------------- Bars ---------------- */

export const MAIN_TABS = [
  { to: "/", label: "Porch", icon: "porch", match: (path: string) => path === "/" || path === "/presence" },
  { to: "/next", label: "Tour", icon: "tour", match: (path: string) => path === "/next" },
  { to: "/offices", label: "Offices", icon: "offices", match: (path: string) => path.startsWith("/offices") },
  { to: "/read", label: "Read", icon: "read", match: (path: string) => path === "/read" },
  { to: "/messages", label: "Chat", icon: "chat", match: (path: string) => path.startsWith("/messages") },
] as const;

export function BottomNav({ pathname, unread }: { pathname: string; unread: number }) {
  return (
    <nav className="pb pb-nav" aria-label="Main">
      {MAIN_TABS.map((tab) => {
        const on = tab.match(pathname);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            search={tab.to === "/" ? ({ room: "all" } as never) : undefined}
            aria-current={on ? "page" : undefined}
            className={on ? "is-on" : ""}
          >
            <PbIcon name={tab.icon} />
            <span>{tab.label}</span>
            {tab.to === "/messages" && unread > 0 ? <span className="pb-badge">{unread > 9 ? "9+" : unread}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** The top bar: the porch's logo and name, what this screen is, the bell, and your own picture (your profile). */
export function TopBar({
  look,
  subtitle,
  bell,
  me,
  onSwitch,
}: {
  look: PorchLook | null;
  subtitle: string;
  bell: ReactNode;
  me: { id: string; name: string; imageUrl: string | null };
  /** N3: for people who run a ministry, the badge and the picture open "Continue as". */
  onSwitch?: () => void;
}) {
  return (
    <header className="pb pb-top">
      {onSwitch ? (
        <button type="button" className="pb-logo" aria-label="Continue as me or as a ministry you run" onClick={onSwitch}>
          {look?.initials ?? ""}
        </button>
      ) : (
        <div className="pb-logo" aria-hidden="true">
          {look?.initials ?? ""}
        </div>
      )}
      <div className="pb-top-name">
        <p className="pb-ttl">{look?.shortName ?? "Porchbook"}</p>
        <p>{subtitle}</p>
      </div>
      {bell}
      {onSwitch ? (
        <button type="button" className="pb-me" aria-label="Continue as me or as a ministry you run" onClick={onSwitch}>
          {me.imageUrl ? <img src={me.imageUrl} alt="" draggable={false} /> : initialsOf(me.name)}
        </button>
      ) : (
        <Link to="/people/$userId" params={{ userId: me.id }} className="pb-me" aria-label="My profile">
          {me.imageUrl ? <img src={me.imageUrl} alt="" draggable={false} /> : initialsOf(me.name)}
        </Link>
      )}
    </header>
  );
}

/** My porch / Public porch. */
export function PorchSwitch({ side }: { side: "mine" | "public" }) {
  return (
    <div className="pb-seg" role="tablist" aria-label="Which porch">
      <Link to="/" search={{ room: "all" } as never} role="tab" aria-selected={side === "mine"} className={side === "mine" ? "is-on" : ""}>
        <PbIcon name="porch" size={18} />
        My porch
      </Link>
      <Link to="/" search={{ room: "all", view: "public" } as never} role="tab" aria-selected={side === "public"} className={side === "public" ? "is-on" : ""}>
        <PbIcon name="globe" size={18} />
        Public porch
      </Link>
    </div>
  );
}

/** "14 on the porch now": opens who is here. */
export function PresenceStrip() {
  const porch = usePorch();
  const hidden = porch.status === "hidden";
  const faces = porch.people.slice(0, 3);
  return (
    <Link to="/presence" className="pb-card pb-strip" aria-label="Who is on the porch">
      {faces.length ? (
        <span className="pb-faces">
          {faces.map((person) => (
            <PbAvatar key={person.userId} id={person.userId} name={person.name} imageUrl={person.imageUrl} />
          ))}
        </span>
      ) : null}
      <span style={{ flex: 1, fontSize: 15 }}>
        {hidden ? (
          <>
            <span className="pb-dot is-off" />
            You're hidden from the porch
          </>
        ) : (
          <>
            <span className="pb-dot" />
            <b>{porch.count}</b> on the porch now
          </>
        )}
      </span>
      {hidden ? (
        <span className="pb-tag is-quiet">
          <PbIcon name="eyeOff" size={14} />
          Hidden
        </span>
      ) : (
        <span className="pb-tag is-green">
          <PbIcon name="eye" size={14} />
          Visible
        </span>
      )}
    </Link>
  );
}

/* ---------------- Dawn / Dusk / Night ---------------- */

/** "Light: Dawn Dusk Night" (design-reference/Tour.dc.html): a gentle dimmer on any theme. */
export function LightRow() {
  const [level, setLevel] = useState<number>(100);
  useEffect(() => {
    setLevel(currentBrightness());
    const sync = () => setLevel(currentBrightness());
    window.addEventListener("porch-bright", sync);
    return () => window.removeEventListener("porch-bright", sync);
  }, []);
  const nearest = level >= 75 ? "dawn" : level >= 25 ? "dusk" : "night";
  return (
    <div className="pb-row" style={{ justifyContent: "center", gap: 8, margin: "12px 0" }} role="group" aria-label="Light">
      <span className="pb-quiet" style={{ fontSize: 13 }}>
        Light
      </span>
      {(Object.keys(LIGHT_LEVELS) as (keyof typeof LIGHT_LEVELS)[]).map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed={nearest === key}
          className={`pb-chip${nearest === key ? " is-on" : ""}`}
          onClick={() => {
            setBrightness(LIGHT_LEVELS[key]);
            setLevel(LIGHT_LEVELS[key]);
          }}
        >
          {key[0].toUpperCase() + key.slice(1)}
        </button>
      ))}
    </div>
  );
}

/**
 * While a conversation is open on a phone, the bottom bar steps aside so the message box sits at
 * the bottom of the screen (Conversation.dc.html has no bottom bar). Computers keep it.
 */
export function useConversationOpen(open = true) {
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("pb-in-convo");
    return () => document.body.classList.remove("pb-in-convo");
  }, [open]);
}

/** Stage 4e: each member chooses Light (default) or Dark for themselves, in Your account. */
export function LookModeChoice() {
  const look = usePorchLook();
  const [mode, setMode] = useState<LookMode | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (look) setMode((current) => current ?? look.mode ?? "light");
  }, [look]);
  if (!look) return null;
  async function choose(next: LookMode) {
    if (!look || next === mode) return;
    setMode(next);
    applyLook({ ...look, mode: next });
    const { setMyLookMode } = await import("@/lib/porch/porch-look");
    const result = await setMyLookMode({ data: { mode: next } }).catch(() => null);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't save.");
      return;
    }
    setNote("");
    reloadPorchLook();
  }
  return (
    <div className="pb-look-row">
      <span className="pb-look-label">Look</span>
      <span className="pb-chips" role="radiogroup" aria-label="Light or Dark">
        {(["light", "dark"] as const).map((item) => (
          <button key={item} type="button" role="radio" aria-checked={mode === item} className={`pb-chip${mode === item ? " is-on" : ""}`} onClick={() => void choose(item)}>
            {item === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </span>
      {note ? <span className="text-danger" style={{ fontSize: 13 }}>{note}</span> : null}
    </div>
  );
}
