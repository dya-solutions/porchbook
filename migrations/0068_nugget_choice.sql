-- Nuggets: the founder can keep one out of the automatic breaks, and play any nugget now or next.
alter table nuggets add column if not exists in_breaks boolean not null default true;
-- A "Play now" may now be a nugget (its id lives in the nuggets table, not fm_tracks).
alter table fm_breaks drop constraint if exists fm_breaks_track_id_fkey;
