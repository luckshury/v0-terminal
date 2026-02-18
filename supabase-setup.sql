-- Supabase Setup for Screener Historical Data
-- Run this SQL in your Supabase SQL Editor

-- Create price snapshots table
create table if not exists price_snapshots (
  id bigserial primary key,
  symbol text not null,
  price numeric not null,
  timestamp timestamptz not null default now()
);

-- Create index for fast queries by symbol and timestamp
create index if not exists idx_symbol_timestamp 
  on price_snapshots(symbol, timestamp desc);

-- Enable Row Level Security (RLS)
alter table price_snapshots enable row level security;

-- Policy: Allow inserts from service role (server-side)
create policy if not exists "Enable insert for service role" 
  on price_snapshots
  for insert 
  with check (true);

-- Policy: Allow reads for all users
create policy if not exists "Enable read for all" 
  on price_snapshots
  for select 
  using (true);

-- Optional: Create a function to clean up old snapshots (keep last 90 days)
create or replace function cleanup_old_snapshots()
returns void
language plpgsql
as $$
begin
  delete from price_snapshots
  where timestamp < now() - interval '90 days';
end;
$$;

-- Optional: Schedule cleanup to run daily (requires pg_cron extension)
-- Uncomment if you want automatic cleanup:
-- select cron.schedule('cleanup-price-snapshots', '0 0 * * *', 'select cleanup_old_snapshots()');

-- Create a view for latest prices
create or replace view latest_prices as
select distinct on (symbol)
  symbol,
  price,
  timestamp
from price_snapshots
order by symbol, timestamp desc;

-- ============================================
-- TRADER SNAPSHOTS TABLE (for perpSnapshot data)
-- ============================================

-- Create trader snapshots table
create table if not exists trader_snapshots (
  id bigserial primary key,
  snapshot_id text not null,
  coin text not null,
  timestamp timestamptz not null default now(),
  long_count integer not null,
  short_count integer not null,
  total_traders integer not null,
  long_short_ratio decimal(10, 4) not null,
  long_notional decimal(24, 2),
  short_notional decimal(24, 2),
  created_at timestamptz not null default now()
);

-- Indexes for fast queries
create index if not exists idx_trader_snapshots_coin 
  on trader_snapshots(coin);
create index if not exists idx_trader_snapshots_timestamp 
  on trader_snapshots(timestamp desc);
create index if not exists idx_trader_snapshots_coin_timestamp 
  on trader_snapshots(coin, timestamp desc);

-- Unique constraint to prevent duplicate snapshots
create unique index if not exists idx_trader_snapshots_unique 
  on trader_snapshots(snapshot_id, coin);

-- Enable Row Level Security
alter table trader_snapshots enable row level security;

-- Policy: Allow inserts from service role (server-side)
create policy if not exists "Enable insert for trader_snapshots" 
  on trader_snapshots
  for insert 
  with check (true);

-- Policy: Allow reads for all users
create policy if not exists "Enable read for trader_snapshots" 
  on trader_snapshots
  for select 
  using (true);

-- Function to clean up old trader snapshots (keep last 30 days)
create or replace function cleanup_old_trader_snapshots()
returns void
language plpgsql
as $$
begin
  delete from trader_snapshots
  where timestamp < now() - interval '30 days';
end;
$$;

-- View for latest trader data per coin
create or replace view latest_trader_snapshots as
select distinct on (coin)
  coin,
  snapshot_id,
  timestamp,
  long_count,
  short_count,
  total_traders,
  long_short_ratio,
  long_notional,
  short_notional
from trader_snapshots
order by coin, timestamp desc;

-- View for available coins
create or replace view available_coins as
select distinct coin
from trader_snapshots
order by coin;

-- ============================================
-- VERIFICATION
-- ============================================

-- Verify table creation
select 'Setup complete! Tables created:' as status;
select count(*) as price_snapshots_count from price_snapshots;
select count(*) as trader_snapshots_count from trader_snapshots;



