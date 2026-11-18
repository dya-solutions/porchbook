import { listNotes, openNote, saveNote, type NoteCard } from "@/lib/porch/read";

/**
 * Notes that work without data. Every note opened or saved is kept on the phone; a save made
 * offline waits in an outbox and is uploaded by itself when data returns. If the same note was
 * changed elsewhere meanwhile, the newest version wins.
 */

export type NoteCopy = { title: string; subtitle: string; phaneroo: string; kind: string; body: string; updatedAt: string };
type Seed = Record<string, unknown>;
type Waiting = NoteCopy & { id: string; seed: Seed; at: number };

const LIST = "porch-notes-list";
const COPY = "porch-note:";
const OUTBOX = "porch-notes-outbox";
export const NOTES_SYNCED = "porch-notes-synced";

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* the phone is full: it still works while online */
  }
};

export const isLocalId = (id: string) => id.startsWith("local-");
export const offlineNow = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** A network failure (no data), not the server saying no. */
function noNetwork(error: unknown) {
  return offlineNow() || (error instanceof TypeError) || /fetch|network|failed to load|load failed/i.test(String((error as Error)?.message ?? error));
}

function outbox(): Waiting[] {
  return read<Waiting[]>(OUTBOX, []);
}
export function waitingCount() {
  return outbox().length;
}

export function keepCopy(id: string, copy: NoteCopy) {
  if (id) write(COPY + id, copy);
}
export function keptCopy(id: string): NoteCopy | null {
  return read<NoteCopy | null>(COPY + id, null);
}

/** The notebook's list: from the server when there's data (kept), else the kept one, plus notes waiting to upload. */
export async function notesList(seed: Seed): Promise<{ notes: NoteCard[]; offline: boolean } | null> {
  let notes: NoteCard[] | null = null;
  let offline = false;
  try {
    const listed = await listNotes({ data: seed as never });
    notes = listed.notes;
    write(LIST, notes);
  } catch (error) {
    if (!noNetwork(error)) return null;
    offline = true;
    notes = read<NoteCard[]>(LIST, []);
  }
  // Notes saved on the phone but not uploaded yet: shown first, with their newest words.
  const waiting = outbox();
  const merged = new Map(notes.map((n) => [n.id, n]));
  for (const w of waiting) merged.set(w.id, { id: w.id, title: w.title, phaneroo: w.phaneroo, updatedAt: new Date(w.at).toISOString() });
  const list = [...merged.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { notes: list, offline };
}

/** Open a note: from the server when there's data (kept), else the copy on the phone. */
export async function noteOpen(seed: Seed, id: string): Promise<({ ok: true; offline: boolean } & NoteCopy) | { ok: false; error: string }> {
  const waiting = outbox().find((w) => w.id === id);
  if (waiting || isLocalId(id)) {
    const copy = waiting ?? keptCopy(id);
    return copy ? { ok: true, offline: true, ...pick(copy) } : { ok: false, error: "That note isn't on this phone." };
  }
  try {
    const result = await openNote({ data: { ...(seed as object), id } as never });
    if (result.ok) keepCopy(id, pick(result));
    return result.ok ? { ok: true, offline: false, ...pick(result) } : result;
  } catch (error) {
    const copy = keptCopy(id);
    if (copy && noNetwork(error)) return { ok: true, offline: true, ...copy };
    return { ok: false, error: noNetwork(error) ? "No data, and this note isn't on this phone yet." : "Couldn't open the note." };
  }
}

const pick = (x: NoteCopy): NoteCopy => ({ title: x.title, subtitle: x.subtitle, phaneroo: x.phaneroo, kind: x.kind, body: x.body, updatedAt: x.updatedAt });

/** Save: straight up when there's data; otherwise on the phone, to upload later. */
export async function noteSave(seed: Seed, id: string, copy: Omit<NoteCopy, "updatedAt">): Promise<{ ok: true; id: string; offline: boolean } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const later = () => {
    const localId = id || `local-${Date.now().toString(36)}`;
    const box = outbox().filter((w) => w.id !== localId);
    box.push({ ...copy, updatedAt: now, id: localId, seed, at: Date.now() });
    write(OUTBOX, box);
    keepCopy(localId, { ...copy, updatedAt: now });
    return { ok: true as const, id: localId, offline: true };
  };
  if (offlineNow() || (id && outbox().some((w) => w.id === id)) || isLocalId(id)) {
    const kept = later();
    if (!offlineNow()) void syncNotes(); // there's data again: send it now
    return kept;
  }
  try {
    const result = await saveNote({ data: { ...(seed as object), id, ...copy } as never });
    if (result.ok) keepCopy(result.id, { ...copy, updatedAt: now });
    return result.ok ? { ok: true, id: result.id, offline: false } : result;
  } catch (error) {
    if (noNetwork(error)) return later();
    return { ok: false, error: "Couldn't save." };
  }
}

let syncing = false;
/** Upload what waits on the phone. Newest wins: a note changed elsewhere after this edit is left as it is there. */
export async function syncNotes(): Promise<number> {
  if (syncing || offlineNow()) return 0;
  const box = outbox();
  if (!box.length) return 0;
  syncing = true;
  let sent = 0;
  const renamed: Record<string, string> = {};
  try {
    for (const w of box) {
      let serverId = isLocalId(w.id) ? "" : w.id;
      if (serverId) {
        // Changed on another phone after this edit? Then that newer version stays.
        const there = await openNote({ data: { ...(w.seed as object), id: serverId } as never });
        if (there.ok && Date.parse(there.updatedAt) > w.at) {
          keepCopy(serverId, pick(there));
          drop(w.id);
          sent += 1;
          continue;
        }
        if (!there.ok) serverId = ""; // deleted there: keep the words as a new note
      }
      const result = await saveNote({ data: { ...(w.seed as object), id: serverId, title: w.title, subtitle: w.subtitle, phaneroo: w.phaneroo, kind: w.kind, body: w.body } as never });
      if (!result.ok) continue;
      if (result.id !== w.id) renamed[w.id] = result.id;
      keepCopy(result.id, pick(w));
      drop(w.id);
      sent += 1;
    }
  } catch {
    /* data dropped again: the rest waits */
  } finally {
    syncing = false;
  }
  if (sent) window.dispatchEvent(new CustomEvent(NOTES_SYNCED, { detail: { renamed } }));
  return sent;
}
function drop(id: string) {
  write(
    OUTBOX,
    outbox().filter((w) => w.id !== id),
  );
}

/** Upload by itself whenever data comes back (and once at start). */
export function watchNotesSync() {
  if (typeof window === "undefined") return () => undefined;
  const go = () => void syncNotes();
  window.addEventListener("online", go);
  const timer = window.setInterval(go, 60000);
  go();
  return () => {
    window.removeEventListener("online", go);
    window.clearInterval(timer);
  };
}
