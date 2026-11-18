-- Nuggets: short clips of selected speakers, played as Radio station breaks.
create table if not exists nugget_speakers (
  id serial primary key,
  name text not null,
  photo text not null default '',
  feed_url text not null default '',
  youtube text not null default '',
  permission text not null default '',
  on_air boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists nugget_sources (
  id serial primary key,
  speaker_id integer not null references nugget_speakers (id) on delete cascade,
  kind text not null default 'podcast',        -- podcast | upload | youtube
  guid text not null default '',
  title text not null,
  audio_url text not null default '',
  youtube_id text not null default '',
  published_at timestamptz,
  duration_sec real not null default 0,
  transcript_url text not null default '',
  transcript jsonb,                            -- [{s, e, t}] seconds and words
  status text not null default 'new',          -- new | transcribing | ready | finding | done | failed
  error text not null default '',
  job_token text,
  job_started_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists nugget_sources_guid on nugget_sources (speaker_id, guid);
create table if not exists nuggets (
  id serial primary key,
  source_id integer references nugget_sources (id) on delete set null,
  speaker_id integer not null references nugget_speakers (id) on delete cascade,
  title text not null,
  tags text[] not null default '{}',
  start_sec real not null,
  end_sec real not null,
  status text not null default 'suggested',    -- suggested | approved | dropped
  made_by text not null default 'ai',          -- ai | founder
  why text not null default '',
  url text not null default '',                -- the cut clip, once ready
  duration_sec real not null default 0,
  cut_error text not null default '',
  job_token text,
  job_started_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists nuggets_status on nuggets (status, created_at desc);
create table if not exists nugget_favourites (
  user_id text not null,
  nugget_id integer not null references nuggets (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, nugget_id)
);
create table if not exists nugget_settings (
  id integer primary key default 1,
  breaks_on boolean not null default true,
  every_items integer not null default 3
);
insert into nugget_settings (id) values (1) on conflict (id) do nothing;
-- Station breaks reach everyone only once the founder switches this on (until then, only the founder hears them).
insert into app_flags (key, enabled) values ('nuggets', false) on conflict (key) do nothing;
-- The first speaker: Apostle Grace Lubega (Phaneroo Ministries International's podcast).
insert into nugget_speakers (name, feed_url, permission)
select 'Apostle Grace Lubega', 'https://feeds.soundcloud.com/users/soundcloud:users:334530022/sounds.rss', 'Permission from Phaneroo Ministries (noted by the founder, 17 Nov 2026).'
where not exists (select 1 from nugget_speakers);
