import type { Sql } from "@/lib/db";

/**
 * The porch foundation (BUILD-BRIEF.md, Stage 2).
 *
 * - `porches`: every porch. Four types: church, ministry, gospel_artist, organisation.
 *   Only church porches have members; the other three are public pages run by admins.
 * - `profiles.porch_id`: the ONE church porch a person belongs to.
 * - `porch_admins`: who runs which porch (replaces the single "founder").
 * - `platform_owners`: above all porches (JT).
 * - Phaneroo Ministries Mbarara is porch 1, and every account without a porch joins it.
 *
 * Two database checks are used everywhere instead of the old founder mark:
 *   is_porch_admin(user)    -> an admin of the church porch this person belongs to
 *   is_platform_owner(user) -> a platform owner
 * The old `profiles.is_founder` column is no longer read for permissions. Its value was copied
 * once into `porch_admins` (the founder became Phaneroo's first admin) and is left as history.
 *
 * Runs at database start-up, before anything else, and is safe to run again and again.
 */
export const PHANEROO_PORCH_ID = 1;

const SETUP: string[] = [
  `create table if not exists porches (
     id serial primary key,
     name text not null,
     short_name text not null default '',
     kind text not null default 'church',
     town text not null default '',
     country text not null default '',
     status text not null default 'waiting',
     verified boolean not null default false,
     invite_code text unique,
     created_by text,
     created_at timestamptz not null default now(),
     constraint porches_kind_chk check (kind in ('church', 'ministry', 'gospel_artist', 'organisation')),
     constraint porches_status_chk check (status in ('waiting', 'approved', 'suspended'))
   )`,
  `create table if not exists porch_settings (
     porch_id integer primary key references porches (id) on delete cascade,
     theme text not null default 'porch-evening',
     time_zone text not null default 'Africa/Kampala',
     country_code text not null default '+256',
     updated_at timestamptz not null default now()
   )`,
  `alter table profiles add column if not exists porch_id integer references porches (id)`,
  `create index if not exists profiles_porch_idx on profiles (porch_id)`,
  `create table if not exists porch_admins (
     porch_id integer not null references porches (id) on delete cascade,
     user_id text not null references profiles (user_id) on delete cascade,
     added_by text,
     added_at timestamptz not null default now(),
     primary key (porch_id, user_id)
   )`,
  `create index if not exists porch_admins_user_idx on porch_admins (user_id)`,
  `create table if not exists platform_owners (
     user_id text primary key references profiles (user_id) on delete cascade,
     added_at timestamptz not null default now()
   )`,
  // One-off steps already done (so they never repeat).
  `create table if not exists porch_steps (step text primary key, done_at timestamptz not null default now())`,
  // Phaneroo is porch 1.
  `insert into porches (id, name, short_name, kind, town, country, status, verified, invite_code)
   values (1, 'Phaneroo Ministries Mbarara', 'Phaneroo Mbarara', 'church', 'Mbarara', 'Uganda', 'approved', true, 'PHANEROO-MBARARA')
   on conflict (id) do nothing`,
  `select setval(pg_get_serial_sequence('porches', 'id'), greatest((select max(id) from porches), 1))`,
  `insert into porch_settings (porch_id) values (1) on conflict (porch_id) do nothing`,
  // Everyone without a church porch belongs to Phaneroo (until invite codes arrive in Stage 5).
  `update profiles set porch_id = 1 where porch_id is null`,
  `create or replace function is_porch_admin(uid text) returns boolean language sql stable as $$
     select exists (
       select 1 from porch_admins a
       join profiles p on p.user_id = a.user_id and p.porch_id = a.porch_id
       where a.user_id = uid
     )
   $$`,
  `create or replace function is_platform_owner(uid text) returns boolean language sql stable as $$
     select exists (select 1 from platform_owners where user_id = uid)
   $$`,
];

/** Once only: today's founder becomes Phaneroo's first admin. */
const FOUNDER_TO_ADMIN = `
  with done as (insert into porch_steps (step) values ('founder-to-admin') on conflict (step) do nothing returning step)
  insert into porch_admins (porch_id, user_id, added_by)
  select 1, user_id, 'founder' from profiles where is_founder and exists (select 1 from done)
  on conflict do nothing`;

export async function setupPorches(sql: Sql): Promise<void> {
  for (const statement of SETUP) await sql.query(statement);
  await sql.query(FOUNDER_TO_ADMIN);
  await applyLocalSetup(sql);
}

/** A newly signed-up person joins Phaneroo for now, and gets any role porch-local.json gives them. */
export async function placeNewProfile(sql: Sql, userId: string): Promise<void> {
  await sql.query("update profiles set porch_id = $2 where user_id = $1 and porch_id is null", [userId, PHANEROO_PORCH_ID]);
  await applyLocalSetup(sql, userId);
}

/**
 * This computer only: `porch-local.json` (next to package.json, never saved in git) names the
 * emails that are platform owners and Phaneroo admins, for example:
 *   { "platformOwners": ["me@example.com"], "phanerooAdmins": ["me@example.com"] }
 * Nothing happens when the file is missing.
 */
type LocalSetup = { platformOwners: string[]; phanerooAdmins: string[] };
let localSetup: Promise<LocalSetup> | null = null;

function readLocalSetup(): Promise<LocalSetup> {
  localSetup ??= (async () => {
    const empty = { platformOwners: [], phanerooAdmins: [] };
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = JSON.parse(await readFile("porch-local.json", "utf8")) as Partial<LocalSetup>;
      const emails = (list: unknown) =>
        Array.isArray(list) ? list.filter((e): e is string => typeof e === "string").map((e) => e.trim().toLowerCase()).filter(Boolean) : [];
      return { platformOwners: emails(raw.platformOwners), phanerooAdmins: emails(raw.phanerooAdmins) };
    } catch {
      return empty;
    }
  })();
  return localSetup;
}

async function applyLocalSetup(sql: Sql, onlyUserId?: string): Promise<void> {
  const setup = await readLocalSetup();
  const who = onlyUserId ? " and user_id = $2" : "";
  if (setup.platformOwners.length) {
    await sql.query(
      `insert into platform_owners (user_id)
       select user_id from profiles where lower(coalesce(email, '')) = any($1::text[])${who}
       on conflict do nothing`,
      onlyUserId ? [setup.platformOwners, onlyUserId] : [setup.platformOwners],
    );
  }
  if (setup.phanerooAdmins.length) {
    await sql.query(
      `insert into porch_admins (porch_id, user_id, added_by)
       select 1, user_id, 'porch-local.json' from profiles
       where porch_id = 1 and lower(coalesce(email, '')) = any($1::text[])${who}
       on conflict do nothing`,
      onlyUserId ? [setup.phanerooAdmins, onlyUserId] : [setup.phanerooAdmins],
    );
  }
}
