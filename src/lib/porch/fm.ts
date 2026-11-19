import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { breakLengthSec, isJingle, isStationId, isVideoFile, onAirAt, shiftAfterBreak, type FmBreak, type FmProgramme, type FmTrack, type FmShift } from "@/lib/porch/fm-schedule";

const KINDS = new Set(["music", "preaching", "news", "reading", "other", "jingle", "station", "newsintro"]);

function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

function rec(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

/** The founder and the Head of Communications run the studio. */
export async function canRunStudio(sql: Sql, userId: string): Promise<boolean> {
  const me = await sql.query<{ is_founder: boolean }>("select is_porch_admin($1) as is_founder", [userId]);
  if (boolish(me[0]?.is_founder)) return true;
  const head = await sql.query<{ head_user_id: string | null }>(
    "select head_user_id from offices where key = 'communications'",
  );
  return head[0]?.head_user_id === userId;
}

export async function readStation(sql: Sql, founder = false) {
  // durationSec is how long it plays: a trimmed jingle or station ID stops where its sound ends.
  const trackRows = await sql.query<{
    id: number; title: string; kind: string; url: string; duration_sec: number; play_sec: number | null;
    processed: boolean; processing: boolean; process_error: string | null; strings: unknown;
  }>(
    `select id, title, kind, url, duration_sec, play_sec, strings,
            (processed_at is not null) as processed,
            (processed_at is null and process_token is not null and process_started_at > now() - interval '20 minutes') as processing,
            process_error
       from fm_tracks order by created_at asc, id asc`,
  );
  const progRows = await sql.query<{ id: number; name: string; days: number[]; start_min: number; end_min: number; track_ids: number[]; shuffle: boolean }>(
    "select id, name, days, start_min, end_min, track_ids, shuffle from fm_programmes order by start_min asc, id asc",
  );
  const tracks: FmTrack[] = trackRows.map((r) => ({
    id: Number(r.id),
    title: r.title,
    kind: r.kind,
    url: r.url,
    durationSec: r.play_sec !== null && r.play_sec !== undefined ? Number(r.play_sec) : Number(r.duration_sec),
    trimmed: r.play_sec !== null && r.play_sec !== undefined,
    processed: r.processed === true || String(r.processed) === "t" || String(r.processed) === "true",
    processing: r.processing === true || String(r.processing) === "t" || String(r.processing) === "true",
    processError: r.process_error ?? "",
    strings: boolish(r.strings),
  }));
  const programmes: FmProgramme[] = progRows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    days: (r.days ?? []).map(Number),
    startMin: Number(r.start_min),
    endMin: Number(r.end_min),
    trackIds: (r.track_ids ?? []).map(Number),
    shuffle: boolish(r.shuffle),
  }));
  // Nuggets play between items (live for everyone once switched on; the founder hears them first).
  const { stationNuggets } = await import("@/lib/porch/nuggets.server");
  // ...and the Bible reading chapters on the schedule (they ride along with the nuggets: extra items, not the Studio's list).
  const { stationBible } = await import("@/lib/porch/bible-radio.server");
  const nuggets = [...(await stationNuggets(sql, founder)), ...(await stationBible(sql))];
  return { tracks, programmes, nuggets };
}

export const getFm = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    // Mastered copies go in here, once their item is off air (cheap when nothing waits).
    try {
      const { applyMixes } = await import("@/lib/porch/fm-mixer.server");
      await applyMixes(sql);
    } catch {
      /* the next read tries again */
    }
    const me = await sql.query<{ is_founder: unknown }>("select is_porch_admin($1) as is_founder", [context.userId]);
    // The coming Bible readings are put on the schedule (checked about once a minute).
    const { ensureReadings } = await import("@/lib/porch/bible-radio.server");
    await ensureReadings(sql);
    const station = await readStation(sql, boolish(me[0]?.is_founder));
    // The devotional's strings (an admin's track and level), played under sermons marked for it.
    const bedRows = await sql.query<{ bed_url: string; bed_level: number }>("select bed_url, bed_level from devotion_voice_settings where id = 1").catch(() => []);
    const bed = bedRows[0]?.bed_url ? { url: bedRows[0].bed_url, level: Number(bedRows[0].bed_level) || 0.18 } : null;
    return { ...station, bed, breaks: await readBreaks(sql), studio: await canRunStudio(sql, context.userId), founder: boolish(me[0]?.is_founder), serverNow: Date.now() };
  });

export const saveFmTrack = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    const url = typeof raw.url === "string" ? raw.url.trim() : "";
    return {
      title: typeof raw.title === "string" ? raw.title.trim().slice(0, 120) : "",
      kind: typeof raw.kind === "string" && KINDS.has(raw.kind) ? raw.kind : "",
      url: /^https:\/\/[^\s]+$/i.test(url) || /^\/api\/fm-file\?id=\d+$/.test(url) ? url.slice(0, 600) : "",
      durationSec: typeof raw.durationSec === "number" && Number.isFinite(raw.durationSec) ? raw.durationSec : 0,
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) {
      noteAttempt(context.userId, "fm", "Tried to add to Porchbook Radio.");
      return { ok: false as const, error: "Only the studio can add audio." };
    }
    if (!data.title) return { ok: false as const, error: "Give it a title." };
    if (!data.kind) return { ok: false as const, error: "Choose a type: Music, Preaching, News…" };
    const ours = /^\/api\/fm-file\?id=\d+$/.test(data.url) || (await (await import("@/lib/porch/audio-store.server")).isStoreUrl(sql, data.url));
    if (!data.url || !ours) return { ok: false as const, error: "The upload didn't finish. Try again." };
    if (data.durationSec < 1 || data.durationSec > 6 * 60 * 60) return { ok: false as const, error: "Couldn't read how long that audio is." };
    const added = await keepOnAir(sql, () =>
      sql.query<{ id: number }>(
        "insert into fm_tracks (title, kind, url, duration_sec, uploaded_by) values ($1, $2, $3, $4, $5) returning id",
        [data.title, data.kind, data.url, data.durationSec, context.userId],
      ),
    );
    // Audio goes on air as uploaded (the radio levels it live on each phone).
    // A video upload still needs its sound taken out before it can play on the radio.
    if (/\.(mp4|m4v|mov|webm|mkv|3gp|avi)(\?|$)/i.test(data.url)) {
      try {
        const { requestProcessing } = await import("@/lib/porch/fm-process.server");
        await requestProcessing(sql, Number(added[0].id));
      } catch {
        /* the Studio retries */
      }
    }
    // "Auto-master uploads": new audio is mastered to the mixer's settings in the background.
    else {
      try {
        const { readMixer, requestMix, workerState } = await import("@/lib/porch/fm-mixer.server");
        const mixer = await readMixer(sql);
        if (mixer.auto && (await workerState()).state !== "old") await requestMix(sql, Number(added[0].id), "master", mixer.settings);
      } catch {
        /* it can be mastered from the Control Room */
      }
    }
    return { ok: true as const, ...(await readStation(sql)) };
  });

