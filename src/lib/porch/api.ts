import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { claimLegacy } from "@/lib/porch/legacy-claim";
import { placeNewProfile } from "@/lib/porch/porch-foundation";
import {
  FILTERS,
  REACTIONS,
  ROOMS,
  clipWords,
  type FeedFilter,
  type FeedPage,
  type PersonPage,
  type Post,
  type Profile,
  type PublicProfile,
  type ReactionKind,
  type ReactionSummary,
  type Comment,
  type Room,
  type Seed,
  type ThreadPage,
  type ThreadSummary,
} from "@/lib/porch/model";

const PAGE = 20;

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function cleanImage(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim().slice(0, 500);
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function parseSeed(input: unknown): Seed {
  const raw = asRecord(input);
  const emailRaw = typeof raw.email === "string" ? clip(raw.email, 200) : "";
  return {
    displayName: typeof raw.displayName === "string" ? clip(raw.displayName, 60) : "",
    email: emailRaw.includes("@") ? emailRaw : null,
    imageUrl: cleanImage(typeof raw.imageUrl === "string" ? raw.imageUrl : null),
  };
}

function parseFilter(value: unknown): FeedFilter {
  return typeof value === "string" && (FILTERS as readonly string[]).includes(value)
    ? (value as FeedFilter)
    : "all";
}

function parseRoom(value: unknown): Room | null {
  return typeof value === "string" && (ROOMS as readonly string[]).includes(value)
    ? (value as Room)
    : null;
}

function parseKind(value: unknown): ReactionKind | null {
  return typeof value === "string" && (REACTIONS as readonly string[]).includes(value)
    ? (value as ReactionKind)
    : null;
}

function parseId(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function parseBefore(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function boolish(value: unknown): boolean {
  return value === true || value === 1 || value === "t" || value === "true";
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

/** Is this post (or reply) in the viewer's own church porch? Anything else is refused. */
async function inMyPorch(sql: Sql, what: "post" | "comment", userId: string, id: number) {
  const rows = await sql.query<{ ok: unknown }>(
    what === "post" ? "select post_in_my_porch($1, $2) as ok" : "select comment_in_my_porch($1, $2) as ok",
    [userId, id],
  );
  return boolish(rows[0]?.ok);
}

export async function touchProfile(sql: Sql, userId: string, seed: Seed) {
  const email = seed.email?.trim().toLowerCase() ?? "";
  try {
    const blocked = await sql.query<{ user_id: string }>(
      `select user_id from removed_members
       where user_id = $1 or ($2 <> '' and lower(coalesce(email, '')) = $2)
       limit 1`,
      [userId, email],
    );
    if (blocked.length) return;
  } catch {
    // The roll table arrives with the migration.
  }
  const displayName = seed.displayName || "Teammate";
  const saved = await sql<{ inserted: boolean }>`
    insert into profiles (user_id, display_name, email, image_url)
    values (${userId}, ${displayName}, ${seed.email}, ${seed.imageUrl})
    on conflict (user_id) do update set
      email = coalesce(excluded.email, profiles.email),
      image_url = coalesce(excluded.image_url, profiles.image_url),
      display_name = case
        when profiles.display_name = 'Teammate' and excluded.display_name <> 'Teammate'
          then excluded.display_name
        else profiles.display_name
      end
    returning (xmax = 0) as inserted
  `;
  // A new account joins its church porch (Phaneroo, until invite codes arrive).
  // The old rule "the first account ever becomes an admin" is gone: porch admins are chosen.
  if (saved[0]?.inserted) await placeNewProfile(sql, userId);
  // Old Porchbook (Grok) posts and notes waiting for this email come in once.
  if (email) await claimLegacy(sql, userId, email);
}

type ProfileRow = {
  user_id: string;
  display_name: string;
  email: string | null;
  image_url: string | null;
  role: string;
  team: string;
  bio: string;
  spiritual_identity: string;
  spiritual_responsibility: string;
  created_at: string;
};

function mapProfile(row: ProfileRow, includeEmail: boolean): Profile {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    email: includeEmail ? row.email : null,
    imageUrl: row.image_url,
    role: row.role ?? "",
    team: row.team ?? "",
    bio: row.bio ?? "",
    spiritualIdentity: row.spiritual_identity ?? "",
    spiritualResponsibility: row.spiritual_responsibility ?? "",
    createdAt: text(row.created_at),
  };
}

function toPublic(row: ProfileRow): PublicProfile {
  const { email: _email, ...rest } = mapProfile(row, false);
  return rest;
}

const PROFILE_COLS = `user_id, display_name, email, image_url, role, team, bio,
  spiritual_identity, spiritual_responsibility,
  to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at`;

async function loadMe(sql: Sql, userId: string): Promise<Profile> {
  const found = await sql.query<ProfileRow>(
    `select ${PROFILE_COLS} from profiles where user_id = $1`,
    [userId],
  );
  const row = found[0];
  if (!row) {
    return {
      userId,
      displayName: "Teammate",
      email: null,
      imageUrl: null,
      role: "",
      team: "",
      bio: "",
      spiritualIdentity: "",
      spiritualResponsibility: "",
      createdAt: new Date().toISOString(),
    };
  }
  return mapProfile(row, true);
}

type PostRow = {
  id: number;
  room: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  author_id: string;
  author_name: string;
  author_image: string | null;
  author_role: string;
  author_team: string;
  locked: unknown;
  photo_v: string;
  asked_to: string | null;
  asked_name: string | null;
  answered: unknown;
};

type CommentRow = {
  id: number;
  post_id: number;
  author_id: string;
  author_name: string;
  author_image: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
};

type ReactionRow = {
  post_id: number;
  kind: string;
  n: number;
  mine: unknown;
};

type NameRow = {
  post_id: number;
  display_name: string;
};

async function hydratePosts(sql: Sql, rows: PostRow[], userId: string): Promise<Post[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => num(row.id));
  const ph = ids.map((_, i) => `$${i + 1}`).join(", ");
  const [comments, reactions, names, keeps] = await Promise.all([
    sql.query<CommentRow>(
      `select c.id, c.post_id, c.author_id, c.body,
              p.display_name as author_name, p.image_url as author_image,
              to_char(c.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
              to_char(c.edited_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as edited_at
       from comments c
       join profiles p on p.user_id = c.author_id
       where c.post_id in (${ph})
       order by c.created_at asc`,
      ids,
    ),
    sql.query<ReactionRow>(
      `select post_id, kind, count(*)::int as n,
              case when bool_or(user_id = $${ids.length + 1}) then 1 else 0 end as mine
       from reactions
       where post_id in (${ph})
       group by post_id, kind`,
      [...ids, userId],
    ),
    sql.query<NameRow>(
      `select post_id, display_name from (
         select r.post_id, p.display_name,
                row_number() over (partition by r.post_id order by r.created_at desc) as n
         from reactions r
         join profiles p on p.user_id = r.user_id
         where r.post_id in (${ph})
       ) named
       where n <= 3`,
      ids,
    ),
    sql.query<{ post_id: number }>(
      `select post_id from keeps where user_id = $${ids.length + 1} and post_id in (${ph})`,
      [...ids, userId],
    ),
  ]);

  const commentIds = comments.map((comment) => num(comment.id));
  const reactionsByComment = new Map<number, ReactionSummary[]>();
  const keptComments = new Set<number>();
  if (commentIds.length) {
    const cph = commentIds.map((_, index) => `$${index + 1}`).join(", ");
    const [commentReactions, commentKeeps] = await Promise.all([
      sql.query<{ comment_id: number; kind: string; n: number; mine: unknown }>(
        `select comment_id, kind, count(*)::int as n,
                case when bool_or(user_id = $${commentIds.length + 1}) then 1 else 0 end as mine
         from comment_reactions
         where comment_id in (${cph})
         group by comment_id, kind`,
        [...commentIds, userId],
      ),
      sql.query<{ comment_id: number }>(
        `select comment_id from comment_keeps
         where user_id = $${commentIds.length + 1} and comment_id in (${cph})`,
        [...commentIds, userId],
      ),
    ]);
    for (const reaction of commentReactions) {
      const kind = parseKind(reaction.kind);
      if (!kind) continue;
      const commentId = num(reaction.comment_id);
      const list = reactionsByComment.get(commentId) ?? [];
      list.push({ kind, count: num(reaction.n), mine: boolish(reaction.mine) });
      reactionsByComment.set(commentId, list);
    }
    for (const keep of commentKeeps) keptComments.add(num(keep.comment_id));
  }

  const commentsByPost = new Map<number, Comment[]>();
  for (const comment of comments) {
    const postId = num(comment.post_id);
    const list = commentsByPost.get(postId) ?? [];
    list.push({
      id: num(comment.id),
      postId,
      authorId: comment.author_id,
      authorName: comment.author_name,
      authorImage: comment.author_image,
      body: comment.body,
      createdAt: text(comment.created_at),
      editedAt: comment.edited_at ? text(comment.edited_at) : null,
      reactions: reactionsByComment.get(num(comment.id)) ?? [],
      kept: keptComments.has(num(comment.id)),
    });
    commentsByPost.set(postId, list);
  }

  const reactionsByPost = new Map<number, ReactionSummary[]>();
  for (const reaction of reactions) {
    const kind = parseKind(reaction.kind);
    if (!kind) continue;
    const postId = num(reaction.post_id);
    const list = reactionsByPost.get(postId) ?? [];
    list.push({ kind, count: num(reaction.n), mine: boolish(reaction.mine) });
    reactionsByPost.set(postId, list);
  }

  const namesByPost = new Map<number, string[]>();
  for (const name of names) {
    const postId = num(name.post_id);
    const list = namesByPost.get(postId) ?? [];
    if (name.display_name) list.push(name.display_name);
    namesByPost.set(postId, list);
  }
  const keptIds = new Set(keeps.map((row) => num(row.post_id)));

  return rows.map((row) => {
    const id = num(row.id);
    const room = parseRoom(row.room) ?? "inform";
    const reactionList = reactionsByPost.get(id) ?? [];
    return {
      id,
      room,
      body: row.body,
      createdAt: text(row.created_at),
      editedAt: row.edited_at ? text(row.edited_at) : null,
      authorId: row.author_id,
      authorName: row.author_name,
      authorImage: row.author_image,
      authorRole: row.author_role ?? "",
      authorTeam: row.author_team ?? "",
      reactions: reactionList,
      noticed: namesByPost.get(id) ?? [],
      noticedCount: reactionList.reduce((sum, item) => sum + item.count, 0),
      kept: keptIds.has(id),
      locked: boolish(row.locked),
      afloat: false,
      pinned: false,
      // The photo itself is fetched separately (once, then kept by the phone).
      photo: row.photo_v ? `/api/post-photo?id=${id}&v=${row.photo_v}` : null,
      comments: commentsByPost.get(id) ?? [],
      askedTo: row.asked_to ? { id: row.asked_to, name: row.asked_name || "Teammate" } : null,
      answered: boolish(row.answered),
    };
  });
}

const POST_SELECT = `
  select p.id, p.room, p.body, p.author_id, p.locked,
         case when coalesce(p.photo, '') <> '' then left(md5(p.photo), 16) else '' end as photo_v,
         to_char(p.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
         to_char(p.edited_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as edited_at,
         a.display_name as author_name,
         a.image_url as author_image,
         a.role as author_role,
         a.team as author_team,
         nullif(p.asked_to, '') as asked_to,
         q.display_name as asked_name,
         (p.asked_to <> '' and exists (select 1 from comments c where c.post_id = p.id and c.author_id = p.asked_to)) as answered
  from posts p
  join profiles a on a.user_id = p.author_id
  left join profiles q on q.user_id = p.asked_to
`;

let askReady = false;
async function ensurePostPhoto(sql: Sql) {
  if (!askReady) {
    await sql`alter table posts add column if not exists asked_to text not null default ''`;
    await sql`alter table posts add column if not exists asked_seen boolean not null default false`;
    askReady = true;
  }
  await sql`alter table posts add column if not exists photo text not null default ''`;
  await sql`alter table posts add column if not exists photo_mime text not null default ''`;
  await sql`alter table posts add column if not exists photo_hash text not null default ''`;
}

function samePicture(left: string, right: string) {
  if (left.length !== 16 || right.length !== 16) return false;
  let diff = 0;
  for (let index = 0; index < 16; index += 1) {
    const bits = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
    diff += (bits & 1) + ((bits >> 1) & 1) + ((bits >> 2) & 1) + ((bits >> 3) & 1);
    if (diff > 10) return false;
  }
  return true;
}

async function pinnedRow(sql: Sql, userId: string, filter: FeedFilter): Promise<PostRow | null> {
  const pinnedRows = await sql<{ pinned_post_id: number | null }>`
    select pinned_post_id from profiles where user_id = ${userId}
  `;
  const pinId = num(pinnedRows[0]?.pinned_post_id);
  if (!pinId) return null;
  const params: unknown[] = [pinId, userId];
  if (filter !== "all") params.push(filter);
  const pinned = await sql.query<PostRow>(
    `${POST_SELECT} where p.id = $1 and p.author_id = $2 and p.porch_id = my_porch($2)${filter === "all" ? "" : " and p.room = $3"}`,
    params,
  );
  return pinned[0] ?? null;
}

/** One post, for the bell to open. */
export const getOnePost = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseId(asRecord(input).postId))
  .handler(async ({ context, data: postId }) => {
    if (!postId) return { ok: false as const };
    const sql = await getSql();
    await ensurePostPhoto(sql);
    // Only a post in the viewer's own church porch (anything else is refused).
    const rows = await sql.query<PostRow>(`${POST_SELECT} where p.id = $1 and p.porch_id = my_porch($2)`, [postId, context.userId]);
    if (!rows[0]) return { ok: false as const };
    const [post] = await hydratePosts(sql, rows, context.userId);
    return post ? { ok: true as const, post } : { ok: false as const };
  });

export const getFeed = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      filter: parseFilter(raw.filter),
      before: parseBefore(raw.before),
      mine: raw.mine === true,
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }): Promise<FeedPage> => {
    const sql = await getSql();
    await ensurePostPhoto(sql);
    await touchProfile(sql, context.userId, data.seed);
    const pinned = await pinnedRow(sql, context.userId, data.filter);
    // The feed shows only the viewer's own church porch.
    const params: unknown[] = [context.userId];
    const where: string[] = ["p.porch_id = my_porch($1)"];
    if (data.filter !== "all") {
      params.push(data.filter);
      where.push(`p.room = $${params.length}`);
    }
    if (data.before) {
      params.push(data.before);
      where.push(`p.created_at < $${params.length}::timestamptz`);
    }
    if (data.mine) {
      params.push(context.userId);
      where.push(`p.author_id <> $${params.length}`);
    } else if (pinned) {
      params.push(num(pinned.id));
      where.push(`p.id <> $${params.length}`);
    }
    params.push(PAGE + 1);
    const clause = where.length ? `where ${where.join(" and ")}` : "";
    const rows = await sql.query<PostRow>(
      `${POST_SELECT} ${clause} order by p.created_at desc limit $${params.length}`,
      params,
    );
    const hasMore = rows.length > PAGE;
    const page = hasMore ? rows.slice(0, PAGE) : rows;
    const [posts, me, counts] = await Promise.all([
      hydratePosts(sql, page, context.userId),
      loadMe(sql, context.userId),
      sql<{ n: number }>`select count(*)::int as n from profiles where in_porch(user_id, my_porch(${context.userId}))`,
    ]);
    let ordered = posts;
    if (!data.before && data.mine) {
      const mineParams: unknown[] = [context.userId];
      if (data.filter !== "all") mineParams.push(data.filter);
      const mineRows = await sql.query<PostRow>(
        `${POST_SELECT} where p.author_id = $1 and p.porch_id = my_porch($1)${data.filter === "all" ? "" : " and p.room = $2"} order by p.created_at desc`,
        mineParams,
      );
      const pinId = pinned ? num(pinned.id) : 0;
      const lead = pinned ? [pinned, ...mineRows.filter((row) => num(row.id) !== pinId)] : mineRows;
      const floated = await hydratePosts(sql, lead, context.userId);
      for (const post of floated) {
        post.afloat = true;
        post.pinned = pinId > 0 && post.id === pinId;
      }
      ordered = [...floated, ...posts];
    } else if (!data.before && pinned) {
      const [floated] = await hydratePosts(sql, [pinned], context.userId);
      if (floated) {
        floated.afloat = true;
        floated.pinned = true;
        ordered = [floated, ...posts];
      }
    }
    return { posts: ordered, hasMore, peopleCount: num(counts[0]?.n), me };
  });

