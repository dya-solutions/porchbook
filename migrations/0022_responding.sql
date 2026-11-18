create table if not exists conversation_signals (
  conversation_id integer not null references conversations (id) on delete cascade,
  user_id text not null references profiles (user_id) on delete cascade,
  at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
