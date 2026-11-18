-- Porchbook Radio audio processing (loudness evened out, one standard format),
-- done by the audio worker on the calls server.
alter table fm_tracks add column if not exists processed_at timestamptz;
alter table fm_tracks add column if not exists process_token text;
alter table fm_tracks add column if not exists process_started_at timestamptz;
alter table fm_tracks add column if not exists process_error text;