export const dropFmTrack = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: Number(rec(input).id) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, error: "Only the studio can remove audio." };
    const rows = await keepOnAir(sql, async () => {
      const gone = await sql.query<{ url: string; original_url: string | null; pending_url: string | null }>(
        "delete from fm_tracks where id = $1 returning url, original_url, pending_url",
        [data.id],
      );
      await sql.query("update fm_programmes set track_ids = array_remove(track_ids, $1)", [data.id]);
      return gone;
    });
    // Its original and any mastered copies go too.
    const extra = [rows[0]?.original_url, rows[0]?.pending_url].filter((u): u is string => typeof u === "string" && u !== rows[0]?.url && /^https:/.test(u));
    const { storeDelete } = await import("@/lib/porch/audio-store.server");
    if (extra.length) await storeDelete(sql, [...new Set(extra)]);
    const url = rows[0]?.url ?? "";
    const fallback = url.match(/^\/api\/fm-file\?id=(\d+)$/);
    if (fallback) await sql.query("delete from fm_files where id = $1", [Number(fallback[1])]);
    else if (url) await storeDelete(sql, [url]);
    return { ok: true as const, ...(await readStation(sql)) };
  });

export const saveFmProgramme = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    const mins = (v: unknown) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 0 && n < 24 * 60 ? n : -1;
    };
    const list = (v: unknown, max: number) =>
      Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= max))] : [];
    return {
      id: Number(raw.id) || 0,
      name: typeof raw.name === "string" ? raw.name.trim().slice(0, 60) : "",
      days: list(raw.days, 6),
      startMin: mins(raw.startMin),
      endMin: mins(raw.endMin),
      trackIds: Array.isArray(raw.trackIds) ? raw.trackIds.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200) : [],
      shuffle: raw.shuffle === true,
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, error: "Only the studio can schedule." };
    if (!data.name) return { ok: false as const, error: "Name the programme." };
    if (!data.days.length) return { ok: false as const, error: "Choose at least one day." };
    if (data.startMin < 0 || data.endMin < 0 || data.startMin === data.endMin) return { ok: false as const, error: "Set a start and end time." };
    if (!data.trackIds.length) return { ok: false as const, error: "Choose what it plays." };
    if (data.id) {
      await sql.query(
        "update fm_programmes set name = $2, days = $3, start_min = $4, end_min = $5, track_ids = $6, shuffle = $7 where id = $1",
        [data.id, data.name, data.days, data.startMin, data.endMin, data.trackIds, data.shuffle],
      );
    } else {
      await sql.query(
        "insert into fm_programmes (name, days, start_min, end_min, track_ids, shuffle) values ($1, $2, $3, $4, $5, $6)",
        [data.name, data.days, data.startMin, data.endMin, data.trackIds, data.shuffle],
      );
    }
    return { ok: true as const, ...(await readStation(sql)) };
  });

export const dropFmProgramme = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: Number(rec(input).id) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, error: "Only the studio can change the schedule." };
    await sql.query("delete from fm_programmes where id = $1", [data.id]);
    return { ok: true as const, ...(await readStation(sql)) };
  });

/** A listener's phone checks in about once a minute while the radio plays. */
export const pingFm = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ breakId: Number(rec(input).breakId) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    // Listening while a request plays: counted as "heard it".
    if (data.breakId) {
      await ensureBreakMessage(sql);
      await sql.query("insert into fm_break_heard (break_id, user_id) values ($1, $2) on conflict do nothing", [data.breakId, context.userId]);
    }
    await sql.query(
      "insert into fm_live (user_id, seen_at) values ($1, now()) on conflict (user_id) do update set seen_at = now()",
      [context.userId],
    );
    await noticeRequester(sql, context.userId);
    await tellPlayedRequests(sql);
    await sql.query(
      "insert into fm_listen_hours (user_id, hour_start) values ($1, date_trunc('hour', now())) on conflict do nothing",
      [context.userId],
    );
    return { ok: true as const };
  });

/** Listening now, and the average listeners for each hour of the day (Kampala), for the Studio. */
export const getFmListeners = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, error: "Only the studio can see listeners." };
    const live = await sql.query<{ n: number }>("select count(*)::int as n from fm_live where seen_at > now() - interval '150 seconds'");
    // Average over the days we have data for (at most the last 28).
    const rows = await sql.query<{ group_key: string; hour: number; total: number }>(
      `select case extract(dow from hour_start at time zone 'Africa/Kampala')::int when 0 then 'sun' when 6 then 'sat' else 'week' end as group_key,
              extract(hour from hour_start at time zone 'Africa/Kampala')::int as hour,
              count(*)::int as total
         from fm_listen_hours
        where hour_start > now() - interval '28 days'
        group by 1, 2`,
    );
    const days = await sql.query<{ group_key: string; n: number }>(
      `select case extract(dow from d)::int when 0 then 'sun' when 6 then 'sat' else 'week' end as group_key, count(*)::int as n
         from (select distinct (hour_start at time zone 'Africa/Kampala')::date as d from fm_listen_hours
                where hour_start > now() - interval '28 days') x
        group by 1`,
    );
    const dayCount: Record<string, number> = { all: 0 };
    for (const d of days) {
      dayCount[d.group_key] = Number(d.n);
      dayCount.all += Number(d.n);
    }
    const blank = () => Array.from({ length: 24 }, () => 0);
    const sums: Record<string, number[]> = { all: blank(), week: blank(), sat: blank(), sun: blank() };
    for (const r of rows) {
      sums[r.group_key][Number(r.hour)] += Number(r.total);
      sums.all[Number(r.hour)] += Number(r.total);
    }
    const avg = (key: string) => sums[key].map((t) => (dayCount[key] ? Math.round((t / dayCount[key]) * 10) / 10 : 0));
    return {
      ok: true as const,
      now: Number(live[0]?.n ?? 0),
      daysOfData: dayCount.all,
      hours: { all: avg("all"), week: avg("week"), sat: avg("sat"), sun: avg("sun") },
    };
  });

