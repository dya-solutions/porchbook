-- Five fixed offices. A head replies. The founder can read every thread.

create table if not exists offices (
  key text primary key,
  name text not null,
  sort integer not null,
  head_user_id text references profiles (user_id) on delete set null
);

insert into offices (key, name, sort) values
  ('pastor', 'Office of the Pastor', 1),
  ('hoo', 'Office of the H.O.O', 2),
  ('administrator', 'Office of the Administrator', 3),
  ('hof', 'Office of the H.O.F', 4),
  ('prayer', 'Prayer Requests', 5)
on conflict (key) do update set name = excluded.name, sort = excluded.sort;

create table if not exists office_threads (
  id serial primary key,
  office_key text not null references offices (key),
  member_id text not null references profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (office_key, member_id)
);

create table if not exists office_messages (
  id serial primary key,
  thread_id integer not null references office_threads (id) on delete cascade,
  author_id text not null references profiles (user_id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint office_messages_body_len check (char_length(body) between 1 and 2000)
);

create index if not exists office_messages_thread_idx on office_messages (thread_id, created_at);
