// Porchbook Radio audio worker: evens out loudness and saves every upload in
// one standard format, so the station sounds consistent. It is also the
// station's mixer: it measures, masters to the studio's settings, and cuts
// short before/after samples.
//
//   POST /fm/process {jobToken, trackId, sourceUrl, kind}
//   POST /fm/process {jobToken, trackId, sourceUrl, kind, mode: "measure" | "master" | "preview", settings, atSec}
//
// Jobs run one at a time. When a job finishes, the worker asks Porchbook for a
// one-off upload pass (proving the job with its jobToken), uploads the result
// to Porchbook's audio storage, and reports back. No secrets live here:
// Porchbook checks every jobToken against its own records.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const PORCHBOOK = (process.env.PORCHBOOK_URL || "https://porchbook.vercel.app").replace(/\/+$/, "");
const SPEECH = new Set(["preaching", "news", "reading"]);
const queue = [];
let running = false;
let current = 0; // the track being processed right now
let currentMode = "";

function ffmpegPath() {
  try {
    const bundled = require("ffmpeg-static");
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {
    /* fall back to a system ffmpeg */
  }
  return "ffmpeg";
}

function allowedSource(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (require("./store").storeHost(u.hostname)) return true;
    return u.origin === PORCHBOOK && u.pathname === "/api/fm-file";
  } catch {
    return false;
  }
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let log = "";
    child.stderr.on("data", (chunk) => {
      log += chunk.toString();
      if (log.length > 200000) log = log.slice(-100000);
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(log) : reject(new Error(`ffmpeg exited ${code}: ${log.slice(-400)}`))));
  });
}

