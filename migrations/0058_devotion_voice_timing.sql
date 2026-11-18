-- When each word of the devotional is spoken (so the radio screen can roll the words in step with the voice).
alter table devotion_voices add column if not exists timing text not null default '';
