import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

type Row = { label: string; value: string };
type Section = { heading: string; rows: Row[] };
type ReadingPage = {
  v: 1;
  title: string;
  subtitle: string;
  sections: Section[];
  final?: { label: string; value: string };
  kind?: "day";
  service?: string;
  date?: string;
  lines?: Row[];
};

function readPage(text: string): ReadingPage | null {
  try {
    const raw = JSON.parse(text) as ReadingPage;
    if (raw?.v === 1 && Array.isArray(raw.sections)) return raw;
  } catch {
    /* an older page is plain words */
  }
  return null;
}

function Sheet({ page }: { page: string }) {
  const reading = readPage(page);
  if (!reading) {
    return <p className="whitespace-pre-wrap text-sm leading-snug text-[#1e3a5f]">{page}</p>;
  }
  if (reading.kind === "day") return <DaySheet page={reading} />;
  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <div className="rounded-2xl bg-[#1e3a5f] px-4 py-3 text-white">
        <h2 className="font-display text-2xl leading-none">{reading.title}</h2>
        {reading.subtitle ? <p className="mt-1 text-xs font-semibold tracking-wide">{reading.subtitle}</p> : null}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {reading.sections.map((section, index) => (
          <section key={`${section.heading}-${index}`}>
            {section.heading ? (
              <h3 className="rounded-xl bg-[#e8eef6] px-3 py-2 text-sm font-bold text-[#1e3a5f]">{section.heading}</h3>
            ) : null}
            <ul className="mt-1">
              {section.rows.map((row) => (
                <li key={`${row.label}-${row.value}`} className="px-3 py-1 text-sm text-[#1e3a5f]">
                  <span className="font-semibold">{row.label ? `${row.label} — ${row.value}` : row.value}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {reading.final?.value ? (
        <div className="rounded-2xl bg-[#1e3a5f] px-4 py-3 text-white">
          <p className="text-xs font-bold tracking-wide">{reading.final.label}</p>
          <p className="font-display text-3xl leading-none">{reading.final.value}</p>
        </div>
      ) : null}
    </div>
  );
}

function DaySheet({ page }: { page: ReadingPage }) {
  const lines = page.lines ?? [];
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-white px-3 py-4 text-[#1e3a5f]">
      <div className="flex items-center gap-3 border-b border-[#d5dbe3] pb-3">
        <div className="min-w-0 flex-1 text-center">
          <p className="font-display text-2xl leading-none">Phaneroo</p>
          <p className="mt-1 text-[10px] font-semibold tracking-wide">MAKE MANIFEST</p>
          <p className="text-[10px] font-bold tracking-wide">MBARARA</p>
        </div>
        <div className="h-14 w-px bg-[#c5a35a]" />
        <div className="min-w-0 flex-1 text-center">
          <p className="text-sm font-black leading-tight">DAILY COLLECTIONS REPORT</p>
          {page.service ? <p className="mt-1 text-xs font-semibold tracking-wide">{page.service}</p> : null}
        </div>
      </div>
      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-[#e8eef6] text-left">
            <th className="w-8 border border-[#d5dbe3] px-2 py-2">#</th>
            <th className="border border-[#d5dbe3] px-2 py-2">CATEGORY</th>
            <th className="border border-[#d5dbe3] px-2 py-2 text-right">AMOUNT (UGX)</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={line.label} className={line.label === "TOTAL" ? "bg-[#e8eef6] font-bold" : ""}>
              <td className="border border-[#d5dbe3] px-2 py-2">{line.label === "TOTAL" ? "" : index + 1}</td>
              <td className="border border-[#d5dbe3] px-2 py-2">{line.label}</td>
              <td className="border border-[#d5dbe3] px-2 py-2 text-right">{line.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-8 text-right text-sm">
        Date: <span className="inline-block min-w-24 border-b border-[#1e3a5f] text-center">{page.date}</span>
      </p>
    </div>
  );
}

const pdfReady = new Map<string, ArrayBuffer>();

export function forgetPdf(src: string) {
  pdfReady.delete(src);
}

export function warmPdf(src: string) {
  if (pdfReady.has(src)) return;
  pdfReady.set(src, new ArrayBuffer(0));
  void fetch(src, { credentials: "include" })
    .then(async (response) => {
      if (!response.ok) {
        pdfReady.delete(src);
        return;
      }
      pdfReady.set(src, await response.arrayBuffer());
    })
    .catch(() => {
      pdfReady.delete(src);
    });
}

export function PdfBook({
  title,
  src,
  onClose,
  canEmpty,
  busy,
  onEmpty,
  edited,
  onFile,
}: {
  title: string;
  src: string;
  onClose: () => void;
  canEmpty?: boolean;
  busy?: boolean;
  onEmpty?: () => void;
  edited?: boolean;
  onFile?: (file: File) => void;
}) {
  const leftRef = useRef<HTMLCanvasElement>(null);
  const rightRef = useRef<HTMLCanvasElement>(null);
  const leftFrame = useRef<HTMLDivElement>(null);
  const rightFrame = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const lastTap = useRef(0);
  const [wide, setWide] = useState(false);
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(1);
  const [note, setNote] = useState("");
  const [zoom, setZoom] = useState(1);
  const [paintZoom, setPaintZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [opened, setOpened] = useState("");
  const pdfRef = useRef<PDFDocumentProxy | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 900px)");
    const apply = () => setWide(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    setPage(1);
    setCount(1);
    setNote("");
    setZoom(1);
    setPaintZoom(1);
    setPan({ x: 0, y: 0 });
  }, [src]);

  useEffect(() => {
    if (!wide) return;
    setPage((value) => (value % 2 === 0 ? Math.max(1, value - 1) : value));
    setZoom(1);
    setPaintZoom(1);
    setPan({ x: 0, y: 0 });
  }, [wide]);

  useEffect(() => {
    let cancel = false;
    const ready = pdfReady.get(src);
    const task = getDocument(ready && ready.byteLength > 0 ? { data: ready.slice(0) } : { url: src, withCredentials: true });
    task.promise
      .then((pdf) => {
        if (cancel) return;
        pdfRef.current = pdf;
        setCount(pdf.numPages);
        setOpened(src);
      })
      .catch(() => {
        if (!cancel) setNote("This PDF could not be opened.");
      });
    return () => {
      cancel = true;
      pdfRef.current = null;
      void task.destroy();
    };
  }, [src]);

  useEffect(() => {
    const pdf = pdfRef.current;
    const leftCanvas = leftRef.current;
    const leftBox = leftFrame.current;
    if (!pdf || !leftCanvas || !leftBox) return;
    const rightCanvas = rightRef.current;
    const rightBox = rightFrame.current;
    let cancel = false;
    let running: { cancel: () => void } | null = null;
    const paint = async (canvas: HTMLCanvasElement, frame: HTMLDivElement, pageNo: number) => {
      if (pageNo > pdf.numPages) {
        canvas.width = 0;
        canvas.height = 0;
        return;
      }
      const box = frame.getBoundingClientRect();
      if (box.width < 8 || box.height < 8) return;
      const sheet = await pdf.getPage(pageNo);
      if (cancel) return;
      const base = sheet.getViewport({ scale: 1 });
      const fit = Math.min(box.width / base.width, box.height / base.height);
      const pixel = Math.min(window.devicePixelRatio || 1, 2) * paintZoom;
      const viewport = sheet.getViewport({ scale: fit * pixel });
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      canvas.style.width = `${Math.max(1, base.width * fit)}px`;
      canvas.style.height = `${Math.max(1, base.height * fit)}px`;
      const rendered = sheet.render({ canvasContext: context, viewport });
      running = rendered;
      try {
        await rendered.promise;
      } catch {
        /* a newer page took this canvas */
      }
    };
    const draw = async () => {
      await paint(leftCanvas, leftBox, page);
      if (cancel || !wide || !rightCanvas || !rightBox) return;
      await paint(rightCanvas, rightBox, page + 1);
    };
    void draw();
    const watch = new ResizeObserver(() => {
      void draw();
    });
    watch.observe(leftBox);
    if (rightBox) watch.observe(rightBox);
    return () => {
      cancel = true;
      running?.cancel();
      watch.disconnect();
    };
  }, [src, page, wide, paintZoom, count, opened]);

  function lastStart() {
    if (!wide) return count;
    return count % 2 === 0 ? Math.max(1, count - 1) : count;
  }

  function turn(by: number) {
    setZoom(1);
    setPaintZoom(1);
    setPan({ x: 0, y: 0 });
    setPage((value) => {
      const step = wide ? 2 : 1;
      return Math.min(lastStart(), Math.max(1, value + by * step));
    });
  }

  function clampPan(nextX: number, nextY: number, nextZoom: number) {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage || nextZoom <= 1) return { x: 0, y: 0 };
    const limitX = (stage.width * (nextZoom - 1)) / 2;
    const limitY = (stage.height * (nextZoom - 1)) / 2;
    return {
      x: Math.max(-limitX, Math.min(limitX, nextX)),
      y: Math.max(-limitY, Math.min(limitY, nextY)),
    };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), zoom };
      drag.current = null;
      return;
    }
    drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2 && pinch.current && pinch.current.dist > 12) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const next = Math.min(4, Math.max(1, pinch.current.zoom * (dist / pinch.current.dist)));
      setZoom(next);
      if (next <= 1.02) setPan({ x: 0, y: 0 });
      return;
    }
    if (!drag.current || zoom <= 1.02) return;
    const next = clampPan(drag.current.panX + event.clientX - drag.current.x, drag.current.panY + event.clientY - drag.current.y, zoom);
    setPan(next);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = drag.current;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size >= 1) {
      pinch.current = null;
      drag.current = null;
      return;
    }
    pinch.current = null;
    drag.current = null;
    setPaintZoom(zoom);
    if (!start || zoom > 1.02) {
      if (zoom > 1.02 && start) {
        const now = Date.now();
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && now - lastTap.current < 280) {
          setZoom(1);
          setPaintZoom(1);
          setPan({ x: 0, y: 0 });
          lastTap.current = 0;
          return;
        }
        lastTap.current = now;
      }
      return;
    }
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (dx < -48) {
      turn(1);
      return;
    }
    if (dx > 48) {
      turn(-1);
      return;
    }
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) return;
    const now = Date.now();
    const stage = stageRef.current?.getBoundingClientRect();
    const x = stage ? event.clientX - stage.left : 0;
    const onEdge = Boolean(stage && (x < stage.width * 0.22 || x > stage.width * 0.78));
    if (!onEdge && now - lastTap.current < 280) {
      setZoom(1);
      setPaintZoom(1);
      setPan({ x: 0, y: 0 });
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    if (!stage || onEdge === false) return;
    if (x < stage.width * 0.22) turn(-1);
    else if (x > stage.width * 0.78) turn(1);
  }

  const atEnd = page >= lastStart();
  const label = wide ? `${page}–${Math.min(page + 1, count)} of ${count}` : `${page} of ${count}`;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#1a120c]">
      <div className="flex items-center justify-between px-3 py-2">
        <button type="button" className="flex min-h-12 items-center gap-1 text-base font-semibold text-[#f6edd8]" onClick={onClose}>
          <ChevronLeft className="size-5" aria-hidden="true" />
          Back
        </button>
        <p className="truncate text-sm font-bold text-[#f6edd8]">
          {title}
          {edited ? <span className="text-red-600"> edited</span> : null}
        </p>
        {onFile ? (
          <label className="min-h-12 cursor-pointer font-bold text-[#f6edd8]">
            Replace
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onFile(file);
              }}
            />
          </label>
        ) : canEmpty && onEmpty ? (
          <button type="button" className="min-h-12 font-bold text-[#f6edd8]" disabled={busy} onClick={onEmpty}>
            Delete
          </button>
        ) : (
          <span className="w-12" />
        )}
      </div>
      {note ? <p className="px-4 text-sm font-bold text-[#f6edd8]">{note}</p> : null}
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 items-stretch px-2 pb-2">
        <PageEdge pages={page - 1} side="left" />
        <div
          ref={stageRef}
          className="relative flex min-h-0 min-w-0 flex-1 touch-none overflow-hidden rounded-sm bg-[#f4efe4] shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div
            className="flex min-h-0 min-w-0 flex-1 items-center justify-center"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center center" }}
          >
            <div ref={leftFrame} className="flex h-full min-w-0 flex-1 items-center justify-center">
              <canvas ref={leftRef} />
            </div>
            {wide ? (
              <div ref={rightFrame} className="flex h-full min-w-0 flex-1 items-center justify-center border-l border-[#c9b89a]">
                <canvas ref={rightRef} />
              </div>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Previous page"
            className="absolute inset-y-0 left-0 flex w-[18%] items-center justify-start pl-1 text-[#1a120c]/40 disabled:opacity-0"
            style={{ pointerEvents: zoom > 1.02 ? "none" : "auto" }}
            disabled={page <= 1}
            onClick={() => turn(-1)}
          >
            <ChevronLeft className="size-7" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next page"
            className="absolute inset-y-0 right-0 flex w-[18%] items-center justify-end pr-1 text-[#1a120c]/40 disabled:opacity-0"
            style={{ pointerEvents: zoom > 1.02 ? "none" : "auto" }}
            disabled={atEnd}
            onClick={() => turn(1)}
          >
            <ChevronRight className="size-7" aria-hidden="true" />
          </button>
        </div>
        <PageEdge pages={Math.max(0, count - (wide ? page + 1 : page))} side="right" />
      </div>
      <p className="pb-[max(12px,env(safe-area-inset-bottom))] text-center text-sm font-semibold text-[#f6edd8]">{label}</p>
    </div>,
    document.body,
  );
}

