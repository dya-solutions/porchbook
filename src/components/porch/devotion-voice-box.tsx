import { useEffect, useRef, useState } from "react";
import { fieldClass, quietButtonClass } from "@/components/porch/bits";
import { saveSunbirdKey, sunbirdKeySaved } from "@/lib/porch/devotion-runyankore";
import { chooseBackupVoice, setBackupFirst, chooseVoice, getVoiceSetup, saveBackupKey, remakeVoice, sampleVoice, saveBed, saveSayLike, saveVoiceKey, saveVoiceWords, testSay, type VoiceChoice } from "@/lib/porch/devotion-voice";

/** Studio box (founder only): ElevenLabs key, hear the voices, pick one. */
export function DevotionVoiceBox() {
  const [setup, setSetup] = useState<{ bed: { url: string; level: number } | null; opening: string; closing: string; sayLike: string; hasKey: boolean; provider: string; credits: string; voice: string; voices: VoiceChoice[]; problem: string; today: { status: string; error: string; url: string; by?: string } | null; hasBackup?: boolean; backupFirst?: boolean; backupProvider?: string; backupVoice?: string; backupVoices?: VoiceChoice[]; backupProblem?: string } | null>(null);
  const [backupKey, setBackupKey] = useState("");
  const [backupRegion, setBackupRegion] = useState("");
  const [sunKey, setSunKey] = useState("");
  const [sunSaved, setSunSaved] = useState(false);
  useEffect(() => {
    void sunbirdKeySaved()
      .then((result) => setSunSaved(result.saved))
      .catch(() => undefined);
  }, []);
  async function saveSun() {
    setBusy("sunbird");
    setNote("");
    const result = await saveSunbirdKey({ data: { key: sunKey } }).catch(() => null);
    setBusy("");
    if (!result?.ok) {
      setNote(result?.error ?? "Couldn't save the Sunbird key.");
      return;
    }
    setSunKey("");
    setSunSaved(Boolean(sunKey));
    setNote(sunKey ? "Sunbird key saved: days without Phaneroo's Runyankore will be machine translated." : "Sunbird key removed.");
  }
  const [hidden, setHidden] = useState(false);
  const [key, setKey] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [rules, setRules] = useState<string | null>(null);
  const [bedLevel, setBedLevel] = useState<number | null>(null);
  const [bedFile, setBedFile] = useState<File | null>(null);
  const [bedProgress, setBedProgress] = useState(0);
  const [trial, setTrial] = useState("Today's devotional by Apostle Grace Lubega.");
  const player = useRef<HTMLAudioElement | null>(null);

  async function load() {
    const result = await getVoiceSetup().catch(() => null);
    if (!result || !result.ok) {
      setHidden(true);
      return;
    }
    setSetup(result);
  }
  useEffect(() => {
    void load();
    return () => player.current?.pause();
  }, []);
  if (hidden || !setup) return null;

  async function saveKey() {
    setBusy("key");
    setNote("");
    const result = await saveVoiceKey({ data: { key } }).catch(() => null);
    setBusy("");
    if (!result?.ok) {
      setNote(result?.error ?? "Couldn't save the key.");
      return;
    }
    setKey("");
    setNote("Key saved.");
    await load();
  }

  async function saveBackup() {
    setBusy("backup");
    setNote("");
    const result = await saveBackupKey({ data: { key: backupKey, region: backupRegion } }).catch(() => null);
    setBusy("");
    if (!result?.ok) {
      setNote(result?.error ?? "Couldn't save the key.");
      return;
    }
    setBackupKey("");
    setNote(`${backupRegion ? "Azure" : "Google"} key saved. Now choose the backup voice.`);
    setBackupRegion("");
    await load();
  }

  async function pickBackup(voice: string) {
    setBusy("backup-voice");
    const result = await chooseBackupVoice({ data: { voice } }).catch(() => null);
    setBusy("");
    setNote(result?.ok ? "Backup voice chosen. It reads whenever ElevenLabs can't." : (result?.error ?? "Couldn't choose that voice."));
    await load();
  }

  async function hear(voice: string, preview?: string) {
    player.current?.pause();
    if (preview) {
      // ElevenLabs' own sample: free, no credits used.
      const audio = new Audio(preview);
      player.current = audio;
      void audio.play().catch(() => setNote("Couldn't play the sample."));
      return;
    }
    setBusy(voice);
    setNote("");
    const result = await sampleVoice({ data: { voice } }).catch(() => null);
    setBusy("");
    if (!result?.ok) {
      setNote(result?.error ?? "Couldn't make the sample.");
      return;
    }
    const audio = new Audio(result.audio);
    player.current = audio;
    void audio.play();
  }

  async function pick(voice: string) {
    setBusy(`pick:${voice}`);
    const result = await chooseVoice({ data: { voice } }).catch(() => null);
    if (!result?.ok) {
      setBusy("");
      setNote(result?.error ?? "Couldn't choose that voice.");
      return;
    }
    setNote("Voice chosen. Making today's reading…");
    await load();
    const made = await remakeVoice().catch(() => null);
    setBusy("");
    setNote(made?.state === "ready" ? "Today's reading is ready in the Devotional." : made?.state === "failed" ? `It didn't work: ${made.error}` : "Today's reading is being made.");
    await load();
  }

  const openNow = opening ?? setup.opening;
  const closeNow = closing ?? setup.closing;
  const wordsChanged = openNow.trim() !== setup.opening || closeNow.trim() !== setup.closing;
  async function saveWords() {
    setBusy("words");
    setNote("");
    const saved = await saveVoiceWords({ data: { opening: openNow, closing: closeNow } }).catch(() => null);
    if (!saved?.ok) {
      setBusy("");
      setNote(saved?.error ?? "Couldn't save.");
      return;
    }
    setOpening(null);
    setClosing(null);
    setNote("Saved. Making today's reading again…");
    const made = await remakeVoice().catch(() => null);
    setBusy("");
    setNote(made?.state === "ready" ? "Today's reading is ready with your words." : made?.state === "failed" ? `It didn't work: ${made.error}` : "Today's reading is being made.");
    await load();
  }

  const rulesNow = rules ?? setup.sayLike;
  async function tryIt() {
    player.current?.pause();
    setBusy("test");
    setNote("");
    const result = await testSay({ data: { text: trial, sayLike: rulesNow } }).catch(() => null);
    setBusy("");
    if (!result?.ok) {
      setNote(result?.error ?? "Couldn't make the test.");
      return;
    }
    const audio = new Audio(result.audio);
    player.current = audio;
    void audio.play();
  }
  async function keepRules(remake: boolean) {
    setBusy("rules");
    setNote("");
    const saved = await saveSayLike({ data: { sayLike: rulesNow } }).catch(() => null);
    if (!saved?.ok) {
      setBusy("");
      setNote(saved?.error ?? "Couldn't save.");
      return;
    }
    setRules(null);
    if (!remake) {
      setBusy("");
      setNote("Saved. It's used from the next reading.");
      await load();
      return;
    }
    setNote("Saved. Making today's reading again…");
    const made = await remakeVoice().catch(() => null);
    setBusy("");
    setNote(made?.state === "ready" ? "Today's reading is ready." : made?.state === "failed" ? `It didn't work: ${made.error}` : "Today's reading is being made.");
    await load();
  }

  const levelNow = bedLevel ?? setup.bed?.level ?? 0.18;
  async function uploadBed() {
    if (!bedFile) return;
    setBusy("bed");
    setNote("Uploading the strings…");
    try {
      let url = "";
      const mode = (await fetch("/api/fm-upload").then((r) => r.json()).catch(() => ({ blob: false }))) as { blob: boolean };
      if (mode.blob) {
        const { uploadFile } = await import("@/lib/porch/upload-file");
        const safe = bedFile.name.replace(/[^a-z0-9._-]+/gi, "-").slice(-80) || "strings.mp3";
        url = await uploadFile(`devotion/strings-${safe}`, bedFile, { handleUploadUrl: "/api/fm-upload", contentType: bedFile.type || "audio/mpeg", onProgress: setBedProgress });
      } else {
        const response = await fetch("/api/fm-upload", { method: "POST", headers: { "content-type": bedFile.type || "audio/mpeg" }, body: bedFile });
        const body = (await response.json()) as { url?: string; error?: string };
        if (!body.url) throw new Error(body.error ?? "Upload failed.");
        url = body.url;
      }
      const saved = await saveBed({ data: { url, level: levelNow } });
      setNote(saved.ok ? "Strings added. They play softly under the reading." : saved.error);
      setBedFile(null);
      await load();
    } catch (caught) {
      setNote(caught instanceof Error ? caught.message : "Upload failed.");
    }
    setBusy("");
    setBedProgress(0);
  }
  async function keepLevel(level: number) {
    setBedLevel(level);
    if (!setup?.bed) return;
    await saveBed({ data: { url: setup.bed.url, level } }).catch(() => null);
  }
  function hearBed() {
    player.current?.pause();
    if (!setup?.bed) return;
    const audio = new Audio(setup.bed.url);
    audio.volume = Math.min(1, levelNow * 2);
    player.current = audio;
    void audio.play();
    window.setTimeout(() => audio.pause(), 12000);
  }

  const groups = new Map<string, VoiceChoice[]>();
  for (const voice of setup.voices) {
    const group = `${voice.accent} · ${voice.gender}`;
    groups.set(group, [...(groups.get(group) ?? []), voice]);
  }

  return (
    <div className="rounded-2xl border border-white/10 p-3">
      <h3 className="text-sm font-bold text-ink">Devotional voice</h3>
      <p className="text-xs text-muted">The devotional is read aloud each morning in a natural voice with a little room reverb.</p>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void saveKey();
        }}
      >
        <input
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder={setup.hasKey ? `${setup.provider} key saved · paste a new one to change it` : "ElevenLabs API key (sk_…)"}
          type="password"
          className={fieldClass}
          autoComplete="off"
        />
        <button type="submit" className="min-h-11 rounded-full bg-[#f8a018] px-4 font-bold text-black disabled:opacity-50" disabled={!key || busy === "key"}>
          {busy === "key" ? "Saving…" : "Save"}
        </button>
      </form>
      {setup.problem ? <p className="mt-1 text-sm text-[#f0a0a0]">{setup.provider}: {setup.problem}</p> : null}
      {setup.credits ? <p className="mt-1 text-xs text-muted">{setup.credits}</p> : null}
      <div className="mt-3 rounded-xl border border-white/10 p-2">
        <p className="text-xs font-bold tracking-wide text-ink">Runyankore translation (Sunbird AI)</p>
        <p className="text-xs text-muted">When Phaneroo hasn't published the day in Runyankore, the devotional is machine translated (labelled so).</p>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveSun();
          }}
        >
          <input
            value={sunKey}
            onChange={(event) => setSunKey(event.target.value)}
            placeholder={sunSaved ? "Sunbird key saved · paste a new one to change it" : "Sunbird AI access token"}
            type="password"
            className={fieldClass}
            autoComplete="off"
          />
          <button type="submit" className="min-h-11 rounded-full bg-[#f8a018] px-4 font-bold text-black disabled:opacity-50" disabled={!sunKey || busy === "sunbird"}>
            {busy === "sunbird" ? "Saving…" : "Save"}
          </button>
        </form>
      </div>
      <div className="mt-3 rounded-xl border border-white/10 p-2">
        <p className="text-xs font-bold tracking-wide text-ink">Backup voice ({setup.backupProvider || "Azure or Google"})</p>
        <p className="text-xs text-muted">Reads the devotional automatically when ElevenLabs runs out of credits or fails, so it never goes silent.</p>
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveBackup();
          }}
        >
          <input
            value={backupKey}
            onChange={(event) => setBackupKey(event.target.value)}
            placeholder={setup.hasBackup ? `${setup.backupProvider} key saved · paste a new one to change it` : "Azure KEY 1 (or a Google AIza… key)"}
            type="password"
            className={`${fieldClass} min-w-0 flex-1 basis-full`}
            autoComplete="off"
          />
          <input
            value={backupRegion}
            onChange={(event) => setBackupRegion(event.target.value)}
            placeholder="Azure region, e.g. westeurope"
            className={`${fieldClass} min-w-0 flex-1`}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="min-h-11 rounded-full bg-[#f8a018] px-4 font-bold text-black disabled:opacity-50" disabled={!backupKey || busy === "backup"}>
            {busy === "backup" ? "Saving…" : "Save"}
          </button>
        </form>
        {setup.backupProblem ? <p className="mt-1 text-sm text-[#f0a0a0]">{setup.backupProvider}: {setup.backupProblem}</p> : null}
        {setup.hasBackup && setup.backupVoices?.length ? (
          <div className="mt-2 flex gap-2">
            <select value={setup.backupVoice ?? ""} onChange={(event) => void pickBackup(event.target.value)} className={fieldClass} disabled={busy === "backup-voice"}>
              <option value="">Choose the backup voice…</option>
              {setup.backupVoices.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.label} · {item.gender} · {item.accent}
                </option>
              ))}
            </select>
            <button type="button" className={quietButtonClass} disabled={!setup.backupVoice || busy === setup.backupVoice} onClick={() => setup.backupVoice && void hear(setup.backupVoice)}>
              {busy === setup.backupVoice ? "…" : "▶ Hear"}
            </button>
          </div>
        ) : null}
        {setup.hasBackup && setup.backupVoice ? (
          <label className="mt-2 flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-5 w-5 accent-[#7dff2a]"
              checked={Boolean(setup.backupFirst)}
              disabled={busy === "backup-first"}
              onChange={async (event) => {
                setBusy("backup-first");
                const on = event.target.checked;
                const result = await setBackupFirst({ data: { on } }).catch(() => null);
                setBusy("");
                setNote(result?.ok ? (on ? `${setup.backupProvider} now reads every day. ElevenLabs only steps in if it fails.` : "ElevenLabs reads first again.") : (result?.error ?? "Couldn't change that."));
                await load();
              }}
            />
            Main voice: read with this every day
          </label>
        ) : null}
      </div>
      {setup.hasKey ? (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-bold tracking-wide text-muted">
            Opening (read first, every day)
            <textarea value={openNow} onChange={(event) => setOpening(event.target.value)} rows={3} className={`${fieldClass} mt-1 font-normal`} placeholder="Praise our Lord Jesus Christ…" />
          </label>
          <label className="block text-xs font-bold tracking-wide text-muted">
            Closing (read last, every day)
            <textarea value={closeNow} onChange={(event) => setClosing(event.target.value)} rows={3} className={`${fieldClass} mt-1 font-normal`} placeholder="Thank you for listening…" />
          </label>
          <button type="button" className="min-h-11 rounded-full bg-[#f8a018] px-4 font-bold text-black disabled:opacity-50" disabled={!wordsChanged || Boolean(busy)} onClick={() => void saveWords()}>
            {busy === "words" ? "Saving…" : "Save & remake today's reading"}
          </button>
          <p className="text-xs text-muted">Remaking uses credits for one reading.</p>
        </div>
      ) : null}
      {setup.hasKey ? (
        <div className="mt-4 space-y-2 rounded-xl border border-white/10 p-2">
          <p className="text-xs font-bold tracking-wide text-muted">Strings under the reading</p>
          <p className="text-xs text-muted">{setup.bed ? "A strings track is playing under the reading." : "Upload a soft strings track (MP3, no drums or singing). It plays quietly under the voice."}</p>
          <input
            type="file"
            accept="audio/*"
            className="text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-[#f8a018] file:px-3 file:py-1.5 file:font-bold file:!text-black"
            onChange={(event) => setBedFile(event.target.files?.[0] ?? null)}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={quietButtonClass} disabled={!bedFile || Boolean(busy)} onClick={() => void uploadBed()}>
              {busy === "bed" ? (bedProgress ? `Uploading ${bedProgress}%` : "Uploading…") : setup.bed ? "Replace strings" : "Upload strings"}
            </button>
            {setup.bed ? (
              <>
                <button type="button" className={quietButtonClass} disabled={Boolean(busy)} onClick={hearBed}>
                  ▶ Hear strings
                </button>
                <button
                  type="button"
                  className={quietButtonClass}
                  disabled={Boolean(busy)}
                  onClick={() => void saveBed({ data: { url: "", level: levelNow } }).then(() => load())}
                >
                  Remove
                </button>
              </>
            ) : null}
          </div>
          {setup.bed ? (
            <label className="block text-xs text-muted">
              Strings volume: {Math.round(levelNow * 100)}%
              <input type="range" min={2} max={60} value={Math.round(levelNow * 100)} onChange={(event) => setBedLevel(Number(event.target.value) / 100)} onPointerUp={(event) => void keepLevel(Number((event.target as HTMLInputElement).value) / 100)} onKeyUp={(event) => void keepLevel(Number((event.target as HTMLInputElement).value) / 100)} className="mt-1 block w-full accent-[#f8a018]" />
            </label>
          ) : null}
        </div>
      ) : null}
      {setup.hasKey && setup.voice ? (
        <div className="mt-4 space-y-2 rounded-xl border border-white/10 p-2">
          <p className="text-xs font-bold tracking-wide text-muted">Say it like this</p>
          <p className="text-xs text-muted">One per line: the word as written = how he should say it. Only the voice hears this.</p>
          <textarea value={rulesNow} onChange={(event) => setRules(event.target.value)} rows={3} className={`${fieldClass} font-normal`} placeholder="Lubega = Lhubhega" />
          <input value={trial} onChange={(event) => setTrial(event.target.value)} className={fieldClass} placeholder="A short sentence to test" />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={quietButtonClass} disabled={Boolean(busy)} onClick={() => void tryIt()}>
              {busy === "test" ? "Making…" : "▶ Test"}
            </button>
            <button type="button" className={quietButtonClass} disabled={Boolean(busy) || rulesNow === setup.sayLike} onClick={() => void keepRules(false)}>
              Save
            </button>
            <button type="button" className={quietButtonClass} disabled={Boolean(busy)} onClick={() => void keepRules(true)}>
              Save & remake today
            </button>
          </div>
          <p className="text-xs text-muted">▶ Test uses a few credits. Save & remake uses one full reading.</p>
        </div>
      ) : null}
      {setup.hasKey && setup.voices.length ? (
        <div className="mt-3 space-y-3">
          {[...groups.entries()].map(([group, voices]) => (
            <div key={group}>
              <p className="text-xs font-bold tracking-wide text-muted">{group}</p>
              <ul className="mt-1 space-y-1">
                {voices.map((voice) => (
                  <li key={voice.name} className="flex items-center gap-2 text-sm">
                    <span className={`min-w-0 flex-1 truncate ${voice.name === setup.voice ? "font-bold text-[#f8a018]" : "text-ink"}`}>
                      {voice.label}
                      {voice.name === setup.voice ? " · chosen" : ""}
                    </span>
                    <button type="button" className={quietButtonClass} disabled={Boolean(busy)} onClick={() => void hear(voice.name, voice.preview)}>
                      {busy === voice.name ? "…" : "▶ Hear"}
                    </button>
                    {voice.name !== setup.voice ? (
                      <button type="button" className={quietButtonClass} disabled={Boolean(busy)} onClick={() => void pick(voice.name)}>
                        {busy === `pick:${voice.name}` ? "Choosing…" : "Choose"}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
      {setup.today ? (
        <p className="mt-2 text-xs text-muted">
          Today's reading: {setup.today.status === "ready" ? `ready${setup.today.by ? ` · read by ${setup.today.by}` : ""}` : setup.today.status === "making" ? "being made" : `failed (${setup.today.error})`}
        </p>
      ) : null}
      {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
    </div>
  );
}
