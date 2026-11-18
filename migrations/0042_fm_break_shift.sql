-- After a "Play now" the station carries on with the next item in the list:
-- each break stores the resulting timeline shift and the slot it applies to.
alter table fm_breaks add column if not exists shift_context text;
alter table fm_breaks add column if not exists shift_ms bigint;
