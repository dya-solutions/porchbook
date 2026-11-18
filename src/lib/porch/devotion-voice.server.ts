import { Mp3Encoder } from "@breezystack/lamejs";

/**
 * The devotional read aloud: Google's natural voice, a touch of small-room
 * reverb (a quiet study), levelled and made into one small MP3.
 */

export const RATE = 24000;

/** Split the text into pieces Google accepts, breaking at paragraphs and sentences. */
function pieces(text: string, limit = 1500): string[] {
  const out: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) out.push(current.trim());
    current = "";
  };
  for (const paragraph of text.split("\n")) {
    const sentences = paragraph.match(/[^.!?]+[.!?]+["”’)]*\s*|[^.!?]+$/g) ?? [paragraph];
    for (const sentence of sentences) {
      if ((current + sentence).length > limit) push();
      current += sentence;
    }
    current += "\n";
    if (current.length > limit * 0.7) push();
  }
  push();
  return out;
}

/** PCM samples out of a WAV file Google sends back. */
function wavSamples(bytes: Uint8Array): Int16Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    const size = view.getUint32(at + 4, true);
    if (id === "data") {
      const start = at + 8;
      const end = Math.min(bytes.length, start + size);
      const copy = bytes.slice(start, end - ((end - start) % 2));
      return new Int16Array(copy.buffer);
    }
    at += 8 + size + (size % 2);
  }
  // No header: raw samples.
  const copy = bytes.slice(0, bytes.length - (bytes.length % 2));
  return new Int16Array(copy.buffer);
}

export class VoiceError extends Error {}

/** ElevenLabs voices are stored as "el:<voice id>". */
export const isEleven = (voice: string) => voice.startsWith("el:");
const ELEVEN_MODEL = "eleven_multilingual_v2";

/** A piece said: its samples, and (ElevenLabs) when each word starts, in seconds from the piece's start. */
type Said = { samples: Int16Array; words?: number[] };

/** Word start times out of ElevenLabs' per-letter timing. */
function wordStarts(chars: string[], starts: number[]): number[] {
  const out: number[] = [];
  let inWord = false;
  chars.forEach((ch, i) => {
    const blank = /\s/.test(ch);
    if (!blank && !inWord) out.push(starts[i] ?? 0);
    inWord = !blank;
  });
  return out;
}

/** The plain ElevenLabs request (sound only), for when the timed one gives no sound. */
async function elevenPlain(key: string, id: string, text: string): Promise<Int16Array> {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(id)}?output_format=pcm_24000`, {
    method: "POST",
    headers: { "content-type": "application/json", "xi-api-key": key },
    body: JSON.stringify({ text, model_id: ELEVEN_MODEL, voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true } }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: { message?: string } | string };
    const detail = typeof body.detail === "string" ? body.detail : body.detail?.message;
    throw new VoiceError(detail || `ElevenLabs said ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const copy = bytes.slice(0, bytes.length - (bytes.length % 2));
  return new Int16Array(copy.buffer);
}

/**
 * ElevenLabs, the plain way (sound only), as before the word timing: the timed request made
 * today's readings fail. Each paragraph's own start and end are still known, so the words on
 * the radio screen still follow the voice paragraph by paragraph.
 */
async function elevenPiece(key: string, voice: string, text: string): Promise<Said> {
  return { samples: await elevenPlain(key, voice.slice(3), text) };
}

async function speakPiece(key: string, voice: string, text: string): Promise<Said> {
  if (isEleven(voice)) return elevenPiece(key, voice, text);
  const languageCode = voice.split("-").slice(0, 2).join("-") || "en-US";
  const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode, name: voice },
      audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: RATE },
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { audioContent?: string; error?: { message?: string } };
  if (!response.ok || !body.audioContent) throw new VoiceError(body.error?.message || `Google said ${response.status}`);
  return { samples: wavSamples(Uint8Array.from(Buffer.from(body.audioContent, "base64"))) };
}

/** One piece to say, and the silence wanted before and after it (seconds). */
type Part = { text: string; before: number; after: number; line: number };

/**
 * The text as pieces, read like a person would: a pause after the title, headings set apart
 * (ending like a full stop so the voice settles), scripture quotes a little apart, a breath between paragraphs.
 * Lines marked "§T " (title), "§H " (heading), "§Q " (quote); other lines are paragraphs.
 */
