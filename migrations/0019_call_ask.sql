-- A person must allow a caller before that caller can ring them.

create table if not exists call_permissions (
  owner_id text not null references profiles (user_id) on delete cascade,
  caller_id text not null references profiles (user_id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  primary key (owner_id, caller_id),
  constraint call_permissions_status check (status in ('pending', 'allowed')),
  constraint call_permissions_distinct check (owner_id <> caller_id)
);
