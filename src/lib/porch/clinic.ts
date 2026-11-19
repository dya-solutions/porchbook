import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { TOPIC_KEYS } from "@/lib/porch/clinic-topics";

/**
 * Porchbook Clinic: sermons sorted by what people are believing God for, and "Ask a Pastor".
 * Members ask; the founder groups questions that ask the same thing, sends them to pastors as a PDF,
 * and once a month members vote on the most-asked ones: Apostle Grace answers the winner.
 * Until the founder launches it, only the founder sees any of this.
 */

function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}
function rec(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}
function clip(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}
function iso(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

const KAMPALA_MS = 3 * 60 * 60 * 1000;
/** "2026-11" for a moment, in Kampala. */
export function monthKey(ms: number) {
  return new Date(ms + KAMPALA_MS).toISOString().slice(0, 7);
}
/** The moment a Kampala month ends. */
function monthEndMs(ms: number) {
  const local = new Date(ms + KAMPALA_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - KAMPALA_MS;
}
export function monthName(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 15)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

let ready = false;
async function ensureClinic(sql: Sql) {
  if (ready) return;
  await sql.query("create table if not exists clinic_state (key text primary key, value text not null default '')");
  await sql.query("create table if not exists clinic_tags (track_id int not null, topic text not null, primary key (track_id, topic))");
  await sql.query(`create table if not exists clinic_groups (
    id serial primary key,
    wording text not null,
    created_at timestamptz not null default now(),
    sent_at timestamptz,
    answer_text text not null default '',
    answer_url text not null default '',
    answer_from_sec int not null default 0,
    answer_by text not null default '',
    answered_at timestamptz
  )`);
  await sql.query(`create table if not exists clinic_questions (
    id serial primary key,
    user_id text not null,
    body text not null,
    show_name boolean not null default false,
    created_at timestamptz not null default now(),
    group_id int,
    hidden boolean not null default false,
    sent_at timestamptz,
    answer_text text not null default '',
    answer_url text not null default '',
    answer_from_sec int not null default 0,
    answer_by text not null default '',
    answered_at timestamptz
  )`);
  await sql.query(`create table if not exists clinic_rounds (
    month text primary key,
    group_ids int[] not null,
    started_at timestamptz not null default now(),
    closes_at timestamptz not null,
    winner_group_id int,
    closed boolean not null default false
  )`);
  await sql.query("create table if not exists clinic_videos (topic text primary key, video_id text not null, title text not null default '', set_at timestamptz not null default now())");
  await sql.query("create table if not exists clinic_votes (month text not null, user_id text not null, group_id int not null, primary key (month, user_id))");
  ready = true;
}

async function isFounder(sql: Sql, userId: string) {
  const me = await sql.query<{ is_founder: unknown }>("select is_porch_admin($1) as is_founder", [userId]);
  return boolish(me[0]?.is_founder);
}
/** The founder launched the Clinic to everyone on 2 Nov 2026. */
const LAUNCHED = true;
async function isLaunched(sql: Sql) {
  if (LAUNCHED) return true;
  const rows = await sql.query<{ value: string }>("select value from clinic_state where key = 'launched'");
  return rows[0]?.value === "yes";
}
/** Who may use the Clinic right now: everyone once launched, only the founder before. */
async function access(sql: Sql, userId: string) {
  await ensureClinic(sql);
  const [founder, launched] = await Promise.all([isFounder(sql, userId), isLaunched(sql)]);
  return { founder, launched, show: founder || launched };
}

async function tell(sql: Sql, userId: string, body: string, tag: string) {
  const { tellListener } = await import("@/lib/porch/fm");
  const { notifyClinic } = await import("@/lib/porch/push.server");
  await tellListener(sql, userId, body);
  await notifyClinic(sql, userId, body.slice(0, 160), tag);
}

/** A month's vote closes by itself at the end of the month: the most votes wins (a tie goes to the question grouped first). */
async function closeDueRounds(sql: Sql) {
  const due = await sql.query<{ month: string; group_ids: number[] }>(
    "select month, group_ids from clinic_rounds where not closed and closes_at <= now()",
  );
  for (const round of due) {
    const counts = await sql.query<{ group_id: number; n: string | number }>(
      "select group_id, count(*) as n from clinic_votes where month = $1 group by group_id",
      [round.month],
    );
    const ids = (round.group_ids ?? []).map(Number);
    let winner = ids.slice().sort((a, b) => a - b)[0] ?? null;
    let best = -1;
    for (const id of ids.slice().sort((a, b) => a - b)) {
      const n = Number(counts.find((c) => Number(c.group_id) === id)?.n ?? 0);
      if (n > best) {
        best = n;
        winner = id;
      }
    }
    const claimed = await sql.query<{ month: string }>(
      "update clinic_rounds set closed = true, winner_group_id = $2 where month = $1 and not closed returning month",
      [round.month, winner],
    );
    if (!claimed.length || winner == null) continue;
    const words = await sql.query<{ wording: string }>("select wording from clinic_groups where id = $1", [winner]);
    const { founderOf } = await import("@/lib/porch/fm");
    const founder = await founderOf(sql);
    if (founder) {
      const { notifyClinic } = await import("@/lib/porch/push.server");
      await notifyClinic(sql, founder, `Question of the Month: "${words[0]?.wording ?? ""}" · ${best} ${best === 1 ? "vote" : "votes"}. It's in Apostle Grace's PDF.`, `clinic-winner-${round.month}`);
    }
  }
}

type Answer = { text: string; url: string; fromSec: number; by: string; at: string };
function answerOf(row: { answer_text: string; answer_url: string; answer_from_sec: number; answer_by: string; answered_at: unknown }): Answer | null {
  if (!row.answered_at) return null;
  return { text: row.answer_text ?? "", url: row.answer_url ?? "", fromSec: Number(row.answer_from_sec ?? 0), by: row.answer_by ?? "", at: iso(row.answered_at) };
}

// ---- For everyone (once launched): the cards, your questions, the vote.

export const clinicHome = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const me = await access(sql, context.userId);
    if (!me.show) return { show: false as const };
    await closeDueRounds(sql);
    const tracks = await sql.query<{ id: number; title: string; kind: string; url: string; duration_sec: number; play_sec: number | null; topics: string[] | null }>(
      `select t.id, t.title, t.kind, t.url, t.duration_sec, t.play_sec,
              (select array_agg(c.topic) from clinic_tags c where c.track_id = t.id) as topics
         from fm_tracks t
        where t.kind not in ('jingle', 'station', 'newsintro')
        order by t.created_at desc, t.id desc`,
    );
    const list = tracks
      .map((t) => ({
        id: Number(t.id),
        title: t.title,
        kind: t.kind,
        url: t.url,
        minutes: Math.max(1, Math.round(Number(t.play_sec ?? t.duration_sec ?? 0) / 60)),
        topics: (t.topics ?? []).filter(Boolean),
      }))
      // Members only see what's in a card; the founder also sees what could go in one.
      .filter((t) => me.founder || t.topics.length);

    const mineRows = await sql.query<{
      id: number; body: string; created_at: unknown; group_id: number | null;
      answer_text: string; answer_url: string; answer_from_sec: number; answer_by: string; answered_at: unknown;
      g_text: string | null; g_url: string | null; g_from: number | null; g_by: string | null; g_at: unknown;
    }>(
      `select q.id, q.body, q.created_at, q.group_id, q.answer_text, q.answer_url, q.answer_from_sec, q.answer_by, q.answered_at,
              g.answer_text as g_text, g.answer_url as g_url, g.answer_from_sec as g_from, g.answer_by as g_by, g.answered_at as g_at
         from clinic_questions q left join clinic_groups g on g.id = q.group_id
        where q.user_id = $1 and not q.hidden
        order by q.created_at desc limit 30`,
      [context.userId],
    );
    const rounds = await sql.query<{ month: string; group_ids: number[]; closes_at: unknown; winner_group_id: number | null; closed: unknown }>(
      "select month, group_ids, closes_at, winner_group_id, closed from clinic_rounds order by month desc limit 24",
    );
    const open = rounds.find((r) => !boolish(r.closed)) ?? null;
    const openIds = new Set((open?.group_ids ?? []).map(Number));
    const winners = new Set(rounds.filter((r) => boolish(r.closed) && r.winner_group_id != null).map((r) => Number(r.winner_group_id)));

    const mine = mineRows.map((q) => {
      const own = answerOf(q);
      const shared = q.group_id != null ? answerOf({ answer_text: q.g_text ?? "", answer_url: q.g_url ?? "", answer_from_sec: Number(q.g_from ?? 0), answer_by: q.g_by ?? "", answered_at: q.g_at }) : null;
      const answer = own ?? shared;
      const group = q.group_id != null ? Number(q.group_id) : 0;
      const status = answer ? "answered" : group && openIds.has(group) ? "vote" : group && winners.has(group) ? "apostle" : "waiting";
      return { id: Number(q.id), body: q.body, at: iso(q.created_at), status, answer };
    });

    let vote: null | { month: string; closesAt: string; myVote: number; options: { id: number; wording: string; asked: number; votes: number }[] } = null;
    if (open) {
      const ids = (open.group_ids ?? []).map(Number);
      const options = await sql.query<{ id: number; wording: string; asked: string | number; votes: string | number }>(
        `select g.id, g.wording,
                (select count(*) from clinic_questions q where q.group_id = g.id and not q.hidden) as asked,
                (select count(*) from clinic_votes v where v.month = $2 and v.group_id = g.id) as votes
           from clinic_groups g where g.id = any($1::int[]) order by g.id`,
        [ids, open.month],
      );
      const mineVote = await sql.query<{ group_id: number }>("select group_id from clinic_votes where month = $1 and user_id = $2", [open.month, context.userId]);
      vote = {
        month: open.month,
        closesAt: iso(open.closes_at),
        myVote: Number(mineVote[0]?.group_id ?? 0),
        options: options.map((o) => ({ id: Number(o.id), wording: o.wording, asked: Number(o.asked), votes: Number(o.votes) })),
      };
    }

    // Past Questions of the Month that Apostle Grace has answered.
    const hallRows = await sql.query<{
      month: string; wording: string; votes: string | number;
      answer_text: string; answer_url: string; answer_from_sec: number; answer_by: string; answered_at: unknown;
    }>(
      `select r.month, g.wording, (select count(*) from clinic_votes v where v.month = r.month and v.group_id = g.id) as votes,
              g.answer_text, g.answer_url, g.answer_from_sec, g.answer_by, g.answered_at
         from clinic_rounds r join clinic_groups g on g.id = r.winner_group_id
        where r.closed order by r.month desc limit 12`,
    );
    const hall = hallRows.map((h) => ({ month: h.month, monthName: monthName(h.month), wording: h.wording, votes: Number(h.votes), answer: answerOf(h) }));

    // One YouTube sermon per card, watched on the porch guy's screen.
    const videoRows = await sql.query<{ topic: string; video_id: string; title: string }>("select topic, video_id, title from clinic_videos");
    const videos: Record<string, { videoId: string; title: string }> = {};
    for (const v of videoRows) if (TOPIC_KEYS.has(v.topic)) videos[v.topic] = { videoId: v.video_id, title: v.title };

    return { show: true as const, founder: me.founder, launched: me.launched, tracks: list, mine, vote, hall, videos };
  });

