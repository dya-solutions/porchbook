alter table profiles
  add column if not exists pinned_post_id integer references posts (id) on delete set null;
