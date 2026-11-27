import type { Sql } from "@/lib/db";

/**
 * The porch foundation (BUILD-BRIEF.md, Stage 2).
 *
 * - `porches`: every porch. Two types (decision 38): church, or ministry (with a ministry type:
 *   music, teaching or other, and a description). Only churches have members and invite codes;
 *   a ministry has an admin team and followers only (decision 40).
 * - `porch_members`: the members of each church, with the details they gave it. A person can be a
 *   member of ONE church only (decision 39; the database refuses a second one, or a ministry).
 * - `profiles.porch_id`: the person's church. It only counts while they're still a member there
 *   (my_porch checks that).
 * - `porch_admins`: who runs which porch (replaces the single "founder").
 * - `platform_owners`: above all porches (JT).
 * - Phaneroo Ministries Mbarara is porch 1, and every account without a porch joins it.
 *
 * Two database checks are used everywhere instead of the old founder mark:
 *   is_porch_admin(user)    -> an admin of the porch this person has switched to
 *   is_admin_of(user, porch) -> an admin (and member) of that porch
 *   in_porch(user, porch)   -> a member of that porch
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
     constraint porches_kind_chk check (kind in ('church', 'ministry')),
     constraint porches_status_chk check (status in ('waiting', 'approved', 'suspended'))
   )`,
  `create table if not exists porch_settings (
     porch_id integer primary key references porches (id) on delete cascade,
     theme text not null default 'porch-evening',
     time_zone text not null default 'Africa/Kampala',
     country_code text not null default '+256',
     updated_at timestamptz not null default now()
   )`,
  // Stage 5c: accounts. A verified email, an optional unique username, and a personal switch to
  // hide one's church on public reactions. Accounts made before 5c count as verified (once).
  `alter table profiles add column if not exists email_verified_at timestamptz`,
  `alter table profiles add column if not exists username text`,
  `alter table profiles add column if not exists hide_church boolean not null default false`,
  `create unique index if not exists profiles_username_idx on profiles (lower(username)) where username is not null`,
  // Stage 4e: each porch's accent colour (brand/BRAND.md); every porch starts with Porchbook gold.
  `alter table porch_settings add column if not exists accent text not null default 'gold'`,
  // Stage 4e: each member's own Light or Dark choice.
  `alter table profiles add column if not exists look_mode text not null default 'light'`,
  // Stage 4c: the Tour doors a porch has switched off (Porch settings).
  `alter table porch_settings add column if not exists tour_off text[] not null default '{}'`,
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
  // Stage 5d (decision 18): each admin has a level. Everyone who was an admin before is a Lead admin.
  //   lead: everything, including choosing admins and their levels
  //   membership: join requests, member details, removing members
  //   moderator: posts and complaints, no member details
  //   public_editor: posts on the public porch for the porch
  // (Office heads are set per office, as before.) Ministries use lead and public_editor only.
  `alter table porch_admins add column if not exists level text not null default 'lead'`,
  `do $$ begin
     if not exists (select 1 from pg_constraint where conname = 'porch_admins_level_chk') then
       alter table porch_admins add constraint porch_admins_level_chk check (level in ('lead', 'membership', 'moderator', 'public_editor'));
     end if;
   end $$`,
  `create table if not exists platform_owners (
     user_id text primary key references profiles (user_id) on delete cascade,
     added_at timestamptz not null default now()
   )`,
  // M1 (decision 24): "Gospel artist" is now "Psalmist". Done once, while the old type is still allowed.
  `do $$ begin
     if exists (select 1 from pg_constraint where conname = 'porches_kind_chk' and pg_get_constraintdef(oid) like '%gospel_artist%') then
       alter table porches drop constraint porches_kind_chk;
       update porches set kind = 'psalmist' where kind = 'gospel_artist';
       alter table porches add constraint porches_kind_chk check (kind in ('church', 'ministry', 'psalmist', 'organisation'));
     end if;
   end $$`,
  // Decisions 38 and 41: a ministry has a type (music, teaching, other + its name) and a description.
  `alter table porches add column if not exists ministry_type text not null default ''`,
  `alter table porches add column if not exists ministry_other text not null default ''`,
  `alter table porches add column if not exists description text not null default ''`,
  // Which porches changed type on 26 November (shown to the platform owner).
  `create table if not exists porch_kind_changes (
     porch_id integer primary key references porches (id) on delete cascade,
     old_kind text not null,
     changed_at timestamptz not null default now()
   )`,
  // Decision 38, once: Psalmist and Organisation porches become Ministry, type Other (named after the old type).
  `do $$ begin
     if exists (select 1 from pg_constraint where conname = 'porches_kind_chk' and pg_get_constraintdef(oid) like '%psalmist%') then
       alter table porches drop constraint porches_kind_chk;
       insert into porch_kind_changes (porch_id, old_kind) select id, kind from porches where kind in ('psalmist', 'organisation', 'gospel_artist') on conflict do nothing;
       update porches set ministry_type = 'other',
              ministry_other = case kind when 'organisation' then 'Organisation' else 'Psalmist' end,
              kind = 'ministry'
        where kind in ('psalmist', 'organisation', 'gospel_artist');
       update porches set ministry_type = 'other' where kind = 'ministry' and ministry_type = '';
       alter table porches add constraint porches_kind_chk check (kind in ('church', 'ministry'));
     end if;
   end $$`,
  // Ministries have no invite code (nobody joins a ministry).
  `update porches set invite_code = null where kind = 'ministry' and invite_code is not null`,
  // M2 (decisions 25 and 27): the membership list. One row per person per porch, with the
  // details they gave THAT porch (full name, phone, city), shared only with its admins.
  `create table if not exists porch_members (
     porch_id integer not null references porches (id) on delete cascade,
     user_id text not null references profiles (user_id) on delete cascade,
     full_name text not null default '',
     phone text not null default '',
     city text not null default '',
     shared_at timestamptz,
     joined_at timestamptz not null default now(),
     primary key (porch_id, user_id)
   )`,
  `create index if not exists porch_members_user_idx on porch_members (user_id)`,
  // Decisions 39 and 40: only churches have members, and one church each. Anyone in a ministry's
  // list leaves it (they stay its admin); anyone in two churches keeps the one they're in now
  // (or else the first they joined).
  `delete from porch_members m using porches c where c.id = m.porch_id and c.kind <> 'church'`,
  `delete from porch_members m
    where exists (
      select 1 from porch_members o
       where o.user_id = m.user_id and o.porch_id <> m.porch_id
         and (o.porch_id = (select porch_id from profiles where user_id = m.user_id)
              or (m.porch_id is distinct from (select porch_id from profiles where user_id = m.user_id)
                  and (o.joined_at, o.porch_id) < (m.joined_at, m.porch_id)))
    )`,
  `create unique index if not exists porch_members_one_church on porch_members (user_id)`,
  `create or replace function porch_members_church_only() returns trigger language plpgsql as $$
   begin
     if not exists (select 1 from porches where id = new.porch_id and kind = 'church') then
       raise exception 'Only a church porch has members';
     end if;
     return new;
   end $$`,
  `drop trigger if exists porch_members_church_only on porch_members`,
  `create trigger porch_members_church_only before insert or update on porch_members for each row execute function porch_members_church_only()`,
  // One-off steps already done (so they never repeat).
  `create table if not exists porch_steps (step text primary key, done_at timestamptz not null default now())`,
  // Stage 5c: accounts made before verified emails existed count as verified (once).
  `with done as (insert into porch_steps (step) values ('accounts-before-5c-verified') on conflict (step) do nothing returning step)
   update profiles set email_verified_at = now() where email_verified_at is null and exists (select 1 from done)`,
  // Phaneroo is porch 1.
  `insert into porches (id, name, short_name, kind, town, country, status, verified, invite_code)
   values (1, 'Phaneroo Ministries Mbarara', 'Phaneroo Mbarara', 'church', 'Mbarara', 'Uganda', 'approved', true, null)
   on conflict (id) do nothing`,
  `select setval(pg_get_serial_sequence('porches', 'id'), greatest((select max(id) from porches), 1))`,
  `insert into porch_settings (porch_id) values (1) on conflict (porch_id) do nothing`,
  // Before Stage 5a everyone without a church porch was put in Phaneroo. That happens once, for
  // the accounts made before invite codes; new accounts now join the church whose code they use.
  `with done as (insert into porch_steps (step) values ('legacy-everyone-phaneroo') on conflict (step) do nothing returning step)
   update profiles set porch_id = 1 where porch_id is null and exists (select 1 from done)`,
  // M2, once: everyone becomes a member of the porch they're in today. Whoever started a porch,
  // and the admins of ministry, psalmist and organisation porches, become members of those too.
  `with done as (insert into porch_steps (step) values ('porch-members-v1') on conflict (step) do nothing returning step)
   insert into porch_members (porch_id, user_id, full_name)
   select x.porch_id, x.user_id, coalesce(p.display_name, '')
     from (
       select porch_id, user_id from profiles where porch_id is not null
       union select id, created_by from porches where created_by is not null and kind = 'church'
     ) x
     join profiles p on p.user_id = x.user_id
     join porches c on c.id = x.porch_id and c.status <> 'declined' and c.kind = 'church'
    where not exists (select 1 from porch_members o where o.user_id = x.user_id)
      and exists (select 1 from done)
   on conflict do nothing`,
  /** A member of that porch. */
  `create or replace function in_porch(uid text, pid integer) returns boolean language sql stable as $$
     select exists (select 1 from porch_members where user_id = uid and porch_id = pid)
   $$`,
  // Someone who belongs to porches but has none switched to (or left the one they had) gets their first one.
  `update profiles p set porch_id = (select m.porch_id from porch_members m where m.user_id = p.user_id order by m.joined_at, m.porch_id limit 1)
    where (p.porch_id is null or not exists (select 1 from porch_members m where m.user_id = p.user_id and m.porch_id = p.porch_id))
      and exists (select 1 from porch_members m where m.user_id = p.user_id)`,
  // N3 (decision 43): someone who runs a ministry can act as it ("Continue as [ministry]").
  `alter table profiles add column if not exists acting_porch_id integer references porches (id) on delete set null`,
  /** An admin of the porch this person has switched to (each screen works on that porch). */
  `create or replace function is_porch_admin(uid text) returns boolean language sql stable as $$
     select exists (
       select 1 from porch_admins a
       join profiles p on p.user_id = a.user_id and p.porch_id = a.porch_id
       join porch_members m on m.user_id = a.user_id and m.porch_id = a.porch_id
       where a.user_id = uid and p.acting_porch_id is null and a.level = 'lead'
     )
   $$`,
  /**
   * Stage 5d: an admin of the church this person is in (as themselves) at one of these levels.
   * A Lead admin always counts. Used for membership (join requests, details, removing members)
   * and moderation (posts, complaints). Plain is_porch_admin above now means Lead admin.
   */
  `create or replace function has_admin_level(uid text, levels text[]) returns boolean language sql stable as $$
     select exists (
       select 1 from porch_admins a
       join profiles p on p.user_id = a.user_id and p.porch_id = a.porch_id
       join porch_members m on m.user_id = a.user_id and m.porch_id = a.porch_id
       where a.user_id = uid and p.acting_porch_id is null and (a.level = 'lead' or a.level = any(levels))
     )
   $$`,
  /** An admin (and member) of one particular porch, whichever porch the person has switched to. */
  `create or replace function is_admin_of(uid text, pid integer) returns boolean language sql stable as $$
     select exists (
       select 1 from porch_admins a join porch_members m on m.user_id = a.user_id and m.porch_id = a.porch_id
       where a.user_id = uid and a.porch_id = pid
     )
   $$`,
  `create or replace function is_platform_owner(uid text) returns boolean language sql stable as $$
     select exists (select 1 from platform_owners where user_id = uid)
   $$`,
  /** The person's church (null when none). It only counts while they're still a member there. */
  `create or replace function church_of(uid text) returns integer language sql stable as $$
     select p.porch_id from profiles p
      where p.user_id = uid and exists (select 1 from porch_members m where m.user_id = uid and m.porch_id = p.porch_id)
   $$`,
  /**
   * The church porch every screen works on: the person's church, but NONE while they act as a
   * ministry. So acting as a ministry closes the church's private porch until they're "me" again.
   */
  `create or replace function my_porch(uid text) returns integer language sql stable as $$
     select p.porch_id from profiles p
      where p.user_id = uid and p.acting_porch_id is null
        and exists (select 1 from porch_members m where m.user_id = uid and m.porch_id = p.porch_id)
   $$`,
  /**
   * N4 (decision 28): the name shown on anything public (the public porch, a ministry's admin
   * team, follows) is the username, never the full name a person gave their church.
   */
  `create or replace function public_name(uid text) returns text language sql stable as $$
     select coalesce(nullif(username, ''), 'A Porchbook member') from profiles where user_id = uid
   $$`,
  // N4, once: inside a church people show by the full name they gave it (the membership list).
  `with done as (insert into porch_steps (step) values ('church-names-v1') on conflict (step) do nothing returning step)
   update profiles p set display_name = m.full_name
     from porch_members m
    where m.user_id = p.user_id and m.porch_id = p.porch_id and m.full_name <> '' and p.display_name <> m.full_name
      and exists (select 1 from done)`,
  /** An admin of that ministry (decision 42: church members can run ministries). */
  `create or replace function runs_ministry(uid text, pid integer) returns boolean language sql stable as $$
     select exists (
       select 1 from porch_admins a join porches c on c.id = a.porch_id
        where a.user_id = uid and a.porch_id = pid and c.kind = 'ministry' and c.status <> 'declined'
     )
   $$`,
  /**
   * Stage 6: who may "Continue as" a porch (and post publicly for it): an admin of a ministry, or an
   * admin of a church who is also one of its members. Declined porches never.
   */
  `create or replace function can_act_as(uid text, pid integer) returns boolean language sql stable as $$
     select exists (
       select 1 from porch_admins a join porches c on c.id = a.porch_id
        where a.user_id = uid and a.porch_id = pid and c.status <> 'declined'
          and a.level in ('lead', 'public_editor')
          and (c.kind = 'ministry' or exists (select 1 from porch_members m where m.user_id = uid and m.porch_id = pid))
     )
   $$`,
  /**
   * N7 (decision 46): two members of the same church, both there as themselves (not acting as a
   * ministry). Used for profiles, private messages and calls: nobody can message or call across
   * churches, and a one-to-one chat goes quiet (read-only) once the two no longer share a church.
   */
  `create or replace function same_porch(a text, b text) returns boolean language sql stable as $$
     select exists (
       select 1 from porch_members x join porch_members y on y.porch_id = x.porch_id
       join profiles px on px.user_id = x.user_id and px.acting_porch_id is null
       join profiles py on py.user_id = y.user_id and py.acting_porch_id is null
       where x.user_id = a and y.user_id = b
     )
   $$`,
  // N7: a ministry's admins message each other on the ministry's own screen ("Team messages").
  `create table if not exists ministry_team_messages (
     id serial primary key,
     porch_id integer not null references porches (id) on delete cascade,
     author_id text not null references profiles (user_id) on delete cascade,
     body text not null,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists ministry_team_messages_porch_idx on ministry_team_messages (porch_id, created_at desc)`,

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
  // Stage 6: the public porch's own tables exist from the start (public-porch.ts makes them).
  // Imported here only when setting up, so the two files never load each other at start.
  const { ensurePublic } = await import("@/lib/porch/public-porch");
  await ensurePublic(sql);
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

