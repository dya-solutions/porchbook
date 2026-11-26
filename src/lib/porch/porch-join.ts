// Stage 5a: joining and starting a porch.
// - Two types (decision 38): a church, or a ministry (music, teaching, or other) with a description.
// - Each church has an invite code (and link). A code only finds the church; its admins let people in.
//   A person is a member of one church only (decision 39).
// - A ministry has an admin team and followers only: no members, no code, no join requests
//   (decision 40). A church member can also run ministries (decision 42).
// - New porches wait for the platform owner's approval. Until then they work privately but can't
//   post publicly (public posting is Stage 6).
import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";

import { DESCRIPTION_MAX, DESCRIPTION_MIN, MINISTRY_TYPES, PORCH_KINDS, ministryTypeName, type MinistryType, type PorchKind } from "@/lib/porch/porch-kinds";
import { knownCountry } from "@/lib/porch/countries";

export { PORCH_KINDS, type PorchKind };
const KINDS = new Set<string>(PORCH_KINDS.map((kind) => kind.key));
const TYPES = new Set<string>(MINISTRY_TYPES.map((type) => type.key));

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}
function text(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}
const yes = (value: unknown) => value === true || value === "t" || value === "true";

/** Invite codes are easy to read aloud: no 0/O or 1/I/L. */
export function cleanCode(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32) : "";
}
const CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/**
 * A random invite code like K7QM-4XPA (Stage 4e, decision 22): never made from the church's name,
 * so it can't be guessed. 31 letters and digits in 8 places: about 850 billion codes.
 */
export function newCode(_name = "") {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const [index, byte] of bytes.entries()) {
    if (index === 4) code += "-";
    code += CODE_LETTERS[byte % CODE_LETTERS.length];
  }
  return code;
}

/** What a random invite code looks like. */
export const CODE_SHAPE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

let ready: Promise<void> | null = null;
function ensure(sql: Sql) {
  ready ??= (async () => {
    await sql.query("alter table porches add column if not exists main_porch_id integer references porches (id)");
    await sql.query("alter table porches add column if not exists decided_at timestamptz");
    await sql.query("alter table porches drop constraint if exists porches_status_chk");
    await sql.query("alter table porches add constraint porches_status_chk check (status in ('waiting', 'approved', 'suspended', 'declined'))");
    // Every church has an invite code (ministries have none: nobody joins a ministry).
    // Once (Stage 4e): every porch's old name-based code (like PHANEROO-MBARARA) is replaced by a
    // random one. Old codes and links stop working; admins share the new one from Invite.
    const once = await sql.query<{ step: string }>("insert into porch_steps (step) values ('random-invite-codes-v1') on conflict do nothing returning step");
    if (once.length) await sql.query("update porches set invite_code = null where kind = 'church'");
    const missing = await sql.query<{ id: number; name: string }>("select id, name from porches where kind = 'church' and coalesce(invite_code, '') = ''");
    for (const porch of missing) await sql.query("update porches set invite_code = $2 where id = $1", [porch.id, newCode(porch.name)]);
  })().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

async function uniqueCode(sql: Sql, name: string) {
  for (let tries = 0; tries < 8; tries += 1) {
    const code = newCode(name);
    const taken = await sql.query("select 1 from porches where upper(invite_code) = $1", [code]);
    if (!taken.length) return code;
  }
  throw new Error("No free invite code");
}

/** Signed out too: which church porch an invite code belongs to. */
export const checkInvite = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ code: cleanCode(asRecord(input).code) }))
  .handler(async ({ data }) => {
    if (data.code.length < 4) return { ok: false as const, error: "Type the invite code your church gave you." };
    const sql = await getSql();
    await ensure(sql);
    const rows = await sql.query<{ name: string; town: string; country: string }>(
      "select name, town, country from porches where upper(invite_code) = $1 and kind = 'church' and status in ('approved', 'waiting')",
      [data.code],
    );
    if (!rows[0]) return { ok: false as const, error: "That invite code isn't right. Check it with your church." };
    return { ok: true as const, code: data.code, name: rows[0].name, place: [rows[0].town, rows[0].country].filter(Boolean).join(", ") };
  });

