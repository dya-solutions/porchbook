import { useEffect, useState } from "react";
import { quietButtonClass } from "@/components/porch/bits";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getHeaderPhoto, setHeaderPhoto } from "@/lib/porch/header-photo";

/** The photo behind the header: kept on the phone so it shows at once, refreshed from the founder's choice. */

const STORE = "porch-header-photo";
let stamp = "";
let asked = false;

function paint(mime: string, image: string) {
  const root = document.documentElement.style;
  if (image) root.setProperty("--header-photo", `url("data:${mime || "image/jpeg"};base64,${image}")`);
  else root.removeProperty("--header-photo");
}

if (typeof window !== "undefined") {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null") as { mime: string; image: string; updatedAt: string } | null;
    if (saved?.image) {
      stamp = saved.updatedAt;
      paint(saved.mime, saved.image);
    }
  } catch {
    /* the crowd shows until it loads */
  }
}

type Seed = { displayName: string; email: string | null; imageUrl: string | null };

async function refresh(seed: Seed) {
  const result = await getHeaderPhoto({ data: seed });
  if (result.updatedAt !== stamp) {
    stamp = result.updatedAt;
    paint(result.mime, result.image);
    try {
      if (result.image) localStorage.setItem(STORE, JSON.stringify({ mime: result.mime, image: result.image, updatedAt: result.updatedAt }));
      else localStorage.removeItem(STORE);
    } catch {
      /* too large to keep: it loads from the internet next time */
    }
  }
  return result;
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
      URL.revokeObjectURL(local);
      if (!pen) {
        reject(new Error("That photo could not be read."));
        return;
      }
      // Softened a little, like the crowd, so the buttons stay clear.
      pen.filter = "blur(1px)";
      pen.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", 0.74);
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

/** Loads the header photo for everyone (call once in the app frame). */
export function useHeaderPhoto() {
  const { user } = useCurrentUserState();
  useEffect(() => {
    if (!user?.id || asked) return;
    asked = true;
    void refresh({ displayName: user.displayName ?? "", email: user.primaryEmail ?? null, imageUrl: user.profileImageUrl ?? null }).catch(() => {
      asked = false;
    });
  }, [user?.id]);
}

/** Founder menu: change the header photo (it is darkened automatically so the buttons rest well). */
export function HeaderPhotoSetter() {
  const { user } = useCurrentUserState();
  const [founder, setFounder] = useState(false);
  const [custom, setCustom] = useState(false);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const seed = { displayName: user?.displayName ?? "", email: user?.primaryEmail ?? null, imageUrl: user?.profileImageUrl ?? null };

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    getHeaderPhoto({ data: seed })
      .then((result) => {
        if (cancel) return;
        setFounder(result.founder);
        setCustom(Boolean(result.image));
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [user?.id]);

  if (!founder) return null;
  if (!open) {
    return (
      <button type="button" className={`${quietButtonClass} mt-3 px-0`} onClick={() => setOpen(true)}>
        Header photo
      </button>
    );
  }

  async function save(file: File | null) {
    setBusy(true);
    setNote(file ? "Putting it up…" : "");
    try {
      const image = file ? await shrink(file) : "";
      const result = await setHeaderPhoto({ data: { mime: file ? "image/jpeg" : "", image, ...seed } });
      if (!result.ok) setNote(result.error);
      else {
        stamp = "pending";
        await refresh(seed);
        setCustom(Boolean(file));
        setNote(file ? "Done. Everyone sees it behind the header, darkened so the buttons stay clear." : "Back to the water drops.");
      }
    } catch (caught) {
      setNote(caught instanceof Error ? caught.message : "That photo could not be read.");
    }
    setBusy(false);
  }

  return (
    <div className="mt-3">
      <p className="text-sm font-medium text-ink">Header photo</p>
      <p className="mt-1 text-sm text-muted">The picture behind the logo and the Home · Tour/Read · PorchGuy buttons. It's darkened and softened automatically.</p>
      <label className={`${quietButtonClass} mt-2 cursor-pointer`}>
        {busy ? "Working…" : "Choose a photo"}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void save(file);
          }}
        />
      </label>
      {custom ? (
        <button type="button" className={`${quietButtonClass} mt-2`} disabled={busy} onClick={() => void save(null)}>
          Use the water drops again
        </button>
      ) : null}
      <button type="button" className={`${quietButtonClass} mt-2`} onClick={() => setOpen(false)}>
        Close
      </button>
      {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
    </div>
  );
}

/** Founder: try the new glass call card on this phone before everyone gets it. */
export function CallLookSetter() {
  const { user } = useCurrentUserState();
  const [founder, setFounder] = useState(false);
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!user?.id) return;
    try {
      setOn(localStorage.getItem("porch-call-look") !== "old");
    } catch {
      setOn(true);
    }
    getHeaderPhoto({ data: { displayName: user.displayName ?? "", email: user.primaryEmail ?? null, imageUrl: user.profileImageUrl ?? null } })
      .then((result) => setFounder(result.founder))
      .catch(() => undefined);
  }, [user?.id]);
  if (!founder) return null;
  const toggle = (
    <button
      type="button"
      className={`${quietButtonClass} mt-3 px-0`}
      onClick={() =>
        void import("@/components/porch/call-card").then(({ setGlassCalls }) => {
          setGlassCalls(!on);
          setOn(!on);
        })
      }
    >
      {on ? "✓ New call look (tap to use the old one on this phone)" : "Old call look on this phone — tap for the new one"}
    </button>
  );
  return (
    <>
      {toggle}
      <button type="button" className={`${quietButtonClass} mt-2 px-0`} onClick={() => void import("@/components/porch/call-card").then(({ previewCall }) => previewCall("out"))}>
        ▶ Preview: me calling someone
      </button>
      <button type="button" className={`${quietButtonClass} mt-2 px-0`} onClick={() => void import("@/components/porch/call-card").then(({ previewCall }) => previewCall("in"))}>
        ▶ Preview: someone calling me
      </button>
    </>
  );
}
