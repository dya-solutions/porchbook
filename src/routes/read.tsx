import { fromText, toMarks, type Incoming } from "@/lib/porch/notes-import";
import { SharedNoteCard } from "@/components/porch/notes-import";
import { plainOfMarks } from "@/lib/porch/note-markup";
import { placePart, takePart } from "@/lib/porch/place";
import { useBackLayer } from "@/lib/porch/back-stack";
import { createContext, lazy, Suspense, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, Maximize2, SquareCheck, Trash2 } from "lucide-react";
import { getBearerToken } from "@/lib/auth/client";
import { AppFrame } from "@/components/porch/frame";
import { fieldClass, primaryButtonClass } from "@/components/porch/bits";
import { ShelfFace, useShelfPhoto } from "@/components/porch/shelf";
import { useCovers } from "@/components/porch/covers";
import type { Fly } from "@/lib/porch/covers";
import { BookHide } from "@/components/porch/hide";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { DevotionRead } from "@/components/porch/devotion-read";
import { StudyTrio, type StudyPlace } from "@/components/porch/study-trio";
import { DevotionListen } from "@/components/porch/devotion-listen";
import { fetchDevotionPage, refreshDevotion, storedDevotion, keptDays, dayLabel } from "@/lib/porch/devotion-cache";
import { LibraryBook } from "@/components/porch/library-book";
import { PdfScroll } from "@/components/porch/pdf-scroll";
import { useItemSizes, type ItemSize } from "@/lib/porch/item-sizes";
import { readBookMeta, readLibrary, type BookMeta, type LibraryPages } from "@/lib/porch/pdf-book";
import { addReadBook, renameReadBook, dropReadBooks, loadReadDoc, loadReadShelf, saveReadDoc, type NoteCard, type ReadBook } from "@/lib/porch/read";
import { BookDownload } from "@/components/porch/book-download";
import { keptDoc } from "@/lib/porch/offline-books";
import { NOTES_SYNCED, noteOpen, noteSave, notesList, waitingCount, watchNotesSync } from "@/lib/porch/notes-offline";
import shelfWood from "@/assets/shelf-wood.jpg";
import bibleLeather from "@/assets/bible-leather.jpg";
import bookHide from "@/assets/book-hide.jpg";
import { PorchLoader } from "@/components/porch/porch-loader";

const BibleReader = lazy(() => import("@/components/porch/bible-reader").then((mod) => ({ default: mod.BibleReader })));
const NotebookList = lazy(() => import("@/components/porch/notebook-page").then((mod) => ({ default: mod.NotebookList })));
const NotebookPage = lazy(() => import("@/components/porch/notebook-page").then((mod) => ({ default: mod.NotebookPage })));
const ReportBook = lazy(() => import("@/components/porch/report-book").then((mod) => ({ default: mod.ReportBook })));

export const Route = createFileRoute("/read")({
  // Fetch the shelf pictures first so the shelf appears complete at once.
  head: () => ({
    links: [
      { rel: "preload", as: "image", href: shelfWood },
      { rel: "preload", as: "image", href: bibleLeather },
      { rel: "preload", as: "image", href: bookHide },
    ],
  }),
  component: ReadPage,
});

type BookSize = { w: number; h: number };

/**
 * A book's butterfly. Normally in its corner; the founder can drag it anywhere on the cover,
 * resize it or hide it (Butterflies mode), and everyone sees it there.
 */
