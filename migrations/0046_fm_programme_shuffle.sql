-- A programme can play its items in a fresh shuffled order each time round.
alter table fm_programmes add column if not exists shuffle boolean not null default false;
