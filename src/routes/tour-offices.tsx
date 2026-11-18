import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { AppFrame } from "@/components/porch/frame";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { OFFICE_PARTS } from "@/lib/porch/offices";
import { listOfficeBooks, loadDeskReading } from "@/lib/porch/office-book";
import { HOO_DESKS, loadHooBoard } from "@/lib/porch/hoo-reports";
import { BookHide } from "@/components/porch/hide";
import { BookShelf } from "@/components/porch/offices-view";
import { HooBoard } from "@/components/porch/hoo-board";
import { playOfficeBell } from "@/lib/porch/button-sound-play";
import { cachedVideo, walkSrc, warmTourMedia } from "@/lib/porch/media-cache";
import { isLite } from "@/lib/porch/lite";
import { clothOf } from "@/lib/porch/pdf-book";
import { quietButtonClass } from "@/components/porch/bits";

// Office touring is switched off (founder's choice): old links go to the Offices list.
// The walk is kept here, unused, in case it ever comes back.
export const Route = createFileRoute("/tour-offices")({
  beforeLoad: () => {
    throw redirect({ to: "/offices" });
  },
  component: TourOfficesPage,
});

const DOORS = [
  { key: "pastor", plate: "Pastor", x: 0.113, y: 0.456 },
  { key: "hoo", plate: "H.O.O", x: 0.896, y: 0.457 },
  { key: "administrator", plate: "Administrator", x: 0.313, y: 0.485 },
  { key: "hof", plate: "H.O.F", x: 0.654, y: 0.5 },
  { key: "communications", plate: "Communications", x: 0.392, y: 0.496 },
  { key: "missions", plate: "Missions", x: 0.729, y: 0.485 },
  { key: "centre", plate: "Centre", x: 0.528, y: 0.512 },
  // A door further down the hall (no walking film yet: it goes straight in).
  { key: "pastoral", plate: "Pastoral Support", x: 0.464, y: 0.505, noWalk: true },
] as const;

type Phase = "hall" | "room" | "shelf";

function TourOfficesPage() {
  return (
    <AppFrame>
      <TourHall />
    </AppFrame>
  );
}

