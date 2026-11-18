alter table my_twenty add column if not exists batch integer not null default 1;
alter table my_twenty drop constraint if exists my_twenty_pkey;
alter table my_twenty drop constraint if exists my_twenty_batch_pkey;
alter table my_twenty add constraint my_twenty_batch_pkey primary key (user_id, batch, slot);
