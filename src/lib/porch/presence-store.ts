import { useSyncExternalStore } from "react";
import { presenceBeat, setPresence, type OnlinePerson, type PresenceStatus } from "@/lib/porch/presence";

/** This phone's view of who's on the porch, and my own status (online / do not disturb / hidden). */

type Seed = { displayName: string; email: string | null; imageUrl: string | null };
export type Porch = { loaded: boolean; status: PresenceStatus; chose: boolean; count: number; people: OnlinePerson[] };

const STATUS_KEY = "porch-presence";
const BEAT_MS = 30_000;
let porch: Porch = { loaded: false, status: readStatus(), chose: false, count: 0, people: [] };
const watchers = new Set<() => void>();
const tell = () => watchers.forEach((fn) => fn());

function readStatus(): PresenceStatus {
  if (typeof window === "undefined") return "hidden";
  try {
    const value = localStorage.getItem(STATUS_KEY);
    return value === "online" || value === "dnd" ? value : "hidden";
  } catch {
    return "hidden";
  }
}
function keepStatus(status: PresenceStatus) {
  try {
    localStorage.setItem(STATUS_KEY, status);
  } catch {
    /* fine */
  }
}

function take(result: { status: PresenceStatus; chose: boolean; count: number; people: OnlinePerson[] }) {
  porch = { loaded: true, status: result.status, chose: result.chose, count: result.count, people: result.people };
  keepStatus(result.status);
  tell();
}

export function usePorch() {
  return useSyncExternalStore(
    (fn) => {
      watchers.add(fn);
      return () => {
        watchers.delete(fn);
      };
    },
    () => porch,
    () => porch,
  );
}

/** Do not disturb: calls arrive quietly and the message ring stays silent. */
export function isDoNotDisturb() {
  return porch.status === "dnd";
}

export function onlineState(userId: string): "online" | "idle" | "dnd" | null {
  const person = porch.people.find((item) => item.userId === userId);
  if (!person) return null;
  return person.dnd ? "dnd" : person.idle ? "idle" : "online";
}

let seed: Seed | null = null;
let timer = 0;
let lastTouch = Date.now();
let started = "";

async function beat(here = true) {
  if (!seed) return;
  try {
    take(await presenceBeat({ data: { ...seed, active: Date.now() - lastTouch < BEAT_MS + 5000, here } }));
  } catch {
    /* try again next beat */
  }
}

export function startPresence(next: Seed, userId: string) {
  seed = next;
  if (started === userId) return;
  started = userId;
  const touched = () => {
    lastTouch = Date.now();
  };
  window.addEventListener("pointerdown", touched, { passive: true });
  window.addEventListener("keydown", touched);
  window.addEventListener("scroll", touched, { passive: true, capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void beat(false);
    else {
      touched();
      void beat();
    }
  });
  window.addEventListener("pagehide", () => void beat(false));
  void beat();
  window.clearInterval(timer);
  timer = window.setInterval(() => {
    if (!document.hidden) void beat();
  }, BEAT_MS);
}

export async function choosePresence(status: PresenceStatus) {
  if (!seed) return;
  porch = { ...porch, status, chose: true };
  keepStatus(status);
  tell();
  try {
    const result = await setPresence({ data: { ...seed, status } });
    if (result.ok) take(result);
  } catch {
    /* kept on this phone; the next beat brings the truth */
  }
}
