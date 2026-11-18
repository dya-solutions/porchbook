-- One founder can write a message the whole team sees.
-- The earliest member is the founder, and only one row may hold that mark.

alter table profiles add column if not exists is_founder boolean not null default false;

update profiles
set is_founder = true
where user_id = (
  select user_id from profiles
  order by created_at asc, user_id asc
  limit 1
)
and not exists (select 1 from profiles where is_founder);

create unique index if not exists profiles_one_founder
  on profiles (is_founder) where is_founder;

create table if not exists founder_notes (
  id serial primary key,
  author_id text not null references profiles (user_id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
