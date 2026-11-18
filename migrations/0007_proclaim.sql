-- A fifth room: Proclaim. Existing posts stay in their rooms.

alter table posts drop constraint if exists posts_room_chk;
alter table posts add constraint posts_room_chk
  check (room in ('general', 'wins', 'questions', 'social', 'proclaim'));
