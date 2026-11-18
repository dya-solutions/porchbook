-- What the porch guy's AI uses (counted from each reply), and the credit the founder has loaded.
create table if not exists porch_guy_usage (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd double precision not null default 0
);
create table if not exists porch_guy_credit (
  id int primary key default 1,
  amount_usd double precision not null default 0,
  set_at timestamptz not null default now()
);
