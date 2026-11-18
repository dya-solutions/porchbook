-- Group accountability: what each leader reports about their group (seen by that group's leader and the founder only).
create table if not exists group_accounts (
  id bigserial primary key,
  group_id bigint not null,
  author_id text not null,
  happened_on date not null,
  attended integer,
  body text not null,
  needs text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists group_accounts_group on group_accounts (group_id, happened_on desc);