/** A new member joins the church porch whose code they used. (Moving church is Stage 5b.) */
export const joinWithCode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      code: cleanCode(raw.code),
      seed: { displayName: text(raw.displayName, 80), email: typeof raw.email === "string" ? raw.email.slice(0, 200) : null, imageUrl: null },
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensure(sql);
    await touchProfile(sql, context.userId, data.seed);
    const porches = await sql.query<{ id: number; name: string }>(
      "select id, name from porches where upper(invite_code) = $1 and kind = 'church' and status in ('approved', 'waiting')",
      [data.code],
    );
    const porch = porches[0];
    if (!porch) return { ok: false as const, error: "That invite code isn't right. Check it with your church." };
    const already = await sql.query("select 1 from porch_members where user_id = $1 and porch_id = $2", [context.userId, porch.id]);
    if (already.length) return { ok: true as const, name: porch.name };
    const me = await sql.query<{ porch_id: number | null; name: string | null }>(
      "select my_porch($1) as porch_id, c.name from porches c where c.id = my_porch($1)",
      [context.userId],
    );
    const current = me[0]?.porch_id ?? null;
    // One church each (decision 39). Leaving a church comes with a later step.
    if (current !== null) {
      return { ok: false as const, error: `You're a member of ${me[0]?.name ?? "another church"}. A person belongs to one church: leave yours first (Your account → Leave this church).` };
    }
    // Stage 5c (decision 14): a code only finds the church. Joining is by a request that the
    // church's admins approve (membership.ts: requestToJoin).
    return { ok: false as const, needsRequest: true, name: porch.name, error: `Send a join request to ${porch.name}. Its admins will let you in.` };
  });

/** A church admin's invite code (to share as a code or a link). */
export const myInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensure(sql);
    const rows = await sql.query<{ name: string; invite_code: string | null; admin: unknown; status: string }>(
      "select name, invite_code, status, is_porch_admin($1) as admin from porches where id = my_porch($1) and kind = 'church'",
      [context.userId],
    );
    const row = rows[0];
    if (!row) return { ok: false as const, error: "You're not in a church porch yet." };
    return { ok: true as const, name: row.name, code: row.invite_code ?? "", admin: yes(row.admin), waiting: row.status === "waiting" };
  });

/** An admin makes a new invite code; the old one stops working. */
export const resetInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensure(sql);
    const rows = await sql.query<{ id: number; name: string; admin: unknown }>(
      "select id, name, is_porch_admin($1) as admin from porches where id = my_porch($1) and kind = 'church'",
      [context.userId],
    );
    if (!rows[0] || !yes(rows[0].admin)) {
      noteAttempt(context.userId, "invite-reset", "Tried to reset an invite code.");
      return { ok: false as const, error: "Only an admin can make a new invite code." };
    }
    const code = await uniqueCode(sql, rows[0].name);
    await sql.query("update porches set invite_code = $2 where id = $1", [rows[0].id, code]);
    return { ok: true as const, code };
  });

/** Approved church porches by name or town (for "Find the main porch"). */
export const findMainPorches = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ query: text(asRecord(input).query, 60) }))
  .handler(async ({ data }) => {
    if (data.query.length < 2) return [];
    const sql = await getSql();
    await ensure(sql);
    const rows = await sql.query<{ id: number; name: string; town: string; country: string }>(
      `select id, name, town, country from porches
        where kind = 'church' and status = 'approved' and (name ilike $1 or short_name ilike $1 or town ilike $1)
        order by name limit 8`,
      [`%${data.query.replace(/[%_]/g, "")}%`],
    );
    return rows.map((row) => ({ id: row.id, name: row.name, place: [row.town, row.country].filter(Boolean).join(", ") }));
  });

