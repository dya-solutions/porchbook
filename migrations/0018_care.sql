-- Founder roll, and prayer-request marks.

create table if not exists removed_members (
  user_id text primary key,
  email text,
  removed_at timestamptz not null default now()
);

alter table office_threads add column if not exists status text not null default 'open';