export const createPost = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      room: parseRoom(raw.room),
      body: typeof raw.body === "string" ? clip(raw.body, 2000) : "",
      photo: typeof raw.photo === "string" ? raw.photo.replace(/\s/g, "").slice(0, 3_200_000) : "",
      photoMime: raw.photoMime === "image/webp" || raw.photoMime === "image/jpeg" ? raw.photoMime : "",
      photoHash: typeof raw.photoHash === "string" && /^[0-9a-f]{16}$/.test(raw.photoHash) ? raw.photoHash : "",
      askedTo: typeof raw.askedTo === "string" ? raw.askedTo.slice(0, 80) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.room) return { ok: false as const, error: "Pick a room." };
    if (data.askedTo && (data.room !== "ask" || data.askedTo === context.userId)) data.askedTo = "";
    if (!data.body && !data.photo) return { ok: false as const, error: "Write something or add a photo." };
    const sql = await getSql();
    await ensurePostPhoto(sql);
    if (data.photo) {
      let bytes = 0;
      try {
        bytes = atob(data.photo).length;
      } catch {
        return { ok: false as const, error: "That photo could not be read." };
      }
      if (bytes > 2_000_000) return { ok: false as const, error: "That photo is too large. Choose another." };
      if (!data.photoMime) return { ok: false as const, error: "Use a photo." };
      if (!data.photoHash) return { ok: false as const, error: "That photo could not be checked." };
      const known = await sql.query<{ photo_hash: string; author_id: string }>(
        "select photo_hash, author_id from posts where photo_hash <> '' order by created_at desc limit 400",
      );
      if (known.some((row) => row.author_id !== context.userId && samePicture(row.photo_hash, data.photoHash))) {
        return { ok: false as const, error: "That picture belongs to someone else." };
      }
    }
    await touchProfile(sql, context.userId, data.seed);
    // A post always belongs to the church porch it's written in. With none (not in a church, or
    // acting as a ministry: N3), there's nowhere to post until the public porch (Stage 6).
    const church = await sql<{ porch_id: number | null }>`select my_porch(${context.userId}) as porch_id`;
    if (!church[0]?.porch_id) return { ok: false as const, error: "Posts go to your church's porch. Continue as yourself in your church to post." };
    if (data.askedTo) {
      const owner = await sql<{ user_id: string }>`select user_id from profiles where user_id = ${data.askedTo} and same_porch(user_id, ${context.userId})`;
      if (!owner.length) return { ok: false as const, error: "That person isn't on Porchbook." };
    }
    await sql`
      insert into posts (author_id, room, body, photo, photo_mime, photo_hash, asked_to)
      values (${context.userId}, ${data.room}, ${data.body || " "}, ${data.photo}, ${data.photo ? data.photoMime : ""}, ${data.photoHash}, ${data.askedTo})
    `;
    if (data.askedTo) {
      try {
        const people = await sql<{ display_name: string }>`select display_name from profiles where user_id = ${context.userId}`;
        const { notifyPeople } = await import("@/lib/porch/push.server");
        await notifyPeople(sql, [data.askedTo], "A question for you", `${people[0]?.display_name?.trim() || "Someone"} asked you a question`, "/");
        const made = await sql<{ id: number }>`select id from posts where author_id = ${context.userId} and asked_to = ${data.askedTo} order by created_at desc limit 1`;
        const { recordNote } = await import("@/lib/porch/notes.server");
        await recordNote(sql, { userId: data.askedTo, actorId: context.userId, kind: "question", postId: num(made[0]?.id), refId: num(made[0]?.id), snippet: data.body });
      } catch {
        // The porch guy tells them too.
      }
    }
    return { ok: true as const };
  });

