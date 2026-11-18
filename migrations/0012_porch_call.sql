-- One shared call for the whole porch. Personal groups stay separate.

alter table groups add column if not exists kind text not null default 'personal';

alter table groups drop constraint if exists groups_kind_chk;
alter table groups add constraint groups_kind_chk check (kind in ('personal', 'porch'));

create unique index if not exists groups_one_porch on groups (kind) where kind = 'porch';
