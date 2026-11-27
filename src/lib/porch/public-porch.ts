// Stage 6 + N5: the public porch (BUILD-BRIEF.md "The public porch", decisions 10-13, 16, 28, 38-46).
// - Only approved porches post publicly: a porch's admins, while they "Continue as [porch]".
//   People never post there as themselves. No comments.
// - Public posts live in their OWN tables (public_posts, public_reactions), never in the private
//   posts table, so nothing from a church's private porch can ever appear here by itself.
// - The public porch shows only posts from porches you follow. Every member follows their own
//   church (and its main church, if it's a branch) and can't unfollow it.
// - Anyone with an account can react (Love, Like, Touching, Deep). Reactions show the username,
//   plus the church for members who haven't switched "show my church" off.
// - Find porches: by name, country and type. Follow / Unfollow any porch; Ask to join churches.
import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { REACTIONS, type ReactionKind } from "@/lib/porch/model";
import { MINISTRY_TYPES, ministryTypeName } from "@/lib/porch/porch-kinds";

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}
const yes = (value: unknown) => value === true || value === "t" || value === "true";
const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;
export const PUBLIC_POST_MAX = 1500;

let ready: Promise<void> | null = null;
export function ensurePublic(sql: Sql) {
  ready ??= (async () => {
    await sql.query(`create table if not exists public_posts (
      id serial primary key,
      porch_id integer not null references porches (id) on delete cascade,
      author_id text references profiles (user_id) on delete set null,
      body text not null,
      created_at timestamptz not null default now(),
      removed_at timestamptz
    )`);
    await sql.query("create index if not exists public_posts_porch_idx on public_posts (porch_id, created_at desc)");
    await sql.query(`create table if not exists public_reactions (
      post_id integer not null references public_posts (id) on delete cascade,
      user_id text not null references profiles (user_id) on delete cascade,
      kind text not null,
      created_at timestamptz not null default now(),
      primary key (post_id, user_id, kind)
    )`);
    await sql.query(`create table if not exists porch_follows (
      user_id text not null references profiles (user_id) on delete cascade,
      porch_id integer not null references porches (id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (user_id, porch_id)
    )`);
    // A private church post can point to a public post it shares (as a link, nothing more).
    await sql.query("alter table posts add column if not exists shared_public_post_id integer references public_posts (id) on delete set null");
    // Branches name their main church (Stage 5a adds this too; it may not be there yet on a new database).
    await sql.query("alter table porches add column if not exists main_porch_id integer references porches (id)");
    // The porches a person follows: the ones they chose, plus their own church and its main church.
    await sql.query(`create or replace function follows_porch(uid text, pid integer) returns boolean language sql stable as $$
      select exists (select 1 from porch_follows f where f.user_id = uid and f.porch_id = pid)
          or pid = church_of(uid)
          or pid = (select main_porch_id from porches where id = church_of(uid))
    $$`);
  })().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

export type PublicPost = {
  id: number;
  porchId: number;
  porchName: string;
  porchKind: string;
  porchType: string;
  accent: string;
  verified: boolean;
  body: string;
  at: string;
  reactions: { kind: ReactionKind; count: number; mine: boolean }[];
  /** Up to 3 people who reacted: username, and their church unless they hide it. */
  reactors: { name: string; church: string }[];
  reactorCount: number;
  mine: boolean;
};

async function postsWhere(sql: Sql, userId: string, where: string, params: unknown[], limit = 40): Promise<PublicPost[]> {
  const rows = await sql.query<{
    id: number;
    porch_id: number;
    porch_name: string;
    kind: string;
    ministry_type: string;
    ministry_other: string;
    accent: string | null;
    verified: unknown;
    body: string;
    at: string;
    mine: unknown;
  }>(
    `select pp.id, pp.porch_id, c.name as porch_name, c.kind, c.ministry_type, c.ministry_other, s.accent, c.verified, pp.body,
            to_char(pp.created_at at time zone 'utc', ${ISO}) as at,
            can_act_as($1, pp.porch_id) as mine
       from public_posts pp
       join porches c on c.id = pp.porch_id and c.status = 'approved'
       left join porch_settings s on s.porch_id = c.id
      where pp.removed_at is null and ${where}
      order by pp.created_at desc
      limit ${limit}`,
    [userId, ...params],
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const counts = await sql.query<{ post_id: number; kind: string; n: number; mine: unknown }>(
    `select post_id, kind, count(*)::int as n, bool_or(user_id = $2) as mine from public_reactions where post_id = any($1) group by post_id, kind`,
    [ids, userId],
  );
  const who = await sql.query<{ post_id: number; name: string; church: string | null; total: number }>(
    `select x.post_id, x.name, x.church, x.total from (
       select r.post_id, public_name(r.user_id) as name,
              case when coalesce(p.hide_church, false) then null else (select name from porches where id = church_of(r.user_id)) end as church,
              row_number() over (partition by r.post_id order by max(r.created_at) desc) as n,
              count(*) over (partition by r.post_id) as total
         from public_reactions r join profiles p on p.user_id = r.user_id
        where r.post_id = any($1)
        group by r.post_id, r.user_id, p.hide_church
     ) x where x.n <= 3`,
    [ids],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    porchId: Number(row.porch_id),
    porchName: row.porch_name,
    porchKind: row.kind,
    porchType: row.kind === "church" ? "Church" : `Ministry · ${ministryTypeName(row.ministry_type, row.ministry_other)}`,
    accent: row.accent ?? "gold",
    verified: yes(row.verified),
    body: row.body,
    at: row.at,
    reactions: REACTIONS.map((kind) => {
      const found = counts.find((c) => Number(c.post_id) === Number(row.id) && c.kind === kind);
      return { kind, count: Number(found?.n ?? 0), mine: yes(found?.mine) };
    }),
    reactors: who.filter((w) => Number(w.post_id) === Number(row.id)).map((w) => ({ name: w.name, church: w.church ?? "" })),
    reactorCount: Number(who.find((w) => Number(w.post_id) === Number(row.id))?.total ?? 0),
    mine: yes(row.mine),
  }));
}