/** For the founder: a PDF of everyone who has listened, and the whole listening history (by day), since the radio began. */
export const listenersPdf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const me = await sql.query<{ is_founder: unknown }>("select is_porch_admin($1) as is_founder", [context.userId]);
    if (!boolish(me[0]?.is_founder)) return { ok: false as const, error: "Only an admin can take the listeners PDF." };
    const rows = await sql.query<{ user_id: string; who: string | null; day: string; hour: number }>(
      `select h.user_id, p.display_name as who,
              to_char(h.hour_start at time zone 'Africa/Kampala', 'YYYY-MM-DD') as day,
              extract(hour from h.hour_start at time zone 'Africa/Kampala')::int as hour
         from fm_listen_hours h left join profiles p on p.user_id = h.user_id
        order by h.hour_start asc`,
    );
    const { textPdf } = await import("@/lib/porch/pdf-lite");
    const clean = (v: string) => v.replace(/\s+/g, " ").trim();
    const nameOf = (r: { who: string | null }) => clean(r.who ?? "") || "A member";
    const dayLabel = (d: string) =>
      new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;

    // Per person: first and last day, hours listened.
    const people = new Map<string, { name: string; first: string; last: string; hours: number }>();
    for (const r of rows) {
      const p = people.get(r.user_id) ?? { name: nameOf(r), first: r.day, last: r.day, hours: 0 };
      p.hours += 1;
      p.last = r.day;
      people.set(r.user_id, p);
    }
    const today = new Date().toLocaleDateString("en-GB", { timeZone: "Africa/Kampala", day: "numeric", month: "long", year: "numeric" });
    const lines: { text: string; size?: number; gap?: number; x?: number; right?: string; newPage?: boolean }[] = [];
    lines.push({ text: "Porchbook Radio - Listeners", size: 18, gap: 24 });
    lines.push({ text: `Since the radio began, up to ${today}. Kampala time.`, size: 10, gap: 14 });
    lines.push({ text: `${people.size} ${people.size === 1 ? "person has" : "people have"} listened, ${rows.length} listening hours in all.`, size: 10, gap: 14 });
    lines.push({ text: "An hour counts once a person listens at any time within it.", size: 9, gap: 24 });
    lines.push({ text: "EVERYONE WHO HAS LISTENED (most hours first)", size: 12, gap: 18 });
    if (!people.size) lines.push({ text: "Nobody has listened yet.", size: 11 });
    const ranked = [...people.values()].sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
    ranked.forEach((p, i) => {
      lines.push({ text: `${i + 1}. ${p.name}`, size: 11, gap: 13, right: `${p.hours} h` });
      lines.push({ text: `First: ${dayLabel(p.first)}    Last: ${dayLabel(p.last)}`, size: 9, x: 66, gap: 15 });
    });

    // The history, day by day (newest first): who listened, and in which hours.
    lines.push({ text: "LISTENING HISTORY, DAY BY DAY (newest first)", size: 12, gap: 18, newPage: true });
    const byDay = new Map<string, Map<string, { name: string; hours: number[] }>>();
    for (const r of rows) {
      const day = byDay.get(r.day) ?? new Map();
      const who = day.get(r.user_id) ?? { name: nameOf(r), hours: [] };
      who.hours.push(Number(r.hour));
      day.set(r.user_id, who);
      byDay.set(r.day, day);
    }
    for (const day of [...byDay.keys()].sort().reverse()) {
      const list = [...byDay.get(day)!.values()].sort((a, b) => b.hours.length - a.hours.length || a.name.localeCompare(b.name));
      lines.push({ text: `${dayLabel(day)}  -  ${list.length} ${list.length === 1 ? "listener" : "listeners"}`, size: 11, gap: 15 });
      for (const who of list) {
        const hours = [...new Set(who.hours)].sort((a, b) => a - b).map(hourLabel).join(", ");
        const text = `${who.name} (${who.hours.length} h): ${hours}`;
        for (let at = 0; at < text.length; at += 95) lines.push({ text: (at ? "    " : "") + text.slice(at, at + 95), size: 9, x: 60, gap: 12 });
      }
      lines.push({ text: "", size: 6, gap: 8 });
    }
    const stamp = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
    return { ok: true as const, pdf: textPdf(lines), filename: `porchbook-radio-listeners-${stamp}.pdf`, people: people.size };
  });

/** Upcoming and current "Play now" breaks (the last hour), for listeners. */
let breakMessageReady = false;
/** A request's message for the radio screen rides on its "Play now". */
export async function ensureBreakMessage(sql: Sql) {
  if (breakMessageReady) return;
  await sql.query("alter table fm_breaks add column if not exists message text not null default ''");
  await sql.query("alter table fm_breaks add column if not exists hold_from_sec double precision");
  await sql.query("alter table fm_breaks add column if not exists hold_len_sec double precision");
  await sql.query("alter table fm_breaks add column if not exists hold_cut boolean not null default false");
  // Which request a "Play now" plays (for tune-in alerts and "heard it" counts).
  await sql.query("alter table fm_breaks add column if not exists request_id integer");
  await sql.query(`create table if not exists fm_break_heard (
    break_id integer not null,
    user_id text not null,
    primary key (break_id, user_id)
  )`);
  breakMessageReady = true;
}

/**
 * Run a studio change to the list (upload, removal, new type or length) without
 * interrupting anyone: whatever is on air keeps playing to its end, then the
 * new list starts with a fresh item. Done by writing a "hold" break.
 */
export async function keepOnAir<T>(sql: Sql, change: () => Promise<T>): Promise<T> {
  let before: Awaited<ReturnType<typeof readStation>> | null = null;
  let breaks: FmBreak[] = [];
  try {
    await ensureBreakMessage(sql);
    before = await readStation(sql);
    breaks = await readBreaks(sql);
  } catch {
    before = null;
  }
  const result = await change();
  if (!before) return result;
  try {
    const clock = await sql.query<{ ms: string | number }>("select (extract(epoch from now()) * 1000)::bigint as ms");
    const nowMs = Number(clock[0].ms);
    const onAir = onAirAt([...before.tracks, ...before.nuggets], before.programmes, nowMs, breaks);
    // Nothing on, nearly finished, or a studio "Play now" on air: nothing to hold.
    if (!onAir || onAir.breakId || onAir.endsAtMs - nowMs < 1500) return result;
    const after = await readStation(sql);
    if (!after.tracks.some((t) => t.id === onAir.track.id && !isVideoFile(t.url))) return result;
    const shift = shiftAfterBreak([...after.tracks, ...after.nuggets], after.programmes, onAir.endsAtMs, 0, null);
    await sql.query(
      `insert into fm_breaks (track_id, starts_at, created_by, message, hold_from_sec, hold_len_sec, hold_cut, shift_context, shift_ms)
       values ($1, to_timestamp($2::double precision / 1000), null, '', $3, $4, $5, $6, $7)`,
      [onAir.track.id, nowMs, onAir.offsetSec, (onAir.endsAtMs - nowMs) / 1000, Boolean(onAir.cutEarly), shift?.context ?? null, shift?.ms ?? null],
    );
  } catch {
    /* the change is made either way; at worst the radio moves on straight away */
  }
  return result;
}

export async function readBreaks(sql: Sql): Promise<FmBreak[]> {
  try {
    await ensureBreakMessage(sql);
    // The last hour, plus always the latest one (it decides where the list carries on from).
    const rows = await sql.query<{
      id: number;
      track_id: number;
      ms: string | number;
      shift_context: string | null;
      shift_ms: string | number | null;
      message: string | null;
      hold_from_sec: string | number | null;
      hold_len_sec: string | number | null;
      hold_cut: boolean | string | null;
      created_by: string | null;
    }>(
      `select id, track_id, (extract(epoch from starts_at) * 1000)::bigint as ms, shift_context, shift_ms, message, hold_from_sec, hold_len_sec, hold_cut, created_by
         from fm_breaks
        where starts_at > now() - interval '1 hour'
           or id = (select id from fm_breaks where starts_at <= now() order by starts_at desc, id desc limit 1)
        order by starts_at asc, id asc`,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      trackId: Number(r.track_id),
      startsAtMs: Number(r.ms),
      shift: r.shift_context ? { context: r.shift_context, ms: Number(r.shift_ms ?? 0) } : null,
      ...(r.message ? { message: r.message } : {}),
      ...(r.created_by === "bible" ? { plain: true } : {}),
      ...(r.hold_len_sec !== null && r.hold_len_sec !== undefined
        ? { hold: { fromSec: Number(r.hold_from_sec ?? 0), lenSec: Number(r.hold_len_sec), ...(boolish(r.hold_cut) ? { cutEarly: true } : {}) } }
        : {}),
    }));
  } catch {
    return [];
  }
}

// Listeners check for breaks about every 10 seconds, so a "Play now" starts
// this long after the tap: everyone has heard about it by then and starts together.
const BREAK_LEAD_SEC = 15;

