create table if not exists my_twenty (
  user_id text not null references profiles (user_id) on delete cascade,
  slot integer not null,
  person_name text not null default '',
  phone text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, slot),
  constraint my_twenty_slot_chk check (slot between 1 and 20),
  constraint my_twenty_name_len check (char_length(person_name) <= 80),
  constraint my_twenty_phone_len check (char_length(phone) <= 32)
);
