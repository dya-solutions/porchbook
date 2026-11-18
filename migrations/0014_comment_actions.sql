-- Replies can be edited, kept, and marked the same way as a post.

alter table comments add column if not exists edited_at timestamptz;

create table if not exists comment_reactions (
  comment_id integer not null references comments (id) on delete cascade,
  user_id text not null references profiles (user_id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id),
  constraint comment_reactions_kind_chk check (kind in ('care', 'thanks', 'insight', 'cheer'))
);

create table if not exists comment_keeps (
  user_id text not null references profiles (user_id) on delete cascade,
  comment_id integer not null references comments (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, comment_id)
);