/** Studio: cut a recording in for everyone now (in about 15 seconds). */
export const playFmNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({
    trackId: Number(rec(input).trackId) || 0,
    requestId: Number(rec(input).requestId) || 0,
    withMessage: rec(input).withMessage !== false,
    // How soon it cuts in (seconds): 15 by default; the Control Room's "play next" waits for the current item to end.
    inSec: Math.max(BREAK_LEAD_SEC, Math.min(3 * 3600, Number(rec(input).inSec) || BREAK_LEAD_SEC)),
  }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, error: "Only the studio can interrupt the radio." };
    // A nugget (station break) has its own id range; everything else is an uploaded recording.
    const { NUGGET_ID_BASE } = await import("@/lib/porch/nuggets.server");
    const { BIBLE_ID_BASE } = await import("@/lib/porch/bible-radio.server");
    const track =
      data.trackId > BIBLE_ID_BASE
        ? await sql.query<{ id: number }>("select id from bible_audio_chapters where id = $1 and url <> ''", [data.trackId - BIBLE_ID_BASE])
        : data.trackId > NUGGET_ID_BASE
          ? await sql.query<{ id: number }>("select id from nuggets where id = $1 and status = 'approved' and url <> ''", [data.trackId - NUGGET_ID_BASE])
          : await sql.query<{ id: number }>("select id from fm_tracks where id = $1", [data.trackId]);
    if (!track.length) return { ok: false as const, error: "That audio is gone." };
    await ensureBreakMessage(sql);
    let message = "";
    if (data.requestId) {
      await ensureRequests(sql);
      const asked = await sql.query<{ message: string; from_name: string; to_name: string; user_id: string }>(
        "update fm_requests set status = 'played', done_at = now() where id = $1 returning message, from_name, to_name, user_id",
        [data.requestId],
      );
      const row = asked[0];
      if (row) {
        const who = await sql.query<{ display_name: string | null }>("select display_name from profiles where user_id = $1", [row.user_id]);
        const name = row.from_name || (who[0]?.display_name ?? "").trim().split(/\s+/)[0] || "a listener";
        // Every request says so on the radio screen; the dedication words only if the studio keeps them.
        message = (data.withMessage ? dedicationLine(row.from_name || name, row.to_name, row.message) : "") || `Request · from ${name}`;
      }
    }
    const inserted = await sql.query<{ id: number; ms: string | number }>(
      `insert into fm_breaks (track_id, starts_at, created_by, message, request_id) values ($1, now() + make_interval(secs => $2), $3, $4, $5)
       returning id, (extract(epoch from starts_at) * 1000)::bigint as ms`,
      [data.trackId, data.inSec, context.userId, message, data.requestId || null],
    );
    if (data.requestId) await alertRequestPeople(sql, data.requestId);
    // Work out where the list carries on afterwards: the item after the one it interrupts.
    const breakId = Number(inserted[0].id);
    const startMs = Number(inserted[0].ms);
    const station = await readStation(sql);
    const chosen = [...station.tracks, ...station.nuggets].find((t) => t.id === data.trackId);
    const earlier = (await readBreaks(sql)).filter((b) => b.id !== breakId && b.startsAtMs <= startMs && b.shift);
    const current: FmShift | null = earlier.sort((a, b) => b.startsAtMs - a.startsAtMs)[0]?.shift ?? null;
    if (chosen) {
      const shift = shiftAfterBreak([...station.tracks, ...station.nuggets], station.programmes, startMs, breakLengthSec(chosen, station.tracks, breakId) * 1000, current);
      if (shift) await sql.query("update fm_breaks set shift_context = $2, shift_ms = $3 where id = $1", [breakId, shift.context, shift.ms]);
    }
    return { ok: true as const, breaks: await readBreaks(sql), leadSec: data.inSec };
  });

/** "Your request is about to play" (and "… dedicated a song to you"), to their phones. */
async function alertRequestPeople(sql: Sql, requestId: number) {
  try {
    const rows = await sql.query<{ user_id: string; to_user_id: string | null; title: string; from_name: string; who: string | null }>(
      `select r.user_id, r.to_user_id, r.title, r.from_name, p.display_name as who
         from fm_requests r left join profiles p on p.user_id = r.user_id where r.id = $1`,
      [requestId],
    );
    const row = rows[0];
    if (!row) return;
    const { notifyRadio } = await import("@/lib/porch/push.server");
    await notifyRadio(sql, row.user_id, `🎵 Your request "${row.title}" is about to play on Porchbook Radio. Tap to tune in!`, `fm-req-${requestId}`);
    if (row.to_user_id && row.to_user_id !== row.user_id) {
      const from = row.from_name || (row.who ?? "").trim().split(/\s+/)[0] || "Someone";
      await notifyRadio(sql, row.to_user_id, `🎵 ${from} dedicated "${row.title}" to you. Tune in now!`, `fm-ded-${requestId}`);
    }
  } catch {
    /* an alert that fails must not stop the song */
  }
}

/** Studio: cancel a "Play now" (waiting or on air); listeners go back to the programme. */
export const stopFmBreak = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: Number(rec(input).id) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, error: "Only the studio can change this." };
    await sql.query("delete from fm_breaks where id = $1", [data.id]);
    return { ok: true as const, breaks: await readBreaks(sql) };
  });

/** Studio: trim a recording to where its sound actually ends (measured on the phone). */
export const setFmPlayLength = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    return { id: Number(raw.id) || 0, playSec: typeof raw.playSec === "number" && Number.isFinite(raw.playSec) ? raw.playSec : 0 };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const };
    if (data.playSec < 0.5) return { ok: false as const };
    await keepOnAir(sql, () => sql.query("update fm_tracks set play_sec = least($2::real, duration_sec) where id = $1", [data.id, data.playSec]));
    return { ok: true as const };
  });

/** Studio: change an upload's type (e.g. Music → News) without uploading again. */
export const setFmTrackKind = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    return { id: Number(raw.id) || 0, kind: typeof raw.kind === "string" && KINDS.has(raw.kind) ? raw.kind : "" };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, error: "Only the studio can change this." };
    if (!data.kind) return { ok: false as const, error: "Choose a type." };
    // A new type is measured afresh (jingles and station IDs get trimmed again).
    await keepOnAir(sql, () => sql.query("update fm_tracks set kind = $2, play_sec = null where id = $1", [data.id, data.kind]));
    return { ok: true as const };
  });

/** Studio: play the devotional's strings under this item (on or off). */
export const setFmTrackStrings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    return { id: Number(raw.id) || 0, on: raw.on === true };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, error: "Only the studio can change this." };
    await sql.query("update fm_tracks set strings = $2 where id = $1", [data.id, data.on]);
    return { ok: true as const };
  });

/** Studio: show a Phaneroo YouTube live video by pasting its link ("" clears it). */
export const setLiveVideo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    const label = ["auto", "phaneroo", "grace", "custom"].includes(String(raw.label)) ? String(raw.label) : "auto";
    return {
      link: typeof raw.link === "string" ? String(raw.link).slice(0, 300) : "",
      label,
      custom: typeof raw.custom === "string" ? String(raw.custom).replace(/\s+/g, " ").trim().slice(0, 60) : "",
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, error: "Only the studio can change this." };
    if (!data.link.trim()) {
      await sql.query("delete from fm_live_video where id = 1");
      return { ok: true as const, videoId: "", label: "", title: "" };
    }
    const { videoIdOf, videoTitle, ensureLiveColumns, liveLabel } = await import("@/lib/porch/yt-live.server");
    const videoId = videoIdOf(data.link);
    if (!videoId) return { ok: false as const, error: "That isn't a YouTube video link." };
    if (data.label === "custom" && !data.custom) return { ok: false as const, error: "Write what it should say, e.g. Pr. Masasi is live now." };
    await ensureLiveColumns(sql);
    const same = await sql.query<{ title: string }>("select title from fm_live_video where id = 1 and video_id = $1", [videoId]);
    const title = same[0]?.title || (await videoTitle(videoId));
    await sql.query(
      `insert into fm_live_video (id, video_id, set_at, label, custom, title, was_live, checked_at) values (1, $1, now(), $2, $3, $4, false, null)
       on conflict (id) do update set video_id = $1, set_at = case when fm_live_video.video_id = $1 then fm_live_video.set_at else now() end,
         label = $2, custom = $3, title = $4, was_live = case when fm_live_video.video_id = $1 then fm_live_video.was_live else false end, checked_at = null`,
      [videoId, data.label, data.custom, title],
    );
    return { ok: true as const, videoId, label: liveLabel(data.label, data.custom), title };
  });