export const updatePost = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      id: parseId(raw.id),
      room: parseRoom(raw.room),
      body: typeof raw.body === "string" ? clip(raw.body, 2000) : "",
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.id || !data.room || !data.body) {
      return { ok: false as const, error: "That post needs a room and some text." };
    }
    const sql = await getSql();
    const rows = await sql<{ id: number }>`
      update posts
      set body = ${data.body}, room = ${data.room}, edited_at = now()
      where id = ${data.id} and author_id = ${context.userId}
      returning id
    `;
    if (!rows.length) {
      noteAttempt(context.userId, "edit-post", "Tried to edit a post that is not theirs.");
      return { ok: false as const, error: "You can only edit your own posts." };
    }
    return { ok: true as const };
  });

export const deletePost = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseId(asRecord(input).id))
  .handler(async ({ context, data: id }) => {
    if (!id) return { ok: false as const, error: "Missing post." };
    const sql = await getSql();
    const rows = await sql<{ id: number }>`
      delete from posts where id = ${id} and author_id = ${context.userId} returning id
    `;
    if (!rows.length) {
      noteAttempt(context.userId, "remove-post", "Tried to remove a post that is not theirs.");
      return { ok: false as const, error: "You can only remove your own posts." };
    }
    return { ok: true as const };
  });

