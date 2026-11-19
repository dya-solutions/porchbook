import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { canRunStudio, readBreaks, readStation } from "@/lib/porch/fm";
import { onAirAt } from "@/lib/porch/fm-schedule";
import { PRICE_IN, PRICE_OUT, TAX } from "@/lib/porch/porch-guy";
import { cleanMix, describeMix, type MixSettings } from "@/lib/porch/fm-mix-settings";

/**
 * The Control Room: the founder tells the radio what to do in plain words.
 * The AI turns it into a short plan of studio actions; nothing happens until "Do it",
 * and then each action goes through the studio's own (permission-checked) functions.
 */

export type RadioAction =
  | { type: "play_now"; trackId: number; requestId?: number; withMessage?: boolean }
  | { type: "request_missing"; requestId: number }
  | { type: "play_next"; trackId: number }
  | { type: "skip" }
  | { type: "stop_break"; breakId: number }
  | { type: "strings"; trackIds: number[]; on: boolean }
  | { type: "set_kind"; trackIds: number[]; kind: string }
  | { type: "live_on"; link: string }
  | { type: "live_off" }
  | { type: "programme"; name: string; days: number[]; startMin: number; endMin: number; trackIds: number[]; shuffle: boolean }
  | { type: "mixer_settings"; settings: MixSettings; remaster: boolean }
  | { type: "measure"; trackIds: number[] | "all" }
  | { type: "master"; trackIds: number[] | "all" }
  | { type: "undo_master"; trackIds: number[] | "all" }
  | { type: "auto_master"; on: boolean };

const KINDS = ["music", "preaching", "news", "reading", "other", "jingle", "station", "newsintro"];

function clean(raw: unknown, trackIds: Set<number>, breakIds: Set<number>, requestIds: Set<number>, mix: MixSettings): RadioAction | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => trackIds.has(n)))].slice(0, 200) : []);
  const one = (v: unknown) => (trackIds.has(Number(v)) ? Number(v) : 0);
  switch (r.type) {
    case "play_now": {
      const trackId = one(r.trackId);
      const requestId = requestIds.has(Number(r.requestId)) ? Number(r.requestId) : 0;
      return trackId ? { type: "play_now", trackId, ...(requestId ? { requestId, withMessage: r.withMessage !== false } : {}) } : null;
    }
    case "play_next": {
      const trackId = one(r.trackId);
      return trackId ? { type: "play_next", trackId } : null;
    }
    case "request_missing": {
      const requestId = Number(r.requestId);
      return requestIds.has(requestId) ? { type: "request_missing", requestId } : null;
    }
    case "skip":
      return { type: "skip" };
    case "stop_break": {
      const breakId = Number(r.breakId);
      return breakIds.has(breakId) ? { type: "stop_break", breakId } : null;
    }
    case "strings": {
      const list = ids(r.trackIds);
      return list.length ? { type: "strings", trackIds: list, on: r.on !== false } : null;
    }
    case "set_kind": {
      const list = ids(r.trackIds);
      return list.length && KINDS.includes(String(r.kind)) ? { type: "set_kind", trackIds: list, kind: String(r.kind) } : null;
    }
    case "live_on": {
      const link = String(r.link ?? "").trim();
      return /youtu\.?be/.test(link) ? { type: "live_on", link: link.slice(0, 300) } : null;
    }
    case "live_off":
      return { type: "live_off" };
    case "programme": {
      const days = Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter((d) => d >= 0 && d <= 6))] : [];
      const startMin = Number(r.startMin);
      const endMin = Number(r.endMin);
      const list = ids(r.trackIds);
      const name = String(r.name ?? "").trim().slice(0, 60);
      const okMin = (m: number) => Number.isInteger(m) && m >= 0 && m < 1440;
      if (!name || !days.length || !okMin(startMin) || !okMin(endMin) || startMin === endMin || !list.length) return null;
      return { type: "programme", name, days, startMin, endMin, trackIds: list, shuffle: r.shuffle === true };
    }
    case "mixer_settings":
      return { type: "mixer_settings", settings: cleanMix(r.settings, mix), remaster: r.remaster === true };
    case "measure":
    case "master":
    case "undo_master": {
      const list = r.trackIds === "all" || r.all === true ? ("all" as const) : ids(r.trackIds);
      return list === "all" || list.length ? { type: r.type, trackIds: list } : null;
    }
    case "auto_master":
      return { type: "auto_master", on: r.on !== false };
    default:
      return null;
  }
}

