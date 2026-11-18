import { useSyncExternalStore } from "react";

/** The post box look, per phone: "walnut" (wood frame) or "porchbook" (Porchbook green and orange). */
export type PostStyle = "walnut" | "porchbook";
const KEY = "porch-postbox-style";
const watchers = new Set<() => void>();

function read(): PostStyle {
  try {
    return localStorage.getItem(KEY) === "porchbook" ? "porchbook" : "walnut";
  } catch {
    return "walnut";
  }
}

export function setPostStyle(next: PostStyle) {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* this visit only */
  }
  document.documentElement.classList.toggle("pb-green", next === "porchbook");
  watchers.forEach((fn) => fn());
}

export function usePostStyle(): PostStyle {
  return useSyncExternalStore(
    (fn) => {
      watchers.add(fn);
      return () => {
        watchers.delete(fn);
      };
    },
    read,
    () => "walnut" as PostStyle,
  );
}
