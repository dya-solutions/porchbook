/**
 * Porchbook Radio timing. Pure functions, shared by server and phones, so every
 * listener works out the same thing for the same moment -- that is what
 * makes it feel like radio. No streaming server is needed.
 *
 * Times are Kampala time (UTC+3, no daylight saving).
 */
export type FmTrack = {
  id: number;
  title: string;
  kind: string;
  url: string;
  durationSec: number;
  trimmed?: boolean;
  processed?: boolean;
  processing?: boolean;
  processError?: string;
  /** Play the devotional's strings softly under it. */
  strings?: boolean;
  /** A Nugget (station break): which one, who, its tags, and after how many items they play. */
  nugget?: { id: number; speaker: string; tags: string[]; every: number; rotate?: boolean };
  /** A Bible reading piece (about 5 minutes of a book): which book, its place in the book, and the book's length. */
  bible?: { book: number; name: string; chapter: number; fromSec?: number; bookSec?: number };
  /** In the station-break rotation: one of these plays after every this-many items, taking turns in order. */
  breakEvery?: number;
};

/** A Bible reading chapter: plays only at the reading times (or when the Studio plays it). */
export function isBibleReading(track: FmTrack) {
  return track.kind === "bible";
}

/** A Nugget: a short clip played between items, like a station break. */
export function isNugget(track: FmTrack) {
  return track.kind === "nugget";
}

/** An uploaded video waits off-air until its sound has been taken out. */
export function isVideoFile(url: string) {
  return /\.(mp4|m4v|mov|webm|mkv|3gp|avi)(\?|$)/i.test(url);
}
export type FmProgramme = { id: number; name: string; days: number[]; startMin: number; endMin: number; trackIds: number[]; shuffle?: boolean };

/** A "Play now" from the studio: this recording cuts in for everyone at startsAtMs. */
export type FmBreak = { id: number; trackId: number; startsAtMs: number; shift?: FmShift | null; message?: string; hold?: FmHold | null; plain?: boolean };
/**
 * A "hold" is written when the studio changes the list (an upload, a removal,
 * a new type or length). It keeps the item that was on air playing to its end,
 * from where it was, so nobody hears a jump; its shift then starts the new list
 * with a fresh item right when the held one finishes.
 */
export type FmHold = { fromSec: number; lenSec: number; cutEarly?: boolean };
/**
 * After a "Play now" the station carries on with the NEXT item in the list
 * (not where the clock would be). That moves the list's timeline by ms, but
 * only within the same programme slot (or the all-day rotation): context.
 */
export type FmShift = { context: string; ms: number };

export type OnAir = {
  programme: string; // programme name, or "Porchbook Radio" for the rotation
  track: FmTrack;
  offsetSec: number; // where in the track "now" is
  endsAtMs: number; // when this track finishes (epoch ms)
  slotEndsAtMs: number | null; // when the programme slot ends, if in one
  cutEarly?: boolean; // a song stopped before its end for a jingle: fade it out
  breakId?: number; // set while a studio "Play now" is on air
};

const KAMPALA_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Fixed start for the all-day rotation (a Monday, midnight Kampala time).
const ROTATION_ANCHOR_MS = Date.UTC(2026, 0, 5) - KAMPALA_MS;

function kampala(nowMs: number) {
  const local = new Date(nowMs + KAMPALA_MS);
  const day = local.getUTCDay();
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const midnightMs = nowMs - ((nowMs + KAMPALA_MS) % DAY_MS);
  return { day, minute, midnightMs };
}

