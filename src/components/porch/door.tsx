import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { quietButtonClass } from "@/components/porch/bits";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getDoor, setDoor } from "@/lib/porch/door";

type Seed = { displayName: string; email: string | null; imageUrl: string | null };

export type DoorTint = { top: string; mid: string; bottom: string };

export const DOOR_ORANGE: DoorTint = {
  top: "#ffd27a",
  mid: "#f5a018",
  bottom: "#e07a00",
};
export const DOOR_GREEN: DoorTint = {
  top: "#d4f57a",
  mid: "#7ed321",
  bottom: "#3ea30a",
};
export const DOOR_GOLD: DoorTint = {
  top: "#ffe9a0",
  mid: "#f0c014",
  bottom: "#d09a08",
};
export const DOOR_INK: DoorTint = {
  top: "#4a4a4a",
  mid: "#1c1c1c",
  bottom: "#0a0a0a",
};

let stamp = "";
let kept = "";
let asked = false;

if (typeof window !== "undefined") {
  window.setTimeout(() => {
    try {
      const raw = localStorage.getItem("porch-door");
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
  if (image) document.documentElement.style.setProperty("--porch-door", `url("data:${mime || "image/jpeg"};base64,${image}")`);
  else document.documentElement.style.removeProperty("--porch-door");
  try {
    if (!image) localStorage.removeItem("porch-door");
    else localStorage.setItem("porch-door", JSON.stringify({ mime, image }));
  } catch {
    /* the phone may refuse a large photo */
  }
}

async function refreshDoor(seed: Seed) {
  const result = await getDoor({ data: seed });
  if (result.updatedAt === stamp && (result.image ? kept : !kept)) return result;
  stamp = result.updatedAt;
  paint(result.mime, result.image);
  return result;
}

function useDoorWatch() {
  const { user } = useCurrentUserState();
  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };

  useEffect(() => {
    if (!user?.id || asked) return;
    asked = true;
    void refreshDoor(seed).catch(() => undefined);
  }, [user?.id, seed.displayName, seed.email, seed.imageUrl]);
}

export function DoorFace({
  tint,
  className,
  children,
}: {
  tint: DoorTint;
  className: string;
  plate?: boolean;
  children?: ReactNode;
}) {
  useDoorWatch();
  const style: CSSProperties = { ["--door-edge" as string]: tint.mid };
  return (
    <span className={`door-metal ${className} grid place-items-center`} style={style}>
      {children}
    </span>
  );
}

function shrink(file: File) {
  return new Promise<string>((resolve, reject) => {
    const local = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const longest = Math.max(img.width, img.height);
      const scale = longest > 1600 ? 1600 / longest : 1;
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

export function DoorSetter() {
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
    getDoor({ data: seed })
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
      const result = await setDoor({ data: { mime: "image/jpeg", image, ...seed } });
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      stamp = "pending";
      await refreshDoor(seed);
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
    const result = await setDoor({ data: { mime: "", image: "", ...seed } });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    stamp = "pending";
    await refreshDoor(seed);
    setCustom(false);
    setOpen(false);
  }

  if (!open) {
    return (
      <button type="button" className={`${quietButtonClass} mt-3 px-0`} onClick={() => setOpen(true)}>
        Door texture
      </button>
    );
  }

  return (
    <div className="mt-3">
      <p className="text-sm font-medium text-ink">Door texture</p>
      <p className="mt-1 text-sm text-muted">One photo. It blends into Pray, My 20, and the other doors for everyone.</p>
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
          Use the leather
        </button>
      ) : null}
      <button type="button" className={`${quietButtonClass} mt-2`} disabled={pending} onClick={() => setOpen(false)}>
        Close
      </button>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </div>
  );
}
