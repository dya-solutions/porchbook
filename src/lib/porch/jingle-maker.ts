import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

/**
 * Studio → Jingle maker: words read by an Azure voice (cheerful, excited… where the voice can),
 * then mixed over a music bed by the audio server. Saved jingles join the Radio's jingles.
 */
const rec = (input: unknown): Record<string, unknown> => (input && typeof input === "object" ? (input as Record<string, unknown>) : {});
const AZURE_VOICE = /^az:[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural$/;
const siteOrigin = () => (process.env.BETTER_AUTH_URL || "https://porchbook.vercel.app").replace(/\/+$/, "");

export type JingleVoice = { name: string; label: string; gender: string; accent: string; styles: string[] };
export type JingleDraft = { id: number; words: string; status: string; error: string; url: string; durationSec: number };

async function studio(sql: Sql, userId: string) {
  const { canRunStudio } = await import("@/lib/porch/fm");
  return canRunStudio(sql, userId);
}
async function azureKey(sql: Sql) {
  const rows = await sql.query<{ backup_key: string }>("select backup_key from devotion_voice_settings where id = 1").catch(() => []);
  const key = rows[0]?.backup_key ?? "";
  return key.startsWith("az|") ? key : "";
}

const ACCENTS: Record<string, string> = {
  "en-GB": "British",
  "en-US": "American",
  "en-AU": "Australian",
  "en-KE": "Kenyan",
  "en-NG": "Nigerian",
  "en-TZ": "Tanzanian",
  "en-ZA": "South African",
  "en-IN": "Indian",
};
const STYLE_KEEP = new Set(["cheerful", "excited", "friendly", "hopeful", "newscast", "advertisement_upbeat", "calm", "gentle", "warm", "narration-relaxed", "whispering", "shouting"]);

let voiceMemo: { at: number; key: string; voices: JingleVoice[] } | null = null;
async function voicesFor(key: string): Promise<{ voices: JingleVoice[]; problem: string }> {
  if (voiceMemo && voiceMemo.key === key && Date.now() - voiceMemo.at < 3600_000) return { voices: voiceMemo.voices, problem: "" };
  const [, region, secret] = key.split("|");
  try {
    const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, { headers: { "Ocp-Apim-Subscription-Key": secret ?? "" } });
    if (!res.ok) return { voices: [], problem: res.status === 401 ? "Azure didn't accept the key." : `Azure said ${res.status}.` };
    const list = (await res.json()) as { ShortName: string; DisplayName?: string; Gender?: string; Locale: string; StyleList?: string[] }[];
    const voices = list
      .filter((v) => ACCENTS[v.Locale] && AZURE_VOICE.test(`az:${v.ShortName}`))
      .map((v) => ({
        name: `az:${v.ShortName}`,
        label: v.DisplayName ?? v.ShortName,
        gender: v.Gender === "Female" ? "Female" : "Male",
        accent: ACCENTS[v.Locale],
        styles: (v.StyleList ?? []).filter((s) => STYLE_KEEP.has(s)),
      }))
      // Voices that can sound cheerful/excited first: they suit jingles.
      .sort((a, b) => Number(b.styles.length > 0) - Number(a.styles.length > 0) || a.accent.localeCompare(b.accent) || a.label.localeCompare(b.label));
    voiceMemo = { at: Date.now(), key, voices };
    return { voices, problem: "" };
  } catch {
    return { voices: [], problem: "Couldn't reach Azure." };
  }
}

const draftOf = (r: { id: number; words: string; status: string; error: string; url: string; duration_sec: number }): JingleDraft => ({
  id: Number(r.id),
  words: r.words,
  status: r.status,
  error: r.error,
  url: r.url,
  durationSec: Number(r.duration_sec),
});

/** The voices (from the Azure key saved for the devotional) and the last few jingles made. */
export const jingleDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { ok: false as const };
    // A mix the audio server never sent back: say so.
    await sql
      .query("update jingle_drafts set status = 'failed', error = 'The audio server didn''t answer. Try again.' where status = 'mixing' and created_at < now() - interval '10 minutes'")
      .catch(() => undefined);
    const key = await azureKey(sql);
    const { voices, problem } = key ? await voicesFor(key) : { voices: [] as JingleVoice[], problem: "Save the Azure key in the devotional voice settings first." };
    const drafts = await sql.query<{ id: number; words: string; status: string; error: string; url: string; duration_sec: number }>(
      "select id, words, status, error, url, duration_sec from jingle_drafts order by id desc limit 4",
    );
    const bed = await sql.query<{ bed_url: string }>("select bed_url from jingle_drafts where bed_url <> '' order by id desc limit 1");
    return { ok: true as const, voices, problem, drafts: drafts.map(draftOf), lastBed: bed[0]?.bed_url ?? "" };
  });

