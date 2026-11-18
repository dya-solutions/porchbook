-- Porchbook FM: an always-on station everyone hears in step.

-- Audio the studio has uploaded. url points at Vercel Blob (or /api/fm-file
-- for small files when no Blob store is connected).
create table if not exists fm_tracks (
  id serial primary key,
  title text not null,
  kind text not null default 'music',          -- music | preaching | reading | other
  url text not null,
  duration_sec real not null,
  uploaded_by text references profiles (user_id) on delete set null,
  created_at timestamptz not null default now()
);

-- Small-file fallback store (only used without Blob, e.g. local tests).
create table if not exists fm_files (
  id serial primary key,
  mime text not null,
  data text not null,
  created_at timestamptz not null default now()
);

-- Programmes: a named time slot on chosen weekdays (Kampala time) that plays
-- its tracks in order, looping, starting from the slot's start.
create table if not exists fm_programmes (
  id serial primary key,
  name text not null,
  days integer[] not null,                     -- 0 = Sunday .. 6 = Saturday
  start_min integer not null,                  -- minutes after midnight
  end_min integer not null,
  track_ids integer[] not null default '{}',
  created_at timestamptz not null default now()
);
