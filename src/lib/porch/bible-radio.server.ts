import { randomBytes } from "node:crypto";
import type { Sql } from "@/lib/db";
import { BOOKS } from "@/lib/porch/bible-engine";
import type { FmTrack } from "@/lib/porch/fm-schedule";
import { audioWorkerBase } from "@/lib/porch/audio-worker.server";

/**
 * Bible readings on the Radio: each uploaded book is cut into pieces of about 3 minutes (each
 * ending at a pause, never mid-verse). One piece plays after every few Radio items, in Bible
 * order, carrying on from where the last one stopped, to the end, then round again.
 */
export const BIBLE_ID_BASE = 20_000_000; // piece ids on the radio
const bool = (v: unknown) => v === true || v === 1 || v === "1" || v === "t" || v === "true";
const siteOrigin = () => (process.env.BETTER_AUTH_URL || "https://porchbook.vercel.app").replace(/\/+$/, "");

export const bookName = (book: number) => BOOKS[book - 1]?.name ?? `Book ${book}`;
export const bookChapters = (book: number) => BOOKS[book - 1]?.chapters ?? 1;

type PieceRow = { id: number; book: number; piece: number; url: string; start_sec: number; duration_sec: number; book_sec: number };
const PIECE_SELECT = `select c.id, b.book, c.chapter as piece, c.url, c.start_sec, c.duration_sec, b.duration_sec as book_sec
   from bible_audio_chapters c join bible_audio_books b on b.id = c.book_id`;
const toTrack = (r: PieceRow): FmTrack => ({
  id: BIBLE_ID_BASE + Number(r.id),
  title: `${bookName(Number(r.book))} · reading ${r.piece}`,
  kind: "bible",
  url: r.url,
  durationSec: Number(r.duration_sec),
  bible: { book: Number(r.book), name: bookName(Number(r.book)), chapter: 0, fromSec: Number(r.start_sec), bookSec: Number(r.book_sec) },
});

/** The pieces phones need: those on the Radio's schedule from 3 hours ago onwards. */
export async function stationBible(sql: Sql): Promise<FmTrack[]> {
  try {
    const rows = await sql.query<PieceRow>(`${PIECE_SELECT} where c.id + ${BIBLE_ID_BASE} in (select track_id from fm_breaks where starts_at > now() - interval '3 hours')`);
    return rows.map(toTrack);
  } catch {
    return [];
  }
}

/** Take back the readings not yet started (when the settings or books change); the place goes back with them. */
export async function clearComingReadings(sql: Sql) {
  const coming = await sql.query<{ first_pos: number }>("select first_pos from bible_sittings where sit_at > now() order by sit_at asc limit 1");
  await sql.query("delete from fm_breaks where created_by = 'bible' and starts_at > now()");
  await sql.query("delete from bible_sittings where sit_at > now()");
  if (coming[0]) await sql.query("update bible_settings set next_pos = $1 where id = 1", [Number(coming[0].first_pos)]);
}

let lastEnsure = 0;
/**
 * Put the coming readings on the Radio's schedule: walking the schedule forward, a reading goes in
 * right where the item after every `every` items would start; that item then plays after the reading.
 * Readings take the next piece in Bible order each time (carrying on from the last), about 8 hours ahead.
 */
