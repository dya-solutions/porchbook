// Stage 5a: joining and starting a porch.
// - Every porch has an invite code (and link). A code only finds the porch; its admins let people in.
// - Anyone can start a porch of any type (church, ministry, psalmist, organisation). They become
//   its first member and admin (M1, decision 24). A person can be in many porches (decision 25).
// - New porches wait for the platform owner's approval. Until then they work privately but can't
//   post publicly (public posting is Stage 6).
import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";

export const PORCH_KINDS = [
  { key: "church", name: "Church" },
  { key: "ministry", name: "Ministry" },
  { key: "psalmist", name: "Psalmist" },
  { key: "organisation", name: "Organisation" },
] as const;
export type PorchKind = (typeof PORCH_KINDS)[number]["key"];
const KINDS = new Set<string>(PORCH_KINDS.map((kind) => kind.key));

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
    // Every porch has an invite code (M1: all four types, not only churches).
    // Once (Stage 4e): every porch's old name-based code (like PHANEROO-MBARARA) is replaced by a
    // random one. Old codes and links stop working; admins share the new one from Invite.
    const once = await sql.query<{ step: string }>("insert into porch_steps (step) values ('random-invite-codes-v1') on conflict do nothing returning step");
    if (once.length) await sql.query("update porches set invite_code = null where kind = 'church'");
    const missing = await sql.query<{ id: number; name: string }>("select id, name from porches where coalesce(invite_code, '') = ''");
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
      "select name, town, country from porches where upper(invite_code) = $1 and status in ('approved', 'waiting')",
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
      "select id, name from porches where upper(invite_code) = $1 and status in ('approved', 'waiting')",
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
    // Joining a second porch by request comes with the new join form (M4).
    if (current !== null) {
      return { ok: false as const, error: `You're a member of ${me[0]?.name ?? "another church"}. Moving to another church comes soon.` };
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
      "select name, invite_code, status, is_porch_admin($1) as admin from porches where id = my_porch($1)",
      [context.userId],
    );
    const row = rows[0];
    if (!row) return { ok: false as const, error: "You're not in a porch yet." };
    return { ok: true as const, name: row.name, code: row.invite_code ?? "", admin: yes(row.admin), waiting: row.status === "waiting" };
  });

/** An admin makes a new invite code; the old one stops working. */
export const resetInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensure(sql);
    const rows = await sql.query<{ id: number; name: string; admin: unknown }>(
      "select id, name, is_porch_admin($1) as admin from porches where id = my_porch($1)",
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
    const place = text(raw.place, 80);
    const [town = "", ...rest] = place.split(",");
    return {
      kind,
      name: text(raw.name, 80),
      town: town.trim(),
      country: rest.join(",").trim(),
      branch: raw.branch === true,
      mainPorchId: Number(raw.mainPorchId) || 0,
      seed: { displayName: text(raw.displayName, 80), email: typeof raw.email === "string" ? raw.email.slice(0, 200) : null, imageUrl: null },
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.kind) return { ok: false as const, error: "Choose what kind of porch it is." };
    if (data.name.length < 3) return { ok: false as const, error: "Give the porch its name." };
    if (!data.town) return { ok: false as const, error: "Add the town and country." };
    const sql = await getSql();
    await ensure(sql);
    await touchProfile(sql, context.userId, data.seed);
    // Stage 5c: only accounts with a confirmed email can start a porch.
    const confirmed = await sql.query<{ v: string | null }>("select email_verified_at::text as v from profiles where user_id = $1", [context.userId]);
    if (!confirmed[0]?.v) return { ok: false as const, error: "Confirm your email first." };
    const me = await sql.query<{ porch_id: number | null }>("select my_porch($1) as porch_id", [context.userId]);
    const current = me[0]?.porch_id ?? null;
    const waiting = await sql.query<{ n: string }>("select count(*)::text as n from porches where created_by = $1 and status = 'waiting'", [context.userId]);
    if (Number(waiting[0]?.n) >= 3) return { ok: false as const, error: "You already have porches waiting for approval. Wait for those first." };
    // The same porch sent twice (a double tap, a slow connection): give back the one already made.
    const same = await sql.query<{ id: number; invite_code: string | null }>(
      "select id, invite_code from porches where created_by = $1 and lower(name) = lower($2) and kind = $3 and status = 'waiting' order by id limit 1",
      [context.userId, data.name, data.kind],
    );
    if (same[0]) return { ok: true as const, id: same[0].id, name: data.name, kind: data.kind, code: same[0].invite_code, current: current === null || current === same[0].id };
    let mainPorchId: number | null = null;
    if (data.branch) {
      if (data.kind !== "church") return { ok: false as const, error: "Only a church porch can be a branch." };
      const main = await sql.query<{ id: number }>("select id from porches where id = $1 and kind = 'church' and status = 'approved'", [data.mainPorchId]);
      if (!main[0]) return { ok: false as const, error: "Find the main church's porch, or switch off \"This is a branch\"." };
      mainPorchId = main[0].id;
    }
    const code = await uniqueCode(sql, data.name);
    const made = await sql.query<{ id: number }>(
      `insert into porches (name, short_name, kind, town, country, status, verified, invite_code, created_by, main_porch_id)
       values ($1, $1, $2, $3, $4, 'waiting', false, $5, $6, $7) returning id`,
      [data.name, data.kind, data.town, data.country, code, context.userId, mainPorchId],
    );
    const porchId = made[0].id;
    await sql.query("insert into porch_settings (porch_id) values ($1) on conflict do nothing", [porchId]);
    await sql.query("insert into porch_admins (porch_id, user_id, added_by) values ($1, $2, 'started it') on conflict do nothing", [porchId, context.userId]);
    // The person who starts a porch (any type) is its first member. If they're in no porch yet,
    // it becomes the porch they're switched to; otherwise they stay where they are.
    await addMember(sql, porchId, context.userId);
    if (current === null) await sql.query("update profiles set porch_id = $2 where user_id = $1", [context.userId, porchId]);
    return { ok: true as const, id: porchId, name: data.name, kind: data.kind, code, current: current === null };
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
    }>(
      `select p.id, p.name, p.kind, p.town, p.country, s.display_name as starter, m.name as main_name,
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
      })),
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
  await sql.query(
    `insert into porch_members (porch_id, user_id, full_name, phone, city, shared_at)
     select $1, p.user_id, coalesce(nullif($3, ''), p.display_name, ''), coalesce($4, ''), coalesce($5, ''), case when $3 is null then null else now() end
       from profiles p where p.user_id = $2
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
