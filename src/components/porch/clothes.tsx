import { useEffect, useRef, useState } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { quietButtonClass } from "@/components/porch/bits";
import { getCloth, setCloth, type ClothPart } from "@/lib/porch/cloth";

const PARTS: { key: ClothPart; label: string }[] = [
  { key: "shirt", label: "Shirt" },
  { key: "trousers", label: "Trousers" },
];

function averageColor(file: File) {
  return new Promise<string>((resolve, reject) => {
    const local = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const pen = canvas.getContext("2d", { willReadFrequently: true });
      if (!pen) {
        URL.revokeObjectURL(local);
        reject(new Error("That photo could not be read."));
        return;
      }
      pen.drawImage(img, 0, 0, 16, 16);
      URL.revokeObjectURL(local);
      const data = pen.getImageData(0, 0, 16, 16).data;
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 20) continue;
        red += data[i];
        green += data[i + 1];
        blue += data[i + 2];
        count += 1;
      }
      if (!count) {
        reject(new Error("That photo has no colour."));
        return;
      }
      const hex = (value: number) => Math.round(value / count).toString(16).padStart(2, "0");
      resolve(`#${hex(red)}${hex(green)}${hex(blue)}`);
    };
    img.onerror = () => {
      URL.revokeObjectURL(local);
      reject(new Error("Use a jpg or png."));
    };
    img.src = local;
  });
}

export function Clothes({ onColor }: { onColor: (part: ClothPart, color: string | null) => void }) {
  const { user } = useCurrentUserState();
  const [founder, setFounder] = useState(false);
  const [open, setOpen] = useState(false);
  const [part, setPart] = useState<ClothPart>("shirt");
  const [colors, setColors] = useState<Record<ClothPart, string>>({ shirt: "", trousers: "" });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };
  const paint = useRef(onColor);
  paint.current = onColor;

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    getCloth({ data: seed })
      .then((result) => {
        if (cancel) return;
        setFounder(result.founder);
        setColors(result.colors);
        (Object.keys(result.colors) as ClothPart[]).forEach((key) => {
          paint.current(key, result.colors[key] || null);
        });
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [user?.id, seed.displayName, seed.email, seed.imageUrl]);

  if (!founder) return null;

  async function keep(color: string) {
    setPending(true);
    setError("");
    const result = await setCloth({ data: { part, color, ...seed } });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setColors((current) => ({ ...current, [part]: color }));
    onColor(part, color);
  }

  async function fromPhoto(file: File | undefined) {
    if (!file) return;
    if (file.type && !file.type.startsWith("image/")) {
      setError("Use a photo.");
      return;
    }
    try {
      await keep(await averageColor(file));
    } catch (caught) {
      setPending(false);
      setError(caught instanceof Error ? caught.message : "That photo could not be read.");
    }
  }

  async function clear() {
    setPending(true);
    setError("");
    const result = await setCloth({ data: { part, color: "", ...seed } });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setColors((current) => ({ ...current, [part]: "" }));
    onColor(part, null);
  }

  return (
    <div className="porchguy-cloth">
      {open ? (
        <div className="grid gap-2 rounded-2xl bg-black/80 p-3 text-sm text-[#f6edd8]">
          <p className="font-semibold">Clothes</p>
          <span className="grid grid-cols-2 gap-1">
            {PARTS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={quietButtonClass}
                aria-pressed={part === item.key}
                onClick={() => setPart(item.key)}
                style={part === item.key ? { color: "#f5a018" } : undefined}
              >
                {item.label}
              </button>
            ))}
          </span>
          <label className="font-semibold">
            Colour
            <input
              type="color"
              className="mt-1 block h-9 w-full bg-transparent"
              disabled={pending}
              value={colors[part] || (part === "shirt" ? "#2c3644" : "#1a1c20")}
              onChange={(event) => void keep(event.target.value)}
            />
          </label>
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
                void fromPhoto(file);
              }}
            />
          </label>
          <p className="text-xs opacity-70">A photo gives its main colour. It does not print a pattern.</p>
          {colors[part] ? (
            <button type="button" className={quietButtonClass} disabled={pending} onClick={() => void clear()}>
              Put the dark one back
            </button>
          ) : null}
          <button type="button" className={quietButtonClass} onClick={() => setOpen(false)}>
            Close
          </button>
          {error ? <p>{error}</p> : null}
        </div>
      ) : (
        <button type="button" className="porchguy-wall-open" onClick={() => setOpen(true)}>
          Clothes
        </button>
      )}
    </div>
  );
}
