import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { getBearerToken } from "@/lib/auth/client";

GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Shelf books: the original PDF, page after page, scrolling down.
 * Pages are drawn only near the screen, the place is remembered, a slider jumps through the book,
 * and two fingers zoom in.
 */

const kept = new Map<string, ArrayBuffer>();
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const GAP = 10;

function placeKey(bookKey: string) {
  return `porch-pdf-place:${bookKey}`;
}
function readPlace(bookKey: string): number {
  try {
    const value = Number(localStorage.getItem(placeKey(bookKey)));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}
function savePlace(bookKey: string, place: number) {
  try {
    localStorage.setItem(placeKey(bookKey), place.toFixed(3));
  } catch {
    /* this visit only */
  }
}

async function loadBytes(bookKey: string, version: number) {
  const id = `${bookKey}:${version}`;
  const ready = kept.get(id);
  if (ready) return ready.slice(0);
  const token = getBearerToken();
  // No data: the downloaded copy, if this PDF is on the phone.
  const response = await fetch(`/api/read-pdf?key=${encodeURIComponent(bookKey)}`, {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  }).catch(async (error) => {
    const { keptPdf } = await import("@/lib/porch/offline-books");
    const local = await keptPdf(bookKey);
    if (local) return new Response(local);
    throw navigator.onLine === false ? new Error("No data, and this PDF isn't downloaded.") : error;
  });
  if (!response.ok) throw new Error(await response.text().catch(() => "This PDF could not be opened."));
  const bytes = await response.arrayBuffer();
  kept.set(id, bytes);
  return bytes.slice(0);
}

export function PdfScroll({
  title,
  bookKey,
  version = 0,
  onClose,
  onFile,
  extra,
}: {
  title: string;
  bookKey: string;
  version?: number;
  onClose: () => void;
  onFile?: (file: File) => void;
  /** Something extra in the top bar (⬇ Download). */
  extra?: React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const [mounted, setMounted] = useState(false);
  const [count, setCount] = useState(0);
  const [ratios, setRatios] = useState<number[]>([]);
  const [width, setWidth] = useState(360);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [note, setNote] = useState("Opening the book…");
  const [near, setNear] = useState<Set<number>>(new Set());
  const [sliding, setSliding] = useState<number | null>(null);
  const restored = useRef(false);
  const anchor = useRef<{ x: number; y: number; fx: number; fy: number; from: number } | null>(null);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;

  useEffect(() => setMounted(true), []);

  // Load the PDF and learn every page's shape (so the column has the right height before drawing).
  useEffect(() => {
    let cancel = false;
    restored.current = false;
    setNote("Opening the book…");
    setCount(0);
    loadBytes(bookKey, version)
      .then((data) => getDocument({ data }).promise)
      .then(async (pdf) => {
        if (cancel) return void pdf.destroy();
        pdfRef.current = pdf;
        const first = await pdf.getPage(1);
        const view = first.getViewport({ scale: 1 });
        const ratio = view.height / view.width;
        setRatios(Array.from({ length: pdf.numPages }, () => ratio));
        setCount(pdf.numPages);
        setNote("");
      })
      .catch(() => {
        if (!cancel) setNote("This PDF could not be opened.");
      });
    return () => {
      cancel = true;
      const pdf = pdfRef.current;
      pdfRef.current = null;
      void pdf?.destroy();
    };
  }, [bookKey, version]);

  // Fit pages to the screen width.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const fit = () => setWidth(Math.min(900, node.clientWidth - 16));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(node);
    return () => watch.disconnect();
  }, [mounted]);

  const pageWidth = Math.round(width * zoom);
  const tops: number[] = [];
  let total = GAP;
  for (let i = 0; i < count; i += 1) {
    tops.push(total);
    total += Math.round(pageWidth * (ratios[i] ?? 1.4)) + GAP;
  }

  function pageAt(y: number) {
    let low = 0;
    let high = tops.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (tops[mid] <= y) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  // Which pages to draw: the ones on screen, plus a couple either side.
  function look() {
    const node = scroller.current;
    if (!node || !count) return;
    const top = node.scrollTop;
    const firstIndex = pageAt(Math.max(0, top - node.clientHeight));
    const lastIndex = pageAt(top + node.clientHeight * 2);
    const next = new Set<number>();
    for (let i = Math.max(0, firstIndex - 1); i <= Math.min(count - 1, lastIndex + 1); i += 1) next.add(i);
    setNear((current) => (current.size === next.size && [...next].every((i) => current.has(i)) ? current : next));
    const middle = top + node.clientHeight * 0.35;
    const index = pageAt(middle);
    const height = Math.round(pageWidth * (ratios[index] ?? 1.4));
    setPage(index + 1);
    if (restored.current) savePlace(bookKey, index + 1 + Math.min(0.999, Math.max(0, (top - tops[index]) / Math.max(1, height))));
  }

  // Back to where the reader stopped.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node || !count || restored.current) return;
    const place = readPlace(bookKey);
    if (place >= 1) {
      const index = Math.min(count - 1, Math.floor(place) - 1);
      const height = Math.round(pageWidth * (ratios[index] ?? 1.4));
      node.scrollTop = tops[index] + (place - Math.floor(place)) * height;
    }
    restored.current = true;
    look();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, width]);

  // Keep the spot under the fingers still while zooming.
  useLayoutEffect(() => {
    const node = scroller.current;
    const hold = anchor.current;
    if (!node || !hold) return;
    const scale = zoom / hold.from;
    node.scrollLeft = hold.x * scale - hold.fx;
    node.scrollTop = hold.y * scale - hold.fy;
    anchor.current = null;
    look();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  useEffect(() => {
    look();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, count]);

  function zoomTo(next: number, fx: number, fy: number) {
    const node = scroller.current;
    if (!node) return;
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    const from = zoomRef.current;
    if (Math.abs(clamped - from) < 0.01) return;
    if (!anchor.current) anchor.current = { x: node.scrollLeft + fx, y: node.scrollTop + fy, fx, fy, from };
    zoomRef.current = clamped;
    setZoom(clamped);
  }

  // Two fingers zoom; a double tap goes in and out.
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    let pinch: { dist: number; zoom: number } | null = null;
    let lastTap = 0;
    const middle = (touches: TouchList) => {
      const box = node.getBoundingClientRect();
      return { x: (touches[0].clientX + touches[1].clientX) / 2 - box.left, y: (touches[0].clientY + touches[1].clientY) / 2 - box.top };
    };
    const spread = (touches: TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const start = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        pinch = { dist: spread(event.touches), zoom: zoomRef.current };
      } else if (event.touches.length === 1) {
        const now = Date.now();
        if (now - lastTap < 300) {
          const box = node.getBoundingClientRect();
          const fx = event.touches[0].clientX - box.left;
          const fy = event.touches[0].clientY - box.top;
          zoomTo(zoomRef.current > 1.05 ? 1 : 2, fx, fy);
          lastTap = 0;
        } else lastTap = now;
      }
    };
    const move = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      const { x, y } = middle(event.touches);
      zoomTo((pinch.zoom * spread(event.touches)) / pinch.dist, x, y);
    };
    const end = (event: TouchEvent) => {
      if (event.touches.length < 2) pinch = null;
    };
    node.addEventListener("touchstart", start, { passive: true });
    node.addEventListener("touchmove", move, { passive: false });
    node.addEventListener("touchend", end);
    node.addEventListener("touchcancel", end);
    return () => {
      node.removeEventListener("touchstart", start);
      node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, count]);

  // Ctrl + wheel zoom on computers.
  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return;
    const box = event.currentTarget.getBoundingClientRect();
    zoomTo(zoomRef.current * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event.clientX - box.left, event.clientY - box.top);
  }

  function jump(toPage: number) {
    const node = scroller.current;
    if (!node || !count) return;
    const index = Math.min(count - 1, Math.max(0, toPage - 1));
    node.scrollTop = tops[index] - GAP / 2;
    look();
  }

  // The page slider on the right edge.
  const track = useRef<HTMLDivElement>(null);
  function slideFrom(clientY: number) {
    const box = track.current?.getBoundingClientRect();
    if (!box || !count) return 1;
    const at = Math.min(1, Math.max(0, (clientY - box.top) / box.height));
    return Math.min(count, Math.max(1, Math.round(at * (count - 1)) + 1));
  }

  if (!mounted) return null;
  const knobAt = count > 1 ? ((sliding ?? page) - 1) / (count - 1) : 0;

  return createPortal(
    <div className="pdfs" role="dialog" aria-label={title}>
      <div className="pdfs-head">
        <button type="button" className="pdfs-back" onClick={onClose}>
          Back
        </button>
        <p className="pdfs-title">{title}</p>
        <span className="pdfs-count">{count ? `${page} / ${count}` : ""}</span>
        {extra}
        {onFile ? (
          <label className="pdfs-file">
            Replace
            <input
              type="file"
              accept=".pdf,.txt,.docx,.epub,application/pdf,text/plain"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onFile(file);
              }}
            />
          </label>
        ) : null}
      </div>
      <div ref={scroller} className="pdfs-scroll" onScroll={look} onWheel={onWheel}>
        {note ? <p className="pdfs-note">{note}</p> : null}
        <div className="pdfs-column" style={{ width: pageWidth + 16, height: total }}>
          {tops.map((top, index) => (
            <PdfPage
              key={index}
              pdf={pdfRef.current}
              index={index}
              top={top}
              width={pageWidth}
              height={Math.round(pageWidth * (ratios[index] ?? 1.4))}
              draw={near.has(index)}
              onShape={(ratio) =>
                setRatios((current) => {
                  if (Math.abs((current[index] ?? 0) - ratio) < 0.002) return current;
                  const next = current.slice();
                  next[index] = ratio;
                  return next;
                })
              }
            />
          ))}
        </div>
      </div>
      {count > 1 ? (
        <div
          ref={track}
          className={`pdfs-track${sliding !== null ? " is-sliding" : ""}`}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setSliding(slideFrom(event.clientY));
          }}
          onPointerMove={(event) => {
            if (sliding === null) return;
            const next = slideFrom(event.clientY);
            if (next !== sliding) setSliding(next);
          }}
          onPointerUp={(event) => {
            const next = slideFrom(event.clientY);
            setSliding(null);
            jump(next);
          }}
          onPointerCancel={() => setSliding(null)}
        >
          <span className="pdfs-rail" />
          <span className="pdfs-knob" style={{ top: `${knobAt * 100}%` }}>
            {sliding !== null ? (
              <b className="pdfs-bubble">
                Page {sliding} of {count}
              </b>
            ) : null}
          </span>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

