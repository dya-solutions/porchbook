/**
 * The six porch themes (BUILD-BRIEF.md section 6). This table is the ONE set of colour settings:
 * every screen reads these colours through CSS variables (--pb-*), and the old colour names
 * (ink, muted, card, pine…) are pointed at them too. Adding a theme later means adding one row.
 * Only colours change; fonts and layout stay the same.
 */
export type ThemeId = "porch-evening" | "royal-night" | "morning-light" | "crimson-grace" | "living-water" | "purple-praise";

export type Theme = {
  id: ThemeId;
  name: string;
  light: boolean;
  bg: string; // Background
  card: string; // Cards
  text: string; // Text
  quiet: string; // Quiet text
  main: string; // Main colour (buttons, active tab)
  onMain: string; // Text on the main colour
  second: string; // Second colour (online dot, logo, "Visible")
};

export const THEMES: Theme[] = [
  { id: "porch-evening", name: "Porch Evening", light: false, bg: "#0E120F", card: "#171D18", text: "#F4F1E8", quiet: "#A3AC9F", main: "#F8A018", onMain: "#1A1205", second: "#90C840" },
  { id: "royal-night", name: "Royal Night", light: false, bg: "#0D1220", card: "#161D30", text: "#F2F0EA", quiet: "#A6AEC4", main: "#E8B84A", onMain: "#1A1405", second: "#8FA8FF" },
  { id: "morning-light", name: "Morning Light", light: true, bg: "#F6F3EA", card: "#FFFFFF", text: "#1D2219", quiet: "#5C6458", main: "#9E5400", onMain: "#FFFFFF", second: "#4A7320" },
  { id: "crimson-grace", name: "Crimson Grace", light: false, bg: "#140E0F", card: "#1E1617", text: "#F5EFEC", quiet: "#B3A6A3", main: "#E5574E", onMain: "#1A0706", second: "#F2C14E" },
  { id: "living-water", name: "Living Water", light: false, bg: "#0B1416", card: "#132125", text: "#EEF5F4", quiet: "#9DB2B1", main: "#3CC6C0", onMain: "#06201F", second: "#F4A259" },
  { id: "purple-praise", name: "Purple Praise", light: false, bg: "#120E18", card: "#1C1626", text: "#F3EFF8", quiet: "#ADA4BC", main: "#B48CFF", onMain: "#160C2A", second: "#F5C451" },
];

export const DEFAULT_THEME: ThemeId = "porch-evening";

export function themeOf(id: string | null | undefined): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

/** The CSS variables for a theme. Shades in between are mixed from the six colours. */
export function themeVars(theme: Theme): Record<string, string> {
  return {
    "--pb-bg": theme.bg,
    "--pb-card": theme.card,
    "--pb-text": theme.text,
    "--pb-quiet": theme.quiet,
    "--pb-main": theme.main,
    "--pb-on-main": theme.onMain,
    "--pb-second": theme.second,
    "--pb-scheme": theme.light ? "light" : "dark",
  };
}

/** The key this phone keeps the last theme under, so the right colours show before anything loads. */
export const THEME_CACHE_KEY = "porch-colours-v2"; // v2: the Porchbook brand (Stage 4e)
