// Porchbook Nuggets: short clips of selected speakers for the Radio's station breaks.
//
//   POST /nugget/transcribe {jobToken, sourceId, audioUrl, groqKey}  -> the sermon's words with times (Groq Whisper)
//   POST /nugget/cut {jobToken, nuggetId, audioUrl, startSec, endSec}  -> the nugget's own evened-out mp3
//
// Jobs run one at a time and report to Porchbook (/api/nugget-worker), which
// checks every jobToken against its own records. The Groq key arrives
// with the job and is never stored here.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const PORCHBOOK = (process.env.PORCHBOOK_URL || "https://porchbook.vercel.app").replace(/\/+$/, "");
// Where speakers' audio may come from (podcast hosts and Porchbook's own storage).
const HOSTS = [/(^|\.)soundcloud\.com$/i, /(^|\.)sndcdn\.com$/i, /\.public\.blob\.vercel-storage\.com$/i, /^pub-[a-z0-9]+\.r2\.dev$/i, /(^|\.)anchor\.fm$/i, /(^|\.)libsyn\.com$/i, /(^|\.)podbean\.com$/i, /(^|\.)buzzsprout\.com$/i, /(^|\.)megaphone\.fm$/i, /(^|\.)simplecast\.com$/i, /(^|\.)captivate\.fm$/i, /(^|\.)spreaker\.com$/i, /(^|\.)acast\.com$/i];
const queue = [];
let running = false;
let current = "";

