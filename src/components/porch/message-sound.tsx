import { useEffect, useState } from "react";
import { quietButtonClass } from "@/components/porch/bits";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getMessageSound, setMessageSound } from "@/lib/porch/message-sound";
import { previewMessageSound, refreshMessageSound, shapeMessageSound } from "@/lib/porch/message-sound-play";

/** Founder: upload the sound everyone hears for a new message. Porchbook trims, levels and softens it first. */
export function MessageSoundSetter() {
  const { user } = useCurrentUserState();
  const [founder, setFounder] = useState(false);
  const [open, setOpen] = useState(false);
  const [has, setHas] = useState(false);
  const [ready, setReady] = useState<{ mime: string; audio: string; seconds: number } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const seed = { displayName: user?.displayName ?? "", email: user?.primaryEmail ?? null, imageUrl: user?.profileImageUrl ?? null };

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    getMessageSound({ data: seed })
      .then((result) => {
        if (cancel) return;
        setFounder(result.founder);
        setHas(Boolean(result.audio));
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
        Message sound
      </button>
    );
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setNote("Preparing a gentle version…");
    try {
      const shaped = await shapeMessageSound(file);
      setReady(shaped);
      setNote(`Ready: ${shaped.seconds.toFixed(1)} s, softened. Listen, then save.`);
      previewMessageSound(shaped.mime, shaped.audio);
    } catch (caught) {
      setReady(null);
      setNote(caught instanceof Error ? caught.message : "That sound couldn't be read.");
    }
    setBusy(false);
  }

  async function save(clear = false) {
    setBusy(true);
    const result = await setMessageSound({ data: { mime: clear ? "" : ready?.mime ?? "", audio: clear ? "" : ready?.audio ?? "", ...seed } }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setNote(result?.error ?? "Couldn't save. Check your connection.");
      return;
    }
    await refreshMessageSound(seed, true).catch(() => undefined);
    setHas(!clear);
    setReady(null);
    setNote(clear ? "Message sound removed." : "Saved. Everyone hears it for unread messages (not 10 pm–6 am their time, not in calls).");
  }

  return (
    <div className="mt-3">
      <p className="text-sm font-medium text-ink">Message sound</p>
      <p className="mt-1 text-sm text-muted">One sound for everyone when a private message arrives. It's trimmed to 1.5 seconds, made calm and faded. It rings when Porchbook opens with unread messages and for new ones, 3 times 10 seconds apart. Quiet 10 pm–6 am (each phone's own time), during calls, and while reading messages.</p>
      <label className={`${quietButtonClass} mt-2 cursor-pointer`}>
        {busy ? "Working…" : "Choose a sound"}
        <input
          type="file"
          accept="audio/*"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void pick(file);
          }}
        />
      </label>
      {ready ? (
        <>
          <button type="button" className={`${quietButtonClass} mt-2`} onClick={() => previewMessageSound(ready.mime, ready.audio)}>
            ▶ Listen again
          </button>
          <button type="button" className={`${quietButtonClass} mt-2`} disabled={busy} onClick={() => void save()}>
            Save for everyone
          </button>
        </>
      ) : null}
      {has && !ready ? (
        <button type="button" className={`${quietButtonClass} mt-2`} disabled={busy} onClick={() => void save(true)}>
          Remove the sound
        </button>
      ) : null}
      <button type="button" className={`${quietButtonClass} mt-2`} onClick={() => setOpen(false)}>
        Close
      </button>
      {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
    </div>
  );
}
