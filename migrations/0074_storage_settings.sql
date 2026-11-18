-- Where files are kept: Cloudflare R2 (once its keys are saved) instead of Vercel Blob.
create table if not exists storage_settings (
  id integer primary key default 1,
  r2_endpoint text not null default '',
  r2_access_key text not null default '',
  r2_secret text not null default '',
  r2_bucket text not null default 'porchbook-radio',
  r2_public text not null default 'https://pub-c947a813830a4433a550d7f600aa53ab.r2.dev',
  use_r2 boolean not null default false,
  moved_at timestamptz
);
insert into storage_settings (id) values (1) on conflict (id) do nothing;
