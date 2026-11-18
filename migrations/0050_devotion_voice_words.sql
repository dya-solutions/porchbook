-- The devotional read aloud: the founder's own opening and closing words, read every day.
alter table devotion_voice_settings add column if not exists opening text not null default '';
alter table devotion_voice_settings add column if not exists closing text not null default '';
