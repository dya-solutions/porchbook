-- One short the founder can change, and a live ring while a call is waiting.

create table if not exists rhema_clip (
  id integer primary key,
  video_id text,
  updated_at timestamptz not null default now(),
  constraint rhema_clip_one check (id = 1)
);

create table if not exists call_rings (
  callee_id text primary key references profiles (user_id) on delete cascade,
  caller_id text not null references profiles (user_id) on delete cascade,
  caller_name text not null,
  created_at timestamptz not null default now()
);