/** The public porch: posts from the porches you follow, newest first. */
export const publicFeed = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensurePublic(sql);
    const following = await sql.query<{ n: number }>(
      "select count(*)::int as n from porches c where c.status = 'approved' and follows_porch($1, c.id)",
      [context.userId],
    );
    const posts = await postsWhere(sql, context.userId, "follows_porch($1, pp.porch_id)", []);
    return { following: Number(following[0]?.n ?? 0), posts };
  });

/** React on a public post (anyone with an account). Tapping again takes it back. */
export const reactPublic = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { postId: Number(raw.postId) || 0, kind: (REACTIONS as readonly string[]).includes(String(raw.kind)) ? (String(raw.kind) as ReactionKind) : null };
  })
  .handler(async ({ context, data }) => {
    if (!data.kind) return { ok: false as const, error: "Choose a reaction." };
    const sql = await getSql();
    await ensurePublic(sql);
    const post = await sql.query("select 1 from public_posts pp join porches c on c.id = pp.porch_id and c.status = 'approved' where pp.id = $1 and pp.removed_at is null", [data.postId]);
    if (!post.length) return { ok: false as const, error: "That post isn't on the public porch." };
    const gone = await sql.query("delete from public_reactions where post_id = $1 and user_id = $2 and kind = $3 returning 1", [data.postId, context.userId, data.kind]);
    if (!gone.length) await sql.query("insert into public_reactions (post_id, user_id, kind) values ($1, $2, $3) on conflict do nothing", [data.postId, context.userId, data.kind]);
    return { ok: true as const, on: !gone.length };
  });

/** Post on the public porch, for the porch you're acting as. Only approved porches. */
export const createPublicPost = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input).body;
    return { body: typeof raw === "string" ? raw.replace(/[ \t]+/g, " ").trim().slice(0, PUBLIC_POST_MAX) : "" };
  })
  .handler(async ({ context, data }) => {
    if (!data.body) return { ok: false as const, error: "Write something first." };
    const sql = await getSql();
    await ensurePublic(sql);
    const rows = await sql.query<{ id: number | null; status: string | null; name: string | null }>(
      `select c.id, c.status, c.name from profiles p join porches c on c.id = p.acting_porch_id
        where p.user_id = $1 and can_act_as($1, c.id)`,
      [context.userId],
    );
    const porch = rows[0];
    if (!porch?.id) {
      noteAttempt(context.userId, "public-post", "Tried to post publicly as themselves.");
      return { ok: false as const, error: "Only porches post on the public porch. Continue as your porch to post for it." };
    }
    if (porch.status !== "approved") return { ok: false as const, error: `${porch.name} can post publicly once Porchbook approves it.` };
    const made = await sql.query<{ id: number }>("insert into public_posts (porch_id, author_id, body) values ($1, $2, $3) returning id", [porch.id, context.userId, data.body]);
    return { ok: true as const, id: made[0].id };
  });

/** Take a public post down (the porch's admins, acting as it). */
export const removePublicPost = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ postId: Number(asRecord(input).postId) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensurePublic(sql);
    const rows = await sql.query(
      `update public_posts pp set removed_at = now()
        where pp.id = $1 and pp.removed_at is null
          and pp.porch_id = (select acting_porch_id from profiles where user_id = $2) and can_act_as($2, pp.porch_id)
        returning pp.id`,
      [data.postId, context.userId],
    );
    if (!rows.length) return { ok: false as const, error: "Only the porch's admins, acting as it, can take its posts down." };
    return { ok: true as const };
  });