function partsOf(text: string, limit: number): Part[] {
  const out: Part[] = [];
  text.split("\n").forEach((raw, lineNo) => {
    const line = raw.trim();
    if (!line) return;
    const mark = /^§([A-Z]) (.*)$/.exec(line);
    const kind = mark?.[1] ?? "P";
    // Pauses before and after each part (seconds).
    const pause: Record<string, [number, number]> = {
      T: [0, 1.5], // the title
      A: [0.3, 1.0], // Apostle Grace Lubega
      S: [0.6, 1.0], // the opening scripture
      H: [1.0, 1.0], // Further study, Golden nugget, Prayer and other headings
      R: [0.35, 0.35], // each further-study scripture
      Q: [0.45, 0.45], // a scripture quote
      P: [0.25, 0.5], // a paragraph
    };
    const [before, after] = pause[kind] ?? pause.P;
    let body = (mark ? mark[2] : line).trim();
    if (!body) return;
    // Short parts end like a full stop so the voice settles.
    if ("TAHR".includes(kind) && !/[.!?:]$/.test(body)) body += ".";
    // A title in capitals is said as words, not spelled out.
    if ("TAH".includes(kind)) body = body.replace(/\b[A-Z]{2,}\b/g, (w) => (w.length > 1 ? w[0] + w.slice(1).toLowerCase() : w));
    const bits = pieces(body, limit);
    bits.forEach((bit, index) => {
      out.push({ text: bit, before: index === 0 ? before : 0.1, after: index === bits.length - 1 ? after : 0.1, line: lineNo });
    });
  });
  return out;
}

/** When one part is heard: its text line, start and end (seconds), and its words' starts when the voice gave them. */
export type HeardPart = { line: number; text: string; start: number; end: number; words?: number[] };

