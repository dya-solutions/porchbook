-- A call between two people, one room for each pair.

alter table groups drop constraint if exists groups_kind_chk;
alter table groups add constraint groups_kind_chk check (kind in ('personal', 'porch', 'pair'));

alter table groups add column if not exists pair_key text;
create unique index if not exists groups_one_pair on groups (pair_key) where pair_key is not null;
