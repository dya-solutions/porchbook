import { useEffect, useRef, useState } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { quietButtonClass } from "@/components/porch/bits";
import { getWall, setWall, type WallSide } from "@/lib/porch/wall";

const SIDES: { key: WallSide; label: string }[] = [
  { key: "back", label: "Gallery wall" },
  { key: "left", label: "Left TV" },
  { key: "right", label: "Fireplace TV" },
  { key: "ahead", label: "Painting" },
];

function emptyShots(): Record<WallSide, boolean> {
  return { back: false, left: false, right: false, ahead: false };
}

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

export function WallPhoto({ onPhoto }: { onPhoto: (side: WallSide, url: string | null) => void }) {
  const { user } = useCurrentUserState();
  const [founder, setFounder] = useState(false);
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<WallSide>("back");
  const [shots, setShots] = useState(emptyShots);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };
  const photo = useRef(onPhoto);
  photo.current = onPhoto;

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    getWall({ data: seed })
      .then((result) => {
        if (cancel) return;
        setFounder(result.founder);
        const next = emptyShots();
        (Object.keys(next) as WallSide[]).forEach((key) => {
          const image = result.walls[key];
          next[key] = Boolean(image);
          photo.current(key, image ? `data:${result.mimes[key] || "image/jpeg"};base64,${image}` : null);
        });
        setShots(next);
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
      const result = await setWall({ data: { mime: "image/jpeg", image, wall: side, ...seed } });
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setShots((current) => ({ ...current, [side]: true }));
      onPhoto(side, `data:image/jpeg;base64,${image}`);
    } catch (caught) {
      setPending(false);
      setError(caught instanceof Error ? caught.message : "That photo could not be read.");
    }
  }

  async function clear() {
    setPending(true);
    setError("");
    const result = await setWall({ data: { mime: "", image: "", wall: side, ...seed } });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setShots((current) => ({ ...current, [side]: false }));
    onPhoto(side, null);
  }

  return (
    <div className="porchguy-wall">
      {open ? (
        <div className="grid gap-2 rounded-2xl bg-black/80 p-3 text-sm text-[#f6edd8]">
          <p className="font-semibold">Wall photo</p>
          <span className="grid grid-cols-2 gap-1">
            {SIDES.map((item) => (
              <button
                key={item.key}
                type="button"
                className={quietButtonClass}
                aria-pressed={side === item.key}
                onClick={() => setSide(item.key)}
                style={side === item.key ? { color: "#f5a018" } : undefined}
              >
                {item.label}
              </button>
            ))}
          </span>
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
          {shots[side] ? (
            <button type="button" className={quietButtonClass} disabled={pending} onClick={() => void clear()}>
              Take it down
            </button>
          ) : null}
          <button type="button" className={quietButtonClass} onClick={() => setOpen(false)}>
            Close
          </button>
          {error ? <p>{error}</p> : null}
        </div>
      ) : (
        <button type="button" className="porchguy-wall-open" onClick={() => setOpen(true)}>
          Wall photo
        </button>
      )}
    </div>
  );
}
