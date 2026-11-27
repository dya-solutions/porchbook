// Stage 5d: admin levels (BUILD-BRIEF.md decision 18, confirmed by JT on 27 November).
//   Lead admin: everything, including choosing admins and their levels, and handing over Lead.
//   Membership admin: join requests, member details, removing members.
//   Moderator: posts and complaints. No member details.
//   Public page editor: posts on the public porch for the porch ("Continue as").
//   Office head: their own office only (set per office, as before; sees the details of members
//   who contacted their office, nothing else).
// Ministries have Lead admins and Public page editors only. The person who started a porch is its
// Lead admin. A porch always keeps at least one Lead admin.
import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";

export const LEVELS = [
  { key: "lead", name: "Lead admin", does: "Everything, including choosing admins and their levels." },
  { key: "membership", name: "Membership admin", does: "Join requests, member details, removing members." },
  { key: "moderator", name: "Moderator", does: "Posts and complaints. Doesn't see member details." },
  { key: "public_editor", name: "Public page editor", does: "Posts on the public porch for the porch." },
] as const;
export type Level = (typeof LEVELS)[number]["key"];
const CHURCH_LEVELS = new Set<string>(["lead", "membership", "moderator", "public_editor"]);
const MINISTRY_LEVELS = new Set<string>(["lead", "public_editor"]);
export const levelName = (level: string) => LEVELS.find((l) => l.key === level)?.name ?? "Admin";

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}
const yes = (value: unknown) => value === true || value === "t" || value === "true";

/** What the signed-in person can do in the church they're in (as themselves). */
export const myAdminLevel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql.query<{ level: string | null; membership: unknown; moderator: unknown }>(
      `select (select a.level from porch_admins a where a.user_id = $1 and a.porch_id = my_porch($1)
                 and is_admin_of($1, a.porch_id)) as level,
              has_admin_level($1, array['membership']) as membership,
              has_admin_level($1, array['moderator']) as moderator`,
      [context.userId],
    );
    const row = rows[0];
    return {
      level: (row?.level ?? null) as Level | null,
      lead: row?.level === "lead",
      membership: yes(row?.membership),
      moderator: yes(row?.moderator),
    };
  });

/**
 * The porch whose admins you're managing: the ministry you're acting as, or else your church.
 * Only a Lead admin of it can manage its admins.
 */
async function managedPorch(sql: Sql, userId: string) {
  const rows = await sql.query<{ id: number; name: string; kind: string; lead: unknown }>(
    `select c.id, c.name, c.kind,
            exists (select 1 from porch_admins a where a.porch_id = c.id and a.user_id = $1 and a.level = 'lead'
                      and (c.kind = 'ministry' or in_porch($1, c.id))) as lead
       from porches c
      where c.id = coalesce(
              (select p.acting_porch_id from profiles p where p.user_id = $1 and can_act_as($1, p.acting_porch_id)),
              my_porch($1))
        and c.status <> 'declined'`,
    [userId],
  );
  return rows[0] ?? null;
}

export type AdminRow = { userId: string; name: string; username: string; level: Level; you: boolean; startedIt: boolean };

/** Porch settings → Admins: every admin and their level. Any admin can look; only Lead admins change. */
export const listAdmins = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const porch = await managedPorch(sql, context.userId);
    if (!porch) return { ok: false as const, error: "You're not in a porch." };
    const isAdmin = await sql.query("select 1 from porch_admins where porch_id = $1 and user_id = $2", [porch.id, context.userId]);
    if (!isAdmin.length) return { ok: false as const, error: "Only the porch's admins see this." };
    const rows = await sql.query<{ user_id: string; full_name: string | null; username: string | null; display_name: string; level: string; started: unknown }>(
      `select a.user_id, m.full_name, p.username, p.display_name, a.level, (c.created_by = a.user_id) as started
         from porch_admins a
         join profiles p on p.user_id = a.user_id
         join porches c on c.id = a.porch_id
         left join porch_members m on m.user_id = a.user_id and m.porch_id = a.porch_id
        where a.porch_id = $1 and (c.kind = 'ministry' or m.user_id is not null)
        order by (a.level = 'lead') desc, a.added_at`,
      [porch.id],
    );
    const church = porch.kind === "church";
    return {
      ok: true as const,
      porch: { id: porch.id, name: porch.name, kind: porch.kind },
      canManage: yes(porch.lead),
      levels: LEVELS.filter((l) => (church ? CHURCH_LEVELS : MINISTRY_LEVELS).has(l.key)),
      admins: rows.map((r) => ({
        userId: r.user_id,
        // Inside a church: the full name the person gave it. For a ministry (public): the username.
        name: church ? r.full_name || r.display_name : r.username ? `@${r.username}` : r.display_name,
        username: r.username ?? "",
        level: r.level as Level,
        you: r.user_id === context.userId,
        startedIt: yes(r.started),
      })) satisfies AdminRow[],
    };
  });

