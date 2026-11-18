-- Quiet record of attempts to change something that is not yours.

create table if not exists guard_attempts (
  id serial primary key,
  user_id text,
  kind text not null,
  detail text not null,
  created_at timestamptz not null default now(),
  constraint guard_attempts_detail_len check (char_length(detail) between 1 and 240)
);

create index if not exists guard_attempts_recent_idx on guard_attempts (kind, created_at desc);