/** Studio: run the "is Phaneroo live?" check now and show what YouTube answered. */
export const checkLiveNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, report: "" };
    const { liveCheckReport, plainReport } = await import("@/lib/porch/yt-live.server");
    return { ok: true as const, report: plainReport(await liveCheckReport()) };
  });

/** Studio: send every not-yet-processed upload to the audio worker (one at a time there). */
export const processFmAudio = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, sent: 0 };
    // Only videos (their sound is taken out); audio plays as uploaded.
    const rows = await sql.query<{ id: number }>(
      "select id from fm_tracks where processed_at is null and url ~* '\\.(mp4|m4v|mov|webm|mkv|3gp|avi)(\\?|$)' order by created_at asc, id asc",
    );
    const { requestProcessing } = await import("@/lib/porch/fm-process.server");
    let sent = 0;
    for (const row of rows) if (await requestProcessing(sql, Number(row.id))) sent += 1;
    return { ok: true as const, sent };
  });

/** What the radio screen shows while a request plays: "Dedication · from Mia to Mummy · Happy birthday". */
export function dedicationLine(from: string, to: string, message: string) {
  if (from && !to && !message) return `Request · from ${from}`;
  const who = from && to ? `from ${from} to ${to}` : to ? `to ${to}` : from ? `from ${from}` : "";
  if (!who) return message;
  return ["Dedication", who, message].filter(Boolean).join(" · ");
}

// ---- Requests: listeners ask for a song or a sermon; the studio plays it (with their message on every radio screen) or can't find it.

export type FmRequest = {
  id: number;
  kind: "song" | "sermon";
  title: string;
  by: string;
  message: string;
  from: string;
  to: string;
  status: "waiting" | "played" | "missing";
  /** Once played: when, how many heard it, and the recording (for "Hear it again"). */
  playedAt?: string;
  heard?: number;
  url?: string;
  name: string;
  createdAt: string;
  /** Studio: is the person who asked on Porchbook right now? */
  presence?: "listening" | "online" | "away";
  seenAt?: string;
};

let requestsReady = false;
async function ensureRequests(sql: Sql) {
  if (requestsReady) return;
  await sql.query(`create table if not exists fm_requests (
    id serial primary key,
    user_id text not null references profiles (user_id) on delete cascade,
    kind text not null default 'song',
    title text not null default '',
    by_name text not null default '',
    message text not null default '',
    status text not null default 'waiting',
    created_at timestamptz not null default now(),
    done_at timestamptz
  )`);
  // A dedication: from whom, to whom.
  await sql.query("alter table fm_requests add column if not exists from_name text not null default ''");
  await sql.query("alter table fm_requests add column if not exists to_name text not null default ''");
  await sql.query("alter table fm_requests add column if not exists to_user_id text");
  // Whether the person who asked has been told how it went (played at…, or can't find it).
  await sql.query("alter table fm_requests add column if not exists told boolean not null default false");
  requestsReady = true;
}

function clipText(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

type RequestRow = {
  id: number;
  kind: string;
  title: string;
  by_name: string;
  message: string;
  from_name: string;
  to_name: string;
  status: string;
  display_name: string | null;
  created_at: string;
  played_at?: string | null;
  heard?: string | number | null;
  url?: string | null;
  seen?: string | null;
  listening?: boolean | string | null;
  online?: boolean | string | null;
};
function toRequest(r: RequestRow): FmRequest {
  return {
    id: Number(r.id),
    kind: r.kind === "sermon" ? "sermon" : "song",
    title: r.title,
    by: r.by_name,
    message: r.message,
    from: r.from_name ?? "",
    to: r.to_name ?? "",
    status: r.status === "played" ? "played" : r.status === "missing" ? "missing" : "waiting",
    name: r.display_name || "Teammate",
    createdAt: r.created_at,
    ...(r.played_at ? { playedAt: r.played_at, heard: Number(r.heard ?? 0), ...(r.url ? { url: r.url } : {}) } : {}),
    ...(r.online !== undefined && r.online !== null
      ? { presence: boolish(r.listening) ? ("listening" as const) : boolish(r.online) ? ("online" as const) : ("away" as const), ...(r.seen ? { seenAt: r.seen } : {}) }
      : {}),
  };
}
const REQUEST_COLUMNS = `r.id, r.kind, r.title, r.by_name, r.message, r.from_name, r.to_name, r.status, p.display_name,
  to_char(r.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at`;

export const sendFmRequest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    return {
      kind: raw.kind === "sermon" ? "sermon" : "song",
      title: clipText(raw.title, 120),
      by: clipText(raw.by, 80),
      message: clipText(raw.message, 80),
      from: clipText(raw.from, 40),
      to: clipText(raw.to, 40),
      toUserId: typeof raw.toUserId === "string" ? raw.toUserId.slice(0, 80) : "",
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.title) return { ok: false as const, error: data.kind === "song" ? "Write the song's title." : "Write the sermon's title or topic." };
    const sql = await getSql();
    await ensureRequests(sql);
    const recent = await sql.query<{ n: string | number }>(
      "select count(*) as n from fm_requests where user_id = $1 and created_at > now() - interval '1 hour'",
      [context.userId],
    );
    if (Number(recent[0]?.n ?? 0) >= 5) return { ok: false as const, error: "You've sent 5 requests this hour. Try again a little later." };
    // "To" a Porchbook member: they get a tune-in alert too.
    let toUserId: string | null = null;
    if (data.toUserId) {
      const found = await sql.query<{ user_id: string }>("select user_id from profiles where user_id = $1", [data.toUserId]);
      toUserId = found[0]?.user_id ?? null;
    }
    await sql.query(
      "insert into fm_requests (user_id, kind, title, by_name, message, from_name, to_name, to_user_id) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [context.userId, data.kind, data.title, data.by, data.message, data.from, data.to, toUserId],
    );
    return { ok: true as const };
  });

/** Your own requests, newest first. */
export const myFmRequests = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensureRequests(sql);
    await ensureBreakMessage(sql);
    const rows = await sql.query<RequestRow>(
      `select ${REQUEST_COLUMNS},
              to_char(b.starts_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as played_at,
              (select count(*) from fm_break_heard h where h.break_id = b.id) as heard,
              t.url
         from fm_requests r
         left join profiles p on p.user_id = r.user_id
         left join lateral (select id, starts_at, track_id from fm_breaks where request_id = r.id order by id desc limit 1) b on true
         left join fm_tracks t on t.id = b.track_id
        where r.user_id = $1 order by r.created_at desc limit 10`,
      [context.userId],
    );
    const me = await sql.query<{ display_name: string | null }>("select display_name from profiles where user_id = $1", [context.userId]);
    // Their first name, to fill in "From".
    const name = (me[0]?.display_name ?? "").trim().split(/\s+/)[0] ?? "";
    return { requests: rows.map(toRequest), name };
  });

