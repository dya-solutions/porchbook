-- The devotional read aloud: one setting row (Google key + chosen voice) and one audio file per devotional page.
create table if not exists devotion_voice_settings (
  id int primary key default 1,
  api_key text not null default '',
  voice text not null default '',
  updated_at timestamptz not null default now()
);
create table if not exists devotion_voices (
  link text primary key,
  voice text not null default '',
  url text not null default '',
  seconds real not null default 0,
  status text not null default 'making',
  error text not null default '',
  started_at timestamptz not null default now(),
  made_at timestamptz
);
