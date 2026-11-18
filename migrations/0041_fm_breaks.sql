-- Porchbook Radio "Play now": the studio cuts a recording in for everyone.
create table if not exists fm_breaks (
  id serial primary key,
  track_id integer not null references fm_tracks (id) on delete cascade,
  starts_at timestamptz not null,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists fm_breaks_starts on fm_breaks (starts_at);