/** Studio: everyone's requests — waiting first, then the latest done. */
export const listFmRequests = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, requests: [] as FmRequest[], founder: false };
    await ensureRequests(sql);
    await sql.query(`create table if not exists presence (user_id text primary key, status text not null default 'hidden', chose boolean not null default false, last_beat timestamptz, last_touch timestamptz)`);
    // Waiting ones: is the person on Porchbook now (listening first, then online, then the rest).
    const rows = await sql.query<RequestRow>(
      `(select ${REQUEST_COLUMNS},
               coalesce(l.seen_at > now() - interval '150 seconds', false) as listening,
               coalesce(s.last_beat > now() - interval '75 seconds', false) as online,
               to_char(greatest(s.last_beat, l.seen_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as seen
          from fm_requests r left join profiles p on p.user_id = r.user_id
          left join presence s on s.user_id = r.user_id
          left join fm_live l on l.user_id = r.user_id
         where r.status = 'waiting'
         order by coalesce(l.seen_at > now() - interval '150 seconds', false) desc,
                  coalesce(s.last_beat > now() - interval '75 seconds', false) desc, r.created_at asc limit 60)
       union all
       (select ${REQUEST_COLUMNS}, null as listening, null as online, null as seen
          from fm_requests r left join profiles p on p.user_id = r.user_id
         where r.status <> 'waiting' order by r.done_at desc nulls last limit 15)`,
    );
    const me = await sql.query<{ is_founder: unknown }>("select is_porch_admin($1) as is_founder", [context.userId]);
    return { ok: true as const, requests: rows.map(toRequest), founder: boolish(me[0]?.is_founder) };
  });

/** Studio: "Can't find it". */
export const missFmRequest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: Number(rec(input).id) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await canRunStudio(sql, context.userId))) return { ok: false as const, error: "Only the studio can change this." };
    await ensureRequests(sql);
    const missed = await sql.query<{ user_id: string; title: string }>(
      "update fm_requests set status = 'missing', done_at = now(), told = true where id = $1 and status = 'waiting' returning user_id, title",
      [data.id],
    );
    if (missed[0]) {
      await tellListener(
        sql,
        missed[0].user_id,
        `🎵 Porchbook Radio: sorry, we couldn't find "${missed[0].title}" in the library this time. Try another song, or ask again later.`,
      );
    }
    return { ok: true as const };
  });

/** Requests on air (or just played) that concern you: yours, or dedicated to you. For the tune-in strip. */
export type RadioNews = {
  breakId: number;
  title: string;
  mine: boolean;
  from: string;
  startsAtMs: number;
  endsAtMs: number;
  heard: number;
  iHeard: boolean;
  url: string;
};

export const myRadioNews = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensureRequests(sql);
    await ensureBreakMessage(sql);
    const rows = await sql.query<{
      break_id: number;
      title: string;
      user_id: string;
      from_name: string;
      who: string | null;
      ms: string | number;
      track_id: number;
      heard: string | number;
      i_heard: boolean | string | null;
    }>(
      `select b.id as break_id, r.title, r.user_id, r.from_name, p.display_name as who,
              (extract(epoch from b.starts_at) * 1000)::bigint as ms, b.track_id,
              (select count(*) from fm_break_heard h where h.break_id = b.id) as heard,
              exists (select 1 from fm_break_heard h where h.break_id = b.id and h.user_id = $1) as i_heard
         from fm_breaks b
         join fm_requests r on r.id = b.request_id
         left join profiles p on p.user_id = r.user_id
        where b.starts_at > now() - interval '12 hours'
          and (r.user_id = $1 or r.to_user_id = $1)
        order by b.starts_at desc limit 3`,
      [context.userId],
    );
    if (!rows.length) return { news: [] as RadioNews[] };
    const station = await readStation(sql);
    const news: RadioNews[] = rows.map((r) => {
      const track = station.tracks.find((t) => t.id === Number(r.track_id));
      const start = Number(r.ms);
      const len = track ? breakLengthSec(track, station.tracks, Number(r.break_id)) : 240;
      return {
        breakId: Number(r.break_id),
        title: r.title,
        mine: r.user_id === context.userId,
        from: r.from_name || (r.who ?? "").trim().split(/\s+/)[0] || "Someone",
        startsAtMs: start,
        endsAtMs: start + len * 1000,
        heard: Number(r.heard ?? 0),
        iHeard: boolish(r.i_heard),
        url: track?.url ?? "",
      };
    });
    return { news };
  });

/** Everyone on Porchbook, for "To" in a dedication. */
export const radioPeople = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql.query<{ user_id: string; display_name: string; image_url: string | null }>(
      "select user_id, display_name, image_url from profiles where user_id <> $1 and display_name <> '' order by lower(display_name) limit 2000",
      [context.userId],
    );
    return { people: rows.map((r) => ({ id: r.user_id, name: r.display_name, imageUrl: r.image_url })) };
  });

/** For the Porchbook app's watch (it asks every few seconds): a request concerning you that is about to play or just started. */
export async function radioAlertFor(sql: Sql, userId: string): Promise<{ id: string; text: string } | null> {
  try {
    const rows = await sql.query<{ id: number; title: string; user_id: string; from_name: string; who: string | null }>(
      `select b.id, r.title, r.user_id, r.from_name, p.display_name as who
         from fm_breaks b
         join fm_requests r on r.id = b.request_id
         left join profiles p on p.user_id = r.user_id
        where b.starts_at > now() - interval '3 minutes' and b.starts_at < now() + interval '1 minute'
          and (r.user_id = $1 or r.to_user_id = $1)
        order by b.starts_at desc limit 1`,
      [userId],
    );
    const row = rows[0];
    if (!row) return null;
    const from = row.from_name || (row.who ?? "").trim().split(/\s+/)[0] || "Someone";
    const text = row.user_id === userId ? `🎵 Your request "${row.title}" is on Porchbook Radio. Tap to tune in!` : `🎵 ${from} dedicated "${row.title}" to you. Tune in now!`;
    return { id: String(row.id), text };
  } catch {
    return null;
  }
}

// ---- For the founder: someone waiting for their request is online (or listening) right now.

let pingsReady = false;
async function ensurePings(sql: Sql) {
  if (pingsReady) return;
  await sql.query(`create table if not exists fm_request_pings (
    id serial primary key,
    request_id integer not null,
    listening boolean not null default false,
    at timestamptz not null default now()
  )`);
  pingsReady = true;
}

function pingLine(name: string, title: string, by: string, listening: boolean) {
  const song = `"${title}"${by ? ` (${by})` : ""}`;
  return listening ? `🎵 ${name} is listening to the radio now · waiting for ${song}. Play it now?` : `🎵 ${name} is online · waiting for ${song}`;
}

/**
 * Called on each "I'm here" (and when the radio is turned on). At most once per request every
 * 2 hours, plus once more if they then turn the radio on: the best moment to press Play now.
 */
export async function noticeRequester(sql: Sql, userId: string) {
  try {
    await ensureRequests(sql);
    const waiting = await sql.query<{ id: number; title: string; by_name: string; display_name: string | null }>(
      `select r.id, r.title, r.by_name, p.display_name from fm_requests r left join profiles p on p.user_id = r.user_id
        where r.user_id = $1 and r.status = 'waiting' and r.created_at > now() - interval '14 days'
        order by r.created_at asc limit 3`,
      [userId],
    );
    if (!waiting.length) return;
    await ensurePings(sql);
    const live = await sql.query<{ n: number }>(
      "select count(*)::int as n from fm_live where user_id = $1 and seen_at > now() - interval '150 seconds'",
      [userId],
    );
    const listening = Number(live[0]?.n ?? 0) > 0;
    const founders = await sql.query<{ user_id: string }>("select user_id from profiles where is_porch_admin(user_id) and user_id <> $1", [userId]);
    if (!founders.length) return;
    for (const request of waiting) {
      const last = await sql.query<{ listening: boolean | string }>(
        "select listening from fm_request_pings where request_id = $1 and at > now() - interval '2 hours' order by at desc limit 1",
        [request.id],
      );
      if (last.length && (boolish(last[0].listening) || !listening)) continue;
      await sql.query("insert into fm_request_pings (request_id, listening) values ($1, $2)", [request.id, listening]);
      const name = (request.display_name ?? "").trim().split(/\s+/)[0] || "Someone";
      const { notifyStudio } = await import("@/lib/porch/push.server");
      for (const founder of founders) await notifyStudio(sql, founder.user_id, pingLine(name, request.title, request.by_name, listening), `fm-ping-${request.id}`);
      break; // one alert at a time is enough
    }
  } catch {
    /* never in the way of being online */
  }
}

