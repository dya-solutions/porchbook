import { useEffect, useState } from "react";
import { quietButtonClass } from "@/components/porch/bits";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getGround, setGround } from "@/lib/porch/ground";

type Seed = { displayName: string; email: string | null; imageUrl: string | null };

let stamp = "";
let kept = "";
let asked = false;

if (typeof window !== "undefined") {
  window.setTimeout(() => {
    try {
      const raw = localStorage.getItem("porch-ground");
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
  if (image) document.documentElement.style.setProperty("--porch-ground", `url("data:${mime || "image/jpeg"};base64,${image}")`);
  else document.documentElement.style.removeProperty("--porch-ground");
  try {
    if (!image) localStorage.removeItem("porch-ground");
    else localStorage.setItem("porch-ground", JSON.stringify({ mime, image }));
  } catch {
    /* the phone may refuse a large photo */
  }
}

export async function refreshGround(seed: Seed) {
  const result = await getGround({ data: seed });
  if (result.updatedAt === stamp && (result.image ? kept : !kept)) return result;
  stamp = result.updatedAt;
  paint(result.mime, result.image);
  return result;
}

export function useGround() {
  const { user } = useCurrentUserState();
  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };

  useEffect(() => {
    if (!user?.id || asked) return;
    const timer = window.setTimeout(() => {
      if (asked) return;
      asked = true;
      void refreshGround(seed).catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [user?.id, seed.displayName, seed.email, seed.imageUrl]);
}

function shrink(file: File) {
  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const longest = Math.max(img.width, img.height);
      const scale = longest > 1600 ? 1600 / longest : 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const pen = canvas.getContext("2d");
      if (!pen) {
        URL.revokeObjectURL(url);
        reject(new Error("That photo could not be read."));
        return;
      }
      pen.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const data = canvas.toDataURL("image/jpeg", 0.72);
      const comma = data.indexOf(",");
      resolve(comma >= 0 ? data.slice(comma + 1) : data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Use a jpg or png."));
    };
    img.src = url;
  });
}

export function GroundSetter() {
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
    getGround({ data: seed })
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
      const result = await setGround({ data: { mime: "image/jpeg", image, ...seed } });
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      stamp = "pending";
      await refreshGround(seed);
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
    const result = await setGround({ data: { mime: "", image: "", ...seed } });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    stamp = "pending";
    await refreshGround(seed);
    setCustom(false);
    setOpen(false);
  }

  if (!open) {
    return (
      <button type="button" className={`${quietButtonClass} mt-3 px-0`} onClick={() => setOpen(true)}>
        Background
      </button>
    );
  }

  return (
    <div className="mt-3">
      <p className="text-sm font-medium text-ink">Background</p>
      <p className="mt-1 text-sm text-muted">One photo. It replaces the picture for everyone.</p>
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
          Use the squares
        </button>
      ) : null}
      <button type="button" className={`${quietButtonClass} mt-2`} disabled={pending} onClick={() => setOpen(false)}>
        Close
      </button>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </div>
  );
}