/** Is the Clinic key on the tour for this person? */
export const clinicShown = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const me = await access(sql, context.userId);
    return { show: me.show, founder: me.founder, launched: me.launched };
  });

export const askClinic = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ body: clip(rec(input).body, 600), showName: boolish(rec(input).showName) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await access(sql, context.userId);
    if (!me.show) return { ok: false as const, error: "The Clinic isn't open yet." };
    if (data.body.length < 8) return { ok: false as const, error: "Write your question in a few more words." };
    const recent = await sql.query<{ n: string | number }>(
      "select count(*) as n from clinic_questions where user_id = $1 and created_at > now() - interval '1 day'",
      [context.userId],
    );
    if (Number(recent[0]?.n ?? 0) >= 3) return { ok: false as const, error: "You've asked 3 questions today. Ask again tomorrow." };
    const quiet = await sql.query<{ n: string | number }>("select count(*) as n from clinic_questions where created_at > now() - interval '30 minutes'");
    const rows = await sql.query<{ id: number }>(
      "insert into clinic_questions (user_id, body, show_name) values ($1, $2, $3) returning id",
      [context.userId, data.body, data.showName],
    );
    // The founder hears about new questions (not more than every half hour).
    if (!me.founder && Number(quiet[0]?.n ?? 0) === 0) {
      const { founderOf } = await import("@/lib/porch/fm");
      const founder = await founderOf(sql);
      if (founder) {
        const { notifyClinic } = await import("@/lib/porch/push.server");
        await notifyClinic(sql, founder, "A new question for the pastors is waiting in the Clinic.", "clinic-new");
      }
    }
    return { ok: true as const, id: Number(rows[0]?.id ?? 0) };
  });