/** For the founder's Porchbook app watch: the latest "requester is online" alert (last 2 minutes). */
export async function studioAlertFor(sql: Sql, userId: string): Promise<{ id: string; text: string } | null> {
  try {
    const me = await sql.query<{ is_founder: unknown }>("select is_porch_admin($1) as is_founder", [userId]);
    if (!boolish(me[0]?.is_founder)) return null;
    await ensurePings(sql);
    const rows = await sql.query<{ id: number; listening: boolean | string; title: string; by_name: string; display_name: string | null; user_id: string }>(
      `select g.id, g.listening, r.title, r.by_name, p.display_name, r.user_id
         from fm_request_pings g join fm_requests r on r.id = g.request_id left join profiles p on p.user_id = r.user_id
        where g.at > now() - interval '2 minutes' and r.status = 'waiting'
        order by g.at desc limit 1`,
    );
    const row = rows[0];
    if (!row || row.user_id === userId) return null;
    const name = (row.display_name ?? "").trim().split(/\s+/)[0] || "Someone";
    return { id: `ping-${row.id}`, text: pingLine(name, row.title, row.by_name, boolish(row.listening)) };
  } catch {
    return null;
  }
}

// ---- After a request plays: tell the person who asked (and the one it was dedicated to), in Chat.

export async function founderOf(sql: Sql) {
  const rows = await sql.query<{ user_id: string }>("select user_id from profiles where is_porch_admin(user_id) limit 1");
  return rows[0]?.user_id ?? "";
}

/** A message in Chat, from the founder, with the usual phone alert. */
export async function tellListener(sql: Sql, toId: string, body: string) {
  try {
    const fromId = await founderOf(sql);
    if (!fromId || !toId || fromId === toId) return;
    const { ensureChat } = await import("@/lib/porch/chat");
    await ensureChat(sql);
    const rows = await sql.query<{ id: number }>(
      `insert into conversations (low_user_id, high_user_id) values (least($1, $2), greatest($1, $2))
       on conflict (low_user_id, high_user_id) do update set updated_at = now() returning id`,
      [fromId, toId],
    );
    const id = rows[0]?.id;
    if (id == null) return;
    await sql.query("insert into messages (conversation_id, author_id, body) values ($1, $2, $3)", [Number(id), fromId, body]);
    const { notifyPrivateNote } = await import("@/lib/porch/push.server");
    await notifyPrivateNote(sql, toId, fromId);
  } catch {
    /* a message that fails must not get in the way */
  }
}

function kampalaWhen(ms: number) {
  const date = new Date(ms);
  const day = date.toLocaleDateString("en-GB", { timeZone: "Africa/Kampala", weekday: "short", day: "numeric", month: "short" });
  const time = date.toLocaleTimeString("en-US", { timeZone: "Africa/Kampala", hour: "numeric", minute: "2-digit" });
  return `${day} at ${time}`;
}

let lastTold = 0;
/** Once a played request has finished: "your request was played at …, N listeners heard it". (Checked as people come online.) */
export async function tellPlayedRequests(sql: Sql) {
  if (Date.now() - lastTold < 45000) return;
  lastTold = Date.now();
  try {
    await ensureRequests(sql);
    await ensureBreakMessage(sql);
    const rows = await sql.query<{
      id: number;
      user_id: string;
      to_user_id: string | null;
      title: string;
      by_name: string;
      from_name: string;
      to_name: string;
      who: string | null;
      break_id: number;
      track_id: number;
      ms: string | number;
      heard: string | number;
    }>(
      `select r.id, r.user_id, r.to_user_id, r.title, r.by_name, r.from_name, r.to_name, p.display_name as who,
              b.id as break_id, b.track_id, (extract(epoch from b.starts_at) * 1000)::bigint as ms,
              (select count(*) from fm_break_heard h where h.break_id = b.id) as heard
         from fm_requests r
         join lateral (select id, track_id, starts_at from fm_breaks where request_id = r.id order by id desc limit 1) b on true
         left join profiles p on p.user_id = r.user_id
        where r.status = 'played' and not r.told and b.starts_at > now() - interval '2 days'
        order by b.starts_at asc limit 20`,
    );
    if (!rows.length) return;
    const station = await readStation(sql);
    for (const r of rows) {
      const track = station.tracks.find((t) => t.id === Number(r.track_id));
      const start = Number(r.ms);
      const end = start + (track ? breakLengthSec(track, station.tracks, Number(r.break_id)) : 300) * 1000;
      if (Date.now() < end + 5000) continue;
      const claimed = await sql.query<{ id: number }>("update fm_requests set told = true where id = $1 and not told returning id", [r.id]);
      if (!claimed.length) continue;
      const heard = Number(r.heard ?? 0);
      const song = `"${r.title}"${r.by_name ? ` (${r.by_name})` : ""}`;
      const listeners = heard ? ` ${heard} ${heard === 1 ? "listener" : "listeners"} heard it.` : "";
      const dedication = r.to_name ? `, with your dedication to ${r.to_name}` : "";
      await tellListener(
        sql,
        r.user_id,
        `🎵 Porchbook Radio: your request ${song} was played on ${kampalaWhen(start)}${dedication}.${listeners} Thank you for listening! You can hear it again under Your requests on the radio.`,
      );
      if (r.to_user_id && r.to_user_id !== r.user_id) {
        const from = r.from_name || (r.who ?? "").trim().split(/\s+/)[0] || "Someone";
        await tellListener(sql, r.to_user_id, `🎵 Porchbook Radio: ${from}'s dedication to you, ${song}, was played on ${kampalaWhen(start)}.${listeners}`);
      }
    }
  } catch {
    /* try again next time */
  }
}

// ---- The founder's request history, as a PDF (by month).

