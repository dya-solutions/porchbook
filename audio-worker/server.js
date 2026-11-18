// Porchbook Audio: the radio's own sound server (mastering, measuring, and taking the
// sound out of video uploads). It runs apart from the calls server, so heavy sound
// work never slows a call down.
const http = require("http");
const { handleFmProcess, fmStatus } = require("./audio-worker");
const { handleTranscribe, handleCut, nuggetStatus } = require("./nugget-worker");
const { handleSplit, handleMove } = require("./bible-worker");
const { handleJingle } = require("./jingle-worker");

const PORT = process.env.PORT || 8080;

http
  .createServer((req, res) => {
    if (req.method === "POST" && req.url.startsWith("/fm/process")) return handleFmProcess(req, res);
    if (req.method === "POST" && req.url.startsWith("/nugget/transcribe")) return handleTranscribe(req, res);
    if (req.method === "POST" && req.url.startsWith("/nugget/cut")) return handleCut(req, res);
    if (req.method === "POST" && req.url.startsWith("/bible/split")) return handleSplit(req, res);
    if (req.method === "POST" && req.url.startsWith("/bible/move")) return handleMove(req, res);
    if (req.method === "POST" && req.url.startsWith("/jingle/mix")) return handleJingle(req, res);
    if (req.url.startsWith("/nugget/status")) {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify(nuggetStatus()));
    }
    if (req.url.startsWith("/fm/status")) {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify(fmStatus()));
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Porchbook Audio is running.");
  })
  .listen(PORT, () => console.log(`Porchbook Audio on :${PORT}`));
