-- Jingle maker: words read by an Azure voice, mixed over a music bed by the audio server.
create table if not exists jingle_drafts (
  id serial primary key,
  words text not null default '',
  voice text not null default '',
  style text not null default '',
  bed_url text not null default '',
  bed_level real not null default 0.25,
  voice_url text not null default '',
  voice_sec real not null default 0,
  url text not null default '',
  duration_sec real not null default 0,
  status text not null default 'making',
  error text not null default '',
  job_token text,
  made_by text not null default '',
  created_at timestamptz not null default now()
);
