import { useSyncExternalStore } from "react";

/** The top and bottom bars, per phone: "photo" (the header photo) or "leather" (stitched leather, matching the buttons). */
export type BarStyle = "photo" | "leather";
const KEY = "porch-bar-style";
const watchers = new Set<() => void>();

function read(): BarStyle {
  try {
    return localStorage.getItem(KEY) === "leather" ? "leather" : "photo";
  } catch {
    return "photo";
  }
}

export function setBarStyle(next: BarStyle) {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* this visit only */
  }
  document.documentElement.classList.toggle("bars-leather", next === "leather");
  watchers.forEach((fn) => fn());
}

export function useBarStyle(): BarStyle {
  return useSyncExternalStore(
    (fn) => {
      watchers.add(fn);
      return () => {
        watchers.delete(fn);
      };
    },
    read,
    () => "photo" as BarStyle,
  );
}
