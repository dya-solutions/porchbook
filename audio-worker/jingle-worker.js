// Porchbook Radio jingles: a spoken line mixed over a music bed.
//
//   POST /jingle/mix {jobToken, draftId, voiceUrl, bedUrl, bedLevel, voiceSec, putUrl, url, callback}
//
// The music plays up front for a moment, dips under the voice, comes back up after it and fades out.
// The result is saved straight to storage (putUrl) and reported to Porchbook (callback).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const { storeHost } = require("./store");

const queue = [];
let running = false;

function ffmpegPath() {
  try {
    const bundled = require("ffmpeg-static");
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {
    /* system ffmpeg */
  }
  return "ffmpeg";
}
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let log = "";
    child.stderr.on("data", (c) => {
      log += c.toString();
      if (log.length > 400000) log = log.slice(-200000);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => (code === 0 ? resolve(log) : reject(new Error(`ffmpeg ${code === null ? `stopped (${signal})` : `exited ${code}`}: ${log.slice(-300)}`))));
  });
}
const lastTime = (log) => {
  const all = [...log.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const m = all[all.length - 1];
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
};
async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`couldn't download (${res.status})`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
}

/** The bed's loudness over time: full intro, a smooth dip under the voice, back up, then the fade. */
function filterFor(voiceSec, level) {
  const lead = 1.6; // music alone before the voice
  const tail = 2.8; // music after the voice
  const total = lead + voiceSec + tail;
  const a = lead - 0.5; // start of the dip
  const b = lead + voiceSec + 0.25; // voice done
  const L = level.toFixed(3);
  // Piecewise: 1 → L over 0.5 s, hold L, L → 0.9 over 0.6 s.
  const vol = `if(lt(t,${a}),1,if(lt(t,${lead}),1-(1-${L})*(t-${a})/0.5,if(lt(t,${b}),${L},if(lt(t,${b + 0.6}),${L}+(0.9-${L})*(t-${b})/0.6,0.9))))`;
  return {
    total,
    graph:
      `[0:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(2)},asetpts=N/SR/TB,volume='${vol}':eval=frame,afade=t=out:st=${(total - 2).toFixed(2)}:d=2[bed];` +
      `[1:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${Math.round(lead * 1000)}|${Math.round(lead * 1000)},volume=1.15[v];` +
      `[bed][v]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[out]`,
  };
}

async function mix(job) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jingle-"));
  try {
    const voice = path.join(dir, "voice.mp3");
    const bed = path.join(dir, "bed");
    const out = path.join(dir, "jingle.mp3");
    await download(job.voiceUrl, voice);
    await download(job.bedUrl, bed);
    const { graph } = filterFor(Number(job.voiceSec) || 3, Math.max(0.05, Math.min(0.8, Number(job.bedLevel) || 0.25)));
    // The bed loops if it's shorter than the jingle.
    const log = await run(["-hide_banner", "-y", "-stream_loop", "-1", "-i", bed, "-i", voice, "-filter_complex", graph, "-map", "[out]", "-ar", "44100", "-codec:a", "libmp3lame", "-b:a", "160k", out]);
    const durationSec = lastTime(log);
    if (durationSec < 0.5) throw new Error("no audio came out");
    const put = await fetch(job.putUrl, { method: "PUT", headers: { "content-type": "audio/mpeg" }, body: fs.readFileSync(out) });
    if (!put.ok) throw new Error(`storage refused the file (${put.status})`);
    await tell(job, { action: "done", url: job.url, durationSec });
    console.log(`[jingle] ${job.draftId} mixed (${durationSec.toFixed(1)}s)`);
  } catch (error) {
    console.error(`[jingle] ${job.draftId} failed:`, error.message);
    await tell(job, { action: "failed", error: String(error.message).slice(0, 200) }).catch(() => undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
async function tell(job, body) {
  const res = await fetch(job.callback, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, jobToken: job.jobToken, draftId: job.draftId }) });
  if (!res.ok) throw new Error(`Porchbook answered ${res.status}`);
}
async function next() {
  if (running) return;
  running = true;
  while (queue.length) await mix(queue.shift());
  running = false;
}

const hostOf = (u) => {
  try {
    const x = new URL(u);
    return x.protocol === "https:" ? x.hostname : "";
  } catch {
    return "";
  }
};

function handleJingle(req, res) {
  let raw = "";
  req.on("data", (c) => {
    raw += c;
    if (raw.length > 20000) req.destroy();
  });
  req.on("end", () => {
    let job;
    try {
      job = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "bad json" }));
    }
    const callbackOk = /^https:\/\/porchbook\.vercel\.app\/api\/jingle-worker$/.test(job?.callback || "") || /^https:\/\/[a-z0-9.-]+\/api\/jingle-worker$/.test(job?.callback || "");
    const ok =
      job &&
      typeof job.jobToken === "string" &&
      job.jobToken.length >= 20 &&
      Number.isInteger(job.draftId) &&
      storeHost(hostOf(job.voiceUrl)) &&
      storeHost(hostOf(job.bedUrl)) &&
      /\.r2\.cloudflarestorage\.com$/i.test(hostOf(job.putUrl)) &&
      callbackOk;
    if (!ok) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "not a Porchbook job" }));
    }
    queue.push(job);
    void next();
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, queued: queue.length }));
  });
}

module.exports = { handleJingle, _test: { filterFor } };
