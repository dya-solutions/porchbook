import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useBackLayer } from "@/lib/porch/back-stack";
import { bookCode, getBibleSites, linkCarriesVerse, saveBibleSites, setBibleSiteStart, siteLink, type BibleSite } from "@/lib/porch/bible-sites";
import { PorchLoader } from "@/components/porch/porch-loader";

/**
 * ⇄ Other versions: a full-screen window over the Bible (← Bible goes back) that opens the verse you're on
 * in another version, on the website the founder chose for it. In the Porchbook app the
 * window is the app's own (so every site opens); in a browser it's a frame, with a
 * "new tab" link for sites that refuse to be shown inside another page.
 */

type AppWindow = {
  open: (url: string, top: number) => void;
  move: (top: number) => void;
  close: () => void;
  /** App 1.2.3 and up: open scrolled to the founder's start words, and read the words at the top. */
  go?: (url: string, top: number, start: string) => void;
  mark?: () => void;
  /** App 1.2.6 and up: open and land on the verse (its number found on the page), else the start words. */
  verse?: (url: string, top: number, start: string, verse: number, code: string, chapter: number) => void;
  /** App 1.3.2 and up: open, then type the verse into the site's own search box. */
  verseTyped?: (url: string, top: number, start: string, verse: number, code: string, chapter: number, ref: string) => void;
  /** App 1.3.6 and up: the look of the window's page (a CSS filter: brightness, warmth, tint…). */
  look?: (filter: string) => void;
};

/** ☀ The window's look: kept on this phone, for every version in BIBLES. */
type Look = { bright: number; contrast: number; warm: number; tint: number; colour: number; sharp: number };
const LOOK_KEY = "porch-bibles-look";
const PLAIN: Look = { bright: 100, contrast: 100, warm: 0, tint: 0, colour: 100, sharp: 0 };
function readLook(): Look {
  try {
    return { ...PLAIN, ...(JSON.parse(localStorage.getItem(LOOK_KEY) || "{}") as Partial<Look>) };
  } catch {
    return PLAIN;
  }
}
const filterOf = (l: Look) =>
  [
    l.sharp > 0 ? `url(#porch-sharp-${l.sharp})` : "",
    l.bright === 100 && l.contrast === 100 && l.warm === 0 && l.tint === 0 && l.colour === 100
      ? ""
      : `brightness(${l.bright}%) contrast(${l.contrast}%) sepia(${l.warm}%) saturate(${l.colour}%) hue-rotate(${l.tint}deg)`,
  ]
    .filter(Boolean)
    .join(" ");
/** Sharpness: a small sharpening kernel (CSS has no sharpen of its own). */
export const sharpKernel = (n: number) => {
  const k = (n / 100) * 0.9;
  return `0 ${-k} 0 ${-k} ${1 + 4 * k} ${-k} 0 ${-k} 0`;
};
const SLIDERS: { key: keyof Look; label: string; min: number; max: number }[] = [
  { key: "bright", label: "Brighter / darker", min: 40, max: 170 },
  { key: "contrast", label: "Contrast", min: 50, max: 160 },
  { key: "warm", label: "Warmth", min: 0, max: 80 },
  { key: "tint", label: "Tint", min: -180, max: 180 },
  { key: "colour", label: "Colour", min: 0, max: 200 },
  { key: "sharp", label: "Sharpness", min: 0, max: 100 },
];
const appWindow = () => (window as unknown as { PorchWindow?: AppWindow }).PorchWindow ?? null;

