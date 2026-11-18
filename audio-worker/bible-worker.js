// Porchbook Radio Bible readings: a book's audio cut into ~3-minute pieces (ending at pauses).
//
//   POST /bible/split {jobToken, bookId, audioUrl, chapters, cuts?}
//
// Without `cuts`, the chapters are found by the pauses between them: the book's
// (chapters - 1) longest silences. Each chapter is evened out like the rest of the
// Radio, uploaded, and reported to Porchbook (/api/bible-worker), which checks the jobToken.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const PORCHBOOK = (process.env.PORCHBOOK_URL || "https://porchbook.vercel.app").replace(/\/+$/, "");
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
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let log = "";
    child.stderr.on("data", (c) => {
      log += c.toString();
      if (log.length > 4000000) log = log.slice(-2000000);
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
async function tell(body) {
  const res = await fetch(`${PORCHBOOK}/api/bible-worker`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Porchbook answered ${res.status}`);
  return data;
}

/** The book's length and its pauses (silences of 0.6 s or more). */
async function pauses(file) {
  const log = await run(["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "silencedetect=noise=-38dB:d=0.6", "-f", "null", "-"]);
  const total = lastTime(log);
  const out = [];
  let start = null;
  for (const line of log.split("\n")) {
    const s = /silence_start: (-?[\d.]+)/.exec(line);
    if (s) start = Number(s[1]);
    const e = /silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/.exec(line);
    if (e && start !== null) {
      out.push({ start, end: Number(e[1]), len: Number(e[2]) });
      start = null;
    }
  }
  return { total, silences: out };
}

/** Pieces of about `target` seconds: each ends at the pause nearest the mark (never mid-verse). */
function pieceStarts(silences, total, target) {
  const starts = [];
  let at = 0;
  while (total - at > target * 1.4) {
    const mark = at + target;
    const reach = Math.min(50, target * 0.2); // look this far either side of the mark for a pause
    const near = silences
      .filter((s) => s.len >= 0.35 && s.start > mark - reach && s.start < mark + reach)
      .sort((a, b) => Math.abs(a.start - mark) - Math.abs(b.start - mark) || b.len - a.len)[0];
    const cut = near ? near.start + Math.min(near.len, 1.2) * 0.6 : mark;
    starts.push(cut);
    at = cut;
  }
  return starts;
}

/** Where chapters 2..N begin: the longest pauses, spread through the book. */
function chapterStarts(silences, chapters, total) {
  const want = chapters - 1;
  if (want <= 0) return [];
  const minGap = Math.max(15, Math.min(60, (total / chapters) * 0.25));
  const picked = [];
  for (const s of [...silences].sort((a, b) => b.len - a.len)) {
    const at = s.start + Math.min(s.len, 1.5) * 0.6; // inside the pause, a moment before the next voice
    if (at < minGap || at > total - minGap) continue;
    if (picked.some((p) => Math.abs(p - at) < minGap)) continue;
    picked.push(at);
    if (picked.length === want) break;
  }
  return picked.sort((a, b) => a - b);
}

async function split(job, dir) {
  const input = path.join(dir, "book");
  const res = await fetch(job.audioUrl);
  if (!res.ok || !res.body) throw new Error(`couldn't download the book (${res.status})`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(input));
  const { total, silences } = await pauses(input);
  if (total < 10) throw new Error("the file has no sound");
  const starts = job.pieceSec
    ? pieceStarts(silences, total, job.pieceSec)
    : Array.isArray(job.cuts) && job.cuts.length
      ? job.cuts.filter((c) => c > 0 && c < total).sort((a, b) => a - b)
      : chapterStarts(silences, job.chapters, total);
  const bounds = [0, ...starts, total];
  const chapters = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const from = bounds[i];
    const len = bounds[i + 1] - from;
    const out = path.join(dir, `ch${i + 1}.mp3`);
    const log = await run([
      "-hide_banner", "-y", "-ss", String(from), "-t", String(len), "-i", input, "-vn",
      "-af", `loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=0.5,afade=t=out:st=${Math.max(0, len - 0.6).toFixed(2)}:d=0.6`, "-ar", "22050", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "40k", out,
    ]);
    const durationSec = lastTime(log) || len;
    const stored = { url: await require("./store").saveFile(await tell({ action: "token", jobToken: job.jobToken, bookId: job.bookId, chapter: i + 1 }), out) };
    chapters.push({ chapter: i + 1, url: stored.url, startSec: from, endSec: from + len, durationSec });
    fs.rmSync(out, { force: true });
  }
  await tell({ action: "done", jobToken: job.jobToken, bookId: job.bookId, chapters, totalSec: total });
  return `${chapters.length} chapters`;
}

/**
 * Move where a reading starts: the reading before it and this one are joined, cut again at the new
 * place (earlier or later by `deltaSec`), and both are saved with soft starts and ends. No words are lost.
 */
async function move(job, dir) {
  const a = path.join(dir, "a.mp3");
  const b = path.join(dir, "b.mp3");
  for (const [url, file] of [[job.prevUrl, a], [job.curUrl, b]]) {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`couldn't download a reading (${res.status})`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
  }
  const joined = path.join(dir, "joined.wav");
  const log = await run(["-hide_banner", "-y", "-i", a, "-i", b, "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1[out]", "-map", "[out]", "-ac", "1", "-ar", "22050", joined]);
  const total = lastTime(log);
  const firstLen = Number(job.prevLen) || 0;
  const cut = Math.max(10, Math.min(total - 10, firstLen + Number(job.deltaSec)));
  const out = [];
  for (const [from, len, piece] of [[0, cut, job.prevPiece], [cut, total - cut, job.curPiece]]) {
    const file = path.join(dir, `p${piece}.mp3`);
    const done = await run([
      "-hide_banner", "-y", "-ss", String(from), "-t", String(len), "-i", joined, "-vn",
      "-af", `afade=t=in:d=0.5,afade=t=out:st=${Math.max(0, len - 0.6).toFixed(2)}:d=0.6`, "-ar", "22050", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "40k", file,
    ]);
    const stored = { url: await require("./store").saveFile(await tell({ action: "token", jobToken: job.jobToken, bookId: job.bookId, chapter: piece }), file) };
    out.push({ chapter: piece, url: stored.url, durationSec: lastTime(done) || len, offsetSec: from });
  }
  await tell({ action: "moved", jobToken: job.jobToken, bookId: job.bookId, pieces: out });
  return `reading ${job.curPiece} now starts ${Number(job.deltaSec) > 0 ? "later" : "earlier"} by ${Math.abs(Number(job.deltaSec))}s`;
}

async function drain() {
  if (running) return;
  running = true;
  const self = process.env.RENDER_EXTERNAL_URL;
  const awake = self ? setInterval(() => void fetch(self).catch(() => undefined), 4 * 60 * 1000) : null;
  try {
    while (queue.length) {
      const job = queue.shift();
      current = `book ${job.bookId}`;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bib-"));
      try {
        console.log(`[bible] ${current}: ${await (job.kind === "move" ? move(job, dir) : split(job, dir))}`);
      } catch (error) {
        console.error(`[bible] ${current} failed:`, error.message);
        await tell({ action: "failed", jobToken: job.jobToken, bookId: job.bookId, error: String(error.message).slice(0, 300) }).catch(() => undefined);
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

function handleSplit(req, res) {
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
    let host = "";
    try {
      const u = new URL(job.audioUrl);
      host = u.protocol === "https:" ? u.hostname : "";
    } catch {
      /* not a link */
    }
    const ok =
      job && typeof job.jobToken === "string" && job.jobToken.length >= 20 && Number.isInteger(job.bookId) && Number.isInteger(job.chapters) && job.chapters >= 1 && job.chapters <= 150 && require("./store").storeHost(host);
    if (!ok) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "not a Porchbook job" }));
    }
    const pieceSec = Number(job.pieceSec) >= 60 && Number(job.pieceSec) <= 1800 ? Number(job.pieceSec) : 0;
    const entry = { jobToken: job.jobToken, bookId: job.bookId, audioUrl: job.audioUrl, chapters: job.chapters, pieceSec, cuts: Array.isArray(job.cuts) ? job.cuts.map(Number).filter(Number.isFinite).slice(0, 160) : [] };
    const same = queue.findIndex((q) => q.bookId === entry.bookId);
    if (same >= 0) queue[same] = entry;
    else queue.push(entry);
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ queued: queue.length }));
    void drain();
  });
}

function handleMove(req, res) {
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
    const blob = (u) => {
      try {
        const x = new URL(u);
        return x.protocol === "https:" && require("./store").storeHost(x.hostname);
      } catch {
        return false;
      }
    };
    const ok =
      job && typeof job.jobToken === "string" && job.jobToken.length >= 20 && Number.isInteger(job.bookId) && blob(job.prevUrl) && blob(job.curUrl) &&
      Number.isInteger(job.prevPiece) && Number.isInteger(job.curPiece) && Number.isFinite(Number(job.deltaSec)) && Math.abs(Number(job.deltaSec)) <= 120;
    if (!ok) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "not a Porchbook job" }));
    }
    queue.unshift({ kind: "move", jobToken: job.jobToken, bookId: job.bookId, prevUrl: job.prevUrl, curUrl: job.curUrl, prevPiece: job.prevPiece, curPiece: job.curPiece, prevLen: Number(job.prevLen) || 0, deltaSec: Number(job.deltaSec) });
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ queued: queue.length }));
    void drain();
  });
}

module.exports = { handleSplit, handleMove, bibleStatus: () => ({ working: current, queued: queue.length }), _test: { chapterStarts, pieceStarts, pauses } };
