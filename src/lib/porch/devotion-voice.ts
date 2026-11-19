import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Timing } from "@/lib/porch/devotion-voice.server";

/** Server side of the devotional read aloud. */

function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}
function rec(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}
async function isFounder(sql: Sql, userId: string) {
  const me = await sql.query<{ is_founder: boolean }>("select is_porch_admin($1) as is_founder", [userId]);
  return boolish(me[0]?.is_founder);
}
async function settings(sql: Sql) {
  const rows = await sql.query<{ api_key: string; voice: string; opening: string; closing: string; say_like: string; backup_key: string; backup_voice: string; backup_first: unknown }>(
    "select api_key, voice, opening, closing, say_like, backup_key, backup_voice, backup_first from devotion_voice_settings where id = 1",
  );
  const sayLike = rows[0]?.say_like ?? "";
  const key = rows[0]?.api_key ?? "";
  const opening = rows[0]?.opening ?? "";
  const closing = rows[0]?.closing ?? "";
  const voice = rows[0]?.voice ?? "";
  // The backup (Google): used when ElevenLabs runs out of credits or fails.
  const backupKey = rows[0]?.backup_key ?? "";
  const backupVoice = rows[0]?.backup_voice ?? "";
  const backupOk = (/^AIza/.test(backupKey) && GOOGLE_VOICE.test(backupVoice)) || (isAzureKey(backupKey) && AZURE_VOICE.test(backupVoice));
  // A voice only counts with a key from the same provider.
  return {
    key,
    opening,
    closing,
    sayLike,
    voice: isElevenKey(key) === voice.startsWith("el:") ? voice : "",
    backupKey: backupOk ? backupKey : "",
    backupVoice: backupOk ? backupVoice : "",
    backupSavedKey: backupKey,
    backupFirst: backupOk && boolish(rows[0]?.backup_first),
    backupSavedVoice: backupVoice,
  };
}
/** "Lubega = Lhubhega" lines: the word as written, and how the voice should say it. */
function sayAs(text: string, rules: string) {
  let out = text;
  for (const line of rules.split("\n")) {
    const [word, said] = line.split("=").map((part) => part?.trim() ?? "");
    if (!word || !said) continue;
    const safe = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\p{L}])${safe}(?![\\p{L}])`, "giu"), said);
  }
  return out;
}
const isElevenKey = (key: string) => key.startsWith("sk_");
const GOOGLE_VOICE = /^[a-z]{2}-[A-Z]{2}-Chirp3-HD-[A-Za-z]+$/;
const ELEVEN_VOICE = /^el:[A-Za-z0-9]{10,40}$/;
const AZURE_VOICE = /^az:[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural$/;
const isAzureKey = (key: string) => key.startsWith("az|");

/** Microsoft Azure's natural voices for a key ("az|region|key"), English accents incl. African ones. */
async function azureVoices(key: string): Promise<{ voices: VoiceChoice[]; problem: string }> {
  const [, region, secret] = key.split("|");
  try {
    const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, { headers: { "Ocp-Apim-Subscription-Key": secret ?? "" } });
    if (!response.ok) return { voices: [], problem: response.status === 401 ? "the key or region isn't right" : `Azure said ${response.status}` };
    const list = (await response.json()) as { ShortName: string; DisplayName?: string; Gender?: string; Locale: string }[];
    const accents: Record<string, string> = {
      "en-GB": "British",
      "en-US": "American",
      "en-AU": "Australian",
      "en-KE": "Kenyan",
      "en-NG": "Nigerian",
      "en-TZ": "Tanzanian",
      "en-ZA": "South African",
      "en-IN": "Indian",
    };
    const voices = list
      .filter((v) => accents[v.Locale] && AZURE_VOICE.test(`az:${v.ShortName}`))
      .map((v) => ({
        name: `az:${v.ShortName}`,
        label: v.DisplayName ?? v.ShortName,
        gender: v.Gender === "Female" ? "Female" : "Male",
        accent: accents[v.Locale],
      }))
      .sort((a, b) => a.accent.localeCompare(b.accent) || a.gender.localeCompare(b.gender) || a.label.localeCompare(b.label));
    return { voices, problem: "" };
  } catch {
    return { voices: [], problem: "Couldn't reach Azure." };
  }
}
const backupVoicesFor = (key: string) => (isAzureKey(key) ? azureVoices(key) : googleVoices(key));

export type VoiceChoice = { name: string; label: string; gender: string; accent: string; preview?: string };

const SAMPLE =
  "Good morning, and welcome to today's devotional on Porchbook. Take a quiet moment with me. For we are His workmanship, created in Christ Jesus unto good works.";

/** Make (once) the reading for today's devotional; everyone shares the one file. */
type Made = { state: "off" | "making" | "ready" | "failed"; url?: string; seconds?: number; error?: string; timing?: Timing | null };

/** The devotional's lines as written (opening, the page, closing), the same lines that are read aloud. */
async function writtenOf(link: string, opening: string, closing: string) {
  const [{ devotionSheet }, { englishOf, speechLinesOf }] = await Promise.all([import("@/lib/porch/devotion-page.server"), import("@/lib/porch/devotion-text")]);
  const body = speechLinesOf(englishOf(await devotionSheet(link))).slice(0, 40_000);
  return { body, written: [opening.trim(), body, closing.trim()].filter(Boolean).join("\n") };
}
const parseTiming = (raw: string): Timing | null => {
  try {
    return raw ? (JSON.parse(raw) as Timing) : null;
  } catch {
    return null;
  }
};

/** ElevenLabs without enough credits for this reading: why (empty when there are enough). Asking costs nothing. */
async function elevenShort(key: string, needed: number): Promise<string> {
  try {
    const plan = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": key } });
    if (!plan.ok) return "";
    const info = (await plan.json()) as { character_count?: number; character_limit?: number };
    if (!info.character_limit) return "";
    const left = info.character_limit - (info.character_count ?? 0);
    return left < needed + 200 ? `ElevenLabs has ${Math.max(0, left).toLocaleString()} credits left; this reading needs about ${needed.toLocaleString()}.` : "";
  } catch {
    return "";
  }
}

/** Google's natural voices for a key (for the backup voice list). */
async function googleVoices(key: string): Promise<{ voices: VoiceChoice[]; problem: string }> {
  try {
    const response = await fetch(`https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(key)}`);
    const body = (await response.json()) as { voices?: { name: string; ssmlGender?: string }[]; error?: { message?: string } };
    const accents: Record<string, string> = { "en-GB": "British", "en-US": "American", "en-AU": "Australian", "en-IN": "Indian" };
    const voices = (body.voices ?? [])
      .filter((item) => /Chirp3-HD/.test(item.name) && accents[item.name.slice(0, 5)])
      .map((item) => ({
        name: item.name,
        label: item.name.split("-").pop() ?? item.name,
        gender: (item.ssmlGender ?? "").toLowerCase() === "female" ? "Female" : "Male",
        accent: accents[item.name.slice(0, 5)],
      }))
      .sort((a, b) => a.accent.localeCompare(b.accent) || a.gender.localeCompare(b.gender) || a.label.localeCompare(b.label));
    return { voices, problem: response.ok ? "" : (body.error?.message ?? `Google said ${response.status}`) };
  } catch {
    return { voices: [], problem: "Couldn't reach Google." };
  }
}

async function makeToday(sql: Sql): Promise<Made> {
  const { key, voice, opening, closing, sayLike, backupKey, backupVoice, backupFirst } = await settings(sql);
  if ((!key || !voice) && !backupVoice) return { state: "off" };
  const docs = await sql.query<{ link: string }>("select link from read_docs where key = 'devotion'");
  const link = docs[0]?.link ?? "";
  if (!link) return { state: "off" };
  const rows = await sql.query<{ voice: string; url: string; seconds: number; status: string; error: string; age: number; timing: string }>(
    "select voice, url, seconds, status, error, extract(epoch from now() - started_at) as age, timing from devotion_voices where link = $1",
    [link],
  );
  const row = rows[0];
  if (row && (row.voice === voice || (backupVoice && row.voice === backupVoice))) {
    // (A "reading" only seconds long came back empty: it is made again below.)
    if (row.status === "ready" && row.url && Number(row.seconds) >= 5) {
      let timing = parseTiming(row.timing);
      // A reading made before timing: spread its lines over it once, and keep that.
      if (!timing) {
        try {
          const { estimateTiming } = await import("@/lib/porch/devotion-voice.server");
          timing = estimateTiming((await writtenOf(link, opening, closing)).written, Number(row.seconds));
          await sql.query("update devotion_voices set timing = $2 where link = $1", [link, JSON.stringify(timing)]);
        } catch {
          timing = null;
        }
      }
      return { state: "ready", url: row.url, seconds: Number(row.seconds), timing };
    }
    if (row.status === "making" && Number(row.age) < 420) return { state: "making" };
    if (row.status === "failed" && Number(row.age) < 600) return { state: "failed", error: row.error };
  }
  // Claim the job so only one request makes it.
  const claimed = await sql.query<{ link: string }>(
    `insert into devotion_voices (link, voice, status, started_at) values ($1, $2, 'making', now())
     on conflict (link) do update set voice = excluded.voice, status = 'making', error = '', started_at = now()
       where devotion_voices.voice <> excluded.voice or devotion_voices.status <> 'making' or devotion_voices.started_at < now() - interval '7 minutes'
           or (devotion_voices.status = 'failed')
     returning link`,
    [link, (backupFirst ? backupVoice : voice) || backupVoice],
  );
  if (!claimed.length) return { state: "making" };
  try {
    const { readAloud, timingOf } = await import("@/lib/porch/devotion-voice.server");
    const { body, written } = await writtenOf(link, opening, closing);
    if (body.length < 40) throw new Error("The devotional page couldn't be read.");
    // Words in capitals are said as words ("DIVINE" → "Divine"), not spelled out.
    const said = (words: string) => words.trim().replace(/\b[A-Z]{4,}\b/g, (w) => w[0] + w.slice(1).toLowerCase());
    const text = sayAs([said(opening), body, said(closing)].filter(Boolean).join("\n"), sayLike);
    // ElevenLabs first, while it has credits for the whole reading; otherwise (or if it fails) the Google backup.
    let usedVoice = voice;
    let made: Awaited<ReturnType<typeof readAloud>> | null = null;
    let firstProblem = "";
    // The backup voice set to read every day: it goes first; ElevenLabs only if it fails.
    if (backupFirst) {
      try {
        made = await readAloud(backupKey, backupVoice, text);
        usedVoice = backupVoice;
      } catch (error) {
        firstProblem = error instanceof Error ? error.message : "The voice couldn't read it.";
      }
    }
    if (!made && key && voice) {
      const short = isElevenKey(key) ? await elevenShort(key, text.length) : "";
      if (short) firstProblem = short;
      else
        try {
          made = await readAloud(key, voice, text);
        } catch (error) {
          firstProblem = error instanceof Error ? error.message : "ElevenLabs couldn't read it.";
        }
    }
    if (!made) {
      if (!backupKey || !backupVoice || backupFirst) throw new Error(firstProblem || "No voice is set up.");
      usedVoice = backupVoice;
      made = await readAloud(backupKey, backupVoice, text);
    }
    const { mp3, seconds, heard } = made;
    const timing = timingOf(written, heard);
    const store = await import("@/lib/porch/audio-store.server");
    if (!process.env.BLOB_READ_WRITE_TOKEN && !(await store.getR2(sql))) throw new Error("Audio storage isn't connected.");
    const saved = { url: await store.storePut(sql, `devotion/voice-${Date.now()}.mp3`, Buffer.from(mp3), "audio/mpeg") };
    const del = (u: string) => store.storeDelete(sql, [u]);
    const old = await sql.query<{ url: string }>("select url from devotion_voices where link = $1", [link]);
    await sql.query("update devotion_voices set url = $2, seconds = $3, status = 'ready', made_at = now(), timing = $4, voice = $5 where link = $1", [
      link,
      saved.url,
      seconds,
      JSON.stringify(timing),
      usedVoice,
    ]);
    if (old[0]?.url && old[0].url !== saved.url) await del(old[0].url).catch(() => undefined);
    // Keep only the last two weeks of readings.
    const stale = await sql.query<{ link: string; url: string }>("delete from devotion_voices where started_at < now() - interval '14 days' returning link, url");
    for (const item of stale) if (item.url) await del(item.url).catch(() => undefined);
    return { state: "ready", url: saved.url, seconds, timing };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "It couldn't be read aloud.";
    await sql.query("update devotion_voices set status = 'failed', error = $2 where link = $1", [link, message]);
    return { state: "failed", error: message };
  }
}

/** Anyone signed in: today's reading (made on first ask). */
export const devotionVoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    const made = await makeToday(sql);
    return { ...made, bed: await bedOf(sql) };
  });

async function bedOf(sql: Sql) {
  const rows = await sql.query<{ bed_url: string; bed_level: number }>("select bed_url, bed_level from devotion_voice_settings where id = 1");
  return rows[0]?.bed_url ? { url: rows[0].bed_url, level: Number(rows[0].bed_level) || 0.18 } : null;
}

/** Founder: the strings track under the reading (url from the radio upload) and its loudness. */
export const saveBed = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const url = String(rec(input).url ?? "").trim().slice(0, 600);
    const level = Math.max(0.02, Math.min(0.6, Number(rec(input).level ?? 0.18) || 0.18));
    return { url, level };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { ok: false as const, error: "Only the founder can do that." };
    if (data.url && !/^\/api\/fm-file\?id=\d+$/.test(data.url) && !(await (await import("@/lib/porch/audio-store.server")).isStoreUrl(sql, data.url)))
      return { ok: false as const, error: "That file isn't from Porchbook's upload." };
    await sql.query(
      `insert into devotion_voice_settings (id, bed_url, bed_level, updated_at) values (1, $1, $2, now())
       on conflict (id) do update set bed_url = excluded.bed_url, bed_level = excluded.bed_level, updated_at = now()`,
      [data.url, data.level],
    );
    return { ok: true as const };
  });

/** Founder: the voice settings for the Studio box. */
export const getVoiceSetup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { ok: false as const, error: "Only the founder can set the devotional voice." };
    const { key, voice } = await settings(sql);
    let voices: VoiceChoice[] = [];
    let problem = "";
    let credits = "";
    const provider = !key ? "" : isElevenKey(key) ? "ElevenLabs" : "Google";
    if (key && provider === "ElevenLabs") {
      try {
        const response = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key } });
        const body = (await response.json().catch(() => ({}))) as {
          voices?: { voice_id: string; name: string; preview_url?: string; labels?: Record<string, string> }[];
          detail?: { message?: string } | string;
        };
        if (!response.ok) problem = (typeof body.detail === "string" ? body.detail : body.detail?.message) ?? `ElevenLabs said ${response.status}`;
        const title = (value = "") => value.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        voices = (body.voices ?? [])
          .map((item) => ({
            name: `el:${item.voice_id}`,
            label: item.name.split(" - ")[0],
            gender: title(item.labels?.gender) || "Voice",
            accent: title(item.labels?.accent) || "Other",
            preview: item.preview_url ?? "",
          }))
          .sort((a, b) => a.accent.localeCompare(b.accent) || a.gender.localeCompare(b.gender) || a.label.localeCompare(b.label));
        const plan = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": key } }).catch(() => null);
        if (plan?.ok) {
          const info = (await plan.json()) as { character_count?: number; character_limit?: number };
          if (info.character_limit) credits = `${Math.max(0, info.character_limit - (info.character_count ?? 0)).toLocaleString()} of ${info.character_limit.toLocaleString()} credits left this month`;
        }
      } catch {
        problem = "Couldn't reach ElevenLabs.";
      }
    } else if (key) {
      try {
        const response = await fetch(`https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(key)}`);
        const body = (await response.json()) as { voices?: { name: string; ssmlGender?: string; languageCodes?: string[] }[]; error?: { message?: string } };
        if (!response.ok) problem = body.error?.message ?? `Google said ${response.status}`;
        const accents: Record<string, string> = { "en-GB": "British", "en-US": "American", "en-AU": "Australian", "en-IN": "Indian" };
        voices = (body.voices ?? [])
          .filter((item) => /Chirp3-HD/.test(item.name) && accents[item.name.slice(0, 5)])
          .map((item) => ({
            name: item.name,
            label: item.name.split("-").pop() ?? item.name,
            gender: (item.ssmlGender ?? "").toLowerCase() === "female" ? "Female" : "Male",
            accent: accents[item.name.slice(0, 5)],
          }))
          .sort((a, b) => a.accent.localeCompare(b.accent) || a.gender.localeCompare(b.gender) || a.label.localeCompare(b.label));
      } catch {
        problem = "Couldn't reach Google.";
      }
    }
    const today = await makeTodayState(sql);
    const words = await settings(sql);
    const backup = words.backupSavedKey ? await backupVoicesFor(words.backupSavedKey) : { voices: [] as VoiceChoice[], problem: "" };
    return {
      ok: true as const,
      bed: await bedOf(sql),
      opening: words.opening,
      closing: words.closing,
      sayLike: words.sayLike,
      hasKey: Boolean(key),
      provider,
      credits,
      voice,
      voices,
      problem,
      today,
      hasBackup: Boolean(words.backupSavedKey),
      backupFirst: words.backupFirst,
      backupProvider: isAzureKey(words.backupSavedKey) ? "Azure" : words.backupSavedKey ? "Google" : "",
      backupVoice: words.backupSavedVoice,
      backupVoices: backup.voices,
      backupProblem: backup.problem,
    };
  });

async function makeTodayState(sql: Sql) {
  const docs = await sql.query<{ link: string }>("select link from read_docs where key = 'devotion'");
  const rows = await sql.query<{ status: string; error: string; url: string; voice: string }>("select status, error, url, voice from devotion_voices where link = $1", [docs[0]?.link ?? ""]);
  return rows[0] ? { status: rows[0].status, error: rows[0].error, url: rows[0].url, by: rows[0].voice.startsWith("el:") ? "ElevenLabs" : rows[0].voice.startsWith("az:") ? "Azure" : rows[0].voice ? "Google" : "" } : null;
}

export const saveVoiceKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ key: String(rec(input).key ?? "").trim().slice(0, 200) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { ok: false as const, error: "Only the founder can set the devotional voice." };
    if (data.key && !/^AIza[0-9A-Za-z_-]{20,}$/.test(data.key) && !/^sk_[0-9A-Za-z]{20,}$/.test(data.key))
      return { ok: false as const, error: "That doesn't look like an ElevenLabs key (it starts with sk_)." };
    if (isElevenKey(data.key)) {
      const check = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": data.key } }).catch(() => null);
      if (!check) return { ok: false as const, error: "Couldn't reach ElevenLabs. Try again." };
      if (check.status === 401) return { ok: false as const, error: "ElevenLabs didn't accept that key. Copy it again." };
    }
    await sql.query(
      `insert into devotion_voice_settings (id, api_key, updated_at) values (1, $1, now())
       on conflict (id) do update set api_key = excluded.api_key, updated_at = now()`,
      [data.key],
    );
    return { ok: true as const };
  });

export const chooseVoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ voice: String(rec(input).voice ?? "").slice(0, 80) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { ok: false as const, error: "Only the founder can set the devotional voice." };
    if (data.voice && !GOOGLE_VOICE.test(data.voice) && !ELEVEN_VOICE.test(data.voice)) return { ok: false as const, error: "Unknown voice." };
    await sql.query(
      `insert into devotion_voice_settings (id, voice, updated_at) values (1, $1, now())
       on conflict (id) do update set voice = excluded.voice, updated_at = now()`,
      [data.voice],
    );
    return { ok: true as const };
  });

/** Founder: the backup voice's key: Google (AIza…), or Azure (a key plus its region). Empty clears it. */
export const saveBackupKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({
    key: String(rec(input).key ?? "").trim().slice(0, 200),
    region: String(rec(input).region ?? "").trim().toLowerCase().replace(/\s+/g, "").slice(0, 40),
  }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { ok: false as const, error: "Only the founder can set the devotional voice." };
    if (data.key && data.region) {
      if (!/^[a-z0-9]{3,30}$/.test(data.region)) return { ok: false as const, error: "The region should look like westeurope." };
      if (!/^[A-Za-z0-9]{32,100}$/.test(data.key)) return { ok: false as const, error: "That doesn't look like an Azure key. Copy KEY 1 again." };
      data.key = `az|${data.region}|${data.key}`;
    } else if (data.key && !/^AIza[0-9A-Za-z_-]{20,}$/.test(data.key))
      return { ok: false as const, error: "For Azure, fill in the region too. (A Google key starts with AIza.)" };
    if (data.key) {
      const check = await backupVoicesFor(data.key);
      if (check.problem) return { ok: false as const, error: `${isAzureKey(data.key) ? "Azure" : "Google"}: ${check.problem}` };
    }
    await sql.query(
      `insert into devotion_voice_settings (id, backup_key, updated_at) values (1, $1, now())
       on conflict (id) do update set backup_key = excluded.backup_key, updated_at = now()`,
      [data.key],
    );
    return { ok: true as const };
  });

/** Founder: the backup voice reads every day (true), or only when ElevenLabs can't (false). */
export const setBackupFirst = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ on: rec(input).on === true }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { ok: false as const, error: "Only the founder can set the devotional voice." };
    await sql.query("update devotion_voice_settings set backup_first = $1, updated_at = now() where id = 1", [data.on]);
    return { ok: true as const };
  });

/** Founder: which Google voice reads when ElevenLabs can't. */
export const chooseBackupVoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ voice: String(rec(input).voice ?? "").slice(0, 80) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { ok: false as const, error: "Only the founder can set the devotional voice." };
    if (data.voice && !GOOGLE_VOICE.test(data.voice) && !AZURE_VOICE.test(data.voice)) return { ok: false as const, error: "Unknown voice." };
    await sql.query(
      `insert into devotion_voice_settings (id, backup_voice, updated_at) values (1, $1, now())
       on conflict (id) do update set backup_voice = excluded.backup_voice, updated_at = now()`,
      [data.voice],
    );
    return { ok: true as const };
  });

/** Founder: a short sample of a voice, with the room on it, to choose by ear. */
export const sampleVoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ voice: String(rec(input).voice ?? "").slice(0, 80) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { ok: false as const, error: "Only the founder can hear samples." };
    const { key: mainKey, backupSavedKey } = await settings(sql);
    // A Google voice is sampled with the backup key when ElevenLabs is the main one.
    const key = AZURE_VOICE.test(data.voice) ? backupSavedKey : GOOGLE_VOICE.test(data.voice) && !(mainKey && !isElevenKey(mainKey)) ? backupSavedKey : mainKey;
    if (!key) return { ok: false as const, error: "Save the key first." };
    if (!(isAzureKey(key) ? AZURE_VOICE : isElevenKey(key) ? ELEVEN_VOICE : GOOGLE_VOICE).test(data.voice)) return { ok: false as const, error: "Unknown voice." };
    try {
      const { readAloud } = await import("@/lib/porch/devotion-voice.server");
      const { mp3 } = await readAloud(key, data.voice, SAMPLE);
      return { ok: true as const, audio: `data:audio/mpeg;base64,${Buffer.from(mp3).toString("base64")}` };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "The sample couldn't be made." };
    }
  });

/** Founder: make today's reading again (after changing the voice, say). */
export const remakeVoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { state: "failed" as const, error: "Only the founder can do that." };
    const docs = await sql.query<{ link: string }>("select link from read_docs where key = 'devotion'");
    await sql.query("update devotion_voices set status = 'failed', started_at = now() - interval '1 hour' where link = $1", [docs[0]?.link ?? ""]);
    return makeToday(sql);
  });

/** Founder: the opening and closing words read every day. */
export const saveVoiceWords = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({
    opening: String(rec(input).opening ?? "").trim().slice(0, 600),
    closing: String(rec(input).closing ?? "").trim().slice(0, 600),
  }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { ok: false as const, error: "Only the founder can do that." };
    await sql.query(
      `insert into devotion_voice_settings (id, opening, closing, updated_at) values (1, $1, $2, now())
       on conflict (id) do update set opening = excluded.opening, closing = excluded.closing, updated_at = now()`,
      [data.opening, data.closing],
    );
    return { ok: true as const };
  });

/** Founder: save the "say it like this" list. */
export const saveSayLike = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ sayLike: String(rec(input).sayLike ?? "").slice(0, 2000) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { ok: false as const, error: "Only the founder can do that." };
    await sql.query(
      `insert into devotion_voice_settings (id, say_like, updated_at) values (1, $1, now())
       on conflict (id) do update set say_like = excluded.say_like, updated_at = now()`,
      [data.sayLike],
    );
    return { ok: true as const };
  });

/** Founder: hear one short sentence in the chosen voice, with the "say it like this" list applied (a few credits). */
export const testSay = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({
    text: String(rec(input).text ?? "").trim().slice(0, 200),
    sayLike: String(rec(input).sayLike ?? "").slice(0, 2000),
  }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await isFounder(sql, context.userId))) return { ok: false as const, error: "Only the founder can do that." };
    const s = await settings(sql);
    const [key, voice] = s.backupFirst ? [s.backupKey, s.backupVoice] : [s.key, s.voice];
    if (!key || !voice) return { ok: false as const, error: "Choose a voice first." };
    if (data.text.length < 2) return { ok: false as const, error: "Type a short sentence to test." };
    try {
      const { readAloud } = await import("@/lib/porch/devotion-voice.server");
      const { mp3 } = await readAloud(key, voice, sayAs(data.text, data.sayLike));
      return { ok: true as const, audio: `data:audio/mpeg;base64,${Buffer.from(mp3).toString("base64")}` };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "The test couldn't be made." };
    }
  });

/** Today's devotional as lines of text (opening, page, closing), for reading with the phone's own voice. */
export const devotionWords = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    const docs = await sql.query<{ link: string }>("select link from read_docs where key = 'devotion'");
    const link = docs[0]?.link ?? "";
    if (!link) return { ok: false as const, lines: [] as string[] };
    try {
      const { opening, closing } = await settings(sql);
      const { written } = await writtenOf(link, opening, closing);
      const lines = written
        .split("\n")
        .map((line) => line.replace(/^§[A-Z] /, "").trim())
        .filter(Boolean);
      return { ok: true as const, lines };
    } catch {
      return { ok: false as const, lines: [] as string[] };
    }
  });
