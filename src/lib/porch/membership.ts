// Stage 5c: accounts and join requests (BUILD-BRIEF.md decisions 14-17).
// - A Porchbook account: full name, an email verified by a 6-digit code, an optional unique
//   username. An account alone can use the public porch but belongs to no private porch.
// - Membership of one church, by request only: full name, phone and city (N2, decisions 27 and
//   35). The church's admins let the person in or decline. An invite code only opens the request.
// - The details live in the membership list (porch_members), one row for the person's church.
//   They're seen by the member and that church's admins only (admin levels come in Stage 5d),
//   and are deleted when someone leaves the church (N3: leaveChurch).
import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";
import { ministryTypeName } from "@/lib/porch/porch-kinds";

/** What the church asks for, and the one line that says why (decision 17). */
export const DETAIL_FIELDS = [
  { key: "fullName", label: "Full name", why: "So your church family knows who you are. It's the name your posts and messages show in your church." },
  { key: "phone", label: "Phone number", why: "So your church can reach you for care, visits and urgent news." },
  { key: "city", label: "City or town", why: "So your church knows where you live and can link you with a group near you." },
] as const;

export type MemberDetails = { fullName: string; phone: string; city: string };

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}
function text(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}
const yes = (value: unknown) => value === true || value === "t" || value === "true";
const seedOf = (raw: Record<string, unknown>) => ({
  displayName: text(raw.displayName, 80),
  email: typeof raw.email === "string" ? raw.email.slice(0, 200) : null,
  imageUrl: null,
});

function parseDetails(raw: Record<string, unknown>): MemberDetails {
  return {
    fullName: text(raw.fullName, 80),
    phone: text(raw.phone, 30),
    city: text(raw.city, 60),
  };
}
function missingIn(details: MemberDetails) {
  return DETAIL_FIELDS.filter((field) => !details[field.key]).map((field) => field.label);
}
function checkDetails(details: MemberDetails): string {
  const missing = missingIn(details);
  if (missing.length) return `Please add: ${missing.join(", ")}.`;
  if (details.fullName.split(" ").length < 2) return "Please give your full name (first and last name).";
  if (!/^[+0-9][0-9 ()-]{6,}$/.test(details.phone)) return "Please give a phone number with digits only, e.g. +256 700 000000.";
  return "";
}

