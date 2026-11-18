-- Bible readings on the Radio: a book's audio, cut into chapters, played in order at set times.
create table if not exists bible_audio_books (
  id serial primary key,
  book integer not null,                 -- 1 = Genesis … 66 = Revelation
  file_url text not null default '',     -- the whole-book file (empty when uploaded chapter by chapter)
  status text not null default 'new',    -- new | splitting | review | approved | failed
  error text not null default '',
  job_token text,
  job_started_at timestamptz,
  job_tries integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists bible_audio_chapters (
  id serial primary key,
  book_id integer not null references bible_audio_books (id) on delete cascade,
  chapter integer not null,
  url text not null,
  start_sec real not null default 0,     -- where it starts in the whole-book file
  end_sec real not null default 0,
  duration_sec real not null,
  approved boolean not null default false,
  unique (book_id, chapter)
);
create table if not exists bible_settings (
  id integer primary key default 1,
  readings_on boolean not null default false,
  times integer[] not null default '{360,1260}',  -- minutes after midnight, Kampala (6:00 am, 9:00 pm)
  per_sitting integer not null default 3,
  next_pos integer not null default 0              -- where the next sitting carries on (in Bible order)
);
insert into bible_settings (id) values (1) on conflict (id) do nothing;
-- Each reading time that has been put on the Radio's schedule (so it is made once).
create table if not exists bible_sittings (
  sit_at timestamptz primary key,
  first_pos integer not null,
  made_at timestamptz not null default now()
);