/** Microsoft Azure voices are stored as "az:<voice name>"; their key as "az|<region>|<key>". */
export const isAzure = (voice: string) => voice.startsWith("az:");
export const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** One Azure request: SSML in, raw 24 kHz samples out (waits and tries again when the free plan says "too many"). */
export async function azureSay(key: string, voice: string, body: string): Promise<Int16Array> {
  const [, region, secret] = key.split("|");
  const name = voice.slice(3);
  const lang = name.split("-").slice(0, 2).join("-");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": secret,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "raw-24khz-16bit-mono-pcm",
        "User-Agent": "porchbook",
      },
      body: `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}"><voice name="${xml(name)}">${body}</voice></speak>`,
    });
    if (response.status === 429) {
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      continue;
    }
    if (!response.ok) {
      const why = (await response.text().catch(() => "")).slice(0, 160);
      throw new VoiceError(response.status === 401 ? "Azure didn't accept the key (check the key and region)." : `Azure said ${response.status}${why ? `: ${why}` : ""}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return new Int16Array(bytes.slice(0, bytes.length - (bytes.length % 2)).buffer);
  }
  throw new VoiceError("Azure is busy (free plan limit). Try again in a minute.");
}

/** Azure, line by line (exact timing per line): the free plan allows 20 requests a minute, so at most 18 go in any minute. */
async function azureLines(key: string, voice: string, parts: Part[]): Promise<Said[]> {
  const starts: number[] = [];
  const out: Said[] = [];
  for (const part of parts) {
    const windowStart = Date.now() - 60_000;
    while (starts.length && starts[0] < windowStart) starts.shift();
    if (starts.length >= 18) await new Promise((r) => setTimeout(r, starts[0] + 60_500 - Date.now()));
    starts.push(Date.now());
    out.push({ samples: await azureSay(key, voice, xml(part.text)) });
  }
  return out;
}

/** The whole text in one voice, as float samples, with the pauses set by partsOf — and when each part is heard. */
export async function speak(key: string, voice: string, text: string): Promise<{ samples: Float32Array; heard: HeardPart[] }> {
  const parts = partsOf(text, isEleven(voice) ? 2500 : 1500);
  let results: Said[] = new Array(parts.length);
  if (isAzure(voice)) results = await azureLines(key, voice, parts);
  else {
    let next = 0;
    const lane = async () => {
      while (next < parts.length) {
        const at = next++;
        results[at] = await speakPiece(key, voice, parts[at].text);
      }
    };
    await Promise.all([lane(), lane(), lane()]);
  }
  const gaps = parts.map((part, index) => (index === 0 ? 0 : Math.round(RATE * Math.max(0.25, parts[index - 1].after, part.before))));
  const total = results.reduce((sum, part, index) => sum + part.samples.length + gaps[index], 0) + Math.round(RATE * 0.3);
  const out = new Float32Array(total);
  const heard: HeardPart[] = [];
  let at = 0;
  results.forEach((part, index) => {
    at += gaps[index];
    const start = at / RATE;
    for (let i = 0; i < part.samples.length; i += 1) out[at + i] = part.samples[i] / 32768;
    at += part.samples.length;
    heard.push({ line: parts[index].line, text: parts[index].text, start, end: at / RATE, words: part.words?.map((w) => start + w) });
  });
  return { samples: out, heard };
}

/** A little small-room reverb: four damped echoes blended softly behind the voice. */
export function smallRoom(dry: Float32Array, wet = 0.12): Float32Array {
  const ms = (value: number) => Math.round((value / 1000) * RATE);
  const combs = [17.8, 22.3, 24.7, 26.2].map((delay) => ({ buf: new Float32Array(ms(delay)), at: 0, low: 0 }));
  const passes = [5.0, 1.7].map((delay) => ({ buf: new Float32Array(ms(delay)), at: 0 }));
  const feedback = 0.72;
  const damp = 0.35;
  const pre = ms(7);
  const tail = ms(400);
  const out = new Float32Array(dry.length + tail);
  for (let i = 0; i < out.length; i += 1) {
    const source = i - pre >= 0 && i - pre < dry.length ? dry[i - pre] * 0.25 : 0;
    let sum = 0;
    for (const comb of combs) {
      const held = comb.buf[comb.at];
      comb.low = held * (1 - damp) + comb.low * damp;
      comb.buf[comb.at] = source + comb.low * feedback;
      comb.at = (comb.at + 1) % comb.buf.length;
      sum += held;
    }
    for (const pass of passes) {
      const held = pass.buf[pass.at];
      const value = -sum * 0.6 + held;
      pass.buf[pass.at] = sum + held * 0.6;
      pass.at = (pass.at + 1) % pass.buf.length;
      sum = value;
    }
    out[i] = (i < dry.length ? dry[i] : 0) + sum * wet;
  }
  return out;
}

/** Bring the reading to a steady level without clipping. */
export function level(samples: Float32Array): Float32Array {
  let peak = 0;
  let energy = 0;
  for (const value of samples) {
    const size = Math.abs(value);
    if (size > peak) peak = size;
    energy += value * value;
  }
  const rms = Math.sqrt(energy / Math.max(1, samples.length));
  const gain = Math.min(0.9 / Math.max(peak, 1e-6), 0.16 / Math.max(rms, 1e-6));
  for (let i = 0; i < samples.length; i += 1) samples[i] *= gain;
  return samples;
}

export function mp3Of(samples: Float32Array, kbps = 48): Uint8Array {
  const encoder = new Mp3Encoder(1, RATE, kbps);
  const block = 1152 * 8;
  const chunks: Uint8Array[] = [];
  const pcm = new Int16Array(block);
  for (let at = 0; at < samples.length; at += block) {
    const size = Math.min(block, samples.length - at);
    for (let i = 0; i < size; i += 1) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[at + i] * 32767)));
    const encoded = encoder.encodeBuffer(size === block ? pcm : pcm.subarray(0, size));
    if (encoded.length) chunks.push(new Uint8Array(encoded));
  }
  const last = encoder.flush();
  if (last.length) chunks.push(new Uint8Array(last));
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Text → finished MP3 (voice, room, level). */
export async function readAloud(key: string, voice: string, text: string): Promise<{ mp3: Uint8Array; seconds: number; heard: HeardPart[] }> {
  const { samples, heard } = await speak(key, voice, text);
  // A reading that came back (nearly) silent is a failure, not a reading.
  if (samples.length < RATE * 5) throw new VoiceError("The voice came back empty. Try making it again.");
  const finished = level(smallRoom(samples));
  return { mp3: mp3Of(finished), seconds: finished.length / RATE, heard };
}

/** The words on the radio screen: each line of the devotional as written, and when each of its words is heard. */
export type Timing = { exact: boolean; lines: { t: string; w: number[] }[] };

const shown = (line: string) => line.replace(/^§[A-Z] /, "").trim();
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Lines as written (`written`, the same lines as what was said, before "say it like" changes)
 * matched to when they were heard. Exact where the voice gave word times; otherwise each part's
 * words are spread over the time that part took.
 */
export function timingOf(written: string, heard: HeardPart[]): Timing {
  const rows = written.split("\n");
  const lines: { t: string; w: number[] }[] = [];
  let exact = heard.length > 0;
  const byLine = new Map<number, HeardPart[]>();
  for (const part of heard) byLine.set(part.line, [...(byLine.get(part.line) ?? []), part]);
  for (const [lineNo, parts] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
    const text = shown(rows[lineNo] ?? "");
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    // When each word that was said starts.
    const said: number[] = [];
    for (const part of parts) {
      const count = part.text.split(/\s+/).filter(Boolean).length;
      if (part.words && part.words.length) said.push(...part.words);
      else {
        exact = false;
        for (let i = 0; i < count; i += 1) said.push(part.start + ((part.end - part.start) * i) / Math.max(1, count));
      }
    }
    // Written words matched to said words by position (a "say it like" change can alter the count a little).
    lines.push({ t: text, w: words.map((_, i) => round(said[Math.min(said.length - 1, Math.floor((i * said.length) / words.length))] ?? 0)) });
  }
  return { exact, lines };
}

/** No timing kept (a reading made before timing): the lines spread over the reading, by length. */
export function estimateTiming(written: string, seconds: number): Timing {
  const rows = written.split("\n").map(shown).filter(Boolean);
  const weight = rows.map((row) => row.length + 40);
  const total = weight.reduce((a, b) => a + b, 0) || 1;
  let at = 0.5;
  const span = Math.max(1, seconds - 1);
  const lines = rows.map((row, i) => {
    const length = (weight[i] / total) * span;
    const words = row.split(/\s+/).filter(Boolean);
    const out = { t: row, w: words.map((_, k) => round(at + (length * k) / Math.max(1, words.length))) };
    at += length;
    return out;
  });
  return { exact: false, lines };
}