/** People who could be made an admin: church members (by name), or, for a ministry, accounts by username. */
export const adminCandidates = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ query: typeof asRecord(input).query === "string" ? String(asRecord(input).query).trim().slice(0, 60) : "" }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const porch = await managedPorch(sql, context.userId);
    if (!porch || !yes(porch.lead)) return [];
    const like = `%${data.query.replace(/^@/, "").replace(/[%_]/g, "")}%`;
    if (data.query.replace(/^@/, "").length < 2) return [];
    const rows =
      porch.kind === "church"
        ? await sql.query<{ user_id: string; name: string; username: string | null }>(
            `select m.user_id, coalesce(nullif(m.full_name, ''), p.display_name) as name, p.username
               from porch_members m join profiles p on p.user_id = m.user_id
              where m.porch_id = $1 and not exists (select 1 from porch_admins a where a.porch_id = $1 and a.user_id = m.user_id)
                and (m.full_name ilike $2 or p.display_name ilike $2 or p.username ilike $2)
              order by lower(coalesce(nullif(m.full_name, ''), p.display_name)) limit 10`,
            [porch.id, like],
          )
        : await sql.query<{ user_id: string; name: string; username: string | null }>(
            `select p.user_id, '@' || p.username as name, p.username
               from profiles p
              where p.username ilike $2 and p.email_verified_at is not null
                and not exists (select 1 from porch_admins a where a.porch_id = $1 and a.user_id = p.user_id)
              order by lower(p.username) limit 10`,
            [porch.id, like],
          );
    return rows.map((r) => ({ userId: r.user_id, name: r.name, username: r.username ?? "" }));
  });

function cleanLevel(kind: string, value: unknown): Level | null {
  const level = typeof value === "string" ? value : "";
  return (kind === "church" ? CHURCH_LEVELS : MINISTRY_LEVELS).has(level) ? (level as Level) : null;
}

/** Lead admins who really are (for a church, only its members count; an old stray record doesn't). */
async function leadCount(sql: Sql, porchId: number) {
  const rows = await sql.query<{ n: number }>(
    `select count(*)::int as n from porch_admins a join porches c on c.id = a.porch_id
      where a.porch_id = $1 and a.level = 'lead' and (c.kind = 'ministry' or in_porch(a.user_id, a.porch_id))`,
    [porchId],
  );
  return Number(rows[0]?.n ?? 0);
}

/** A Lead admin names a new admin at a level. In a church, only its members can be admins. */
export const addAdmin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { userId: typeof raw.userId === "string" ? raw.userId.slice(0, 80) : "", level: raw.level };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const porch = await managedPorch(sql, context.userId);
    if (!porch || !yes(porch.lead)) {
      noteAttempt(context.userId, "admin-add", "Tried to add an admin without being a Lead admin.");
      return { ok: false as const, error: "Only a Lead admin can choose admins." };
    }
    const level = cleanLevel(porch.kind, data.level);
    if (!level) return { ok: false as const, error: porch.kind === "church" ? "Choose a level." : "A ministry has Lead admins and Public page editors only." };
    if (porch.kind === "church") {
      const member = await sql.query("select 1 from porch_members where porch_id = $1 and user_id = $2", [porch.id, data.userId]);
      if (!member.length) return { ok: false as const, error: "Only a member of the church can be one of its admins." };
    } else {
      const person = await sql.query("select 1 from profiles where user_id = $1 and email_verified_at is not null", [data.userId]);
      if (!person.length) return { ok: false as const, error: "That account can't be found." };
    }
    await sql.query(
      "insert into porch_admins (porch_id, user_id, added_by, level) values ($1, $2, $3, $4) on conflict (porch_id, user_id) do update set level = excluded.level",
      [porch.id, data.userId, context.userId, level],
    );
    return { ok: true as const };
  });

/** A Lead admin changes someone's level (making someone else Lead hands it over). */
export const setAdminLevel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { userId: typeof raw.userId === "string" ? raw.userId.slice(0, 80) : "", level: raw.level };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const porch = await managedPorch(sql, context.userId);
    if (!porch || !yes(porch.lead)) {
      noteAttempt(context.userId, "admin-level", "Tried to change an admin's level without being a Lead admin.");
      return { ok: false as const, error: "Only a Lead admin can change levels." };
    }
    const level = cleanLevel(porch.kind, data.level);
    if (!level) return { ok: false as const, error: "Choose a level." };
    const current = await sql.query<{ level: string }>("select level from porch_admins where porch_id = $1 and user_id = $2", [porch.id, data.userId]);
    if (!current[0]) return { ok: false as const, error: "That person isn't one of the admins." };
    if (current[0].level === "lead" && level !== "lead" && (await leadCount(sql, porch.id)) <= 1) {
      return { ok: false as const, error: "A porch always needs a Lead admin. Make someone else Lead admin first." };
    }
    await sql.query("update porch_admins set level = $3 where porch_id = $1 and user_id = $2", [porch.id, data.userId, level]);
    return { ok: true as const };
  });

/** A Lead admin removes an admin (they stay a member). The last Lead admin can't be removed. */
export const removeAdmin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ userId: typeof asRecord(input).userId === "string" ? String(asRecord(input).userId).slice(0, 80) : "" }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const porch = await managedPorch(sql, context.userId);
    if (!porch || !yes(porch.lead)) {
      noteAttempt(context.userId, "admin-remove", "Tried to remove an admin without being a Lead admin.");
      return { ok: false as const, error: "Only a Lead admin can remove admins." };
    }
    const current = await sql.query<{ level: string }>("select level from porch_admins where porch_id = $1 and user_id = $2", [porch.id, data.userId]);
    if (!current[0]) return { ok: false as const, error: "That person isn't one of the admins." };
    if (current[0].level === "lead" && (await leadCount(sql, porch.id)) <= 1) {
      return { ok: false as const, error: "A porch always needs a Lead admin. Make someone else Lead admin first." };
    }
    await sql.query("delete from porch_admins where porch_id = $1 and user_id = $2", [porch.id, data.userId]);
    // Someone who could post for the porch is no longer acting as it.
    await sql.query("update profiles set acting_porch_id = null where user_id = $1 and acting_porch_id = $2", [data.userId, porch.id]);
    return { ok: true as const };
  });

/** Moderators (and Lead admins) can remove any post in their church. */
export async function canModerate(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql.query<{ ok: unknown }>("select has_admin_level($1, array['moderator']) as ok", [userId]);
  return yes(rows[0]?.ok);
}
