// Stage 5c: accounts and join requests (BUILD-BRIEF.md decisions 14-17).
// - A Porchbook account: full name, an email verified by a 6-digit code, an optional unique
//   username. An account alone can use the public porch but belongs to no private porch.
// - Membership of one church, by request only: full name, nation, phone and address. The
//   church's admins let the person in or decline. An invite code only opens the request.
// - Member details are seen by the member and by their church's admins only (admin levels
//   come in Stage 5d), and are deleted when someone leaves (Stage 5b).
import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { noteAttempt } from "@/lib/porch/guard.server";
import { touchProfile } from "@/lib/porch/api";

/** What the church asks for, and the one line that says why (decision 17). */
export const DETAIL_FIELDS = [
  { key: "fullName", label: "Full name", why: "So your church family knows who you are. It's the name your posts and messages show." },
  { key: "nation", label: "Nation", why: "So your church knows where its members come from and can welcome you well." },
  { key: "phone", label: "Phone number", why: "So the church can reach you for care, visits and urgent news." },
  { key: "address", label: "Address", why: "So the church can visit you and link you with a group near you." },
] as const;

export type MemberDetails = { fullName: string; nation: string; phone: string; address: string };

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
    nation: text(raw.nation, 60),
    phone: text(raw.phone, 30),
    address: text(raw.address, 200),
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
      nation: string | null;
      phone: string | null;
      address: string | null;
    }>(
      `select p.display_name, p.email_verified_at::text as verified, p.username, p.hide_church, p.porch_id, c.name as porch_name,
              d.nation, d.phone, d.address
         from profiles p
         left join porches c on c.id = p.porch_id
         left join member_details d on d.user_id = p.user_id and d.porch_id = p.porch_id
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
    const details: MemberDetails = { fullName: row?.display_name ?? "", nation: row?.nation ?? "", phone: row?.phone ?? "", address: row?.address ?? "" };
    const { email } = await accountEmail(sql, context.userId);
    return {
      email,
      verified: Boolean(row?.verified),
      username: row?.username ?? "",
      hideChurch: yes(row?.hide_church),
      member: row?.porch_id !== null && row?.porch_id !== undefined,
      porchName: row?.porch_name ?? "",
      waiting: waiting[0] ? { id: waiting[0].id, porchName: waiting[0].porch_name, since: waiting[0].created_at } : null,
      lastDeclined: declined[0]?.porch_name ?? "",
      // A member with details missing is asked for them the next time they open the app.
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
export const setUsername = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ username: text(asRecord(input).username, 40).replace(/^@/, "").toLowerCase() }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensure(sql);
    if (!data.username) {
      await sql.query("update profiles set username = null where user_id = $1", [context.userId]);
      return { ok: true as const, username: "" };
    }
    if (!/^[a-z0-9_.]{3,20}$/.test(data.username)) {
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
    return { code: typeof raw.code === "string" ? raw.code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32) : "", details: parseDetails(raw), seed: seedOf(raw) };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensure(sql);
    await touchProfile(sql, context.userId, data.seed);
    if (!(await isVerified(sql, context.userId))) return { ok: false as const, error: "Confirm your email first." };
    const problem = checkDetails(data.details);
    if (problem) return { ok: false as const, error: problem };
    const porches = await sql.query<{ id: number; name: string }>(
      "select id, name from porches where upper(invite_code) = $1 and kind = 'church' and status in ('approved', 'waiting')",
      [data.code],
    );
    const porch = porches[0];
    if (!porch) return { ok: false as const, error: "That invite code isn't right. Check it with your church." };
    const me = await sql.query<{ porch_id: number | null }>("select porch_id from profiles where user_id = $1", [context.userId]);
    if (me[0]?.porch_id) return { ok: false as const, error: "You're already a member of a church. Moving church comes soon." };
    await sql.query("update join_requests set status = 'cancelled' where user_id = $1 and status = 'waiting'", [context.userId]);
    await sql.query(
      "insert into join_requests (porch_id, user_id, full_name, nation, phone, address) values ($1, $2, $3, $4, $5, $6)",
      [porch.id, context.userId, data.details.fullName, data.details.nation, data.details.phone, data.details.address],
    );
    await sql.query("update profiles set display_name = $2 where user_id = $1", [context.userId, data.details.fullName]);
    // Tell the church's admins.
    try {
      const admins = await sql.query<{ user_id: string }>(
        "select a.user_id from porch_admins a join profiles p on p.user_id = a.user_id and p.porch_id = a.porch_id where a.porch_id = $1",
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

export type WaitingPerson = { id: number; userId: string; fullName: string; nation: string; phone: string; address: string; email: string; since: string };

/** Admins: the people waiting to join their own church. */
export const waitingToJoin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensure(sql);
    if (!(await isAdmin(sql, context.userId))) return { ok: false as const, error: "Only your church's admins see this list.", people: [] as WaitingPerson[] };
    const rows = await sql.query<{ id: number; user_id: string; full_name: string; nation: string; phone: string; address: string; email: string | null; created_at: string }>(
      `select r.id, r.user_id, r.full_name, r.nation, r.phone, r.address, u.email,
              to_char(r.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
         from join_requests r left join "user" u on u.id = r.user_id
        where r.porch_id = my_porch($1) and r.status = 'waiting'
        order by r.created_at`,
      [context.userId],
    );
    return {
      ok: true as const,
      people: rows.map((row) => ({ id: row.id, userId: row.user_id, fullName: row.full_name, nation: row.nation, phone: row.phone, address: row.address, email: row.email ?? "", since: row.created_at })),
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
    const rows = await sql.query<{ id: number; porch_id: number; user_id: string; full_name: string; nation: string; phone: string; address: string; porch_name: string }>(
      `select r.id, r.porch_id, r.user_id, r.full_name, r.nation, r.phone, r.address, c.name as porch_name
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
    const joined = await sql.query<{ user_id: string }>("update profiles set porch_id = $2, display_name = $3 where user_id = $1 and porch_id is null returning user_id", [
      request.user_id,
      request.porch_id,
      request.full_name,
    ]);
    if (!joined.length) {
      await sql.query("update join_requests set status = 'cancelled', decided_by = $2, decided_at = now() where id = $1", [request.id, context.userId]);
      return { ok: false as const, error: "That person has already joined a church." };
    }
    await sql.query(
      `insert into member_details (user_id, porch_id, nation, phone, address, updated_at) values ($1, $2, $3, $4, $5, now())
       on conflict (user_id) do update set porch_id = excluded.porch_id, nation = excluded.nation, phone = excluded.phone, address = excluded.address, updated_at = now()`,
      [request.user_id, request.porch_id, request.nation, request.phone, request.address],
    );
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
    const rows = await sql.query<{ display_name: string; nation: string | null; phone: string | null; address: string | null; porch_id: number | null; username: string | null; hide_church: unknown }>(
      `select p.display_name, d.nation, d.phone, d.address, p.porch_id, p.username, p.hide_church
         from profiles p left join member_details d on d.user_id = p.user_id and d.porch_id = p.porch_id
        where p.user_id = $1`,
      [context.userId],
    );
    const row = rows[0];
    return {
      member: Boolean(row?.porch_id),
      details: { fullName: row?.display_name ?? "", nation: row?.nation ?? "", phone: row?.phone ?? "", address: row?.address ?? "" } satisfies MemberDetails,
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
    const me = await sql.query<{ porch_id: number | null }>("select porch_id from profiles where user_id = $1", [context.userId]);
    const porch = me[0]?.porch_id;
    if (!porch) return { ok: false as const, error: "Your details are kept once you're a member of a church." };
    const problem = checkDetails(data);
    if (problem) return { ok: false as const, error: problem };
    await sql.query("update profiles set display_name = $2 where user_id = $1", [context.userId, data.fullName]);
    await sql.query(
      `insert into member_details (user_id, porch_id, nation, phone, address, updated_at) values ($1, $2, $3, $4, $5, now())
       on conflict (user_id) do update set porch_id = excluded.porch_id, nation = excluded.nation, phone = excluded.phone, address = excluded.address, updated_at = now()`,
      [context.userId, porch, data.nation, data.phone, data.address],
    );
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
    const rows = await sql.query<{ display_name: string; nation: string | null; phone: string | null; address: string | null; email: string | null }>(
      `select p.display_name, d.nation, d.phone, d.address, u.email
         from profiles p
         left join member_details d on d.user_id = p.user_id and d.porch_id = p.porch_id
         left join "user" u on u.id = p.user_id
        where p.user_id = $1 and p.porch_id is not null and p.porch_id = my_porch($2)`,
      [data.userId, context.userId],
    );
    const row = rows[0];
    if (!row) {
      noteAttempt(context.userId, "member-details", "Tried to see the details of someone outside their church.");
      return { ok: false as const, error: "That person isn't a member of your church." };
    }
    return {
      ok: true as const,
      details: { fullName: row.display_name, nation: row.nation ?? "", phone: row.phone ?? "", address: row.address ?? "" } satisfies MemberDetails,
      email: row.email ?? "",
    };
  });
