create table if not exists hoo_reports (
  id serial primary key,
  desk text not null,
  folder text not null,
  author_id text not null references profiles (user_id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint hoo_reports_body_len check (char_length(body) between 1 and 2000)
);

create index if not exists hoo_reports_desk_idx on hoo_reports (desk, folder, created_at desc);

create table if not exists hoo_decisions (
  report_id integer primary key references hoo_reports (id) on delete cascade,
  decision text not null,
  reason text not null default '',
  decider_id text not null references profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint hoo_decisions_kind check (decision in ('yes', 'notyet')),
  constraint hoo_decisions_reason_len check (char_length(reason) <= 500)
);

create table if not exists hoo_writers (
  desk text primary key,
  user_id text not null references profiles (user_id) on delete cascade
);