export const pinPost = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseId(asRecord(input).id))
  .handler(async ({ context, data: id }) => {
    if (!id) return { ok: false as const, error: "Missing post." };
    const sql = await getSql();
    const rows = await sql<{ id: number }>`
      select id from posts where id = ${id} and author_id = ${context.userId} and porch_id = my_porch(${context.userId})
    `;
    if (!rows.length) {
      noteAttempt(context.userId, "pin-post", "Tried to pin a post that is not theirs.");
      return { ok: false as const, error: "You can only pin your own posts." };
    }
    const current = await sql<{ pinned_post_id: number | null }>`
      select pinned_post_id from profiles where user_id = ${context.userId}
    `;
    const already = num(current[0]?.pinned_post_id) === id;
    if (already) {
      await sql`update profiles set pinned_post_id = null where user_id = ${context.userId}`;
    } else {
      await sql`update profiles set pinned_post_id = ${id} where user_id = ${context.userId}`;
    }
    return { ok: true as const, pinned: !already };
  });

export const addComment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      postId: parseId(raw.postId),
      body: typeof raw.body === "string" ? clip(raw.body, 800) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.postId || !data.body) return { ok: false as const, error: "Write a reply first." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    await ensurePostPhoto(sql);
    const posts = await sql<{ id: number; locked: unknown; author_id: string; asked_to: string }>`
      select id, locked, author_id, asked_to from posts where id = ${data.postId} and porch_id = my_porch(${context.userId})
    `;
    if (!posts.length) return { ok: false as const, error: "That post is gone." };
    if (await waitingForAnswer(sql, data.postId, posts[0].asked_to, context.userId)) {
      return { ok: false as const, error: "This question is for one person. You can join in once they answer." };
    }
    if (boolish(posts[0].locked)) {
      noteAttempt(context.userId, "locked-reply", "Tried to reply on a locked post.");
      return { ok: false as const, error: "Replies are closed on this post." };
    }
    await sql`
      insert into comments (post_id, author_id, body)
      values (${data.postId}, ${context.userId}, ${data.body})
    `;
    const authorId = posts[0].author_id;
    if (authorId && authorId !== context.userId) {
      const people = await sql<{ display_name: string }>`
        select display_name from profiles where user_id = ${context.userId}
      `;
      const name = people[0]?.display_name?.trim() || "Someone";
      const { notifyPeople } = await import("@/lib/porch/push.server");
      await notifyPeople(sql, [authorId], "Porchbook", `${name} replied to your post`, "/");
      const made = await sql<{ id: number }>`select id from comments where post_id = ${data.postId} and author_id = ${context.userId} order by created_at desc limit 1`;
      const { recordNote } = await import("@/lib/porch/notes.server");
      await recordNote(sql, { userId: authorId, actorId: context.userId, kind: "reply", postId: data.postId, refId: num(made[0]?.id), snippet: data.body });
    }
    return { ok: true as const };
  });

export const updateComment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      id: parseId(raw.id),
      body: typeof raw.body === "string" ? clip(raw.body, 800) : "",
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.id || !data.body) return { ok: false as const, error: "Write a reply first." };
    const sql = await getSql();
    const rows = await sql<{ id: number }>`
      update comments
      set body = ${data.body}, edited_at = now()
      where id = ${data.id} and author_id = ${context.userId}
      returning id
    `;
    if (!rows.length) {
      noteAttempt(context.userId, "edit-reply", "Tried to edit a reply that is not theirs.");
      return { ok: false as const, error: "You can only edit your own replies." };
    }
    return { ok: true as const };
  });

export const deleteComment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseId(asRecord(input).id))
  .handler(async ({ context, data: id }) => {
    if (!id) return { ok: false as const, error: "Missing reply." };
    const sql = await getSql();
    const rows = await sql<{ id: number }>`
      delete from comments
      where id = ${id}
        and (
          author_id = ${context.userId}
          or post_id in (select id from posts where author_id = ${context.userId})
        )
      returning id
    `;
    if (!rows.length) {
      noteAttempt(context.userId, "remove-reply", "Tried to remove a reply they are not allowed to.");
      return { ok: false as const, error: "You can't remove that reply." };
    }
    return { ok: true as const };
  });

