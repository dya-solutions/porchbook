create table if not exists mission_reports (
  user_id text primary key references profiles (user_id) on delete cascade,
  body text not null default '',
  updated_at timestamptz not null default now()
);
