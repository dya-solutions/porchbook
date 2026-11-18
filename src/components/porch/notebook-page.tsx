import { ImportNotes } from "@/components/porch/notes-import";
import type { Incoming } from "@/lib/porch/notes-import";
import { StudyTrio, type StudyPlace } from "@/components/porch/study-trio";
import { NOTE_FONTS, getNoteFont, setNoteFont, type NoteFont } from "@/lib/porch/note-font";
// Sizes matched so every font fills a line with about the same words (measured against Book),
// so lines break in the same places whichever font is chosen.
const FONT_BASE: Record<NoteFont, number> = { book: 1.2, garamond: 1.5, lora: 1.23, clean: 1.28, hand: 1.59, script: 1.68 };
const LINE_GAP = 2.04; // rem between lines, the same for every font
const SIZE_STEPS = [0.85, 0.93, 1, 1.12, 1.26];
const FONT_NAMES: Record<NoteFont, string> = { book: "Book", garamond: "Garamond", lora: "Lora", clean: "Clean", hand: "Handwritten", script: "Script" };
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Trash2 } from "lucide-react";
import { deleteNote, restoreNote } from "@/lib/porch/read";
import { useBackLayer } from "@/lib/porch/back-stack";
import { peekStudy, takeStudy } from "@/lib/porch/strongs";
import {
  PEN_CLASS,
  WASH,
  addPrefix,
  applyFmt,
  dropPrefix,
  fmtAt,
  linesIn,
  marksToHtml,
  nextNumber,
  placeCaretAfter,
  placeCaretAt,
  plainOfMarks,
  selectNodes,
  readMarks,
  rowPrefix,
  setRowCode,
  type Fmt,
  type Ink,
  type Pen,
} from "@/lib/porch/note-markup";
import { NoteBar } from "@/components/porch/note-bar";
import { placeSaver } from "@/lib/porch/place";
import { HEAR_LANGS, spotScriptures, startHearing, transcriberState, type HearLang } from "@/lib/porch/transcribe";

