// Stage 4d: Porch settings → Devotional. New churches start with none. An admin chooses none,
// "our own" (typed in the app), or a website address. Phaneroo keeps phaneroo.org's daily
// devotional, which changes by itself each day.
import { useEffect, useState } from "react";
import { loadDevotionSetting, saveDevotionSetting, type DevotionSource } from "@/lib/porch/read";

type Loaded = Awaited<ReturnType<typeof loadDevotionSetting>>;

export function DevotionSetting() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [source, setSource] = useState<DevotionSource>("none");
  const [link, setLink] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadDevotionSetting()
      .then((result) => {
        setLoaded(result);
        setSource(result.source);
        setLink(result.link);
        setTitle(result.title);
        setText(result.text);
      })
      .catch(() => setNote("Couldn't open the devotional setting."));
  }, []);

  if (!loaded) return note ? <p className="text-danger">{note}</p> : null;

  const choices: { key: DevotionSource; name: string; hint: string }[] = [
    { key: "none", name: "No devotional", hint: "The Read screen doesn't show one" },
    { key: "own", name: "Our own", hint: "Type today's devotional here in the app" },
    { key: "link", name: "A website", hint: "Your church's devotional page on the internet" },
  ];
  if (loaded.canFollowPhaneroo) choices.unshift({ key: "phaneroo", name: "Phaneroo's daily devotional", hint: "From phaneroo.org. It changes by itself each morning" });

  async function save() {
    setBusy(true);
    setNote("");
    const result = await saveDevotionSetting({ data: { source, link, title, text } }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setNote(result?.error ?? "That didn't go through.");
      return;
    }
    try {
      localStorage.removeItem("porch-devotion-source");
    } catch {
      /* fine */
    }
    setNote("Saved. Members see it on the Read screen.");
  }

  return (
    <div className="pb-card ofc-form" style={{ marginTop: 0 }}>
      <fieldset className="ofc-actions">
        <legend className="sr-only">Devotional</legend>
        {choices.map((choice) => (
          <label key={choice.key} className="ofc-check">
            <input type="radio" name="devotion-source" checked={source === choice.key} onChange={() => setSource(choice.key)} />
            <span className="ofc-words">
              <span className="ofc-name" style={{ fontSize: 15 }}>{choice.name}</span>
              <span className="ofc-hint">{choice.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {source === "link" ? (
        <label className="ofc-lbl">
          Website address
          <input className="ofc-input" value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://" inputMode="url" />
        </label>
      ) : null}
      {source === "own" ? (
        <>
          <label className="ofc-lbl">
            Today's title
            <input className="ofc-input" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Abiding in the Vine" />
          </label>
          <label className="ofc-lbl">
            The devotional
            <textarea className="ofc-input" style={{ minHeight: 160, padding: 12 }} value={text} maxLength={5000} onChange={(event) => setText(event.target.value)} placeholder="Scripture, message and prayer" />
          </label>
        </>
      ) : null}
      {note ? <p className="pb-quiet" role="status" style={{ margin: 0, fontSize: 14 }}>{note}</p> : null}
      <button type="button" className="pb-btn" disabled={busy} onClick={() => void save()}>
        {busy ? "Saving…" : "Save devotional"}
      </button>
    </div>
  );
}
