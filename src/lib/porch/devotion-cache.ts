import { getBearerToken } from "@/lib/auth/client";
import { loadReadDoc } from "@/lib/porch/read";
import { englishOf } from "@/lib/porch/devotion-text";

export { englishOf };

/**
 * Today's devotional, kept on the phone. It is fetched quietly in the
 * background when the app opens, so opening the devotional is instant and
 * works without data. A new devotional arrives as soon as Phaneroo posts it.
 */

export type StoredDevotion = { day: string; link: string; html: string; savedAt: number };
type Seed = { displayName: string; email: string | null; imageUrl: string | null };

const KEY = "porch-devotion-v3"; // v3: carries the day's picture

/** The devotional "day": the Kampala date (turning over at midnight). */
export function devotionDay(now = Date.now()) {
  return new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
}

export function storedDevotion(): StoredDevotion | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null") as StoredDevotion | null;
    return saved && typeof saved.html === "string" && saved.html ? saved : null;
  } catch {
    return null;
  }
}

/** Fetch the page behind a link and keep its English text. */
export async function fetchDevotionPage(link: string): Promise<StoredDevotion | null> {
  const token = getBearerToken();
  const response = await fetch(`/api/browse?url=${encodeURIComponent(link)}${token ? `&t=${encodeURIComponent(token)}` : ""}`);
  if (!response.ok) return null;
  const html = englishOf(await response.text());
  if (!html) return null;
  const stored = { day: devotionDay(), link, html, savedAt: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    /* phone storage full: it still shows this time */
  }
  keepDay(stored);
  return stored;
}

let inflight: Promise<StoredDevotion | null> | null = null;

/** Ask which page is today's devotional, then fetch and keep it. */
export function refreshDevotion(seed: Seed): Promise<StoredDevotion | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    const result = await loadReadDoc({ data: { ...seed, key: "devotion" } }).catch(() => null);
    const link = result?.ok ? result.link : "";
    if (!link) return null;
    const saved = storedDevotion();
    // Same page already kept: nothing to download (and yesterday's stays filed as yesterday's).
    if (saved && saved.link === link) return saved;
    return fetchDevotionPage(link).catch(() => null);
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

let warmed = "";

let lastLook = 0;
let ticking = 0;
/**
 * Called when the app opens: a few seconds later, ask whether a new devotional has been posted and
 * fetch it if so; then again every 5 minutes while the app is open (one small question each time).
 */
export function warmDevotion(seed: Seed) {
  const look = () => {
    if (document.visibilityState === "hidden" || Date.now() - lastLook < 4.5 * 60_000) return;
    lastLook = Date.now();
    void refreshDevotion(seed).then((got) => {
      // Also wake the reading-aloud, so it's ready before anyone presses ▶.
      if (got && got.link !== warmed) {
        warmed = got.link;
        void import("@/lib/porch/devotion-voice").then(({ devotionVoice }) => devotionVoice().catch(() => null));
      }
    });
  };
  window.setTimeout(look, 4000);
  if (!ticking) ticking = window.setInterval(look, 5 * 60_000);
}

// ---- The last 7 days, kept on the phone (each day's devotional as it arrived).
const DAYS = "porch-devotion-days";

export function keptDays(): StoredDevotion[] {
  try {
    const list = JSON.parse(localStorage.getItem(DAYS) || "[]") as StoredDevotion[];
    const today = storedDevotion();
    const all = Array.isArray(list) ? list.filter((d) => d && typeof d.html === "string" && d.day) : [];
    // Today's copy (kept before this list existed) counts too.
    if (today && !all.some((d) => d.day === today.day)) all.push(today);
    return all.sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 7);
  } catch {
    return [];
  }
}

function keepDay(day: StoredDevotion) {
  const others = keptDays().filter((d) => d.day !== day.day);
  const list = [day, ...others].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 7);
  for (let n = list.length; n > 0; n--) {
    try {
      localStorage.setItem(DAYS, JSON.stringify(list.slice(0, n)));
      return;
    } catch {
      /* phone storage full: keep fewer days */
    }
  }
}

/** "Thu 5 Nov" for a devotional day. */
export function dayLabel(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
