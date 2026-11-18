-- A second voice (Google) that reads the devotional when ElevenLabs runs out of credits or fails.
alter table devotion_voice_settings add column if not exists backup_key text not null default '';
alter table devotion_voice_settings add column if not exists backup_voice text not null default '';