/** The programme on air now (handles slots that run past midnight). */
export function programmeAt(programmes: FmProgramme[], nowMs: number): { programme: FmProgramme; startMs: number; endMs: number } | null {
  const { day, minute, midnightMs } = kampala(nowMs);
  for (const p of programmes) {
    if (p.endMin > p.startMin) {
      if (p.days.includes(day) && minute >= p.startMin && minute < p.endMin) {
        return { programme: p, startMs: midnightMs + p.startMin * 60000, endMs: midnightMs + p.endMin * 60000 };
      }
    } else if (p.endMin < p.startMin) {
      // Overnight slot, e.g. 22:00 - 01:00.
      if (p.days.includes(day) && minute >= p.startMin) {
        return { programme: p, startMs: midnightMs + p.startMin * 60000, endMs: midnightMs + DAY_MS + p.endMin * 60000 };
      }
      const yesterday = (day + 6) % 7;
      if (p.days.includes(yesterday) && minute < p.endMin) {
        return { programme: p, startMs: midnightMs - DAY_MS + p.startMin * 60000, endMs: midnightMs + p.endMin * 60000 };
      }
    }
  }
  return null;
}

// How items end (Kampala's Porchbook Radio format):
// - Songs (a minute or longer) are not left to end: 30 seconds before the end
//   they fade quickly and a jingle plays (every song), then the next item.
//   After every 3rd song the station ID follows the jingle.
// - Sermons, readings and other long items play in full, then the station ID.
// - Items under a minute play in full with nothing after them.
export const ID_AFTER_MIN_SEC = 60;
export const SONG_CUT_SEC = 30;
// After every this-many songs, the station ID follows the jingle.
export const ID_EVERY_SONGS = 3;
// Set above 0 only for testing: each item then plays at most this long.
export const TEST_ITEM_CAP_SEC = 0;
// Porch Jingo every 2 minutes and the 30-second station ID (early tests): off.
export const CLOCK_CUT_INS = false;

type Segment = { track: FmTrack; len: number; cutEarly?: boolean };

/** The items in order, each followed by its jingle or station ID. */
type NuggetPlan = { list: FmTrack[]; every: number; start: number };

function segmentsOf(list: FmTrack[], ids: FmTrack[], jingles: FmTrack[], intros: FmTrack[] = [], nug?: NuggetPlan): Segment[] {
  const out: Segment[] = [];
  // Nuggets: one after every `every` items (after the item's jingle or station ID), taking turns.
  let itemTurn = 0;
  let nugTurn = 0;
  const afterItem = () => {
    itemTurn += 1;
    if (!nug || !nug.list.length || itemTurn % nug.every !== 0) return;
    const n = nug.list[(nug.start + nugTurn++) % nug.list.length];
    out.push({ track: n, len: n.durationSec });
  };
  let introTurn = 0;
  let idTurn = 0;
  let jingleTurn = 0;
  let songTurn = 0;
  const nextId = () => ids[idTurn++ % ids.length];
  // Jingles play in a mixed order (the same on every phone), never the same one twice in a row.
  let lastJingle = -1;
  const nextJingle = (after: FmTrack) => {
    const n = jingles.length;
    let pick = Math.abs((after.id * 2654435761 + jingleTurn++ * 40503) | 0) % n;
    if (n > 1 && pick === lastJingle) pick = (pick + 1) % n;
    lastJingle = pick;
    return jingles[pick];
  };
  for (const track of list) {
    if (track.durationSec <= 0.5) continue;
    // The news intro plays right before every news item (after any station ID).
    if (track.kind === "news" && intros.length) {
      const intro = intros[introTurn++ % intros.length];
      out.push({ track: intro, len: intro.durationSec });
    }
    const long = track.durationSec >= ID_AFTER_MIN_SEC;
    const capped = TEST_ITEM_CAP_SEC > 0 ? Math.min(track.durationSec, TEST_ITEM_CAP_SEC) : track.durationSec;
    if (long && track.kind === "music" && (ids.length || jingles.length)) {
      // Song: cut 30 s before the end, then a jingle after every song;
      // after every 3rd song the station ID follows the jingle.
      const len = Math.min(capped, track.durationSec - SONG_CUT_SEC);
      out.push({ track, len, cutEarly: true });
      songTurn += 1;
      if (jingles.length) {
        const jingle = nextJingle(track);
        out.push({ track: jingle, len: jingle.durationSec });
      }
      if (ids.length && (!jingles.length || songTurn % ID_EVERY_SONGS === 0)) {
        const id = nextId();
        out.push({ track: id, len: id.durationSec });
      }
      afterItem();
      continue;
    }
    out.push({ track, len: capped, cutEarly: capped < track.durationSec - 0.5 });
    if (long && ids.length) {
      const id = nextId();
      out.push({ track: id, len: id.durationSec });
    }
    afterItem();
  }
  return out;
}

