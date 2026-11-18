import { useEffect, useState } from "react";
import { quietButtonClass } from "@/components/porch/bits";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getShelf, setShelf } from "@/lib/porch/shelf";
import { isLite } from "@/lib/porch/lite";
import shelfWalnut from "@/assets/shelf-walnut.jpg";

type Seed = { displayName: string; email: string | null; imageUrl: string | null };

let stamp = "";
let kept = "";
let asked = false;

if (typeof window !== "undefined") {
  window.setTimeout(() => {
    try {
      localStorage.removeItem("porch-shelf");
      const raw = localStorage.getItem("porch-shelf2");
      if (!raw || raw.length > 500000) return;
      const saved = JSON.parse(raw) as { image?: string } | null;
      kept = saved?.image && saved.image.length < 400000 ? saved.image : "";
    } catch {
      kept = "";
    }
  }, 0);
}

function paint(mime: string, image: string) {
  if (image === kept) return;
  kept = image;
  if (image) document.documentElement.style.setProperty("--porch-shelf", `url("data:${mime || "image/jpeg"};base64,${image}")`);
  else document.documentElement.style.removeProperty("--porch-shelf");
  try {
    if (!image) localStorage.removeItem("porch-shelf2");
    else localStorage.setItem("porch-shelf2", JSON.stringify({ mime, image }));
  } catch {
    /* the phone may refuse a large photo */
  }
}

// ---- The shelf's parts (top board, back panel, plank), each its own material.
type PartKey = "top" | "back" | "plank";
const PART_KEYS: PartKey[] = ["top", "back", "plank"];
type Parts = Record<PartKey, { mime: string; image: string }>;
const PARTS_STORE = "porch-shelf-parts";
let keptParts = "";
let founderKnown = false;
const founderWatchers = new Set<(founder: boolean) => void>();

function paintParts(parts: Parts | null) {
  const sign = parts ? PART_KEYS.map((key) => parts[key].image.length + ":" + parts[key].image.slice(-24)).join("|") : "";
  if (sign === keptParts) return;
  keptParts = sign;
  const root = document.documentElement;
  for (const key of PART_KEYS) {
    const part = parts?.[key];
    // Lite mode keeps the plain shelf: no extra photos to draw.
    if (part?.image && !isLite()) {
      root.style.setProperty(`--shelf-${key}`, `url("data:${part.mime || "image/jpeg"};base64,${part.image}")`);
      root.classList.add(`has-shelf-${key}`);
    } else {
      root.style.removeProperty(`--shelf-${key}`);
      root.classList.remove(`has-shelf-${key}`);
    }
  }
  try {
    if (!parts || PART_KEYS.every((key) => !parts[key].image)) localStorage.removeItem(PARTS_STORE);
    else localStorage.setItem(PARTS_STORE, JSON.stringify(parts));
  } catch {
    /* too large for the phone's storage: it loads from the internet next time */
  }
}

if (typeof window !== "undefined") {
  window.setTimeout(() => {
    try {
      const raw = localStorage.getItem(PARTS_STORE);
      if (raw && raw.length < 2_000_000) paintParts(JSON.parse(raw) as Parts);
    } catch {
      /* nothing kept */
    }
  }, 0);
}

export async function refreshShelf(seed: Seed) {
  const result = await getShelf({ data: seed });
  founderKnown = result.founder;
  founderWatchers.forEach((watch) => watch(result.founder));
  paintParts(result.parts);
  if (result.updatedAt === stamp && (result.image ? kept : !kept)) return result;
  stamp = result.updatedAt;
  paint(result.mime, result.image);
  return result;
}

function useShelfFounder() {
  const [founder, setFounder] = useState(founderKnown);
  useEffect(() => {
    founderWatchers.add(setFounder);
    return () => {
      founderWatchers.delete(setFounder);
    };
  }, []);
  return founder;
}

export function useShelfPhoto() {
  const { user } = useCurrentUserState();
  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };

  useEffect(() => {
    if (!user?.id || asked) return;
    asked = true;
    void refreshShelf(seed).catch(() => undefined);
  }, [user?.id, seed.displayName, seed.email, seed.imageUrl]);

  return "";
}

