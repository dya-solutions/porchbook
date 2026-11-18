import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  BookOpen,
  ChevronDown,
  ClipboardPaste,
  Copy,
  Heading,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Mic,
  PenLine,
  AlignJustify,
  Plus,
  Redo2,
  Smile,
  SquareCheck,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import { NOTE_FONTS, type NoteFont } from "@/lib/porch/note-font";
import type { Fmt } from "@/lib/porch/note-markup";
import { useBackLayer } from "@/lib/porch/back-stack";
import { VersePicker } from "@/components/porch/verse-picker";

/**
 * The notebook's toolbar: one slim bar just above the keyboard.
 * Pen · Tick box · Paragraph · Style · Highlight · Size · Undo · Add.
 */

export type BarApi = {
  pens: { id: string | null; label: string; color: string }[];
  penOn: string | null;
  pickPen: (id: string | null) => void;
  marks: { id: string; label: string; color: string }[];
  washOn: string | null;
  chooseWash: (tool: string) => void;
  font: NoteFont;
  fontNames: Record<NoteFont, string>;
  size: number;
  chooseFont: (font: NoteFont, size?: number) => void;
  fmtOn: Set<Fmt>;
  style: (code: Fmt) => void;
  list: (kind: "bullet" | "number" | "box") => void;
  line: (code: "h" | "c" | "e" | "l") => void;
  lineCodes: string;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  insertText: (text: string) => void;
  insertVerse: (text: string) => void;
  /** Start the live transcriber (it listens to the preacher and writes into the note). */
  transcribe?: () => void;
  /** Copy the whole note as text (to paste into WhatsApp, an SMS or another app). */
  copyNote?: () => void;
  stopWash: () => void;
  keepCaret: () => void;
};

export const SIZE_LABELS = [14, 16, 18, 20, 22];

type Tray = "pen" | "para" | "style" | "mark" | "size" | "add" | "emoji" | "verse" | null;

const EMOJIS = [
  "🙏", "✝️", "📖", "🕊️", "⛪", "🔥", "❤️", "🙌", "✨", "👑", "🎶", "🕯️", "🌿", "💧", "🌅", "⭐",
  "😊", "😀", "😂", "🥰", "😍", "🤗", "😇", "🙂", "😉", "😎", "🤔", "😢", "😭", "😮", "😴", "🥳",
  "👍", "👏", "💪", "🤝", "👋", "✌️", "👌", "☝️", "🫶", "💯", "✅", "❗", "❓", "📌", "📝", "📅",
  "💡", "🎁", "🎉", "🌸", "🌻", "🌍", "☀️", "🌙", "⚡", "🌈", "🍞", "🍇", "🐑", "🦁", "🏠", "🚌",
];

