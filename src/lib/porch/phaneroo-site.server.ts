/**
 * Reading phaneroo.org from the server. The site sits behind a Sucuri
 * challenge; this answers it (the cookie is kept between requests).
 */
let siteCookie = "";

function sucuriCookie(html: string) {
  const packed = /S\s*=\s*'([^']+)'/.exec(html);
  if (!packed || !/sucuri_cloudproxy/i.test(html)) return "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const map: Record<string, number> = {};
  for (let index = 0; index < 64; index++) map[alphabet.charAt(index)] = index;
  let buffer = 0;
  let bits = 0;
  let script = "";
  const source = packed[1];
  for (let index = 0; index < source.length; index++) {
    const code = map[source.charAt(index)];
    if (code === undefined) {
      buffer = buffer << 6;
    } else {
      buffer = (buffer << 6) + code;
    }
    bits += 6;
    while (bits >= 8) {
      const byte = (buffer >>> (bits -= 8)) & 0xff;
      if (byte || index < source.length - 2) script += String.fromCharCode(byte);
    }
  }
  if (!/document\.cookie/.test(script) || script.length > 8000) return "";
  const document = { cookie: "" };
  try {
    new Function("document", "location", script)(document, { reload() {} });
  } catch {
    return "";
  }
  const cookie = document.cookie.split(";")[0] ?? "";
  return /^sucuri_cloudproxy_uuid_[^=]+=/.test(cookie) ? cookie : "";
}

export async function readSite(target: string | URL, accept: string) {
  const headers: Record<string, string> = { accept, "user-agent": "Mozilla/5.0" };
  if (siteCookie) headers.cookie = siteCookie;
  let response = await fetch(target, { redirect: "manual", headers });
  const type = response.headers.get("content-type") ?? "";
  const challenge = response.status === 307 || /sucuri_cloudproxy/i.test(response.headers.get("x-sucuri-cache") ?? "");
  if (!challenge && !type.includes("text/html") && !type.includes("json") && !type.includes("text/plain") && type) return response;
  const body = await response.text();
  const cookie = sucuriCookie(body);
  if (!cookie) return new Response(body, { status: response.status, headers: { "content-type": type || "text/html" } });
  siteCookie = cookie;
  response = await fetch(target, { redirect: "follow", headers: { ...headers, cookie } });
  return response;
}


/** The newest Phaneroo devotion's page address, or "" if the site can't be reached. */
export async function newestDevotionLink(): Promise<string> {
  try {
    const response = await readSite("https://phaneroo.org/wp-json/wp/v2/posts?per_page=1&categories=1665&_fields=link,date", "application/json");
    if (!response.ok) return "";
    const rows = (await response.json()) as { link?: string }[];
    const link = Array.isArray(rows) ? rows[0]?.link ?? "" : "";
    return /^https:\/\/(www\.)?phaneroo\.org\//i.test(link) ? link : "";
  } catch {
    return "";
  }
}
