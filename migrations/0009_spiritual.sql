-- Two short details each member writes about themselves. Fifty words each.

alter table profiles add column if not exists spiritual_identity text not null default '';
alter table profiles add column if not exists spiritual_responsibility text not null default '';