export type PorchCard = {
  id: number;
  name: string;
  kind: string;
  typeName: string;
  country: string;
  place: string;
  description: string;
  accent: string;
  verified: boolean;
  followers: number;
  following: boolean;
  /** Your own church (or its main church): always followed. */
  ownChurch: boolean;
  /** You could ask to join it (a church, and you're in no church yet). */
  canAskToJoin: boolean;
  /** You run it (you can "Continue as" it). */
  runs: boolean;
};

const CARD_SELECT = `
  select c.id, c.name, c.kind, c.ministry_type, c.ministry_other, c.country, c.town, c.description, s.accent, c.verified,
         (select count(*)::int from porch_follows f where f.porch_id = c.id)
           + (select count(*)::int from porch_members m where m.porch_id = c.id
                and not exists (select 1 from porch_follows f2 where f2.porch_id = c.id and f2.user_id = m.user_id)) as followers,
         follows_porch($1, c.id) as following,
         (c.id = church_of($1) or c.id = (select main_porch_id from porches where id = church_of($1))) as own_church,
         (c.kind = 'church' and church_of($1) is null) as can_ask,
         can_act_as($1, c.id) as runs
    from porches c left join porch_settings s on s.porch_id = c.id`;

type CardRow = {
  id: number;
  name: string;
  kind: string;
  ministry_type: string;
  ministry_other: string;
  country: string;
  town: string;
  description: string;
  accent: string | null;
  verified: unknown;
  followers: number;
  following: unknown;
  own_church: unknown;
  can_ask: unknown;
  runs: unknown;
};
function toCard(row: CardRow): PorchCard {
  return {
    id: Number(row.id),
    name: row.name,
    kind: row.kind,
    typeName: row.kind === "church" ? "Church" : `Ministry · ${ministryTypeName(row.ministry_type, row.ministry_other)}`,
    country: row.country,
    place: [row.town, row.country].filter(Boolean).join(", "),
    description: row.description ?? "",
    accent: row.accent ?? "gold",
    verified: yes(row.verified),
    followers: Number(row.followers ?? 0),
    following: yes(row.following),
    ownChurch: yes(row.own_church),
    canAskToJoin: yes(row.can_ask),
    runs: yes(row.runs),
  };
}

const KINDS_SEARCH = new Set(["", "church", "ministry", ...MINISTRY_TYPES.map((t) => `ministry:${t.key}`)]);

/** Find porches: approved porches by name, country and type. Searching never adds posts to your feed. */
export const findPorches = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const type = typeof raw.type === "string" && KINDS_SEARCH.has(raw.type) ? raw.type : "";
    return { query: text(raw.query, 60), country: text(raw.country, 60), type };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensurePublic(sql);
    const where = ["c.status = 'approved'"];
    const params: unknown[] = [context.userId];
    if (data.query) {
      params.push(`%${data.query.replace(/[%_]/g, "")}%`);
      where.push(`(c.name ilike $${params.length} or c.short_name ilike $${params.length} or c.description ilike $${params.length})`);
    }
    if (data.country) {
      params.push(data.country);
      where.push(`lower(c.country) = lower($${params.length})`);
    }
    if (data.type === "church") where.push("c.kind = 'church'");
    else if (data.type.startsWith("ministry")) {
      where.push("c.kind = 'ministry'");
      const sub = data.type.split(":")[1];
      if (sub) {
        params.push(sub);
        where.push(`c.ministry_type = $${params.length}`);
      }
    }
    const rows = await sql.query<CardRow>(`${CARD_SELECT} where ${where.join(" and ")} order by lower(c.name) limit 40`, params);
    return rows.map(toCard);
  });

/** Follow or unfollow a porch. Your own church can't be unfollowed. */
export const setFollow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { porchId: Number(raw.porchId) || 0, follow: raw.follow === true };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensurePublic(sql);
    const porch = await sql.query<{ id: number; own: unknown }>(
      "select c.id, (c.id = church_of($1) or c.id = (select main_porch_id from porches where id = church_of($1))) as own from porches c where c.id = $2 and c.status = 'approved'",
      [context.userId, data.porchId],
    );
    if (!porch[0]) return { ok: false as const, error: "That porch isn't on the public porch." };
    if (!data.follow && yes(porch[0].own)) return { ok: false as const, error: "You always follow your own church." };
    if (data.follow) await sql.query("insert into porch_follows (user_id, porch_id) values ($1, $2) on conflict do nothing", [context.userId, data.porchId]);
    else await sql.query("delete from porch_follows where user_id = $1 and porch_id = $2", [context.userId, data.porchId]);
    return { ok: true as const, following: data.follow };
  });

