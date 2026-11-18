-- The devotional read aloud: a soft strings track played quietly under the voice, and how loud it sits.
alter table devotion_voice_settings add column if not exists bed_url text not null default '';
alter table devotion_voice_settings add column if not exists bed_level real not null default 0.18;
