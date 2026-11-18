import { useSyncExternalStore } from "react";

/**
 * Porchbook Lite: the same app, using much less data. Photos wait for a tap,
 * nothing big downloads in the background, and heavy places ask first.
 */

const KEY = "porch-lite";
const ASKED = "porch-lite-asked";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let on = typeof window === "undefined" ? false : read();

function paint() {
  if (typeof document !== "undefined") document.documentElement.classList.toggle("is-lite", on);
}
paint();

export function isLite() {
  return on;
}

export function setLite(next: boolean) {
  on = next;
  try {
    localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    /* still switches for this visit */
  }
  paint();
  for (const listener of listeners) listener();
}

export function useLite(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => on,
    () => false,
  );
}

type Connection = { saveData?: boolean; effectiveType?: string };

/** Data Saver on, or a very slow line: worth offering Lite (once a week at most). */
export function shouldOfferLite(): boolean {
  if (on) return false;
  try {
    const asked = Number(localStorage.getItem(ASKED) || 0);
    if (Date.now() - asked < 7 * 24 * 3600_000) return false;
    // Someone who chose full Porchbook on purpose isn't asked again for a week.
  } catch {
    return false;
  }
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  if (!connection) return false;
  return Boolean(connection.saveData) || connection.effectiveType === "2g" || connection.effectiveType === "slow-2g";
}

export function markLiteAsked() {
  try {
    localStorage.setItem(ASKED, String(Date.now()));
  } catch {
    /* asked again next time */
  }
}