/** A porch's public page: who it is, and its public posts. */
export const porchPage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ porchId: Number(asRecord(input).porchId) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensurePublic(sql);
    const rows = await sql.query<CardRow & { status: string }>(`${CARD_SELECT.replace("select c.id,", "select c.status, c.id,")} where c.id = $2`, [context.userId, data.porchId]);
    const row = rows[0];
    // A porch that isn't approved has no public page yet (except for its own admins, to see how it will look).
    if (!row || (row.status !== "approved" && !yes(row.runs))) return { ok: false as const, error: "That porch isn't on the public porch." };
    const branches = await sql.query<{ id: number; name: string; town: string; country: string }>(
      "select id, name, town, country from porches where main_porch_id = $1 and status = 'approved' order by name",
      [data.porchId],
    );
    const posts = row.status === "approved" ? await postsWhere(sql, context.userId, "pp.porch_id = $2", [data.porchId]) : [];
    return {
      ok: true as const,
      porch: { ...toCard(row), approved: row.status === "approved" },
      branches: branches.map((b) => ({ id: b.id, name: b.name, place: [b.town, b.country].filter(Boolean).join(", ") })),
      posts,
    };
  });

/** A church that someone with no church can ask to join (from Find porches): its name and place. */
export const churchToJoin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ porchId: Number(asRecord(input).porchId) || 0 }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql.query<{ id: number; name: string; town: string; country: string }>(
      "select id, name, town, country from porches where id = $1 and kind = 'church' and status = 'approved'",
      [data.porchId],
    );
    const row = rows[0];
    if (!row) return { ok: false as const, error: "That church isn't on Porchbook." };
    return { ok: true as const, id: row.id, name: row.name, place: [row.town, row.country].filter(Boolean).join(", ") };
  });

/**
 * Share a public post into your own church's private porch, as a link (a short note that points
 * to it). The public post itself never moves; nothing goes the other way.
 */
export const sharePublicPost = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { postId: Number(raw.postId) || 0, note: text(raw.note, 300) };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensurePublic(sql);
    const church = await sql.query<{ id: number | null }>("select my_porch($1) as id", [context.userId]);
    if (!church[0]?.id) return { ok: false as const, error: "Sharing goes into your church's porch. Join a church first (or continue as yourself)." };
    const post = await sql.query<{ name: string; body: string }>(
      "select c.name, pp.body from public_posts pp join porches c on c.id = pp.porch_id and c.status = 'approved' where pp.id = $1 and pp.removed_at is null",
      [data.postId],
    );
    if (!post[0]) return { ok: false as const, error: "That post isn't on the public porch any more." };
    const snippet = post[0].body.length > 160 ? `${post[0].body.slice(0, 157)}…` : post[0].body;
    const body = `${data.note ? `${data.note}\n\n` : ""}Shared from ${post[0].name} on the public porch:\n“${snippet}”`;
    const made = await sql.query<{ id: number }>(
      "insert into posts (author_id, room, body, photo, photo_mime, photo_hash, asked_to, porch_id, shared_public_post_id) values ($1, 'inform', $2, '', '', '', '', $3, $4) returning id",
      [context.userId, body, church[0].id, data.postId],
    );
    return { ok: true as const, id: made[0].id };
  });

/** One public post (to open a shared link). */
export const publicPostById = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ postId: Number(asRecord(input).postId) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensurePublic(sql);
    const posts = await postsWhere(sql, context.userId, "pp.id = $2", [data.postId], 1);
    return posts[0] ? { ok: true as const, post: posts[0] } : { ok: false as const, error: "That post isn't on the public porch any more." };
  });

/** The porch you're acting as: write its description (shown on its public page). */
export const saveDescription = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input).description;
    return { description: typeof raw === "string" ? raw.replace(/[ \t]+/g, " ").trim().slice(0, 400) : "" };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql.query(
      `update porches c set description = $2
        where c.id = (select acting_porch_id from profiles where user_id = $1) and can_act_as($1, c.id)
        returning c.id`,
      [context.userId, data.description],
    );
    if (!rows.length) return { ok: false as const, error: "Continue as your porch to write its description." };
    return { ok: true as const };
  });

/** The public posts of the porch you're acting as (for its own screen). */
export const myPorchPublicPosts = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensurePublic(sql);
    const acting = await sql.query<{ id: number | null }>("select acting_porch_id as id from profiles where user_id = $1 and can_act_as($1, acting_porch_id)", [context.userId]);
    if (!acting[0]?.id) return { ok: false as const, posts: [] as PublicPost[] };
    const posts = await postsWhere(sql, context.userId, "pp.porch_id = $2", [acting[0].id], 30);
    return { ok: true as const, posts };
  });
