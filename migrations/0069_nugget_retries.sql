-- Nuggets: jobs the audio server didn't pick up (asleep, restarting) are sent again, a few times.
alter table nuggets add column if not exists cut_tries integer not null default 0;
alter table nugget_sources add column if not exists job_tries integer not null default 0;
