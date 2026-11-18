import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

/** Studio → Bible readings: upload books (cut into ~3-minute pieces), and switch the readings on. */
const rec = (input: unknown): Record<string, unknown> => (input && typeof input === "object" ? (input as Record<string, unknown>) : {});
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const bool = (v: unknown) => v === true || v === 1 || v === "1" || v === "t" || v === "true";

async function studio(sql: Sql, userId: string) {
  const { canRunStudio } = await import("@/lib/porch/fm");
  return canRunStudio(sql, userId);
}

export type BiblePiece = { id: number; piece: number; url: string; startSec: number; durationSec: number };
export type BibleBookAudio = { id: number; book: number; name: string; status: string; error: string; durationSec: number; pieces: BiblePiece[] };

export const bibleDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { ok: false as const };
    const server = await import("@/lib/porch/bible-radio.server");
    await server.resendStuckBible(sql);
    const books = await sql.query<{ id: number; book: number; status: string; error: string; duration_sec: number }>(
      "select id, book, status, error, duration_sec from bible_audio_books order by book asc, id asc",
    );
    const pieces = await sql.query<{ id: number; book_id: number; chapter: number; url: string; start_sec: number; duration_sec: number }>(
      "select id, book_id, chapter, url, start_sec, duration_sec from bible_audio_chapters order by chapter asc",
    );
    const set = await sql.query<{ readings_on: unknown; every_items: number }>("select readings_on, every_items from bible_settings where id = 1");
    await server.ensureReadings(sql);
    const coming = await sql.query<{ ms: string | number; track_id: number }>(
      "select (extract(epoch from starts_at) * 1000)::bigint as ms, track_id from fm_breaks where created_by = 'bible' and starts_at > now() - interval '10 minutes' order by starts_at asc limit 8",
    );
    const pieceOf = new Map(pieces.map((p) => [Number(p.id) + server.BIBLE_ID_BASE, p]));
    const bookOf = new Map(books.map((b) => [Number(b.id), Number(b.book)]));
    return {
      coming: coming
        .map((r) => {
          const p = pieceOf.get(Number(r.track_id));
          return p ? { at: Number(r.ms), title: `${server.bookName(bookOf.get(Number(p.book_id)) ?? 1)} reading ${p.chapter}`, durationSec: Number(p.duration_sec) } : null;
        })
        .filter((x): x is { at: number; title: string; durationSec: number } => Boolean(x)),
      ok: true as const,
      books: books.map(
        (b): BibleBookAudio => ({
          id: Number(b.id),
          book: Number(b.book),
          name: server.bookName(Number(b.book)),
          status: b.status,
          error: b.error,
          durationSec: Number(b.duration_sec),
          pieces: pieces
            .filter((p) => Number(p.book_id) === Number(b.id))
            .map((p) => ({ id: Number(p.id), piece: Number(p.chapter), url: p.url, startSec: Number(p.start_sec), durationSec: Number(p.duration_sec) })),
        }),
      ),
      settings: { on: bool(set[0]?.readings_on), every: Number(set[0]?.every_items ?? 3) },
    };
  });

/** A book's audio (already uploaded to storage): cut it into ~3-minute pieces. Replaces that book if it was there. */
export const addBibleBook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ book: Math.round(num(rec(input).book)), url: String(rec(input).url ?? "") }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { ok: false as const, error: "Only the Studio can do this." };
    if (data.book < 1 || data.book > 66) return { ok: false as const, error: "Choose the book." };
    if (!(await (await import("@/lib/porch/audio-store.server")).isStoreUrl(sql, data.url))) return { ok: false as const, error: "The upload didn't finish. Try again." };
    const { keepOnAir } = await import("@/lib/porch/fm");
    const made = await keepOnAir(sql, async () => {
      await sql.query("delete from bible_audio_books where book = $1", [data.book]);
      return sql.query<{ id: number }>("insert into bible_audio_books (book, file_url, status) values ($1, $2, 'splitting') returning id", [data.book, data.url]);
    });
    const { requestSplit, clearComingReadings, ensureReadings } = await import("@/lib/porch/bible-radio.server");
    await requestSplit(sql, Number(made[0].id));
    await clearComingReadings(sql);
    await ensureReadings(sql, true);
    return { ok: true as const };
  });

/** Remove a book from the readings. */
export const dropBibleBook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: num(rec(input).id) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { ok: false as const, error: "Only the Studio can do this." };
    const { keepOnAir } = await import("@/lib/porch/fm");
    const server = await import("@/lib/porch/bible-radio.server");
    await server.clearComingReadings(sql);
    await keepOnAir(sql, () => sql.query("delete from bible_audio_books where id = $1", [data.id]));
    await server.ensureReadings(sql, true);
    return { ok: true as const };
  });

/** Readings on or off, and after how many Radio items each piece plays. */
export const saveBibleSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ on: rec(input).on === true, every: Math.max(1, Math.min(20, Math.round(num(rec(input).every)) || 3)) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { ok: false as const, error: "Only the Studio can do this." };
    const server = await import("@/lib/porch/bible-radio.server");
    await server.clearComingReadings(sql);
    // Readings on/off also starts or pauses the nugget breaks: the item on air is held, not cut.
    const { keepOnAir } = await import("@/lib/porch/fm");
    await keepOnAir(sql, () => sql.query("update bible_settings set readings_on = $1, every_items = $2 where id = 1", [data.on, data.every]));
    await server.ensureReadings(sql, true);
    return { ok: true as const };
  });

/** Move where a reading starts (earlier: negative seconds; later: positive). The reading before it is re-cut with it. */
export const moveBiblePiece = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: num(rec(input).id), deltaSec: Math.max(-120, Math.min(120, num(rec(input).deltaSec))) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await studio(sql, context.userId))) return { ok: false as const, error: "Only the Studio can do this." };
    if (!data.deltaSec) return { ok: false as const, error: "Move it earlier or later first." };
    const cur = await sql.query<{ book_id: number; chapter: number; url: string }>("select book_id, chapter, url from bible_audio_chapters where id = $1", [data.id]);
    if (!cur[0]) return { ok: false as const, error: "That reading is gone." };
    const prev = await sql.query<{ chapter: number; url: string; duration_sec: number }>(
      "select chapter, url, duration_sec from bible_audio_chapters where book_id = $1 and chapter = $2",
      [cur[0].book_id, Number(cur[0].chapter) - 1],
    );
    if (!prev[0]) return { ok: false as const, error: "The first reading's start can't move." };
    const { randomBytes } = await import("node:crypto");
    const token = randomBytes(24).toString("hex");
    await sql.query("update bible_audio_books set job_token = $2, job_started_at = now(), status = 'moving', error = '' where id = $1", [cur[0].book_id, token]);
    const { audioWorkerBase } = await import("@/lib/porch/audio-worker.server");
    try {
      await fetch(`${audioWorkerBase()}/bible/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jobToken: token,
          bookId: Number(cur[0].book_id),
          prevUrl: prev[0].url,
          curUrl: cur[0].url,
          prevPiece: Number(prev[0].chapter),
          curPiece: Number(cur[0].chapter),
          prevLen: Number(prev[0].duration_sec),
          deltaSec: data.deltaSec,
        }),
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      /* waking up: the job usually still lands */
    }
    return { ok: true as const };
  });
