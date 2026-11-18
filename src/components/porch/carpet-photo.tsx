import { useEffect, useRef, useState } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { quietButtonClass } from "@/components/porch/bits";
import { getCarpet, setCarpet } from "@/lib/porch/carpet";

function shrink(file: File) {
  return new Promise<string>((resolve, reject) => {
    const local = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const longest = Math.max(img.width, img.height);
      const scale = longest > 1400 ? 1400 / longest : 1;
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

export function CarpetPhoto({ onCarpet }: { onCarpet: (url: string | null) => void }) {
  const { user } = useCurrentUserState();
  const [founder, setFounder] = useState(false);
  const [open, setOpen] = useState(false);
  const [shot, setShot] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };
  const lay = useRef(onCarpet);
  lay.current = onCarpet;

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    getCarpet({ data: seed })
      .then((result) => {
        if (cancel) return;
        setFounder(result.founder);
        setShot(Boolean(result.image));
        lay.current(result.image ? `data:${result.mime || "image/jpeg"};base64,${result.image}` : null);
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
      const result = await setCarpet({ data: { mime: "image/jpeg", image, ...seed } });
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setShot(true);
      onCarpet(`data:image/jpeg;base64,${image}`);
    } catch (caught) {
      setPending(false);
      setError(caught instanceof Error ? caught.message : "That photo could not be read.");
    }
  }

  async function clear() {
    setPending(true);
    setError("");
    const result = await setCarpet({ data: { mime: "", image: "", ...seed } });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setShot(false);
    onCarpet(null);
  }

  return (
    <div className="porchguy-carpet">
      {open ? (
        <div className="grid gap-2 rounded-2xl bg-black/80 p-3 text-sm text-[#f6edd8]">
          <p className="font-semibold">Carpet</p>
          <label className="font-semibold">
            Photo
            <input
              type="file"
              accept="image/*"
              className="mt-1 block w-full text-xs"
              disabled={pending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void save(file);
              }}
            />
          </label>
          {shot ? (
            <button type="button" className={quietButtonClass} disabled={pending} onClick={() => void clear()}>
              Take it up
            </button>
          ) : null}
          <button type="button" className={quietButtonClass} onClick={() => setOpen(false)}>
            Close
          </button>
          {error ? <p>{error}</p> : null}
        </div>
      ) : (
        <button type="button" className="porchguy-wall-open" onClick={() => setOpen(true)}>
          Carpet
        </button>
      )}
    </div>
  );
}
