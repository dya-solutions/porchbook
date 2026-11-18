/**
 * Refresh without losing your place. Before a refresh, Porchbook notes where you are
 * (the page, the open panel or note, how far down, the radio, half-written boxes) and
 * saves any note being written; afterwards each part puts itself back.
 */

export type Place = {
  path: string;
  at: number;
  scroll: number;
  radio: boolean;
  drafts: { key: string; value: string }[];
  parts: Record<string, unknown>;
};

const KEY = "porch-place";
const parts = new Map<string, () => unknown>();
const savers = new Set<() => Promise<unknown> | unknown>();
let pending: Place | null = null;
let loaded = false;

/** A part of the page that can say where it is (e.g. the open note). */
export function placePart(name: string, read: () => unknown) {
  parts.set(name, read);
  return () => {
    if (parts.get(name) === read) parts.delete(name);
  };
}

/** Something to save before a refresh (e.g. the note being written). */
export function placeSaver(save: () => Promise<unknown> | unknown) {
  savers.add(save);
  return () => savers.delete(save);
}

export function scroller(): HTMLElement | null {
  return document.querySelector("main > div.overflow-y-auto");
}

function draftKey(node: HTMLInputElement | HTMLTextAreaElement) {
  const label = node.getAttribute("aria-label") || node.getAttribute("placeholder") || node.getAttribute("name") || "";
  return label ? `${node.tagName}|${label}` : "";
}

function readDrafts() {
  const drafts: { key: string; value: string }[] = [];
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea").forEach((node) => {
    if (node instanceof HTMLInputElement && !["text", "search", "url", "tel", "number", ""].includes(node.type)) return;
    if (!node.value || node.value.length > 4000) return;
    const key = draftKey(node);
    if (key) drafts.push({ key, value: node.value });
  });
  return drafts.slice(0, 20);
}

/** Note down where you are, and save what's being written. */
export async function capturePlace(radio: boolean): Promise<Place> {
  await Promise.race([
    Promise.all([...savers].map((save) => Promise.resolve().then(save).catch(() => undefined))),
    new Promise((resolve) => window.setTimeout(resolve, 2500)),
  ]);
  const read: Record<string, unknown> = {};
  parts.forEach((get, name) => {
    try {
      const value = get();
      if (value !== undefined && value !== null) read[name] = value;
    } catch {
      /* skip it */
    }
  });
  return {
    path: window.location.pathname,
    at: Date.now(),
    scroll: scroller()?.scrollTop ?? 0,
    radio,
    drafts: readDrafts(),
    parts: read,
  };
}

/** Before a full reload: keep the place for the next page. */
export function keepForReload(place: Place) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(place));
  } catch {
    /* the page just reloads */
  }
}

/** Before an in-place refresh: hand the place straight to the parts that come back. */
export function keepInMemory(place: Place) {
  pending = place;
  loaded = true;
}

/** The place to restore (once), if it was just noted for this page. */
export function placeToRestore(): Place | null {
  if (!loaded) {
    loaded = true;
    try {
      const raw = sessionStorage.getItem(KEY);
      sessionStorage.removeItem(KEY);
      if (raw) pending = JSON.parse(raw) as Place;
    } catch {
      pending = null;
    }
  }
  if (!pending) return null;
  if (Date.now() - pending.at > 3 * 60 * 1000 || pending.path !== window.location.pathname) {
    pending = null;
    return null;
  }
  return pending;
}

/** One part takes its own piece back. */
export function takePart<T>(name: string): T | null {
  const place = placeToRestore();
  if (!place || !(name in place.parts)) return null;
  const value = place.parts[name] as T;
  delete place.parts[name];
  return value;
}

export function finishRestore() {
  pending = null;
}

/** Put half-written words back into their boxes (React notices the change). */
export function restoreDrafts(drafts: { key: string; value: string }[]) {
  for (const draft of drafts) {
    const [tag, label] = draft.key.split("|");
    const node = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(tag.toLowerCase())].find(
      (item) => (item.getAttribute("aria-label") || item.getAttribute("placeholder") || item.getAttribute("name") || "") === label && !item.value,
    );
    if (!node) continue;
    const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(node, draft.value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

/** On a call right now? (any live microphone or camera on the page) */
export function onCall() {
  return [...document.querySelectorAll<HTMLMediaElement>("audio, video")].some((node) => {
    const stream = node.srcObject;
    return stream instanceof MediaStream && stream.getTracks().some((track) => track.readyState === "live");
  });
}
