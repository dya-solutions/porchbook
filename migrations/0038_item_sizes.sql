-- Sizes the founder sets for things shown on Porchbook (books on a shelf,
-- files in an office, ...). One row per place + item; everyone sees them.
create table if not exists item_sizes (
  place text not null,
  item text not null,
  w real not null,
  h real not null,
  updated_at timestamptz not null default now(),
  primary key (place, item)
);