export const voteClinic = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ groupId: Number(rec(input).groupId) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await access(sql, context.userId);
    if (!me.show) return { ok: false as const, error: "The Clinic isn't open yet." };
    await closeDueRounds(sql);
    const open = await sql.query<{ month: string; group_ids: number[] }>("select month, group_ids from clinic_rounds where not closed and closes_at > now() limit 1");
    const round = open[0];
    if (!round) return { ok: false as const, error: "Voting has closed." };
    if (!(round.group_ids ?? []).map(Number).includes(data.groupId)) return { ok: false as const, error: "That question isn't in this month's vote." };
    await sql.query(
      `insert into clinic_votes (month, user_id, group_id) values ($1, $2, $3)
       on conflict (month, user_id) do update set group_id = excluded.group_id`,
      [round.month, context.userId, data.groupId],
    );
    return { ok: true as const };
  });

// ---- The founder's desk.

async function founderOnly(sql: Sql, userId: string) {
  await ensureClinic(sql);
  return isFounder(sql, userId);
}

const STOP = new Set(
  "the and for are but not you your yours with this that what when where which who whom how why can could should would will shall may might must does did has have had was were been being his her him she they them their there here from into onto about over under than then also just very more most some any all each every our ours out off too who's what's i'm its it's let get got gets make made do am is be a an of to in on at by or as if it me my we us no so up go god lord jesus christ pastor apostle please help ask asking question questions know want need someone people person thing things way time".split(" "),
);
function stem(word: string) {
  return word.replace(/(ing|ed|es|s)$/, "");
}
function keyWords(text: string) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w))
      .map(stem)
      .filter((w) => w.length >= 3),
  );
}
/** Questions that seem to ask the same thing (sharing most of their key words). */
function sameQuestions(rows: { id: number; body: string }[]) {
  const sets = rows.map((r) => keyWords(r.body));
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = sets[i];
      const b = sets[j];
      if (!a.size || !b.size) continue;
      let shared = 0;
      a.forEach((w) => {
        if (b.has(w)) shared += 1;
      });
      if (shared >= 2 && shared / Math.min(a.size, b.size) >= 0.6) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  rows.forEach((_, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });
  return [...groups.values()].filter((g) => g.length >= 2).map((g) => g.map((i) => rows[i]));
}