function CoverFly({ size, corner = "", optional = false, fly, editing, selected, onSelect, onPlace }: { size: number; corner?: string; optional?: boolean; fly?: Fly; editing: boolean; selected: boolean; onSelect: () => void; onPlace: (spot: { x: number; y: number }) => void }) {
  const [live, setLive] = useState<{ x: number; y: number } | null>(null);
  if (optional && !fly && !editing) return null;
  if (fly?.hidden && !editing) return null;
  const spot = live ?? (fly ? { x: fly.x, y: fly.y } : optional ? { x: 50, y: 80 } : null);
  const w = size * (fly?.s ?? 1);
  const style: CSSProperties = spot
    ? { left: `calc(${spot.x}% - ${w / 2}rem)`, top: `calc(${spot.y}% - ${w / 2}rem)`, right: "auto", bottom: "auto", width: `${w}rem`, height: `${w}rem` }
    : { width: `${w}rem`, height: `${w}rem` };
  function down(event: ReactPointerEvent<HTMLSpanElement>) {
    if (!editing) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    const face = event.currentTarget.parentElement;
    if (!face) return;
    const box = face.getBoundingClientRect();
    const at = (pointer: { clientX: number; clientY: number }) => ({
      x: Math.round(Math.min(100, Math.max(0, ((pointer.clientX - box.left) / box.width) * 100)) * 10) / 10,
      y: Math.round(Math.min(100, Math.max(0, ((pointer.clientY - box.top) / box.height) * 100)) * 10) / 10,
    });
    let last = at(event);
    let moved = false;
    const move = (pointer: PointerEvent) => {
      moved = true;
      last = at(pointer);
      setLive(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) onPlace(last);
      setLive(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  return (
    <span
      className={`butterfly butterfly-still absolute z-10 ${spot ? "" : corner} ${editing ? "fly-edit" : ""} ${selected ? "is-picked" : ""} ${fly?.hidden ? "fly-hidden" : ""}`}
      style={style}
      onPointerDown={down}
      onClick={
        editing
          ? (event) => {
              event.stopPropagation();
              onSelect();
            }
          : undefined
      }
    >
      <img src="/wing-left.png?v=5" alt="" className="butterfly-wing butterfly-left" />
      <img src="/wing-right.png?v=5" alt="" className="butterfly-wing butterfly-right" />
    </span>
  );
}
/** Moving book titles (founder): each title's spot, size and hidden state, kept like the butterflies. */
type TitleTools = { mode: boolean; of: (key: string) => Fly | undefined; picked: string; select: (key: string) => void; place: (key: string, spot: { x: number; y: number }) => void };
const TitleCtx = createContext<TitleTools>({ mode: false, of: () => undefined, picked: "", select: () => undefined, place: () => undefined });

/** A book's title on its cover: where it always was, unless the founder moved, resized or hid it. */
function CoverWords({ bookKey, className, children }: { bookKey: string; className: string; children: ReactNode }) {
  const tools = useContext(TitleCtx);
  const [live, setLive] = useState<{ x: number; y: number } | null>(null);
  const saved = bookKey ? tools.of(bookKey) : undefined;
  const editing = tools.mode && Boolean(bookKey);
  if (saved?.hidden && !editing) return null;
  const spot = live ?? (saved ? { x: saved.x, y: saved.y } : null);
  const style: CSSProperties = spot
    ? { left: `${spot.x}%`, top: `${spot.y}%`, right: "auto", bottom: "auto", translate: "-50% -50%", width: "max-content", maxWidth: "92%" }
    : {};
  if (saved && saved.s !== 1) style.scale = String(saved.s);
  function down(event: ReactPointerEvent<HTMLSpanElement>) {
    if (!editing) return;
    event.preventDefault();
    event.stopPropagation();
    tools.select(bookKey);
    const face = event.currentTarget.parentElement;
    if (!face) return;
    const box = face.getBoundingClientRect();
    const at = (pointer: { clientX: number; clientY: number }) => ({
      x: Math.round(Math.min(100, Math.max(0, ((pointer.clientX - box.left) / box.width) * 100)) * 10) / 10,
      y: Math.round(Math.min(100, Math.max(0, ((pointer.clientY - box.top) / box.height) * 100)) * 10) / 10,
    });
    let last = at(event);
    let moved = false;
    const move = (pointer: PointerEvent) => {
      moved = true;
      last = at(pointer);
      setLive(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) tools.place(bookKey, last);
      setLive(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  return (
    <span
      className={`${className}${editing ? " title-edit" : ""}${editing && tools.picked === bookKey ? " is-picked" : ""}${saved?.hidden ? " title-hidden" : ""}`}
      style={style}
      onPointerDown={down}
      onClick={
        editing
          ? (event) => {
              event.stopPropagation();
              tools.select(bookKey);
            }
          : undefined
      }
    >
      {children}
    </span>
  );
}

function ShelfBook({ bookKey = "", title, bible, picked, onClick, size, adjusting, onSize, onReset, cover, coverMode, onCoverReset, onCoverFile, fly, flyMode = false, flySelected = false, onFlySelect = () => undefined, onFlyPlace = () => undefined }: { bookKey?: string; title: string; bible?: boolean; picked?: boolean; onClick: () => void; size?: BookSize; adjusting?: boolean; onSize?: (size: BookSize) => void; onReset?: () => void; cover?: CSSProperties; coverMode?: boolean; onCoverReset?: () => void; onCoverFile?: (file: File) => void; fly?: Fly; flyMode?: boolean; flySelected?: boolean; onFlySelect?: () => void; onFlyPlace?: (spot: { x: number; y: number }) => void }) {
  const notebook = !bible && title === "Notebook";
  const ring = picked ? "ring-2 ring-red-600" : "";
  function drag(event: ReactPointerEvent<HTMLElement>, edge: "h" | "w" | "both") {
    event.preventDefault();
    event.stopPropagation();
    const book = event.currentTarget.parentElement;
    const row = book?.parentElement;
    if (!book || !row || !onSize) return;
    const rowBox = row.getBoundingClientRect();
    const bookBox = book.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const base = {
      w: (bookBox.width / rowBox.width) * 100,
      h: (bookBox.height / rowBox.height) * 100,
    };
    const move = (pointer: PointerEvent) => {
      const next = { ...base };
      if (edge !== "w") next.h = Math.min(100, Math.max(20, base.h + ((startY - pointer.clientY) / rowBox.height) * 100));
      if (edge !== "h") next.w = Math.min(100, Math.max(4, base.w + ((pointer.clientX - startX) / rowBox.width) * 100));
      onSize({ w: Math.round(next.w * 10) / 10, h: Math.round(next.h * 10) / 10 });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }
  // In covers mode each book shows 🎨 (tap to choose a cover photo) and ↺ when it has one.
  // The whole book (and its 🎨) is a photo picker: a real file input under the finger works on every phone.
  const coverKeys = coverMode ? (
    <>
      <label className="cover-pick" aria-label={`Choose a cover for ${title}`} onClick={(event) => event.stopPropagation()}>
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onCoverFile?.(file);
          }}
        />
        <span aria-hidden="true" className="cover-mark">🎨</span>
      </label>
      {onCoverReset ? (
        <span
          role="button"
          aria-label={`Put back the original ${title} cover`}
          className="cover-reset"
          onClick={(event) => {
            event.stopPropagation();
            onCoverReset();
          }}
        >
          ↺
        </span>
      ) : null}
    </>
  ) : null;
  const sized = size ? { height: `${size.h}%`, width: `${size.w}%`, aspectRatio: "auto", flex: "0 0 auto" } : null;
  const handles = adjusting ? (
    <>
      <span className="book-size book-size-top" onPointerDown={(event) => drag(event, "h")} onClick={(event) => event.stopPropagation()} />
      <span className="book-size book-size-side" onPointerDown={(event) => drag(event, "w")} onClick={(event) => event.stopPropagation()} />
      <span className="book-size book-size-corner" onPointerDown={(event) => drag(event, "both")} onClick={(event) => event.stopPropagation()} />
      {size && onReset ? (
        <span
          role="button"
          aria-label={`Reset ${title} size`}
          className="book-size-reset"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onReset();
          }}
        >
          ↺
        </span>
      ) : null}
    </>
  ) : null;
  if (!bible && !notebook) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`book3d-host no-sink relative flex h-[92%] shrink-0 ${ring}`}
        style={{ aspectRatio: "6 / 9", ...sized }}
      >
        {handles}
        {coverKeys}
        <span className="book3d">
        <BookHide className="book-face-front flex min-w-0 flex-col items-center justify-center overflow-hidden rounded-[2px] px-2" style={cover}>
          {/* Bound edge, like the Bible's, instead of a separate labelled spine. */}
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/70 via-white/15 to-black/40" />
          <CoverFly size={1.25} corner="right-1.5 bottom-1.5" fly={fly} editing={flyMode} selected={flySelected} onSelect={onFlySelect} onPlace={onFlyPlace} />
          <CoverWords bookKey={bookKey} className="book-title absolute top-1.5 right-1 left-1 text-center text-xs leading-tight break-words">
            {title}
          </CoverWords>
        </BookHide>
        </span>
      </button>
    );
  }

  if (notebook) {
    // A black hardcover notebook: orange elastic band, a strip of small
    // butterflies behind it, cream page edges, and just "My Notes".
    return (
      <button type="button" onClick={onClick} className={`book3d-host no-sink relative h-[90%] shrink-0 ${ring}`} style={{ width: "4.2rem", ...sized }}>
        {handles}
        {coverKeys}
        <span className="bible-stand book3d">
          <span className={`book-face-front notebook-cover overflow-hidden${cover?.backgroundImage ? " is-photo" : ""}`} style={cover}>
            {/* With the founder's own cover photo, only the photo and "My Notes" show (no drawn band or strip). */}
            {cover?.backgroundImage ? null : (
              <>
                <span className="notebook-strip" aria-hidden="true" />
                <span className="notebook-band" aria-hidden="true" />
              </>
            )}
            <CoverWords bookKey={bookKey} className="notebook-words">
              My Notes
            </CoverWords>
            <CoverFly size={1} optional fly={fly} editing={flyMode} selected={flySelected} onSelect={onFlySelect} onPlace={onFlyPlace} />
          </span>
        </span>
      </button>
    );
  }

  return (
    <button type="button" onClick={onClick} className={`book3d-host no-sink relative shrink-0 ${ring} ${bible ? "h-full" : "h-[90%]"}`} style={{ width: bible ? "6rem" : "4.2rem", ...sized }}>
      {handles}
      {coverKeys}
      <span className="bible-stand book3d">
        <span
          className={`book-face-front flex flex-col items-center justify-center overflow-hidden rounded-[2px] px-1 ${notebook ? "book-hide" : ""}`}
          style={{
            backgroundImage: bible ? `url(${bibleLeather})` : undefined,
            backgroundColor: bible ? "#141414" : undefined,
            backgroundSize: "cover",
            boxShadow: "inset 6px 0 8px rgba(0,0,0,0.28), 3px 6px 6px rgba(0,0,0,0.38)",
            ...cover,
          }}
        >
          <span className="absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/70 via-white/15 to-black/40" />
          <CoverFly size={1} corner="right-1 bottom-1" fly={fly} editing={flyMode} selected={flySelected} onSelect={onFlySelect} onPlace={onFlyPlace} />
          {bible ? (
            <CoverWords bookKey={bookKey} className="book-title absolute inset-x-1 top-1/2 z-10 -translate-y-1/2 text-center font-serif text-[10px] leading-tight">
              HOLY BIBLE
            </CoverWords>
          ) : null}
          {notebook ? <span className="book-title absolute top-1.5 right-0.5 left-1.5 z-10 text-center text-[10px] leading-tight tracking-tight whitespace-nowrap">{title}</span> : null}
        </span>
      </span>
    </button>
  );
}

