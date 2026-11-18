-- Jingles and station IDs are trimmed to where their sound actually ends.
alter table fm_tracks add column if not exists play_sec real;
