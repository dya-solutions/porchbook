-- In-app notifications: who reacted to, replied to, or asked you something.
create table if not exists notifications (
  id serial primary key,
  user_id text not null,
  actor_id text not null,
  kind text not null,            -- reaction | reply | question
  target text not null default 'post', -- post | reply (what was reacted to)
  post_id integer not null default 0,
  ref_id integer not null default 0,   -- the post or reply id
  reaction text not null default '',
  snippet text not null default '',
  seen boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);
-- The bell shows only to the founder until this is switched on.
insert into app_flags (key, enabled) values ('bell', false) on conflict (key) do nothing;
