-- A private list of posts a member wants to come back to. Only they can see it.

create table if not exists keeps (
  user_id text not null references profiles (user_id) on delete cascade,
  post_id integer not null references posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists keeps_user_idx on keeps (user_id, created_at desc);
