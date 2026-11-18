-- Bible readings: about 3 minutes each (books uploaded from now on).
alter table bible_settings alter column piece_sec set default 180;
update bible_settings set piece_sec = 180 where id = 1;
