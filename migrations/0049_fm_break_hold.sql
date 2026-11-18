-- Porchbook Radio: a studio change to the list keeps the item on air playing to its end.
alter table fm_breaks add column if not exists hold_from_sec double precision;
alter table fm_breaks add column if not exists hold_len_sec double precision;
alter table fm_breaks add column if not exists hold_cut boolean not null default false;