export function BibleWindow({ book, chapter, verse, onClose }: { book: { number: number; name: string }; chapter: number; verse: number; onClose: () => void }) {
  // Instant: the versions kept on the phone; the server's list follows quietly.
  const [sites, setSites] = useState<BibleSite[] | null>(() => {
    try {
      const kept = JSON.parse(localStorage.getItem("porch-bible-sites") || "null") as BibleSite[] | null;
      return Array.isArray(kept) && kept.length ? kept : null;
    } catch {
      return null;
    }
  });
  const [canEdit, setCanEdit] = useState(() => {
    try {
      return localStorage.getItem("porch-bible-sites-edit") === "1";
    } catch {
      return false;
    }
  });
  const [pick, setPick] = useState(0);
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState("");
  const page = useRef<HTMLDivElement>(null);

  // The versions list is kept on the phone, so OTHERS opens with no data too.
  const load = () =>
    getBibleSites()
      .then((r) => {
        if (!r.ok) return;
        // Only change what's showing if the list really changed (no reload of the page).
        setSites((now) => (JSON.stringify(now) === JSON.stringify(r.sites) ? now : r.sites));
        setCanEdit(r.canEdit);
        try {
          localStorage.setItem("porch-bible-sites", JSON.stringify(r.sites));
          localStorage.setItem("porch-bible-sites-edit", r.canEdit ? "1" : "0");
        } catch {
          /* still shows now */
        }
        if (!r.sites.length && r.canEdit) setEditing(true);
      })
      .catch(() => setSites((now) => now ?? []));
  useEffect(() => {
    void load();
  }, []);

  const site = sites?.[Math.min(pick, (sites?.length ?? 1) - 1)];
  const url = site ? siteLink(site.url, book, chapter, verse) : "";
  const native = appWindow();
  const canStart = Boolean(native && typeof native.go === "function" && typeof native.mark === "function");
  const [loadedUrl, setLoadedUrl] = useState("");
  const [look, setLook] = useState<Look>(readLook);
  const [lookOpen, setLookOpen] = useState(false);
  const filter = filterOf(look);
  useEffect(() => {
    try {
      localStorage.setItem(LOOK_KEY, JSON.stringify(look));
    } catch {
      /* this visit only */
    }
    native?.look?.(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, url]);
  // The ☀ panel pushes the page down: keep the app's window over the page.
  useEffect(() => {
    if (!native) return;
    const id = window.requestAnimationFrame(() => {
      const top = page.current?.getBoundingClientRect().top;
      if (top !== undefined) native.move(Math.round(top));
    });
    return () => window.cancelAnimationFrame(id);
  }, [native, lookOpen]);
  const siteRef = useRef(site);
  siteRef.current = site;
  function say(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((now) => (now === message ? "" : now)), 3500);
  }

  // The app's own window sits exactly over the page area of this sheet.
  useEffect(() => {
    if (!native || editing || !url) return;
    const top = page.current?.getBoundingClientRect().top ?? window.innerHeight * 0.5;
    // A site whose link can't carry the verse: the app types it into the site's search box instead.
    const linkHasVerse = linkCarriesVerse(site?.url ?? "");
    if (!linkHasVerse && typeof native.verseTyped === "function") native.verseTyped(url, Math.round(top), site?.startText ?? "", verse, bookCode(book.number), chapter, `${book.name} ${chapter}:${verse}`);
    else if (typeof native.verse === "function") native.verse(url, Math.round(top), site?.startText ?? "", verse, bookCode(book.number), chapter);
    else if (canStart && native.go) native.go(url, Math.round(top), site?.startText ?? "");
    else native.open(url, Math.round(top));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, url, editing, site?.startText, verse]);
  // The phone turning (or the keyboard) moves the page area: keep the app's window over it.
  useEffect(() => {
    if (!native) return;
    const fit = () => {
      const top = page.current?.getBoundingClientRect().top;
      if (top !== undefined) native.move(Math.round(top));
    };
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [native]);
  // Back returns to the Bible (in the app, Back closes the app's window first and tells us, which closes this too).
  useBackLayer(true, onClose, "bible-versions");
  useEffect(() => {
    if (!native) return;
    if (editing || !url) native.close();
  }, [native, editing, url]);
  // The phone's back button closes the app's window; tell the page too.
  const closing = useRef(onClose);
  closing.current = onClose;
  useEffect(() => {
    const w = window as unknown as { __porchWindow?: (what: string, words?: string) => void };
    w.__porchWindow = (what, words?: string) => {
      if (what === "closed") closing.current();
      if (what === "mark") void keepStart(words ?? "");
    };
    return () => {
      w.__porchWindow = undefined;
      appWindow()?.close();
    };
  }, []);

  /** 📍 Start here: keep the words at the top of the window as where this version opens. */
  async function keepStart(words: string) {
    const now = siteRef.current;
    const text = words.replace(/\s+/g, " ").trim();
    if (!now) return;
    if (!text) {
      say("Couldn't find words there. Scroll a little and tap 📍 again.");
      return;
    }
    const r = await setBibleSiteStart({ data: { id: now.id, text } }).catch(() => null);
    if (!r || !r.ok) {
      say(r && !r.ok ? r.error : "That didn't save. Try again.");
      return;
    }
    setSites((all) => (all ? all.map((x) => (x.id === now.id ? { ...x, startText: text } : x)) : all));
    say(`📍 ${now.label} now opens at “${text}” for everyone.`);
  }

  return (
    <div className="bw-sheet" role="dialog" aria-label={`${book.name} ${chapter}:${verse} in other versions`}>
      <div className="bw-top">
        <button type="button" className="bw-back" onClick={onClose}>
          <ChevronLeft className="size-5" aria-hidden="true" />
          Bible
        </button>
        <b>
          ⇄ {book.name} {chapter}:{verse}
        </b>
        {!editing && site ? (
          <button type="button" className={`bw-round${lookOpen ? " is-on" : ""}`} onClick={() => setLookOpen((o) => !o)} aria-label="The window's light: brighter, darker, warmer, tint" aria-expanded={lookOpen}>
            ☀
          </button>
        ) : null}
        {canEdit && canStart && !editing && site ? (
          <button type="button" className="bw-round" onClick={() => native?.mark?.()} aria-label="Start here: this version opens at this spot for everyone">
            📍
          </button>
        ) : null}
        {canEdit && editing ? (
          <button type="button" className="bw-round" onClick={() => setEditing(false)} aria-label="Close the versions list">
            ⚙
          </button>
        ) : null}
      </div>
      {toast ? <p className="bw-toast">{toast}</p> : null}
      {editing ? (
        <SitesEditor
          sites={sites ?? []}
          onSaved={(next) => {
            setSites(next);
            setPick(0);
            setEditing(false);
          }}
        />
      ) : (
        <>
          {(sites && sites.length) || canEdit ? (
            <div className="bw-tabs" role="tablist">
              {(sites ?? []).map((s, i) => (
                <button key={s.id} type="button" role="tab" aria-selected={i === pick} className={i === pick ? "is-on" : ""} onClick={() => setPick(i)}>
                  {s.label}
                </button>
              ))}
              {/* The founder's ⚙ sits with the versions: paste a version's link here. */}
              {canEdit ? (
                <button type="button" className="bw-round bw-gear" onClick={() => setEditing(true)} aria-label="Choose the versions and their websites">
                  ⚙
                </button>
              ) : null}
            </div>
          ) : null}
          {look.sharp > 0 ? (
            <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
              <filter id={`porch-sharp-${look.sharp}`}>
                <feConvolveMatrix order="3" kernelMatrix={sharpKernel(look.sharp)} preserveAlpha="true" />
              </filter>
            </svg>
          ) : null}
          {lookOpen ? (
            <div className="bw-look">
              {SLIDERS.map((sl) => (
                <label key={sl.key}>
                  <span>{sl.label}</span>
                  <input type="range" min={sl.min} max={sl.max} value={look[sl.key]} onChange={(event) => setLook((l) => ({ ...l, [sl.key]: Number(event.target.value) }))} />
                </label>
              ))}
              <button type="button" onClick={() => setLook(PLAIN)}>
                Reset
              </button>
            </div>
          ) : null}
          <div ref={page} className="bw-page">
            {!sites ? (
              <PorchLoader size={150} label="Opening the versions" />
            ) : !sites.length ? (
              <p className="bw-empty">No other versions yet.</p>
            ) : native ? null : typeof navigator !== "undefined" && navigator.onLine === false ? (
              <p className="bw-empty">No data. In the Porchbook app, verses you've opened before show here without data.</p>
            ) : (
              <>
                {loadedUrl !== url ? (
                  <div className="bw-loading">
                    <PorchLoader size={150} label={`Opening ${site?.label ?? "the version"}`} />
                  </div>
                ) : null}
                <iframe
                  key={url}
                  src={url}
                  style={filter ? { filter } : undefined}
                  title={`${site?.label} · ${book.name} ${chapter}:${verse}`}
                  referrerPolicy="strict-origin-when-cross-origin"
                  onLoad={() => setLoadedUrl(url)}
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** The founder's list: a version's name and the website it opens. */
function SitesEditor({ sites, onSaved }: { sites: BibleSite[]; onSaved: (sites: BibleSite[]) => void }) {
  const [rows, setRows] = useState(() => (sites.length ? sites.map((s) => ({ label: s.label, url: s.url, startText: s.startText })) : [{ label: "", url: "", startText: "" }]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (i: number, key: "label" | "url" | "startText", value: string) => setRows((all) => all.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  async function save() {
    const clean = rows.map((r) => ({ label: r.label.trim(), url: r.url.trim(), startText: r.startText })).filter((r) => r.label || r.url);
    const bad = clean.find((r) => !r.label || !/^https:\/\/\S+$/i.test(r.url));
    if (bad) {
      setError("Each version needs a name and a link starting with https://");
      return;
    }
    setBusy(true);
    setError("");
    const r = await saveBibleSites({ data: { sites: clean } }).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) {
      setError(r && !r.ok ? r.error : "That didn't save. Try again.");
      return;
    }
    const fresh = await getBibleSites().catch(() => null);
    onSaved(fresh?.ok ? fresh.sites : []);
  }

  return (
    <div className="bw-edit">
      <p className="bw-help">
        Choose the versions and the website each one opens. Put the verse in the link with <code>{"{book}"}</code> <code>{"{ch}"}</code> <code>{"{v}"}</code>, or{" "}
        <code>{"{code}"}</code> (JHN) and <code>{"{ref}"}</code> (John 3:16). To choose where a version opens, scroll its page to the spot and tap 📍. Only you see this.
      </p>
      {rows.map((row, i) => (
        <div key={i} className="bw-row">
          <input value={row.label} onChange={(e) => set(i, "label", e.target.value)} placeholder="Name, e.g. MSG" aria-label={`Version ${i + 1} name`} maxLength={24} />
          <input value={row.url} onChange={(e) => set(i, "url", e.target.value)} placeholder="https://…{book}…{ch}…{v}" aria-label={`Version ${i + 1} link`} inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          <button type="button" className="bw-round" onClick={() => setRows((all) => all.filter((_, j) => j !== i))} aria-label={`Remove version ${i + 1}`}>
            −
          </button>
          {row.startText ? (
            <p className="bw-start">
              📍 Opens at “{row.startText}”
              <button type="button" onClick={() => set(i, "startText", "")}>
                Clear
              </button>
            </p>
          ) : null}
        </div>
      ))}
      {error ? <p className="bw-error">{error}</p> : null}
      <div className="bw-btns">
        <button type="button" onClick={() => setRows((all) => [...all, { label: "", url: "", startText: "" }])} disabled={rows.length >= 20}>
          + Add a version
        </button>
        <button type="button" className="is-main" onClick={() => void save()} disabled={busy}>
          {busy ? "…" : "Save"}
        </button>
      </div>
    </div>
  );
}
