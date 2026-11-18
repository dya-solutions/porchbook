import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import {
  HOO_DESKS,
  HOO_FOLDERS,
  decideHooNote,
  loadHooBoard,
  loadHooFolder,
  saveHooPages,
  setFamilyWriter,
  type HooDesk,
  type HooFolder,
  type HooNote,
} from "@/lib/porch/hoo-reports";
import { loadDeskReading, loadOfficeFile } from "@/lib/porch/office-book";
import { fieldClass, quietButtonClass } from "@/components/porch/bits";
import { Fault } from "@/components/porch/trouble";
import { ReportBook } from "@/components/porch/report-book";
import { LibraryBook } from "@/components/porch/library-book";
import { clothOf, writtenPages, type BookMeta, type LibraryPages } from "@/lib/porch/pdf-book";
import { useShelfPhoto } from "@/components/porch/shelf";
import { BookHide } from "@/components/porch/hide";

function useSeed() {
  const user = useCurrentUser();
  return {
    id: user?.id ?? "",
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };
}

function OfficeFile({
  title,
  officeKey,
  pages,
  hasPdf,
  edited,
  onClose,
}: {
  title: string;
  officeKey: string;
  pages: string[];
  hasPdf: boolean;
  edited?: boolean;
  onClose: () => void;
}) {
  const seed = useSeed();
  const [library, setLibrary] = useState<LibraryPages | null>(hasPdf ? null : writtenPages(pages));
  const [meta, setMeta] = useState<BookMeta>({ author: "", summary: "", cover: "" });
  const [scan, setScan] = useState("");
  const [waiting, setWaiting] = useState(hasPdf);

  useEffect(() => {
    if (!hasPdf || !seed.id) return;
    let cancel = false;
    loadOfficeFile({
      data: {
        displayName: seed.displayName,
        email: seed.email,
        imageUrl: seed.imageUrl,
        key: officeKey,
        part: title,
        snapshot: true,
      },
    })
      .then((result) => {
        if (cancel || !result.ok) return;
        setLibrary(result.library);
        setMeta(result.meta ?? { author: "", summary: "", cover: "" });
        setScan(result.scan ?? (result.library ? "" : "This PDF could not be read."));
        setWaiting(false);
      })
      .catch(() => {
        if (cancel) return;
        setScan("This PDF could not be read.");
        setWaiting(false);
      });
    return () => {
      cancel = true;
    };
  }, [hasPdf, officeKey, seed.displayName, seed.email, seed.id, seed.imageUrl, title]);

  if (waiting) {
    return (
      <div className="fixed inset-0 z-[80] flex flex-col bg-[#cbbba4]">
        <button type="button" className="flex min-h-12 items-center gap-1 px-3 text-base font-semibold text-[#2a2118]" onClick={onClose}>
          <ChevronLeft className="size-5" aria-hidden="true" />
          Back
        </button>
        <p className="px-6 pt-8 text-lg font-semibold text-[#2a2118]">Opening the book…</p>
      </div>
    );
  }

  const laid = library ?? [];
  return (
    <LibraryBook
      title={title}
      pages={laid}
      meta={meta}
      empty={scan || (laid.length ? "" : "Nothing has been written in this file yet.")}
      edited={edited}
      onClose={onClose}
    />
  );
}

function Docket({ label, edited, onOpen, lean = 0, spine = false }: { label: string; edited?: boolean; onOpen: () => void; lean?: number; spine?: boolean }) {
  return (
    <button type="button" onClick={onOpen} className={`no-sink case-book ${spine ? "stand-spine" : ""}`} style={{ ["--lean" as string]: `${lean}deg` }}>
      <span className="book-spine flex w-[11%] shrink-0 items-center justify-center overflow-hidden text-[#faf6ee]" style={{ writingMode: "vertical-rl", backgroundColor: clothOf(label) }} aria-hidden="true">
        <span className="max-h-[92%] overflow-hidden text-[8px] leading-tight tracking-wide">{label.length > 32 ? `${label.slice(0, 30)}…` : label}</span>
      </span>
      <BookHide className="relative flex min-w-0 flex-1 flex-col items-center justify-center px-2">
        <span className="butterfly butterfly-still absolute right-1.5 bottom-1.5 size-5 shrink-0" aria-hidden="true">
          <img src="/wing-left.png?v=5" alt="" className="butterfly-wing butterfly-left" />
          <img src="/wing-right.png?v=5" alt="" className="butterfly-wing butterfly-right" />
        </span>
        <span className="book-title absolute top-1.5 right-1 left-1 text-center leading-tight break-words">
          {label}
          {edited ? <span className="text-red-600"> edited</span> : null}
        </span>
      </BookHide>
    </button>
  );
}

