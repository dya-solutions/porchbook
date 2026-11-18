create table if not exists trouble_reports (
  id serial primary key,
  user_id text not null references profiles (user_id) on delete cascade,
  page text not null default '',
  words text not null default '',
  shown text not null default '',
  picture text not null default '',
  created_at timestamptz not null default now(),
  constraint trouble_words_len check (char_length(words) <= 1000),
  constraint trouble_shown_len check (char_length(shown) <= 500),
  constraint trouble_page_len check (char_length(page) <= 200)
);