let ready: Promise<void> | null = null;
function ensure(sql: Sql) {
  ready ??= (async () => {
    await sql.query(`create table if not exists email_codes (
      user_id text primary key,
      code_hash text not null,
      expires_at timestamptz not null,
      tries integer not null default 0,
      sent_at timestamptz not null default now(),
      sent_today integer not null default 1
    )`);
    await sql.query(`create table if not exists member_details (
      user_id text primary key,
      porch_id integer not null references porches (id),
      nation text not null default '',
      phone text not null default '',
      address text not null default '',
      updated_at timestamptz not null default now()
    )`);
    await sql.query(`create table if not exists join_requests (
      id serial primary key,
      porch_id integer not null references porches (id),
      user_id text not null,
      full_name text not null,
      nation text not null,
      phone text not null,
      address text not null,
      status text not null default 'waiting',
      created_at timestamptz not null default now(),
      decided_by text,
      decided_at timestamptz,
      constraint join_requests_status_chk check (status in ('waiting', 'let-in', 'declined', 'cancelled'))
    )`);
    await sql.query("create index if not exists join_requests_porch_idx on join_requests (porch_id, status)");
    await sql.query("create unique index if not exists join_requests_one_waiting on join_requests (user_id) where status = 'waiting'");
    // N2: a join request asks for the city (nation and address are no longer asked).
    await sql.query("alter table join_requests add column if not exists city text not null default ''");
    // N2, once (decision 35): the nation and address people already gave are deleted. The phone
    // numbers were copied to the membership list in M2, so the old details table is emptied.
    await sql.query(
      `with done as (insert into porch_steps (step) values ('nation-address-deleted-v1') on conflict (step) do nothing returning step)
       update join_requests set nation = '', address = '' where (nation <> '' or address <> '') and exists (select 1 from done)`,
    );
    await sql.query("delete from member_details");
    // M2, once: the phone number a member already gave moves to their row in the membership list.
    await sql.query(
      `with done as (insert into porch_steps (step) values ('porch-members-phone-v1') on conflict (step) do nothing returning step)
       update porch_members m set phone = d.phone
         from member_details d
        where d.user_id = m.user_id and d.porch_id = m.porch_id and m.phone = '' and d.phone <> '' and exists (select 1 from done)`,
    );
  })().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

async function hashCode(userId: string, code: string) {
  const data = new TextEncoder().encode(`${userId}:${code}:porchbook`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The account's real email, from the sign-in itself (never what the browser says). */
async function accountEmail(sql: Sql, userId: string) {
  const rows = await sql.query<{ email: string | null; name: string | null }>('select email, name from "user" where id = $1', [userId]);
  return { email: rows[0]?.email ?? "", name: rows[0]?.name ?? "" };
}

/** Where this account stands: verified, username, church, waiting request, missing details. */
export const accountState = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => seedOf(asRecord(input)))
  .handler(async ({ context, data: seed }) => {
    const sql = await getSql();
    await ensure(sql);
    await touchProfile(sql, context.userId, seed);
    const me = await sql.query<{
      display_name: string;
      verified: string | null;
      username: string | null;
      hide_church: unknown;
      porch_id: number | null;
      porch_name: string | null;
      full_name: string | null;
      phone: string | null;
      city: string | null;
      acting: number | null;
    }>(
      `select p.display_name, p.email_verified_at::text as verified, p.username, p.hide_church, church_of(p.user_id) as porch_id, c.name as porch_name,
              m.full_name, m.phone, m.city, p.acting_porch_id as acting
         from profiles p
         left join porches c on c.id = church_of(p.user_id)
         left join porch_members m on m.user_id = p.user_id and m.porch_id = church_of(p.user_id)
        where p.user_id = $1`,
      [context.userId],
    );
    const row = me[0];
    const waiting = await sql.query<{ id: number; porch_name: string; created_at: string }>(
      `select r.id, c.name as porch_name, to_char(r.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
         from join_requests r join porches c on c.id = r.porch_id
        where r.user_id = $1 and r.status = 'waiting'`,
      [context.userId],
    );
    const declined = await sql.query<{ porch_name: string }>(
      `select c.name as porch_name from join_requests r join porches c on c.id = r.porch_id
        where r.user_id = $1 and r.status = 'declined' order by r.decided_at desc limit 1`,
      [context.userId],
    );
    const details: MemberDetails = { fullName: row?.full_name || row?.display_name || "", phone: row?.phone ?? "", city: row?.city ?? "" };
    const { email } = await accountEmail(sql, context.userId);
    // N3 + Stage 6: the porches this person can "Continue as" (ministries they run, and a church
    // they're an admin of), and the one they're acting as (if any). The church comes first.
    const ministries = await sql.query<{ id: number; name: string; kind: string; status: string; ministry_type: string; ministry_other: string; accent: string | null }>(
      `select c.id, c.name, c.kind, c.status, c.ministry_type, c.ministry_other, s.accent
         from porch_admins a join porches c on c.id = a.porch_id left join porch_settings s on s.porch_id = c.id
        where a.user_id = $1 and can_act_as($1, c.id)
        order by (c.kind = 'church') desc, c.created_at`,
      [context.userId],
    );
    const runs = ministries.map((m) => ({
      id: m.id,
      name: m.name,
      kind: m.kind,
      status: m.status,
      typeName: m.kind === "church" ? "Church" : ministryTypeName(m.ministry_type, m.ministry_other),
      accent: m.accent ?? "gold",
    }));
    const acting = runs.find((m) => m.id === row?.acting) ?? null;
    return {
      email,
      verified: Boolean(row?.verified),
      username: row?.username ?? "",
      hideChurch: yes(row?.hide_church),
      member: row?.porch_id !== null && row?.porch_id !== undefined,
      porchName: row?.porch_name ?? "",
      fullName: details.fullName,
      ministries: runs,
      acting,
      waiting: waiting[0] ? { id: waiting[0].id, porchName: waiting[0].porch_name, since: waiting[0].created_at } : null,
      lastDeclined: declined[0]?.porch_name ?? "",
      // A member with details missing (for example the city, new in N2) is asked for them once,
      // the next time they open the app.
      missing: row?.porch_id ? missingIn(details) : [],
    };
  });

/** Send (or send again) the 6-digit code to the account's email. */
export const sendEmailCode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensure(sql);
    const verified = await sql.query<{ v: string | null }>("select email_verified_at::text as v from profiles where user_id = $1", [context.userId]);
    if (verified[0]?.v) return { ok: true as const, already: true, testCode: "" };
    const last = await sql.query<{ seconds: number; sent_today: number; same_day: unknown }>(
      `select extract(epoch from now() - sent_at)::int as seconds, sent_today, (sent_at::date = now()::date) as same_day
         from email_codes where user_id = $1`,
      [context.userId],
    );
    if (last[0] && Number(last[0].seconds) < 45) return { ok: false as const, error: "A code was just sent. Wait a minute before asking again." };
    const sentToday = last[0] && yes(last[0].same_day) ? Number(last[0].sent_today) : 0;
    if (sentToday >= 6) return { ok: false as const, error: "Too many codes today. Try again tomorrow." };
    const { email, name } = await accountEmail(sql, context.userId);
    if (!email) return { ok: false as const, error: "This account has no email address." };
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const code = String(bytes[0] % 1_000_000).padStart(6, "0");
    const { sendCodeEmail } = await import("@/lib/porch/email.server");
    const sent = await sendCodeEmail(email, name, code);
    if (!sent.ok) return { ok: false as const, error: sent.error };
    await sql.query(
      `insert into email_codes (user_id, code_hash, expires_at, tries, sent_at, sent_today)
       values ($1, $2, now() + interval '15 minutes', 0, now(), $3)
       on conflict (user_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, tries = 0, sent_at = now(), sent_today = excluded.sent_today`,
      [context.userId, await hashCode(context.userId, code), sentToday + 1],
    );
    // Test mode (no Brevo key on this computer, never in a deployed app): the code shows on screen.
    return { ok: true as const, already: false, testCode: sent.how === "test" ? code : "", email };
  });