export const clinicDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await founderOnly(sql, context.userId))) return { ok: false as const, error: "Only an admin sees the Clinic desk." };
    await closeDueRounds(sql);
    const qs = await sql.query<{
      id: number; body: string; show_name: unknown; created_at: unknown; group_id: number | null; sent_at: unknown; who: string | null;
      answer_text: string; answer_url: string; answer_from_sec: number; answer_by: string; answered_at: unknown;
    }>(
      `select q.id, q.body, q.show_name, q.created_at, q.group_id, q.sent_at, p.display_name as who,
              q.answer_text, q.answer_url, q.answer_from_sec, q.answer_by, q.answered_at
         from clinic_questions q left join profiles p on p.user_id = q.user_id
        where not q.hidden and (q.answered_at is null or q.answered_at > now() - interval '30 days')
        order by q.created_at desc limit 300`,
    );
    const groups = await sql.query<{
      id: number; wording: string; created_at: unknown; sent_at: unknown; asked: string | number;
      answer_text: string; answer_url: string; answer_from_sec: number; answer_by: string; answered_at: unknown;
    }>(
      `select g.id, g.wording, g.created_at, g.sent_at, g.answer_text, g.answer_url, g.answer_from_sec, g.answer_by, g.answered_at,
              (select count(*) from clinic_questions q where q.group_id = g.id and not q.hidden) as asked
         from clinic_groups g
        where g.answered_at is null or g.answered_at > now() - interval '60 days'
        order by asked desc, g.id asc`,
    );
    const rounds = await sql.query<{ month: string; group_ids: number[]; closes_at: unknown; winner_group_id: number | null; closed: unknown }>(
      "select month, group_ids, closes_at, winner_group_id, closed from clinic_rounds order by month desc limit 12",
    );
    const open = rounds.find((r) => !boolish(r.closed)) ?? null;
    const votes = await sql.query<{ group_id: number; n: string | number }>("select group_id, count(*) as n from clinic_votes group by group_id");
    const winnerOf = new Map(rounds.filter((r) => boolish(r.closed) && r.winner_group_id != null).map((r) => [Number(r.winner_group_id), r.month]));
    const loose = qs.filter((q) => q.group_id == null && !q.answered_at).map((q) => ({ id: Number(q.id), body: q.body }));
    return {
      ok: true as const,
      launched: await isLaunched(sql),
      questions: qs.map((q) => ({
        id: Number(q.id),
        body: q.body,
        who: boolish(q.show_name) ? (q.who ?? "").trim().split(/\s+/)[0] || "A member" : "A member",
        at: iso(q.created_at),
        groupId: q.group_id != null ? Number(q.group_id) : 0,
        sentAt: iso(q.sent_at),
        answer: answerOf(q),
      })),
      groups: groups.map((g) => ({
        id: Number(g.id),
        wording: g.wording,
        asked: Number(g.asked),
        sentAt: iso(g.sent_at),
        answer: answerOf(g),
        inVote: open ? (open.group_ids ?? []).map(Number).includes(Number(g.id)) : false,
        votes: Number(votes.find((v) => Number(v.group_id) === Number(g.id))?.n ?? 0),
        winnerMonth: winnerOf.get(Number(g.id)) ?? "",
      })),
      suggestions: sameQuestions(loose).map((set) => set.map((q) => q.id)),
      round: open ? { month: open.month, monthName: monthName(open.month), closesAt: iso(open.closes_at) } : null,
      thisMonth: monthKey(Date.now()),
      thisMonthDone: rounds.some((r) => r.month === monthKey(Date.now())),
    };
  });

