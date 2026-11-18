import { unzipSync, strFromU8 } from "fflate";

/**
 * Bringing notes in from other notebooks: text files, Google Keep exports (Takeout .zip or its .json
 * files), web pages saved from a notes app, and words shared to Porchbook. Each becomes a plain note.
 */

export type Incoming = { title: string; body: string };

/** Plain words → a Porchbook note's writing (codes can't sneak in). */
export function toMarks(text: string) {
  return text.replace(/\r\n?/g, "\n").replace(/\{\{/g, "{ {").replace(/\n{4,}/g, "\n\n\n").trim();
}

/** The first line becomes the title when there's more than one line; otherwise the file's name does. */
export function fromText(text: string, fallback = ""): Incoming | null {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  if (!clean) return null;
  const lines = clean.split("\n");
  const first = lines[0].replace(/^#+\s*/, "").trim();
  if (lines.length > 1 && first.length <= 80) return { title: first, body: toMarks(lines.slice(1).join("\n")) };
  return { title: fallback.slice(0, 80) || first.slice(0, 60), body: toMarks(clean) };
}

type KeepNote = { title?: string; textContent?: string; listContent?: { text?: string; isChecked?: boolean }[]; isTrashed?: boolean };
/** One Google Keep note (from Takeout): its title, text, and tick lists. Notes in Keep's bin are skipped. */
export function fromKeep(note: KeepNote): Incoming | null {
  if (!note || note.isTrashed) return null;
  const list = (note.listContent ?? []).map((item) => `${item.isChecked ? "☑" : "☐"} ${item.text ?? ""}`).join("\n");
  const text = [note.textContent ?? "", list].filter(Boolean).join("\n");
  const title = (note.title ?? "").trim();
  if (!title && !text.trim()) return null;
  return title ? { title: title.slice(0, 80), body: toMarks(text) } : fromText(text);
}

function fromHtml(html: string, name: string): Incoming | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  doc.querySelectorAll("p,div,li,h1,h2,h3").forEach((el) => el.append("\n"));
  const title = doc.querySelector(".title, h1, title")?.textContent?.trim() ?? "";
  const text = (doc.body?.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
  if (title && text.startsWith(title)) return { title: title.slice(0, 80), body: toMarks(text.slice(title.length)) };
  return title ? { title: title.slice(0, 80), body: toMarks(text) } : fromText(text, name);
}

const stem = (name: string) => name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");

/** Read the chosen files into notes. */
export async function readNoteFiles(files: File[]): Promise<{ notes: Incoming[]; skipped: number }> {
  const notes: Incoming[] = [];
  let skipped = 0;
  const take = (name: string, data: string) => {
    const lower = name.toLowerCase();
    let got: Incoming | null = null;
    try {
      if (lower.endsWith(".json")) {
        const keep = JSON.parse(data) as KeepNote;
        if (keep?.isTrashed) return; // in Keep's bin: left out on purpose, not a failure
        got = fromKeep(keep);
      }
      else if (lower.endsWith(".html") || lower.endsWith(".htm")) got = fromHtml(data, stem(name));
      else got = fromText(data, stem(name));
    } catch {
      got = null;
    }
    if (got) notes.push(got);
    else skipped += 1;
  };
  for (const file of files) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".zip")) {
      try {
        const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
        const names = Object.keys(entries);
        // A Google Keep export: its .json notes (each has an .html twin; one of each is enough).
        const keep = names.filter((n) => /keep\//i.test(n) && n.toLowerCase().endsWith(".json"));
        const pick = keep.length ? keep : names.filter((n) => /\.(txt|md|text|html?)$/i.test(n));
        for (const n of pick) take(n, strFromU8(entries[n]));
      } catch {
        skipped += 1;
      }
    } else if (/\.(txt|md|text|json|html?)$/i.test(lower) || file.type.startsWith("text/")) {
      take(file.name, await file.text());
    } else {
      skipped += 1;
    }
    if (notes.length >= 500) break;
  }
  return { notes: notes.slice(0, 500), skipped };
}