function editedLabel(iso: string) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Edited: ${month}-${day} ${time}`;
}

/** Let a title box grow to fit the whole title, wrapping onto more lines. */
function grow(node: HTMLTextAreaElement | null) {
  if (!node) return;
  node.style.height = "auto";
  node.style.height = `${node.scrollHeight}px`;
}

function pageDate(iso: string) {
  const date = iso && !Number.isNaN(new Date(iso).getTime()) ? new Date(iso) : new Date();
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }).replace(/,?\s(\d+)\s/, " · $1 ").toUpperCase();
}

type Tool = Ink | "erase";

function isWordChar(char: string) {
  return /[\p{L}\p{N}]/u.test(char) || char === "'" || char === "\u2019";
}

function neighborText(root: HTMLElement, text: Text, dir: -1 | 1) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  walker.currentNode = text;
  const next = dir < 0 ? walker.previousNode() : walker.nextNode();
  return next instanceof Text ? next : null;
}

function textPoint(root: HTMLElement, node: Node, offset: number) {
  if (node !== root && !root.contains(node)) return null;
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node as Text;
    const length = text.textContent?.length ?? 0;
    return { text, index: Math.max(0, Math.min(offset, length)) };
  }
  if (!(node instanceof HTMLElement)) return null;
  const child = node.childNodes[offset] ?? node.childNodes[offset - 1];
  if (!child) return null;
  if (child.nodeType === Node.TEXT_NODE) {
    const text = child as Text;
    return { text, index: offset >= node.childNodes.length ? (text.textContent?.length ?? 0) : 0 };
  }
  if (!(child instanceof HTMLElement)) return null;
  const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  let current = walker.nextNode();
  if (offset < node.childNodes.length && current instanceof Text) return { text: current, index: 0 };
  while (current) {
    if (current instanceof Text) last = current;
    current = walker.nextNode();
  }
  if (!last) return null;
  return { text: last, index: last.textContent?.length ?? 0 };
}

function wordRange(root: HTMLElement, node: Node, offset: number) {
  const found = textPoint(root, node, offset);
  if (!found) return null;
  let text = found.text;
  let index = found.index;
  const value = () => text.textContent ?? "";
  if (index > 0 && !isWordChar(value()[index] ?? "") && isWordChar(value()[index - 1] ?? "")) index -= 1;
  if (!isWordChar(value()[index] ?? "")) return null;
  let startText = text;
  let start = index;
  while (true) {
    const current = startText.textContent ?? "";
    while (start > 0 && isWordChar(current[start - 1] ?? "")) start -= 1;
    if (start > 0) break;
    const prev = neighborText(root, startText, -1);
    const prevValue = prev?.textContent ?? "";
    if (!prev || !isWordChar(prevValue[prevValue.length - 1] ?? "")) break;
    startText = prev;
    start = prevValue.length;
  }
  let endText = text;
  let end = index + 1;
  while (true) {
    const current = endText.textContent ?? "";
    while (end < current.length && isWordChar(current[end] ?? "")) end += 1;
    if (end < current.length) break;
    const next = neighborText(root, endText, 1);
    const nextValue = next?.textContent ?? "";
    if (!next || !isWordChar(nextValue[0] ?? "")) break;
    endText = next;
    end = 0;
  }
  try {
    const range = document.createRange();
    range.setStart(startText, start);
    range.setEnd(endText, end);
    return range.toString() ? range : null;
  } catch {
    return null;
  }
}

function unwrap(span: HTMLElement) {
  const parent = span.parentNode;
  if (!parent) return;
  while (span.firstChild) parent.insertBefore(span.firstChild, span);
  parent.removeChild(span);
  if (parent instanceof HTMLElement) parent.normalize();
}

function stripInk(root: ParentNode) {
  [...root.querySelectorAll("[data-ink]")].forEach((node) => {
    if (node instanceof HTMLElement) unwrap(node);
  });
}

function penHolder(node: Node | null, root: HTMLElement) {
  let current = node;
  while (current && current !== root) {
    if (current instanceof HTMLElement && current.dataset.pen) return current;
    current = current.parentNode;
  }
  return null;
}

function writePen(root: HTMLElement, color: Pen, text: string, source?: Range) {
  const sel = window.getSelection();
  const range = source ?? (sel && sel.rangeCount ? sel.getRangeAt(0) : null);
  if (!range || !root.contains(range.commonAncestorContainer)) return;
  range.deleteContents();
  const span = document.createElement("span");
  span.dataset.pen = color;
  span.className = PEN_CLASS[color];
  text.split("\n").forEach((part, index) => {
    if (index) span.appendChild(document.createElement("br"));
    if (part) span.appendChild(document.createTextNode(part));
  });
  range.insertNode(span);
  placeCaretAfter(span);
}

/** Remove every highlight touched by a selection. */
function eraseIn(root: HTMLElement, range: Range) {
  [...root.querySelectorAll("[data-ink]")].forEach((node) => {
    if (node instanceof HTMLElement && range.intersectsNode(node)) unwrap(node);
  });
}

function applyWash(range: Range, ink: Ink) {
  const word = range.toString();
  if (!word) return;
  const box = range.commonAncestorContainer;
  const host = (box instanceof HTMLElement ? box : box.parentElement)?.closest("[data-ink]");
  if (host instanceof HTMLElement && (host.textContent ?? "") === word) {
    if (host.dataset.ink === ink) {
      unwrap(host);
      return;
    }
    host.dataset.ink = ink;
    host.className = WASH[ink];
    return;
  }
  const span = document.createElement("span");
  span.dataset.ink = ink;
  span.className = WASH[ink];
  const contents = range.extractContents();
  stripInk(contents);
  span.appendChild(contents);
  range.insertNode(span);
}

export function NotebookList({
  notes,
  onOpen,
  onNew,
  onBack,
  onSwitch,
  onImport,
}: {
  onSwitch?: (to: StudyPlace) => void;
  /** Bring notes in from other notebooks (files or a Google Keep export). */
  onImport?: (notes: Incoming[], progress: (done: number) => void) => Promise<number>;
  notes: { id: string; title: string; phaneroo: string; updatedAt: string }[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onBack: () => void;
}) {
  // Select notes, then delete: hidden at once, with Undo for a minute.
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [undo, setUndo] = useState<{ ids: string[]; label: string; until: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [note, setNote] = useState("");
  const [importing, setImporting] = useState(false);
  useBackLayer(importing, () => setImporting(false), "notes:import");
  const pressTimer = useRef(0);
  const pressed = useRef(false);
  useBackLayer(selecting, () => {
    setSelecting(false);
    setPicked(new Set());
  }, "notes:select");
  useEffect(() => {
    if (!undo) return;
    const timer = window.setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= undo.until) setUndo(null);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [undo]);
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(""), 3500);
    return () => window.clearTimeout(timer);
  }, [note]);

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function stopSelecting() {
    setSelecting(false);
    setPicked(new Set());
  }

  async function removePicked() {
    const ids = [...picked];
    if (!ids.length) return;
    const first = notes.find((item) => item.id === ids[0]);
    const label = ids.length === 1 ? `“${first?.title || "Untitled"}”` : `${ids.length} notes`;
    setGone((current) => new Set([...current, ...ids]));
    stopSelecting();
    setUndo({ ids, label, until: Date.now() + 60000 });
    setNow(Date.now());
    const results = await Promise.all(ids.map((id) => deleteNote({ data: { id } }).catch(() => null)));
    const failed = ids.filter((_, index) => !results[index]?.ok);
    if (failed.length) {
      setGone((current) => {
        const next = new Set(current);
        failed.forEach((id) => next.delete(id));
        return next;
      });
      const kept = ids.filter((id) => !failed.includes(id));
      setUndo(kept.length ? { ids: kept, label: kept.length === 1 ? "1 note" : `${kept.length} notes`, until: Date.now() + 60000 } : null);
      setNote("Some notes didn't delete. Check your connection and try again.");
    }
  }

  async function bringBack() {
    if (!undo) return;
    const ids = undo.ids;
    setUndo(null);
    const results = await Promise.all(ids.map((id) => restoreNote({ data: { id } }).catch(() => null)));
    const back = ids.filter((_, index) => results[index]?.ok);
    setGone((current) => {
      const next = new Set(current);
      back.forEach((id) => next.delete(id));
      return next;
    });
    if (back.length < ids.length) setNote("Too late to undo some of them: they're gone.");
  }

  const shown = notes.filter((item) => !gone.has(item.id));
  const left = undo ? Math.max(0, Math.ceil((undo.until - now) / 1000)) : 0;
  return (
    <div className="pc-book fixed inset-0 z-[80] flex flex-col bg-[#f6edd4] text-[#2c2416]">
      <div className="flex items-center justify-between px-2 pt-2">
        <button type="button" aria-label="Back to the library" className="grid size-11 place-items-center" onClick={onBack}>
          <ChevronLeft className="size-6" />
        </button>
        <span className="flex items-center gap-2 pr-3 text-sm text-[#6d624e]">
          <span className="size-2.5 rounded-full bg-[#e2b423]" />
          Personal
        </span>
      </div>
      {onSwitch ? <StudyTrio current="notes" onPick={onSwitch} /> : null}
      <div className="flex items-center justify-between gap-3 px-5 pt-2">
        <h2 className="font-display text-3xl">Notebook</h2>
        <span className="flex items-center gap-4">
          {shown.length ? (
            <button type="button" className="text-base font-semibold text-[#8a5a12]" onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
              {selecting ? "Cancel" : "Select"}
            </button>
          ) : null}
          {selecting ? null : (
            <>
            {onImport ? (
              <button type="button" className="text-base font-semibold text-[#8a5a12]" onClick={() => setImporting(true)}>
                Import
              </button>
            ) : null}
            <button type="button" className="text-base font-semibold text-[#8a5a12]" onClick={onNew}>
              + New note
            </button>
            </>
          )}
        </span>
      </div>
      <ul className={`min-h-0 flex-1 overflow-y-auto px-5 py-4${selecting ? " pb-24" : ""}`}>
        {shown.length === 0 ? <li className="text-[#8a7d66]">No notes yet.</li> : null}
        {shown.map((item) => {
          const on = picked.has(item.id);
          return (
            <li key={item.id} className={`nb-row border-b border-[#d9cdb4]${on ? " is-picked" : ""}`}>
              <button
                type="button"
                className="flex w-full items-center gap-3 py-4 text-left"
                aria-pressed={selecting ? on : undefined}
                onPointerDown={() => {
                  pressed.current = false;
                  window.clearTimeout(pressTimer.current);
                  if (selecting) return;
                  // Press and hold a note to start selecting with it.
                  pressTimer.current = window.setTimeout(() => {
                    pressed.current = true;
                    setSelecting(true);
                    setPicked(new Set([item.id]));
                    navigator.vibrate?.(20);
                  }, 550);
                }}
                onPointerUp={() => window.clearTimeout(pressTimer.current)}
                onPointerLeave={() => window.clearTimeout(pressTimer.current)}
                onPointerCancel={() => window.clearTimeout(pressTimer.current)}
                onContextMenu={(event) => event.preventDefault()}
                onClick={() => {
                  if (pressed.current) {
                    pressed.current = false;
                    return;
                  }
                  if (selecting) toggle(item.id);
                  else onOpen(item.id);
                }}
              >
                {selecting ? <span className={`nb-tick${on ? " is-on" : ""}`} aria-hidden="true">{on ? "✓" : ""}</span> : null}
                <span className="min-w-0 flex-1">
                  <span className="block text-xl">{item.title || "Untitled"}</span>
                  {item.phaneroo.replace(/\D/g, "") ? (
                    <span className="mt-1 block text-base">
                      {item.phaneroo.startsWith("M") ? "MasterClass" : "Phaneroo"} {item.phaneroo.replace(/\D/g, "")}
                    </span>
                  ) : null}
                  <span className="mt-1 block text-sm text-[#8a7d66]">{editedLabel(item.updatedAt)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {selecting ? (
        <div className="nb-select-bar">
          <button type="button" className="nb-select-all" onClick={() => setPicked(picked.size === shown.length ? new Set() : new Set(shown.map((item) => item.id)))}>
            {picked.size === shown.length ? "Select none" : "Select all"}
          </button>
          <button type="button" className="nb-select-del" disabled={!picked.size} onClick={() => void removePicked()}>
            <Trash2 />
            {picked.size ? `Delete ${picked.size}` : "Delete"}
          </button>
        </div>
      ) : undo ? (
        <div className="nb-undo" role="status">
          <span className="min-w-0 flex-1 truncate">Deleted {undo.label}</span>
          <button type="button" onClick={() => void bringBack()}>
            Undo · {left}s
          </button>
        </div>
      ) : note ? (
        <div className="nb-undo" role="status">
          <span className="min-w-0 flex-1">{note}</span>
        </div>
      ) : null}
      {importing && onImport ? <ImportNotes onSave={onImport} onClose={() => setImporting(false)} /> : null}
    </div>
  );
}