/** Put questions together as one ("asked N times"), new or into an existing group. */
export const clinicGroup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    return {
      ids: Array.isArray(raw.ids) ? raw.ids.map(Number).filter((n) => n > 0).slice(0, 200) : [],
      groupId: Number(raw.groupId) || 0,
      wording: clip(raw.wording, 300),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await founderOnly(sql, context.userId))) return { ok: false as const, error: "Only an admin can group questions." };
    let groupId = data.groupId;
    if (!groupId) {
      let wording = data.wording;
      if (!wording && data.ids.length) {
        // No wording given: use the shortest of the questions.
        const bodies = await sql.query<{ body: string }>("select body from clinic_questions where id = any($1::int[])", [data.ids]);
        wording = bodies.map((b) => b.body).sort((a, b) => a.length - b.length)[0] ?? "";
      }
      if (wording.length < 6) return { ok: false as const, error: "Write the question the way members will read it." };
      const made = await sql.query<{ id: number }>("insert into clinic_groups (wording) values ($1) returning id", [wording]);
      groupId = Number(made[0]?.id ?? 0);
    } else if (data.wording) {
      await sql.query("update clinic_groups set wording = $2 where id = $1", [groupId, data.wording]);
    }
    if (data.ids.length) await sql.query("update clinic_questions set group_id = $1 where id = any($2::int[]) and answered_at is null", [groupId, data.ids]);
    return { ok: true as const, groupId };
  });

/** Take a question back out of its group (or empty a group). */
export const clinicUngroup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: Number(rec(input).id) || 0, groupId: Number(rec(input).groupId) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await founderOnly(sql, context.userId))) return { ok: false as const, error: "Only an admin can do this." };
    if (data.id) await sql.query("update clinic_questions set group_id = null where id = $1", [data.id]);
    if (data.groupId) {
      const busy = await sql.query<{ month: string }>("select month from clinic_rounds where $1 = any(group_ids)", [data.groupId]);
      if (busy.length) return { ok: false as const, error: "That question has been in a vote, so it stays." };
      await sql.query("update clinic_questions set group_id = null where group_id = $1", [data.groupId]);
      await sql.query("delete from clinic_groups where id = $1", [data.groupId]);
    }
    return { ok: true as const };
  });

/** Hide a question that isn't one (a test, an insult…). */
export const clinicHide = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: Number(rec(input).id) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await founderOnly(sql, context.userId))) return { ok: false as const, error: "Only an admin can do this." };
    await sql.query("update clinic_questions set hidden = true where id = $1", [data.id]);
    return { ok: true as const };
  });

