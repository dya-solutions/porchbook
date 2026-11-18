import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft } from "lucide-react";
import { primaryButtonClass } from "@/components/porch/bits";

const PAGE = 650;

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ReportBook({
  name,
  pages,
  canEdit,
  note,
  busy,
  onWrite,
  onAdd,
  onSave,
  onEmpty,
  onClose,
  extra,
  backLabel = "Back",
}: {
  name: string;
  pages: string[];
  canEdit: boolean;
  note: string;
  busy: boolean;
  onWrite: (index: number, value: string) => void;
  onAdd: () => void;
  onSave: () => void;
  onEmpty?: () => void;
  onClose: () => void;
  extra?: ReactNode;
  backLabel?: string;
}) {
  const [index, setIndex] = useState(0);
  const [angle, setAngle] = useState(0);
  const [dir, setDir] = useState<"next" | "prev" | null>(null);
  const indexRef = useRef(0);
  const angleRef = useRef(0);
  const frame = useRef(0);
  const count = pages.length + 1;

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  function setTurn(next: number) {
    angleRef.current = next;
    setAngle(next);
  }

  function settle(from: number, to: number, nextIndex: number) {
    cancelAnimationFrame(frame.current);
    if (reducedMotion()) {
      setDir(null);
      setTurn(0);
      setIndex(nextIndex);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 280);
      const eased = 1 - (1 - t) * (1 - t);
      setTurn(from + (to - from) * eased);
      if (t < 1) frame.current = requestAnimationFrame(step);
      else {
        setDir(null);
        setTurn(0);
        setIndex(nextIndex);
      }
    };
    frame.current = requestAnimationFrame(step);
  }

  function go(way: "next" | "prev") {
    if (dir) return;
    const atNow = indexRef.current;
    if (way === "next" && atNow < count - 1) {
      setDir("next");
      settle(0, -180, atNow + 1);
    } else if (way === "prev" && atNow > 0) {
      setDir("prev");
      settle(-180, 0, atNow - 1);
    }
  }

  const at = index;
  const sheet = (n: number) => (n <= 0 ? { kind: "cover" as const } : { kind: "page" as const, text: pages[n - 1] ?? "", page: n - 1 });
  const right = dir === "prev" ? sheet(at - 1) : sheet(at);
  const back = dir === "prev" ? sheet(at) : sheet(at + 1);
  const under = dir === "prev" ? sheet(at) : sheet(Math.min(count - 1, at + 1));
  const shade = Math.sin((Math.abs(angle) * Math.PI) / 180) * 0.35;

  function face(value: ReturnType<typeof sheet>, side: "front" | "back") {
    const turned = side === "back";
    const style = { backfaceVisibility: "hidden" as const, transform: turned ? "rotateY(180deg)" : undefined };
    if (value.kind === "cover") {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#14300a] px-8 text-center text-[#f6edd8]" style={style}>
          <span className="butterfly butterfly-still relative h-20 w-24">
            <img src="/wing-left.png?v=5" alt="" className="butterfly-wing butterfly-left" />
            <img src="/wing-right.png?v=5" alt="" className="butterfly-wing butterfly-right" />
          </span>
          <h2 className="mt-6 font-display text-4xl leading-none">{name}</h2>
          <p className="mt-3 text-sm text-[#f8a018]">Report</p>
        </div>
      );
    }
    const editing = canEdit && !turned && !dir && value.page === at - 1;
    return (
      <div className="absolute inset-0 flex flex-col bg-[#f6edd8] px-6 py-6 text-[#1c140c]" style={style}>
        <p className="text-xs font-semibold text-[#6a5436]">{name}</p>
        {editing ? (
          <textarea
            value={pages[value.page] ?? ""}
            onChange={(event) => onWrite(value.page, event.target.value.slice(0, PAGE))}
            maxLength={PAGE}
            placeholder="Write the report"
            className="mt-3 min-h-0 flex-1 resize-none bg-transparent text-lg leading-snug outline-none"
          />
        ) : (
          <p className="mt-3 flex-1 overflow-hidden whitespace-pre-wrap text-lg leading-snug">{value.text || "Nothing written yet."}</p>
        )}
        <p className="pt-3 text-center text-[11px] text-[#6a5436]">Property of Phaneroo Ministries Mbarara</p>
      </div>
    );
  }

  return createPortal(
    <div className="pc-book fixed inset-0 z-[80] flex flex-col bg-[#2a1c12]">
      <div className="flex items-center justify-between px-3 py-2 text-[#f6edd8]">
        <button type="button" className="flex min-h-12 items-center gap-1 text-base font-semibold text-[#f8a018]" onClick={onClose}>
          <ChevronLeft className="size-5" aria-hidden="true" />
          {backLabel}
        </button>
        <p className="text-sm">
          {at + 1} / {count}
        </p>
        {canEdit || onEmpty ? (
          <span className="flex items-center gap-2">
            {onEmpty ? (
              <button type="button" className="min-h-12 font-semibold text-[#f8a018]" disabled={busy} onClick={onEmpty}>
                Delete
              </button>
            ) : null}
            {canEdit ? (
              <button type="button" className={primaryButtonClass} disabled={busy} onClick={onSave}>
                {busy ? "Saving…" : "Save"}
              </button>
            ) : null}
          </span>
        ) : (
          <span className="w-16" />
        )}
      </div>
      <div className="flex flex-1 items-center justify-center px-3 pb-4">
        <div
          className="relative h-[min(78dvh,680px)] w-[min(92vw,420px)]"
          style={{ perspective: "1800px" }}
        >
          <div className="absolute inset-0 overflow-hidden rounded-md shadow-[12px_16px_30px_rgba(0,0,0,0.35)]">
            {face(under, "front")}
          </div>
          <div className="absolute inset-0" style={{ transformStyle: "preserve-3d", transformOrigin: "left center", transform: `rotateY(${angle}deg)` }}>
            {face(right, "front")}
            {face(back, "back")}
            <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(0,0,0,0.28), transparent 28%)", opacity: shade, backfaceVisibility: "hidden" }} />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 px-4 pb-4 text-sm text-[#f6edd8]">
        <button type="button" className="min-h-12 font-semibold text-[#f8a018] disabled:opacity-30" disabled={at <= 0} onClick={() => go("prev")}>
          Previous
        </button>
        <span className="min-w-0 flex-1 text-center">{note}</span>
        {extra}
        {canEdit && at === count - 1 && pages.length < 8 ? (
          <button type="button" className="font-semibold text-[#f8a018]" onClick={onAdd}>
            Another page
          </button>
        ) : null}
        <button type="button" className="min-h-12 font-semibold text-[#f8a018] disabled:opacity-30" disabled={at >= count - 1} onClick={() => go("next")}>
          Next
        </button>
      </div>
    </div>,
    document.body,
  );
}