/** The porch a person has switched to (0 when none). */
export async function myPorchId(sql: Sql, userId: string): Promise<number> {
  const rows = await sql.query<{ porch_id: number | null }>("select my_porch($1) as porch_id", [userId]);
  return Number(rows[0]?.porch_id ?? 0) || 0;
}

/** A newly signed-up person joins Phaneroo for now, and gets any role porch-local.json gives them. */
export async function placeNewProfile(sql: Sql, userId: string): Promise<void> {
  // Stage 5a: a new account joins no church by itself. It joins with an invite code, or starts a porch.
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

/** A comma-separated list of emails from a setting (online: Vercel's environment variables). */
function fromEnv(name: string): string[] {
  return (process.env[name] ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

function readLocalSetup(): Promise<LocalSetup> {
  localSetup ??= (async () => {
    const empty = { platformOwners: [], phanerooAdmins: [] };
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = JSON.parse(await readFile("porch-local.json", "utf8")) as Partial<LocalSetup>;
      const emails = (list: unknown) =>
        Array.isArray(list) ? list.filter((e): e is string => typeof e === "string").map((e) => e.trim().toLowerCase()).filter(Boolean) : [];
      return { platformOwners: [...emails(raw.platformOwners), ...fromEnv("PORCH_PLATFORM_OWNERS")], phanerooAdmins: [...emails(raw.phanerooAdmins), ...fromEnv("PORCH_PHANEROO_ADMINS")] };
    } catch {
      // Online there is no porch-local.json: the same lists come from the settings.
      return { platformOwners: fromEnv("PORCH_PLATFORM_OWNERS"), phanerooAdmins: fromEnv("PORCH_PHANEROO_ADMINS") };
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