export const setCommentReaction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { commentId: parseId(raw.commentId), kind: parseKind(raw.kind), seed: parseSeed(raw) };
  })
  .handler(async ({ context, data }) => {
    if (!data.commentId || !data.kind) return { ok: false as const, error: "Pick a reaction." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    if (!(await inMyPorch(sql, "comment", context.userId, data.commentId))) return { ok: false as const, error: "That reply is gone." };
    const existing = await sql<{ kind: string }>`
      select kind from comment_reactions where comment_id = ${data.commentId} and user_id = ${context.userId}
    `;
    const replyOf = await sql<{ author_id: string; post_id: number; body: string }>`
      select author_id, post_id, body from comments where id = ${data.commentId}
    `;
    const { recordNote, dropNote } = await import("@/lib/porch/notes.server");
    if (existing[0]?.kind === data.kind) {
      await sql`delete from comment_reactions where comment_id = ${data.commentId} and user_id = ${context.userId}`;
      if (replyOf[0]) await dropNote(sql, { userId: replyOf[0].author_id, actorId: context.userId, target: "reply", refId: data.commentId });
    } else if (existing[0]) {
      await sql`
        update comment_reactions set kind = ${data.kind}
        where comment_id = ${data.commentId} and user_id = ${context.userId}
      `;
      if (replyOf[0])
        await recordNote(sql, { userId: replyOf[0].author_id, actorId: context.userId, kind: "reaction", target: "reply", postId: num(replyOf[0].post_id), refId: data.commentId, reaction: data.kind, snippet: replyOf[0].body });
    } else {
      const found = await sql<{ id: number; author_id: string }>`
        select id, author_id from comments where id = ${data.commentId}
      `;
      const reply = found[0];
      if (!reply) return { ok: false as const, error: "That reply is gone." };
      await sql`
        insert into comment_reactions (comment_id, user_id, kind)
        values (${data.commentId}, ${context.userId}, ${data.kind})
      `;
      if (reply.author_id !== context.userId) {
        if (replyOf[0])
          await recordNote(sql, { userId: reply.author_id, actorId: context.userId, kind: "reaction", target: "reply", postId: num(replyOf[0].post_id), refId: data.commentId, reaction: data.kind, snippet: replyOf[0].body });
        const { notifyReaction } = await import("@/lib/porch/push.server");
        await notifyReaction(sql, reply.author_id, context.userId, data.kind, "reply");
      }
    }
    return { ok: true as const };
  });

export const toggleCommentKeep = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseId(asRecord(input).commentId))
  .handler(async ({ context, data: commentId }) => {
    if (!commentId) return { ok: false as const, error: "Missing reply." };
    const sql = await getSql();
    if (!(await inMyPorch(sql, "comment", context.userId, commentId))) return { ok: false as const, error: "That reply is gone." };
    const existing = await sql<{ comment_id: number }>`
      select comment_id from comment_keeps where user_id = ${context.userId} and comment_id = ${commentId}
    `;
    if (existing.length) {
      await sql`delete from comment_keeps where user_id = ${context.userId} and comment_id = ${commentId}`;
      return { ok: true as const, kept: false };
    }
    const found = await sql<{ id: number }>`select id from comments where id = ${commentId}`;
    if (!found.length) return { ok: false as const, error: "That reply is gone." };
    await sql`insert into comment_keeps (user_id, comment_id) values (${context.userId}, ${commentId})`;
    return { ok: true as const, kept: true };
  });

export const setReaction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { postId: parseId(raw.postId), kind: parseKind(raw.kind), seed: parseSeed(raw) };
  })
  .handler(async ({ context, data }) => {
    if (!data.postId || !data.kind) return { ok: false as const, error: "Pick a reaction." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    const existing = await sql<{ kind: string }>`
      select kind from reactions where post_id = ${data.postId} and user_id = ${context.userId}
    `;
    await ensurePostPhoto(sql);
    const posts = await sql<{ id: number; author_id: string; asked_to: string; body: string }>`
      select id, author_id, asked_to, body from posts where id = ${data.postId} and porch_id = my_porch(${context.userId})
    `;
    const post = posts[0];
    if (!post) return { ok: false as const, error: "That post is gone." };
    if (await waitingForAnswer(sql, data.postId, post.asked_to, context.userId)) {
      return { ok: false as const, error: "This question is for one person. You can react once they answer." };
    }
    let tell = false;
    if (existing[0]?.kind === data.kind) {
      await sql`delete from reactions where post_id = ${data.postId} and user_id = ${context.userId}`;
      const { dropNote } = await import("@/lib/porch/notes.server");
      await dropNote(sql, { userId: post.author_id, actorId: context.userId, target: "post", refId: data.postId });
    } else if (existing[0]) {
      await sql`
        update reactions set kind = ${data.kind}
        where post_id = ${data.postId} and user_id = ${context.userId}
      `;
      tell = true;
    } else {
      await sql`
        insert into reactions (post_id, user_id, kind)
        values (${data.postId}, ${context.userId}, ${data.kind})
      `;
      tell = true;
    }
    if (tell && post.author_id !== context.userId) {
      const { recordNote } = await import("@/lib/porch/notes.server");
      await recordNote(sql, { userId: post.author_id, actorId: context.userId, kind: "reaction", postId: data.postId, refId: data.postId, reaction: data.kind, snippet: post.body });
      const { notifyReaction } = await import("@/lib/porch/push.server");
      await notifyReaction(sql, post.author_id, context.userId, data.kind, "post");
    }
    return { ok: true as const };
  });

export const toggleKeep = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseId(asRecord(input).postId))
  .handler(async ({ context, data: postId }) => {
    if (!postId) return { ok: false as const, error: "Missing post." };
    const sql = await getSql();
    if (!(await inMyPorch(sql, "post", context.userId, postId))) return { ok: false as const, error: "That post is gone." };
    const existing = await sql<{ post_id: number }>`
      select post_id from keeps where user_id = ${context.userId} and post_id = ${postId}
    `;
    if (existing.length) {
      await sql`delete from keeps where user_id = ${context.userId} and post_id = ${postId}`;
      return { ok: true as const, kept: false };
    }
    const posts = await sql<{ id: number }>`select id from posts where id = ${postId}`;
    if (!posts.length) return { ok: false as const, error: "That post is gone." };
    await sql`insert into keeps (user_id, post_id) values (${context.userId}, ${postId})`;
    return { ok: true as const, kept: true };
  });