export function NotebookPage({
  title,
  subtitle,
  phaneroo,
  kind,
  body,
  edited,
  busy,
  note,
  onTitle,
  onSubtitle,
  onPhaneroo,
  onKind,
  onSave,
  onBack,
  onSwitch,
}: {
  onSwitch?: (to: StudyPlace, body: string) => void;
  title: string;
  subtitle: string;
  phaneroo: string;
  kind: "personal" | "office";
  body: string;
  edited: string;
  busy: boolean;
  note: string;
  onTitle: (value: string) => void;
  onSubtitle: (value: string) => void;
  onPhaneroo: (value: string) => void;
  onKind: (value: "personal" | "office") => void;
  onSave: (body: string) => unknown;
  onBack: (body: string) => void;
}) {
  const editor = useRef<HTMLDivElement>(null);
  // ---- The live transcriber: the preacher's words written into the note as they're spoken.
  const [hearing, setHearing] = useState(false);
  // Choosing the language before listening (the last one is remembered on the phone).
  const [hearPick, setHearPick] = useState(false);
  const [hearLang, setHearLang] = useState<HearLang>(() => {
    try {
      const kept = localStorage.getItem("porch-hear-lang");
      return HEAR_LANGS.some((l) => l.id === kept) ? (kept as HearLang) : "eng";
    } catch {
      return "eng";
    }
  });
  const [heardSec, setHeardSec] = useState(0);
  const [hearNote, setHearNote] = useState("");
  const hear = useRef<{ stop: () => void; row: HTMLElement | null; live: HTMLElement | null; lastFinal: number; started: number } | null>(null);
  const penRef = useRef<Pen | null>(null);
  const washRef = useRef<Tool | null>(null);
  const down = useRef({ x: 0, y: 0, moved: false, handled: false });
  const [pen, setPen] = useState<Pen | null>(null);
  const [wash, setWash] = useState<Tool | null>(null);
  const [study, setStudy] = useState("");
  const lastRange = useRef<Range | null>(null);
  const [fmtOn, setFmtOn] = useState<Set<Fmt>>(new Set());
  const [lineCodes, setLineCodes] = useState("");
  // Undo / redo: the note as it stood, step by step.
  const history = useRef<{ past: string[]; now: string; future: string[] }>({ past: [], now: "", future: [] });
  const [steps, setSteps] = useState({ undo: false, redo: false });
  // While writing, the top folds into one slim line so the note gets the screen.
  const [folded, setFolded] = useState(false);
  const [font, setFont] = useState<NoteFont>(() => {
    try {
      const kept = localStorage.getItem("porch-note-font");
      return (NOTE_FONTS as readonly string[]).includes(kept ?? "") ? (kept as NoteFont) : "book";
    } catch {
      return "book";
    }
  });
  const [size, setSize] = useState<number>(() => {
    try {
      const kept = Number(localStorage.getItem("porch-note-size"));
      return kept >= 1 && kept <= 5 ? kept : 3;
    } catch {
      return 3;
    }
  });
  useEffect(() => {
    getNoteFont()
      .then((result) => {
        setFont(result.font);
        setSize(result.size);
        try {
          localStorage.setItem("porch-note-size", String(result.size));
        } catch {
          /* fine */
        }
        try {
          localStorage.setItem("porch-note-font", result.font);
        } catch {
          /* fine */
        }
      })
      .catch(() => undefined);
  }, []);
  function chooseFont(next: NoteFont, nextSize = size) {
    setFont(next);
    setSize(nextSize);
    try {
      localStorage.setItem("porch-note-font", next);
      localStorage.setItem("porch-note-size", String(nextSize));
    } catch {
      /* fine */
    }
    void setNoteFont({ data: { font: next, size: nextSize } }).catch(() => undefined);
  }
  const [dirty, setDirty] = useState(0); // bumps on every change, for saving by itself
  const [savedAt, setSavedAt] = useState(0);
  const firstRender = useRef(true);
  const when = pageDate(edited);
  const stampIsMC = phaneroo.startsWith("M");
  const stampNumber = phaneroo.replace(/\D/g, "");
  void editedLabel;
  penRef.current = pen;
  washRef.current = wash;

  useEffect(() => {
    if (editor.current) editor.current.innerHTML = marksToHtml(body);
    history.current = { past: [], now: readMarks(editor.current), future: [] };

    setStudy(peekStudy());
    // The page is remade when another note opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save by itself a moment after you stop writing.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setDirty((n) => n + 1);
  }, [title, subtitle, phaneroo, kind]);
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      const markup = readMarks(editor.current);
      const plain = plainOfMarks(markup);
      if (!title.trim() && !subtitle.trim() && !phaneroo.replace(/\D/g, "") && !plain) return;
      if (busy) {
        setDirty((n) => n + 1);
        return;
      }
      onSave(markup);
      setSavedAt(dirty);
    }, 1500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  useEffect(() => {
    const root = editor.current;
    if (!root) return;
    const sheet = root;
    function onBefore(event: InputEvent) {
      const color = penRef.current;
      if (!color || !event.cancelable || !event.data) return;
      if (event.inputType !== "insertText" && event.inputType !== "insertReplacementText") return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const held = sel.getRangeAt(0);
      if (!sheet.contains(held.commonAncestorContainer)) return;
      if (sel.isCollapsed && penHolder(held.startContainer, sheet)?.dataset.pen === color) return;
      const range = document.createRange();
      const target = event.getTargetRanges?.()[0];
      if (target) {
        range.setStart(target.startContainer, target.startOffset);
        range.setEnd(target.endContainer, target.endOffset);
      } else {
        range.setStart(held.startContainer, held.startOffset);
        range.setEnd(held.endContainer, held.endOffset);
      }
      event.preventDefault();
      writePen(sheet, color, event.data, range);
      setDirty((count) => count + 1);
    }
    function onCompose(event: CompositionEvent) {
      const color = penRef.current;
      const text = event.data;
      if (!color || !text) return;
      const sel = window.getSelection();
      if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return;
      const node = sel.anchorNode;
      const offset = sel.anchorOffset;
      if (!(node instanceof Text) || !sheet.contains(node)) return;
      if (penHolder(node, sheet)?.dataset.pen === color) return;
      const start = offset - text.length;
      if (start < 0 || node.textContent?.slice(start, offset) !== text) return;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, offset);
      const span = document.createElement("span");
      span.dataset.pen = color;
      span.className = PEN_CLASS[color];
      span.appendChild(range.extractContents());
      range.insertNode(span);
      placeCaretAfter(span);
      setDirty((count) => count + 1);
    }
    // ---- A highlight covers only the words it was put on: writing straight after it is plain.
    let edge: { span: HTMLElement; len: number } | null = null;
    let composing = false;
    function inkAtEnd(): HTMLElement | null {
      const sel = window.getSelection();
      if (!sel || !sel.isCollapsed || !sel.rangeCount) return null;
      const node = sel.anchorNode;
      const host = (node instanceof HTMLElement ? node : node?.parentElement)?.closest("[data-ink]");
      if (!(host instanceof HTMLElement) || !sheet.contains(host)) return null;
      const rest = document.createRange();
      rest.setStart(sel.anchorNode as Node, sel.anchorOffset);
      rest.setEnd(host, host.childNodes.length);
      return rest.toString() === "" ? host : null;
    }
    function writeAfter(span: HTMLElement, raw: string) {
      const next = span.nextSibling;
      // A space at the end of a line must be a fixed one, or the phone drops it.
      const text = /^ /.test(raw) && !(next instanceof Text && (next.textContent ?? "").length) ? raw.replace(/^ /, "\u00a0") : raw;
      if (next instanceof Text) {
        next.textContent = text + (next.textContent ?? "");
        placeCaretAt(next, text.length);
      } else {
        const plain = document.createTextNode(text);
        span.after(plain);
        placeCaretAt(plain, text.length);
      }
    }
    function trimEnd(span: HTMLElement, count: number) {
      let left = count;
      const texts: Text[] = [];
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) texts.push(walker.currentNode as Text);
      for (let i = texts.length - 1; i >= 0 && left > 0; i -= 1) {
        const value = texts[i].textContent ?? "";
        const cut = Math.min(left, value.length);
        texts[i].textContent = value.slice(0, value.length - cut);
        left -= cut;
      }
    }
    // Words that slipped into the end of a highlight move out of it.
    function settleEdge() {
      const held = edge;
      edge = null;
      if (!held || !held.span.isConnected) return;
      const text = held.span.textContent ?? "";
      if (text.length <= held.len) return;
      const extra = text.slice(held.len);
      trimEnd(held.span, extra.length);
      writeAfter(held.span, extra);
      setDirty((count) => count + 1);
    }
    // An empty highlight (left on a new line by Enter) is taken away.
    function dropEmptyInk() {
      sheet.querySelectorAll("[data-ink]").forEach((node) => {
        if (node instanceof HTMLElement && !(node.textContent ?? "").replace(/\u200b/g, "")) unwrap(node);
      });
    }
    function onInkBefore(event: InputEvent) {
      if (washRef.current || !event.inputType.startsWith("insert") || event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") return;
      const span = inkAtEnd();
      if (!span) return;
      if (event.cancelable && event.inputType === "insertText" && event.data && !penRef.current) {
        event.preventDefault();
        writeAfter(span, event.data);
        setDirty((count) => count + 1);
        return;
      }
      if (!edge) edge = { span, len: (span.textContent ?? "").length };
    }
    function onInkInput() {
      dropEmptyInk();
      if (!composing) settleEdge();
    }
    function onCompStart() {
      composing = true;
    }
    function onCompEnd() {
      composing = false;
      window.setTimeout(() => {
        settleEdge();
        dropEmptyInk();
      }, 0);
    }
    root.addEventListener("beforeinput", onInkBefore);
    root.addEventListener("beforeinput", onBefore);
    root.addEventListener("input", onInkInput);
    root.addEventListener("compositionstart", onCompStart);
    root.addEventListener("compositionend", onCompEnd);
    root.addEventListener("compositionend", onCompose);
    return () => {
      root.removeEventListener("beforeinput", onInkBefore);
      root.removeEventListener("beforeinput", onBefore);
      root.removeEventListener("input", onInkInput);
      root.removeEventListener("compositionstart", onCompStart);
      root.removeEventListener("compositionend", onCompEnd);
      root.removeEventListener("compositionend", onCompose);
    };
  }, []);

  // The line you're writing always stays in sight: above the toolbar and the keyboard.
  function caretRect(range: Range): DOMRect | null {
    const rects = range.getClientRects();
    if (rects.length && rects[rects.length - 1].height) return rects[rects.length - 1];
    // A bare caret often has no box of its own: measure the letter just before it (or after it).
    const node = range.endContainer;
    const offset = range.endOffset;
    if (node instanceof Text && node.length) {
      const probe = document.createRange();
      if (offset > 0) probe.setStart(node, offset - 1), probe.setEnd(node, offset);
      else probe.setStart(node, 0), probe.setEnd(node, Math.min(1, node.length));
      const box = probe.getClientRects();
      if (box.length && box[box.length - 1].height) return box[box.length - 1];
    }
    const holder = node instanceof HTMLElement ? node : node.parentElement;
    // Only a single line's row is a fair stand-in, never the whole page.
    if (holder && holder !== editor.current) {
      const box = holder.getBoundingClientRect();
      if (box.height && box.height < 120) return box;
    }
    return null;
  }
  function keepCaretInView() {
    const root = editor.current;
    const sel = window.getSelection();
    if (!root || !sel || !sel.rangeCount || document.activeElement !== root) return;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.endContainer)) return;
    const view = window.visualViewport;
    // When the keyboard covers the page (rather than shrinking it), leave that much room
    // under the writing, so even the last line can scroll up above the keyboard.
    const covered = view ? Math.max(0, window.innerHeight - view.height - view.offsetTop) : 0;
    const room = `calc(7rem + ${Math.round(covered)}px)`;
    if (root.style.paddingBottom !== room) root.style.paddingBottom = room;
    const rect = caretRect(range);
    if (!rect) return;
    const screenBottom = view ? view.offsetTop + view.height : window.innerHeight;
    const bar = document.querySelector(".nb-bar")?.getBoundingClientRect();
    const bottom = Math.min(screenBottom, bar && bar.top > 0 ? bar.top : screenBottom) - Math.max(24, rect.height * 0.6);
    const top = root.getBoundingClientRect().top + 8;
    if (rect.bottom > bottom) root.scrollTop += rect.bottom - bottom;
    else if (rect.top < top) root.scrollTop -= top - rect.top;
  }
  useEffect(() => {
    const view = window.visualViewport;
    let timer = 0;
    const soon = (wait = 40) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(keepCaretInView, wait);
    };
    const onKeyboard = () => soon(120);
    const onSelect = () => soon();
    const root = editor.current;
    // Phone keyboards type in several ways; check after each of them.
    const onType = () => soon();
    view?.addEventListener("resize", onKeyboard);
    view?.addEventListener("scroll", onKeyboard);
    document.addEventListener("selectionchange", onSelect);
    root?.addEventListener("keyup", onType);
    root?.addEventListener("compositionupdate", onType);
    root?.addEventListener("input", onType);
    return () => {
      window.clearTimeout(timer);
      view?.removeEventListener("resize", onKeyboard);
      view?.removeEventListener("scroll", onKeyboard);
      document.removeEventListener("selectionchange", onSelect);
      root?.removeEventListener("keyup", onType);
      root?.removeEventListener("compositionupdate", onType);
      root?.removeEventListener("input", onType);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh saves what you're writing first.
  useEffect(() => {
    const drop = placeSaver(() => {
      const markup = readMarks(editor.current);
      return plainOfMarks(markup) || title.trim() ? onSave(markup) : undefined;
    });
    return () => {
      drop();
    };
  },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title],
  );

  // Each pause in writing is one undo step.
  function remember() {
    const markup = readMarks(editor.current);
    const book = history.current;
    if (markup === book.now) return;
    book.past.push(book.now);
    if (book.past.length > 80) book.past.shift();
    book.now = markup;
    book.future = [];
    setSteps({ undo: true, redo: false });
  }
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(remember, 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);
  function showStep(markup: string) {
    const root = editor.current;
    if (!root) return;
    root.innerHTML = marksToHtml(markup);
    // Kept exactly as the page now reads, so the next pause doesn't count as a new change.
    history.current.now = readMarks(root);
    setSteps({ undo: history.current.past.length > 0, redo: history.current.future.length > 0 });
    setDirty((n) => n + 1);
  }
  function undo() {
    remember();
    const book = history.current;
    const back = book.past.pop();
    if (back === undefined) return;
    book.future.push(book.now);
    book.now = back;
    showStep(back);
  }
  function redo() {
    const book = history.current;
    const ahead = book.future.pop();
    if (ahead === undefined) return;
    book.past.push(book.now);
    book.now = ahead;
    showStep(ahead);
  }

  // Where the caret is (kept, so the bar's buttons act there even after a tap elsewhere).
  useEffect(() => {
    function track() {
      const root = editor.current;
      const sel = window.getSelection();
      if (!root || !sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;
      lastRange.current = range.cloneRange();
      setFmtOn(fmtAt(root, range.startContainer));
      let row: Node | null = range.startContainer;
      while (row && row.parentNode !== root) row = row.parentNode;
      setLineCodes(row instanceof HTMLElement ? (row.dataset.line ?? "") : "");
    }
    document.addEventListener("selectionchange", track);
    return () => document.removeEventListener("selectionchange", track);
  }, []);

  /** The kept caret, put back in the note. */
  function caret(): Range | null {
    const root = editor.current;
    if (!root) return null;
    const sel = window.getSelection();
    const live = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (live && root.contains(live.commonAncestorContainer)) return live;
    const kept = lastRange.current;
    if (kept && root.contains(kept.commonAncestorContainer)) {
      sel?.removeAllRanges();
      sel?.addRange(kept);
      return kept;
    }
    // Nowhere yet: the end of the note.
    root.focus();
    placeCaretAfter(root);
    return sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  }
  function changed() {
    remember();
    setDirty((n) => n + 1);
  }

  function style(code: Fmt) {
    const root = editor.current;
    const range = caret();
    if (!root || !range) return;
    remember();
    let target = range;
    if (range.collapsed) {
      const found = wordRange(root, range.startContainer, range.startOffset);
      if (!found) return;
      target = found;
    }
    selectNodes(applyFmt(root, target, code));
    lastRange.current = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).cloneRange() : null;
    setFmtOn(fmtAt(root, window.getSelection()?.anchorNode ?? null));
    changed();
  }

  function list(kind: "bullet" | "number" | "box") {
    const root = editor.current;
    const range = caret();
    if (!root || !range) return;
    remember();
    const rows = linesIn(root, range);
    const allHave = rows.every((row) => {
      const prefix = rowPrefix(row);
      return kind === "number" ? /^\d/.test(prefix) : kind === "box" ? /^[☐☑]/.test(prefix) : prefix.startsWith("•");
    });
    rows.forEach((row) => {
      dropPrefix(row);
      if (!allHave) addPrefix(row, kind, kind === "number" ? nextNumber(row) : 1);
    });
    const last = rows[rows.length - 1];
    if (last) {
      root.focus();
      placeCaretAfter(last);
    }
    changed();
  }

  function line(code: "h" | "c" | "e" | "l") {
    const root = editor.current;
    const range = caret();
    if (!root || !range) return;
    remember();
    const rows = linesIn(root, range);
    rows.forEach((row) => setRowCode(row, code));
    setLineCodes(rows[0]?.dataset.line ?? "");
    changed();
  }

  function insertText(text: string) {
    const root = editor.current;
    const range = caret();
    if (!root || !range) return;
    remember();
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    placeCaretAt(node, text.length);
    lastRange.current = window.getSelection()?.getRangeAt(0).cloneRange() ?? null;
    changed();
  }

  /** A Bible verse: its own line, in italics, with a fresh line after it for writing on. */
  function insertVerse(text: string) {
    const root = editor.current;
    const range = caret();
    if (!root || !range) return;
    remember();
    const rows = linesIn(root, range);
    const after = rows[rows.length - 1] ?? null;
    const holder = document.createElement("div");
    holder.innerHTML = marksToHtml(`{{i}}${text.replaceAll("{{", "{ {")}{{}}\n`);
    const [verseRow, next] = [...holder.children] as HTMLElement[];
    const emptyHere = after && !(after.textContent ?? "").trim() && !after.querySelector("img");
    if (after && emptyHere) after.replaceWith(verseRow);
    else if (after && after.parentNode === root) root.insertBefore(verseRow, after.nextSibling);
    else root.appendChild(verseRow);
    root.insertBefore(next, verseRow.nextSibling);
    root.focus();
    placeCaretAt(next, 0);
    changed();
  }

  /** The row the transcriber writes into (a new one at the end of the note), with its grey "still hearing" words. */
  function hearRow(fresh: boolean) {
    const root = editor.current;
    const h = hear.current;
    if (!root || !h) return null;
    if (h.row && root.contains(h.row) && !fresh) return h.row;
    h.live?.remove();
    const last = root.lastElementChild as HTMLElement | null;
    let row: HTMLElement;
    if (last && last.tagName === "DIV" && !(last.textContent ?? "").replace(/\u200b/g, "").trim() && !last.querySelector("img")) {
      row = last;
      row.innerHTML = "";
    } else {
      row = document.createElement("div");
      root.appendChild(row);
    }
    const live = document.createElement("span");
    live.dataset.live = "1";
    live.contentEditable = "false";
    live.className = "nb-live";
    row.appendChild(live);
    h.row = row;
    h.live = live;
    return row;
  }

  function hearFinal(said: string) {
    const h = hear.current;
    let text = said.replace(/\s+/g, " ").trim();
    if (!h || !text) return;
    // A longer pause starts a new paragraph.
    const pause = h.lastFinal && Date.now() - h.lastFinal > 3500;
    const row = hearRow(Boolean(pause && h.row && (h.row.textContent ?? "").trim()));
    if (!row || !h.live) return;
    const before = (row.textContent ?? "").replace(h.live.textContent ?? "", "").trim();
    const startOfRow = !before;
    if (startOfRow || /[.!?]$/.test(before)) text = text.charAt(0).toUpperCase() + text.slice(1);
    if (!/[.!?,;:]$/.test(text)) text += ".";
    const pieces = spotScriptures((startOfRow ? "" : " ") + text);
    for (const piece of pieces) {
      if (piece.ref) {
        const mark = document.createElement("span");
        mark.dataset.ink = "gold";
        mark.className = WASH.gold;
        mark.textContent = piece.text;
        row.insertBefore(mark, h.live);
      } else row.insertBefore(document.createTextNode(piece.text), h.live);
    }
    h.live.textContent = "";
    h.lastFinal = Date.now();
    changed();
    // Keep the newest words in view.
    window.requestAnimationFrame(() => h.live?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  /** The whole note as text: title, subtitle, its Phaneroo number, then the words (lists and ticks kept). */
  async function copyNote() {
    const number = phaneroo.replace(/\D/g, "");
    const words = plainOfMarks(readMarks(editor.current)).replace(/▣/g, "").replace(/\n{3,}/g, "\n\n").trim();
    const text = [title.trim(), subtitle.trim(), number ? `${phaneroo.startsWith("M") ? "MasterClass" : "Phaneroo"} ${number}` : "", words ? `\n${words}` : ""]
      .filter(Boolean)
      .join("\n")
      .trim();
    if (!text) {
      flash("This note is empty.");
      return;
    }
    let done = false;
    try {
      await navigator.clipboard.writeText(text);
      done = true;
    } catch {
      // The app's web viewer may refuse the clipboard: copy the old way.
      const box = document.createElement("textarea");
      box.value = text;
      box.setAttribute("readonly", "");
      box.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
      document.body.appendChild(box);
      box.select();
      try {
        done = document.execCommand("copy");
      } catch {
        done = false;
      }
      box.remove();
    }
    flash(done ? "Copied ✓ Paste it anywhere." : "Couldn't copy on this phone.");
  }
  function flash(message: string) {
    setHearNote(message);
    window.setTimeout(() => setHearNote((now) => (now === message ? "" : now)), 2500);
  }

  function startTranscribe(lang?: HearLang) {
    if (hear.current) return;
    if (!lang) {
      setHearPick(true);
      return;
    }
    setHearPick(false);
    setHearLang(lang);
    try {
      localStorage.setItem("porch-hear-lang", lang);
    } catch {
      /* not remembered */
    }
    const can = lang === "eng" ? transcriberState() : "ready";
    if (can !== "ready") {
      setHearNote(can === "update" ? "Update the Porchbook app to use the transcriber: tap Refresh." : "This browser can't transcribe. Open Porchbook in Chrome.");
      window.setTimeout(() => setHearNote(""), 6000);
      return;
    }
    hear.current = { stop: () => undefined, row: null, live: null, lastFinal: 0, started: Date.now() };
    editor.current?.blur(); // the keyboard steps aside while it listens (tap the note to type)
    hearRow(true);
    setHearNote("");
    setHeardSec(0);
    setHearing(true);
    hear.current.stop = startHearing({
      onPartial: (text) => {
        const live = hear.current?.live;
        if (!live) return;
        if (!live.isConnected) hearRow(false);
        if (hear.current?.live) hear.current.live.textContent = text.trim() ? ` ${text.trim()}` : "";
      },
      onFinal: hearFinal,
      onPause: () => {
        if (hear.current?.live) hear.current.live.textContent = "";
      },
      onError: (message) => {
        stopTranscribe();
        setHearNote(message);
        window.setTimeout(() => setHearNote(""), 8000);
      },
    }, lang);
  }

  function stopTranscribe() {
    const h = hear.current;
    if (!h) return;
    hear.current = null;
    h.stop();
    h.live?.remove();
    // An empty row left behind stays as a line to write on.
    if (h.row && !h.row.childNodes.length) h.row.appendChild(document.createElement("br"));
    setHearing(false);
    changed();
  }

  useEffect(() => {
    if (!hearing) return;
    const timer = window.setInterval(() => setHeardSec(Math.round((Date.now() - (hear.current?.started ?? Date.now())) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [hearing]);
  // Leaving the note stops listening.
  useEffect(() => () => hear.current?.stop(), []);

  /** Enter on a bulleted, numbered or ticked line starts the next one the same way; Enter on an empty one ends the list. */
  function carryList() {
    const root = editor.current;
    const sel = window.getSelection();
    if (!root || !sel || !sel.rangeCount) return;
    const rows = linesIn(root, sel.getRangeAt(0));
    const row = rows[0];
    const above = row?.previousElementSibling;
    if (!row || !(above instanceof HTMLElement)) return;
    // A heading is one line: the next line is ordinary writing again.
    if (row.dataset.line?.includes("h")) setRowCode(row, "h");
    const prefix = rowPrefix(above);
    if (!prefix || rowPrefix(row)) return;
    if (!(above.textContent ?? "").slice(prefix.length).trim() && !above.querySelector("img")) {
      // An empty item: the list ends here.
      dropPrefix(above);
      if (!above.childNodes.length) above.appendChild(document.createElement("br"));
      return;
    }
    if (/^[☐☑]/.test(prefix)) addPrefix(row, "box");
    else if (/^\d/.test(prefix)) addPrefix(row, "number", nextNumber(row));
    else addPrefix(row, "bullet");
    placeCaretAfter(row);
  }

  function chooseWash(ink: Tool) {
    const root = editor.current;
    const sel = window.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (range && sel && root && !sel.isCollapsed && root.contains(range.commonAncestorContainer)) {
      if (ink === "erase") eraseIn(root, range);
      else applyWash(range, ink);
      setDirty((count) => count + 1);
      sel.removeAllRanges();
      setWash(ink);
      editor.current?.blur();
      return;
    }
    setWash((current) => (current === ink ? null : ink));
    editor.current?.blur();
  }

  function pickPen(next: Pen | null) {
    washRef.current = null;
    setWash(null);
    const chosen = next !== null && pen === next ? null : next;
    penRef.current = chosen;
    setPen(chosen);
    const root = editor.current;
    if (!root) return;
    root.inputMode = "text";
    root.focus();
    // The new colour starts right at the cursor, from the very first letter
    // (phone keyboards hold a word until space, so it can't wait for typing).
    const range = caret();
    if (!range) return;
    range.deleteContents();
    const holder = penHolder(range.startContainer, root);
    if (holder?.dataset.pen === (chosen ?? undefined)) return;
    let at: Range = range;
    if (holder) {
      // Split the old colour at the cursor; the new writing goes between the halves.
      const tail = document.createRange();
      tail.setStart(range.startContainer, range.startOffset);
      tail.setEnd(holder, holder.childNodes.length);
      const rest = tail.extractContents();
      if ((rest.textContent ?? "").replace(/\u200b/g, "")) {
        const again = holder.cloneNode(false) as HTMLElement;
        again.appendChild(rest);
        holder.after(again);
      }
      at = document.createRange();
      at.setStartAfter(holder);
      at.collapse(true);
    }
    const mark = document.createTextNode("\u200b");
    if (chosen) {
      const span = document.createElement("span");
      span.dataset.pen = chosen;
      span.className = PEN_CLASS[chosen];
      span.appendChild(mark);
      at.insertNode(span);
    } else at.insertNode(mark);
    placeCaretAt(mark, 1);
    lastRange.current = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).cloneRange() : null;
  }

  function markAt(event: { clientX: number; clientY: number }) {
    const root = editor.current;
    const color = wash;
    if (!root || !color) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      if (root.contains(range.commonAncestorContainer)) {
        if (color === "erase") eraseIn(root, range);
        else applyWash(range, color);
        setDirty((count) => count + 1);
        sel.removeAllRanges();
      }
      return;
    }
    // Tapping inside a highlight acts on the whole highlight: the eraser or the same marker removes it,
    // another marker recolours it.
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const host = hit instanceof HTMLElement ? hit.closest("[data-ink]") : null;
    if (host instanceof HTMLElement && root.contains(host)) {
      if (color === "erase" || host.dataset.ink === color) unwrap(host);
      else {
        host.dataset.ink = color;
        host.className = WASH[color];
      }
      setDirty((count) => count + 1);
      sel?.removeAllRanges();
      root.blur();
      return;
    }
    if (color === "erase") return;
    const withCaret = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const position = withCaret.caretPositionFromPoint?.(event.clientX, event.clientY);
    const fallback = withCaret.caretRangeFromPoint?.(event.clientX, event.clientY);
    const node = position?.offsetNode ?? fallback?.startContainer;
    const offset = position?.offset ?? fallback?.startOffset;
    if (!node || offset === undefined) return;
    const word = wordRange(root, node, offset);
    if (!word) return;
    applyWash(word, color);
    setDirty((count) => count + 1);
    sel?.removeAllRanges();
    root.blur();
  }

  const pens: { id: Pen | null; label: string; color: string }[] = [
    { id: null, label: "Ink", color: "#2c2416" },
    { id: "red", label: "Red pen", color: "#b42318" },
    { id: "blue", label: "Blue pen", color: "#1d4ed8" },
    { id: "green", label: "Green pen", color: "#1b7a32" },
  ];
  // Three highlighters: yellow, green and pink.
  const marks: { id: Ink; label: string; color: string }[] = [
    { id: "gold", label: "Yellow highlighter", color: "#f3d27a" },
    { id: "green", label: "Green highlighter", color: "#b7d7a8" },
    { id: "red", label: "Pink highlighter", color: "#f0b4b4" },
  ];

  const status = busy ? "Saving…" : note && note !== "Saved." ? note : savedAt && savedAt === dirty ? "✓ Saved" : "";

  return (
    <div className={`pc-book nb-page fixed inset-0 z-[80] flex flex-col text-[#2c2416]${folded ? " is-folded" : ""}`}>
      {folded ? (
        <div className="nb-slim">
          <button type="button" aria-label="Back to the notes" className="grid size-10 place-items-center" onClick={() => onBack(readMarks(editor.current))}>
            <ChevronLeft className="size-5" />
          </button>
          <button type="button" className="nb-slim-open" aria-label="Show the title and stamp" onClick={() => setFolded(false)}>
            <b>{title.trim() || "Untitled"}</b>
            {stampNumber ? <span className={stampIsMC ? "is-mc" : ""}>{stampIsMC ? "MasterClass" : "Phaneroo"} {stampNumber}</span> : null}
            <i aria-hidden="true">▾</i>
          </button>
          <span className={`nb-status ${status.startsWith("✓") ? "is-saved" : ""}`}>{status}</span>
        </div>
      ) : null}
      <div className="nb-top">
        <button type="button" aria-label="Back to the notes" className="grid size-11 place-items-center" onClick={() => onBack(readMarks(editor.current))}>
          <ChevronLeft className="size-6" />
        </button>
        <span className="nb-date">{when}</span>
        <span className={`nb-status ${status.startsWith("✓") ? "is-saved" : ""}`}>{status}</span>
      </div>
      {onSwitch ? <StudyTrio current="notes" onPick={(to) => onSwitch(to, readMarks(editor.current))} /> : null}
      <div className="nb-head">
        <div className={`nb-stamp${stampIsMC ? " is-mc" : ""}${stampNumber ? "" : " is-empty"}`}>
          {/* MasterClasses have stopped: the stamp is Phaneroo only (older MasterClass notes keep their label). */}
          <span className="nb-stamp-name">{stampIsMC ? "MASTERCLASS" : "PHANEROO"}</span>
          <input
            value={stampNumber}
            inputMode="numeric"
            onChange={(event) => {
              const number = event.target.value.replace(/\D/g, "").slice(0, 6);
              onPhaneroo(number);
            }}
            placeholder="Nº"
            aria-label={`${stampIsMC ? "MasterClass" : "Phaneroo"} number`}
          />
        </div>
        <button type="button" className="nb-kind" onClick={() => onKind(kind === "office" ? "personal" : "office")} aria-label="Where this note belongs (tap to change)">
          ● {kind === "office" ? "OFFICE & BUSINESS" : "PERSONAL"}
        </button>
        <textarea
          ref={(node) => grow(node)}
          rows={1}
          value={title}
          onChange={(event) => {
            onTitle(event.target.value.replace(/\n/g, " ").slice(0, 60));
            grow(event.target);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              (event.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
            }
          }}
          placeholder="Title"
          className="nb-title"
        />
        <textarea
          ref={(node) => grow(node)}
          rows={1}
          value={subtitle}
          onChange={(event) => {
            onSubtitle(event.target.value.replace(/\n/g, " ").slice(0, 80));
            grow(event.target);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              editor.current?.focus();
            }
          }}
          placeholder="Subtitle"
          aria-label="Subtitle"
          className="nb-sub"
        />
        <span className="nb-rule" />
      </div>
      {study ? (
        <button
          type="button"
          className="mx-5 mb-1 text-left text-sm font-semibold text-[#8a5a12]"
          onClick={() => {
            const text = takeStudy();
            const root = editor.current;
            if (root && text) {
              root.appendChild(document.createElement("br"));
              root.appendChild(document.createTextNode(text));
            }
            setStudy("");
            setDirty((n) => n + 1);
          }}
        >
          Insert word study
        </button>
      ) : null}
      {hearing ? (
        <div className="nb-hear" role="status" aria-live="off">
          <span className="nb-hear-dot" aria-hidden="true" />
          <span>Listening{hearLang !== "eng" ? ` · ${HEAR_LANGS.find((l) => l.id === hearLang)?.name}` : ""}</span>
          <span className="nb-hear-time">
            {Math.floor(heardSec / 60)}:{String(heardSec % 60).padStart(2, "0")}
          </span>
          <span className="nb-hear-wave" aria-hidden="true">
            {[6, 12, 16, 9, 14, 18, 8, 12, 15, 7, 11, 16].map((h, i) => (
              <i key={i} style={{ height: `${h}px`, animationDelay: `${(i % 6) * 0.12}s` }} />
            ))}
          </span>
          <button type="button" className="nb-hear-stop" onClick={stopTranscribe}>
            ■ Stop
          </button>
        </div>
      ) : hearPick ? (
        <div className="nb-hear-pick" role="dialog" aria-label="Transcribe in which language?">
          <span>Transcribe in</span>
          {HEAR_LANGS.map((l) => (
            <button key={l.id} type="button" className={l.id === hearLang ? "is-on" : ""} onClick={() => startTranscribe(l.id)}>
              {l.name}
            </button>
          ))}
          <button type="button" className="nb-hear-pick-x" aria-label="Cancel" onClick={() => setHearPick(false)}>
            ✕
          </button>
        </div>
      ) : hearNote ? (
        <p className="nb-hear-note">{hearNote}</p>
      ) : null}
      <NoteBar
        api={{
          pens,
          penOn: pen,
          pickPen: (id) => pickPen(id as Pen | null),
          marks,
          washOn: wash,
          chooseWash: (tool) => chooseWash(tool as Tool),
          font,
          fontNames: FONT_NAMES,
          size,
          chooseFont: (next, nextSize) => chooseFont(next, nextSize ?? size),
          fmtOn,
          style,
          list,
          line,
          lineCodes,
          undo,
          redo,
          canUndo: steps.undo || dirty > 0,
          canRedo: steps.redo,
          insertText,
          insertVerse,
          transcribe: startTranscribe,
          copyNote: () => void copyNote(),
          stopWash: () => {
            // Cleared at once, so the note takes the keyboard straight back.
            washRef.current = null;
            setWash(null);
            if (editor.current) editor.current.inputMode = "text";
            editor.current?.focus();
          },
          keepCaret: () => {
            const root = editor.current;
            const sel = window.getSelection();
            if (root && sel && sel.rangeCount && root.contains(sel.getRangeAt(0).commonAncestorContainer)) lastRange.current = sel.getRangeAt(0).cloneRange();
          },
        }}
      />
      <div
        ref={editor}
        contentEditable
        inputMode={wash ? "none" : "text"}
        role="textbox"
        aria-label="Write here"
        data-placeholder="Write here"
        className={`notebook-sheet nb-sheet nf-${font} min-h-0 flex-1 overflow-y-auto outline-none`}
        style={{ fontSize: `${FONT_BASE[font] * SIZE_STEPS[size - 1]}rem`, lineHeight: `${LINE_GAP * SIZE_STEPS[size - 1]}rem` }}
        onInput={(event) => {
          const kind = (event.nativeEvent as InputEvent).inputType;
          if (kind === "insertParagraph" || kind === "insertLineBreak") carryList();
          setDirty((n) => n + 1);
          window.requestAnimationFrame(keepCaretInView);
        }}
        onFocus={() => {
          if (washRef.current) editor.current?.blur();
          else setFolded(true);
        }}
        onScroll={(event) => {
          if (event.currentTarget.scrollTop > 24) setFolded(true);
        }}
        onPointerDown={(event) => {
          down.current = { x: event.clientX, y: event.clientY, moved: false, handled: false };
          if (washRef.current) {
            event.preventDefault();
            editor.current?.blur();
          }
        }}
        onPointerMove={(event) => {
          if (Math.hypot(event.clientX - down.current.x, event.clientY - down.current.y) > 10) down.current.moved = true;
        }}
        onPointerUp={(event) => {
          // A drag that selected words: mark (or erase) the selection.
          if (!wash) return;
          const sel = window.getSelection();
          if (down.current.moved && sel && !sel.isCollapsed) {
            markAt(event);
            down.current.handled = true;
          }
        }}
        onClick={(event) => {
          // A tick box: tap to tick or untick.
          const box = event.target instanceof HTMLElement ? event.target.closest("[data-box]") : null;
          if (box instanceof HTMLElement && editor.current?.contains(box) && !washRef.current) {
            remember();
            const done = box.dataset.box !== "1";
            box.dataset.box = done ? "1" : "0";
            box.textContent = done ? "☑" : "☐";
            box.classList.toggle("is-done", done);
            changed();
            return;
          }
          // A plain tap (phones fire this reliably, even when the finger wobbles a little).
          if (!washRef.current) return;
          if (down.current.handled) {
            down.current.handled = false;
            return;
          }
          markAt(event);
        }}
        onPaste={(event) => {
          event.preventDefault();
          // Pasted lines that were only wrapped join with a space; blank lines stay as breaks.
          const text = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n").replace(/([^\n])\n(?!\n)/g, "$1 ");
          const root = editor.current;
          if (!text || !root) return;
          if (!penRef.current) {
            document.execCommand("insertText", false, text);
            return;
          }
          writePen(root, penRef.current, text);
          setDirty((count) => count + 1);
        }}
      />
    </div>
  );
}
