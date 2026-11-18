// Saving a finished file: Porchbook answers "token" with either a signed Cloudflare link (putUrl)
// or a Vercel Blob pass (clientToken). Either way the file's public link comes back.
const fs = require("fs");

async function saveFile(spot, file) {
  if (spot && spot.putUrl) {
    const res = await fetch(spot.putUrl, { method: "PUT", headers: { "content-type": "audio/mpeg" }, body: fs.readFileSync(file) });
    if (!res.ok) throw new Error(`storage refused the file (${res.status})`);
    return spot.url;
  }
  if (!spot || !spot.clientToken) throw new Error((spot && spot.error) || "no place to save the file");
  const { put } = await import("@vercel/blob/client");
  const stored = await put(spot.pathname, fs.createReadStream(file), {
    access: "public",
    token: spot.clientToken,
    contentType: "audio/mpeg",
    multipart: fs.statSync(file).size > 8 * 1024 * 1024,
  });
  return stored.url;
}

// Porchbook's own stored files (Vercel Blob or the Cloudflare bucket).
const storeHost = (hostname) => /\.public\.blob\.vercel-storage\.com$/i.test(hostname) || /^pub-[a-z0-9]+\.r2\.dev$/i.test(hostname);

module.exports = { saveFile, storeHost };
