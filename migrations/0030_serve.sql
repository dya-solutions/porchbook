create table if not exists serve_forms (
  user_id text primary key references profiles (user_id) on delete cascade,
  first_name text not null,
  last_name text not null,
  phone text not null,
  email text not null,
  gender text not null,
  born_on text not null,
  city text not null,
  discipleship text not null,
  how_long text not null,
  department text not null,
  serves_elsewhere text not null,
  elsewhere text not null default '',
  profession text not null default '',
  skills text not null default '',
  consent text not null,
  updated_at timestamptz not null default now()
);