function Key({ on, label, onPress, children, className = "" }: { on?: boolean; label: string; onPress: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      className={`nb-key${on ? " is-on" : ""} ${className}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

export function NoteBar({ api }: { api: BarApi }) {
  const [tray, setTray] = useState<Tray>(null);
  const [note, setNote] = useState("");
  const holdRef = useRef(0);
  const heldRef = useRef(false);

  // Back closes whatever is open on the bar (emojis, verse, sizes…) before leaving the note,
  // and turns the highlighter off.
  useBackLayer(Boolean(tray), () => setTray(null), "note:tray");
  useBackLayer(Boolean(api.washOn) && !tray, api.stopWash, "note:wash");

  // Keep the bar just above the phone's keyboard.
  const [lift, setLift] = useState(0);
  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    const fit = () => setLift(Math.max(0, window.innerHeight - view.height - view.offsetTop));
    fit();
    view.addEventListener("resize", fit);
    view.addEventListener("scroll", fit);
    return () => {
      view.removeEventListener("resize", fit);
      view.removeEventListener("scroll", fit);
    };
  }, []);

  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(""), 3500);
    return () => window.clearTimeout(timer);
  }, [note]);

  function open(next: Tray) {
    api.keepCaret();
    setNote("");
    setTray((current) => (current === next ? null : next));
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        setNote("Nothing copied yet.");
        return;
      }
      api.insertText(text);
      setTray(null);
    } catch {
      setNote("Press and hold in the note, then tap Paste.");
    }
  }

  const inkNow = api.washOn ? api.marks.find((item) => item.id === api.washOn)?.color : api.pens.find((item) => item.id === api.penOn)?.color;
  const align = api.lineCodes.includes("c") ? "c" : api.lineCodes.includes("e") ? "e" : "l";

  return (
    <div className="nb-bar-wrap" style={{ bottom: lift }}>
      {tray ? (
        <div className="nb-pop" role="toolbar">
          {tray === "pen" ? (
            api.pens.map((item) => (
              <button
                key={item.label}
                type="button"
                aria-label={item.label}
                aria-pressed={api.penOn === item.id && !api.washOn}
                className={`nb-ink ${api.penOn === item.id && !api.washOn ? "is-on" : ""}`}
                style={{ backgroundColor: item.color }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  api.pickPen(item.id);
                  setTray(null);
                }}
              />
            ))
          ) : null}
          {tray === "para" ? (
            <>
              <Key label="Bullets" onPress={() => api.list("bullet")}>
                <List />
              </Key>
              <Key label="Numbers" onPress={() => api.list("number")}>
                <ListOrdered />
              </Key>
              <Key label="Heading" on={api.lineCodes.includes("h")} onPress={() => api.line("h")}>
                <Heading />
              </Key>
              <span className="nb-tray-gap" />
              <Key label="Left" on={align === "l"} onPress={() => api.line("l")}>
                <AlignLeft />
              </Key>
              <Key label="Centre" on={align === "c"} onPress={() => api.line("c")}>
                <AlignCenter />
              </Key>
              <Key label="Right" on={align === "e"} onPress={() => api.line("e")}>
                <AlignRight />
              </Key>
            </>
          ) : null}
          {tray === "style" ? (
            <>
              <Key label="Bold" on={api.fmtOn.has("b")} onPress={() => api.style("b")}>
                <Bold />
              </Key>
              <Key label="Italic" on={api.fmtOn.has("i")} onPress={() => api.style("i")}>
                <Italic />
              </Key>
              <Key label="Underline" on={api.fmtOn.has("u")} onPress={() => api.style("u")}>
                <Underline />
              </Key>
              <Key label="Strike through" on={api.fmtOn.has("s")} onPress={() => api.style("s")}>
                <Strikethrough />
              </Key>
            </>
          ) : null}
          {tray === "mark" ? (
            <>
              {api.marks.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  aria-label={item.label}
                  aria-pressed={api.washOn === item.id}
                  className={`nb-mark ${api.washOn === item.id ? "is-on" : ""}`}
                  style={{ backgroundColor: item.color }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    api.chooseWash(item.id);
                    setTray(null);
                  }}
                />
              ))}
              <button
                type="button"
                aria-label="Remove a highlight"
                aria-pressed={api.washOn === "erase"}
                className={`nb-erase ${api.washOn === "erase" ? "is-on" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  api.chooseWash("erase");
                  setTray(null);
                }}
              >
                ⌫
              </button>
              <span className="nb-pop-hint">Tap words to highlight</span>
            </>
          ) : null}
          {tray === "size" ? (
            <div className="nb-pop-col">
              <div className="nb-pop-row">
                {SIZE_LABELS.map((label, index) => (
                  <button
                    key={label}
                    type="button"
                    className={`nb-size-pick${api.size === index + 1 ? " is-on" : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => api.chooseFont(api.font, index + 1)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="nb-pop-row">
                {NOTE_FONTS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-label={`${api.fontNames[item]} font`}
                    aria-pressed={api.font === item}
                    className={`nb-font nf-${item}${api.font === item ? " is-on" : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => api.chooseFont(item)}
                  >
                    Aa
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {tray === "add" ? (
            <>
              <Key label="Emoji" className="has-word" onPress={() => setTray("emoji")}>
                <Smile />
                <small>Emoji</small>
              </Key>
              <Key label="Bible verse" className="has-word" onPress={() => setTray("verse")}>
                <BookOpen />
                <small>Verse</small>
              </Key>
              <Key label="Paste" className="has-word" onPress={() => void paste()}>
                <ClipboardPaste />
                <small>Paste</small>
              </Key>
              {api.copyNote ? (
                <Key
                  label="Copy note"
                  className="has-word"
                  onPress={() => {
                    setTray(null);
                    api.copyNote?.();
                  }}
                >
                  <Copy />
                  <small>Copy note</small>
                </Key>
              ) : null}
              {api.transcribe ? (
                <Key
                  label="Transcribe"
                  className="has-word"
                  onPress={() => {
                    setTray(null);
                    api.transcribe?.();
                  }}
                >
                  <Mic />
                  <small>Transcribe</small>
                </Key>
              ) : null}
            </>
          ) : null}
          {tray === "emoji" ? (
            <div className="nb-emojis">
              {EMOJIS.map((emoji) => (
                <button key={emoji} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => api.insertText(emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
          {tray === "verse" ? (
            <VersePicker
              onAdd={(text) => {
                api.insertVerse(text);
                setTray(null);
              }}
            />
          ) : null}
          {note ? <p className="nb-pop-note">{note}</p> : null}
        </div>
      ) : note ? (
        <p className="nb-pop-note is-alone">{note}</p>
      ) : api.washOn ? (
        <button type="button" className="nb-wash-chip" onMouseDown={(event) => event.preventDefault()} onClick={api.stopWash}>
          <span>{api.washOn === "erase" ? "Eraser on: tap a highlight" : "Highlighter on: tap words"}</span>
          <b>✓ Back to writing</b>
        </button>
      ) : null}
      <div className="nb-bar" role="toolbar" aria-label="Note tools">
        <Key label="Pens" on={tray === "pen"} onPress={() => open("pen")} className="is-pen">
          <PenLine />
          <i style={{ backgroundColor: api.washOn ? "#2c2416" : (inkNow ?? "#2c2416") }} />
        </Key>
        <Key label="Tick box" onPress={() => api.list("box")}>
          <SquareCheck />
        </Key>
        <Key label="Paragraph" on={tray === "para"} onPress={() => open("para")}>
          <AlignJustify />
        </Key>
        <Key label="Style" on={tray === "style" || api.fmtOn.size > 0} onPress={() => open("style")}>
          <Bold />
        </Key>
        <Key label="Highlight" on={tray === "mark" || Boolean(api.washOn)} onPress={() => open("mark")}>
          <Highlighter />
        </Key>
        <Key label="Size and font" on={tray === "size"} onPress={() => open("size")} className="is-size">
          {SIZE_LABELS[api.size - 1] ?? 18}
          <ChevronDown />
        </Key>
        <button
          type="button"
          aria-label="Undo (hold to redo)"
          className="nb-key"
          disabled={!api.canUndo && !api.canRedo}
          onMouseDown={(event) => event.preventDefault()}
          onPointerDown={() => {
            heldRef.current = false;
            window.clearTimeout(holdRef.current);
            holdRef.current = window.setTimeout(() => {
              heldRef.current = true;
              api.redo();
              navigator.vibrate?.(20);
            }, 500);
          }}
          onPointerUp={() => window.clearTimeout(holdRef.current)}
          onPointerLeave={() => window.clearTimeout(holdRef.current)}
          onContextMenu={(event) => event.preventDefault()}
          onClick={() => {
            if (heldRef.current) {
              heldRef.current = false;
              return;
            }
            if (!api.canUndo && api.canRedo) api.redo();
            else api.undo();
          }}
        >
          {api.canUndo || !api.canRedo ? <Undo2 /> : <Redo2 />}
        </button>
        <Key label="Add" on={tray === "add" || tray === "emoji" || tray === "verse"} onPress={() => open("add")} className="is-add">
          <Plus />
        </Key>
      </div>
    </div>
  );
}