export async function ensureReadings(sql: Sql, force = false) {
  if (!force && Date.now() - lastEnsure < 60_000) return;
  lastEnsure = Date.now();
  try {
    const set = await sql.query<{ readings_on: unknown; every_items: number; next_pos: number }>("select readings_on, every_items, next_pos from bible_settings where id = 1");
    if (!set[0] || !bool(set[0].readings_on)) return;
    const pieces = await sql.query<PieceRow>(`${PIECE_SELECT} where c.approved and c.url <> '' and c.duration_sec > 1 order by b.book asc, c.chapter asc, c.id asc`);
    if (!pieces.length) return;
    const every = Math.max(1, Math.min(20, Number(set[0].every_items) || 3));
    const future = await sql.query<{ ms: string | number; len: number }>(
      `select (extract(epoch from b.starts_at) * 1000)::bigint as ms, c.duration_sec as len
         from fm_breaks b join bible_audio_chapters c on c.id + ${BIBLE_ID_BASE} = b.track_id
        where b.created_by = 'bible' and b.starts_at > now() order by b.starts_at asc`,
    );
    if (future.length >= 6) return;
    const { readStation, readBreaks } = await import("@/lib/porch/fm");
    const schedule = await import("@/lib/porch/fm-schedule");
    const station = await readStation(sql);
    const all = [...station.tracks, ...station.nuggets.filter((t) => t.kind !== "bible"), ...pieces.map(toTrack)];
    const breaks = await readBreaks(sql);
    const main = (t: FmTrack) => !schedule.isJingle(t) && !schedule.isStationId(t) && !schedule.isNewsIntro(t) && !schedule.isNugget(t) && !schedule.isBibleReading(t);
    const last = future[future.length - 1];
    let t = Math.max(Date.now() + 30_000, last ? Number(last.ms) + Number(last.len) * 1000 + 1000 : 0);
    const horizon = Date.now() + 8 * 3600_000;
    let pos = Number(set[0].next_pos) || 0;
    let count = 0;
    let added = future.length;
    for (let step = 0; step < 600 && t < horizon && added < 8; step += 1) {
      const on = schedule.onAirAt(all, station.programmes, t, breaks);
      if (!on) break;
      if (on.breakId) {
        t = on.endsAtMs + 50;
        continue;
      }
      const startsHere = on.offsetSec < 1.5;
      if (main(on.track) && startsHere) {
        if (count >= every) {
          // Here: a reading, then this item.
          const at = Math.round(t - on.offsetSec * 1000);
          const piece = pieces[pos % pieces.length];
          const len = Number(piece.duration_sec) * 1000;
          const earlier = breaks.filter((b) => b.startsAtMs < at && b.shift).sort((a, b) => b.startsAtMs - a.startsAtMs)[0]?.shift ?? null;
          const shift = schedule.shiftAfterBreak(all, station.programmes, at - 50, len + 50, earlier);
          const row = await sql.query<{ id: number }>(
            `insert into fm_breaks (track_id, starts_at, created_by, message, shift_context, shift_ms) values ($1, to_timestamp($2 / 1000.0), 'bible', '', $3, $4) returning id`,
            [BIBLE_ID_BASE + Number(piece.id), at, shift?.context ?? null, shift?.ms ?? null],
          );
          await sql.query("insert into bible_sittings (sit_at, first_pos) values (to_timestamp($1 / 1000.0), $2) on conflict do nothing", [at, pos % pieces.length]);
          breaks.push({ id: Number(row[0].id), trackId: BIBLE_ID_BASE + Number(piece.id), startsAtMs: at, shift });
          pos = (pos + 1) % pieces.length;
          added += 1;
          count = 0;
          t = at + len + 50;
          continue;
        }
        count += 1;
      }
      t = on.endsAtMs + 50;
    }
    await sql.query("update bible_settings set next_pos = $1 where id = 1", [pos]);
  } catch {
    /* tried again on the next look */
  }
}

/** Have the audio server cut a book into ~3-minute pieces, each ending at a pause. */
export async function requestSplit(sql: Sql, bookId: number) {
  const rows = await sql.query<{ file_url: string }>("select file_url from bible_audio_books where id = $1", [bookId]);
  if (!rows[0]?.file_url) return false;
  const set = await sql.query<{ piece_sec: number }>("select piece_sec from bible_settings where id = 1").catch(() => []);
  const token = randomBytes(24).toString("hex");
  await sql.query("update bible_audio_books set job_token = $2, job_started_at = now(), status = 'splitting', error = '', job_tries = job_tries + 1 where id = $1", [bookId, token]);
  try {
    await fetch(`${audioWorkerBase()}/bible/split`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobToken: token, bookId, audioUrl: rows[0].file_url, chapters: 1, pieceSec: Number(set[0]?.piece_sec) || 180, callback: `${siteOrigin()}/api/bible-worker` }),
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    /* the free server may be waking up; resent if it doesn't start */
  }
  return true;
}

/** A book the audio server never picked up is sent again (after 20 minutes; 4 tries). */
export async function resendStuckBible(sql: Sql) {
  try {
    // A moved start that never came back: say so (the readings are as they were).
    await sql.query(
      "update bible_audio_books set status = 'ready', error = 'Moving the start didn''t finish. Try again.', job_token = null where status = 'moving' and job_started_at < now() - interval '15 minutes'",
    );
    const rows = await sql.query<{ id: number; job_tries: number }>(
      "select id, job_tries from bible_audio_books where status = 'splitting' and job_started_at < now() - interval '20 minutes' order by id asc limit 1",
    );
    for (const row of rows) {
      if (Number(row.job_tries) >= 4) {
        await sql.query("update bible_audio_books set status = 'failed', error = 'The audio server didn''t answer. Upload the book again later.', job_token = null where id = $1", [row.id]);
        continue;
      }
      await requestSplit(sql, Number(row.id));
    }
  } catch {
    /* next look */
  }
}
