-- A locked post is not open for replies.

alter table posts add column if not exists locked boolean not null default false;
