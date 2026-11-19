import { useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { shown } from "@/lib/porch/on-hold";
import { closeLayer, currentLayerTag, dropLayer, openLayer, retagLayer } from "@/lib/porch/back-stack";
import { createPortal } from "react-dom";

export type TourMode = "twenty" | "events" | "worship" | "serve" | "transport" | "groups" | "offices" | "feedback" | "clinic" | "call";

let mode: TourMode | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function getTourMode() {
  return mode;
}

export function subscribeTourMode(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Each open panel is a back step: Back closes it (and only it).
let layerId = 0;
const closedByBack = () => {
  layerId = 0;
  mode = null;
  emit();
};

/** Doors that are on hold (BUILD-BRIEF.md section 4) never open, even from old links or alerts. */
function onHold(next: TourMode) {
  return (next === "worship" && !shown("radio")) || (next === "clinic" && !shown("clinic")) || (next === "call" && !shown("groupCalls"));
}

export function toggleTourMode(next: TourMode) {
  if (onHold(next) && mode !== next) return;
  const was = mode;
  mode = mode === next ? null : next;
  if (!was && mode) layerId = openLayer(`tour:${mode}`, closedByBack);
  else if (was && !mode) {
    const id = layerId;
    layerId = 0;
    closeLayer(id);
  } else if (was && mode) layerId = retagLayer(layerId, `tour:${mode}`, closedByBack);
  emit();
}

/** Leaving Tour: the panel closes, but its back step stays, so Back reopens it. */
export function closeTourMode() {
  if (!mode) return;
  if (layerId) dropLayer(layerId);
  layerId = 0;
  mode = null;
  emit();
}

const MODES = new Set<string>(["twenty", "events", "worship", "serve", "transport", "groups", "offices", "feedback", "clinic", "call"]);
/** Back on Tour: reopen the panel that was open when we left. */
export function restoreTourMode() {
  const tag = currentLayerTag();
  if (!tag.startsWith("tour:") || mode) return;
  const which = tag.slice(5);
  if (!MODES.has(which)) return;
  mode = which as TourMode;
  layerId = openLayer(tag, closedByBack);
  emit();
}

export function useTourMode() {
  return useSyncExternalStore(subscribeTourMode, getTourMode, getTourMode);
}

export function TourSlot({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setNode(document.getElementById("tour-fill")), []);
  if (!node) return null;
  return createPortal(children, node);
}
