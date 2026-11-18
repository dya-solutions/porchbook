-- The devotional in Runyankore: Phaneroo's own when published, otherwise machine translated (Sunbird AI); kept per day.
create table if not exists devotion_translations (
  link text not null,
  lang text not null,
  html text not null default '',
  source text not null default '',
  made_at timestamptz not null default now(),
  primary key (link, lang)
);
alter table devotion_voice_settings add column if not exists sunbird_key text not null default '';