/** Start a porch. It waits for the platform owner's approval. */
export const startPorch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    const kind = typeof raw.kind === "string" && KINDS.has(raw.kind) ? (raw.kind as PorchKind) : null;
    const ministryType = typeof raw.ministryType === "string" && TYPES.has(raw.ministryType) ? (raw.ministryType as MinistryType) : null;
    return {
      kind,
      name: text(raw.name, 80),
      country: knownCountry(raw.country),
      ministryType,
      ministryOther: text(raw.ministryOther, 40),
      description: typeof raw.description === "string" ? raw.description.replace(/[ \t]+/g, " ").trim().slice(0, DESCRIPTION_MAX) : "",
      branch: raw.branch === true,
      mainPorchId: Number(raw.mainPorchId) || 0,
      seed: { displayName: text(raw.displayName, 80), email: typeof raw.email === "string" ? raw.email.slice(0, 200) : null, imageUrl: null },
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.kind) return { ok: false as const, error: "Choose what kind of porch it is." };
    if (data.name.length < 3) return { ok: false as const, error: "Give the porch its name." };
    if (!data.country) return { ok: false as const, error: "Choose the country from the list." };
    if (data.kind === "ministry") {
      if (!data.ministryType) return { ok: false as const, error: "Choose what type of ministry it is." };
      if (data.ministryType === "other" && data.ministryOther.length < 2) return { ok: false as const, error: "Name the type of ministry." };
      if (data.description.length < DESCRIPTION_MIN) return { ok: false as const, error: "Describe what the ministry does, in a sentence or two." };
    }
    const sql = await getSql();
    await ensure(sql);
    await touchProfile(sql, context.userId, data.seed);
    // Stage 5c: only accounts with a confirmed email can start a porch.
    const confirmed = await sql.query<{ v: string | null }>("select email_verified_at::text as v from profiles where user_id = $1", [context.userId]);
    if (!confirmed[0]?.v) return { ok: false as const, error: "Confirm your email first." };
    const me = await sql.query<{ porch_id: number | null; name: string | null }>("select my_porch($1) as porch_id, (select name from porches where id = my_porch($1)) as name", [context.userId]);
    const current = me[0]?.porch_id ?? null;
    // One church each (decision 39): a church member can start ministries, not a second church.
    if (data.kind === "church" && current !== null) {
      return { ok: false as const, error: `You're a member of ${me[0]?.name ?? "a church"}. A person belongs to one church, so you can't start another. You can start a ministry.` };
    }
    const waiting = await sql.query<{ n: string }>("select count(*)::text as n from porches where created_by = $1 and status = 'waiting'", [context.userId]);
    if (Number(waiting[0]?.n) >= 3) return { ok: false as const, error: "You already have porches waiting for approval. Wait for those first." };
    // The same porch sent twice (a double tap, a slow connection): give back the one already made.
    const same = await sql.query<{ id: number; invite_code: string | null }>(
      "select id, invite_code from porches where created_by = $1 and lower(name) = lower($2) and kind = $3 and status = 'waiting' order by id limit 1",
      [context.userId, data.name, data.kind],
    );
    if (same[0]) return { ok: true as const, id: same[0].id, name: data.name, kind: data.kind, code: same[0].invite_code, current: data.kind === "church" };
    let mainPorchId: number | null = null;
    if (data.branch) {
      if (data.kind !== "church") return { ok: false as const, error: "Only a church porch can be a branch." };
      const main = await sql.query<{ id: number }>("select id from porches where id = $1 and kind = 'church' and status = 'approved'", [data.mainPorchId]);
      if (!main[0]) return { ok: false as const, error: "Find the main church's porch, or switch off \"This is a branch\"." };
      mainPorchId = main[0].id;
    }
    const church = data.kind === "church";
    const code = church ? await uniqueCode(sql, data.name) : null;
    const made = await sql.query<{ id: number }>(
      `insert into porches (name, short_name, kind, town, country, status, verified, invite_code, created_by, main_porch_id, ministry_type, ministry_other, description)
       values ($1, $1, $2, '', $3, 'waiting', false, $4, $5, $6, $7, $8, $9) returning id`,
      [
        data.name,
        data.kind,
        data.country,
        code,
        context.userId,
        mainPorchId,
        church ? "" : data.ministryType,
        !church && data.ministryType === "other" ? data.ministryOther : "",
        church ? "" : data.description,
      ],
    );
    const porchId = made[0].id;
    await sql.query("insert into porch_settings (porch_id) values ($1) on conflict do nothing", [porchId]);
    await sql.query("insert into porch_admins (porch_id, user_id, added_by) values ($1, $2, 'started it') on conflict do nothing", [porchId, context.userId]);
    // Whoever starts a church is its first member (and admin). A ministry has admins only.
    if (church) {
      await addMember(sql, porchId, context.userId);
      await sql.query("update profiles set porch_id = $2 where user_id = $1", [context.userId, porchId]);
    }
    return { ok: true as const, id: porchId, name: data.name, kind: data.kind, code, current: church };
  });

