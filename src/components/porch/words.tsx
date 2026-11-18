import { useBackLayer } from "@/lib/porch/back-stack";
import { useEffect, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { getWords, setWord } from "@/lib/porch/words";

/**
 * Reword Porchbook: headings, buttons and help lines carry a key. The founder turns on
 * "Edit words", taps any outlined words, and saves new ones for everyone.
 * Words in {curly} braces are filled in by Porchbook (a name, a date) and should stay.
 */

type State = { words: Record<string, string>; editing: boolean; open: { key: string; original: string } | null };
let state: State = { words: {}, editing: false, open: null };
const listeners = new Set<() => void>();
const CACHE = "porch-words";
const EDITING = "porch-words-editing";

function publish(next: Partial<State>) {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const read = () => state;
const serverRead = () => state;

let loaded = false;
export function loadWords() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE) ?? "{}") as Record<string, string>;
    publish({ words: cached, editing: localStorage.getItem(EDITING) === "1" });
  } catch {
    /* fresh */
  }
  getWords()
    .then((result) => {
      publish({ words: result.words });
      try {
        localStorage.setItem(CACHE, JSON.stringify(result.words));
      } catch {
        /* still shown */
      }
    })
    .catch(() => undefined);
}

export function setEditingWords(on: boolean) {
  publish({ editing: on, open: null });
  try {
    localStorage.setItem(EDITING, on ? "1" : "0");
  } catch {
    /* for this visit */
  }
}

export function useWordsState() {
  return useSyncExternalStore(subscribe, read, serverRead);
}

function fill(text: string, vars?: Record<string, string | number>) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all));
}

/** The words for a key (reworded or original), with {names} filled in. For placeholders and labels. */
export function useWord(key: string, original: string, vars?: Record<string, string | number>) {
  const { words } = useWordsState();
  return fill(words[key] ?? original, vars);
}

/** Rewordable words. In Edit words mode they're outlined; taps work as usual, and press-and-hold opens the editor. */
export function W({ k, children, vars }: { k: string; children: string; vars?: Record<string, string | number> }) {
  const { words, editing } = useWordsState();
  const text = fill(words[k] ?? children, vars);
  if (!editing) return <>{text}</>;
  return (
    <span className={`w-edit${words[k] ? " is-changed" : ""}`} {...holdToEdit(k, children)}>
      {text}
    </span>
  );
}

let swallowClick = false;
// One press at a time: kept outside the words so a button redrawing mid-press can't lose it.
let holdTimer = 0;
let holdX = 0;
let holdY = 0;
function holdToEdit(key: string, original: string) {
  const cancel = () => window.clearTimeout(holdTimer);
  return {
    onPointerDown: (event: ReactPointerEvent) => {
      holdX = event.clientX;
      holdY = event.clientY;
      cancel();
      holdTimer = window.setTimeout(() => {
        swallowClick = true;
        window.setTimeout(() => (swallowClick = false), 700);
        try {
          const host = window as Window & { PorchApp?: { tick?: (strong: boolean) => void } };
          if (typeof host.PorchApp?.tick === "function") host.PorchApp.tick(true);
          else navigator.vibrate?.(30);
        } catch {
          /* no buzz */
        }
        publish({ open: { key, original } });
      }, 500);
    },
    onPointerMove: (event: ReactPointerEvent) => {
      if (Math.abs(event.clientX - holdX) > 10 || Math.abs(event.clientY - holdY) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // The tap that ends a long press shouldn't also press the button underneath.
    onClickCapture: (event: SyntheticEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onContextMenu: (event: SyntheticEvent) => event.preventDefault(),
  };
}

/** A small ✎ shown only while editing, for words you can't tap (the grey hint inside a box). */
export function WHint({ k, children }: { k: string; children: string }) {
  const { words, editing } = useWordsState();
  if (!editing) return null;
  return (
    <button
      type="button"
      className="w-hint"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        publish({ open: { key: k, original: children } });
      }}
    >
      ✎ {words[k] ?? children}
    </button>
  );
}

/** The editor box and the "Editing words" strip. Mounted once, for everyone (it only shows when editing). */
export function WordsEditor() {
  const { words, editing, open } = useWordsState();
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useBackLayer(Boolean(open), () => publish({ open: null }), "words");
  useEffect(() => {
    loadWords();
  }, []);
  useEffect(() => {
    if (open) {
      setDraft(words[open.key] ?? open.original);
      setNote("");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (typeof document === "undefined" || (!editing && !open)) return null;

  async function save(text: string) {
    if (!open) return;
    setBusy(true);
    setNote("");
    const result = await setWord({ data: { key: open.key, text: text.trim() === open.original ? "" : text } }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't save. Try again.");
      return;
    }
    const next = { ...state.words };
    if (!text.trim() || text.trim() === open.original) delete next[open.key];
    else next[open.key] = text.trim();
    publish({ words: next, open: null });
    try {
      localStorage.setItem(CACHE, JSON.stringify(next));
    } catch {
      /* still shown */
    }
  }

  const fills = open ? [...new Set(open.original.match(/\{\w+\}/g) ?? [])] : [];
  return createPortal(
    <>
      {editing ? (
        <div className="w-strip">
          <span>✎ Editing words: press and hold any outlined words</span>
          <button type="button" onClick={() => setEditingWords(false)}>
            Done
          </button>
        </div>
      ) : null}
      {open ? (
        <div className="w-shade" onClick={() => publish({ open: null })}>
          <div className="w-box" onClick={(event) => event.stopPropagation()}>
            <p className="w-box-head">Change these words</p>
            <p className="w-box-orig">Original: {open.original}</p>
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} maxLength={600} autoFocus />
            {fills.length ? <p className="w-box-note">Keep {fills.join(", ")}: Porchbook fills {fills.length === 1 ? "it" : "them"} in.</p> : null}
            {note ? <p className="w-box-err">{note}</p> : null}
            <div className="w-box-row">
              <button type="button" className="is-save" disabled={busy || !draft.trim()} onClick={() => void save(draft)}>
                Save for everyone
              </button>
              {words[open.key] ? (
                <button type="button" disabled={busy} onClick={() => void save("")}>
                  Put back
                </button>
              ) : null}
              <button type="button" onClick={() => publish({ open: null })}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  );
}

/** For the founder's menus: the switch. */
export function EditWordsButton({ className }: { className?: string }): ReactNode {
  const { editing } = useWordsState();
  return (
    <button type="button" className={className} onClick={() => setEditingWords(!editing)}>
      {editing ? "✎ Stop editing words" : "✎ Edit words"}
    </button>
  );
}
