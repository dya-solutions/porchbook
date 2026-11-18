alter table my_twenty add column if not exists centre text not null default '';
alter table my_twenty drop constraint if exists my_twenty_centre_len;
alter table my_twenty add constraint my_twenty_centre_len check (char_length(centre) <= 80);
