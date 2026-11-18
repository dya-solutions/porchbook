alter table conversations drop constraint if exists conversations_order_chk;
alter table conversations
  add constraint conversations_order_chk check (low_user_id <= high_user_id);

alter table messages add column if not exists reply_to integer;
alter table messages add column if not exists edited_at timestamptz;
alter table messages add column if not exists deleted_at timestamptz;

create table if not exists message_hides (
  message_id integer not null references messages (id) on delete cascade,
  user_id text not null references profiles (user_id) on delete cascade,
  primary key (message_id, user_id)
);

create table if not exists message_stars (
  message_id integer not null references messages (id) on delete cascade,
  user_id text not null references profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table if not exists message_reactions (
  message_id integer not null references messages (id) on delete cascade,
  user_id text not null references profiles (user_id) on delete cascade,
  emoji text not null,
  primary key (message_id, user_id),
  constraint message_reactions_emoji_len check (char_length(emoji) between 1 and 8)
);

create table if not exists conversation_pins (
  conversation_id integer primary key references conversations (id) on delete cascade,
  message_id integer not null references messages (id) on delete cascade
);
