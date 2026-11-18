import { useSyncExternalStore } from "react";

/** The buttons' look, per phone: "classic" (black) or "green" (glossy Porchbook green). */
export type ButtonStyle = "classic" | "green";
const KEY = "porch-button-style";
const watchers = new Set<() => void>();

function read(): ButtonStyle {
  try {
    return localStorage.getItem(KEY) === "green" ? "green" : "classic";
  } catch {
    return "classic";
  }
}

export function setButtonStyle(next: ButtonStyle) {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* this visit only */
  }
  document.documentElement.classList.toggle("btn-green", next === "green");
  watchers.forEach((fn) => fn());
}

export function useButtonStyle(): ButtonStyle {
  return useSyncExternalStore(
    (fn) => {
      watchers.add(fn);
      return () => {
        watchers.delete(fn);
      };
    },
    read,
    () => "classic" as ButtonStyle,
  );
}
