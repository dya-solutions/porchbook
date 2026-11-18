import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { ensureDbReady } from "@/lib/db";

/**
 * The notebook's transcriber for Luganda and Runyankole: one spoken sentence
 * comes in, Sunbird AI (sunbird.ai) writes it out.
 * Uses SUNBIRD_API_KEY; if that has expired, signs in again with
 * SUNBIRD_EMAIL / SUNBIRD_PASSWORD and keeps the fresh key while the server is up.
 */
const BASE = "https://api.sunbird.ai";
const LANGS = new Set(["lug", "nyn", "eng"]);
const MAX = 8 * 1024 * 1024;

let fresh = "";

async function signIn(): Promise<string> {
  const username = process.env.SUNBIRD_EMAIL;
  const password = process.env.SUNBIRD_PASSWORD;
  if (!username || !password) return "";
  try {
    const res = await fetch(`${BASE}/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password }),
    });
    if (!res.ok) return "";
    const body = (await res.json()) as { access_token?: string };
    fresh = body.access_token ?? "";
    return fresh;
  } catch {
    return "";
  }
}

async function send(key: string, audio: Blob, name: string, language: string) {
  const form = new FormData();
  form.append("audio", audio, name);
  form.append("language", language);
  return fetch(`${BASE}/tasks/audio/transcriptions`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form });
}

export const Route = createFileRoute("/api/hear")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        await ensureDbReady();
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) return Response.json({ error: "Sign in first." }, { status: 401 });
        let key = fresh || process.env.SUNBIRD_API_KEY || "";
        if (!key) key = await signIn();
        if (!key) return Response.json({ error: "This language isn't set up yet." }, { status: 503 });

        const form = await request.formData().catch(() => null);
        const audio = form?.get("audio");
        const language = String(form?.get("language") ?? "");
        if (!(audio instanceof Blob) || !audio.size) return Response.json({ error: "No sound." }, { status: 400 });
        if (audio.size > MAX) return Response.json({ error: "Too long." }, { status: 413 });
        if (!LANGS.has(language)) return Response.json({ error: "Pick a language." }, { status: 400 });
        const name = audio.type.includes("mp4") ? "said.m4a" : audio.type.includes("ogg") ? "said.ogg" : "said.webm";

        try {
          let res = await send(key, audio, name, language);
          if (res.status === 401 || res.status === 403) {
            const again = await signIn();
            if (again) res = await send(again, audio, name, language);
          }
          if (!res.ok) return Response.json({ error: "The transcriber didn't answer. Try again." }, { status: 502 });
          const body = (await res.json()) as { audio_transcription?: string };
          return Response.json({ text: (body.audio_transcription ?? "").trim() });
        } catch {
          return Response.json({ error: "The transcriber didn't answer. Try again." }, { status: 502 });
        }
      },
    },
  },
});