const SYSTEM = `You are the studio assistant of Porchbook Radio, a church internet radio (Kampala, Uganda) run by an admin. He talks to you in plain words.
Answer with ONLY a JSON object, starting with "{" and nothing outside it:
{"reply": "<short friendly answer>", "plan": ["<one short line per action, plain words, titles in quotes>"], "actions": [ ... ]}
If he only asks a question (what's playing, how many requests, when is the next programme…), answer it in "reply" from the facts below and give no actions.

HOW PORCHBOOK RADIO WORKS
- One shared station: every listener hears the same item at the same moment (the timeline is worked out from the clock).
- Outside programmes it plays the whole library in rotation. Programmes are time slots (days + start/end, Kampala time) that play their own chosen items, in order or shuffled.
- Item types: music (songs), preaching (sermons), reading, news, other, jingle, station (station ID), newsintro (plays right before every news item).
- Songs of a minute or more fade 30 seconds before their end and a jingle plays after every song; after every 3rd song the station ID follows the jingle. Sermons, readings and other long items play in full, then the station ID. Items under a minute play in full with nothing after.
- "Play now" cuts an item in for everyone about 15 seconds after it's asked, then the station carries on with the next item as if nothing broke in. It can be cancelled while waiting or playing (stop_break).
- Skip / Next: what's on fades out in a few seconds and the next item plays, for everyone.
- Requests: listeners ask for a song or sermon, sometimes with a dedication (from, to, message). The studio plays them with Play now (tie the requestId so the requester and the person it's dedicated to are told) or marks "can't find it". withMessage false plays it without reading the dedication on screen.
- Strings: the devotional's soft strings track can play under chosen sermons/readings for every listener (not on iPhones).
- Live: a YouTube live link shows on everyone's porch guy screen and the radio; live_off stops it.
- The devotional is read aloud by a voice (Mike G) and listeners play it from the radio's 📖 key; you can't remake it from here.
- THE MIXER (mastering): an audio worker makes every item sound studio quality at the same loudness. It measures each item (loudness in LUFS, true peak, hiss level), then masters it to the mixer settings: voice items (preaching, reading, news) get a low cut, mud cut, voice EQ, compressor and hiss clean-up; songs and the rest get a gentle music EQ and, at medium or strong compression, light compression; everything is levelled to the loudness target and peak-limited. It runs in the background: a mastered copy only goes in while that item is off air, so listeners are never interrupted. The original is always kept, so mastering can be undone. "Auto-master uploads" masters every new upload. Mastering an hour-long sermon takes several minutes on the free server.
- Mixer settings: lufs (loudness target, -24 to -10; -16 is broadcast standard, -14 louder, -18 softer), peak (true-peak limit, -3 to -0.5 dB; -1.5 standard), warmth (-3 thinner … +3 warmer, more body), clarity (-3 softer … +3 brighter, words more forward), comp (compression 0 off, 1 gentle, 2 medium, 3 strong: evens out loud and quiet parts), hiss (clean-up 0 off, 1 light, 2 medium, 3 strong; strong can make voices sound watery).
- Loudness facts: a good spread is items within about 1 LU of the target. Hiss (noise floor) above about -50 dB is audible; below -60 is clean. True peak above -1 dB can distort on phones.
- Measuring changes nothing; it just reads the numbers (useful before deciding). Mastering an already-mastered item starts again from the original.
- The admin can hear a 20-second before/after sample from the plan card before tapping Do it, so you don't need an action for that.
- You cannot delete items, upload files, edit or remove existing programmes, change volumes, or change who runs the studio. If asked, say so kindly and say where: Radio → Studio.

ACTIONS (use only ids from the facts below; never invent ids):
- {"type":"play_now","trackId":N}  or with a request: {"type":"play_now","trackId":N,"requestId":R,"withMessage":true|false}
- {"type":"play_next","trackId":N}  plays as soon as the current item ends
- {"type":"skip"}
- {"type":"stop_break","breakId":N}
- {"type":"request_missing","requestId":R}  tells the listener it couldn't be found
- {"type":"strings","trackIds":[..],"on":true|false}
- {"type":"set_kind","trackIds":[..],"kind":"music|preaching|news|reading|other|jingle|station|newsintro"}
- {"type":"live_on","link":"<YouTube link>"} / {"type":"live_off"}
- {"type":"programme","name":"..","days":[0-6, 0=Sunday],"startMin":minutes after midnight Kampala time,"endMin":..,"trackIds":[..],"shuffle":true|false}  a NEW programme
- {"type":"mixer_settings","settings":{only the settings that change},"remaster":true|false}  save new mixer settings; remaster true re-masters the whole library to them
- {"type":"measure","trackIds":[..] or "all"}
- {"type":"master","trackIds":[..] or "all"}  masters to the saved settings (put a mixer_settings action first if he wants different settings)
- {"type":"undo_master","trackIds":[..] or "all"}  puts the original sound back
- {"type":"auto_master","on":true|false}

RULES
- Match titles loosely (spelling mistakes, partial names, "the Grace sermon on rest").
- "A jingle" / "a station ID" / "a song" / "a sermon" means pick one of that type yourself (vary it).
- After play_now the radio returns to what was playing by itself, so "and come back" needs no extra action.
- Several actions are fine (do them in order). If something is unclear, missing, or two items match equally, ask in "reply" and give no actions.
- For mixer requests, put the numbers in the plan in plain words, e.g. "Sunday Service: -24 → -16 LUFS, medium compression, light hiss clean-up". If items haven't been measured, say so and master anyway (it measures as it goes) unless he only asked for numbers.
- Keep "reply" to one or two sentences.`;