function ffmpegPath() {
  try {
    const bundled = require("ffmpeg-static");
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {
    /* system ffmpeg */
  }
  return "ffmpeg";
}
function allowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && HOSTS.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
}
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let log = "";
    child.stderr.on("data", (c) => {
      log += c.toString();
      if (log.length > 200000) log = log.slice(-100000);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => (code === 0 ? resolve(log) : reject(new Error(`ffmpeg ${code === null ? `stopped (${signal})` : `exited ${code}`}: ${log.slice(-300)}`))));
  });
}
function lastTime(log) {
  const all = [...log.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const m = all[all.length - 1];
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}
/**
 * Download the episode first (Node follows the podcast's redirects and does the secure connection);
 * the bundled ffmpeg is then only given a local file. Asking ffmpeg to fetch links itself crashed it.
 */
async function download(url, file) {
  const res = await fetch(url, { headers: { "user-agent": "PorchbookAudio/1.0" }, redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`couldn't download the episode (${res.status})`);
  const final = new URL(res.url || url);
  if (!allowed(final.href) && !/\.(sndcdn|soundcloud)\.com$/i.test(final.hostname) && final.protocol !== "https:") throw new Error("the episode moved somewhere unexpected");
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
  if (fs.statSync(file).size < 10000) throw new Error("the episode download was empty");
}

async function tell(body) {
  const res = await fetch(`${PORCHBOOK}/api/nugget-worker`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Porchbook answered ${res.status}`);
  return data;
}

async function transcribe(job, dir) {
  // A small, speech-only copy is enough for the words (Groq takes files up to 25 MB: about 2.5 hours at this size).
  const small = path.join(dir, "speech.mp3");
  const input = path.join(dir, "episode");
  await download(job.audioUrl, input);
  await run(["-hide_banner", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-codec:a", "libmp3lame", "-b:a", "20k", small]);
  const form = new FormData();
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "verbose_json");
  form.append("language", "en");
  form.append("file", new Blob([fs.readFileSync(small)], { type: "audio/mpeg" }), "speech.mp3");
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${job.groqKey}` }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = (data && data.error && data.error.message) || `Groq answered ${res.status}`;
    throw new Error(String(why));
  }
  const segments = (data.segments || []).map((x) => ({ text: String(x.text || "").trim(), start: x.start, end: x.end })).filter((x) => x.text);
  await tell({ action: "transcript", jobToken: job.jobToken, sourceId: job.sourceId, segments });
  return `${segments.length} pieces`;
}

async function cut(job, dir) {
  const out = path.join(dir, "nugget.mp3");
  const len = Math.max(1, job.endSec - job.startSec);
  const fade = Math.min(0.4, len / 10);
  const input = path.join(dir, "episode");
  await download(job.audioUrl, input);
  const log = await run([
    "-hide_banner", "-y", "-ss", String(job.startSec), "-t", String(len), "-i", input, "-vn",
    "-af", `loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=${fade},afade=t=out:st=${Math.max(0, len - fade)}:d=${fade}`,
    "-ar", "44100", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "96k", out,
  ]);
  const durationSec = lastTime(log);
  if (durationSec < 1) throw new Error("no audio came out");
  const stored = { url: await require("./store").saveFile(await tell({ action: "token", jobToken: job.jobToken, nuggetId: job.nuggetId }), out) };
  await tell({ action: "cut", jobToken: job.jobToken, nuggetId: job.nuggetId, url: stored.url, durationSec });
  return `${Math.round(durationSec)}s`;
}

async function drain() {
  if (running) return;
  running = true;
  const self = process.env.RENDER_EXTERNAL_URL;
  const awake = self ? setInterval(() => void fetch(self).catch(() => undefined), 4 * 60 * 1000) : null;
  try {
    while (queue.length) {
      const job = queue.shift();
      current = job.kind === "cut" ? `nugget ${job.nuggetId}` : `episode ${job.sourceId}`;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nug-"));
      try {
        const what = job.kind === "cut" ? await cut(job, dir) : await transcribe(job, dir);
        console.log(`[nuggets] ${current}: ${what}`);
      } catch (error) {
        console.error(`[nuggets] ${current} failed:`, error.message);
        const failed = job.kind === "cut" ? { action: "cut-failed", nuggetId: job.nuggetId } : { action: "transcript-failed", sourceId: job.sourceId };
        await tell({ ...failed, jobToken: job.jobToken, error: String(error.message).slice(0, 300) }).catch(() => undefined);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        current = "";
      }
    }
  } finally {
    if (awake) clearInterval(awake);
    running = false;
  }
}

function handleNugget(kind) {
  return (req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 10000) req.destroy();
    });
    req.on("end", () => {
      let job;
      try {
        job = JSON.parse(raw);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "bad json" }));
      }
      const base = job && typeof job.jobToken === "string" && job.jobToken.length >= 20 && allowed(job.audioUrl);
      const ok =
        kind === "cut"
          ? base && Number.isInteger(job.nuggetId) && Number.isFinite(job.startSec) && Number.isFinite(job.endSec) && job.endSec > job.startSec && job.endSec - job.startSec <= 300
          : base && Number.isInteger(job.sourceId) && typeof job.groqKey === "string" && job.groqKey.length > 10;
      if (!ok) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "not a Porchbook job" }));
      }
      const entry =
        kind === "cut"
          ? { kind, jobToken: job.jobToken, nuggetId: job.nuggetId, audioUrl: job.audioUrl, startSec: job.startSec, endSec: job.endSec }
          : { kind, jobToken: job.jobToken, sourceId: job.sourceId, audioUrl: job.audioUrl, groqKey: job.groqKey };
      // A newer job for the same nugget or episode replaces a waiting one.
      const same = queue.findIndex((q) => q.kind === kind && (kind === "cut" ? q.nuggetId === entry.nuggetId : q.sourceId === entry.sourceId));
      if (same >= 0) queue[same] = entry;
      else if (kind === "cut") queue.unshift(entry); // short cuts first: the founder is waiting to hear them
      else queue.push(entry);
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ queued: queue.length }));
      void drain();
    });
  };
}

function nuggetStatus() {
  return { working: current, queued: queue.length };
}

module.exports = { handleTranscribe: handleNugget("transcribe"), handleCut: handleNugget("cut"), nuggetStatus };