function Opening({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="pc-book fixed inset-0 z-[80] flex flex-col bg-[#f3e6c8] text-[#8a5a12]">
      <button type="button" className="flex min-h-12 items-center gap-1 px-3 text-base font-semibold" onClick={onBack}>
        <ChevronLeft className="size-5" aria-hidden="true" />
        Back to the library
      </button>
      <PorchLoader className="is-card" label={label.replace(/…$/, "")} />
    </div>
  );
}

function BookShelf({
  books,
  picking,
  chosen,
  standing,
  adjusting,
  sizes,
  onOpen,
  onChoose,
  onKeep,
  onSize,
  onReset,
  coverMode,
  onRenamePick,
  renamePicked = "",
  flyMode,
  flyOf,
  flyPicked,
  onFlySelect,
  onFlyPlace,
  coverOf,
  hasCover,
  onCoverFile,
  onCoverReset,
}: {
  coverMode: boolean;
  onRenamePick?: (key: string) => void;
  renamePicked?: string;
  flyMode: boolean;
  flyOf: (key: string) => Fly | undefined;
  flyPicked: string;
  onFlySelect: (key: string) => void;
  onFlyPlace: (key: string, spot: { x: number; y: number }) => void;
  coverOf: (key: string) => CSSProperties | undefined;
  hasCover: (key: string) => boolean;
  onCoverFile: (key: string, file: File) => void;
  onCoverReset: (key: string) => void;
  books: ReadBook[];
  picking: boolean;
  chosen: string[];
  standing: Set<string>;
  adjusting: boolean;
  sizes: Record<string, BookSize>;
  onOpen: (key: string) => void;
  onChoose: (update: (current: string[]) => string[]) => void;
  onKeep: () => void;
  onSize: (key: string, size: BookSize) => void;
  onReset: (key: string) => void;
}) {
  const titleTools = useContext(TitleCtx);
  return (
    <div className="shelf-bay mt-4">
      <ShelfFace />
      <div className="shelf-row">
        <div className="shelf-roll flex h-full items-end gap-3 px-2">
          {books.map((book) => {
            return (
            <ShelfBook
              key={book.key}
              bookKey={book.key}
              title={book.title}
              bible={book.key === "bible"}
              picked={chosen.includes(book.key) || renamePicked === book.key}
              size={sizes[book.key]}
              adjusting={adjusting}
              onSize={(size) => onSize(book.key, size)}
              onReset={sizes[book.key] ? () => onReset(book.key) : undefined}
              cover={coverOf(book.key)}
              coverMode={coverMode}
              onCoverReset={coverMode && hasCover(book.key) ? () => onCoverReset(book.key) : undefined}
              onCoverFile={(file) => onCoverFile(book.key, file)}
              fly={flyOf(book.key)}
              flyMode={flyMode}
              flySelected={flyMode && flyPicked === book.key}
              onFlySelect={() => onFlySelect(book.key)}
              onFlyPlace={(spot) => onFlyPlace(book.key, spot)}
              onClick={() => {
                if (onRenamePick) {
                  onRenamePick(book.key);
                  return;
                }
                if (coverMode) return;
                if (flyMode) {
                  onFlySelect(book.key);
                  return;
                }
                if (titleTools.mode) {
                  titleTools.select(book.key);
                  return;
                }
                if (adjusting) return;
                if (!picking) {
                  onOpen(book.key);
                  return;
                }
                if (standing.has(book.key)) {
                  onKeep();
                  return;
                }
                onChoose((current) => (current.includes(book.key) ? current.filter((key) => key !== book.key) : [...current, book.key]));
              }}
            />
            );
          })}
        </div>
      </div>
    </div>
  );
}

const standingBooks: ReadBook[] = [
  { key: "bible", title: "Bible", link: "", hasPdf: false },
  { key: "devotion", title: "Devotional", link: "", hasPdf: false },
];