function PageEdge({ pages, side }: { pages: number; side: "left" | "right" }) {
  const shown = Math.min(16, Math.max(0, pages));
  if (!shown) return <span className="w-2 shrink-0" />;
  return (
    <div
      aria-hidden
      className={`flex h-[92%] shrink-0 self-center ${side === "left" ? "flex-row-reverse" : ""}`}
      style={{ width: 6 + shown * 2 }}
    >
      {Array.from({ length: shown }, (_, index) => (
        <span key={index} className="h-full w-[2px] bg-[#f7f1e4] shadow-[1px_0_0_#b7a78a]" />
      ))}
    </div>
  );
}

export function ReadingBook({
  pages,
  onClose,
  canEmpty,
  busy,
  onEmpty,
  edited,
}: {
  pages: string[];
  onClose: () => void;
  canEmpty?: boolean;
  busy?: boolean;
  onEmpty?: () => void;
  edited?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const at = Math.min(index, Math.max(0, pages.length - 1));
  const count = Math.max(1, pages.length);
  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#eef2f6]">
      <div className="flex items-center justify-between px-3 py-2">
        <button type="button" className="flex min-h-12 items-center gap-1 text-base font-semibold text-[#1e3a5f]" onClick={onClose}>
          <ChevronLeft className="size-5" aria-hidden="true" />
          Back
        </button>
        <p className="text-sm font-semibold text-[#1e3a5f]">
          {at + 1} / {count}
          {edited ? <span className="text-red-600"> edited</span> : null}
        </p>
        {canEmpty && onEmpty ? (
          <button type="button" className="min-h-12 font-semibold text-[#1e3a5f]" disabled={busy} onClick={onEmpty}>
            Delete
          </button>
        ) : (
          <span className="w-12" />
        )}
      </div>
      <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col px-3">
        {pages.length === 0 ? (
          <p className="text-sm font-semibold text-[#1e3a5f]">Nothing has been uploaded yet.</p>
        ) : (
          <Sheet page={pages[at] ?? ""} />
        )}
      </div>
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          className="min-h-12 font-semibold text-[#1e3a5f] disabled:opacity-30"
          disabled={at <= 0}
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
        >
          Previous
        </button>
        <button
          type="button"
          className="min-h-12 font-semibold text-[#1e3a5f] disabled:opacity-30"
          disabled={at >= count - 1}
          onClick={() => setIndex((value) => value + 1)}
        >
          Next
        </button>
      </div>
    </div>,
    document.body,
  );
}
