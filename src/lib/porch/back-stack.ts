import { useEffect, useRef } from "react";

/**
 * Back, one layer at a time. Every panel, form or card that opens leaves a step in the
 * phone's back history; pressing Back closes only the top one. The on-screen arrows do the same.
 * Steps carry the router's own index and key, so the router keeps counting correctly.
 */

type Layer = { id: number; tag: string; index: number; close: () => void };
const stack: Layer[] = [];
let nextId = 1;
let quietPops = 0;
let listening = false;

type State = Record<string, unknown> & { __TSR_index?: number; porchLayer?: string };
function state(): State {
  return (typeof window !== "undefined" && (window.history.state as State | null)) || {};
}
function indexNow() {
  const value = Number(state().__TSR_index);
  return Number.isFinite(value) ? value : 0;
}
function randomKey() {
  return Math.random().toString(36).slice(2, 10);
}

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("popstate", () => {
    if (quietPops > 0) {
      quietPops -= 1;
      return;
    }
    const at = indexNow();
    // Back: close every layer that sat above where we are now (normally just one).
    while (stack.length && stack[stack.length - 1].index > at) {
      const top = stack.pop();
      try {
        top?.close();
      } catch {
        /* already gone */
      }
    }
    // A leftover step whose layer is already closed: step over it.
    const tag = state().porchLayer;
    if (typeof tag === "string" && !tag.startsWith("tour:") && !stack.some((layer) => layer.index === at)) {
      window.history.back();
      return;
    }
    leaveGuard(at);
  });
}

/** A layer opened: leave a back step for it. Returns its id (for closeLayer). */
export function openLayer(tag: string, close: () => void): number {
  if (typeof window === "undefined") return 0;
  listen();
  const current = state();
  const id = nextId++;
  // Closed and reopened in the same moment: keep its step instead of rewinding and pushing again.
  // Closed and another (or the same) layer opened in its place at once, e.g. one book swapped
  // for another: keep that one back step for the new layer instead of rewinding and pushing.
  if (pendingRewind && pendingRewind.index === indexNow()) {
    const keep = pendingRewind;
    pendingRewind = null;
    if (keep.tag !== tag) window.history.replaceState({ ...current, porchLayer: tag }, "");
    stack.push({ id, tag, index: keep.index, close });
    return id;
  }
  // Coming back to a step this layer already has (e.g. returning to Tour): reuse it.
  if (current.porchLayer === tag && !stack.some((layer) => layer.index === indexNow())) {
    stack.push({ id, tag, index: indexNow(), close });
    return id;
  }
  const index = indexNow() + 1;
  const key = randomKey();
  window.history.pushState({ ...current, __TSR_index: index, __TSR_key: key, key, porchLayer: tag }, "");
  stack.push({ id, tag, index, close });
  return id;
}

/** A layer swapped for another in the same place (e.g. Events → Transport): no extra back step. */
export function retagLayer(id: number, tag: string, close: () => void) {
  const layer = stack.find((item) => item.id === id);
  if (!layer) return openLayer(tag, close);
  layer.tag = tag;
  layer.close = close;
  if (layer.index === indexNow()) window.history.replaceState({ ...state(), porchLayer: tag }, "");
  return id;
}

/** The layer closed itself (✕, Done, Cancel): take its back step away too, with anything opened on top of it. */
export function closeLayer(id: number) {
  const at = stack.findIndex((layer) => layer.id === id);
  if (at < 0) return;
  const removed = stack.splice(at);
  // Anything that was open on top of it closes with it.
  for (const layer of removed.slice(1).reverse()) {
    try {
      layer.close();
    } catch {
      /* already gone */
    }
  }
  const base = removed[0];
  // Rewind a moment later, unless the same layer opens again straight away (a quick redraw).
  pendingRewind = { tag: base.tag, index: base.index };
  window.setTimeout(() => {
    const wait = pendingRewind;
    pendingRewind = null;
    if (!wait) return;
    const now = indexNow();
    if (now >= wait.index && state().porchLayer !== undefined) {
      quietPops += 1;
      window.history.go(-(now - wait.index + 1));
    }
  }, 0);
}
let pendingRewind: { tag: string; index: number } | null = null;

/** The page is going away (the layer stays in history, so Back can reopen it). */
export function dropLayer(id: number) {
  const at = stack.findIndex((layer) => layer.id === id);
  if (at >= 0) stack.splice(at, 1);
}

/** The step we're standing on, if it belongs to a layer (to reopen it on return). */
export function currentLayerTag() {
  return typeof state().porchLayer === "string" ? (state().porchLayer as string) : "";
}

// ---- At the very start: "Press back again to leave Porchbook".
let guarded = false;
export function toast(text: string) {
  const old = document.querySelector(".porch-toast");
  old?.remove();
  const note = document.createElement("div");
  note.className = "porch-toast";
  note.textContent = text;
  document.body.appendChild(note);
  window.setTimeout(() => note.remove(), 2400);
}

export function guardStart() {
  if (guarded || typeof window === "undefined") return;
  listen();
  guarded = true;
  if (indexNow() === 0) {
    window.history.pushState({ ...state(), __TSR_index: 1, __TSR_key: randomKey(), porchGuard: true }, "");
  }
}

function leaveGuard(at: number) {
  if (!guarded || at !== 0 || stack.length) return;
  // First press at the start: warn. The very next Back leaves (the guard step is used up).
  toast("Press back again to leave Porchbook");
  window.setTimeout(() => {
    // They stayed: put the guard back for next time.
    if (indexNow() === 0 && !stack.length) window.history.pushState({ ...state(), __TSR_index: 1, __TSR_key: randomKey(), porchGuard: true }, "");
  }, 2500);
}

/** For panels, forms and cards: while `open`, Back closes it (calling `close`). */
export function useBackLayer(open: boolean, close: () => void, tag: string) {
  const id = useRef(0);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    id.current = openLayer(tag, () => {
      id.current = 0;
      closeRef.current();
    });
    return () => {
      if (id.current) {
        const mine = id.current;
        id.current = 0;
        closeLayer(mine);
      }
    };
  }, [open, tag]);
}
