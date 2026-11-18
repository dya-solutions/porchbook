import { useEffect, useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
import { fieldClass, primaryButtonClass, quietButtonClass } from "@/components/porch/bits";

type Item = { id: string; kind: string; title: string; body: string };
type Kind = "video" | "flyer" | "note";

function authHeaders() {
  const token = getBearerToken();
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

async function sendFile(id: string, kind: Kind, title: string, file: File) {
  const chunk = 700_000;
  const parts = Math.max(1, Math.ceil(file.size / chunk));
  for (let part = 0; part < parts; part += 1) {
    const slice = file.slice(part * chunk, Math.min(file.size, (part + 1) * chunk));
    const params = new URLSearchParams({
      id,
      kind,
      title,
      part: String(part),
      parts: String(parts),
      name: file.name,
      type: file.type,
    });
    const token = getBearerToken();
    if (token) params.set("t", token);
    const response = await fetch(`/api/city-board?${params.toString()}`, {
      method: "POST",
      headers: authHeaders(),
      body: slice,
    });
    const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !data?.ok) return data?.error || "That file didn't upload.";
  }
  return "";
}

export function ClearEvents() {
  const [ask, setAsk] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function clear() {
    setBusy(true);
    setNote("");
    const params = new URLSearchParams({ drop: "all" });
    const token = getBearerToken();
    if (token) params.set("t", token);
    try {
      const response = await fetch(`/api/city-board?${params.toString()}`, {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
      });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      setBusy(false);
      if (!response.ok || !data?.ok) {
        setNote(data?.error || "Events stayed.");
        return;
      }
      setAsk(false);
      setNote("Events deleted.");
    } catch {
      setBusy(false);
      setNote("Events stayed.");
    }
  }

  if (ask) {
    return (
      <div className="mt-3">
        <p className="text-sm text-ink">Delete every video, flyer, and announcement?</p>
        <div className="mt-2 flex gap-2">
          <button type="button" className={primaryButtonClass} disabled={busy} onClick={() => void clear()}>
            {busy ? "Deleting" : "Delete events"}
          </button>
          <button type="button" className={quietButtonClass} onClick={() => setAsk(false)}>
            Cancel
          </button>
        </div>
        {note ? <p className="mt-1 text-sm text-muted">{note}</p> : null}
      </div>
    );
  }

  return (
    <div className="mt-3">
      <button type="button" className={`${quietButtonClass} px-0`} onClick={() => setAsk(true)}>
        Delete events
      </button>
      {note ? <p className="mt-1 text-sm text-muted">{note}</p> : null}
    </div>
  );
}

export function CityEvents({ open }: { open: boolean }) {
  const [founder, setFounder] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [kind, setKind] = useState<Kind>("video");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [dropping, setDropping] = useState("");
  const [ready, setReady] = useState(false);

  async function load() {
    try {
      const response = await fetch("/api/city-board", { headers: authHeaders() });
      if (response.ok) {
        const data = (await response.json()) as { founder?: boolean; items?: Item[] };
        setFounder(Boolean(data.founder));
        setItems(data.items ?? []);
      }
    } catch {
      /* the panel still explains where events play */
    }
    setReady(true);
  }

  useEffect(() => {
    void load();
  }, []);

  async function add() {
    setBusy(true);
    setNote("");
    const id = crypto.randomUUID();
    if (kind === "note") {
      const params = new URLSearchParams({ id, kind, title, body });
      const response = await fetch(`/api/city-board?${params.toString()}`, { method: "POST", headers: authHeaders() });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      setBusy(false);
      if (!response.ok || !data?.ok) {
        setNote(data?.error || "That announcement didn't save.");
        return;
      }
    } else {
      if (!file) {
        setBusy(false);
        setNote(kind === "flyer" ? "Choose the flyer." : "Choose the video.");
        return;
      }
      const error = await sendFile(id, kind, title, file);
      setBusy(false);
      if (error) {
        setNote(error);
        return;
      }
    }
    setTitle("");
    setBody("");
    setFile(null);
    setNote("Added.");
    await load();
  }

  async function remove(id: string) {
    if (!id || dropping) return;
    setDropping(id);
    setNote("");
    const params = new URLSearchParams({ id, drop: "1" });
    const token = getBearerToken();
    if (token) params.set("t", token);
    try {
      const response = await fetch(`/api/city-board?${params.toString()}`, {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
      });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !data?.ok) {
        setNote(data?.error || "That one didn't come off.");
        setDropping("");
        return;
      }
      setItems((current) => current.filter((item) => item.id !== id));
      setNote("Removed.");
      await load();
    } catch {
      setNote("That one didn't come off.");
    }
    setDropping("");
  }

  if (!open) return null;

  if (!ready || !founder) {
    return (
      <section className="tour-sheet glass-edge w-full rounded-2xl bg-black p-4">
        <h2 className="font-display text-xl text-ink">Events</h2>
        <p className="mt-1 text-sm text-muted">
          {ready
            ? "These show on the porch guy's screen. Visit him, tap his screen to open one, or ask him what's happening."
            : "Opening events…"}
        </p>
      </section>
    );
  }

  return (
    <section className="tour-sheet glass-edge w-full rounded-2xl bg-black p-4">
      <h2 className="font-display text-xl text-ink">Events</h2>
      <p className="text-sm text-muted">Videos, flyers, and announcements. They take turns on the porch guy's screen, and he knows about them.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(["video", "flyer", "note"] as const).map((item) => (
          <button key={item} type="button" className={kind === item ? primaryButtonClass : quietButtonClass} onClick={() => setKind(item)}>
            {item === "note" ? "Announcement" : item === "flyer" ? "Flyer" : "Video"}
          </button>
        ))}
      </div>
      <label className="mt-3 block text-sm text-muted">
        Title
        <input className={`${fieldClass} mt-1 w-full`} value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
      </label>
      {kind === "note" ? (
        <label className="mt-3 block text-sm text-muted">
          Announcement
          <textarea className={`${fieldClass} mt-1 w-full`} rows={3} value={body} maxLength={500} onChange={(event) => setBody(event.target.value)} />
        </label>
      ) : (
        <label className="mt-3 block text-sm text-muted">
          {kind === "flyer" ? "Flyer" : "Video"}
          <input
            className="mt-1 block w-full text-sm"
            type="file"
            accept={kind === "flyer" ? "image/jpeg,image/png,image/webp" : "video/mp4,video/webm,video/quicktime"}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
      )}
      <button type="button" className={`${primaryButtonClass} mt-3`} disabled={busy} onClick={() => void add()}>
        Add
      </button>
      {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-2 text-sm text-ink">
            <span className="truncate">
              {item.kind === "note" ? "Announcement" : item.kind === "flyer" ? "Flyer" : "Video"}
              {item.title ? ` · ${item.title}` : ""}
            </span>
            <button
              type="button"
              className={quietButtonClass}
              disabled={dropping === item.id}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void remove(item.id);
              }}
            >
              {dropping === item.id ? "Removing" : "Remove"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
