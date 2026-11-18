create table if not exists transport_locations (
  user_id text primary key references profiles (user_id) on delete cascade,
  place text not null default '',
  notice text not null default '',
  updated_at timestamptz not null default now(),
  constraint transport_place_len check (char_length(place) <= 120),
  constraint transport_notice_len check (char_length(notice) <= 200)
);

alter table transport_locations add column if not exists phone text not null default '';

create table if not exists transport_stages (
  id serial primary key,
  place text not null,
  stage text not null,
  constraint transport_stage_place_len check (char_length(place) between 1 and 120),
  constraint transport_stage_name_len check (char_length(stage) between 1 and 200)
);

