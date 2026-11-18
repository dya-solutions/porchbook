-- Porchbook Radio's mixer: measured loudness, mastered copies (originals kept for undo),
-- the studio's mixer settings, before/after samples, and old copies waiting to be removed.
alter table fm_tracks add column if not exists original_url text;
alter table fm_tracks add column if not exists loud_before jsonb;
alter table fm_tracks add column if not exists loud_after jsonb;
alter table fm_tracks add column if not exists mastered_at timestamptz;
alter table fm_tracks add column if not exists mix_job text;
alter table fm_tracks add column if not exists mix_token text;
alter table fm_tracks add column if not exists mix_started_at timestamptz;
alter table fm_tracks add column if not exists mix_error text;
alter table fm_tracks add column if not exists mix_batch integer;
alter table fm_tracks add column if not exists pending_url text;
alter table fm_tracks add column if not exists pending_duration real;

create table if not exists fm_mixer (
  id integer primary key,
  settings jsonb not null default '{}'::jsonb,
  auto boolean not null default false,
  batch integer not null default 0,
  batch_mode text,
  updated_at timestamptz not null default now()
);
insert into fm_mixer (id) values (1) on conflict (id) do nothing;

create table if not exists fm_previews (
  track_id integer primary key,
  token text not null,
  at_sec real not null default 0,
  before_url text,
  after_url text,
  error text,
  started_at timestamptz not null default now()
);

create table if not exists fm_trash (
  url text primary key,
  delete_after timestamptz not null
);