export const toggleLock = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseId(asRecord(input).postId))
  .handler(async ({ context, data: postId }) => {
    if (!postId) return { ok: false as const, error: "Missing post." };
    const sql = await getSql();
    const rows = await sql<{ locked: unknown }>`
      update posts
      set locked = not locked
      where id = ${postId} and author_id = ${context.userId}
      returning locked
    `;
    if (!rows.length) {
      noteAttempt(context.userId, "lock-post", "Tried to lock a post that is not theirs.");
      return { ok: false as const, error: "You can only lock your own posts." };
    }
    return { ok: true as const, locked: boolish(rows[0].locked) };
  });

export const listPeople = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    const rows = await sql.query<ProfileRow>(
      `select ${PROFILE_COLS} from profiles where in_porch(user_id, my_porch($1)) order by lower(display_name) asc`,
      [context.userId],
    );
    const people: PublicProfile[] = rows.map((row) => toPublic(row));
    return { people };
  });

export const getPerson = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const userId = typeof raw.userId === "string" ? clip(raw.userId, 120) : "";
    return { userId, seed: parseSeed(raw) };
  })
  .handler(async ({ context, data }): Promise<PersonPage> => {
    const sql = await getSql();
    await ensurePostPhoto(sql);
    await touchProfile(sql, context.userId, data.seed);
    if (!data.userId) return { profile: null, posts: [], isSelf: false };
    const found = await sql.query<ProfileRow>(
      `select ${PROFILE_COLS} from profiles where user_id = $1 and same_porch(user_id, $2)`,
      [data.userId, context.userId],
    );
    const row = found[0];
    if (!row) return { profile: null, posts: [], isSelf: data.userId === context.userId };
    const isSelf = row.user_id === context.userId;
    const posts = await sql.query<{
      id: number;
      room: string;
      body: string;
      created_at: string;
      comment_count: number;
      reaction_count: number;
      photo_v: string;
    }>(
      `select p.id, p.room, p.body,
              case when coalesce(p.photo, '') <> '' then left(md5(p.photo), 16) else '' end as photo_v,
              to_char(p.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
              (select count(*)::int from comments c where c.post_id = p.id) as comment_count,
              (select count(*)::int from reactions r where r.post_id = p.id) as reaction_count
       from posts p
       where p.author_id = $1 and p.porch_id = my_porch($2)
       order by p.created_at desc
       limit 12`,
      [data.userId, context.userId],
    );
    return {
      profile: mapProfile(row, isSelf),
      posts: posts.map((post) => ({
        id: num(post.id),
        room: parseRoom(post.room) ?? "inform",
        body: post.body,
        createdAt: text(post.created_at),
        commentCount: num(post.comment_count),
        reactionCount: num(post.reaction_count),
        photo: post.photo_v ? `/api/post-photo?id=${num(post.id)}&v=${post.photo_v}` : null,
      })),
      isSelf,
    };
  });

export const updateMe = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      displayName: typeof raw.displayName === "string" ? clip(raw.displayName, 60) : "",
      role: typeof raw.role === "string" ? clip(raw.role, 60) : "",
      team: typeof raw.team === "string" ? clip(raw.team, 60) : "",
      spiritualIdentity: typeof raw.spiritualIdentity === "string" ? clipWords(raw.spiritualIdentity).trim() : "",
      spiritualResponsibility:
        typeof raw.spiritualResponsibility === "string" ? clipWords(raw.spiritualResponsibility).trim() : "",
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.displayName) return { ok: false as const, error: "Your name can't be empty." };
    const sql = await getSql();
    const rows = await sql<{ user_id: string }>`
      update profiles
      set display_name = ${data.displayName},
          role = ${data.role},
          team = ${data.team},
          spiritual_identity = ${data.spiritualIdentity},
          spiritual_responsibility = ${data.spiritualResponsibility},
          updated_at = now()
      where user_id = ${context.userId}
      returning user_id
    `;
    if (!rows.length) return { ok: false as const, error: "Profile isn't ready yet." };
    return { ok: true as const };
  });

function parseUserId(value: unknown): string {
  return typeof value === "string" ? clip(value, 120) : "";
}

function previewBody(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= 140) return flat;
  return `${flat.slice(0, 139)}…`;
}

async function findConversation(sql: Sql, me: string, other: string): Promise<number | null> {
  const rows = await sql<{ id: number }>`
    select id from conversations
    where low_user_id = least(${me}, ${other})
      and high_user_id = greatest(${me}, ${other})
      and porch_id = my_porch(${me})
  `;
  const id = rows[0]?.id;
  return id == null ? null : num(id);
}

async function ensureConversation(sql: Sql, me: string, other: string): Promise<number> {
  const rows = await sql<{ id: number }>`
    insert into conversations (low_user_id, high_user_id)
    values (least(${me}, ${other}), greatest(${me}, ${other}))
    on conflict (low_user_id, high_user_id) do update set updated_at = now()
    returning id
  `;
  return num(rows[0]?.id);
}

async function markConversationRead(sql: Sql, conversationId: number, userId: string) {
  await sql`
    insert into conversation_reads (conversation_id, user_id, read_at)
    values (${conversationId}, ${userId}, now())
    on conflict (conversation_id, user_id) do update set read_at = now()
  `;
}

type MessageRow = {
  id: number;
  author_id: string;
  body: string;
  created_at: string;
  reply_to: number | null;
  edited_at: string | null;
  deleted_at: string | null;
};