/** Check the code. Five wrong tries and a new code is needed. */
export const verifyEmailCode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ code: text(asRecord(input).code, 12).replace(/\D/g, "") }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensure(sql);
    const rows = await sql.query<{ code_hash: string; live: unknown; tries: number }>(
      "select code_hash, (expires_at > now()) as live, tries from email_codes where user_id = $1",
      [context.userId],
    );
    const row = rows[0];
    if (!row) return { ok: false as const, error: "Ask for a code first." };
    if (!yes(row.live)) return { ok: false as const, error: "That code has run out. Ask for a new one." };
    if (Number(row.tries) >= 5) return { ok: false as const, error: "Too many wrong tries. Ask for a new code." };
    if (data.code.length !== 6 || (await hashCode(context.userId, data.code)) !== row.code_hash) {
      await sql.query("update email_codes set tries = tries + 1 where user_id = $1", [context.userId]);
      return { ok: false as const, error: "That code isn't right. Check the email and try again." };
    }
    await sql.query("update profiles set email_verified_at = now() where user_id = $1", [context.userId]);
    await sql.query("delete from email_codes where user_id = $1", [context.userId]);
    return { ok: true as const };
  });

async function isVerified(sql: Sql, userId: string) {
  const rows = await sql.query<{ v: string | null }>("select email_verified_at::text as v from profiles where user_id = $1", [userId]);
  return Boolean(rows[0]?.v);
}

/** An optional, unique username (for the public porch). Empty removes it. */
export const USERNAME_SHAPE = /^[a-z0-9_.]{3,20}$/;

/** Signed out too: is this username free? (Create account, decision 44.) */
export const usernameFree = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ username: text(asRecord(input).username, 40).replace(/^@/, "").toLowerCase() }))
  .handler(async ({ data }) => {
    if (!USERNAME_SHAPE.test(data.username)) return { ok: false as const, error: "Use 3 to 20 letters, numbers, dots or underscores, with no spaces." };
    const sql = await getSql();
    await ensure(sql);
    const taken = await sql.query("select 1 from profiles where lower(username) = $1", [data.username]);
    if (taken.length) return { ok: false as const, error: "Someone already has that username. Try another." };
    return { ok: true as const, username: data.username };
  });

