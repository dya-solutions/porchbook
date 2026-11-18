-- The Pastor's office holds four rooms. Prayer requests move in with them.

alter table office_threads add column if not exists room text not null default 'note';

alter table office_threads drop constraint if exists office_threads_office_key_member_id_key;

update office_threads
set office_key = 'pastor', room = 'thanks'
where office_key = 'prayer';

update office_threads
set room = 'appoint'
where office_key = 'pastor' and room = 'note';

create unique index if not exists office_threads_member_room
  on office_threads (office_key, member_id, room);

create table if not exists office_calendar (
  office_key text primary key references offices (key),
  body text not null default '',
  updated_at timestamptz not null default now()
);
