create table if not exists office_files (
  office_key text not null,
  part text not null,
  title text not null default '',
  body text not null default '',
  updated_at timestamptz not null default now(),
  primary key (office_key, part),
  constraint office_file_title_len check (char_length(title) <= 80),
  constraint office_file_body_len check (char_length(body) <= 4000)
);
