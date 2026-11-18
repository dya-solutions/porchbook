-- The Bible's "other versions" window: the founder picks which website each version opens.
create table if not exists bible_sites (
  id serial primary key,
  label text not null,
  url text not null,
  sort integer not null default 0,
  updated_at timestamptz not null default now()
);