export const planRadio = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const before = Array.isArray(raw.before) ? raw.before : [];
    return {
      text: String(raw.text ?? "").trim().slice(0, 600),
      before: before
        .slice(-6)
        .map((t) => (t && typeof t === "object" ? (t as Record<string, unknown>) : {}))
        .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.text === "string")
        .map((t) => ({ role: t.role as "user" | "assistant", text: String(t.text).slice(0, 800) })),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, error: "Only the studio can run the radio." };
    if (!data.text) return { ok: false as const, error: "Tell the radio what you want." };
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return { ok: false as const, error: "The radio's AI isn't connected yet." };
    const station = { ...(await readStation(sql)), breaks: await readBreaks(sql) };
    // Nuggets and Bible readings can be played and named too.
    const extras = station.nuggets ?? [];
    const trackIds = new Set([...station.tracks, ...extras].map((t) => t.id));
    const titleOf = new Map([...station.tracks, ...extras].map((t) => [t.id, `${t.kind === "bible" ? "Bible reading: " : t.kind === "nugget" ? "Nugget: " : ""}${t.title}`]));
    const breakIds = new Set((station.breaks ?? []).map((b) => b.id));
    // Live facts: on air now, waiting requests, listeners, live video, strings.
    const nowMs = Date.now();
    const onAir = onAirAt([...station.tracks, ...(station.nuggets ?? [])], station.programmes, nowMs, station.breaks);
    const waiting = await sql
      .query<{ id: number; kind: string; title: string; by: string; message: string; from_name: string; to_name: string; who: string | null; created_at: string }>(
        `select r.id, r.kind, r.title, r.by, r.message, r.from_name, r.to_name, p.display_name as who, to_char(r.created_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI"Z"') as created_at
           from fm_requests r left join profiles p on p.user_id = r.user_id where r.status = 'waiting' order by r.created_at asc limit 40`,
      )
      .catch(() => []);
    const requestIds = new Set(waiting.map((r) => Number(r.id)));
    const listening = await sql.query<{ n: number }>("select count(*)::int as n from fm_live where seen_at > now() - interval '150 seconds'").catch(() => []);
    const liveRows = await sql.query<{ value: string }>("select video_id as value from fm_live_video where id = 1").catch(() => []);
    const bed = await sql.query<{ bed_url: string }>("select bed_url from devotion_voice_settings where id = 1").catch(() => []);
    const { readMixer, workerState } = await import("@/lib/porch/fm-mixer.server");
    const mixer = await readMixer(sql);
    const worker = await workerState();
    const loudRows = await sql
      .query<{ id: number; loud_before: unknown; loud_after: unknown; original_url: string | null; pending_url: string | null; mix_token: string | null; mix_job: string | null; mix_error: string | null }>(
        "select id, loud_before, loud_after, original_url, pending_url, mix_token, mix_job, mix_error from fm_tracks",
      )
      .catch(() => []);
    const loudOf = new Map(loudRows.map((r) => [Number(r.id), r]));
    const parse = (v: unknown) => {
      const o = (typeof v === "string" ? JSON.parse(v) : v) as { i?: number | null; tp?: number | null; noise?: number | null } | null;
      return o && o.i !== null && o.i !== undefined ? o : null;
    };
    const loudLine = (id: number) => {
      const r = loudOf.get(id);
      if (!r) return "not measured";
      const b = parse(r.loud_before);
      const a = parse(r.loud_after);
      const mastered = Boolean(r.original_url) && r.pending_url !== r.original_url;
      const parts = [b ? `${b.i} LUFS, peak ${b.tp}, hiss ${b.noise ?? "?"} dB` : "not measured"];
      if (mastered && a) parts.push(`mastered → ${a.i} LUFS, peak ${a.tp}`);
      if (r.mix_token) parts.push(`${r.mix_job === "measure" ? "measuring" : "mastering"} now`);
      if (r.mix_error) parts.push(`last job failed: ${r.mix_error.slice(0, 60)}`);
      return parts.join("; ");
    };
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const list = [
      "TRACKS (id · title · type · minutes · strings · sound):",
      ...station.tracks.map((t) => `${t.id} · ${t.title} · ${t.kind} · ${Math.round(t.durationSec / 60)} · ${t.strings ? "strings on" : "-"} · ${loudLine(t.id)}`),
      `MIXER SETTINGS: ${JSON.stringify(mixer.settings)} (${describeMix(mixer.settings)}); auto-master uploads ${mixer.auto ? "on" : "off"}`,
      `AUDIO WORKER: ${worker.state === "ready" ? "ready" : worker.state === "old" ? "needs updating (mixer jobs can't run until then; say so)" : "asleep or not set up yet (a sleeping one wakes in about a minute when a job is sent; if jobs never start, Porchbook Audio needs setting up on Render)"}`,
      "PROGRAMMES:",
      ...station.programmes.map((p) => `${p.id} · ${p.name} · ${p.days.map((d) => days[d]).join(",")} · ${Math.floor(p.startMin / 60)}:${String(p.startMin % 60).padStart(2, "0")}-${Math.floor(p.endMin / 60)}:${String(p.endMin % 60).padStart(2, "0")}`),
      "NUGGETS AND BIBLE READINGS (id · title · type · minutes). Nuggets are short clips of speakers; Bible readings are ~3-minute pieces of the Bible played in order between items when on. They can be played now or next like tracks:",
      ...(extras.length ? extras.map((t) => `${t.id} · ${t.title} · ${t.kind === "bible" ? "Bible reading" : "nugget"} · ${Math.round(t.durationSec / 60)}`) : ["none"]),
      "PLAY-NOW BREAKS (id · what · track id · starts). Bible readings are planned ahead this way; stopping one skips that reading:",
      ...(station.breaks ?? []).map((b) => `${b.id} · ${titleOf.get(b.trackId) ?? "audio"} · ${b.trackId} · ${new Date(b.startsAtMs).toISOString()}`),
      `NOW: ${new Date(nowMs).toISOString()} (Kampala is UTC+3)`,
      onAir
        ? `ON AIR: "${onAir.track.title}" (id ${onAir.track.id}, ${onAir.track.kind}) in ${onAir.programme}, ${Math.max(0, Math.round((onAir.endsAtMs - nowMs) / 1000))} s left${onAir.breakId ? `, a Play-now (break ${onAir.breakId})` : ""}`
        : "ON AIR: nothing",
      `LISTENING NOW: ${Number(listening[0]?.n ?? 0)}`,
      `STRINGS TRACK: ${bed[0]?.bed_url ? "uploaded" : "none uploaded yet (strings won't play until one is uploaded in the Devotional voice box)"}`,
      `LIVE VIDEO: ${liveRows[0]?.value ? "showing" : "off"}`,
      "WAITING REQUESTS (id · song/sermon · title · by · from → to · message · asked):",
      ...(waiting.length
        ? waiting.map((r) => `${r.id} · ${r.kind} · ${r.title} · ${r.by || "-"} · ${r.from_name || r.who || "a listener"} → ${r.to_name || "-"} · ${r.message ? `"${r.message.slice(0, 120)}"` : "-"} · ${r.created_at}`)
        : ["none"]),
    ].join("\n");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          model: process.env.PORCH_GUY_MODEL || "claude-haiku-5-5",
          max_tokens: 2500,
          system: `${SYSTEM}\n\n${list}`,
          messages: [...data.before.map((t) => ({ role: t.role, content: t.text })), { role: "user", content: data.text }],
        }),
      });
      if (!res.ok) {
        const why = await res.text().catch(() => "");
        return { ok: false as const, error: `The radio couldn't think just now (${res.status}). ${why.slice(0, 160)}` };
      }
      const body = (await res.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
      const input = Number(body.usage?.input_tokens ?? 0);
      const output = Number(body.usage?.output_tokens ?? 0);
      void sql
        .query("insert into porch_guy_usage (input_tokens, output_tokens, cost_usd) values ($1, $2, $3)", [input, output, ((input * PRICE_IN + output * PRICE_OUT) / 1_000_000) * TAX])
        .catch(() => undefined);
      const raw = (body.content ?? []).filter((p) => p.type === "text").map((p) => p.text ?? "").join("").replace(/```(?:json)?/gi, "");
      if (!raw.trim()) return { ok: false as const, error: `The radio didn't answer (${body.stop_reason ?? "no reason given"}). Try again.` };
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      const json = first >= 0 && last > first ? raw.slice(first, last + 1) : "{}";
      let parsed: { reply?: unknown; plan?: unknown; actions?: unknown } = {};
      try {
        parsed = JSON.parse(json);
      } catch {
        parsed = { reply: raw.replace(/[{}"]/g, " ").slice(0, 300) };
      }
      const actions = (Array.isArray(parsed.actions) ? parsed.actions : []).map((a) => clean(a, trackIds, breakIds, requestIds, mixer.settings)).filter((a): a is RadioAction => Boolean(a)).slice(0, 12);
      const plan = Array.isArray(parsed.plan) ? parsed.plan.map((l) => String(l).slice(0, 160)).slice(0, 12) : [];
      return { ok: true as const, reply: String(parsed.reply ?? "").slice(0, 400) || (actions.length ? "Here's my plan:" : `I couldn't turn that into steps. Try saying it another way${body.stop_reason === "max_tokens" ? " (my answer was cut short)" : ""}.`), plan: actions.length ? plan : [], actions };
    } catch {
      return { ok: false as const, error: "The radio couldn't think just now. Try again." };
    }
  });
