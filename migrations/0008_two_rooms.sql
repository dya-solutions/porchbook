-- Only Proclaim and Inform remain. Older posts move to Inform.
-- The old check is dropped first, because Inform is not in it yet.

alter table posts drop constraint if exists posts_room_chk;

update posts set room = 'inform' where room not in ('proclaim', 'inform');

alter table posts add constraint posts_room_chk
  check (room in ('proclaim', 'inform'));