export const listThreads = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    const { ensureChat } = await import("@/lib/porch/chat");
    await ensureChat(sql);
    const rows = await sql.query<{
      other_id: string;
      other_name: string;
      other_image: string | null;
      other_role: string;
      other_team: string;
      last_body: string;
      last_at: string;
      last_author_id: string;
      last_deleted: string | null;
      unread: number;
    }>(
      `select
         case when c.low_user_id = $1 then c.high_user_id else c.low_user_id end as other_id,
         p.display_name as other_name,
         p.image_url as other_image,
         p.role as other_role,
         p.team as other_team,
         lm.body as last_body,
         to_char(lm.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_at,
         lm.author_id as last_author_id,
         lm.deleted_at::text as last_deleted,
         (
           select count(*)::int
           from messages m
           where m.conversation_id = c.id
             and m.author_id <> $1
             and m.deleted_at is null
             and m.created_at > coalesce(r.read_at, '1970-01-01'::timestamptz)
         ) as unread
       from conversations c
       join profiles p
         on p.user_id = case when c.low_user_id = $1 then c.high_user_id else c.low_user_id end
       left join conversation_reads r
         on r.conversation_id = c.id and r.user_id = $1
       join lateral (
         select body, created_at, author_id, deleted_at
         from messages m
         where m.conversation_id = c.id
           and not exists (
             select 1 from message_hides h where h.message_id = m.id and h.user_id = $1
           )
         order by m.created_at desc, m.id desc
         limit 1
       ) lm on true
       where (c.low_user_id = $1 or c.high_user_id = $1)
         and c.porch_id = my_porch($1)
       order by lm.created_at desc`,
      [context.userId],
    );
    const threads: ThreadSummary[] = rows.map((row) => ({
      otherUserId: row.other_id,
      otherName: row.other_id === context.userId ? "My Space" : row.other_name,
      otherImage: row.other_id === context.userId ? null : row.other_image,
      otherRole: row.other_role ?? "",
      otherTeam: row.other_team ?? "",
      lastBody: row.last_deleted ? "Message deleted" : previewBody(row.last_body),
      lastAt: text(row.last_at),
      lastMine: row.last_author_id === context.userId,
      unread: num(row.unread),
    }));
    return { threads };
  });

export const inboxUnread = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    const { ensureChat } = await import("@/lib/porch/chat");
    await ensureChat(sql);
    const rows = await sql.query<{ n: number }>(
      `select count(*)::int as n
       from messages m
       join conversations c on c.id = m.conversation_id
       left join conversation_reads r
         on r.conversation_id = c.id and r.user_id = $1
       where (c.low_user_id = $1 or c.high_user_id = $1)
         and c.porch_id = my_porch($1)
         and m.author_id <> $1
         and m.deleted_at is null
         and m.created_at > coalesce(r.read_at, '1970-01-01'::timestamptz)`,
      [context.userId],
    );
    return { unread: num(rows[0]?.n) };
  });

export const getThread = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { userId: parseUserId(raw.userId), seed: parseSeed(raw) };
  })
  .handler(async ({ context, data }): Promise<ThreadPage> => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    if (!data.userId) return { profile: null, messages: [], truncated: false, isSelf: false, responding: false, pinned: null };
    const { ensureChat } = await import("@/lib/porch/chat");
    await ensureChat(sql);
    const isSelf = data.userId === context.userId;
    // Only a conversation with someone in the viewer's own church porch.
    const found = await sql.query<ProfileRow>(
      `select ${PROFILE_COLS} from profiles where user_id = $1 and same_porch(user_id, $2)`,
      [data.userId, context.userId],
    );
    const row = found[0];
    if (!row) return { profile: null, messages: [], truncated: false, isSelf, responding: false, pinned: null };
    const profile = toPublic(row);
    const conversationId = await findConversation(sql, context.userId, data.userId);
    if (!conversationId) return { profile, messages: [], truncated: false, isSelf, responding: false, pinned: null };
    const messages = await sql.query<MessageRow>(
      `select m.id, m.author_id, m.body, m.reply_to,
              to_char(m.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
              m.edited_at::text as edited_at, m.deleted_at::text as deleted_at
       from messages m
       where m.conversation_id = $1
         and not exists (
           select 1 from message_hides h where h.message_id = m.id and h.user_id = $2
         )
       order by m.created_at asc, m.id asc`,
      [conversationId, context.userId],
    );
    const ids = messages.map((message) => num(message.id));
    const reactions = ids.length
      ? await sql.query<{ message_id: number; user_id: string; emoji: string }>(
          "select message_id, user_id, emoji from message_reactions where message_id = any($1::int[])",
          [ids],
        )
      : [];
    const stars = ids.length
      ? await sql.query<{ message_id: number }>(
          "select message_id from message_stars where user_id = $1 and message_id = any($2::int[])",
          [context.userId, ids],
        )
      : [];
    const starSet = new Set(stars.map((item) => num(item.message_id)));
    const byId = new Map(messages.map((message) => [num(message.id), message]));
    const now = Date.now();
    await markConversationRead(sql, conversationId, context.userId);
    const signals = isSelf
      ? []
      : await sql.query<{ n: number }>(
          `select 1 as n from conversation_signals
           where conversation_id = $1 and user_id = $2
             and at > now() - interval '4 seconds'`,
          [conversationId, data.userId],
        );
    const pins = await sql.query<{ message_id: number; body: string; deleted_at: string | null }>(
      `select p.message_id, m.body, m.deleted_at::text as deleted_at
       from conversation_pins p
       join messages m on m.id = p.message_id
       where p.conversation_id = $1
         and m.deleted_at is null
         and not exists (
           select 1 from message_hides h where h.message_id = m.id and h.user_id = $2
         )`,
      [conversationId, context.userId],
    );
    return {
      profile,
      truncated: false,
      isSelf,
      responding: signals.length > 0,
      pinned: pins[0] ? { id: num(pins[0].message_id), body: previewBody(pins[0].body) } : null,
      messages: messages.map((message) => {
        const id = num(message.id);
        const deleted = Boolean(message.deleted_at);
        const mine = message.author_id === context.userId;
        const age = now - Date.parse(message.created_at);
        const reply = message.reply_to == null ? null : byId.get(num(message.reply_to));
        const grouped = new Map<string, { emoji: string; count: number; mine: boolean }>();
        for (const reaction of reactions) {
          if (num(reaction.message_id) !== id) continue;
          const current = grouped.get(reaction.emoji) ?? { emoji: reaction.emoji, count: 0, mine: false };
          current.count += 1;
          if (reaction.user_id === context.userId) current.mine = true;
          grouped.set(reaction.emoji, current);
        }
        return {
          id,
          authorId: message.author_id,
          body: deleted ? "" : message.body,
          createdAt: text(message.created_at),
          mine,
          edited: Boolean(message.edited_at) && !deleted,
          deleted,
          replyTo: message.reply_to == null ? null : num(message.reply_to),
          replyBody: !reply ? "" : reply.deleted_at ? "Deleted message" : previewBody(reply.body),
          starred: starSet.has(id),
          reactions: [...grouped.values()],
          canEdit: mine && !deleted && age <= 15 * 60 * 1000,
          canDeleteAll: mine && !deleted && age <= 48 * 60 * 60 * 1000,
        };
      }),
    };
  });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      userId: parseUserId(raw.userId),
      body: typeof raw.body === "string" ? clip(raw.body, 2000) : "",
      replyTo: Number.isInteger(Number(raw.replyTo)) ? Number(raw.replyTo) : null,
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.userId) return { ok: false as const, error: "Choose someone to message." };
    if (!data.body) return { ok: false as const, error: "Write a note first." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    const { ensureChat } = await import("@/lib/porch/chat");
    await ensureChat(sql);
    const people = await sql<{ user_id: string }>`
      select user_id from profiles where user_id = ${data.userId} and same_porch(user_id, ${context.userId})
    `;
    if (!people.length) return { ok: false as const, error: "You can only message people in your porch." };
    const conversationId = await ensureConversation(sql, context.userId, data.userId);
    let replyTo: number | null = null;
    if (data.replyTo) {
      const target = await sql<{ id: number }>`
        select id from messages
        where id = ${data.replyTo} and conversation_id = ${conversationId} and deleted_at is null
      `;
      if (!target.length) return { ok: false as const, error: "That message is not here to reply to." };
      replyTo = data.replyTo;
    }
    await sql`
      insert into messages (conversation_id, author_id, body, reply_to)
      values (${conversationId}, ${context.userId}, ${data.body}, ${replyTo})
    `;
    await sql`
      delete from conversation_signals
      where conversation_id = ${conversationId} and user_id = ${context.userId}
    `;
    if (data.userId !== context.userId) {
      const { notifyPrivateNote } = await import("@/lib/porch/push.server");
      await notifyPrivateNote(sql, data.userId, context.userId);
    }
    return { ok: true as const };
  });

