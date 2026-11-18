create table if not exists button_sound (
  id integer primary key,
  mime text not null,
  audio text not null,
  updated_at timestamptz not null default now()
);
