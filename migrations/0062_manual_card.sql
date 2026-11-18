-- Who has opened the Porchbook Manual, and when the welcome card may come back.
create table if not exists manual_reads (
  user_id text primary key,
  opened_at timestamptz,
  hide_until timestamptz,
  hides integer not null default 0
);
-- The manual card shows only to the founder until this is switched on.
create table if not exists app_flags (
  key text primary key,
  enabled boolean not null default false
);
insert into app_flags (key, enabled) values ('manual_card', false) on conflict (key) do nothing;
