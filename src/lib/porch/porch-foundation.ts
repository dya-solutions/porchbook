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
 * once into `porch_admins` (an admin became Phaneroo's first admin) and is left as history.
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
  /** The church porch a person belongs to (null when unknown). */
  `create or replace function my_porch(uid text) returns integer language sql stable as $$
     select porch_id from profiles where user_id = uid
   $$`,
  /** Two people in the same church porch (used for profiles, chat and calls). */
  `create or replace function same_porch(a text, b text) returns boolean language sql stable as $$
     select exists (
       select 1 from profiles x join profiles y on y.porch_id = x.porch_id
       where x.user_id = a and y.user_id = b and x.porch_id is not null
     )
   $$`,

  // ---- Stage 3a: the feed. Posts carry their church porch; comments and reactions carry their post's. ----
  `alter table posts add column if not exists porch_id integer references porches (id)`,
  `alter table comments add column if not exists porch_id integer references porches (id)`,
  `alter table reactions add column if not exists porch_id integer references porches (id)`,
  `update posts p set porch_id = coalesce((select porch_id from profiles where user_id = p.author_id), 1) where p.porch_id is null`,
  `update comments c set porch_id = (select porch_id from posts where id = c.post_id) where c.porch_id is null`,
  `update reactions r set porch_id = (select porch_id from posts where id = r.post_id) where r.porch_id is null`,
  `create index if not exists posts_porch_idx on posts (porch_id, created_at desc)`,
  // Every new post is stamped with its author's church porch, automatically, however it is saved.
  `create or replace function porch_stamp_post() returns trigger language plpgsql as $$
   begin
     if new.porch_id is null then new.porch_id := my_porch(new.author_id); end if;
     return new;
   end $$`,
  `create or replace function porch_stamp_from_post() returns trigger language plpgsql as $$
   begin
     if new.porch_id is null then new.porch_id := (select porch_id from posts where id = new.post_id); end if;
     return new;
   end $$`,
  `drop trigger if exists posts_porch_stamp on posts`,
  `create trigger posts_porch_stamp before insert on posts for each row execute function porch_stamp_post()`,
  `drop trigger if exists comments_porch_stamp on comments`,
  `create trigger comments_porch_stamp before insert on comments for each row execute function porch_stamp_from_post()`,
  `drop trigger if exists reactions_porch_stamp on reactions`,
  `create trigger reactions_porch_stamp before insert on reactions for each row execute function porch_stamp_from_post()`,
  // ---- Stage 3a: chat. A conversation belongs to the church porch it started in; its messages follow it. ----
  `alter table conversations add column if not exists porch_id integer references porches (id)`,
  `alter table messages add column if not exists porch_id integer references porches (id)`,
  `update conversations c set porch_id = coalesce(my_porch(c.low_user_id), my_porch(c.high_user_id), 1) where c.porch_id is null`,
  `update messages m set porch_id = (select porch_id from conversations where id = m.conversation_id) where m.porch_id is null`,
  `create or replace function porch_stamp_conversation() returns trigger language plpgsql as $$
   begin
     if new.porch_id is null then new.porch_id := coalesce(my_porch(new.low_user_id), my_porch(new.high_user_id)); end if;
     return new;
   end $$`,
  `create or replace function porch_stamp_message() returns trigger language plpgsql as $$
   begin
     if new.porch_id is null then new.porch_id := (select porch_id from conversations where id = new.conversation_id); end if;
     return new;
   end $$`,
  `drop trigger if exists conversations_porch_stamp on conversations`,
  `create trigger conversations_porch_stamp before insert on conversations for each row execute function porch_stamp_conversation()`,
  `drop trigger if exists messages_porch_stamp on messages`,
  `create trigger messages_porch_stamp before insert on messages for each row execute function porch_stamp_message()`,

  // ---- Stage 3a: groups (group chats, and the private pairs one-to-one calls use). A group belongs to its maker's porch. ----
  `alter table groups add column if not exists porch_id integer references porches (id)`,
  `alter table group_notes add column if not exists porch_id integer references porches (id)`,
  `update groups g set porch_id = coalesce(my_porch(g.owner_id), 1) where g.porch_id is null`,
  `update group_notes n set porch_id = (select porch_id from groups where id = n.group_id) where n.porch_id is null`,
  `create or replace function porch_stamp_group() returns trigger language plpgsql as $$
   begin
     if new.porch_id is null then new.porch_id := my_porch(new.owner_id); end if;
     return new;
   end $$`,
  `create or replace function porch_stamp_group_note() returns trigger language plpgsql as $$
   begin
     if new.porch_id is null then new.porch_id := (select porch_id from groups where id = new.group_id); end if;
     return new;
   end $$`,
  `drop trigger if exists groups_porch_stamp on groups`,
  `create trigger groups_porch_stamp before insert on groups for each row execute function porch_stamp_group()`,
  `drop trigger if exists group_notes_porch_stamp on group_notes`,
  `create trigger group_notes_porch_stamp before insert on group_notes for each row execute function porch_stamp_group_note()`,
  // Nobody can be put into a group (or a call pair) from another church porch, whatever the code path.
  `create or replace function porch_check_group_member() returns trigger language plpgsql as $$
   begin
     if exists (select 1 from groups g where g.id = new.group_id and g.kind <> 'porch' and g.porch_id is distinct from my_porch(new.user_id)) then
       raise exception 'That person is in another porch.';
     end if;
     return new;
   end $$`,
  `drop trigger if exists group_members_porch_check on group_members`,
  `create trigger group_members_porch_check before insert on group_members for each row execute function porch_check_group_member()`,

  // ---- Stage 3b: three reusable helpers, called by each part of the app once its tables exist. ----
  /** porch_tag(table, person column): every row is stamped with that person's church porch. */
  `create or replace function porch_tag_row() returns trigger language plpgsql as $$
   begin
     if new.porch_id is null then new.porch_id := my_porch(to_jsonb(new) ->> TG_ARGV[0]); end if;
     return new;
   end $$`,
  `create or replace function porch_tag(tbl text, by_col text) returns void language plpgsql as $$
   begin
     execute format('alter table %I add column if not exists porch_id integer', tbl);
     execute format('update %I set porch_id = coalesce(my_porch(%I::text), 1) where porch_id is null', tbl, by_col);
     execute format('drop trigger if exists %I on %I', tbl || '_porch_tag', tbl);
     execute format('create trigger %I before insert on %I for each row execute function porch_tag_row(%L)', tbl || '_porch_tag', tbl, by_col);
   end $$`,
  /** porch_tag_child(table, link column, parent table): every row takes its parent's church porch. */
  `create or replace function porch_tag_child_row() returns trigger language plpgsql as $$
   declare found integer;
   begin
     if new.porch_id is null then
       execute format('select porch_id from %I where id::text = $1', TG_ARGV[1]) into found using (to_jsonb(new) ->> TG_ARGV[0]);
       new.porch_id := found;
     end if;
     return new;
   end $$`,
  `create or replace function porch_tag_child(tbl text, fk_col text, parent text) returns void language plpgsql as $$
   begin
     execute format('alter table %I add column if not exists porch_id integer', tbl);
     execute format('update %I t set porch_id = coalesce((select p.porch_id from %I p where p.id::text = t.%I::text), 1) where t.porch_id is null', tbl, parent, fk_col);
     execute format('drop trigger if exists %I on %I', tbl || '_porch_tag', tbl);
     execute format('create trigger %I before insert on %I for each row execute function porch_tag_child_row(%L, %L)', tbl || '_porch_tag', tbl, fk_col, parent);
   end $$`,
  /**
   * porch_key(table, key columns): an "only one" settings table becomes "one per church porch".
   * Existing rows become Phaneroo's. The church must always be given when saving: forgetting it
   * fails loudly instead of quietly writing over another church's setting.
   */
  `create or replace function porch_key(tbl text, keycols text) returns void language plpgsql as $$
   declare pk text;
   begin
     execute format('alter table %I add column if not exists porch_id integer', tbl);
     execute format('update %I set porch_id = 1 where porch_id is null', tbl);
     execute format('alter table %I alter column porch_id set not null', tbl);
     select c.conname into pk from pg_constraint c where c.conrelid = tbl::regclass and c.contype = 'p';
     if pk is not null and not exists (
       select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.conname = pk and c.conrelid = tbl::regclass and a.attname = 'porch_id'
     ) then
       execute format('alter table %I drop constraint %I', tbl, pk);
       execute format('alter table %I add primary key (porch_id, %s)', tbl, keycols);
     end if;
   end $$`,

  /**
   * porch_own(table): rows that belong to a church porch but have no person to take it from
   * (events, transport events…). Existing rows become Phaneroo's; new rows must name their church.
   */
  `create or replace function porch_own(tbl text) returns void language plpgsql as $$
   begin
     execute format('alter table %I add column if not exists porch_id integer', tbl);
     execute format('update %I set porch_id = 1 where porch_id is null', tbl);
     execute format('alter table %I alter column porch_id set not null', tbl);
   end $$`,

  /** A post (or a reply's post) in the viewer's own church porch. */
  `create or replace function post_in_my_porch(uid text, pid integer) returns boolean language sql stable as $$
     select exists (select 1 from posts where id = pid and porch_id = my_porch(uid))
   $$`,
  `create or replace function comment_in_my_porch(uid text, cid integer) returns boolean language sql stable as $$
     select exists (select 1 from comments c join posts p on p.id = c.post_id where c.id = cid and p.porch_id = my_porch(uid))
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
  // Stage 3b: tables that always exist from the start (made by migrations/) are tagged here.
  await porchTables(sql, {
    tag: [["my_twenty", "user_id"], ["notifications", "user_id"]],
    own: ["bible_sites"],
    key: [["devotion_translations", "link, lang"], ["item_sizes", "place, item"], ["app_flags", "key"]],
  });
  await applyLocalSetup(sql);
}

/**
 * Called by each part of the app right after it creates its own tables (Stage 3b):
 *   tag:   [table, person column]          rows take that person's church porch
 *   child: [table, link column, parent]    rows take their parent row's church porch
 *   key:   [table, key columns]            "only one" settings become "one per church porch"
 * Safe to call again and again; each table is only set up once per run.
 */
const tablesDone = new Set<string>();
export async function porchTables(
  sql: Sql,
  spec: { own?: string[]; tag?: [string, string][]; child?: [string, string, string][]; key?: [string, string][] },
): Promise<void> {
  for (const table of spec.own ?? []) {
    if (tablesDone.has(table)) continue;
    await sql.query("select porch_own($1)", [table]);
    tablesDone.add(table);
  }
  for (const [table, column] of spec.tag ?? []) {
    if (tablesDone.has(table)) continue;
    await sql.query("select porch_tag($1, $2)", [table, column]);
    tablesDone.add(table);
  }
  for (const [table, column, parent] of spec.child ?? []) {
    if (tablesDone.has(table)) continue;
    await sql.query("select porch_tag_child($1, $2, $3)", [table, column, parent]);
    tablesDone.add(table);
  }
  for (const [table, columns] of spec.key ?? []) {
    if (tablesDone.has(table)) continue;
    await sql.query("select porch_key($1, $2)", [table, columns]);
    tablesDone.add(table);
  }
}

/** The church porch a person belongs to (0 when unknown). */
export async function myPorchId(sql: Sql, userId: string): Promise<number> {
  const rows = await sql.query<{ porch_id: number | null }>("select porch_id from profiles where user_id = $1", [userId]);
  return Number(rows[0]?.porch_id ?? 0) || 0;
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
