-- A third room, for questions.

alter table posts drop constraint if exists posts_room_chk;
alter table posts add constraint posts_room_chk
  check (room in ('proclaim', 'inform', 'ask'));
