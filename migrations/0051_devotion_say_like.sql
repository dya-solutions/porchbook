-- The devotional read aloud: how to say names the voice gets wrong ("Lubega = Lhubhega"), one per line.
alter table devotion_voice_settings add column if not exists say_like text not null default '';