/** The porches this person runs (as an admin), with where each stands. */
export const myPorches = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensure(sql);
    const rows = await sql.query<{ id: number; name: string; kind: string; status: string }>(
      `select p.id, p.name, p.kind, p.status from porch_admins a join porches p on p.id = a.porch_id
        where a.user_id = $1 order by p.created_at`,
      [context.userId],
    );
    return rows.map((row) => ({ id: row.id, name: row.name, kind: row.kind, status: row.status }));
  });

async function isOwner(sql: Sql, userId: string) {
  const rows = await sql.query<{ owner: unknown }>("select is_platform_owner($1) as owner", [userId]);
  return yes(rows[0]?.owner);
}

/** The porches that became Ministry, type Other, on 26 November (decision 38). */
async function changedToMinistry(sql: Sql) {
  const rows = await sql.query<{ id: number; name: string; old_kind: string; status: string; ministry_other: string }>(
    `select p.id, p.name, k.old_kind, p.status, p.ministry_other from porch_kind_changes k join porches p on p.id = k.porch_id order by p.id`,
  );
  const was = (kind: string) => (kind === "organisation" ? "Organisation" : "Psalmist");
  return rows.map((row) => ({ id: row.id, name: row.name, was: was(row.old_kind), status: row.status, typeName: row.ministry_other || "Other" }));
}

/** The platform owner's list: porches waiting for approval. */
export const waitingPorches = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensure(sql);
    if (!(await isOwner(sql, context.userId))) return { ok: false as const, error: "Only the platform owner sees this list.", porches: [] };
    const rows = await sql.query<{
      id: number;
      name: string;
      kind: string;
      town: string;
      country: string;
      starter: string | null;
      main_name: string | null;
      created_at: string;
      ministry_type: string;
      ministry_other: string;
      description: string;
    }>(
      `select p.id, p.name, p.kind, p.town, p.country, s.display_name as starter, m.name as main_name, p.ministry_type, p.ministry_other, p.description,
              to_char(p.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
         from porches p
         left join profiles s on s.user_id = p.created_by
         left join porches m on m.id = p.main_porch_id
        where p.status = 'waiting'
        order by p.created_at`,
    );
    return {
      ok: true as const,
      porches: rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        place: [row.town, row.country].filter(Boolean).join(", "),
        starter: row.starter ?? "",
        mainName: row.main_name ?? "",
        createdAt: row.created_at,
        ministryType: row.kind === "ministry" ? ministryTypeName(row.ministry_type, row.ministry_other) : "",
        description: row.description ?? "",
      })),
      changed: await changedToMinistry(sql),
    };
  });

