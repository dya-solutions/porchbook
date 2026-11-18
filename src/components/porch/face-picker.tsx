import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "@/components/porch/bits";
import { getMyFace, removeFace, setMyFace } from "@/lib/porch/faces";
import { amIFounder } from "@/lib/porch/password-reset";

/** My own photo, shared by the ME button and my page so a change shows everywhere at once. */
let mine: string | null | undefined;
let asked = false;
const watchers = new Set<() => void>();
const tell = () => watchers.forEach((fn) => fn());
function setMine(url: string | null) {
  mine = url;
  tell();
}
export function useMyFace(userId: string | undefined) {
  const value = useSyncExternalStore(
    (fn) => {
      watchers.add(fn);
      return () => {
        watchers.delete(fn);
      };
    },
    () => mine,
    () => undefined,
  );
  useEffect(() => {
    if (!userId || asked) return;
    asked = true;
    getMyFace()
      .then((result) => setMine(result.imageUrl))
      .catch(() => {
        asked = false;
      });
  }, [userId]);
  return value ?? null;
}

const VIEW = 280; // the cropping square on screen
const HOLE = 240; // the circle inside it
const OUT = 320; // the saved photo, in pixels

/** On my own page: my photo with a 📷 button to change it. */
export function FacePicker({ name, imageUrl, onChanged }: { name: string; imageUrl: string | null; onChanged: (url: string | null) => void }) {
  const [picked, setPicked] = useState<HTMLImageElement | null>(null);
  const [note, setNote] = useState("");

  function choose(file: File | undefined) {
    if (!file) return;
    if (file.type && !file.type.startsWith("image/")) {
      setNote("Choose a photo.");
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setPicked(img);
    img.onerror = () => setNote("That photo couldn't be opened.");
    img.src = url;
  }

  return (
    <div className="face-pick">
      {/* A label around the file box: the way the Android app reliably opens the photo picker. */}
      <label className="face-pick-btn" aria-label="Change your photo">
        {imageUrl ? <img src={imageUrl} alt="" className="face-pick-img" /> : <Avatar name={name} imageUrl={null} size="lg" />}
        <span className="face-pick-cam" aria-hidden="true">
          📷
        </span>
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            setNote("");
            choose(file);
          }}
        />
      </label>
      {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
      {picked ? (
        <Cropper
          img={picked}
          hasPhoto={Boolean(imageUrl)}
          onCancel={() => setPicked(null)}
          onDone={(url) => {
            setPicked(null);
            setMine(url);
            onChanged(url);
          }}
        />
      ) : null}
    </div>
  );
}

function Cropper({ img, hasPhoto, onCancel, onDone }: { img: HTMLImageElement; hasPhoto: boolean; onCancel: () => void; onDone: (url: string | null) => void }) {
  // Fit the photo so it covers the circle; then the person drags and pinches.
  const base = Math.max(HOLE / img.width, HOLE / img.height);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ x: number; y: number; px: number; py: number; dist: number; zoom: number } | null>(null);

  const scale = base * zoom;
  const w = img.width * scale;
  const h = img.height * scale;
  // Keep the circle always covered.
  const clamp = (x: number, y: number, s = scale) => {
    const mx = Math.max(0, (img.width * s - HOLE) / 2);
    const my = Math.max(0, (img.height * s - HOLE) / 2);
    return { x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
  };

  function down(event: React.PointerEvent) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const list = [...pointers.current.values()];
    const dist = list.length > 1 ? Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) : 0;
    start.current = { x: event.clientX, y: event.clientY, px: pos.x, py: pos.y, dist, zoom };
  }
  function move(event: React.PointerEvent) {
    if (!pointers.current.has(event.pointerId) || !start.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const list = [...pointers.current.values()];
    if (list.length > 1 && start.current.dist) {
      const dist = Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y);
      const next = Math.min(4, Math.max(1, (start.current.zoom * dist) / start.current.dist));
      setZoom(next);
      setPos((value) => clamp(value.x, value.y, base * next));
      return;
    }
    setPos(clamp(start.current.px + event.clientX - start.current.x, start.current.py + event.clientY - start.current.y));
  }
  function up(event: React.PointerEvent) {
    pointers.current.delete(event.pointerId);
    const list = [...pointers.current.values()];
    start.current = list.length ? { x: list[0].x, y: list[0].y, px: pos.x, py: pos.y, dist: 0, zoom } : null;
  }

  async function save() {
    setBusy(true);
    setNote("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUT;
      canvas.height = OUT;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error();
      const k = OUT / HOLE;
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, OUT, OUT);
      ctx.drawImage(img, (HOLE / 2 - w / 2 + pos.x) * k, (HOLE / 2 - h / 2 + pos.y) * k, w * k, h * k);
      let quality = 0.82;
      let data = canvas.toDataURL("image/jpeg", quality);
      while (data.length > 60_000 && quality > 0.5) {
        quality -= 0.08;
        data = canvas.toDataURL("image/jpeg", quality);
      }
      const result = await setMyFace({ data: { image: data.slice(data.indexOf(",") + 1) } });
      if (!result.ok) {
        setNote(result.error);
        setBusy(false);
        return;
      }
      onDone(result.imageUrl);
    } catch {
      setNote("That photo couldn't be saved. Try again.");
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    const result = await removeFace({ data: { userId: "" } }).catch(() => null);
    if (!result?.ok) {
      setNote(result?.error ?? "Couldn't remove it. Try again.");
      setBusy(false);
      return;
    }
    onDone(null);
  }

  return createPortal(
    <div className="crop-back" role="dialog" aria-label="Fit your photo">
      <div className="crop-card">
        <p className="crop-title">Your photo</p>
        <div className="crop-view" style={{ width: VIEW, height: VIEW }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <img
            src={img.src}
            alt=""
            draggable={false}
            style={{ width: w, height: h, left: VIEW / 2 - w / 2 + pos.x, top: VIEW / 2 - h / 2 + pos.y }}
          />
          <span className="crop-hole" style={{ inset: (VIEW - HOLE) / 2 }} />
        </div>
        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={zoom}
          aria-label="Zoom"
          className="crop-zoom"
          onChange={(event) => {
            const next = Number(event.target.value);
            setZoom(next);
            setPos((value) => clamp(value.x, value.y, base * next));
          }}
        />
        <p className="crop-hint">Drag and pinch to fit your face in the circle</p>
        {note ? <p className="crop-note">{note}</p> : null}
        <div className="crop-keys">
          <button type="button" className="crop-use" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Use this photo"}
          </button>
          {hasPhoto ? (
            <button type="button" className="crop-other" disabled={busy} onClick={() => void remove()}>
              Remove
            </button>
          ) : null}
          <button type="button" className="crop-other" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Founder, on someone else's page: take down their photo. */
export function FounderRemoveFace({ userId, onRemoved }: { userId: string; onRemoved: () => void }) {
  const [sure, setSure] = useState(false);
  const [note, setNote] = useState("");
  const [founder, setFounder] = useState(false);
  useEffect(() => {
    amIFounder()
      .then((result) => setFounder(result.founder))
      .catch(() => undefined);
  }, []);
  if (!founder) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        className="text-sm font-semibold text-muted"
        onClick={async () => {
          if (!sure) {
            setSure(true);
            return;
          }
          const result = await removeFace({ data: { userId } }).catch(() => null);
          if (result?.ok) onRemoved();
          else setNote(result?.error ?? "Couldn't remove it.");
          setSure(false);
        }}
      >
        {sure ? "Tap again to remove their photo" : "Remove their photo"}
      </button>
      {note ? <p className="text-xs text-muted">{note}</p> : null}
    </div>
  );
}