function TourHall() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const arrivedRef = useRef(false);
  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };
  const [aimed, setAimed] = useState<number | null>(null);
  const [arrived, setArrived] = useState(false);
  const [phase, setPhase] = useState<Phase>("hall");
  const [office, setOffice] = useState<(typeof DOORS)[number]["key"]>("pastor");
  const [books, setBooks] = useState<string[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [real, setReal] = useState(false);
  const [hooSpines, setHooSpines] = useState<string[]>([]);
  const [showHoo, setShowHoo] = useState(false);
  const [hooReady, setHooReady] = useState(true);
  const film = useRef<HTMLVideoElement>(null);
  const [filmOn, setFilmOn] = useState(false);

  const door = DOORS.find((item) => item.key === office) ?? DOORS[0];
  // Report boards: the H.O.O's office, and the Pastor's and Pastoral Support's (its report goes to the Pastor).
  const reportRoom = office === "hoo" || office === "pastor" || office === "pastoral";
  const spines = reportRoom ? [...new Set([...hooSpines, ...books])] : books;

  useEffect(() => {
    warmTourMedia();
  }, []);

  useEffect(() => {
    if (phase === "hall" || !user?.id) return;
    let cancel = false;
    listOfficeBooks({ data: { ...seed, key: office } })
      .then((result) => {
        if (cancel || !result.ok) return;
        setCanEdit(result.head);
        const parts = OFFICE_PARTS[office] ?? [];
        const names = [...result.books.filter((part) => !parts.includes(part)), ...parts].filter((part) => !result.removed.includes(part));
        setBooks(names);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, office, user?.id]);

  useEffect(() => {
    if (phase === "hall" || !(office === "hoo" || office === "pastor" || office === "pastoral") || !user?.id) {
      setHooSpines([]);
      setShowHoo(false);
      setHooReady(true);
      return;
    }
    let cancel = false;
    setHooReady(false);
    Promise.all([loadHooBoard({ data: seed }), loadDeskReading({ data: { ...seed, desk: "hof" } })])
      .then(([board, reading]) => {
        if (cancel) return;
        // In the Pastor's and Pastoral Support's rooms, only the reports that go to the Pastor.
        const here = office === "hoo" ? HOO_DESKS : HOO_DESKS.filter((item) => item.key === "pastor" || item.key === "pastoral");
        const labels = here.filter((item) => board.desks.includes(item.key)).map((item) => item.label);
        const shared = office === "hoo" && reading.ok ? reading.books.map((book) => book.title) : [];
        setHooSpines([...labels, ...shared]);
        setShowHoo(labels.length > 0 || board.isFounder);
        setHooReady(true);
      })
      .catch(() => {
        if (!cancel) setHooReady(true);
      });
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, office, user?.id]);

  function aimAt(index: number) {
    const chosen = DOORS[index];
    let seen = false;
    try {
      seen = sessionStorage.getItem(`porch-walk-seen:${chosen.key}`) === "1";
    } catch {
      seen = false;
    }
    // Lite (or a door without a walking film): go straight in.
    if (seen || isLite() || ("noWalk" in chosen && chosen.noWalk)) {
      arrivedRef.current = true;
      setAimed(index);
      setArrived(true);
      enterOffice(index);
      return;
    }
    void navigate({ to: "/porchguy", search: { film: chosen.key, worship: "" } } as unknown as Parameters<typeof navigate>[0]);
  }

  function enterOffice(index: number) {
    if (!arrivedRef.current) return;
    const chosen = DOORS[index];
    playOfficeBell();
    setOffice(chosen.key);
    setCanEdit(false);
    setBooks([...(OFFICE_PARTS[chosen.key] ?? [])]);
    setPhase("room");
  }

  function openShelf() {
    setPhase("shelf");
  }

  function back() {
    if (phase === "shelf") {
      setPhase("room");
      return;
    }
    film.current?.pause();
    setFilmOn(false);
    setAimed(null);
    arrivedRef.current = false;
    setArrived(false);
    setPhase("hall");
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="font-display text-3xl text-ink">TourOffices</h1>
        {phase === "hall" && aimed == null ? (
          <Link to="/offices" className={`${quietButtonClass} px-0`}>
            Offices
          </Link>
        ) : (
          <button type="button" className="text-base font-bold text-white" onClick={back}>
            Back
          </button>
        )}
      </div>

      {phase === "hall" ? (
        <>
          <div
            className="relative h-[68vh] overflow-hidden rounded-xl bg-cover bg-center"
            style={{ backgroundImage: "url(/tour-corridor.jpg)", containerType: "size" }}
          >
            <div className="absolute inset-0">
              <img src="/tour-corridor.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
              <video
                ref={film}
                poster="/tour-corridor.jpg"
                muted
                playsInline
                preload="auto"
                onPlaying={() => setFilmOn(true)}
                onEnded={(event) => {
                  if (event.currentTarget.currentTime > 0.3) setArrived(true);
                }}
                onClick={() => {
                  if (aimed != null) enterOffice(aimed);
                }}
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-150 ${aimed != null && filmOn ? "opacity-100" : "pointer-events-none opacity-0"}`}
              />
              {aimed == null
                ? DOORS.map((item, index) => (
                    <button
                      key={item.key}
                      type="button"
                      aria-label={item.plate}
                      onClick={() => aimAt(index)}
                      className="absolute z-10"
                      style={
                        {
                          "--stage-w": "max(100cqw, calc(100cqh * 1008 / 1792))",
                          "--stage-h": "max(100cqh, calc(100cqw * 1792 / 1008))",
                          left: `calc((100cqw - var(--stage-w)) / 2 + ${item.x} * var(--stage-w) - 11px)`,
                          top: `calc((100cqh - var(--stage-h)) / 2 + ${item.y} * var(--stage-h) - 11px)`,
                          width: 22,
                          height: 22,
                        } as CSSProperties
                      }
                    >
                      <span className="absolute top-1/2 left-1/2 size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#1f9d4a] shadow-[0_0_0_2px_#fff]" />
                    </button>
                  ))
                : null}
              {arrived && aimed != null ? (
                <button type="button" className="absolute inset-x-0 bottom-3 z-10 text-sm font-bold text-white drop-shadow" onClick={() => aimed != null && enterOffice(aimed)}>
                  Tap the door
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <div
          className="relative h-[68vh] overflow-hidden rounded-xl bg-cover bg-center"
          style={{ backgroundImage: "url(/tour-office.jpg)", containerType: "size" }}
        >
          <img src="/tour-office.jpg" alt="" className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${phase === "shelf" ? "opacity-30" : "opacity-100"}`} />
          <p className="pointer-events-none absolute top-[8%] right-[12%] left-[12%] text-center text-sm font-bold text-white drop-shadow">{door.plate}</p>
          {phase === "shelf" ? (
            <div className="shelf-in absolute inset-2 z-20 overflow-y-auto">
              {reportRoom && showHoo ? <HooBoard /> : null}
              <BookShelf key={office} officeKey={office} tick={0} parts={OFFICE_PARTS[office] ?? []} canEdit={canEdit} canEmpty={canEdit} />
            </div>
          ) : (
            <button
              type="button"
              onClick={openShelf}
              className="absolute z-20 overflow-hidden text-left"
              style={
                {
                  "--stage-w": "max(100cqw, calc(100cqh * 1008 / 1792))",
                  "--stage-h": "max(100cqh, calc(100cqw * 1792 / 1008))",
                  left: "calc((100cqw - var(--stage-w)) / 2 + 0.215 * var(--stage-w))",
                  top: "calc((100cqh - var(--stage-h)) / 2 + 0.392 * var(--stage-h))",
                  width: "calc(0.53 * var(--stage-w))",
                  height: "calc(0.068 * var(--stage-h))",
                } as CSSProperties
              }
            >
                <span className="flex h-full items-end gap-px overflow-hidden">
                  {spines.length === 0 && (office !== "hoo" || hooReady) ? (
                    <span className="px-1 text-[8px] font-semibold leading-tight text-[#f4ead8]">This shelf is clear.</span>
                  ) : null}
                  {spines.map((part) => (
                    <span
                      key={part}
                      className="relative h-[94%] shrink-0 overflow-hidden rounded-[1px] shadow-[1px_2px_2px_rgba(0,0,0,0.45)]"
                      style={{ width: `${Math.min(18, 94 / Math.max(spines.length, 1))}%` }}
                    >
                      <span className="absolute inset-y-0 left-0 w-[11%]" style={{ backgroundColor: clothOf(part) }} />
                      <BookHide className="absolute inset-y-0 right-0 left-[10%]">
                        <span className="book-title absolute top-px right-px left-px line-clamp-3 text-center text-[6px] leading-none break-words">{part}</span>
                      </BookHide>
                    </span>
                  ))}
                </span>
              </button>
          )}
          {phase === "room" ? <p className="pointer-events-none absolute bottom-3 left-0 right-0 z-20 text-center text-sm font-semibold text-white drop-shadow">Tap the shelf</p> : null}
        </div>
      )}
    </div>
  );
}
