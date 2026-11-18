import { useEffect, useState, type CSSProperties } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getCovers, setButterfly, setCover, type Fly } from "@/lib/porch/covers";
import { useLite } from "@/lib/porch/lite";

/** Book covers chosen by the founder (any material photo), shared with everyone and kept on the phone. */

type Covers = Record<string, { mime: string; image: string }>;
const STORE = "porch-covers";
let covers: Covers = {};
let flies: Record<string, Fly> = {};
const FLY_STORE = "porch-cover-flies";
let founder = false;
let stamp = "";
let asked = false;
const watchers = new Set<() => void>();
const tell = () => watchers.forEach((watch) => watch());

if (typeof window !== "undefined") {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw && raw.length < 3_000_000) covers = (JSON.parse(raw) as Covers) ?? {};
    flies = (JSON.parse(localStorage.getItem(FLY_STORE) || "{}") as Record<string, Fly>) ?? {};
  } catch {
    covers = {};
  }
}

type Seed = { displayName: string; email: string | null; imageUrl: string | null };

async function refresh(seed: Seed) {
  const result = await getCovers({ data: seed });
  founder = result.founder;
  if (result.updatedAt !== stamp) {
    stamp = result.updatedAt;
    covers = result.covers;
    flies = result.flies;
    try {
      localStorage.setItem(FLY_STORE, JSON.stringify(flies));
    } catch {
      /* fine */
    }
    try {
      if (Object.keys(covers).length) localStorage.setItem(STORE, JSON.stringify(covers));
      else localStorage.removeItem(STORE);
    } catch {
      /* too large for the phone: it loads from the internet next time */
    }
  }
  tell();
}

function shrink(file: File, longestSide = 700) {
  return new Promise<string>((resolve, reject) => {
    const local = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const longest = Math.max(img.width, img.height);
      const scale = longest > longestSide ? longestSide / longest : 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const pen = canvas.getContext("2d");
      URL.revokeObjectURL(local);
      if (!pen) {
        reject(new Error("That photo could not be read."));
        return;
      }
      pen.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", 0.75);
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

export function useCovers() {
  const { user } = useCurrentUserState();
  const lite = useLite();
  const [, setTick] = useState(0);
  const seed: Seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };
  useEffect(() => {
    const watch = () => setTick((value) => value + 1);
    watchers.add(watch);
    return () => {
      watchers.delete(watch);
    };
  }, []);
  useEffect(() => {
    if (!user?.id || asked) return;
    asked = true;
    void refresh(seed).catch(() => {
      asked = false;
    });
  }, [user?.id]);

  /** Style for a book's front cover, or undefined to keep its usual cover. Lite mode keeps the usual covers. */
  const coverOf = (book: string): CSSProperties | undefined => {
    const cover = covers[book];
    if (!cover?.image || lite) return undefined;
    return {
      // A soft bound-edge shadow and sheen over the photo, so it still reads as a book cover.
      backgroundImage: `linear-gradient(90deg,rgba(0,0,0,.45) 0,rgba(255,255,255,.08) 5%,transparent 14%),linear-gradient(160deg,rgba(255,255,255,.08),transparent 40%,rgba(0,0,0,.22)),url("data:${cover.mime || "image/jpeg"};base64,${cover.image}")`,
      backgroundSize: "100% 100%, 100% 100%, cover",
      backgroundPosition: "center",
      backgroundColor: "#222",
    };
  };

  /** A plain background (not a book): its photo as a data link, or its colour. Lite mode skips photos. */
  const backdropOf = (key: string): { photo?: string; color?: string } | undefined => {
    const cover = covers[key];
    if (!cover?.image) return undefined;
    if (cover.mime === "color") return { color: cover.image };
    return lite ? undefined : { photo: `data:${cover.mime || "image/jpeg"};base64,${cover.image}` };
  };
  async function chooseColor(key: string, color: string) {
    const result = await setCover({ data: { book: key, mime: "color", image: color, ...seed } }).catch(() => null);
    if (!result) return "Couldn't save. Check your connection.";
    if (!result.ok) return result.error;
    await refresh(seed).catch(() => undefined);
    return "";
  }

  async function choose(book: string, file: File | undefined, longestSide = 700) {
    if (!file) return "";
    if (file.type && !file.type.startsWith("image/")) return "Use a photo.";
    try {
      const image = await shrink(file, longestSide);
      const result = await setCover({ data: { book, mime: "image/jpeg", image, ...seed } });
      if (!result.ok) return result.error;
      await refresh(seed);
      return "";
    } catch (caught) {
      return caught instanceof Error ? caught.message : "That photo could not be read.";
    }
  }

  async function reset(book: string) {
    const result = await setCover({ data: { book, mime: "", image: "", ...seed } }).catch(() => null);
    await refresh(seed).catch(() => undefined);
    return result && !result.ok ? result.error : "";
  }

  /** Move, resize or hide a book's butterfly right away on this phone, then save it for everyone. */
  async function placeFly(book: string, fly: Fly | null, save = true) {
    if (fly) flies = { ...flies, [book]: fly };
    else {
      const next = { ...flies };
      delete next[book];
      flies = next;
    }
    tell();
    if (!save) return "";
    const result = await setButterfly({ data: { book, reset: !fly, ...(fly ?? {}), ...seed } }).catch(() => null);
    if (result && !result.ok) return result.error;
    return result ? "" : "Couldn't save. Check your connection.";
  }

  return { founder, coverOf, backdropOf, chooseColor, hasCover: (book: string) => Boolean(covers[book]?.image), choose, reset, flyOf: (book: string): Fly | undefined => flies[book], placeFly };
}
