-- Bible readings, simpler: each book is cut into ~5-minute pieces (at pauses) that play in order,
-- one after every few Radio items, carrying on from where the last stopped.
alter table bible_audio_books add column if not exists duration_sec real not null default 0;
alter table bible_settings add column if not exists every_items integer not null default 3;
alter table bible_settings add column if not exists piece_sec integer not null default 300;
-- The reading times are gone: take back any that were put on the schedule.
delete from fm_breaks where created_by = 'bible' and starts_at > now();
delete from bible_sittings;