function PdfPage({
  pdf,
  index,
  top,
  width,
  height,
  draw,
  onShape,
}: {
  pdf: PDFDocumentProxy | null;
  index: number;
  top: number;
  width: number;
  height: number;
  draw: boolean;
  onShape: (ratio: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const node = canvas.current;
    if (!draw || !pdf || !node) {
      // Far away: let the picture go to save memory.
      if (!draw && node && drawn) {
        node.width = 0;
        node.height = 0;
        setDrawn(false);
      }
      return;
    }
    let task: RenderTask | null = null;
    let cancel = false;
    // Wait a moment so fast scrolling and pinching don't redraw every step.
    const timer = window.setTimeout(() => {
      void pdf
        .getPage(index + 1)
        .then((p) => {
          if (cancel) return;
          const base = p.getViewport({ scale: 1 });
          onShape(base.height / base.width);
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          let scale = (width / base.width) * dpr;
          // Keep each page under ~5 million pixels, even zoomed in.
          const pixels = base.width * base.height * scale * scale;
          if (pixels > 5_000_000) scale *= Math.sqrt(5_000_000 / pixels);
          const view = p.getViewport({ scale });
          const scratch = document.createElement("canvas");
          scratch.width = Math.floor(view.width);
          scratch.height = Math.floor(view.height);
          const context = scratch.getContext("2d");
          if (!context) return;
          task = p.render({ canvasContext: context, viewport: view });
          return task.promise.then(() => {
            if (cancel || !canvas.current) return;
            const target = canvas.current;
            target.width = scratch.width;
            target.height = scratch.height;
            target.getContext("2d")?.drawImage(scratch, 0, 0);
            setDrawn(true);
          });
        })
        .catch(() => undefined);
    }, drawn ? 180 : 40);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
      task?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw, pdf, index, width]);

  return (
    <div className="pdfs-page" style={{ top, width, height }}>
      {!drawn ? <span className="pdfs-page-no">{index + 1}</span> : null}
      <canvas ref={canvas} />
    </div>
  );
}
