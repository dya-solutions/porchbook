create table if not exists previous_clip (
  id integer primary key,
  kind text not null,
  youtube_id text,
  url text,
  mime text,
  updated_at timestamptz not null default now(),
  constraint previous_clip_kind check (kind in ('youtube', 'link', 'file'))
);