/** The platform owner approves or declines a waiting porch. */
export const decidePorch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { id: Number(raw.id) || 0, approve: raw.approve === true };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensure(sql);
    if (!(await isOwner(sql, context.userId))) {
      noteAttempt(context.userId, "porch-approve", "Tried to approve or decline a porch.");
      return { ok: false as const, error: "Only the platform owner can do that." };
    }
    const rows = await sql.query<{ id: number }>(
      "update porches set status = $2, verified = $3, decided_at = now() where id = $1 and status = 'waiting' returning id",
      [data.id, data.approve ? "approved" : "declined", data.approve],
    );
    if (!rows.length) return { ok: false as const, error: "That porch isn't waiting any more." };
    if (!data.approve) {
      // A declined porch frees its people; its admins step down. Anyone switched to it moves to
      // another porch of theirs, if they have one.
      await sql.query("delete from porch_members where porch_id = $1", [data.id]);
      await sql.query("delete from porch_admins where porch_id = $1", [data.id]);
      await sql.query(
        `update profiles p set porch_id = (select m.porch_id from porch_members m where m.user_id = p.user_id order by m.joined_at, m.porch_id limit 1)
          where p.porch_id = $1`,
        [data.id],
      );
    }
    return { ok: true as const };
  });

/**
 * Make someone a member of a porch (M2). Only called once a porch's admins have let them in, or
 * when they start the porch. Their full name and phone start from what they gave before.
 */
export async function addMember(sql: Sql, porchId: number, userId: string, details?: { fullName?: string; phone?: string; city?: string }) {
  // Only a church has members, and a person is in one church only (decisions 39 and 40).
  await sql.query(
    `insert into porch_members (porch_id, user_id, full_name, phone, city, shared_at)
     select $1, p.user_id, coalesce(nullif($3, ''), p.display_name, ''), coalesce($4, ''), coalesce($5, ''), case when $3 is null then null else now() end
       from profiles p
      where p.user_id = $2
        and exists (select 1 from porches c where c.id = $1 and c.kind = 'church')
        and not exists (select 1 from porch_members o where o.user_id = $2 and o.porch_id <> $1)
     on conflict (porch_id, user_id) do update set
       full_name = coalesce(nullif(excluded.full_name, ''), porch_members.full_name),
       phone = coalesce(nullif(excluded.phone, ''), porch_members.phone),
       city = coalesce(nullif(excluded.city, ''), porch_members.city)`,
    [porchId, userId, details?.fullName ?? null, details?.phone ?? null, details?.city ?? null],
  );
}

/** Every porch this person belongs to, and which one they're switched to (for the switcher, M3). */
export const myMemberships = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensure(sql);
    const rows = await sql.query<{ id: number; name: string; kind: string; status: string; accent: string | null; admin: unknown; current: unknown }>(
      `select c.id, c.name, c.kind, c.status, s.accent, is_admin_of($1, c.id) as admin, (c.id = my_porch($1)) as current
         from porch_members m join porches c on c.id = m.porch_id
         left join porch_settings s on s.porch_id = c.id
        where m.user_id = $1 and c.status <> 'declined'
        order by m.joined_at, c.id`,
      [context.userId],
    );
    return rows.map((row) => ({ id: row.id, name: row.name, kind: row.kind, status: row.status, accent: row.accent ?? "gold", admin: yes(row.admin), current: yes(row.current) }));
  });

/** Switch to another porch of yours. Every screen then shows that porch. Refused for a porch you're not in. */
export const switchPorch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ porchId: Number(asRecord(input).porchId) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensure(sql);
    const rows = await sql.query<{ name: string }>(
      `update profiles p set porch_id = $2
        where p.user_id = $1 and exists (
          select 1 from porch_members m join porches c on c.id = m.porch_id
           where m.user_id = $1 and m.porch_id = $2 and c.status <> 'declined'
        )
        returning (select name from porches where id = $2) as name`,
      [context.userId, data.porchId],
    );
    if (!rows[0]) {
      noteAttempt(context.userId, "porch-switch", "Tried to switch to a porch they're not a member of.");
      return { ok: false as const, error: "You're not a member of that porch." };
    }
    return { ok: true as const, name: rows[0].name };
  });

/**
 * N3 (decision 43): "Continue as me" (porchId 0) or "Continue as [ministry]" for a ministry this
 * person runs. While acting as a ministry, their church's private porch is closed (my_porch is
 * none), so nothing they do as the ministry can reach or show their church.
 */