/** Put 2 or 3 of the most-asked questions to the members' vote. It closes at the end of the month. */
export const clinicStartVote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    return { groupIds: Array.isArray(raw.groupIds) ? [...new Set(raw.groupIds.map(Number).filter((n) => n > 0))].slice(0, 3) : [] };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await founderOnly(sql, context.userId))) return { ok: false as const, error: "Only an admin can start a vote." };
    if (data.groupIds.length < 2) return { ok: false as const, error: "Pick 2 or 3 questions for the vote." };
    await closeDueRounds(sql);
    const month = monthKey(Date.now());
    const had = await sql.query<{ month: string }>("select month from clinic_rounds where month = $1 or not closed", [month]);
    if (had.length) return { ok: false as const, error: "There's already a vote this month." };
    const closes = new Date(monthEndMs(Date.now()));
    await sql.query("insert into clinic_rounds (month, group_ids, closes_at) values ($1, $2::int[], $3)", [month, data.groupIds, closes.toISOString()]);
    // Everyone who asked one of these hears it's in the vote.
    const askers = await sql.query<{ user_id: string }>(
      "select distinct user_id from clinic_questions where group_id = any($1::int[]) and not hidden",
      [data.groupIds],
    );
    const { notifyClinic } = await import("@/lib/porch/push.server");
    for (const a of askers) {
      if (a.user_id !== context.userId) await notifyClinic(sql, a.user_id, "Your question is in this month's vote 🗳 The winner is answered by Apostle Grace.", `clinic-vote-${month}`);
    }
    return { ok: true as const };
  });

/** Close this month's vote now (instead of waiting for the month to end). */
export const clinicCloseVote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await founderOnly(sql, context.userId))) return { ok: false as const, error: "Only an admin can close the vote." };
    await sql.query("update clinic_rounds set closes_at = now() where not closed");
    await closeDueRounds(sql);
    return { ok: true as const };
  });

