-- Browser push subscriptions for private-note alerts.
-- The note body is never stored here and never sent in the alert.

create table if not exists push_keys (
  id integer primary key default 1 check (id = 1),
  public_key text not null,
  private_key text not null
);

create table if not exists push_subscriptions (
  id serial primary key,
  user_id text not null references profiles (user_id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_len check (char_length(endpoint) between 12 and 2000),
  constraint push_subscriptions_key_len check (
    char_length(p256dh) between 8 and 255 and char_length(auth) between 8 and 255
  )
);

create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id, created_at desc);
