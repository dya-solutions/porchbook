import { ShelfFace } from "@/components/porch/shelf";
import { W, WHint, useWord } from "@/components/porch/words";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type UIEvent } from "react";
import { ChevronLeft, Maximize2, Send, SquareCheck, Trash2 } from "lucide-react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { actionName, listOffices, listOfficeHolders, openOffice, OFFICE_ACTIONS, OFFICE_PARTS, OFFICES, postAnnouncement, saveCalendar, setOfficeDoor, setOfficeHead, sendOfficeNote, sendOfficial, setPrayerStatus, statusName, type OfficeCard } from "@/lib/porch/offices";
import { ActionIcon, ActionTile, StatusTag, YourRequests } from "@/components/porch/office-screens";
import { Avatar, LinkText, fieldClass, primaryButtonClass, quietButtonClass } from "@/components/porch/bits";
import { playOfficeBell } from "@/lib/porch/button-sound-play";
import { BookHide } from "@/components/porch/hide";
import { useShelfPhoto } from "@/components/porch/shelf";
import { addOfficeBook, clearOfficeFile, dropOfficeFiles, listOfficeBooks, loadOfficeFile, renameOfficeFile, saveOfficeFile, saveReportPdf } from "@/lib/porch/office-book";
import { ReportBook } from "@/components/porch/report-book";
import { forgetPdf } from "@/components/porch/reading-sheet";
import { LibraryBook } from "@/components/porch/library-book";
import { clothOf, writtenPages, type BookMeta, type LibraryPages } from "@/lib/porch/pdf-book";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { HooBoard } from "@/components/porch/hoo-board";
import { MissionSms } from "@/components/porch/mission-sms";
import { Fault } from "@/components/porch/trouble";