// ---- Shuffle ---------------------------------------------------------------
// Each time round, the list plays in a fresh order. The order is worked out
// the same way on every phone (seeded by the round number), so all listeners
// stay in step. Nothing plays twice in a row, and nothing comes back after just
// one other item: across the join between rounds, the first item of a round is
// never one of the last two of the round before, and the second never the last.

function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rawOrder(n: number, key: string, round: number) {
  const order = Array.from({ length: n }, (_, i) => i);
  const rand = seeded(`${key}:${round}`);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function fixStart(order: number[], last: number, beforeLast: number) {
  const n = order.length;
  if (n < 3) return order;
  // First: neither of the last two of the previous round.
  if (order[0] === last || order[0] === beforeLast) {
    const j = order.findIndex((v, i) => i > 0 && v !== last && v !== beforeLast);
    if (j > 0) [order[0], order[j]] = [order[j], order[0]];
  }
  // Second: not the very last of the previous round.
  if (order[1] === last) {
    const j = order.findIndex((v, i) => i > 1 && v !== last);
    if (j > 1) [order[1], order[j]] = [order[j], order[1]];
  }
  return order;
}

const orderMemo = new Map<string, { block: number; round: number; order: number[] }>();
const BLOCK = 500; // rounds are worked out in blocks, so every phone gets the same answer quickly

/** The order of a list for a given round (rounds counted from the anchor). */
function roundOrder(n: number, key: string, round: number): number[] {
  if (n <= 2) return Array.from({ length: n }, (_, i) => i); // too few to shuffle
  const block = Math.floor(round / BLOCK) * BLOCK;
  const memo = orderMemo.get(key);
  let r: number;
  let order: number[];
  if (memo && memo.block === block && memo.round <= round) {
    r = memo.round;
    order = memo.order;
  } else {
    r = block;
    order = rawOrder(n, key, block);
  }
  // Walk forward round by round: each round depends on how the last one ended.
  while (r < round) {
    r += 1;
    order = fixStart(rawOrder(n, key, r), order[n - 1], order[n - 2]);
  }
  orderMemo.set(key, { block, round, order });
  if (orderMemo.size > 50) orderMemo.delete(orderMemo.keys().next().value as string);
  return order;
}

/** The segments of one round, the round number, and where "now" falls in it. */
function roundAt(list: FmTrack[], ids: FmTrack[], jingles: FmTrack[], timelineSec: number, shuffle: boolean, intros: FmTrack[] = [], nuggets: FmTrack[] = []) {
  const plain = segmentsOf(list, ids, jingles, intros);
  const base = plain.reduce((sum, seg) => sum + seg.len, 0);
  if (!plain.length || base <= 0) return null;
  const playable = list.filter((t) => t.durationSec > 0.5);
  const every = Math.max(1, nuggets[0]?.breakEvery ?? 3);
  const perRound = nuggets.length ? Math.floor(playable.length / every) : 0;
  const ordered = (round: number) => {
    if (!shuffle) return list;
    const key = playable.map((t) => t.id).join(",");
    return roundOrder(playable.length, key, round).map((i) => playable[i]);
  };
  if (!perRound) {
    const round = Math.floor(timelineSec / base);
    const into = timelineSec - round * base;
    return { segments: shuffle ? segmentsOf(ordered(round), ids, jingles, intros) : plain, total: base, round, into };
  }
  // With nuggets each round is a little longer, by the nuggets it plays. They take turns across rounds,
  // so over (number of nuggets) rounds every nugget plays the same number of times: that block always
  // lasts the same, which lets every phone find the same round quickly.
  const n = nuggets.length;
  const lens = nuggets.map((t) => t.durationSec);
  const roundTotal = (r: number) => {
    let sum = base;
    for (let k = 0; k < perRound; k += 1) sum += lens[(((r * perRound + k) % n) + n) % n];
    return sum;
  };
  const block = n * base + perRound * lens.reduce((a, b) => a + b, 0);
  const blockNo = Math.floor(timelineSec / block);
  let into = timelineSec - blockNo * block;
  let round = blockNo * n;
  for (let guard = 0; guard < n && into >= roundTotal(round); guard += 1) {
    into -= roundTotal(round);
    round += 1;
  }
  const start = (((round * perRound) % n) + n) % n;
  return { segments: segmentsOf(ordered(round), ids, jingles, intros, { list: nuggets, every, start }), total: roundTotal(round), round, into };
}

/** Position in a looping list of tracks that started at anchorMs. */
function positionIn(list: FmTrack[], anchorMs: number, nowMs: number, ids: FmTrack[] = [], jingles: FmTrack[] = [], shuffle = false, intros: FmTrack[] = [], nuggets: FmTrack[] = []) {
  const at = roundAt(list, ids, jingles, (nowMs - anchorMs) / 1000, shuffle, intros, nuggets);
  if (!at) return null;
  let into = at.into;
  for (const seg of at.segments) {
    if (into < seg.len) {
      return { track: seg.track, offsetSec: into, endsAtMs: nowMs + (seg.len - into) * 1000, cutEarly: Boolean(seg.cutEarly) };
    }
    into -= seg.len;
  }
  const first = at.segments[0];
  return { track: first.track, offsetSec: 0, endsAtMs: nowMs + first.len * 1000 };
}

// Jingles cut in on the clock, every JINGLE_EVERY_MIN minutes (Kampala time),
// over whatever is playing; when the jingle ends the station rejoins live.
// Every 2 minutes is for testing; it will be scheduled properly later.
export const JINGLE_EVERY_MIN = 2;
const JINGLE_EVERY_MS = JINGLE_EVERY_MIN * 60000;

/** A jingle is marked "Jingle" in the studio (or titled e.g. "Porch Jingo"). */
/** A news intro: marked "News intro", or titled with "news intro" (also NEWS_INTRO). Plays before each news item. */
export function isNewsIntro(track: FmTrack) {
  if (track.kind === "nugget" || track.kind === "bible") return false;
  return track.kind === "newsintro" || (track.kind !== "jingle" && track.kind !== "station" && /news[\s_-]*intro/i.test(track.title));
}

export function isJingle(track: FmTrack) {
  if (track.kind === "nugget" || track.kind === "bible") return false;
  return !isNewsIntro(track) && (track.kind === "jingle" || /\bjing(le|o)\b/i.test(track.title));
}

/** A station ID ("You are listening to Porchbook Radio…"): marked "Station ID" or titled with "listening". */
export function isStationId(track: FmTrack) {
  if (track.kind === "nugget" || track.kind === "bible") return false;
  return !isJingle(track) && !isNewsIntro(track) && (track.kind === "station" || /\blistening\b/i.test(track.title));
}

// The station ID follows the jingle, this long after the jingle ends (testing).
export const STATION_ID_GAP_SEC = 30;

export function onAirAt(everyTrack: FmTrack[], programmes: FmProgramme[], nowMs: number, breaks: FmBreak[] = []): OnAir | null {
  const allTracks = everyTrack.filter((t) => !isVideoFile(t.url));
  // The latest "Play now" that has started decides where the list carries on from.
  const begun = breaks.filter((b) => b.startsAtMs <= nowMs && b.shift).sort((a, b) => b.startsAtMs - a.startsAtMs)[0];
  const base = scheduledAt(allTracks, programmes, nowMs, begun?.shift ?? null);
  if (!breaks.length) return base;
  const byId = new Map(allTracks.map((t) => [t.id, t]));
  const ids = allTracks.filter((t) => isStationId(t) && t.durationSec > 0.5);
  const intros = allTracks.filter((t) => isNewsIntro(t) && t.durationSec > 0.5);
  const jingles = allTracks.filter((t) => isJingle(t) && t.durationSec > 0.5);
  // A studio "Play now" interrupts whatever is on: a jingle first for a song (the
  // station ID for anything else), then the recording; afterwards the station rejoins live.
  // The newest one wins: a "Play now" interrupts anything on, even an earlier "Play now"
  // or a song being held while the list changed.
  const newestFirst = [...breaks].sort((a, b) => b.startsAtMs - a.startsAtMs || b.id - a.id);
  // Whatever is on is cut (with a quick fade) the moment a newer "Play now" starts.
  const cutAt = (startMs: number, endMs: number) => {
    const later = breaks.filter((x) => (!x.hold || x.hold.lenSec < 1) && byId.has(x.trackId) && x.startsAtMs > startMs && x.startsAtMs > nowMs && x.startsAtMs < endMs);
    return later.length ? Math.min(...later.map((x) => x.startsAtMs)) : null;
  };
  // Once a newer one has started, older ones are over (e.g. a hold the founder's Next replaced).
  const latestStart = Math.max(-Infinity, ...breaks.filter((b) => b.startsAtMs <= nowMs).map((b) => b.startsAtMs));
  for (const b of newestFirst) {
    if (b.startsAtMs < latestStart) continue;
    const track = byId.get(b.trackId);
    if (!track) continue;
    if (b.hold) {
      const endMs = b.startsAtMs + b.hold.lenSec * 1000;
      if (nowMs >= b.startsAtMs && nowMs < endMs) {
        const cut = cutAt(b.startsAtMs, endMs);
        return {
          programme: base?.programme ?? "Porchbook Radio",
          track,
          offsetSec: b.hold.fromSec + (nowMs - b.startsAtMs) / 1000,
          endsAtMs: cut ?? endMs,
          slotEndsAtMs: base?.slotEndsAtMs ?? null,
          ...(b.hold.cutEarly || cut ? { cutEarly: true } : {}),
        };
      }
      continue;
    }
    // A planned Bible reading plays on its own; a "Play now" brings its jingle.
    const parts = b.plain ? [track] : breakParts(track, ids, b.id, intros, jingles);
    let startMs = b.startsAtMs;
    for (const part of parts) {
      const endMs = startMs + part.durationSec * 1000;
      if (nowMs >= startMs && nowMs < endMs) {
        const cut = cutAt(b.startsAtMs, endMs);
        return {
          programme: base?.programme ?? "Porchbook Radio",
          track: part,
          offsetSec: (nowMs - startMs) / 1000,
          endsAtMs: cut ?? endMs,
          slotEndsAtMs: base?.slotEndsAtMs ?? null,
          breakId: b.id,
          ...(cut ? { cutEarly: true } : {}),
        };
      }
      startMs = endMs;
    }
  }
  if (!base) return null;
  // A coming "Play now" (or the founder's Next, a near-zero hold) cuts what's on, with a quick fade.
  const next = breaks.filter((b) => (!b.hold || b.hold.lenSec < 1) && b.startsAtMs > nowMs && byId.has(b.trackId)).map((b) => b.startsAtMs);
  if (!next.length) return base;
  const soonest = Math.min(...next);
  if (soonest >= base.endsAtMs) return base;
  return { ...base, endsAtMs: soonest, cutEarly: true };
}

/**
 * What a "Play now" plays, in order: a jingle first (whatever it plays: a song, a sermon, a nugget,
 * a Bible reading), the news intro for news, then the recording. Without jingles, the station ID instead.
 */
export function breakParts(track: FmTrack, ids: FmTrack[], breakId: number, intros: FmTrack[] = [], jingles: FmTrack[] = []): FmTrack[] {
  if (isStationId(track) || isJingle(track) || isNewsIntro(track)) return [track];
  const parts: FmTrack[] = [];
  if (jingles.length) parts.push(jingles[breakId % jingles.length]);
  else if (ids.length) parts.push(ids[breakId % ids.length]);
  if (track.kind === "news" && intros.length) parts.push(intros[breakId % intros.length]);
  parts.push(track);
  return parts;
}

/** How long a "Play now" lasts, jingle or station ID included. */
export function breakLengthSec(track: FmTrack, allTracks: FmTrack[], breakId: number) {
  const ids = allTracks.filter((t) => isStationId(t) && t.durationSec > 0.5);
  const intros = allTracks.filter((t) => isNewsIntro(t) && t.durationSec > 0.5);
  const jingles = allTracks.filter((t) => isJingle(t) && t.durationSec > 0.5);
  return breakParts(track, ids, breakId, intros, jingles).reduce((sum, t) => sum + t.durationSec, 0);
}

function scheduledAt(allTracks: FmTrack[], programmes: FmProgramme[], nowMs: number, shift?: FmShift | null): OnAir | null {
  const jingles = allTracks.filter((t) => isJingle(t) && t.durationSec > 0.5);
  const ids = allTracks.filter((t) => isStationId(t) && t.durationSec > 0.5);
  const intros = allTracks.filter((t) => isNewsIntro(t) && t.durationSec > 0.5);
  const nuggets = allTracks.filter((t) => (t.breakEvery ?? 0) > 0 && t.durationSec > 0.5);
  const tracks = allTracks.filter((t) => !isJingle(t) && !isStationId(t) && !isNewsIntro(t) && !isNugget(t) && !isBibleReading(t));
  const regular = regularAt(tracks, programmes, nowMs, ids, jingles, shift, intros, nuggets);
  if (!CLOCK_CUT_INS || (!jingles.length && !ids.length)) return regular;
  const boundary = Math.floor(nowMs / JINGLE_EVERY_MS) * JINGLE_EVERY_MS;
  const nextBoundary = boundary + JINGLE_EVERY_MS;
  const turn = Math.floor(boundary / JINGLE_EVERY_MS);
  // Several jingles / station IDs take turns.
  const jingle = jingles.length ? jingles[turn % jingles.length] : null;
  const id = ids.length ? ids[turn % ids.length] : null;
  const jingleEnd = boundary + (jingle ? jingle.durationSec * 1000 : 0);
  const idStart = jingleEnd + STATION_ID_GAP_SEC * 1000;
  const idEnd = id ? Math.min(idStart + id.durationSec * 1000, nextBoundary) : idStart;
  const cutIn = (track: FmTrack, startMs: number, endMs: number): OnAir => ({
    programme: regular?.programme ?? "Porchbook Radio",
    track,
    offsetSec: (nowMs - startMs) / 1000,
    endsAtMs: endMs,
    slotEndsAtMs: regular?.slotEndsAtMs ?? null,
  });
  if (jingle && nowMs < jingleEnd) return cutIn(jingle, boundary, jingleEnd);
  if (id && idStart < nextBoundary && nowMs >= idStart && nowMs < idEnd) return cutIn(id, idStart, idEnd);
  if (!regular) return null;
  const nextCut = id && nowMs < idStart && idStart < nextBoundary ? idStart : nextBoundary;
  return { ...regular, endsAtMs: Math.min(regular.endsAtMs, nextCut) };
}

function shiftFor(shift: FmShift | null | undefined, context: string) {
  return shift && shift.context === context ? shift.ms : 0;
}

function regularAt(tracks: FmTrack[], programmes: FmProgramme[], nowMs: number, ids: FmTrack[], jingles: FmTrack[], shift?: FmShift | null, intros: FmTrack[] = [], nuggets: FmTrack[] = []): OnAir | null {
  const slot = programmeAt(programmes, nowMs);
  if (slot) {
    const byId = new Map(tracks.map((t) => [t.id, t]));
    const list = slot.programme.trackIds.map((id) => byId.get(id)).filter((t): t is FmTrack => Boolean(t));
    const context = `slot:${slot.programme.id}:${slot.startMs}`;
    const at = positionIn(list, slot.startMs + shiftFor(shift, context), nowMs, ids, jingles, Boolean(slot.programme.shuffle), intros, nuggets);
    if (at) {
      return {
        programme: slot.programme.name,
        ...at,
        endsAtMs: Math.min(at.endsAtMs, slot.endMs),
        slotEndsAtMs: slot.endMs,
      };
    }
  }
  const frame = rotationFrame(tracks, ids, jingles, intros, nuggets, programmes, nowMs);
  const at = positionIn(tracks, frame.anchor + shiftFor(shift, frame.context), nowMs, ids, jingles, true, intros, nuggets);
  if (!at) return null;
  // The rotation gives way when the next programme starts.
  const next = nextProgrammeStart(programmes, nowMs);
  return { programme: "Porchbook Radio", ...at, endsAtMs: next ? Math.min(at.endsAtMs, next) : at.endsAtMs, slotEndsAtMs: null };
}

/** When the last programme (one with recordings) ended, at or before nowMs (looking back a week). */
export function lastProgrammeEnd(programmes: FmProgramme[], nowMs: number): number | null {
  const { midnightMs } = kampala(nowMs);
  let best: number | null = null;
  for (let back = 0; back <= 8; back += 1) {
    const dayMid = midnightMs - back * DAY_MS;
    const day = new Date(dayMid + KAMPALA_MS).getUTCDay();
    for (const p of programmes) {
      if (!p.days.includes(day) || !p.trackIds.length || p.endMin === p.startMin) continue;
      const end = dayMid + p.endMin * 60000 + (p.endMin < p.startMin ? DAY_MS : 0);
      if (end <= nowMs && (best === null || end > best)) best = end;
    }
  }
  return best;
}

/**
 * Where the all-day rotation's timeline is anchored. After a programme ends, the rotation comes back
 * with a fresh item from its beginning (the item the programme interrupted is not resumed mid-way):
 * its timeline from then on starts at the next item boundary after where the rotation would have been.
 * Each stretch between programmes has its own context, so a "Play now" shift only applies within it.
 */
const frameMemo = new Map<string, { anchor: number; context: string }>();
function rotationFrame(tracks: FmTrack[], ids: FmTrack[], jingles: FmTrack[], intros: FmTrack[], nuggets: FmTrack[], programmes: FmProgramme[], nowMs: number) {
  const end = lastProgrammeEnd(programmes, nowMs);
  if (end === null) return { anchor: ROTATION_ANCHOR_MS, context: "rotation" };
  const key = `${end}|${tracks.map((t) => `${t.id}:${t.durationSec}`).join(",")}|${nuggets.length}|${ids.length}|${jingles.length}|${intros.length}`;
  const kept = frameMemo.get(key);
  if (kept) return kept;
  let anchor = ROTATION_ANCHOR_MS;
  const g = (end - ROTATION_ANCHOR_MS) / 1000;
  const round = roundAt(tracks, ids, jingles, g, true, intros, nuggets);
  if (round) {
    const { segments, total, into } = round;
    let at = 0;
    let index = 0;
    for (; index < segments.length; index += 1) {
      if (into < at + segments[index].len) break;
      at += segments[index].len;
    }
    // Just begun (within a second): keep it. Otherwise the next real item (jingles and station IDs skipped).
    let next = at;
    if (into - at > 1) {
      next = at + (segments[index]?.len ?? 0);
      for (let j = index + 1; j < segments.length; j += 1) {
        const seg = segments[j];
        if (!isJingle(seg.track) && !isStationId(seg.track)) break;
        next += seg.len;
      }
      if (next > total) next = total;
    }
    const up = g - into + next; // the rotation's timeline when the programme ends
    anchor = end - up * 1000;
  }
  const frame = { anchor, context: `rotation@${end}` };
  frameMemo.set(key, frame);
  if (frameMemo.size > 40) frameMemo.delete(frameMemo.keys().next().value as string);
  return frame;
}

/** When the next programme begins (within a week), in epoch ms. */
export function nextProgrammeStart(programmes: FmProgramme[], nowMs: number): number | null {
  const { midnightMs } = kampala(nowMs);
  let best: number | null = null;
  for (let ahead = 0; ahead < 8; ahead += 1) {
    const dayMid = midnightMs + ahead * DAY_MS;
    const day = new Date(dayMid + KAMPALA_MS).getUTCDay();
    for (const p of programmes) {
      if (!p.days.includes(day) || !p.trackIds.length) continue;
      const start = dayMid + p.startMin * 60000;
      if (start > nowMs && (best === null || start < best)) best = start;
    }
    if (best !== null) return best;
  }
  return best;
}

export function clockLabel(minutes: number) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Today's programmes in Kampala, in order. */
export function todaysProgrammes(programmes: FmProgramme[], nowMs: number) {
  const { day } = kampala(nowMs);
  return programmes.filter((p) => p.days.includes(day)).sort((a, b) => a.startMin - b.startMin);
}

/**
 * For a "Play now" starting at startMs and lasting breakLenMs: the timeline
 * shift so the station resumes with the item AFTER the one it interrupted
 * (skipping any jingle or station ID in between), right when the break ends.
 */
export function shiftAfterBreak(allTracks: FmTrack[], programmes: FmProgramme[], startMs: number, breakLenMs: number, current: FmShift | null): FmShift | null {
  const jingles = allTracks.filter((t) => isJingle(t) && t.durationSec > 0.5);
  const ids = allTracks.filter((t) => isStationId(t) && t.durationSec > 0.5);
  const intros = allTracks.filter((t) => isNewsIntro(t) && t.durationSec > 0.5);
  const nuggets = allTracks.filter((t) => (t.breakEvery ?? 0) > 0 && t.durationSec > 0.5);
  const tracks = allTracks.filter((t) => !isJingle(t) && !isStationId(t) && !isNewsIntro(t) && !isNugget(t) && !isBibleReading(t));
  const slot = programmeAt(programmes, startMs);
  let list = tracks;
  const frame = rotationFrame(tracks, ids, jingles, intros, nuggets, programmes, startMs);
  let anchor = frame.anchor;
  let context = frame.context;
  if (slot) {
    const byId = new Map(tracks.map((t) => [t.id, t]));
    const inSlot = slot.programme.trackIds.map((id) => byId.get(id)).filter((t): t is FmTrack => Boolean(t));
    if (segmentsOf(inSlot, ids, jingles, intros).length) {
      list = inSlot;
      anchor = slot.startMs;
      context = `slot:${slot.programme.id}:${slot.startMs}`;
    }
  }
  const shiftMs = shiftFor(current, context);
  const absolute = (startMs - anchor - shiftMs) / 1000; // seconds along the list's timeline
  const shuffle = context.startsWith("rotation") ? true : Boolean(slot?.programme.shuffle);
  const round = roundAt(list, ids, jingles, absolute, shuffle, intros, nuggets);
  if (!round) return current;
  const { segments, total, into } = round;
  const cycleStart = absolute - into;
  // Which segment is playing at the start of the break?
  let at = 0;
  let index = 0;
  for (; index < segments.length; index += 1) {
    if (into < at + segments[index].len) break;
    at += segments[index].len;
  }
  // The next real item after it (jingles and station IDs are skipped).
  let nextAt = at + (segments[index]?.len ?? 0);
  for (let j = index + 1; j < segments.length; j += 1) {
    const seg = segments[j];
    if (!isJingle(seg.track) && !isStationId(seg.track)) break;
    nextAt += seg.len;
  }
  // Past the end of this round: the next round starts with a real item.
  if (nextAt > total) nextAt = total;
  const nextTimeline = cycleStart + nextAt;
  return { context, ms: Math.round(startMs + breakLenMs - anchor - nextTimeline * 1000) };
}