/** Make a jingle: the voice reads the words; with a music bed, the audio server mixes them. */
export const makeJingle = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const r = rec(input);
    return {
      words: String(r.words ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
      voice: String(r.voice ?? ""),
      style: String(r.style ?? "").replace(/[^a-z_-]/gi, "").slice(0, 40),
      bedUrl: String(r.bedUrl ?? "").trim().slice(0, 600),
      bedLevel: Math.max(0.05, Math.min(0.8, Number(r.bedLevel) || 0.25)),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { ok: false as const, error: "Only the Studio can make jingles." };
    if (data.words.length < 3) return { ok: false as const, error: "Type the words first." };
    if (!AZURE_VOICE.test(data.voice)) return { ok: false as const, error: "Choose a voice." };
    const key = await azureKey(sql);
    if (!key) return { ok: false as const, error: "Save the Azure key in the devotional voice settings first." };
    const store = await import("@/lib/porch/audio-store.server");
    if (data.bedUrl && !(await store.isStoreUrl(sql, data.bedUrl))) return { ok: false as const, error: "The music upload didn't finish. Try again." };
    // 1 · The voice.
    const engine = await import("@/lib/porch/devotion-voice.server");
    let mp3: Uint8Array;
    let seconds: number;
    try {
      const words = engine.xml(data.words);
      const body = data.style ? `<mstts:express-as style="${data.style}">${words}</mstts:express-as>` : words;
      const raw = await engine.azureSay(key, data.voice, body);
      const samples = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) samples[i] = raw[i] / 32768;
      const evened = engine.level(samples);
      seconds = evened.length / engine.RATE;
      mp3 = engine.mp3Of(evened, 96);
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "The voice couldn't read it." };
    }
    const voiceUrl = await store.storePut(sql, `jingles/voice-${Date.now()}.mp3`, Buffer.from(mp3), "audio/mpeg");
    // 2 · No music: the voice alone is the jingle.
    if (!data.bedUrl) {
      const row = await sql.query<{ id: number }>(
        `insert into jingle_drafts (words, voice, style, voice_url, voice_sec, url, duration_sec, status, made_by)
         values ($1, $2, $3, $4, $5, $4, $5, 'ready', $6) returning id`,
        [data.words, data.voice, data.style, voiceUrl, seconds, context.userId],
      );
      return { ok: true as const, id: Number(row[0].id) };
    }
    // 3 · With music: the audio server mixes and saves it straight to storage.
    const r2 = await store.getR2(sql);
    if (!r2) return { ok: false as const, error: "Music needs Cloudflare storage on." };
    const { randomBytes } = await import("node:crypto");
    const token = randomBytes(24).toString("hex");
    const k = store.freshKey("jingles/jingle.mp3");
    const row = await sql.query<{ id: number }>(
      `insert into jingle_drafts (words, voice, style, bed_url, bed_level, voice_url, voice_sec, status, job_token, made_by)
       values ($1, $2, $3, $4, $5, $6, $7, 'mixing', $8, $9) returning id`,
      [data.words, data.voice, data.style, data.bedUrl, data.bedLevel, voiceUrl, seconds, token, context.userId],
    );
    const { audioWorkerBase } = await import("@/lib/porch/audio-worker.server");
    try {
      await fetch(`${audioWorkerBase()}/jingle/mix`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jobToken: token,
          draftId: Number(row[0].id),
          voiceUrl,
          bedUrl: data.bedUrl,
          bedLevel: data.bedLevel,
          voiceSec: seconds,
          putUrl: store.presign(r2, "PUT", k, {}, 3600),
          url: store.publicUrl(r2, k),
          callback: `${siteOrigin()}/api/jingle-worker`,
        }),
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      /* the free server may be waking up; the job usually still lands */
    }
    return { ok: true as const, id: Number(row[0].id) };
  });

/** How one jingle is getting on (the Studio asks every few seconds while it's mixing). */
export const jingleDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: Math.round(Number(rec(input).id) || 0) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { ok: false as const };
    const rows = await sql.query<{ id: number; words: string; status: string; error: string; url: string; duration_sec: number }>(
      "select id, words, status, error, url, duration_sec from jingle_drafts where id = $1",
      [data.id],
    );
    return rows[0] ? { ok: true as const, draft: draftOf(rows[0]) } : { ok: false as const };
  });
