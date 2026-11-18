import { useSyncExternalStore } from "react";

/** The top bar's look, per phone: "classic" (the 3D switch) or "glass". */
export type TopStyle = "classic" | "glass";
const KEY = "porch-top-style";
const watchers = new Set<() => void>();

function read(): TopStyle {
  try {
    return localStorage.getItem(KEY) === "glass" ? "glass" : "classic";
  } catch {
    return "classic";
  }
}

export function setTopStyle(next: TopStyle) {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* this visit only */
  }
  document.documentElement.classList.toggle("top-glass", next === "glass");
  watchers.forEach((fn) => fn());
}

export function useTopStyle(): TopStyle {
  return useSyncExternalStore(
    (fn) => {
      watchers.add(fn);
      return () => {
        watchers.delete(fn);
      };
    },
    read,
    () => "classic" as TopStyle,
  );
}
