-- Porchbook Radio: play the devotional's strings softly under a sermon that has no music.
alter table fm_tracks add column if not exists strings boolean not null default false;
