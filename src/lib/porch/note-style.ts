import { useSyncExternalStore } from "react";

/** The bell's list, per phone: "porch" (dark green and orange, the default) or "light" (white). Also whether the bell is shown at all. */
export type NoteStyle = "porch" | "light";
const KEY = "porch-note-style";
const watchers = new Set<() => void>();
let bellOn = false;

function read(): NoteStyle {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "porch";
  } catch {
    return "porch";
  }
}
const subscribe = (fn: () => void) => {
  watchers.add(fn);
  return () => {
    watchers.delete(fn);
  };
};

export function setNoteStyle(next: NoteStyle) {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* this visit only */
  }
  watchers.forEach((fn) => fn());
}
export const useNoteStyle = () => useSyncExternalStore(subscribe, read, () => "porch" as NoteStyle);

export function setBellOn(on: boolean) {
  if (bellOn === on) return;
  bellOn = on;
  watchers.forEach((fn) => fn());
}
export const useBellOn = () => useSyncExternalStore(subscribe, () => bellOn, () => false);
