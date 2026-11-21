/**
 * The Porchbook brand (Stage 4e, brand/BRAND.md). This replaces the six full church themes.
 * - Porchbook's olive is always the frame: top bar, bottom bar, main buttons, selected tab,
 *   links, switches.
 * - Each church picks ONE accent colour for its own touches: its name badge, pinned
 *   announcements, office icons, room chips, reactions, notification badges, "Live now".
 * - Each member picks Light (default) or Dark for themselves.
 * Every screen reads these through the --pb-* CSS variables.
 */
export type LookMode = "light" | "dark";
export type AccentId = "gold" | "terracotta" | "royal-blue" | "teal" | "purple" | "crimson";

/** The church accent colours: a light-mode and a dark-mode value each (BRAND.md). */
export const ACCENTS: { id: AccentId; name: string; light: string; dark: string }[] = [
  { id: "gold", name: "Porchbook gold", light: "#8A5E0E", dark: "#E2B45A" },
  { id: "terracotta", name: "Terracotta", light: "#A4472E", dark: "#EE8C70" },
  { id: "royal-blue", name: "Royal blue", light: "#2F5DA8", dark: "#93B3F2" },
  { id: "teal", name: "Teal", light: "#1D7169", dark: "#62CDC2" },
  { id: "purple", name: "Purple", light: "#6B4BA8", dark: "#BBA2F2" },
  { id: "crimson", name: "Crimson", light: "#A8323A", dark: "#F08A90" },
];
export const DEFAULT_ACCENT: AccentId = "gold";

export function accentOf(id: string | null | undefined) {
  return ACCENTS.find((accent) => accent.id === id) ?? ACCENTS[0];
}
export function isAccent(id: unknown): id is AccentId {
  return typeof id === "string" && ACCENTS.some((accent) => accent.id === id);
}

/** Porchbook's own colours, light and dark (BRAND.md). */
export const BRAND = {
  light: {
    olive: "#576C31",
    onOlive: "#FFFFFF",
    oliveDeep: "#3F4F22",
    oliveTint: "#E6EBD8",
    bg: "#F7F5EE",
    card: "#FFFFFF",
    border: "#E2E5D6",
    text: "#1F2416",
    quiet: "#5C6452",
    bar: "#576C31",
    onBar: "#FFFFFF",
    onAccent: "#FFFFFF",
  },
  dark: {
    olive: "#A3B86C",
    onOlive: "#1A220E",
    oliveDeep: "#A3B86C",
    oliveTint: "#2A3322",
    bg: "#121510",
    card: "#1B2017",
    border: "#2A3122",
    text: "#EEF0E6",
    quiet: "#A9B09B",
    bar: "#1B2017",
    onBar: "#EEF0E6",
    onAccent: "#121510",
  },
} as const;

/** The CSS variables for a member's mode and their church's accent. */
export function brandVars(mode: LookMode, accentId: string | null | undefined): Record<string, string> {
  const c = BRAND[mode];
  const accent = accentOf(accentId)[mode];
  return {
    "--pb-bg": c.bg,
    "--pb-card": c.card,
    "--pb-text": c.text,
    "--pb-quiet": c.quiet,
    // "main" is Porchbook's olive: buttons, selected tab, links, switches.
    "--pb-main": c.olive,
    "--pb-on-main": c.onOlive,
    // "second" (online dots, "Visible") is olive too: the frame stays calm.
    "--pb-second": c.olive,
    "--pb-olive-deep": c.oliveDeep,
    "--pb-olive-tint": c.oliveTint,
    "--pb-border": c.border,
    "--pb-bar": c.bar,
    "--pb-on-bar": c.onBar,
    // The church's accent: its own touches only.
    "--pb-accent": accent,
    "--pb-on-accent": c.onAccent,
    "--pb-scheme": mode,
  };
}
