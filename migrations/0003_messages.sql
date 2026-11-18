-- Private 1:1 notes. A conversation exists only for a sorted pair of members.
-- Server functions allow reads and writes only for the signed-in participant.

create table if not exists conversations (
  id serial primary key,
  low_user_id text not null references profiles (user_id) on delete cascade,
  high_user_id text not null references profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_order_chk check (low_user_id < high_user_id),
  constraint conversations_pair_uniq unique (low_user_id, high_user_id)
);

create index if not exists conversations_low_idx on conversations (low_user_id);
create index if not exists conversations_high_idx on conversations (high_user_id);

create table if not exists messages (
  id serial primary key,
  conversation_id integer not null references conversations (id) on delete cascade,
  author_id text not null references profiles (user_id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint messages_body_len check (char_length(body) between 1 and 2000)
);

create index if not exists messages_conv_idx on messages (conversation_id, created_at);

create table if not exists conversation_reads (
  conversation_id integer not null references conversations (id) on delete cascade,
  user_id text not null references profiles (user_id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