function DocketRow({ items, onOpen }: { items: { key: string; label: string; edited?: boolean }[]; onOpen: (key: string) => void }) {
  useShelfPhoto();
  const per = Math.max(3, Math.ceil(items.length / 5));
  const cradles = [0, 1, 2, 3, 4].map((row) => items.slice(row * per, (row + 1) * per));
  return (
    <div className="office-photo mt-4">
      <img src="/office-dark-shelf.jpg" alt="" />
      {cradles.map((row, index) => (
        <div key={index} className={`office-photo-bay bay-${index}`}>
          {row.map((item, bookIndex) => (
            <Docket
              key={item.key}
              label={item.label}
              edited={item.edited}
              lean={0}
              spine={index === 2 && bookIndex > 0}
              onOpen={() => onOpen(item.key)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function HooBoard() {
  const seed = useSeed();
  const [desks, setDesks] = useState<HooDesk[]>([]);
  const [founder, setFounder] = useState(false);
  const [people, setPeople] = useState<{ userId: string; displayName: string }[]>([]);
  const [familyId, setFamilyId] = useState("");
  const [desk, setDesk] = useState<HooDesk | null>(null);
  const [folder, setFolder] = useState<HooFolder | null>(null);
  const [notes, setNotes] = useState<HooNote[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [canDecide, setCanDecide] = useState(false);
  const [pages, setPages] = useState<string[]>([""]);
  const [books, setBooks] = useState<{ title: string; pages: string[]; edited: boolean; hasPdf: boolean }[]>([]);
  const [hofBooks, setHofBooks] = useState<{ title: string; pages: string[]; edited: boolean; hasPdf: boolean }[]>([]);
  const [front, setFront] = useState<{ title: string; pages: string[]; edited: boolean; hasPdf: boolean } | null>(null);
  const [openBook, setOpenBook] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  const data = { displayName: seed.displayName, email: seed.email, imageUrl: seed.imageUrl };

  useEffect(() => {
    if (!seed.id) return;
    let cancel = false;
    loadHooBoard({ data })
      .then((result) => {
        if (cancel) return;
        setDesks(result.desks);
        setFounder(result.isFounder);
        setPeople(result.people);
        setFamilyId(result.familyWriterId);
      })
      .catch(() => {
        if (!cancel) setError("Couldn't open the reports.");
      });
    return () => {
      cancel = true;
    };
  }, [seed.id, seed.displayName, seed.email, seed.imageUrl, tick]);

  useEffect(() => {
    if (!seed.id) return;
    let cancel = false;
    loadDeskReading({ data: { ...data, desk: "hof" } })
      .then((result) => {
        if (cancel || !result.ok) return;
        setHofBooks(
          result.books.map((book) => ({
            title: book.title,
            pages: book.body ? book.body.split("\f").slice(0, 24) : [],
            edited: book.edited,
            hasPdf: book.hasPdf,
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [seed.id, seed.displayName, seed.email, seed.imageUrl, tick]);

  useEffect(() => {
    if (!seed.id || !desk) return;
    let cancel = false;
    setOpenBook(null);
    setBooks([]);
    loadDeskReading({ data: { ...data, desk } })
      .then((result) => {
        if (cancel || !result.ok) return;
        setBooks(
          result.books.map((book) => ({
            title: book.title,
            pages: book.body ? book.body.split("\f").slice(0, 24) : [],
            edited: book.edited,
            hasPdf: book.hasPdf,
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [seed.id, seed.displayName, seed.email, seed.imageUrl, desk, tick]);

  useEffect(() => {
    if (!seed.id || !desk || !folder) return;
    let cancel = false;
    loadHooFolder({ data: { ...data, desk, folder } })
      .then((result) => {
        if (cancel) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setNotes(result.notes);
        setPages(result.pages ? result.pages.split("\f").slice(0, 8) : [""]);
        setCanWrite(result.canWrite);
        setCanDecide(result.canDecide);
      })
      .catch(() => {
        if (!cancel) setError("Couldn't open that folder.");
      });
    return () => {
      cancel = true;
    };
  }, [seed.id, seed.displayName, seed.email, seed.imageUrl, desk, folder, tick]);

  async function chooseFamily(userId: string) {
    setError("");
    const result = await setFamilyWriter({ data: { ...data, userId } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTick((value) => value + 1);
  }

  async function savePages() {
    if (!desk || !folder) return;
    setError("");
    const result = await saveHooPages({ data: { ...data, desk, folder, body: pages.join("\f").slice(0, 5200) } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError("Saved.");
  }

  async function answer(reportId: number, decision: "yes" | "notyet") {
    if (decision === "notyet" && !reason.trim()) {
      setAsking(true);
      setError("Say why not yet.");
      return;
    }
    setError("");
    const result = await decideHooNote({
      data: { ...data, reportId, decision, reason: decision === "notyet" ? reason : "" },
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setReason("");
    setAsking(false);
    setTick((value) => value + 1);
  }

  const deskLabel = HOO_DESKS.find((item) => item.key === desk)?.label ?? "";
  const folderLabel = HOO_FOLDERS.find((item) => item.key === folder)?.label ?? "";

  if (front) {
    return (
      <OfficeFile
        title={front.title}
        officeKey="hof"
        pages={front.pages}
        hasPdf={front.hasPdf}
        edited={front.edited}
        onClose={() => setFront(null)}
      />
    );
  }

  if (!desk) {
    return (
      <div className="mt-5">
        {desks.length === 0 ? <p className="text-sm text-muted">No report is yours yet.</p> : null}
        <DocketRow
          items={[
            ...HOO_DESKS.filter((item) => desks.includes(item.key)).map((item) => ({ key: item.key, label: item.label })),
            ...hofBooks.map((book) => ({ key: `hof:${book.title}`, label: book.title, edited: book.edited })),
          ]}
          onOpen={(key) => {
            const book = hofBooks.find((item) => `hof:${item.title}` === key);
            if (book) {
              setFront(book);
              return;
            }
            setDesk(key as HooDesk);
          }}
        />
        {founder ? (
          <label className="mt-4 block text-sm text-muted">
            Family Department writer
            <select
              className={`${fieldClass} mt-1`}
              value={familyId}
              onChange={(event) => {
                if (event.target.value) void chooseFamily(event.target.value);
              }}
            >
              <option value="">Choose a person</option>
              {people.map((person) => (
                <option key={person.userId} value={person.userId}>
                  {person.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Fault text={error} className="mt-3" />
      </div>
    );
  }

  if (!folder) {
    if (openBook) {
      const book = books.find((item) => item.title === openBook);
      const office = HOO_DESKS.find((item) => item.key === desk)?.office;
      if (book && office) {
        return (
          <OfficeFile
            title={book.title}
            officeKey={office}
            pages={book.pages}
            hasPdf={book.hasPdf}
            edited={book.edited}
            onClose={() => setOpenBook(null)}
          />
        );
      }
    }
    return (
      <div className="mt-5">
        <button type="button" className={`${quietButtonClass} px-0`} onClick={() => setDesk(null)}>
          <ChevronLeft className="size-5" aria-hidden="true" />
          {deskLabel}
        </button>
        <DocketRow
          items={[
            ...(books.map((book) => ({ key: book.title, label: book.title, edited: book.edited }))),
            ...HOO_FOLDERS.map((item) => ({ key: item.key, label: item.label })),
          ]}
          onOpen={(key) => {
            if (books.some((book) => book.title === key)) setOpenBook(key);
            else setFolder(key as HooFolder);
          }}
        />
      </div>
    );
  }

  return (
    <ReportBook
      name={folderLabel}
      pages={pages}
      canEdit={canWrite}
      note={error}
      busy={false}
      onWrite={(index, value) => setPages((current) => current.map((page, i) => (i === index ? value : page)))}
      onAdd={() => setPages((current) => (current.length >= 8 ? current : [...current, ""]))}
      onSave={() => void savePages()}
      onClose={() => {
        setFolder(null);
        setAsking(false);
        setReason("");
        setError("");
        setPages([""]);
      }}
      extra={
        folder === "approval" && canDecide && notes[0] && notes[0].decision !== "yes" ? (
          <span className="flex items-center gap-2">
            {asking ? (
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why not yet?"
                className="w-36 rounded bg-[#f6edd8] px-2 py-1 text-[#1c140c]"
              />
            ) : null}
            <button type="button" className="font-semibold text-[#f8a018]" onClick={() => void answer(notes[0].id, "yes")}>
              Yes
            </button>
            <button
              type="button"
              className="font-semibold text-[#f6edd8]"
              onClick={() => {
                if (!asking) {
                  setAsking(true);
                  return;
                }
                void answer(notes[0].id, "notyet");
              }}
            >
              Not yet
            </button>
          </span>
        ) : null
      }
    />
  );
}