function dayLabel(iso: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const day = new Date(t);
  const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(day)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return day.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function clock(iso: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function useSeed() {
  const user = useCurrentUser();
  return {
    id: user?.id ?? "",
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };
}

function CallLine() {
  return (
    <>
      Online🟢 and on 📞Call:-{" "}
      <a href="tel:+256200998801" className="font-semibold text-ink underline decoration-ink underline-offset-2">
        0200998801
      </a>
    </>
  );
}

function PastorWeek() {
  const days: { day: string; note: ReactNode }[] = [
    { day: "Monday", note: "🚫" },
    { day: "Tuesday", note: "12:00pm upwards" },
    { day: "Wednesday", note: "5:00pm Discipleship Class" },
    { day: "Thursday", note: "🚫" },
    { day: "Friday", note: <CallLine /> },
    { day: "Saturday", note: <CallLine /> },
    { day: "Sunday", note: "Service, Seeing those on appointment" },
  ];
  return (
    <section className="mt-4">
      <h2 className="text-sm font-semibold tracking-wide text-ink uppercase">Weekly standard program minus exceptions</h2>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl glass-edge">
        {days.map((item) => (
          <li key={item.day} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 bg-card px-3 py-3">
            <span className="font-semibold text-ink">{item.day}</span>
            <span className="text-post">{item.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const shelfMemory = new Map<string, { books: string[]; removed: string[] }>();
const fileMemory = new Map<string, { pages: string[]; hasPdf: boolean; library: LibraryPages | null; scan: string; meta: BookMeta }>();
const emptyMeta: BookMeta = { author: "", summary: "", cover: "" };
let officeMemory: OfficeCard[] | null = null;

function pdfAddress(key: string, part: string) {
  return `/api/office-pdf?key=${encodeURIComponent(key)}&part=${encodeURIComponent(part)}`;
}

const BOOK_WIDTH = "7.6rem";

type BookSize = { w: number; h: number };

function sizeStore(officeKey: string) {
  return `porch-office-sizes:${officeKey}`;
}

function readSizes(officeKey: string): Record<string, BookSize> {
  try {
    const raw = localStorage.getItem(sizeStore(officeKey));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, BookSize>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeSizes(officeKey: string, sizes: Record<string, BookSize>) {
  localStorage.setItem(sizeStore(officeKey), JSON.stringify(sizes));
}

function Hardcover({
  part,
  picked,
  onOpen,
  lean = 0,
  spine = false,
  size,
  adjusting = false,
  onSize,
}: {
  part: string;
  picked?: boolean;
  onOpen: (part: string) => void;
  lean?: number;
  spine?: boolean;
  size?: BookSize;
  adjusting?: boolean;
  onSize?: (part: string, size: BookSize) => void;
}) {
  const bible = /bible/i.test(part);
  const notebook = /notebook/i.test(part);
  function drag(event: ReactPointerEvent<HTMLElement>, edge: "h" | "w") {
    event.preventDefault();
    event.stopPropagation();
    const book = event.currentTarget.parentElement;
    const bay = book?.parentElement;
    if (!book || !bay || !onSize) return;
    const bayBox = bay.getBoundingClientRect();
    const bookBox = book.getBoundingClientRect();
    const origin = edge === "h" ? event.clientY : event.clientX;
    const base = {
      w: (bookBox.width / bayBox.width) * 100,
      h: (bookBox.height / bayBox.height) * 100,
    };
    const move = (pointer: PointerEvent) => {
      const next = { ...base };
      if (edge === "h") next.h = Math.min(100, Math.max(35, base.h + ((origin - pointer.clientY) / bayBox.height) * 100));
      else next.w = Math.min(62, Math.max(8, base.w + ((pointer.clientX - origin) / bayBox.width) * 100));
      onSize(part, { w: Math.round(next.w * 10) / 10, h: Math.round(next.h * 10) / 10 });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }
  return (
    <button
      type="button"
      onClick={() => {
        if (!adjusting) onOpen(part);
      }}
      className={`no-sink case-book ${bible ? "case-bible" : ""} ${notebook ? "case-notebook" : ""} ${spine ? "stand-spine" : ""} ${picked ? "ring-2 ring-red-600" : ""}`}
      style={{
        ["--lean" as string]: `${lean}deg`,
        ...(size
          ? { height: `${size.h}%`, width: `${size.w}%`, flex: "0 0 auto", minWidth: 0 }
          : null),
      }}
    >
      {adjusting ? (
        <>
          <span className="book-size book-size-top" onPointerDown={(event) => drag(event, "h")} onClick={(event) => event.stopPropagation()} />
          <span className="book-size book-size-side" onPointerDown={(event) => drag(event, "w")} onClick={(event) => event.stopPropagation()} />
        </>
      ) : null}
      {bible ? (
        <span className="bible-face">
          <span className="bible-cross" aria-hidden="true" />
          <b>HOLY BIBLE</b>
          <span className="bible-ribbon red" aria-hidden="true" />
          <span className="bible-ribbon gold" aria-hidden="true" />
        </span>
      ) : notebook ? (
        <span className="note-face" aria-hidden="true" />
      ) : (
        <>
          <span className="book-spine flex w-[11%] shrink-0 items-center justify-center overflow-hidden text-[#faf6ee]" style={{ writingMode: "vertical-rl", backgroundColor: clothOf(part) }} aria-hidden="true">
            <span className="max-h-[92%] overflow-hidden text-[8px] leading-tight tracking-wide">{part.length > 32 ? `${part.slice(0, 30)}…` : part}</span>
          </span>
          <BookHide className="relative flex min-w-0 flex-1 flex-col items-center justify-center px-2">
            <span className="butterfly butterfly-still absolute right-1.5 bottom-1.5 size-5 shrink-0" aria-hidden="true">
              <img src="/wing-left.png?v=5" alt="" className="butterfly-wing butterfly-left" />
              <img src="/wing-right.png?v=5" alt="" className="butterfly-wing butterfly-right" />
            </span>
            <span className="book-title absolute top-1.5 right-1 left-1 text-center text-xs leading-tight break-words">{part}</span>
          </BookHide>
        </>
      )}
    </button>
  );
}

export function BookShelf({
  officeKey,
  parts,
  canEdit,
  canEmpty,
  canWrite = canEmpty,
  tick,
}: {
  officeKey: string;
  parts: readonly string[];
  canEdit: boolean;
  canEmpty: boolean;
  canWrite?: boolean;
  tick: number;
}) {
  const remembered = shelfMemory.get(officeKey);
  useShelfPhoto();
  const [ready, setReady] = useState(Boolean(remembered));
  const [open, setOpen] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string[]>(remembered?.books ?? []);
  const [removed, setRemoved] = useState<string[]>(remembered?.removed ?? []);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const { user } = useCurrentUserState();
  const [pages, setPages] = useState<string[]>([""]);
  const [hasPdf, setHasPdf] = useState(false);
  const [bookPages, setBookPages] = useState<LibraryPages | null>(null);
  const [bookMeta, setBookMeta] = useState<BookMeta>(emptyMeta);
  const [scan, setScan] = useState("");
  const [writing, setWriting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [cover, setCover] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [nextName, setNextName] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [sizes, setSizes] = useState<Record<string, BookSize>>({});
  const booksScroll = useRef<HTMLDivElement>(null);
  const uploadScroll = useRef<HTMLDivElement>(null);
  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };
  const fixed = new Set(parts);

  useEffect(() => {
    setSizes(readSizes(officeKey));
  }, [officeKey]);

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    listOfficeBooks({ data: { ...seed, key: officeKey } })
      .then((result) => {
        if (!cancel && result.ok) {
          shelfMemory.set(officeKey, { books: result.books, removed: result.removed });
          setUploaded(result.books);
          setRemoved(result.removed);
        }
        if (!cancel) setReady(true);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, officeKey, tick]);

  useEffect(() => {
    if (!open || !user?.id) return;
    let cancel = false;
    setNote("");
    const rememberedFile = fileMemory.get(`${officeKey}:${open}`);
    if (rememberedFile) {
      setPages(rememberedFile.pages);
      setHasPdf(rememberedFile.hasPdf);
      setBookPages(rememberedFile.library);
      setBookMeta(rememberedFile.meta);
      setScan(rememberedFile.scan);
      setLoaded(true);
    } else {
      setBookPages(null);
      setBookMeta(emptyMeta);
      setScan("");
      setLoaded(false);
    }
    loadOfficeFile({ data: { ...seed, key: officeKey, part: open } })
      .then((result) => {
        if (cancel || !result.ok) return;
        const pages = result.body ? result.body.split("\f").slice(0, fixed.has(open) ? 8 : 24) : [""];
        const library = result.library ?? null;
        const scan = result.scan ?? "";
        const meta = result.meta ?? emptyMeta;
        fileMemory.set(`${officeKey}:${open}`, { pages, hasPdf: Boolean(result.hasPdf), library, scan, meta });
        setPages(pages);
        setHasPdf(Boolean(result.hasPdf));
        setBookPages(library);
        setBookMeta(meta);
        setScan(scan);
        setLoaded(true);
        if (!fixed.has(open) && !result.body && !result.hasPdf) setNote("Nothing has been uploaded yet.");
      })
      .catch(() => {
        if (!cancel) {
          setScan("Couldn't open that file.");
          setLoaded(true);
        }
      });
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id, officeKey]);

  async function save() {
    if (!open) return false;
    setBusy(true);
    setNote("");
    const result = await saveOfficeFile({ data: { ...seed, key: officeKey, part: open, title: open, body: pages.join("\f").slice(0, 4000) } });
    setBusy(false);
    setNote(result.ok ? "Saved." : result.error);
    return result.ok;
  }

  async function empty() {
    if (!open) return;
    setBusy(true);
    setNote("");
    const result = await clearOfficeFile({ data: { ...seed, key: officeKey, part: open } });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setPages([""]);
    setHasPdf(false);
    setBookPages(null);
    setBookMeta(emptyMeta);
    setScan("");
    fileMemory.delete(`${officeKey}:${open}`);
    forgetPdf(pdfAddress(officeKey, open));
    setNote("This book is empty.");
  }

  async function dropChosen() {
    if (!chosen.length) return;
    setBusy(true);
    setNote("");
    const result = await dropOfficeFiles({ data: { ...seed, key: officeKey, parts: chosen } });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setRemoved((current) => [...new Set([...current, ...chosen])]);
    setUploaded((current) => current.filter((part) => !chosen.includes(part)));
    rememberShelf(
      uploaded.filter((part) => !chosen.includes(part)),
      [...new Set([...removed, ...chosen])],
    );
    setChosen([]);
    setPicking(false);
    setNote("Deleted.");
  }

  function rememberShelf(books: string[], gone: string[]) {
    shelfMemory.set(officeKey, { books, removed: gone });
  }

  async function addBook(event: FormEvent) {
    event.preventDefault();
    const name = cover.trim();
    if (!name) return;
    setBusy(true);
    setNote("");
    const result = await addOfficeBook({ data: { ...seed, key: officeKey, name } });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    const books = uploaded.includes(name) ? uploaded : [...uploaded, name];
    const gone = removed.filter((part) => part !== name);
    setUploaded(books);
    setRemoved(gone);
    rememberShelf(books, gone);
    setCover("");
  }

  async function renameFile(event: FormEvent) {
    event.preventDefault();
    const from = renaming;
    const to = nextName.trim();
    if (!from || !to) return;
    setBusy(true);
    setNote("");
    const result = await renameOfficeFile({ data: { ...seed, key: officeKey, from, to } });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    const books = [...uploaded.filter((part) => part !== from && part !== to), to];
    const gone = [...removed.filter((part) => part !== to), ...(fixed.has(from) ? [from] : [])];
    setUploaded(books);
    setRemoved(gone);
    rememberShelf(books, gone);
    const kept = fileMemory.get(`${officeKey}:${from}`);
    if (kept) {
      fileMemory.set(`${officeKey}:${to}`, kept);
      fileMemory.delete(`${officeKey}:${from}`);
    }
    setRenaming(null);
    setNextName("");
  }

  async function keepReport(part: string, file: string, name: string) {
    setBusy(true);
    setNote("");
    const result = await saveReportPdf({ data: { ...seed, key: officeKey, part, file, name } });
    setBusy(false);
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setNote("The file is in " + part + ".");
    fileMemory.set(`${officeKey}:${part}`, { pages: [""], hasPdf: true, library: null, scan: "", meta: emptyMeta });
    forgetPdf(pdfAddress(officeKey, part));
    setOpen(part);
    setHasPdf(true);
  }

  function readFile(part: string, file: File) {
    const kind = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["pdf", "txt", "text", "docx", "epub"].includes(kind)) {
      setNote("Use a PDF, Word, EPUB, or text file.");
      return;
    }
    if (file.size > 4_000_000) {
      setNote("That file is too large.");
      return;
    }
    void file.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let index = 0; index < bytes.length; index += 4096) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(index, index + 4096)));
      }
      void keepReport(part, btoa(binary), file.name);
    });
  }

  const shelf = [...uploaded.filter((part) => !fixed.has(part)), ...parts].filter((part) => !removed.includes(part));
  const per = Math.max(3, Math.ceil(shelf.length / 5));

  if (open && !loaded && !writing) {
    return (
      <div className="fixed inset-0 z-[80] flex flex-col bg-[#cbbba4]">
        <button type="button" className="flex min-h-12 items-center gap-1 px-3 text-base font-semibold text-[#2a2118]" onClick={() => { setOpen(null); setHasPdf(false); setLoaded(false); }}>
          <ChevronLeft className="size-5" aria-hidden="true" />
          Back
        </button>
        <p className="px-6 pt-8 text-lg font-semibold text-[#2a2118]">Opening the book…</p>
      </div>
    );
  }

  if (open && hasPdf && !writing) {
    return (
      <LibraryBook
        key={`${officeKey}:${open}:${scan}:${bookPages?.length ?? 0}`}
        title={open}
        pages={bookPages ?? []}
        meta={bookMeta}
        empty={scan || (bookPages?.length ? "" : "This PDF could not be read.")}
        busy={busy}
        onEmpty={canEmpty ? () => void empty() : undefined}
        onClose={() => {
          setOpen(null);
          setHasPdf(false);
          setBookPages(null);
          setScan("");
          setWriting(false);
          setLoaded(false);
        }}
      />
    );
  }

  const reportFile = open === "Daily Report" || open === "Weekly Report" || open === "Monthly Report" || (open ? !fixed.has(open) : false);
  const canWriteFile = Boolean(open && canEdit && !reportFile && open !== "My files");

  if (open && writing && canWriteFile) {
    return (
      <ReportBook
        name={open}
        pages={pages}
        canEdit
        note={note}
        busy={busy}
        onWrite={(index, value) => setPages((current) => current.map((page, i) => (i === index ? value : page)))}
        onAdd={() => setPages((current) => (current.length >= 8 ? current : [...current, ""]))}
        onSave={() => void save()}
        onEmpty={canEmpty ? () => void empty() : undefined}
        onClose={() => setWriting(false)}
      />
    );
  }

  if (open) {
    const laid = writtenPages(pages);
    return (
      <LibraryBook
        key={`${officeKey}:${open}:words:${laid.length}`}
        title={open}
        pages={laid}
        empty={scan || (laid.length ? "" : "Nothing has been written in this file yet.")}
        busy={busy}
        onWrite={canWriteFile ? () => setWriting(true) : undefined}
        onEmpty={canEmpty ? () => void empty() : undefined}
        onClose={() => {
          setOpen(null);
          setPages([""]);
          setNote("");
          setWriting(false);
        }}
      />
    );
  }

  function follow(source: HTMLDivElement | null, other: HTMLDivElement | null) {
    if (!source || !other || other.scrollLeft === source.scrollLeft) return;
    other.scrollLeft = source.scrollLeft;
  }

  function openPart(name: string) {
    if (adjusting) return;
    if (!picking) {
      setWriting(false);
      setLoaded(false);
      setHasPdf(false);
      setOpen(name);
      return;
    }
    setChosen((current) => (current.includes(name) ? current.filter((item) => item !== name) : [...current, name]));
  }

  function keepSize(part: string, size: BookSize) {
    setSizes((current) => {
      const next = { ...current, [part]: size };
      writeSizes(officeKey, next);
      return next;
    });
  }

  if (!canEmpty && !ready && parts.length === 0 && !(remembered?.books.length)) return null;
  if (!canEmpty && ready && shelf.length === 0) return null;
  // No books and nobody here to add them: no shelf and no shelf tools.
  if (ready && shelf.length === 0 && !canWrite) return null;

  return (
    <div className="mt-3">
      {/* The Library's wooden shelf, and only when there are books on it. */}
      {shelf.length ? (
        <div className="shelf-bay office-shelf">
          <ShelfFace />
          <div className="shelf-row" ref={booksScroll} onScroll={() => follow(booksScroll.current, uploadScroll.current)}>
            <div className="shelf-roll office-shelf-books flex h-full items-end gap-3 px-2">
              {shelf.map((part) => (
                <Hardcover
                  key={part}
                  part={part}
                  picked={chosen.includes(part)}
                  onOpen={openPart}
                  lean={0}
                  spine={false}
                  size={sizes[part]}
                  adjusting={adjusting}
                  onSize={keepSize}
                />
              ))}
            </div>
          </div>
        </div>
      ) : canWrite ? (
        <p className="office-shelf-empty">No books yet. Name a cover below to put the first book on the shelf.</p>
      ) : null}
      {canWrite ? (
        <div
          ref={uploadScroll}
          className="mt-2 overflow-x-auto overscroll-x-contain px-[6.5%]"
          style={{ touchAction: "pan-x pan-y" }}
          onScroll={() => follow(uploadScroll.current, booksScroll.current)}
        >
          <div className="flex w-max gap-3 px-2">
            {shelf.map((part) => (
              <div key={part} className="flex shrink-0 flex-col items-center gap-1" style={{ width: BOOK_WIDTH }}>
                <label className={`relative flex justify-center text-base font-bold text-white ${busy ? "pointer-events-none opacity-60" : ""}`}>
                  File
                  <input
                    type="file"
                    accept=".pdf,.txt,.docx,.epub,application/pdf,text/plain"
                    className="absolute inset-0 z-10 cursor-pointer opacity-0"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) readFile(part, file);
                    }}
                  />
                </label>
                {renaming === part ? (
                  <form onSubmit={(event) => void renameFile(event)} className="flex w-full flex-col items-center gap-1">
                    <input value={nextName} onChange={(event) => setNextName(event.target.value)} maxLength={60} className={fieldClass} />
                    <button type="submit" className="text-base font-bold text-white disabled:opacity-40" disabled={busy || !nextName.trim()}>
                      Save
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="text-base font-bold text-white"
                    onClick={() => {
                      setRenaming(part);
                      setNextName(part);
                    }}
                  >
                    Rename
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="tools-panel mx-1">
        <p className="tools-title">Shelf tools</p>
        <div className="tools-row">
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
          {canEmpty ? (
            <button
              type="button"
              className={`tool-key${picking ? " is-on" : ""}`}
              aria-pressed={picking}
              onClick={() => {
                setPicking((value) => !value);
                setChosen([]);
                setAdjusting(false);
              }}
            >
              <SquareCheck aria-hidden="true" />
              {picking ? "Cancel" : "Select"}
            </button>
          ) : null}
          {canEmpty && picking ? (
            <button type="button" className="tool-key is-danger" disabled={!chosen.length || busy} onClick={() => void dropChosen()}>
              <Trash2 aria-hidden="true" />
              Delete
            </button>
          ) : null}
        </div>
        {adjusting ? <p className="tools-hint">Drag the top edge for height. Drag the side edge for width.</p> : null}
        {picking ? <p className="tools-hint">Tap a book, then Delete.</p> : null}
        {canWrite ? (
          <form onSubmit={(event) => void addBook(event)} className="tools-add">
            <input value={cover} onChange={(event) => setCover(event.target.value)} maxLength={60} placeholder="Name the cover" />
            <button type="submit" disabled={busy || !cover.trim()}>
              Add
            </button>
          </form>
        ) : null}
      </div>
      {note ? <p className="px-1 text-sm text-muted">{note}</p> : null}
    </div>
  );
}

export function OfficesHome() {
  const seed = useSeed();
  const [offices, setOffices] = useState<OfficeCard[]>(officeMemory ?? []);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(officeMemory ? "ready" : "loading");

  useEffect(() => {
    if (!seed.id) return;
    let cancel = false;
    listOffices({ data: { displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl } })
      .then((result) => {
        if (cancel) return;
        officeMemory = result.offices;
        setOffices(result.offices);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancel) setStatus("error");
      });
    return () => {
      cancel = true;
    };
  }, [seed.id, seed.displayName, seed.email, seed.imageUrl]);

  if (status === "error") return <p className="text-danger">Couldn't open the offices.</p>;

  return (
    <div>
      <h1 className="font-display text-3xl text-ink">Offices</h1>
      <p className="mt-1 text-muted"><W k="offices.intro">Chat privately with an office.</W></p>
      <ul className="mt-5 space-y-2">
        {offices.map((office) => (
          <li key={office.key}>
            <Link
              to="/offices/$officeKey"
              params={{ officeKey: office.key }}
              search={{ member: "", room: "" }}
              onClick={() => playOfficeBell()}
              className="flex min-h-16 items-center gap-3 rounded-2xl glass-edge bg-card px-4 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-ink">{office.name}</span>
                <span className="block truncate text-sm text-muted">
                  {office.headName ? office.headName : "No head yet"}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OfficeRoom({ officeKey, member, room }: { officeKey: string; member: string; room: string }) {
  const seed = useSeed();
  const [page, setPage] = useState<Awaited<ReturnType<typeof openOffice>> | null>(null);
  const [people, setPeople] = useState<{ userId: string; displayName: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [tick, setTick] = useState(0);
  const [prayerFilter, setPrayerFilter] = useState<"open" | "received" | "answered">("open");
  const [thanksMode, setThanksMode] = useState<"choose" | "prayer" | "testimony">("choose");
  const [testimony, setTestimony] = useState("");
  const [thanksNote, setThanksNote] = useState("");
  const [holders, setHolders] = useState<{ userId: string; displayName: string; offices: string[] }[]>([]);
  const [officialText, setOfficialText] = useState("");
  const [officialWho, setOfficialWho] = useState("");
  const [officialNote, setOfficialNote] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    if (!seed.id) return;
    let cancel = false;
    const data = { displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl };
    Promise.all([
      openOffice({ data: { key: officeKey, memberId: member, room, ...data } }),
      listOffices({ data }),
    ])
      .then(([opened, list]) => {
        if (cancel) return;
        setPage(opened);
        setPeople(list.people);
      })
      .catch(() => {
        if (!cancel) setError("Couldn't open that office.");
      });
    return () => {
      cancel = true;
    };
  }, [seed.id, seed.displayName, seed.email, seed.imageUrl, officeKey, member, room, tick]);

  useEffect(() => {
    if (!seed.id || room !== "official" || !page || !page.ok || !page.isHead) return;
    let cancel = false;
    listOfficeHolders({ data: { displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl } })
      .then((result) => {
        if (!cancel && result.ok) setHolders(result.people);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [seed.id, seed.displayName, seed.email, seed.imageUrl, officeKey, room, page]);

  useEffect(() => {
    if (!seed.id || !member) return;
    let cancel = false;
    const data = { displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl };
    const timer = window.setInterval(() => {
      openOffice({ data: { key: officeKey, memberId: member, room, ...data } })
        .then((opened) => {
          if (cancel || !opened.ok || opened.kind !== "notes") return;
          setPage((current) => {
            if (!current || !current.ok || current.kind !== "notes") return opened;
            const extras = current.notes.filter(
              (note) => note.id < 0 && !opened.notes.some((item) => item.mine && item.body === note.body),
            );
            const notes = extras.length ? [...opened.notes, ...extras] : opened.notes;
            const same =
              notes.length === current.notes.length &&
              notes.every((note, index) => note.id === current.notes[index]?.id && note.body === current.notes[index]?.body);
            if (same && current.requestStatus === opened.requestStatus) return current;
            return { ...opened, notes };
          });
        })
        .catch(() => undefined);
    }, 3000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [seed.id, seed.displayName, seed.email, seed.imageUrl, officeKey, member, room]);

  useEffect(() => {
    setThanksMode("choose");
    setTestimony("");
    setThanksNote("");
  }, [room]);

  useEffect(() => {
    if (!stickRef.current) return;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [page && page.ok && page.kind === "notes" ? page.notes.length : 0]);

  if (!page) {
    const known = OFFICES.find((item) => item.key === officeKey)?.name ?? "Office";
    return error ? <Fault text={error} className="" /> : <h1 className="font-display text-3xl text-ink">{known}</h1>;
  }
  if (!page.ok) return <p className="text-danger">{page.error}</p>;

  const showList = page.isFounder || page.isHead;
  const showThread = Boolean(page.memberId) && page.hasHead && !(page.isHead && page.memberId === seed.id);
  const canWriteHere = page.isHead || !page.isFounder;

  async function chooseHead(userId: string) {
    setError("");
    const result = await setOfficeHead({
      data: { key: officeKey, userId, displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl },
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTick((value) => value + 1);
  }

  async function markPrayer(status: "received" | "answered") {
    if (!page || !page.ok || !page.memberId) return;
    setError("");
    const result = await setPrayerStatus({
      data: {
        key: officeKey,
        room: page.room,
        memberId: page.memberId,
        status,
        displayName: seed.displayName,
        email: seed.email,
        imageUrl: seed.imageUrl,
      },
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTick((value) => value + 1);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || pending || !page || !page.ok || page.kind !== "notes") return;
    const current = page;
    setPending(true);
    setError("");
    const optimistic = {
      id: -Date.now(),
      authorId: seed.id,
      authorName: seed.displayName,
      body,
      createdAt: new Date().toISOString(),
      mine: true,
      official: current.room === "official" && current.isHead,
      held: false,
    };
    setPage({ ...current, notes: [...current.notes, optimistic] });
    setDraft("");
    stickRef.current = true;
    const result = await sendOfficeNote({
      data: {
        key: officeKey,
        memberId: page && page.ok ? page.memberId || seed.id : seed.id,
        room,
        body,
        displayName: seed.displayName,
        email: seed.email,
        imageUrl: seed.imageUrl,
      },
    });
    setPending(false);
    if (!result.ok) {
      setPage(current);
      setDraft(body);
      setError(result.error);
      return;
    }
    setTick((value) => value + 1);
  }

  async function toggleDoor() {
    if (!page || !page.ok || page.kind !== "notes" || !page.memberId) return;
    const opening = page.doorClosed;
    if (!opening && !window.confirm(`Close the door to ${page.memberName}? They won't be told. Their messages wait until you open it.`)) return;
    const result = await setOfficeDoor({ data: { key: officeKey, memberId: page.memberId, open: opening } }).catch(() => null);
    if (!result?.ok) {
      setError(result?.error ?? "That didn't go through.");
      return;
    }
    setTick((value) => value + 1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const thanks = page.room === "thanks";
  const asker = thanks && !page.isHead && !page.isFounder;
  const showThanksChoice = asker && thanksMode === "choose";
  const showTestimony = asker && thanksMode === "testimony";
  const shown = page.threads.filter((thread) => page.room === "official" || thread.status === prayerFilter);
  const title = page.roomName || page.name;
  let lastDay = "";

  return (
    <div className="pb flex h-full min-h-0 flex-col">
      <header className="ofc-head">
        {page.kind === "rooms" ? (
          <Link to="/offices" aria-label="Back" className="pb-iconbtn">
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
        ) : (
          <Link
            to="/offices/$officeKey"
            params={{ officeKey }}
            search={{ member: "", room: member && (page.isHead || page.isFounder) ? page.room : "" }}
            aria-label="Back"
            className="pb-iconbtn"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
        )}
        {page.kind === "rooms" ? (
          <p className="pb-quiet" style={{ margin: 0, fontSize: 15, flex: 1 }}>Offices</p>
        ) : (
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="ofc-name" style={{ fontSize: 16 }}>{page.name}</p>
            <p className="ofc-hint">{title}</p>
          </div>
        )}
        {page.kind === "notes" && page.memberId && page.room !== "official" && page.notes.length ? <StatusTag status={page.requestStatus} /> : null}
      </header>
      {page.kind === "rooms" ? (
        <div className="pb-row" style={{ gap: 14, marginTop: 10 }}>
          <ActionTile action="office" size={60} />
          <div style={{ minWidth: 0 }}>
            <h1 className="pb-ttl" style={{ fontSize: 26, lineHeight: 1.1 }}>{page.name}</h1>
            <p className="pb-quiet" style={{ margin: "4px 0 0", fontSize: 14 }}>
              {page.headName ? `Head: ${page.headName}` : "No head yet"}
            </p>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-8">
      {!member && (page.isHead || page.isFounder) ? (
        <BookShelf
          key={officeKey}
          officeKey={officeKey}
          tick={0}
          parts={OFFICE_PARTS[officeKey] ?? []}
          canEdit={page.isHead}
          canEmpty={page.isHead || (officeKey === "pastor" && page.isFounder)}
          canWrite={page.isHead}
        />
      ) : null}

      {page.isFounder && page.kind === "rooms" ? (
        <label className="mt-4 block text-sm text-muted">
          Head
          <select
            className={`${fieldClass} mt-1`}
            value={page.headUserId ?? ""}
            onChange={(event) => {
              if (event.target.value) void chooseHead(event.target.value);
            }}
          >
            <option value="">Choose a head</option>
            {people.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.displayName}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {officeKey === "hoo" && !member && (page.isFounder || page.isHead || page.holdsOffice) ? <HooBoard /> : null}

      {officeKey === "missions" && !member && page.isHead ? <MissionSms /> : null}

      {page.kind === "rooms" ? (
        <>
          {page.actions.length ? (
            <div className="pb-card ofc-list">
              {OFFICE_ACTIONS.filter((item) => page.actions.includes(item.key)).map((item) => {
                // Accountability and Official are for office holders.
                const still =
                  (item.key === "account" || item.key === "official") && !page.holdsOffice && !page.isHead && !page.isFounder;
                const face = (
                  <>
                    <ActionTile action={item.key} />
                    <span className="ofc-words">
                      <span className="ofc-name">{actionName(item.key, officeKey, page.name)}</span>
                      <span className="ofc-hint">{still ? "For office holders" : item.hint}</span>
                    </span>
                    {still ? null : (
                      <span className="pb-quiet">
                        <ActionIcon action="arrow" size={18} />
                      </span>
                    )}
                  </>
                );
                return still ? (
                  <div key={item.key} className="ofc-row is-still">{face}</div>
                ) : (
                  <Link
                    key={item.key}
                    to="/offices/$officeKey"
                    params={{ officeKey }}
                    search={{ member: "", room: item.key }}
                    className="ofc-row"
                  >
                    {face}
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="pb-quiet" style={{ marginTop: 14 }}>This office doesn't offer anything yet.</p>
          )}
          {!page.isHead ? <YourRequests officeKey={officeKey} /> : null}
          {page.isHead ? <AnnounceBox officeKey={officeKey} officeName={page.name} /> : null}
        </>
      ) : null}

      {page.kind === "calendar" ? (
        <WeeklyProgramme officeKey={officeKey} text={page.calendar} canEdit={page.canEditCalendar} phaneroo={page.phanerooWeek} onSaved={() => setTick((value) => value + 1)} />
      ) : null}

      {showThanksChoice ? (
        <div className="mt-6 grid max-w-sm gap-3">
          <button
            type="button"
            className="pb-btn"
            onClick={() => {
              if (!page.hasHead) {
                setThanksNote("This office has no head yet.");
                return;
              }
              setThanksNote("");
              setThanksMode("prayer");
            }}
          >
            Submit Prayer Request
          </button>
          <button
            type="button"
            className="pb-btn2"
            onClick={() => {
              setThanksNote("");
              setThanksMode("testimony");
            }}
          >
            Submit Testimony
          </button>
          {thanksNote ? <p className="text-sm text-muted">{thanksNote}</p> : null}
        </div>
      ) : null}

      {showTestimony ? (
        <form
          className="mt-6 grid max-w-sm gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const text = testimony.trim();
            if (!text || pending || !page || !page.ok || page.kind !== "notes") return;
            setPending(true);
            setError("");
            void sendOfficeNote({
              data: {
                key: officeKey,
                memberId: page.memberId || seed.id,
                room,
                body: `Testimony: ${text}`,
                displayName: seed.displayName,
                email: seed.email,
                imageUrl: seed.imageUrl,
              },
            }).then((result) => {
              setPending(false);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setTestimony("");
              setThanksNote("Sent to the office.");
              setThanksMode("choose");
              setTick((value) => value + 1);
            }).catch(() => {
              setPending(false);
              setError("Couldn't send.");
            });
          }}
        >
          <label className="grid gap-1 text-sm font-semibold text-ink">
            What has God done?
            <textarea
              className={`${fieldClass} min-h-28`}
              maxLength={2000}
              value={testimony}
              onChange={(event) => setTestimony(event.target.value)}
            />
          </label>
          <button type="submit" className="pb-btn" disabled={pending || !testimony.trim()}>
            {pending ? "Sending…" : "Submit Testimony"}
          </button>
          <button type="button" className={`${quietButtonClass} px-0`} onClick={() => setThanksMode("choose")}>
            Back
          </button>
        </form>
      ) : null}

      {showList && page.kind === "notes" && page.room !== "official" && !member ? (
        <div className="pb-chips" style={{ marginTop: 14 }}>
          {(["open", "received", "answered"] as const).map((item) => (
            <button key={item} type="button" onClick={() => setPrayerFilter(item)} className={`pb-chip${prayerFilter === item ? " is-on" : ""}`}>
              {statusName(item)}
            </button>
          ))}
        </div>
      ) : null}

      {showList && page.kind === "notes" && page.room === "official" && page.isHead ? (
        <form
          className="mt-4 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!officialText.trim()) return;
            setPending(true);
            setOfficialNote("");
            void sendOfficial({
              data: {
                body: officialText.trim(),
                userId: officialWho,
                displayName: seed.displayName,
                email: seed.email,
                imageUrl: seed.imageUrl,
              },
            }).then((result) => {
              setPending(false);
              if (!result.ok) {
                setOfficialNote(result.error);
                return;
              }
              setOfficialText("");
              setOfficialNote(officialWho ? "Sent to that office holder." : `Sent to ${result.sent}.`);
              setTick((value) => value + 1);
            }).catch(() => {
              setPending(false);
              setOfficialNote("Couldn't send.");
            });
          }}
        >
          <label className="grid gap-1 text-sm font-semibold text-ink">
            Official
            <textarea
              value={officialText}
              onChange={(event) => setOfficialText(event.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="Write to the office holders"
              className={fieldClass}
            />
          </label>
          <label className="grid gap-1 text-sm text-muted">
            One person
            <select className={fieldClass} value={officialWho} onChange={(event) => setOfficialWho(event.target.value)}>
              <option value="">All office holders</option>
              {holders.map((person) => (
                <option key={person.userId} value={person.userId}>
                  {person.displayName} · {person.offices.join(", ")}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={primaryButtonClass} disabled={pending || !officialText.trim()}>
            {pending ? "Sending…" : officialWho ? "Send to this person" : "Send to all"}
          </button>
          {officialNote ? <p className="text-sm text-muted">{officialNote}</p> : null}
        </form>
      ) : null}

      {showList && page.kind === "notes" && !member ? (
        <ul className="mt-4 space-y-2">
          {shown.length === 0 ? <li className="text-sm text-muted">{page.threads.length ? "None here." : "No messages yet."}</li> : null}
          {shown.map((thread) => (
            <li key={thread.memberId}>
              <Link
                to="/offices/$officeKey"
                params={{ officeKey }}
                search={{ member: thread.memberId, room: page.room }}
                className="pb-card ofc-row"
              >
                <Avatar name={thread.memberName} imageUrl={thread.memberImage} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">
                    {thread.memberName}
                    {thread.doorClosed ? <span className="office-door-tag"> · door closed</span> : null}
                  </span>
                  <span className="block truncate text-sm text-muted">{thread.lastBody || "No message yet"}</span>
                </span>
                {page.room !== "official" ? <StatusTag status={thread.status} /> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {page.kind === "notes" && !page.hasHead ? <p className="mt-4 text-sm text-muted">This office has no head yet.</p> : null}

      {showThread && page.kind === "notes" && !showThanksChoice && !showTestimony ? (
        <div className="ofc-thread">
          <div className="ofc-thread-who">
            <p className="ofc-name" style={{ fontSize: 15 }}>
              {page.isHead || page.isFounder ? page.memberName : page.headName ? `With ${page.headName}` : page.name}
            </p>
            {page.isHead && page.memberId && page.memberId !== seed.id ? (
              <button type="button" className={`office-door${page.doorClosed ? " is-closed" : ""}`} onClick={() => void toggleDoor()}>
                {page.doorClosed ? "Door closed · Open the door" : "Close the door"}
              </button>
            ) : page.isFounder && page.doorClosed ? (
              <p className="office-door is-closed">Door closed by the office</p>
            ) : null}
            {asker ? (
              <button type="button" className="mt-1 text-xs text-white/80" onClick={() => setThanksMode("choose")}>
                Back
              </button>
            ) : null}
            {page.room !== "official" && page.notes.length && ((thanks && page.memberId === seed.id && page.requestStatus !== "answered") || page.isHead) ? (
              <div className="pb-row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                {thanks && page.memberId === seed.id && page.requestStatus !== "answered" ? (
                  <button type="button" className="pb-chip" onClick={() => void markPrayer("answered")}>
                    God answered
                  </button>
                ) : null}
                {page.isHead && page.requestStatus === "open" ? (
                  <button type="button" className="pb-chip" onClick={() => void markPrayer("received")}>
                    Mark confirmed
                  </button>
                ) : null}
                {page.isHead && page.requestStatus !== "answered" ? (
                  <button type="button" className="pb-chip" onClick={() => void markPrayer("answered")}>
                    Mark answered
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div
            ref={scroller}
            onScroll={(event: UIEvent<HTMLDivElement>) => {
              const el = event.currentTarget;
              stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            className="ofc-thread-notes"
          >
            {page.notes.length === 0 ? (
              <p className="pb-quiet" style={{ paddingTop: 40, textAlign: "center", fontSize: 14 }}>{canWriteHere ? "Write your message below." : "Nothing here yet."}</p>
            ) : (
              page.notes.map((note) => {
                const day = dayLabel(note.createdAt);
                const showDay = day !== lastDay;
                lastDay = day;
                return (
                  <div key={note.id}>
                    {showDay ? (
                      <p className="pb-quiet" style={{ margin: "8px auto", width: "fit-content", fontSize: 12 }}>{day}</p>
                    ) : null}
                    <div className={`flex ${note.mine ? "justify-end" : "justify-start"}`}>
                      <div className={`ofc-bubble${note.mine ? " is-mine" : ""}`}>
                        <LinkText
                          text={note.body}
                          linkClass="underline underline-offset-2"
                        />
                        {note.official ? <p className="ofc-bubble-meta" style={{ fontWeight: 700 }}>Official</p> : null}
                        {note.held ? (
                          <p className="office-held">
                            <W k="office.not-sent">Not sent</W> ·{" "}
                            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("porch-trouble", { detail: "" }))}>
                              <W k="office.not-sent-help">Leave feedback for assistance</W>
                            </button>
                          </p>
                        ) : null}
                        <p className="ofc-bubble-meta">
                          <time dateTime={note.createdAt}>{clock(note.createdAt)}</time>
                          {note.mine ? null : ` · ${note.authorName}, ${page.name}`}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {canWriteHere && page.waiting ? (
            <p className="office-wait ofc-compose"><W k="office.waiting">Your message is with the office. You can write again when they reply.</W></p>
          ) : canWriteHere ? (
          <form onSubmit={onSubmit} className="ofc-compose">
            <label className="sr-only" htmlFor="office-note">
              Message
            </label>
            <textarea
              id="office-note"
              className="ofc-compose-box"
              rows={1}
              maxLength={2000}
              value={draft}
              placeholder="Write to the office…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <button
              type="submit"
              aria-label="Send"
              className="ofc-send"
              disabled={pending || !draft.trim()}
            >
              <Send className="size-5" aria-hidden="true" />
            </button>
          </form>
          ) : null}
        </div>
      ) : null}
      {error && page.kind !== "calendar" ? <Fault text={error} /> : null}
      </div>
    </div>
  );
}


/** The weekly programme: the office's head writes it; everyone in the church reads it. */
function WeeklyProgramme({ officeKey, text, canEdit, phaneroo, onSaved }: { officeKey: string; text: string; canEdit: boolean; phaneroo: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [note, setNote] = useState("");
  useEffect(() => setDraft(text), [text]);
  if (editing) {
    return (
      <form
        className="pb-card ofc-form"
        style={{ marginTop: 14 }}
        onSubmit={(event) => {
          event.preventDefault();
          void saveCalendar({ data: { key: officeKey, body: draft } }).then((result) => {
            if (!result.ok) {
              setNote(result.error);
              return;
            }
            setEditing(false);
            onSaved();
          });
        }}
      >
        <label className="ofc-lbl">
          This week (one line per day or meeting)
          <textarea className="ofc-input" style={{ minHeight: 180, padding: 12 }} value={draft} maxLength={4000} onChange={(event) => setDraft(event.target.value)} />
        </label>
        {note ? <p className="text-danger" style={{ margin: 0 }}>{note}</p> : null}
        <div className="ofc-admin">
          <button type="submit" className="pb-btn">Save</button>
          <button type="button" className="pb-btn2" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </form>
    );
  }
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return (
    <div style={{ marginTop: 14 }}>
      {lines.length ? (
        <ul className="pb-card ofc-list">
          {lines.map((line, index) => (
            <li key={index} className="ofc-row">{line}</li>
          ))}
        </ul>
      ) : phaneroo ? (
        <PastorWeek />
      ) : (
        <p className="pb-quiet">Nothing written for this week yet.</p>
      )}
      {canEdit ? (
        <button type="button" className="pb-btn2" style={{ marginTop: 12, width: "100%" }} onClick={() => setEditing(true)}>
          {lines.length ? "Change the programme" : "Write this week's programme"}
        </button>
      ) : null}
    </div>
  );
}

/** The office's head posts a short announcement. It shows pinned at the top of My porch. */
function AnnounceBox({ officeKey, officeName }: { officeKey: string; officeName: string }) {
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="pb-card ofc-form"
      style={{ marginTop: 14 }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.trim()) return;
        setBusy(true);
        void postAnnouncement({ data: { key: officeKey, body } })
          .then((result) => {
            setBusy(false);
            if (!result.ok) {
              setNote(result.error);
              return;
            }
            setBody("");
            setNote("Posted. It's pinned at the top of My porch.");
          })
          .catch(() => {
            setBusy(false);
            setNote("Couldn't post.");
          });
      }}
    >
      <label className="ofc-lbl">
        Announcement from the {officeName.replace(/^the /i, "")}
        <textarea className="ofc-input" style={{ minHeight: 90, padding: 12 }} value={body} maxLength={600} onChange={(event) => setBody(event.target.value)} placeholder="Shown pinned at the top of My porch. A new one replaces the last." />
      </label>
      {note ? <p className="pb-quiet" style={{ margin: 0, fontSize: 14 }}>{note}</p> : null}
      <button type="submit" className="pb-btn" disabled={busy || !body.trim()}>{busy ? "Posting…" : "Post announcement"}</button>
    </form>
  );
}
