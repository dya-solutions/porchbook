import { useEffect, useState } from "react";
import { quietButtonClass } from "@/components/porch/bits";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { loadButtonSound, setButtonSound } from "@/lib/porch/button-sound";
import { ensureButtonSound, refreshButtonSound } from "@/lib/porch/button-sound-play";

const BELONGS = [
  ["drop", "A reaction"],
  ["tap", "A button"],
  ["sign", "Sign out"],
  ["open", "Opening"],
  ["bell", "An office"],
  ["bend", "A post bend"],
] as const;

type Belong = (typeof BELONGS)[number][0];

const TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/webm", "audio/mp4", "audio/aac", "audio/x-m4a"]);

function soundType(file: File) {
  if (TYPES.has(file.type)) return file.type === "audio/mp3" ? "audio/mpeg" : file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".wav")) return "audio/wav";
  if (name.endsWith(".m4a")) return "audio/mp4";
  if (name.endsWith(".webm")) return "audio/webm";
  return "";
}

function readSound(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const comma = text.indexOf(",");
      resolve(comma >= 0 ? text.slice(comma + 1) : text);
    };
    reader.onerror = () => reject(new Error("Couldn't read that sound."));
    reader.readAsDataURL(file);
  });
}

export function useButtonSound() {
  const { user } = useCurrentUserState();
  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };

  useEffect(() => {
    if (!user?.id) return;
    void ensureButtonSound(seed);
  }, [user?.id, seed.displayName, seed.email, seed.imageUrl]);
}

export function ButtonSoundSetter() {
  const { user } = useCurrentUserState();
  const [founder, setFounder] = useState(false);
  const [open, setOpen] = useState<0 | 1 | 2 | 3 | 4 | 5 | 6>(0);
  const [has, setHas] = useState(false);
  const [signHas, setSignHas] = useState(false);
  const [openHas, setOpenHas] = useState(false);
  const [bellHas, setBellHas] = useState(false);
  const [bendHas, setBendHas] = useState(false);
  const [extraHas, setExtraHas] = useState(false);
  const [belongs, setBelongs] = useState<Belong>("drop");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    loadButtonSound({ data: seed })
      .then((result) => {
        if (cancel) return;
        setFounder(result.founder);
        setHas(Boolean(result.audio));
        setSignHas(Boolean(result.signAudio));
        setOpenHas(Boolean(result.openAudio));
        setBellHas(Boolean(result.bellAudio));
        setBendHas(Boolean(result.bendAudio));
        setExtraHas(Boolean(result.extraAudio));
        setBelongs(result.extraBelongs === "tap" || result.extraBelongs === "sign" || result.extraBelongs === "open" || result.extraBelongs === "bell" || result.extraBelongs === "bend" || result.extraBelongs === "drop" ? result.extraBelongs : "drop");
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [user?.id, seed.displayName, seed.email, seed.imageUrl]);

  if (!founder) return null;

  async function save(slot: 1 | 2 | 3 | 4 | 5 | 6, file: File | undefined) {
    if (!file) return;
    const mime = soundType(file);
    if (!mime) {
      setError("Use an mp3, m4a, wav, or webm sound.");
      return;
    }
    if (file.size > 400_000) {
      setError("Keep the sound under 400 KB.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const audio = await readSound(file);
      const result = await setButtonSound({ data: { mime, audio, slot, belongs: slot === 6 ? belongs : "drop", ...seed } });
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (slot === 1) setHas(true);
      else if (slot === 2) setSignHas(true);
      else if (slot === 3) setOpenHas(true);
      else if (slot === 4) setBellHas(true);
      else if (slot === 5) setBendHas(true);
      else setExtraHas(true);
      setOpen(0);
      refreshButtonSound(seed);
    } catch {
      setPending(false);
      setError("Couldn't read that sound.");
    }
  }

  async function clear(slot: 1 | 2 | 3 | 4 | 5 | 6) {
    setPending(true);
    setError("");
    const result = await setButtonSound({ data: { mime: "", audio: "", slot, ...seed } });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (slot === 1) setHas(false);
    else if (slot === 2) setSignHas(false);
    else if (slot === 3) setOpenHas(false);
    else if (slot === 4) setBellHas(false);
    else if (slot === 5) setBendHas(false);
    else setExtraHas(false);
    setOpen(0);
    refreshButtonSound(seed);
  }

  async function retarget(next: Belong) {
    setBelongs(next);
    if (!extraHas) return;
    setPending(true);
    setError("");
    const result = await setButtonSound({ data: { mime: "", audio: "", slot: 6, belongs: next, belongsOnly: true, ...seed } });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    refreshButtonSound(seed);
  }

  if (!open) {
    return (
      <>
        <button type="button" className={`${quietButtonClass} mt-3 px-0`} onClick={() => setOpen(1)}>
          Button sound
        </button>
        <button type="button" className={`${quietButtonClass} mt-3 px-0`} onClick={() => setOpen(2)}>
          Sign out sound
        </button>
        <button type="button" className={`${quietButtonClass} mt-3 px-0`} onClick={() => setOpen(3)}>
          Opening sound
        </button>
        <button type="button" className={`${quietButtonClass} mt-3 px-0`} onClick={() => setOpen(4)}>
          Offices bell
        </button>
        <button type="button" className={`${quietButtonClass} mt-3 px-0`} onClick={() => setOpen(5)}>
          Post bend
        </button>
        <button type="button" className={`${quietButtonClass} mt-3 px-0`} onClick={() => setOpen(6)}>
          Another sound
        </button>
      </>
    );
  }

  const slot = open;
  const ready = slot === 2 ? signHas : slot === 3 ? openHas : slot === 4 ? bellHas : slot === 5 ? bendHas : slot === 6 ? extraHas : has;
  const hint =
    slot === 6
      ? "Upload one sound, then choose what it belongs to. You can change that later without uploading again."
      : slot === 2
      ? "This plays when Sign out is pressed. It can be a little longer than the button sound."
      : slot === 3
        ? "This plays once when Porchbook opens, after a sign-in or when someone comes back in. Keep it short."
        : slot === 4
          ? "This plays when any office in the Offices compartment is tapped. Keep it to about one second."
          : slot === 5
            ? "This plays while a finger is on a post edge, and stops when the finger lifts. A long hold plays the whole sound. Keep it very short."
            : "This plays when Home, Tour, My 20, Pray, Previously, or Serve is pressed. Keep it under two seconds.";

  return (
    <div className="mt-3 grid gap-2">
      <p className="text-sm text-muted">{hint}</p>
      {slot === 6 ? (
        <label className="grid gap-1 text-sm text-ink">
          This belongs to
          <select
            className={quietButtonClass}
            value={belongs}
            disabled={pending}
            onChange={(event) => void retarget(event.target.value as Belong)}
          >
            {BELONGS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className={`${quietButtonClass} cursor-pointer`}>
        {pending ? "Saving…" : ready ? "Replace the sound" : "Upload a sound"}
        <input
          type="file"
          accept="audio/mpeg,audio/mp4,audio/wav,audio/webm,.mp3,.m4a,.wav,.webm"
          className="sr-only"
          disabled={pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void save(slot, file);
          }}
        />
      </label>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {ready ? (
          <button type="button" className={quietButtonClass} disabled={pending} onClick={() => void clear(slot)}>
            Remove
          </button>
        ) : null}
        <button
          type="button"
          className={quietButtonClass}
          onClick={() => setOpen(0)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
