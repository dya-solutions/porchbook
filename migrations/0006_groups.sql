-- Personal groups. Notes and calls are visible only to members.

create table if not exists groups (
  id serial primary key,
  name text not null,
  owner_id text not null references profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint groups_name_len check (char_length(name) between 1 and 40)
);

create table if not exists group_members (
  group_id integer not null references groups (id) on delete cascade,
  user_id text not null references profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_members_user_idx on group_members (user_id);

create table if not exists group_notes (
  id serial primary key,
  group_id integer not null references groups (id) on delete cascade,
  author_id text not null references profiles (user_id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint group_notes_body_len check (char_length(body) between 1 and 800)
);

create index if not exists group_notes_idx on group_notes (group_id, created_at);

create table if not exists call_peers (
  group_id integer not null references groups (id) on delete cascade,
  user_id text not null references profiles (user_id) on delete cascade,
  display_name text not null,
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists call_signals (
  id serial primary key,
  group_id integer not null references groups (id) on delete cascade,
  from_id text not null,
  to_id text not null,
  kind text not null,
  payload text not null,
  created_at timestamptz not null default now(),
  constraint call_signals_kind_chk check (kind in ('offer', 'answer', 'ice')),
  constraint call_signals_payload_len check (char_length(payload) between 1 and 8000)
);

create index if not exists call_signals_to_idx on call_signals (group_id, to_id, id);