export const setUsername = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { username: text(raw.username, 40).replace(/^@/, "").toLowerCase(), seed: seedOf(raw) };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensure(sql);
    await touchProfile(sql, context.userId, data.seed);
    if (!data.username) {
      await sql.query("update profiles set username = null where user_id = $1", [context.userId]);
      return { ok: true as const, username: "" };
    }
    if (!USERNAME_SHAPE.test(data.username)) {
      return { ok: false as const, error: "Use 3 to 20 letters, numbers, dots or underscores, with no spaces." };
    }
    const taken = await sql.query("select 1 from profiles where lower(username) = $1 and user_id <> $2", [data.username, context.userId]);
    if (taken.length) return { ok: false as const, error: "Someone already has that username. Try another." };
    await sql.query("update profiles set username = $2 where user_id = $1", [context.userId, data.username]);
    return { ok: true as const, username: data.username };
  });

/** The personal switch: hide my church on public reactions (shown by default). */
export const setHideChurch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ hide: asRecord(input).hide === true }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql.query("update profiles set hide_church = $2 where user_id = $1", [context.userId, data.hide]);
    return { ok: true as const, hide: data.hide };
  });

/** Send a join request to the church whose invite code was used. Admins let the person in. */
export const requestToJoin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return {
      code: typeof raw.code === "string" ? raw.code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32) : "",
      // N5: "Ask to join" from Find porches names the church instead of a code (approved churches only).
      porchId: Number(raw.porchId) || 0,
      details: parseDetails(raw),
      seed: seedOf(raw),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensure(sql);
    await touchProfile(sql, context.userId, data.seed);
    if (!(await isVerified(sql, context.userId))) return { ok: false as const, error: "Confirm your email first." };
    const problem = checkDetails(data.details);
    if (problem) return { ok: false as const, error: problem };
    const porches = data.code
      ? await sql.query<{ id: number; name: string }>(
          "select id, name from porches where upper(invite_code) = $1 and kind = 'church' and status in ('approved', 'waiting')",
          [data.code],
        )
      : await sql.query<{ id: number; name: string }>("select id, name from porches where id = $1 and kind = 'church' and status = 'approved'", [data.porchId]);
    const porch = porches[0];
    if (!porch) return { ok: false as const, error: data.code ? "That invite code isn't right. Check it with your church." : "That church isn't on Porchbook." };
    const me = await sql.query<{ porch_id: number | null }>("select church_of($1) as porch_id", [context.userId]);
    if (me[0]?.porch_id) return { ok: false as const, error: "You're already a member of a church. A person belongs to one church: leave yours first (Your account → Leave this church)." };
    await sql.query("update join_requests set status = 'cancelled' where user_id = $1 and status = 'waiting'", [context.userId]);
    await sql.query(
      "insert into join_requests (porch_id, user_id, full_name, nation, phone, address, city) values ($1, $2, $3, '', $4, '', $5)",
      [porch.id, context.userId, data.details.fullName, data.details.phone, data.details.city],
    );
    await sql.query("update profiles set display_name = $2 where user_id = $1", [context.userId, data.details.fullName]);
    // Tell the church's admins.
    try {
      const admins = await sql.query<{ user_id: string }>(
        "select a.user_id from porch_admins a join porch_members m on m.user_id = a.user_id and m.porch_id = a.porch_id where a.porch_id = $1",
        [porch.id],
      );
      const { notifyPeople } = await import("@/lib/porch/push.server");
      await notifyPeople(sql, admins.map((row) => row.user_id), "People waiting to join", `${data.details.fullName} asks to join ${porch.name}`, "/waiting-to-join");
    } catch {
      /* the request is saved either way */
    }
    return { ok: true as const, porchName: porch.name };
  });

/** Take back a waiting request. */
export const cancelJoinRequest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensure(sql);
    await sql.query("update join_requests set status = 'cancelled' where user_id = $1 and status = 'waiting'", [context.userId]);
    return { ok: true as const };
  });

async function isAdmin(sql: Sql, userId: string) {
  const rows = await sql.query<{ admin: unknown }>("select is_porch_admin($1) as admin", [userId]);
  return yes(rows[0]?.admin);
}

export type WaitingPerson = { id: number; userId: string; fullName: string; phone: string; city: string; email: string; since: string };

