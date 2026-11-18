-- The Radio's audio storage (Vercel Blob, free plan: 1 GB), measured about twice a day for the founder's warnings.
create table if not exists radio_usage (
  id integer primary key default 1,
  storage_bytes bigint not null default 0,
  files integer not null default 0,
  checked_at timestamptz
);
insert into radio_usage (id) values (1) on conflict (id) do nothing;