function shrink(file: File, max = 1600) {
  return new Promise<string>((resolve, reject) => {
    const local = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const longest = Math.max(img.width, img.height);
      const scale = longest > max ? max / longest : 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const pen = canvas.getContext("2d");
      if (!pen) {
        URL.revokeObjectURL(local);
        reject(new Error("That photo could not be read."));
        return;
      }
      pen.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(local);
      const data = canvas.toDataURL("image/jpeg", 0.72);
      const comma = data.indexOf(",");
      resolve(comma >= 0 ? data.slice(comma + 1) : data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(local);
      reject(new Error("Use a jpg or png."));
    };
    img.src = local;
  });
}

export function ShelfSetter() {
  const { user } = useCurrentUserState();
  const [founder, setFounder] = useState(false);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    getShelf({ data: seed })
      .then((result) => {
        if (cancel) return;
        setFounder(result.founder);
        setCustom(Boolean(result.image));
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [user?.id, seed.displayName, seed.email, seed.imageUrl]);

  if (!founder) return null;

  async function save(file: File | undefined) {
    if (!file) return;
    if (file.type && !file.type.startsWith("image/")) {
      setError("Use a photo.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const image = await shrink(file);
      const result = await setShelf({ data: { mime: "image/jpeg", image, ...seed } });
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      stamp = "pending";
      await refreshShelf(seed);
      setCustom(true);
      setOpen(false);
    } catch (caught) {
      setPending(false);
      setError(caught instanceof Error ? caught.message : "That photo could not be read.");
    }
  }

  async function clear() {
    setPending(true);
    setError("");
    const result = await setShelf({ data: { mime: "", image: "", ...seed } });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    stamp = "pending";
    await refreshShelf(seed);
    setCustom(false);
    setOpen(false);
  }

  if (!open) {
    return (
      <button type="button" className={`${quietButtonClass} mt-3 px-0`} onClick={() => setOpen(true)}>
        Shelf
      </button>
    );
  }

  return (
    <div className="mt-3">
      <p className="text-sm font-medium text-ink">Shelf</p>
      <p className="mt-1 text-sm text-muted">One photo of a shelf. The books stand on it for everyone.</p>
      <label className={`${quietButtonClass} mt-2 cursor-pointer`}>
        {pending ? "Setting…" : "Choose a photo"}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void save(file);
          }}
        />
      </label>
      {custom ? (
        <button type="button" className={`${quietButtonClass} mt-2`} disabled={pending} onClick={() => void clear()}>
          Use the wood
        </button>
      ) : null}
      <button type="button" className={`${quietButtonClass} mt-2`} disabled={pending} onClick={() => setOpen(false)}>
        Close
      </button>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </div>
  );
}

const PART_LABELS: { key: PartKey | "whole"; label: string; hint: string }[] = [
  { key: "top", label: "Top board", hint: "The board along the top" },
  { key: "back", label: "Back panel", hint: "The wall behind the books" },
  { key: "plank", label: "Plank", hint: "The board the books stand on" },
  { key: "whole", label: "Whole shelf", hint: "One photo of a complete shelf" },
];

/** The shelf picture with its materials, and (for the founder) a 🎨 button to change them for everyone. */
export function ShelfFace() {
  const { user } = useCurrentUserState();
  const founder = useShelfFounder();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string>("");
  const [error, setError] = useState("");
  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };

  async function save(part: PartKey | "whole", file: File | undefined) {
    if (!file) return;
    if (file.type && !file.type.startsWith("image/")) {
      setError("Use a photo.");
      return;
    }
    setPending(part);
    setError("");
    try {
      const image = await shrink(file, part === "whole" ? 1600 : 1000);
      const result = await setShelf({ data: { mime: "image/jpeg", image, part, ...seed } });
      if (!result.ok) setError(result.error);
      else {
        stamp = "pending";
        await refreshShelf(seed);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That photo could not be read.");
    }
    setPending("");
  }

  async function clear(part: PartKey | "whole") {
    setPending(part);
    setError("");
    const result = await setShelf({ data: { mime: "", image: "", part, ...seed } }).catch(() => null);
    if (result && !result.ok) setError(result.error);
    stamp = "pending";
    await refreshShelf(seed).catch(() => undefined);
    setPending("");
  }

  // The shelf is one walnut compartment (cut from the founder's chosen photo); the books stand on its floor.
  void founder;
  void open;
  void setOpen;
  void pending;
  void error;
  void save;
  void clear;
  return <div aria-hidden="true" className="shelf-face is-walnut" style={{ backgroundImage: `url(${shelfWalnut})` }} />;
}