/** Admins: the people waiting to join their own church. */
export const waitingToJoin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensure(sql);
    if (!(await isAdmin(sql, context.userId))) return { ok: false as const, error: "Only your church's admins see this list.", people: [] as WaitingPerson[] };
    const rows = await sql.query<{ id: number; user_id: string; full_name: string; phone: string; city: string; email: string | null; created_at: string }>(
      `select r.id, r.user_id, r.full_name, r.phone, r.city, u.email,
              to_char(r.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
         from join_requests r left join "user" u on u.id = r.user_id
        where r.porch_id = my_porch($1) and r.status = 'waiting'
        order by r.created_at`,
      [context.userId],
    );
    return {
      ok: true as const,
      people: rows.map((row) => ({ id: row.id, userId: row.user_id, fullName: row.full_name, phone: row.phone, city: row.city, email: row.email ?? "", since: row.created_at })),
    };
  });

/** Admins let someone in, or decline. Nobody gets in without this. */
export const decideJoinRequest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const raw = asRecord(input);
    return { id: Number(raw.id) || 0, letIn: raw.letIn === true };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensure(sql);
    const rows = await sql.query<{ id: number; porch_id: number; user_id: string; full_name: string; phone: string; city: string; porch_name: string }>(
      `select r.id, r.porch_id, r.user_id, r.full_name, r.phone, r.city, c.name as porch_name
         from join_requests r join porches c on c.id = r.porch_id
        where r.id = $1 and r.status = 'waiting' and r.porch_id = my_porch($2)`,
      [data.id, context.userId],
    );
    const request = rows[0];
    if (!request || !(await isAdmin(sql, context.userId))) {
      noteAttempt(context.userId, "join-decide", "Tried to decide a join request that isn't their church's.");
      return { ok: false as const, error: "That request isn't waiting in your church." };
    }
    if (!data.letIn) {
      await sql.query("update join_requests set status = 'declined', decided_by = $2, decided_at = now() where id = $1", [request.id, context.userId]);
      try {
        const { notifyPeople } = await import("@/lib/porch/push.server");
        await notifyPeople(sql, [request.user_id], request.porch_name, `Your request to join ${request.porch_name} wasn't accepted.`, "/");
      } catch {
        /* fine */
      }
      return { ok: true as const };
    }
    const joined = await sql.query<{ user_id: string }>("update profiles set porch_id = $2, display_name = $3 where user_id = $1 and my_porch(user_id) is null returning user_id", [
      request.user_id,
      request.porch_id,
      request.full_name,
    ]);
    if (!joined.length) {
      await sql.query("update join_requests set status = 'cancelled', decided_by = $2, decided_at = now() where id = $1", [request.id, context.userId]);
      return { ok: false as const, error: "That person has already joined a church." };
    }
    const { addMember } = await import("@/lib/porch/porch-join");
    await addMember(sql, request.porch_id, request.user_id, { fullName: request.full_name, phone: request.phone, city: request.city });
    await sql.query("update join_requests set status = 'let-in', decided_by = $2, decided_at = now() where id = $1", [request.id, context.userId]);
    try {
      const { notifyPeople } = await import("@/lib/porch/push.server");
      await notifyPeople(sql, [request.user_id], request.porch_name, `Welcome! You're now a member of ${request.porch_name}.`, "/");
    } catch {
      /* fine */
    }
    return { ok: true as const };
  });

/** A member's own details, to see and correct. */
export const myDetails = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensure(sql);
    const rows = await sql.query<{ display_name: string; full_name: string | null; phone: string | null; city: string | null; porch_id: number | null; porch_name: string | null; username: string | null; hide_church: unknown }>(
      `select p.display_name, m.full_name, m.phone, m.city, church_of(p.user_id) as porch_id, c.name as porch_name, p.username, p.hide_church
         from profiles p
         left join porch_members m on m.user_id = p.user_id and m.porch_id = church_of(p.user_id)
         left join porches c on c.id = church_of(p.user_id)
        where p.user_id = $1`,
      [context.userId],
    );
    const row = rows[0];
    return {
      member: Boolean(row?.porch_id),
      porchName: row?.porch_name ?? "",
      details: { fullName: row?.full_name || row?.display_name || "", phone: row?.phone ?? "", city: row?.city ?? "" } satisfies MemberDetails,
      username: row?.username ?? "",
      hideChurch: yes(row?.hide_church),
    };
  });

