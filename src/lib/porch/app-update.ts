/**
 * Keep phones on the newest Porchbook. Every so often (and when the app comes back to the screen)
 * we look at which version the site serves; if it's newer than the one running, the app reloads
 * itself at a quiet moment — moving to another page, or coming back after being away — and never
 * while the radio plays or a call is on.
 */

const ENTRY = /\/assets\/index-[A-Za-z0-9_-]+\.js/;
let running = "";
let waiting = false;
let lastCheck = 0;
let hiddenAt = 0;
let started = false;

function runningVersion() {
  if (running) return running;
  const scripts = [...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>("script[src], link[href]")].map((node) => ("src" in node && node.src) || ("href" in node && node.href) || "");
  running = scripts.map((src) => ENTRY.exec(src)?.[0] ?? "").find(Boolean) ?? ENTRY.exec(document.documentElement.innerHTML)?.[0] ?? "";
  return running;
}

async function check(minGapMs: number) {
  if (waiting || Date.now() - lastCheck < minGapMs || !navigator.onLine) return;
  lastCheck = Date.now();
  const mine = runningVersion();
  if (!mine) return;
  try {
    const response = await fetch(`/?version=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
    const served = ENTRY.exec(await response.text())?.[0] ?? "";
    if (served && served !== mine) waiting = true;
  } catch {
    /* no signal: try later */
  }
}

/** Reload now if a newer version is waiting and nothing would be interrupted. */
export function updateIfReady(canReload: () => boolean) {
  if (!waiting || !canReload()) return false;
  waiting = false;
  window.location.reload();
  return true;
}

export function watchForUpdates(canReload: () => boolean, lite = false) {
  if (started || typeof window === "undefined") return;
  started = true;
  const every = lite ? 30 * 60_000 : 10 * 60_000;
  window.setTimeout(() => void check(0), 20_000);
  window.setInterval(() => void check(every - 5000), every);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    // Back after a while: if a new version is already known, take it now; otherwise look for one.
    if (away > 30_000 && updateIfReady(canReload)) return;
    void check(5 * 60_000);
  });
}
