-- Porch: a private team feed. Profiles are public to signed-in members.
-- Writes are scoped to the verified session user in server functions.

create table if not exists profiles (
  user_id text primary key,
  display_name text not null,
  email text,
  image_url text,
  role text not null default '',
  team text not null default '',
  bio text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists posts (
  id serial primary key,
  author_id text not null references profiles (user_id) on delete cascade,
  room text not null,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  constraint posts_room_chk check (room in ('general', 'wins', 'questions', 'social')),
  constraint posts_body_len check (char_length(body) between 1 and 2000)
);

create index if not exists posts_created_idx on posts (created_at desc);
create index if not exists posts_author_idx on posts (author_id, created_at desc);

create table if not exists comments (
  id serial primary key,
  post_id integer not null references posts (id) on delete cascade,
  author_id text not null references profiles (user_id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint comments_body_len check (char_length(body) between 1 and 800)
);

create index if not exists comments_post_idx on comments (post_id, created_at);

create table if not exists reactions (
  post_id integer not null references posts (id) on delete cascade,
  user_id text not null references profiles (user_id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id),
  constraint reactions_kind_chk check (kind in ('care', 'thanks', 'insight', 'cheer'))
);

create index if not exists reactions_post_idx on reactions (post_id);
