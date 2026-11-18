create table if not exists mission_sends (
  id serial primary key,
  sender_id text not null references profiles (user_id) on delete cascade,
  body text not null,
  parts integer not null,
  created_at timestamptz not null default now(),
  constraint mission_sends_body_len check (char_length(body) between 1 and 640)
);

create table if not exists mission_send_to (
  send_id integer not null references mission_sends (id) on delete cascade,
  person_name text not null default '',
  phone text not null,
  constraint mission_send_to_phone_len check (char_length(phone) <= 32)
);

create index if not exists mission_send_to_idx on mission_send_to (send_id);
