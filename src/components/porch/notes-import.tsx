import { useRef, useState } from "react";
import { readNoteFiles, type Incoming } from "@/lib/porch/notes-import";

/** Import notes from other notebooks, with simple steps for each kind of notes app. */
export function ImportNotes({ onSave, onClose }: { onSave: (notes: Incoming[], progress: (done: number) => void) => Promise<number>; onClose: () => void }) {
  const inApp = typeof window !== "undefined" && typeof (window as unknown as { PorchApp?: { takeShared?: unknown } }).PorchApp?.takeShared === "function";
  const [from, setFrom] = useState<"samsung" | "keep" | "other">("samsung");
  const [state, setState] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLInputElement>(null);

  async function chosen(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setState("Reading your files…");
    const { notes, skipped } = await readNoteFiles(files);
    if (!notes.length) {
      setBusy(false);
      setState("No notes found in those files. Choose text files (.txt), or the Google Keep .zip.");
      return;
    }
    setState(`Adding ${notes.length} note${notes.length === 1 ? "" : "s"}…`);
    const added = await onSave(notes, (done) => setState(`Adding ${done} of ${notes.length}…`));
    setBusy(false);
    setState(`✓ ${added} note${added === 1 ? "" : "s"} added to your notebook.${skipped ? ` ${skipped} file${skipped === 1 ? "" : "s"} couldn't be read.` : ""}`);
  }

  const steps =
    from === "samsung"
      ? [
          "Open Samsung Notes.",
          "Press and hold a note (tap more to pick several).",
          "Tap Share, then choose Text file.",
          "Save it to your phone (Downloads is fine).",
          "Come back here and tap Choose files.",
        ]
      : from === "keep"
        ? [
            "In your browser, go to takeout.google.com and sign in.",
            "Tap Deselect all, then tick only Keep.",
            "Tap Next step, then Create export.",
            "When Google says it's ready, download the .zip file.",
            "Come back here, tap Choose files and pick that .zip.",
          ]
        : [
            "Open your notes app.",
            "Look for Export, Share or Save as, and choose Text (.txt).",
            "Save the file to your phone.",
            "Come back here and tap Choose files.",
          ];

  return (
    <div className="ni-sheet" role="dialog" aria-label="Import notes">
      <div className="ni-head">
        <b>Import notes</b>
        <button type="button" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      {inApp ? (
        <p className="ni-quick">
          <b>Just one note?</b> Open it in your notes app, tap <b>Share</b>, then <b>Porchbook notes</b>. It comes straight here.
        </p>
      ) : null}
      <p className="ni-ask">Where are your notes now?</p>
      <div className="ni-tabs" role="tablist">
        {(
          [
            ["samsung", "Samsung Notes"],
            ["keep", "Google Keep"],
            ["other", "Another app"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={from === key} className={from === key ? "is-on" : ""} onClick={() => setFrom(key)}>
            {label}
          </button>
        ))}
      </div>
      <ol className="ni-steps">
        {steps.map((step, i) => (
          <li key={i}>
            <span>{i + 1}</span>
            {step}
          </li>
        ))}
      </ol>
      <input
        ref={box}
        type="file"
        multiple
        accept=".txt,.md,.text,.json,.html,.htm,.zip,text/plain,application/zip"
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void chosen(files);
        }}
      />
      <button type="button" className="ni-choose" disabled={busy} onClick={() => box.current?.click()}>
        {busy ? "Working…" : "Choose files"}
      </button>
      {state ? <p className="ni-state">{state}</p> : <p className="ni-note">Only the files you choose are read. Your notes stay private.</p>}
    </div>
  );
}

/** Words shared from a notes app: offer them as a new note. */
export function SharedNoteCard({ shared, onAdd, onSkip }: { shared: Incoming; onAdd: () => void; onSkip: () => void }) {
  return (
    <div className="ni-sheet ni-shared" role="dialog" aria-label="Add this note">
      <div className="ni-head">
        <b>Add this to your notes?</b>
      </div>
      <p className="ni-shared-title">{shared.title || "Untitled"}</p>
      <p className="ni-shared-body">{shared.body.slice(0, 280)}{shared.body.length > 280 ? "…" : ""}</p>
      <div className="ni-row">
        <button type="button" className="ni-choose" onClick={onAdd}>
          Add to my notes
        </button>
        <button type="button" className="ni-skip" onClick={onSkip}>
          No thanks
        </button>
      </div>
    </div>
  );
}