/** The PDF for the pastors, or for Apostle Grace (the Question of the Month). */
export const clinicPdf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ who: rec(input).who === "apostle" ? "apostle" : "pastors", again: boolish(rec(input).again) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await founderOnly(sql, context.userId))) return { ok: false as const, error: "Only an admin takes the PDFs." };
    await closeDueRounds(sql);
    const { textPdf } = await import("@/lib/porch/pdf-lite");
    const today = new Date().toLocaleDateString("en-GB", { timeZone: "Africa/Kampala", day: "numeric", month: "long", year: "numeric" });
    const lines: { text: string; size?: number; gap?: number; x?: number }[] = [];
    const wrap = (text: string, width = 88) => {
      const out: string[] = [];
      let line = "";
      for (const word of text.split(/\s+/)) {
        if ((line + " " + word).trim().length > width) {
          out.push(line.trim());
          line = word;
        } else line += ` ${word}`;
      }
      if (line.trim()) out.push(line.trim());
      return out;
    };
    const rounds = await sql.query<{ month: string; group_ids: number[]; winner_group_id: number | null; closed: unknown }>(
      "select month, group_ids, winner_group_id, closed from clinic_rounds",
    );
    const winners = rounds.filter((r) => boolish(r.closed) && r.winner_group_id != null);
    const inOpenVote = new Set(rounds.filter((r) => !boolish(r.closed)).flatMap((r) => (r.group_ids ?? []).map(Number)));
    const winnerIds = new Set(winners.map((r) => Number(r.winner_group_id)));
    let groupIds: number[] = [];
    let questionIds: number[] = [];

    if (data.who === "apostle") {
      const rows = await sql.query<{ id: number; wording: string; sent_at: unknown; asked: string | number }>(
        `select g.id, g.wording, g.sent_at, (select count(*) from clinic_questions q where q.group_id = g.id and not q.hidden) as asked
           from clinic_groups g where g.id = any($1::int[]) and g.answered_at is null order by g.id`,
        [[...winnerIds]],
      );
      const pick = rows.filter((g) => data.again || !g.sent_at);
      if (!pick.length) return { ok: false as const, error: rows.length ? "Apostle Grace already has these. Tick 'Include ones already sent' to send again." : "No Question of the Month is waiting for an answer." };
      lines.push({ text: "Porchbook Radio - Question of the Month", size: 18, gap: 26 });
      lines.push({ text: `For Apostle Grace Lubega - ${today}`, size: 12, gap: 26 });
      for (const g of pick) {
        const round = winners.find((r) => Number(r.winner_group_id) === Number(g.id));
        const votes = await sql.query<{ n: string | number }>("select count(*) as n from clinic_votes where month = $1 and group_id = $2", [round?.month ?? "", g.id]);
        lines.push({ text: `QUESTION OF THE MONTH - ${round ? monthName(round.month).toUpperCase() : ""}  (G-${g.id})`, size: 12, gap: 18 });
        for (const part of wrap(`"${g.wording}"`, 70)) lines.push({ text: part, size: 14, gap: 20 });
        lines.push({ text: `Voted by ${Number(votes[0]?.n ?? 0)} members - asked by ${Number(g.asked)} members`, size: 10, gap: 30 });
        lines.push({ text: "Notes:", size: 10, gap: 80 });
      }
      groupIds = pick.map((g) => Number(g.id));
    } else {
      const groups = await sql.query<{ id: number; wording: string; sent_at: unknown; asked: string | number }>(
        `select g.id, g.wording, g.sent_at, (select count(*) from clinic_questions q where q.group_id = g.id and not q.hidden) as asked
           from clinic_groups g where g.answered_at is null order by asked desc, g.id`,
      );
      // Not the winners (Apostle Grace has those) and not ones still in this month's vote.
      const gPick = groups.filter((g) => !winnerIds.has(Number(g.id)) && !inOpenVote.has(Number(g.id)) && (data.again || !g.sent_at));
      const qs = await sql.query<{ id: number; body: string; show_name: unknown; created_at: unknown; sent_at: unknown; who: string | null }>(
        `select q.id, q.body, q.show_name, q.created_at, q.sent_at, p.display_name as who
           from clinic_questions q left join profiles p on p.user_id = q.user_id
          where q.group_id is null and not q.hidden and q.answered_at is null order by q.created_at`,
      );
      const qPick = qs.filter((q) => data.again || !q.sent_at);
      if (!gPick.length && !qPick.length) return { ok: false as const, error: "No new questions for the pastors. Tick 'Include ones already sent' to send them again." };
      lines.push({ text: "Questions from Porchbook Radio members", size: 18, gap: 26 });
      lines.push({ text: `For Phaneroo pastors - ${today}`, size: 12, gap: 14 });
      lines.push({ text: "Please answer by the number (Q-... or G-...): a voice note or a written reply is perfect.", size: 10, gap: 26 });
      if (gPick.length) {
        lines.push({ text: "ASKED BY MANY", size: 12, gap: 20 });
        for (const g of gPick) {
          const head = `G-${g.id}  (asked by ${Number(g.asked)} members)`;
          lines.push({ text: head, size: 10, gap: 15 });
          for (const part of wrap(g.wording)) lines.push({ text: part, size: 12, gap: 16 });
          lines.push({ text: "", size: 10, gap: 36 });
        }
      }
      if (qPick.length) {
        lines.push({ text: "QUESTIONS", size: 12, gap: 20 });
        for (const q of qPick) {
          const who = boolish(q.show_name) ? (q.who ?? "").trim().split(/\s+/)[0] || "a member" : "a member";
          const day = q.created_at ? new Date(String(q.created_at)).toLocaleDateString("en-GB", { timeZone: "Africa/Kampala", day: "numeric", month: "short" }) : "";
          lines.push({ text: `Q-${q.id}  - ${day} - from ${who}`, size: 10, gap: 15 });
          for (const part of wrap(q.body)) lines.push({ text: part, size: 12, gap: 16 });
          lines.push({ text: "", size: 10, gap: 36 });
        }
      }
      groupIds = gPick.map((g) => Number(g.id));
      questionIds = qPick.map((q) => Number(q.id));
    }
    if (groupIds.length) await sql.query("update clinic_groups set sent_at = coalesce(sent_at, now()) where id = any($1::int[])", [groupIds]);
    if (questionIds.length) await sql.query("update clinic_questions set sent_at = coalesce(sent_at, now()) where id = any($1::int[])", [questionIds]);
    const stamp = monthKey(Date.now()) + "-" + new Date(Date.now() + KAMPALA_MS).toISOString().slice(8, 10);
    return {
      ok: true as const,
      pdf: textPdf(lines),
      filename: data.who === "apostle" ? `clinic-apostle-grace-${stamp}.pdf` : `clinic-pastors-${stamp}.pdf`,
      count: groupIds.length + questionIds.length,
    };
  });