function lastTime(log) {
  const all = [...log.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const m = all[all.length - 1];
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

async function tell(body) {
  const response = await fetch(`${PORCHBOOK}/api/fm-worker`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Porchbook answered ${response.status}`);
  return data;
}

// ---- The mixer: measure, master to the studio's settings, and short before/after samples.
// Settings arrive as plain numbers and the filter chain is built here, so nothing
// a caller sends ever reaches ffmpeg as text.
const MASTER_MODES = new Set(["measure", "master", "preview"]);
const num = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
function cleanSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    lufs: num(s.lufs, -24, -10, -16),
    peak: num(s.peak, -3, -0.5, -1.5),
    warmth: num(s.warmth, -3, 3, 0),
    clarity: num(s.clarity, -3, 3, 0),
    comp: Math.round(num(s.comp, 0, 3, 2)),
    hiss: Math.round(num(s.hiss, 0, 3, 1)),
  };
}

/** The shaping before levelling: voice or music. */
function shapeChain(kind, st) {
  const speech = SPEECH.has(kind);
  const f = [];
  if (speech) {
    f.push("highpass=f=80");
    if (st.hiss > 0) f.push(`afftdn=nr=${[0, 6, 10, 15][st.hiss]}:nf=-45:tn=1`);
    f.push("equalizer=f=300:t=q:w=1:g=-2"); // less boom and mud
    f.push(`equalizer=f=150:t=q:w=1:g=${(st.warmth * 1.5).toFixed(1)}`);
    f.push(`equalizer=f=3000:t=q:w=1.2:g=${(2 + st.clarity * 1.5).toFixed(1)}`); // words come forward
    if (st.comp > 0) f.push(`acompressor=threshold=-${[0, 18, 22, 26][st.comp]}dB:ratio=${[1, 2, 3, 4.5][st.comp]}:attack=15:release=250:makeup=2`);
  } else {
    f.push("highpass=f=30");
    if (st.warmth) f.push(`equalizer=f=120:t=q:w=1:g=${(st.warmth * 0.8).toFixed(1)}`);
    if (st.clarity) f.push(`equalizer=f=8000:t=q:w=1:g=${(st.clarity * 0.8).toFixed(1)}`);
    if (st.comp >= 2) f.push(`acompressor=threshold=-14dB:ratio=${st.comp === 3 ? 2 : 1.5}:attack=30:release=300`);
  }
  return f;
}

function loudJson(log) {
  const m = log.match(/\{\s*"input_i"[\s\S]*?\}/g);
  if (!m) throw new Error("couldn't measure the loudness");
  const j = JSON.parse(m[m.length - 1]);
  return j;
}
function noiseFloor(log) {
  const all = [...log.matchAll(/Noise floor dB:\s*(-?[\d.]+|-inf)/g)];
  const v = all.length ? Number(all[all.length - 1][1]) : NaN;
  return Number.isFinite(v) ? v : null;
}
const round1 = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : null);

/** Measure a file: loudness (LUFS), true peak, range, hiss level. */
async function measure(file, extra = []) {
  const log = await run([
    "-hide_banner", "-nostats", ...extra, "-i", file, "-vn",
    "-af", "astats=measure_overall=Noise_floor:measure_perchannel=none,loudnorm=print_format=json",
    "-f", "null", "-",
  ]);
  const j = loudJson(log);
  return { i: round1(j.input_i), tp: round1(j.input_tp), lra: round1(j.input_lra), noise: round1(noiseFloor(log)) };
}

/** Master a file (two passes: measure through the chain, then level exactly). */
async function master(input, output, kind, st, cut = []) {
  const speech = SPEECH.has(kind);
  const shape = shapeChain(kind, st);
  const target = `I=${st.lufs}:TP=${st.peak}:LRA=${speech ? 7 : 11}`;
  const first = await run(["-hide_banner", "-nostats", ...cut, "-i", input, "-vn", "-af", [...shape, `loudnorm=${target}:print_format=json`].join(","), "-f", "null", "-"]);
  const j = loudJson(first);
  const ok = (v) => Number.isFinite(Number(v)) && Number(v) > -70;
  const measured = ok(j.input_i)
    ? `:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`
    : "";
  const log = await run([
    "-hide_banner", ...cut, "-y", "-i", input, "-vn",
    "-af", [...shape, `loudnorm=${target}${measured}`, `alimiter=limit=${Math.pow(10, st.peak / 20).toFixed(3)}:level=false`].join(","),
    "-ar", "44100", "-ac", speech ? "1" : "2",
    "-codec:a", "libmp3lame", "-b:a", speech ? "96k" : "192k",
    output,
  ]);
  return lastTime(log);
}

async function upload(job, file, which) {
  const spot = await tell({ action: "token", mode: job.mode, which, jobToken: job.jobToken, trackId: job.trackId });
  return require("./store").saveFile(spot, file);
}

async function mixJob(job, input, dir) {
  const st = cleanSettings(job.settings);
  if (job.mode === "measure") {
    const before = await measure(input);
    await tell({ action: "measured", mode: job.mode, jobToken: job.jobToken, trackId: job.trackId, before });
    return `measured ${before.i} LUFS`;
  }
  if (job.mode === "preview") {
    const at = num(job.atSec, 0, 6 * 3600, 0);
    const cut = ["-ss", String(at), "-t", "20"];
    const plain = path.join(dir, "before.mp3");
    const done = path.join(dir, "after.mp3");
    // The "before" sample is the original, only re-encoded so both play the same way.
    await run(["-hide_banner", ...cut, "-y", "-i", input, "-vn", "-ar", "44100", "-codec:a", "libmp3lame", "-b:a", "128k", plain]);
    await master(input, done, job.kind, st, cut);
    const beforeUrl = await upload(job, plain, "before");
    const afterUrl = await upload(job, done, "after");
    await tell({ action: "previewed", mode: job.mode, jobToken: job.jobToken, trackId: job.trackId, beforeUrl, afterUrl });
    return "sample ready";
  }
  const before = await measure(input);
  const output = path.join(dir, "out.mp3");
  const durationSec = await master(input, output, job.kind, st);
  if (durationSec < 0.5) throw new Error("no audio came out");
  const after = await measure(output);
  const url = await upload(job, output, "master");
  await tell({ action: "done", mode: job.mode, jobToken: job.jobToken, trackId: job.trackId, url, durationSec, before, after });
  return `mastered ${before.i} → ${after.i} LUFS`;
}

async function processJob(job) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-"));
  const input = path.join(dir, "in");
  const output = path.join(dir, "out.mp3");
  try {
    const source = await fetch(job.sourceUrl);
    if (!source.ok || !source.body) throw new Error(`download ${source.status}`);
    await pipeline(Readable.fromWeb(source.body), fs.createWriteStream(input));
    if (MASTER_MODES.has(job.mode)) {
      const what = await mixJob(job, input, dir);
      console.log(`[fm] track ${job.trackId} ${job.mode}: ${what}`);
      return;
    }
    const speech = SPEECH.has(job.kind);
    const log = await run([
      "-hide_banner", "-y", "-i", input, "-vn",
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-ar", "44100",
      "-ac", speech ? "1" : "2",
      "-codec:a", "libmp3lame", "-b:a", speech ? "64k" : "128k",
      output,
    ]);
    const durationSec = lastTime(log);
    if (durationSec < 0.5) throw new Error("no audio came out");
    const spot = await tell({ action: "token", jobToken: job.jobToken, trackId: job.trackId });
    const savedUrl = await require("./store").saveFile(spot, output);
    await tell({ action: "done", jobToken: job.jobToken, trackId: job.trackId, url: savedUrl, durationSec });
    console.log(`[fm] track ${job.trackId} done (${Math.round(durationSec)}s)`);
  } catch (error) {
    console.error(`[fm] track ${job.trackId} ${job.mode || "process"} failed:`, error.message);
    await tell({ action: "failed", mode: job.mode, jobToken: job.jobToken, trackId: job.trackId, error: String(error.message).slice(0, 300) }).catch((e) =>
      console.error(`[fm] couldn't report the failure of track ${job.trackId}:`, e.message),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function drain() {
  if (running) return;
  running = true;
  // Free Render servers sleep after 15 quiet minutes; knock on our own door
  // while there's work so a long queue isn't cut off.
  const self = process.env.RENDER_EXTERNAL_URL;
  const awake = self ? setInterval(() => void fetch(self).catch(() => undefined), 4 * 60 * 1000) : null;
  try {
    while (queue.length) {
      const job = queue.shift();
      current = job.trackId;
      currentMode = job.mode;
      await processJob(job);
      current = 0;
      currentMode = "";
    }
  } finally {
    if (awake) clearInterval(awake);
    running = false;
  }
}

function handleFmProcess(req, res) {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
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
    const ok =
      job && typeof job.jobToken === "string" && job.jobToken.length >= 20 && Number.isInteger(job.trackId) && allowedSource(job.sourceUrl);
    if (!ok) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "not a Porchbook job" }));
    }
    const mode = MASTER_MODES.has(job.mode) ? job.mode : "";
    const entry = { jobToken: job.jobToken, trackId: job.trackId, sourceUrl: job.sourceUrl, kind: String(job.kind || ""), mode, settings: cleanSettings(job.settings), atSec: Number(job.atSec) || 0 };
    const waiting = queue.find((q) => q.trackId === job.trackId && q.mode === mode);
    if (waiting) Object.assign(waiting, entry); // the newest job is the one Porchbook expects
    else if (!(current === job.trackId && currentMode === mode)) {
      // A before/after sample jumps the queue: the studio is waiting to hear it.
      if (mode === "preview") queue.unshift(entry);
      else queue.push(entry);
    }
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ queued: queue.length }));
    void drain();
  });
}

function fmStatus() {
  return { working: current, mode: currentMode, queued: queue.map((q) => q.trackId), ffmpeg: ffmpegPath(), mixer: 1 };
}

module.exports = { handleFmProcess, fmStatus, _mixer: { measure, master, cleanSettings } };