export const actAs = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ porchId: Number(asRecord(input).porchId) || 0 }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensure(sql);
    if (!data.porchId) {
      await sql.query("update profiles set acting_porch_id = null where user_id = $1", [context.userId]);
      return { ok: true as const, name: "" };
    }
    const rows = await sql.query<{ name: string }>(
      "update profiles set acting_porch_id = $2 where user_id = $1 and runs_ministry($1, $2) returning (select name from porches where id = $2) as name",
      [context.userId, data.porchId],
    );
    if (!rows[0]) {
      noteAttempt(context.userId, "act-as", "Tried to act as a ministry they don't run.");
      return { ok: false as const, error: "You're not an admin of that ministry." };
    }
    return { ok: true as const, name: rows[0].name };
  });

/** The ministry this person is acting as: what its own page shows (its admins only see this). */
export const ministryHome = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensure(sql);
    const rows = await sql.query<{ id: number; name: string; status: string; country: string; ministry_type: string; ministry_other: string; description: string; created_at: string }>(
      `select c.id, c.name, c.status, c.country, c.ministry_type, c.ministry_other, c.description,
              to_char(c.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
         from profiles p join porches c on c.id = p.acting_porch_id
        where p.user_id = $1 and runs_ministry($1, c.id)`,
      [context.userId],
    );
    const ministry = rows[0];
    if (!ministry) return { ok: false as const, error: "You're not acting as a ministry." };
    const admins = await sql.query<{ user_id: string; name: string; username: string | null }>(
      `select p.user_id, public_name(p.user_id) as name, p.username
         from porch_admins a join profiles p on p.user_id = a.user_id where a.porch_id = $1 order by a.added_at`,
      [ministry.id],
    );
    return {
      ok: true as const,
      id: ministry.id,
      name: ministry.name,
      status: ministry.status,
      country: ministry.country,
      typeName: ministryTypeName(ministry.ministry_type, ministry.ministry_other),
      description: ministry.description,
      since: ministry.created_at,
      admins: admins.map((a) => ({ userId: a.user_id, name: a.name, username: a.username ?? "" })),
    };
  });

/** N7: the ministry's team messages (only its admins, while acting as it). */
async function actingMinistry(sql: Sql, userId: string): Promise<number> {
  const rows = await sql.query<{ id: number | null }>(
    "select p.acting_porch_id as id from profiles p where p.user_id = $1 and runs_ministry($1, p.acting_porch_id)",
    [userId],
  );
  return Number(rows[0]?.id ?? 0) || 0;
}

export const ministryTeamMessages = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensure(sql);
    const ministry = await actingMinistry(sql, context.userId);
    if (!ministry) return { ok: false as const, error: "Continue as the ministry to see its team messages.", messages: [] };
    const rows = await sql.query<{ id: number; author_id: string; name: string; body: string; created_at: string }>(
      `select t.id, t.author_id, public_name(t.author_id) as name, t.body,
              to_char(t.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
         from ministry_team_messages t where t.porch_id = $1 order by t.created_at desc limit 60`,
      [ministry],
    );
    return {
      ok: true as const,
      messages: rows.reverse().map((row) => ({ id: row.id, mine: row.author_id === context.userId, name: row.name, body: row.body, at: row.created_at })),
    };
  });

export const sendMinistryTeamMessage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input).body;
    return { body: typeof raw === "string" ? raw.trim().slice(0, 1000) : "" };
  })
  .handler(async ({ context, data }) => {
    if (!data.body) return { ok: false as const, error: "Write a message." };
    const sql = await getSql();
    await ensure(sql);
    const ministry = await actingMinistry(sql, context.userId);
    if (!ministry) {
      noteAttempt(context.userId, "ministry-team", "Tried to write to a ministry team they're not acting for.");
      return { ok: false as const, error: "Only the ministry's admins, acting as it, can write here." };
    }
    await sql.query("insert into ministry_team_messages (porch_id, author_id, body) values ($1, $2, $3)", [ministry, context.userId, data.body]);
    return { ok: true as const };
  });