/** The founder adds a pastor's answer: written, a voice note, or a sermon from a minute mark. The asker (and voters) hear about it. */
export const clinicAnswer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    const url = clip(raw.url, 600);
    return {
      target: raw.target === "group" ? "group" : "question",
      id: Number(raw.id) || 0,
      text: typeof raw.text === "string" ? raw.text.trim().slice(0, 4000) : "",
      url: /^(https:\/\/|\/api\/)/.test(url) ? url : "",
      fromSec: Math.max(0, Math.min(6 * 3600, Math.round(Number(raw.fromSec) || 0))),
      by: clip(raw.by, 60) || "A Phaneroo pastor",
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await founderOnly(sql, context.userId))) return { ok: false as const, error: "Only an admin adds answers." };
    if (!data.text && !data.url) return { ok: false as const, error: "Write the answer, add a voice note, or pick a sermon." };
    const table = data.target === "group" ? "clinic_groups" : "clinic_questions";
    const fresh = await sql.query<{ id: number; was: unknown }>(
      `update ${table} set answer_text = $2, answer_url = $3, answer_from_sec = $4, answer_by = $5,
              answered_at = coalesce(answered_at, now())
        where id = $1 returning id, (answered_at < now() - interval '2 seconds') as was`,
      [data.id, data.text, data.url, data.fromSec, data.by],
    );
    if (!fresh.length) return { ok: false as const, error: "That question is gone." };
    if (boolish(fresh[0]?.was)) return { ok: true as const, told: 0 };
    // First time answered: tell whoever asked (and, for the Question of the Month, whoever voted).
    const people = new Set<string>();
    if (data.target === "group") {
      (await sql.query<{ user_id: string }>("select distinct user_id from clinic_questions where group_id = $1 and not hidden", [data.id])).forEach((r) => people.add(r.user_id));
      (await sql.query<{ user_id: string }>(
        "select distinct v.user_id from clinic_votes v join clinic_rounds r on r.month = v.month where r.winner_group_id = $1",
        [data.id],
      )).forEach((r) => people.add(r.user_id));
    } else {
      (await sql.query<{ user_id: string }>("select user_id from clinic_questions where id = $1", [data.id])).forEach((r) => people.add(r.user_id));
    }
    people.delete(context.userId);
    const won = data.target === "group" ? await sql.query<{ month: string }>("select month from clinic_rounds where winner_group_id = $1", [data.id]) : [];
    const body = won.length
      ? `🏆 ${data.by} answered the Question of the Month. Open the Clinic on the tour to listen.`
      : `✅ ${data.by} answered your question. Open the Clinic on the tour, under Ask a Pastor.`;
    for (const userId of people) await tell(sql, userId, body, `clinic-answer-${data.target}-${data.id}`);
    return { ok: true as const, told: people.size };
  });

/** The founder files a radio recording under a Clinic card (or takes it out). */
export const clinicTag = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    const topic = typeof raw.topic === "string" && TOPIC_KEYS.has(raw.topic) ? raw.topic : "";
    return { trackId: Number(raw.trackId) || 0, topic, on: boolish(raw.on) };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await founderOnly(sql, context.userId))) return { ok: false as const, error: "Only an admin files sermons." };
    if (!data.topic || !data.trackId) return { ok: false as const, error: "Pick a card and a sermon." };
    if (data.on) await sql.query("insert into clinic_tags (track_id, topic) values ($1, $2) on conflict do nothing", [data.trackId, data.topic]);
    else await sql.query("delete from clinic_tags where track_id = $1 and topic = $2", [data.trackId, data.topic]);
    return { ok: true as const };
  });

/** Open the Clinic to everyone (or close it back to just the founder). */
export const clinicLaunch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ on: boolish(rec(input).on) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await founderOnly(sql, context.userId))) return { ok: false as const, error: "Only an admin launches the Clinic." };
    await sql.query(
      "insert into clinic_state (key, value) values ('launched', $1) on conflict (key) do update set value = excluded.value",
      [data.on ? "yes" : "no"],
    );
    return { ok: true as const, launched: data.on };
  });

/** The founder sets (or replaces, or removes) a card's YouTube sermon. */
export const clinicSetVideo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = rec(input);
    const topic = typeof raw.topic === "string" && TOPIC_KEYS.has(raw.topic) ? raw.topic : "";
    return { topic, link: clip(raw.link, 400) };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await founderOnly(sql, context.userId))) return { ok: false as const, error: "Only an admin sets the card's video." };
    if (!data.topic) return { ok: false as const, error: "Pick a card." };
    if (!data.link) {
      await sql.query("delete from clinic_videos where topic = $1", [data.topic]);
      return { ok: true as const, title: "" };
    }
    const { videoIdOf, videoTitle } = await import("@/lib/porch/yt-live.server");
    const videoId = videoIdOf(data.link);
    if (!videoId) return { ok: false as const, error: "That isn't a YouTube link. Copy it from YouTube's Share button." };
    const title = await videoTitle(videoId).catch(() => "");
    await sql.query(
      `insert into clinic_videos (topic, video_id, title) values ($1, $2, $3)
       on conflict (topic) do update set video_id = excluded.video_id, title = excluded.title, set_at = now()`,
      [data.topic, videoId, title],
    );
    return { ok: true as const, title };
  });
