-- The backup voice (Azure) can read every day, ElevenLabs then only stepping in if it fails.
alter table devotion_voice_settings add column if not exists backup_first boolean not null default false;
update devotion_voice_settings set backup_first = true where id = 1 and backup_key like 'az|%';
