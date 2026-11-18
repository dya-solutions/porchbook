import { useState } from "react";
import { downloadBook, removeBook, sizeLabel, useDownloaded } from "@/lib/porch/offline-books";

/** ⬇ Download / ✓ On this phone, in a book's top bar. */
export function BookDownload({ bookKey, hasPdf, seed, className = "" }: { bookKey: string; hasPdf: boolean; seed: Record<string, unknown>; className?: string }) {
  // Small in a book's top bar: just ⬇ or ✓ (the words are in the menu and the label).
  const info = useDownloaded(bookKey);
  const [state, setState] = useState<"" | "busy" | "menu" | "failed">("");
  const [error, setError] = useState("");

  async function get() {
    setState("busy");
    try {
      await downloadBook(seed, bookKey, hasPdf);
      setState("");
    } catch (caught) {
      setError(navigator.onLine === false ? "No data right now." : caught instanceof Error ? caught.message : "Couldn't download.");
      setState("failed");
      window.setTimeout(() => setState(""), 4000);
    }
  }

  if (state === "busy") return <span className={`book-dl is-busy ${className}`} aria-label="Downloading">…</span>;
  if (state === "failed")
    return (
      <span className={`book-dl-wrap ${className}`}>
        <span className="book-dl is-failed">!</span>
        <span className="book-dl-menu">
          <small>{error}</small>
        </span>
      </span>
    );
  if (info) {
    return (
      <span className={`book-dl-wrap ${className}`}>
        <button type="button" className="book-dl is-kept" onClick={() => setState((s) => (s === "menu" ? "" : "menu"))} aria-expanded={state === "menu"} aria-label="On this phone: reads without data">
          ✓
        </button>
        {state === "menu" ? (
          <span className="book-dl-menu">
            <small>✓ On this phone · {sizeLabel(info.bytes)} · reads without data</small>
            <button type="button" onClick={() => void get()}>
              Update copy
            </button>
            <button
              type="button"
              onClick={() => {
                setState("");
                void removeBook(bookKey);
              }}
            >
              Remove from phone
            </button>
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <button type="button" className={`book-dl ${className}`} onClick={() => void get()} aria-label="Download: read without data">
      ⬇
    </button>
  );
}
