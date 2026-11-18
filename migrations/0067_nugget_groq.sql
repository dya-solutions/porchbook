-- Nuggets: sermons are turned into text by Groq (much cheaper than ElevenLabs) so the AI can pick moments.
alter table nugget_settings add column if not exists groq_key text not null default '';
