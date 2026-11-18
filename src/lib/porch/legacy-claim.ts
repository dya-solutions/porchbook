import type { Sql } from "@/lib/db";

/**
 * Members' posts and notes from the old Grok Porchbook, waiting by email.
 * When a member with that email shows up on the new Porchbook, their old posts and notes move into their account.
 */

export type LegacyPost = { room: string; body: string; createdAt: string; editedAt: string | null };
export type LegacyNote = { title: string; body: string; updatedAt: string };
export type LegacyMember = { name: string; email: string; joined: string; posts: LegacyPost[]; notes: LegacyNote[] };

const ROOMS = new Set(["proclaim", "inform", "ask"]);

export async function ensureLegacy(sql: Sql) {
  await sql`
    create table if not exists legacy_members (
      email text primary key,
      name text not null default '',
      data text not null default '{}',
      claimed_by text,
      claimed_at timestamptz,
      added_at timestamptz not null default now()
    )
  `;
}

const checked = new Set<string>();

/** Bring a member's old posts and notes in, once. Quiet and cheap after the first check. */
export async function claimLegacy(sql: Sql, userId: string, email: string) {
  const key = `${userId}:${email}`;
  if (!email || checked.has(key)) return 0;
  checked.add(key);
  try {
    const rows = await sql.query<{ email: string; data: string }>(
      "select email, data from legacy_members where email = $1 and claimed_by is null",
      [email.trim().toLowerCase()],
    );
    const row = rows[0];
    if (!row) return 0;
    await sql`
      create table if not exists notebook_notes (
        id text primary key,
        user_id text not null,
        title text not null default '',
        body text not null default '',
        updated_at timestamptz not null default now()
      )
    `;
    // Claim first so two requests never bring the same posts twice.
    const took = await sql.query<{ email: string }>(
      "update legacy_members set claimed_by = $1, claimed_at = now() where email = $2 and claimed_by is null returning email",
      [userId, row.email],
    );
    if (!took.length) return 0;
    const member = JSON.parse(row.data) as LegacyMember;
    let moved = 0;
    for (const post of member.posts ?? []) {
      const body = (post.body ?? "").slice(0, 2000);
      if (!body.trim()) continue;
      const room = ROOMS.has(post.room) ? post.room : "inform";
      await sql.query(
        "insert into posts (author_id, room, body, created_at, edited_at) values ($1, $2, $3, $4, $5)",
        [userId, room, body, post.createdAt || new Date().toISOString(), post.editedAt],
      );
      moved += 1;
    }
    let index = 0;
    for (const note of member.notes ?? []) {
      index += 1;
      if (!(note.body ?? "").trim() && !(note.title ?? "").trim()) continue;
      await sql.query(
        `insert into notebook_notes (id, user_id, title, body, updated_at)
         values ($1, $2, $3, $4, $5) on conflict (id) do nothing`,
        [`old-${userId}-${index}`, userId, (note.title ?? "").slice(0, 200), note.body ?? "", note.updatedAt || new Date().toISOString()],
      );
      moved += 1;
    }
    return moved;
  } catch {
    // Nothing imported yet (no table): nothing to bring for now.
    return 0;
  }
}

/** After an import: hand data to everyone already signed up with a matching email. */
export async function claimAllLegacy(sql: Sql) {
  const rows = await sql.query<{ user_id: string; email: string }>(
    `select p.user_id, lower(p.email) as email
       from profiles p join legacy_members l on l.email = lower(p.email)
      where l.claimed_by is null`,
  );
  let people = 0;
  for (const row of rows) {
    checked.delete(`${row.user_id}:${row.email}`);
    const moved = await claimLegacy(sql, row.user_id, row.email);
    if (moved >= 0) people += 1;
  }
  return people;
}