/** A member corrects their own details. */
export const saveMyDetails = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseDetails(asRecord(input)))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensure(sql);
    const me = await sql.query<{ porch_id: number | null }>("select my_porch($1) as porch_id", [context.userId]);
    const porch = me[0]?.porch_id;
    if (!porch) return { ok: false as const, error: "Your details are kept once you're a member of a church." };
    const problem = checkDetails(data);
    if (problem) return { ok: false as const, error: problem };
    await sql.query("update profiles set display_name = $2 where user_id = $1", [context.userId, data.fullName]);
    await sql.query("update porch_members set full_name = $3, phone = $4, city = $5, shared_at = coalesce(shared_at, now()) where user_id = $1 and porch_id = $2", [
      context.userId,
      porch,
      data.fullName,
      data.phone,
      data.city,
    ]);
    return { ok: true as const };
  });

/** Admins only: a member of their own church's details. (Admin levels refine this in Stage 5d.) */
export const memberDetailsOf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ userId: text(asRecord(input).userId, 80) }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensure(sql);
    if (!(await isAdmin(sql, context.userId))) {
      noteAttempt(context.userId, "member-details", "Tried to see a member's details.");
      return { ok: false as const, error: "Only your church's admins can see member details." };
    }
    const rows = await sql.query<{ display_name: string; full_name: string | null; phone: string | null; city: string | null; email: string | null }>(
      `select p.display_name, m.full_name, m.phone, m.city, u.email
         from profiles p
         join porch_members m on m.user_id = p.user_id and m.porch_id = my_porch($2)
         left join "user" u on u.id = p.user_id
        where p.user_id = $1`,
      [data.userId, context.userId],
    );
    const row = rows[0];
    if (!row) {
      noteAttempt(context.userId, "member-details", "Tried to see the details of someone outside their church.");
      return { ok: false as const, error: "That person isn't a member of your church." };
    }
    return {
      ok: true as const,
      details: { fullName: row.full_name || row.display_name, phone: row.phone ?? "", city: row.city ?? "" } satisfies MemberDetails,
      email: row.email ?? "",
    };
  });

/**
 * Leave your church (N3, decision 34). Your posts, comments and messages stay in the church's
 * porch under your name. The details you gave the church (full name, phone, city), your Serve
 * form, and any role there (admin, office head) go. You can then join another church.
 * The last admin of a church that still has other members can't leave (it would have no admin).
 */
export const leaveChurch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensure(sql);
    const me = await sql.query<{ porch_id: number | null; name: string | null; admin: unknown; other_admins: number; others: number }>(
      `select c.id as porch_id, c.name,
              exists (select 1 from porch_admins a where a.porch_id = c.id and a.user_id = $1) as admin,
              (select count(*)::int from porch_admins a join porch_members m on m.user_id = a.user_id and m.porch_id = a.porch_id where a.porch_id = c.id and a.user_id <> $1) as other_admins,
              (select count(*)::int from porch_members m where m.porch_id = c.id and m.user_id <> $1) as others
         from porches c where c.id = church_of($1)`,
      [context.userId],
    );
    const church = me[0];
    if (!church?.porch_id) return { ok: false as const, error: "You're not a member of a church." };
    if (yes(church.admin) && Number(church.other_admins) === 0 && Number(church.others) > 0) {
      return { ok: false as const, error: `You're the only admin of ${church.name}. It needs another admin before you can leave. Ask Porchbook to name one.` };
    }
    const porchId = church.porch_id;
    await sql.query("delete from porch_members where user_id = $1 and porch_id = $2", [context.userId, porchId]);
    await sql.query("delete from porch_admins where user_id = $1 and porch_id = $2", [context.userId, porchId]);
    await sql.query("update profiles set porch_id = null where user_id = $1 and porch_id = $2", [context.userId, porchId]);
    // Their Serve form and any office they head belong to the church: those go too.
    for (const statement of [
      "delete from serve_forms where user_id = $1 and porch_id = $2",
      "update offices set head_user_id = null where head_user_id = $1 and porch_id = $2",
    ]) {
      await sql.query(statement, [context.userId, porchId]).catch(() => undefined);
    }
    return { ok: true as const, name: church.name ?? "" };
  });

/** Admins: how many people are waiting to join their church (0 for anyone else). */
export async function waitingCountFor(sql: Sql, userId: string): Promise<number> {
  const rows = await sql.query<{ n: number }>(
    "select case when is_porch_admin($1) then (select count(*)::int from join_requests where porch_id = my_porch($1) and status = 'waiting') else 0 end as n",
    [userId],
  );
  return Number(rows[0]?.n ?? 0);
}

export const waitingJoinCount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensure(sql);
    return { count: await waitingCountFor(sql, context.userId) };
  });
