-- Porchbook Radio listener counts (Studio only; members see nothing).
-- Who is tuned in right now: one row per listener, refreshed every minute.
create table if not exists fm_live (
  user_id text primary key,
  seen_at timestamptz not null default now()
);
-- One row per listener per clock hour they listened in, for "busiest hours".
create table if not exists fm_listen_hours (
  user_id text not null,
  hour_start timestamptz not null,
  primary key (user_id, hour_start)
);
create index if not exists fm_listen_hours_hour on fm_listen_hours (hour_start);