function ReadPage() {
  const { user } = useCurrentUserState();
  const [books, setBooks] = useState<ReadBook[]>(standingBooks);
  const [founder, setFounder] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // On a laptop the open book sits beside the shelf.
  useEffect(() => {
    document.body.classList.toggle("pc-reading", Boolean(open));
    return () => document.body.classList.remove("pc-reading");
  }, [open]);
  const [pdfVersion, setPdfVersion] = useState(0);
  const [pages, setPages] = useState<string[]>([""]);
  const [canEdit, setCanEdit] = useState(false);
  const [link, setLink] = useState("");
  const [changeLink, setChangeLink] = useState(false);
  const [title, setTitle] = useState("");
  const [noteId, setNoteId] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteSubtitle, setNoteSubtitle] = useState("");
  const [notePhaneroo, setNotePhaneroo] = useState("");
  const [noteKind, setNoteKind] = useState<"personal" | "office">("personal");
  const [notes, setNotes] = useState<NoteCard[]>([]);
  // Notes saved on the phone without data, waiting to upload.
  const [waitingNotes, setWaitingNotes] = useState(0);
  // An earlier devotional kept on the phone ("" = today's).
  const [pastDay, setPastDay] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [notePageKey, setNotePageKey] = useState(0); // a fresh page per note opened (not when a new note is first saved)
  const [edited, setEdited] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [sheets, setSheets] = useState<{ name: string; html: string }[] | null>(null);
  const [bookPages, setBookPages] = useState<LibraryPages | null>(null);
  const [bookMeta, setBookMeta] = useState<BookMeta>({ author: "", summary: "", cover: "" });
  const [scan, setScan] = useState("");
  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };

  // Notes saved without data upload by themselves when it returns.
  useEffect(() => watchNotesSync(), []);
  useEffect(() => {
    setWaitingNotes(waitingCount());
    const synced = (event: Event) => {
      const renamed = (event as CustomEvent<{ renamed: Record<string, string> }>).detail?.renamed ?? {};
      setNoteId((id) => renamed[id] ?? id);
      setWaitingNotes(waitingCount());
      setNote((now) => (now === "Saved on this phone · will sync" ? "✓ Synced" : now));
      if (open === "notebook") void notesList(seed).then((listed) => listed && setNotes(listed.notes));
    };
    window.addEventListener(NOTES_SYNCED, synced);
    return () => window.removeEventListener(NOTES_SYNCED, synced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function reload() {
    return loadReadShelf({ data: seed }).then((result) => {
      setFounder(result.isFounder);
      setBooks(result.books);
      try {
        sessionStorage.setItem("porch-read-shelf", JSON.stringify(result.books));
        localStorage.setItem("porch-read-shelf", JSON.stringify(result.books)); // the shelf without data too
      } catch {
        /* the shelf still shows */
      }
    });
  }

  useEffect(() => {
    if (open !== "devotion" || !link) return;
    const kept = storedDevotion();
    if (kept && kept.link === link) {
      setSheets([{ name: "English", html: kept.html }]);
      return;
    }
    let cancel = false;
    fetchDevotionPage(link)
      .then((fresh) => {
        if (!cancel) setSheets(fresh ? [{ name: "English", html: fresh.html }] : null);
      })
      .catch(() => {
        if (!cancel) setSheets(null);
      });
    return () => {
      cancel = true;
    };
  }, [open, link]);

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    try {
      const saved = JSON.parse(sessionStorage.getItem("porch-read-shelf") || localStorage.getItem("porch-read-shelf") || "null") as ReadBook[] | null;
      if (!cancel && Array.isArray(saved) && saved.some((book) => book.key === "bible")) setBooks(saved);
    } catch {
      /* the standing books stay */
    }
    reload().catch(() => {
      if (!cancel) setNote("Couldn't open Read.");
    });
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Back closes the open book (a note saves itself first, through its own back arrow).
  // Back, step by step: a note → the notebook's list → the shelf. (A note saves itself first,
  // through its own back arrow.) Switching between books keeps one step.
  useBackLayer(Boolean(open), () => setOpen(null), "read:book");
  useBackLayer(
    open === "note",
    () => {
      const own = document.querySelector<HTMLButtonElement>('[aria-label="Back to the notes"]');
      if (own) own.click();
      else setOpen("notebook");
    },
    "read:note",
  );

  // Refresh keeps your place: the open book or note comes back.
  const where = useRef({ open: null as string | null, noteId: "" });
  where.current = { open, noteId };
  useEffect(() => {
    const drop = placePart("read", () => (where.current.open ? { ...where.current } : null));
    const kept = takePart<{ open: string; noteId: string }>("read");
    // A link straight to today's devotional (the post box's slide): /read?open=devotion
    const asked = new URLSearchParams(window.location.search).get("open");
    if (asked === "devotion") {
      window.history.replaceState(null, "", window.location.pathname);
      void openBook("devotion");
    } else if (kept?.open === "note" && kept.noteId) void openNoteById(kept.noteId);
    else if (kept?.open) void openBook(kept.open);
    return drop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openBook(key: string) {
    if (key === "bible") {
      setOpen("bible");
      setNote("");
      return;
    }
    if (key === "notebook") {
      setOpen("notebook");
      setNote("");
      const listed = await notesList(seed).catch(() => null);
      if (listed) {
        setNotes(listed.notes);
        if (listed.offline) setNote("No data: showing the notes on this phone.");
      } else setNote("Couldn't open the notebook.");
      return;
    }
    if (key === "devotion") {
      setPastDay("");
      const kept = storedDevotion();
      if (kept) {
        // Instant: the copy kept on the phone. A quiet check follows.
        setLink(kept.link);
        setSheets([{ name: "English", html: kept.html }]);
        setChangeLink(false);
        setWaiting(false);
        setNote("");
        setOpen("devotion");
        void refreshDevotion(seed).then((fresh) => {
          if (fresh && (fresh.link !== kept.link || fresh.html !== kept.html)) {
            setLink(fresh.link);
            setSheets([{ name: "English", html: fresh.html }]);
          }
        });
        if (founder) {
          // The founder may need the edit controls, so still learn the saved link.
          void loadReadDoc({ data: { ...seed, key } }).then((result) => {
            if (result?.ok && result.link) setLink(result.link);
          });
        }
        return;
      }
    }
    setPages([""]);
    setCanEdit(false);
    setLink("");
    setBookPages(null);
    setBookMeta({ author: "", summary: "", cover: "" });
    setScan("");
    setWaiting(true);
    setOpen(key);
    setNote("");
    // A downloaded book opens from the phone when there's no data.
    const result = (await loadReadDoc({ data: { ...seed, key } }).catch(() => null)) ?? (key !== "devotion" ? await keptDoc(key) : null);
    setWaiting(false);
    if (!result?.ok) {
      setOpen(null);
      setNote(result?.error ?? (navigator.onLine === false ? "No data, and this book isn't downloaded." : "Couldn't open that book."));
      return;
    }
    if (key === "devotion") {
      if (!result.link && !founder) {
        setOpen(null);
        setNote("The devotional is not ready.");
        return;
      }
      setLink(result.link);
      setChangeLink(false);
      return;
    }
    setBookPages(result.library);
    setBookMeta(readBookMeta(result.body ?? ""));
    setScan(result.scan ?? "");
    setPages(result.library ? [""] : result.body ? result.body.split("\f").slice(0, 8) : [""]);
    setCanEdit(result.canEdit);
  }

  async function save(markup = noteBody) {
    if (!open) return;
    if (open === "note") {
      setBusy(true);
      setNote("");
      const result = await noteSave(seed, noteId, { title: noteTitle, subtitle: noteSubtitle, phaneroo: notePhaneroo, kind: noteKind, body: markup });
      setBusy(false);
      if (!result.ok) {
        setNote(result.error);
        return false;
      }
      setNoteBody(markup);
      setNoteId(result.id);
      setEdited(new Date().toISOString());
      setWaitingNotes(waitingCount());
      setNote(result.offline ? "Saved on this phone · will sync" : "Saved.");
      // Saved by itself while writing: keep quiet in the shelf note line.
      return true;
    }
    setBusy(true);
    setNote("");
    const result = await saveReadDoc({
      data: {
        ...seed,
        key: open,
        body: pages.join("\f").slice(0, 5200),
        link,
        title: "",
      },
    });
    setBusy(false);
    setNote(result.ok ? "Saved." : result.error);
    if (result.ok && open === "devotion") setChangeLink(false);
    return result.ok;
  }

  async function openNoteById(id: string) {
    const result = await noteOpen(seed, id).catch(() => null);
    if (!result || !result.ok) {
      setNote(result && !result.ok ? result.error : "Couldn't open the note.");
      return false;
    }
    setNoteId(id);
    setNoteTitle(result.title);
    setNoteSubtitle(result.subtitle);
    setNotePhaneroo(result.phaneroo);
    setNoteKind(result.kind === "office" ? "office" : "personal");
    setNoteBody(result.body);
    setEdited(result.updatedAt);
    setNote("");
    setNotePageKey((n) => n + 1);
    setOpen("note");
    return true;
  }

  /** Bible · Devotional · Notes strip: go straight to the other one (a note in progress is saved first). */
  async function switchTo(to: StudyPlace, markup?: string) {
    if (open === "note" && markup !== undefined) {
      const plain = plainOfMarks(markup);
      if ((noteTitle.trim() || noteSubtitle.trim() || notePhaneroo.trim() || plain) && !(await save(markup))) return;
    }
    if (to === "bible") {
      setNote("");
      setOpen("bible");
      return;
    }
    if (to === "devotion") {
      await openBook("devotion");
      return;
    }
    // Notes: back to the note you were last in, or the notebook.
    if (noteId && (await openNoteById(noteId))) return;
    await openBook("notebook");
  }

  /** Notes brought in from other notebooks: each saved as a new note, then the list refreshed. */
  async function importNotes(items: Incoming[], progress: (done: number) => void) {
    let added = 0;
    for (const item of items) {
      const result = await noteSave(seed, "", { title: item.title, subtitle: "", phaneroo: "", kind: "personal", body: item.body }).catch(() => null);
      if (result?.ok) added += 1;
      progress(added);
    }
    const listed = await notesList(seed).catch(() => null);
    if (listed) setNotes(listed.notes);
    setWaitingNotes(waitingCount());
    return added;
  }

  // Words shared to Porchbook from a notes app ("Share → Porchbook notes"): offered as a new note.
  const [shared, setShared] = useState<Incoming | null>(null);
  useEffect(() => {
    try {
      const raw = (window as unknown as { PorchApp?: { takeShared?: () => string } }).PorchApp?.takeShared?.() ?? "";
      if (!raw) return;
      const got = JSON.parse(raw) as { title?: string; text?: string };
      const note = got.title?.trim() ? { title: got.title.trim().slice(0, 80), body: toMarks(got.text ?? "") } : fromText(got.text ?? "");
      if (note) setShared(note);
    } catch {
      /* nothing shared */
    }
  }, []);
  async function addShared() {
    if (!shared) return;
    const one = shared;
    setShared(null);
    await importNotes([one], () => undefined);
    await openBook("notebook");
  }

  async function leaveNote(markup: string) {
    const plain = plainOfMarks(markup);
    if ((noteTitle.trim() || noteSubtitle.trim() || notePhaneroo.trim() || plain) && !(await save(markup))) return;
    const listed = await notesList(seed).catch(() => null);
    if (listed) setNotes(listed.notes);
    setOpen("notebook");
    setNote("");
  }

  async function add() {
    setBusy(true);
    setNote("");
    const result = await addReadBook({ data: { ...seed, title } });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setTitle("");
    await reload().catch(() => setNote("Couldn't open Read."));
  }

  async function uploadPdf(file: File | undefined) {
    if (!file || !open) return;
    const kind = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["pdf", "txt", "text", "docx", "epub"].includes(kind)) {
      setNote("Use a PDF, Word, EPUB, or text file.");
      return;
    }
    if (file.size > 8_000_000) {
      setNote("That file is too large.");
      return;
    }
    setBusy(true);
    setNote("");
    const body = new FormData();
    body.set("key", open);
    body.set("file", file);
    const token = getBearerToken();
    const response = await fetch("/api/read-pdf", {
      method: "POST",
      body,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as { ok?: boolean; error?: string; body?: string } | null;
    setBusy(false);
    if (!response?.ok || !result?.ok || !result.body) {
      setNote(result?.error ?? "Couldn't put that PDF in the book.");
      return;
    }
    const next = readLibrary(result.body);
    setBookPages(next);
    setBookMeta(readBookMeta(result.body));
    setScan("");
    setPdfVersion((value) => value + 1);
    setBooks((currentBooks) => currentBooks.map((book) => (book.key === open ? { ...book, hasPdf: kind === "pdf" } : book)));
    setNote("");
  }

  async function dropChosen() {
    if (!chosen.length) return;
    setBusy(true);
    setNote("");
    const result = await dropReadBooks({ data: { ...seed, keys: chosen } });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setBooks((current) => current.filter((book) => !chosen.includes(book.key)));
    setChosen([]);
    setPicking(false);
    setNote("Deleted.");
  }

  const standing = new Set(["bible", "notebook", "devotion"]);

  const shelf = books.filter((book) => book.key !== "notebook" && book.title !== "Notebook");
  const kept = [
    shelf.find((book) => book.key === "bible") ?? standingBooks[0],
    { key: "notebook", title: "Notebook", link: "", hasPdf: false },
    shelf.find((book) => book.key === "devotion") ?? standingBooks[1],
  ];
  const library = shelf.filter((book) => book.key !== "bible" && book.key !== "devotion");
  const current = [...kept, ...library].find((book) => book.key === open);
  useShelfPhoto();

  // Book covers: the founder picks a material photo for any book; everyone sees it.
  const covers = useCovers();
  const [coverMode, setCoverMode] = useState(false);
  const [flyMode, setFlyMode] = useState(false);
  const [renameMode, setRenameMode] = useState(false);
  const [renaming, setRenaming] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [renameNote, setRenameNote] = useState("");
  async function saveRename() {
    const title = renameDraft.trim();
    if (!renaming || !title) return;
    setRenameNote("Saving…");
    const result = await renameReadBook({ data: { ...seed, key: renaming, title } }).catch(() => null);
    if (!result?.ok) {
      setRenameNote(result?.error ?? "Couldn't rename that book.");
      return;
    }
    setBooks((current) => current.map((book) => (book.key === renaming ? { ...book, title: result.title } : book)));
    setRenameNote(`Renamed to “${result.title}”.`);
    setRenaming("");
    setRenameDraft("");
  }
  const [flyPicked, setFlyPicked] = useState("");
  const flySaving = useRef(0);
  const pickedFly = flyPicked ? covers.flyOf(flyPicked) : undefined;
  const flyBase = (key: string) => covers.flyOf(key) ?? { x: key === "notebook" ? 50 : 82, y: key === "notebook" ? 80 : 86, s: 1, hidden: false };
  const changeFly = (key: string, change: Partial<Fly>, wait = 0) => {
    const next = { ...flyBase(key), ...change };
    window.clearTimeout(flySaving.current);
    if (!wait) {
      void covers.placeFly(key, next).then(setCoverNote);
      return;
    }
    void covers.placeFly(key, next, false);
    flySaving.current = window.setTimeout(() => void covers.placeFly(key, next).then(setCoverNote), wait);
  };
  const [coverNote, setCoverNote] = useState("");
  // Book titles move like the butterflies (kept under "title:<book>").
  const [titleMode, setTitleMode] = useState(false);
  const [titlePicked, setTitlePicked] = useState("");
  const titleKey = (key: string) => `title:${key}`;
  const titleBase = (key: string): Fly => covers.flyOf(titleKey(key)) ?? { x: 50, y: key === "bible" ? 50 : 12, s: 1, hidden: false };
  const changeTitle = (key: string, change: Partial<Fly>, wait = 0) => {
    const next = { ...titleBase(key), ...change };
    window.clearTimeout(flySaving.current);
    if (!wait) {
      void covers.placeFly(titleKey(key), next).then(setCoverNote);
      return;
    }
    void covers.placeFly(titleKey(key), next, false);
    flySaving.current = window.setTimeout(() => void covers.placeFly(titleKey(key), next).then(setCoverNote), wait);
  };
  const pickedTitle = titlePicked ? covers.flyOf(titleKey(titlePicked)) : undefined;
  const titleTools: TitleTools = { mode: titleMode, of: (key) => covers.flyOf(titleKey(key)), picked: titlePicked, select: setTitlePicked, place: (key, spot) => changeTitle(key, spot) };

  // Book sizes are set by the founder and shared with everyone.
  const shelfSizes = useItemSizes("read-shelf", Boolean(user?.id));
  const sizes = shelfSizes.sizes;
  const keepSize = (key: string, size: ItemSize) => shelfSizes.resize(key, size);
  const resetSize = (key: string) => shelfSizes.reset(key);

  return (
    <AppFrame>
      <h1 className="font-display text-3xl text-ink">Read</h1>
      <p className="text-sm text-muted">The library.</p>
      {note && !open ? <p className="text-sm text-muted">{note}</p> : null}
      <TitleCtx.Provider value={titleTools}>
      <BookShelf onRenamePick={renameMode ? (key) => { if (key === "notebook") { setRenameNote("Notes keeps its name."); return; } const book = [...kept, ...library].find((item) => item.key === key); setRenaming(key); setRenameDraft(book?.title ?? ""); setRenameNote(""); } : undefined} renamePicked={renameMode ? renaming : ""} flyMode={flyMode} flyOf={covers.flyOf} flyPicked={flyPicked} onFlySelect={setFlyPicked} onFlyPlace={(key, spot) => changeFly(key, spot)} coverMode={coverMode} coverOf={covers.coverOf} hasCover={covers.hasCover} onCoverFile={(key, file) => { setCoverNote("Putting on the new cover…"); void covers.choose(key, file).then(setCoverNote); }} onCoverReset={(key) => void covers.reset(key).then(setCoverNote)} books={[...kept, ...library]} picking={picking} chosen={chosen} standing={standing} adjusting={adjusting} sizes={sizes} onOpen={(key) => void openBook(key)} onChoose={setChosen} onKeep={() => setNote("The Bible, the notebook, and the devotional stay.")} onSize={keepSize} onReset={resetSize} />
      </TitleCtx.Provider>
      {/* One shelf only: the books roll side to side. */}
      {shelfSizes.founder || founder ? (
        <div className="tools-panel">
          <p className="tools-title">Shelf tools</p>
          <div className="tools-row">
            {covers.founder ? (
              <button
                type="button"
                className={`tool-key${coverMode ? " is-on" : ""}`}
                aria-pressed={coverMode}
                onClick={() => {
                  setCoverMode((value) => !value);
                  setFlyMode(false);
                  setTitleMode(false);
                  setRenameMode(false);
                  setRenaming("");
                  setAdjusting(false);
                  setPicking(false);
                  setChosen([]);
                  setCoverNote("");
                }}
              >
                <span aria-hidden="true">🎨</span>
                {coverMode ? "Done" : "Covers"}
              </button>
            ) : null}
            {covers.founder ? (
              <button
                type="button"
                className={`tool-key${flyMode ? " is-on" : ""}`}
                aria-pressed={flyMode}
                onClick={() => {
                  setFlyMode((value) => !value);
                  setFlyPicked("");
                  setTitleMode(false);
                  setRenameMode(false);
                  setRenaming("");
                  setCoverMode(false);
                  setAdjusting(false);
                  setPicking(false);
                  setChosen([]);
                  setCoverNote("");
                }}
              >
                <span aria-hidden="true">🦋</span>
                {flyMode ? "Done" : "Butterflies"}
              </button>
            ) : null}
            {covers.founder ? (
              <button
                type="button"
                className={`tool-key${titleMode ? " is-on" : ""}`}
                aria-pressed={titleMode}
                onClick={() => {
                  setTitleMode((value) => !value);
                  setTitlePicked("");
                  setFlyMode(false);
                  setFlyPicked("");
                  setRenameMode(false);
                  setRenaming("");
                  setCoverMode(false);
                  setAdjusting(false);
                  setPicking(false);
                  setChosen([]);
                  setCoverNote("");
                }}
              >
                <span aria-hidden="true">🔤</span>
                {titleMode ? "Done" : "Titles"}
              </button>
            ) : null}
            {covers.founder ? (
              <button
                type="button"
                className={`tool-key${renameMode ? " is-on" : ""}`}
                aria-pressed={renameMode}
                onClick={() => {
                  setRenameMode((value) => !value);
                  setRenaming("");
                  setRenameDraft("");
                  setRenameNote("");
                  setCoverMode(false);
                  setFlyMode(false);
                  setTitleMode(false);
                  setAdjusting(false);
                  setPicking(false);
                  setChosen([]);
                }}
              >
                <span aria-hidden="true">✏️</span>
                {renameMode ? "Done" : "Rename"}
              </button>
            ) : null}
            {shelfSizes.founder ? (
              <button
                type="button"
                className={`tool-key${adjusting ? " is-on" : ""}`}
                aria-pressed={adjusting}
                onClick={() => {
                  setAdjusting((value) => !value);
                  setPicking(false);
                  setChosen([]);
                }}
              >
                <Maximize2 aria-hidden="true" />
                {adjusting ? "Done" : "Resize books"}
              </button>
            ) : null}
            {founder ? (
              <button
                type="button"
                className={`tool-key${picking ? " is-on" : ""}`}
                aria-pressed={picking}
                onClick={() => {
                  setPicking((value) => !value);
                  setChosen([]);
                  setNote("");
                  setAdjusting(false);
                }}
              >
                <SquareCheck aria-hidden="true" />
                {picking ? "Cancel" : "Select"}
              </button>
            ) : null}
            {founder && picking ? (
              <button type="button" className="tool-key is-danger" disabled={!chosen.length || busy} onClick={() => void dropChosen()}>
                <Trash2 aria-hidden="true" />
                Delete
              </button>
            ) : null}
          </div>
          {adjusting ? <p className="tools-hint">Drag an orange handle on any book: top for height, side for width, corner for both. ↺ puts a book back to its normal size. Everyone sees the sizes you set.</p> : null}
          {picking ? <p className="tools-hint">Tap a book, then Delete.</p> : null}
          {coverMode ? <p className="tools-hint">Tap any book and choose a photo of a material (leather, cloth, marble, gold…) for its cover. ↺ puts its original cover back. Everyone sees your covers.</p> : null}
          {renameMode && !renaming ? <p className="tools-hint">Tap the book you want to rename.{renameNote ? ` ${renameNote}` : ""}</p> : null}
          {renameMode && renaming ? (
            <form
              className="rename-tools"
              onSubmit={(event) => {
                event.preventDefault();
                void saveRename();
              }}
            >
              <input
                className="rename-input"
                value={renameDraft}
                maxLength={60}
                autoFocus
                aria-label="New name for the book"
                onChange={(event) => setRenameDraft(event.target.value)}
              />
              <button type="submit" className="tool-key is-on" disabled={!renameDraft.trim()}>
                Save
              </button>
              <button
                type="button"
                className="tool-key"
                onClick={() => {
                  setRenaming("");
                  setRenameNote("");
                }}
              >
                Cancel
              </button>
              {renameNote ? <p className="tools-hint rename-note">{renameNote}</p> : null}
            </form>
          ) : null}
          {flyMode ? <p className="tools-hint">Drag any book's butterfly to where you want it. Tap a book to change its butterfly's size or hide it. Everyone sees it.</p> : null}
          {flyMode && flyPicked ? (
            <div className="fly-tools">
              <span className="fly-tools-name">{[...kept, ...library].find((book) => book.key === flyPicked)?.title ?? "Book"}</span>
              <label className="fly-tools-size">
                Size
                <input
                  type="range"
                  min={0.5}
                  max={2.5}
                  step={0.05}
                  value={pickedFly?.s ?? 1}
                  onChange={(event) => changeFly(flyPicked, { s: Number(event.target.value) }, 600)}
                />
              </label>
              <button type="button" className="fly-tools-key" onClick={() => changeFly(flyPicked, { hidden: !(pickedFly?.hidden ?? false) })}>
                {pickedFly?.hidden ? "Show" : "Hide"}
              </button>
              <button type="button" className="fly-tools-key" aria-label="Put the butterfly back in its corner" onClick={() => void covers.placeFly(flyPicked, null).then(setCoverNote)}>
                ↺
              </button>
            </div>
          ) : null}
          {titleMode ? <p className="tools-hint">Drag any book's title to where you want it. Tap a book to change its title's size or hide it. Everyone sees it.</p> : null}
          {titleMode && titlePicked ? (
            <div className="fly-tools">
              <span className="fly-tools-name">{[...kept, ...library].find((book) => book.key === titlePicked)?.title ?? "Book"}</span>
              <label className="fly-tools-size">
                Size
                <input type="range" min={0.5} max={2.5} step={0.05} value={pickedTitle?.s ?? 1} onChange={(event) => changeTitle(titlePicked, { s: Number(event.target.value) }, 600)} />
              </label>
              <button type="button" className="fly-tools-key" onClick={() => changeTitle(titlePicked, { hidden: !(pickedTitle?.hidden ?? false) })}>
                {pickedTitle?.hidden ? "Show" : "Hide"}
              </button>
              <button type="button" className="fly-tools-key" aria-label="Put the title back where it was" onClick={() => void covers.placeFly(titleKey(titlePicked), null).then(setCoverNote)}>
                ↺
              </button>
            </div>
          ) : null}
          {coverNote ? <p className="tools-hint">{coverNote}</p> : null}
          {shelfSizes.error ? <p className="tools-hint text-danger">{shelfSizes.error}</p> : null}
          {founder ? (
            <form
              className="tools-add"
              onSubmit={(event) => {
                event.preventDefault();
                void add();
              }}
            >
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={60} placeholder="Add another book" />
              <button type="submit" disabled={busy || !title.trim()}>
                Add
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
      {open === "bible" ? createPortal(<Suspense fallback={<Opening label="Opening the Bible…" onBack={() => setOpen(null)} />}><BibleReader onBack={() => setOpen(null)} onSwitch={(to) => void switchTo(to)} /></Suspense>, document.body) : null}
      {open === "devotion"
        ? createPortal(
            <div className="pc-book fixed inset-0 z-[80] flex flex-col bg-[#07140c]">
              <div className="flex items-center border-b border-white/10 bg-[#07140c] px-3">
                <button type="button" className="flex min-h-12 items-center gap-1 text-base font-semibold text-[#f8a018]" onClick={() => setOpen(null)}>
                  <ChevronLeft className="size-5" aria-hidden="true" />
                  Back to the library
                </button>
              </div>
              <StudyTrio current="devotion" onPick={(to) => void switchTo(to)} />
              <DevotionDays day={pastDay} onDay={setPastDay} />
              {pastDay ? null : <DevotionListen />}
              {founder && (!link || changeLink) ? (
                <form
                  className="flex gap-2 px-3 py-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                  }}
                >
                  <input value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://" className={fieldClass} />
                  <button type="submit" className={primaryButtonClass} disabled={busy}>
                    {busy ? "Saving…" : "Save"}
                  </button>
                </form>
              ) : null}
              {founder && link && !changeLink ? (
                <button type="button" className="px-3 py-2 text-left text-sm font-semibold text-[#f8a018]" onClick={() => setChangeLink(true)}>
                  Change the page
                </button>
              ) : null}
              {pastDay ? (
                <DevotionRead key={pastDay} sheets={[{ name: "English", html: keptDays().find((d) => d.day === pastDay)?.html ?? "" }]} link={keptDays().find((d) => d.day === pastDay)?.link ?? ""} founder={false} seed={seed} />
              ) : sheets ? (
                <DevotionRead sheets={sheets} link={link} founder={founder} seed={seed} />
              ) : link ? (
                <iframe title="Devotional" src={`/api/browse?url=${encodeURIComponent(link)}${getBearerToken() ? `&t=${encodeURIComponent(getBearerToken() ?? "")}` : ""}`} className="min-h-0 w-full flex-1 border-0 bg-white" />
              ) : waiting ? (
                <PorchLoader className="is-card" label="Opening the devotional" />
              ) : (
                <p className="px-4 text-sm text-[#f6edd8]">Paste the page address, then save.</p>
              )}
              {note ? <p className="px-4 py-2 text-sm text-[#f6edd8]">{note}</p> : null}
            </div>,
            document.body,
          )
        : null}
      {shared ? createPortal(<SharedNoteCard shared={shared} onAdd={() => void addShared()} onSkip={() => setShared(null)} />, document.body) : null}
      {open === "notebook"
        ? createPortal(
            <Suspense fallback={<Opening label="Opening the notebook…" onBack={() => setOpen(null)} />}>
            <NotebookList
              notes={notes}
              onBack={() => setOpen(null)}
              onNew={() => {
                setNoteId("");
                setNoteTitle("");
                setNoteSubtitle("");
                setNotePhaneroo("");
                setNoteKind("personal");
                setNoteBody("");
                setEdited("");
                setNote("");
                setNotePageKey((n) => n + 1);
                setOpen("note");
              }}
              onOpen={(id) => void openNoteById(id)}
              onSwitch={(to) => void switchTo(to)}
              onImport={importNotes}
            />
            </Suspense>,
            document.body,
          )
        : null}
      {open === "note"
        ? createPortal(
            <Suspense fallback={<Opening label="Opening the note…" onBack={() => setOpen(null)} />}>
            <NotebookPage
              key={notePageKey}
              title={noteTitle}
              subtitle={noteSubtitle}
              phaneroo={notePhaneroo}
              kind={noteKind}
              body={noteBody}
              edited={edited}
              busy={busy}
              note={note}
              onTitle={setNoteTitle}
              onSubtitle={setNoteSubtitle}
              onPhaneroo={setNotePhaneroo}
              onKind={setNoteKind}
              onSave={(markup) => save(markup)}
              onBack={(markup) => void leaveNote(markup)}
              onSwitch={(to, markup) => void switchTo(to, markup)}
            />
            </Suspense>,
            document.body,
          )
        : null}
      {open && open !== "devotion" && open !== "bible" && open !== "notebook" && open !== "note" && current?.hasPdf ? (
        <PdfScroll
          title={current.title}
          bookKey={current.key}
          version={pdfVersion}
          onClose={() => {
            setOpen(null);
            setBookPages(null);
            setBookMeta({ author: "", summary: "", cover: "" });
            setScan("");
          }}
          onFile={canEdit ? (file) => void uploadPdf(file) : undefined}
          extra={<BookDownload bookKey={current.key} hasPdf seed={seed} />}
        />
      ) : null}
      {open && open !== "devotion" && open !== "bible" && open !== "notebook" && open !== "note" && current && !current.hasPdf && (bookPages || scan) ? (
        <LibraryBook
          key={`${current.key}:${scan}:${bookPages?.length ?? 0}`}
          title={current.title}
          pages={bookPages ?? []}
          meta={bookMeta}
          empty={scan}
          onClose={() => {
            setOpen(null);
            setBookPages(null);
            setBookMeta({ author: "", summary: "", cover: "" });
            setScan("");
          }}
          onFile={canEdit ? (file) => void uploadPdf(file) : undefined}
          extra={bookPages?.length ? <BookDownload bookKey={current.key} hasPdf={false} seed={seed} /> : undefined}
        />
      ) : null}
      {open && open !== "devotion" && open !== "bible" && open !== "notebook" && open !== "note" && current && !current.hasPdf && !bookPages && !scan ? (
        <Suspense fallback={null}>
        <ReportBook
          name={current.title}
          pages={pages}
          canEdit={canEdit}
          note={note}
          busy={busy}
          backLabel="Back to the library"
          onWrite={(index, value) => setPages((currentPages) => currentPages.map((page, i) => (i === index ? value : page)))}
          onAdd={() => setPages((currentPages) => (currentPages.length >= 8 ? currentPages : [...currentPages, ""]))}
          onSave={() => void save()}
          extra={
            canEdit ? (
              <label className="min-h-12 cursor-pointer font-semibold text-[#f8a018]">
                {busy ? "Uploading…" : "Upload PDF"}
                <input
                  type="file"
                  accept=".pdf,.txt,.docx,.epub,application/pdf,text/plain"
                  className="sr-only"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void uploadPdf(file);
                  }}
                />
              </label>
            ) : null
          }
          onClose={() => {
            setOpen(null);
            setPages([""]);
            setNote("");
          }}
        />
        </Suspense>
      ) : null}
    </AppFrame>
  );
}

/** The last 7 days' devotionals kept on this phone: Today · Thu 5 Nov · Wed 4 Nov … */
function DevotionDays({ day, onDay }: { day: string; onDay: (day: string) => void }) {
  const days = keptDays();
  if (days.length < 2) return null;
  const today = days[0]?.day;
  return (
    <div className="dev-days" role="tablist" aria-label="Devotionals on this phone">
      {days.map((d) => {
        const isToday = d.day === today;
        const on = isToday ? !day || day === today : day === d.day;
        return (
          <button key={d.day} type="button" role="tab" aria-selected={on} className={on ? "is-on" : ""} onClick={() => onDay(isToday ? "" : d.day)}>
            {isToday ? "Today" : dayLabel(d.day)}
          </button>
        );
      })}
    </div>
  );
}