export const setResponding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      userId: parseUserId(raw.userId),
      on: raw.on === true,
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.userId || data.userId === context.userId) return { ok: true as const };
    const sql = await getSql();
    const people = await sql<{ user_id: string }>`
      select user_id from profiles where user_id = ${data.userId}
    `;
    if (!people.length) return { ok: true as const };
    const conversationId = await ensureConversation(sql, context.userId, data.userId);
    if (!data.on) {
      await sql`
        delete from conversation_signals
        where conversation_id = ${conversationId} and user_id = ${context.userId}
      `;
      return { ok: true as const };
    }
    await sql`
      insert into conversation_signals (conversation_id, user_id, at)
      values (${conversationId}, ${context.userId}, now())
      on conflict (conversation_id, user_id) do update set at = now()
    `;
    return { ok: true as const };
  });

export const pushPublicKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    const { publicKey } = await import("@/lib/porch/push.server");
    return { publicKey: await publicKey(sql) };
  });

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      endpoint: typeof raw.endpoint === "string" ? raw.endpoint.trim().slice(0, 2000) : "",
      p256dh: typeof raw.p256dh === "string" ? raw.p256dh.trim().slice(0, 255) : "",
      auth: typeof raw.auth === "string" ? raw.auth.trim().slice(0, 255) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    const { saveSubscription } = await import("@/lib/porch/push.server");
    return saveSubscription(sql, context.userId, data);
  });

export const founderDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSeed(input))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await touchProfile(sql, context.userId, seed);
    const me = await sql.query<{ is_founder: boolean }>(
      "select is_porch_admin($1) as is_founder",
      [context.userId],
    );
    const notes = await sql.query<{ body: string; created_at: string }>(
      `select body,
        to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
       from founder_notes
       order by created_at desc
       limit 1`,
    );
    const row = notes[0];
    return {
      isFounder: boolish(me[0]?.is_founder),
      note: row ? { body: row.body, createdAt: text(row.created_at) } : null,
    };
  });

export const sendToAll = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      body: typeof raw.body === "string" ? clip(raw.body, 500) : "",
      seed: parseSeed(raw),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.body) return { ok: false as const, error: "Write a message first." };
    const sql = await getSql();
    await touchProfile(sql, context.userId, data.seed);
    const me = await sql.query<{ is_founder: boolean }>(
      "select is_porch_admin($1) as is_founder",
      [context.userId],
    );
    if (!boolish(me[0]?.is_founder)) {
      noteAttempt(context.userId, "message-everyone", "Tried to message everyone without being an admin.");
      return { ok: false as const, error: "Only an admin can message everyone." };
    }
    const { ensureChat } = await import("@/lib/porch/chat");
    await ensureChat(sql);
    const people = await sql.query<{ user_id: string }>(
      "select user_id from profiles where user_id <> $1 and in_porch(user_id, my_porch($1))",
      [context.userId],
    );
    let sent = 0;
    for (const person of people) {
      try {
        const conversationId = await ensureConversation(sql, context.userId, person.user_id);
        await sql`
          insert into messages (conversation_id, author_id, body)
          values (${conversationId}, ${context.userId}, ${data.body})
        `;
        sent += 1;
      } catch {
        // One person must not stop the message reaching the rest.
      }
    }
    if (people.length > 0 && sent === 0) return { ok: false as const, error: "Couldn't send." };
    const { notifyTeam } = await import("@/lib/porch/push.server");
    await notifyTeam(sql, context.userId, data.body);
    return { ok: true as const };
  });


/** A question asked of one person stays theirs until they answer it. */
async function waitingForAnswer(sql: Sql, postId: number, askedTo: string, userId: string) {
  if (!askedTo || askedTo === userId) return false;
  const answered = await sql<{ id: number }>`select id from comments where post_id = ${postId} and author_id = ${askedTo} limit 1`;
  return answered.length === 0;
}

/** The porch guy tells someone once that a question was asked of them. */
export const askNews = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensurePostPhoto(sql);
    const rows = await sql.query<{ id: number; name: string | null }>(
      `select p.id, a.display_name as name from posts p join profiles a on a.user_id = p.author_id
        where p.asked_to = $1 and not p.asked_seen
          and not exists (select 1 from comments c where c.post_id = p.id and c.author_id = p.asked_to)
        order by p.created_at desc limit 5`,
      [context.userId],
    );
    return { asks: rows.map((r) => ({ id: num(r.id), name: r.name || "Someone" })) };
  });

export const seenAskNews = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensurePostPhoto(sql);
    await sql.query("update posts set asked_seen = true where asked_to = $1", [context.userId]);
    return { ok: true as const };
  });