export const requestHistoryPdf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const month = typeof rec(input).month === "string" ? String(rec(input).month) : "";
    return { month: /^\d{4}-\d{2}$/.test(month) ? month : "" };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await sql.query<{ is_founder: unknown }>("select is_porch_admin($1) as is_founder", [context.userId]);
    if (!boolish(me[0]?.is_founder)) return { ok: false as const, error: "Only an admin can take the request history." };
    await ensureRequests(sql);
    await ensureBreakMessage(sql);
    const month = data.month || new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 7);
    const rows = await sql.query<{
      kind: string;
      title: string;
      by_name: string;
      message: string;
      from_name: string;
      to_name: string;
      status: string;
      who: string | null;
      asked_ms: string | number;
      played_ms: string | number | null;
      heard: string | number | null;
    }>(
      `select r.kind, r.title, r.by_name, r.message, r.from_name, r.to_name, r.status, p.display_name as who,
              (extract(epoch from r.created_at) * 1000)::bigint as asked_ms,
              (extract(epoch from b.starts_at) * 1000)::bigint as played_ms,
              (select count(*) from fm_break_heard h where h.break_id = b.id) as heard
         from fm_requests r
         left join profiles p on p.user_id = r.user_id
         left join lateral (select id, starts_at from fm_breaks where request_id = r.id order by id desc limit 1) b on true
        where to_char(r.created_at at time zone 'Africa/Kampala', 'YYYY-MM') = $1
        order by r.created_at asc`,
      [month],
    );
    const { textPdf } = await import("@/lib/porch/pdf-lite");
    type Line = { text: string; size?: number; x?: number; gap?: number; newPage?: boolean };
    const monthName = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const lines: Line[] = [
      { text: `Porchbook Radio - Requests - ${monthName}`, size: 18, gap: 26 },
      { text: `${rows.length} ${rows.length === 1 ? "request" : "requests"}`, size: 11, gap: 22 },
    ];
    const clean = (text: string) => text.replace(/[^\x20-\x7e\u00a0-\u00ff]/g, "").trim();
    for (const r of rows) {
      const asked = kampalaWhen(Number(r.asked_ms));
      const who = clean(r.who ?? "Someone");
      lines.push({ text: `${clean(r.title)}${r.by_name ? ` - ${clean(r.by_name)}` : ""}  (${r.kind === "sermon" ? "sermon" : "song"})`, size: 11, gap: 16 });
      lines.push({ text: `Asked by ${who} on ${asked}`, size: 9, x: 60, gap: 13 });
      if (r.from_name || r.to_name || r.message) lines.push({ text: `Dedication: ${clean(dedicationLine(r.from_name, r.to_name, r.message).replace(/^(Dedication|Request) · /, "")).replace(/ · /g, " - ")}`, size: 9, x: 60, gap: 13 });
      const outcome =
        r.status === "played" && r.played_ms
          ? `Played on ${kampalaWhen(Number(r.played_ms))} - ${Number(r.heard ?? 0)} heard it`
          : r.status === "missing"
            ? "Can't find it"
            : r.status === "played"
              ? "Played"
              : "Still waiting";
      lines.push({ text: outcome, size: 9, x: 60, gap: 20 });
    }
    // The month in numbers.
    const played = rows.filter((r) => r.status === "played").length;
    const missing = rows.filter((r) => r.status === "missing").length;
    // Counted ignoring capitals; shown as first written.
    const top = (pick: (r: (typeof rows)[number]) => string) => {
      const counts = new Map<string, { label: string; n: number }>();
      for (const r of rows) {
        const label = pick(r);
        if (!label) continue;
        const key = label.toLowerCase();
        const seen = counts.get(key);
        counts.set(key, { label: seen?.label ?? label, n: (seen?.n ?? 0) + 1 });
      }
      return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 5).map((item) => [item.label, item.n] as const);
    };
    lines.push({ text: "This month", size: 15, gap: 22, newPage: rows.length > 12 });
    lines.push({ text: `Requests: ${rows.length}   Played: ${played}   Can't find it: ${missing}   Waiting: ${rows.length - played - missing}`, size: 10, gap: 18 });
    const songs = top((r) => clean(r.title));
    if (songs.length) {
      lines.push({ text: "Most requested", size: 12, gap: 16 });
      for (const [title, n] of songs) lines.push({ text: `${n} x  ${title}`, size: 10, x: 60, gap: 14 });
    }
    const people = top((r) => clean(r.who ?? ""));
    if (people.length) {
      lines.push({ text: "Asked most", size: 12, gap: 16 });
      for (const [name, n] of people) lines.push({ text: `${n} x  ${name}`, size: 10, x: 60, gap: 14 });
    }
    return { ok: true as const, pdf: textPdf(lines), filename: `porchbook-radio-requests-${month}.pdf` };
  });

/**
 * The founder's Next: what's on fades out in a few seconds and the next item in the list plays,
 * for everyone. A "Play now" on air simply stops (the programme carries on).
 */
const NEXT_LEAD_MS = 8000;
export const skipFmNext = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const me = await sql.query<{ is_founder: unknown }>("select is_porch_admin($1) as is_founder", [context.userId]);
    if (!boolish(me[0]?.is_founder)) return { ok: false as const, error: "Only an admin can skip to the next item." };
    await ensureBreakMessage(sql);
    const station = await readStation(sql);
    const breaks = await readBreaks(sql);
    const clock = await sql.query<{ ms: string | number }>("select (extract(epoch from now()) * 1000)::bigint as ms");
    const nowMs = Number(clock[0].ms);
    const onAir = onAirAt([...station.tracks, ...station.nuggets], station.programmes, nowMs, breaks);
    if (!onAir) return { ok: false as const, error: "Nothing is on air to skip." };
    let current = breaks;
    if (onAir.breakId) {
      // A "Play now" (or a Next's jingle) on air: it stops, and the programme moves on.
      await sql.query("delete from fm_breaks where id = $1", [onAir.breakId]);
      current = await readBreaks(sql);
    }
    const startMs = nowMs + NEXT_LEAD_MS;
    const begun = current.filter((b) => b.startsAtMs <= nowMs && b.shift).sort((a, b) => b.startsAtMs - a.startsAtMs)[0];
    // A jingle before the next item, unless a jingle (or station ID) is what's being skipped.
    const jingles = station.tracks.filter((t) => isJingle(t) && t.durationSec > 0.5 && !isVideoFile(t.url));
    const skippingJingle = isJingle(onAir.track) || isStationId(onAir.track);
    if (jingles.length && !skippingJingle) {
      // Mixed order: never the jingle that played last.
      const lastJingle = [...current].reverse().find((b) => jingles.some((j) => j.id === b.trackId))?.trackId ?? onAir.track.id;
      const choices = jingles.length > 1 ? jingles.filter((j) => j.id !== lastJingle) : jingles;
      const jingle = choices[Math.floor(Math.random() * choices.length)];
      const shift = shiftAfterBreak([...station.tracks, ...station.nuggets], station.programmes, startMs, jingle.durationSec * 1000, begun?.shift ?? null);
      if (!shift) return { ok: false as const, error: "There's nothing after this to play." };
      // The jingle goes on like a "Play now"; the list carries on with the next item when it ends.
      await sql.query(
        `insert into fm_breaks (track_id, starts_at, created_by, message, shift_context, shift_ms)
         values ($1, to_timestamp($2::double precision / 1000), $3, '', $4, $5)`,
        [jingle.id, startMs, context.userId, shift.context, shift.ms],
      );
      return { ok: true as const, inSec: NEXT_LEAD_MS / 1000, breaks: await readBreaks(sql) };
    }
    const shift = shiftAfterBreak([...station.tracks, ...station.nuggets], station.programmes, startMs, 0, begun?.shift ?? null);
    if (!shift) return { ok: false as const, error: "There's nothing after this to play." };
    // No jingle: a near-zero "hold" at the switch point carries the new place in the list.
    await sql.query(
      `insert into fm_breaks (track_id, starts_at, created_by, message, hold_from_sec, hold_len_sec, hold_cut, shift_context, shift_ms)
       values ($1, to_timestamp($2::double precision / 1000), $3, '', $4, 0.05, true, $5, $6)`,
      [onAir.track.id, startMs, context.userId, onAir.offsetSec + NEXT_LEAD_MS / 1000, shift.context, shift.ms],
    );
    return { ok: true as const, inSec: NEXT_LEAD_MS / 1000, breaks: await readBreaks(sql) };
  });
