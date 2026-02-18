-- =============================================================
-- PERP POSITIONS TABLE
-- Stores per-wallet, per-ticker positions from perpSnapshots
-- =============================================================

-- Main positions table
create table if not exists perp_positions (
  id bigserial primary key,
  snapshot_id text not null,
  market text not null,
  address text not null,
  size decimal(24, 8) not null,              -- positive = long, negative = short
  notional decimal(24, 2) not null,
  entry_price decimal(24, 2) not null,
  leverage_type smallint not null default 0, -- 0 = cross, 1 = isolated
  leverage decimal(10, 2) not null default 1,
  liquidation_price decimal(24, 2),
  account_value decimal(24, 2),
  funding_pnl decimal(24, 4) default 0,
  created_at timestamptz not null default now(),
  
  -- Composite unique constraint to prevent duplicates
  unique(snapshot_id, market, address)
);

-- Indexes for fast queries
create index if not exists idx_pp_snapshot_id on perp_positions(snapshot_id);
create index if not exists idx_pp_market on perp_positions(market);
create index if not exists idx_pp_address on perp_positions(address);
create index if not exists idx_pp_created_at on perp_positions(created_at desc);
create index if not exists idx_pp_market_created on perp_positions(market, created_at desc);
create index if not exists idx_pp_notional on perp_positions(notional desc);

-- Composite index for whale queries (positions over $X on specific market)
create index if not exists idx_pp_market_notional on perp_positions(market, notional desc);

-- Enable Row Level Security
alter table perp_positions enable row level security;

-- Allow inserts from service role
create policy "Enable insert for perp_positions" on perp_positions 
  for insert with check (true);

-- Allow reads for everyone
create policy "Enable read for perp_positions" on perp_positions 
  for select using (true);

-- =============================================================
-- HELPER VIEW: Position Changes Between Snapshots
-- =============================================================

create or replace view position_changes as
with current_positions as (
  select distinct on (market, address)
    snapshot_id,
    market,
    address,
    size,
    notional,
    entry_price,
    created_at
  from perp_positions
  order by market, address, created_at desc
),
previous_positions as (
  select distinct on (market, address)
    snapshot_id,
    market,
    address,
    size as prev_size,
    notional as prev_notional,
    entry_price as prev_entry_price,
    created_at as prev_created_at
  from perp_positions
  where created_at < (select max(created_at) from perp_positions)
  order by market, address, created_at desc
)
select 
  c.snapshot_id,
  c.market,
  c.address,
  c.size,
  c.notional,
  c.entry_price,
  c.created_at,
  p.prev_size,
  p.prev_notional,
  p.prev_entry_price,
  case 
    when p.prev_size is null then 'NEW'
    when c.size > 0 and p.prev_size <= 0 then 'FLIPPED_LONG'
    when c.size < 0 and p.prev_size >= 0 then 'FLIPPED_SHORT'
    when abs(c.size) > abs(p.prev_size) then 'INCREASED'
    when abs(c.size) < abs(p.prev_size) then 'DECREASED'
    else 'UNCHANGED'
  end as change_type,
  c.size - coalesce(p.prev_size, 0) as size_delta,
  c.notional - coalesce(p.prev_notional, 0) as notional_delta
from current_positions c
left join previous_positions p on c.market = p.market and c.address = p.address;

-- =============================================================
-- CLEANUP: Keep only last 24 hours of data (run periodically)
-- =============================================================

-- Optional: Create a function to clean old data
create or replace function cleanup_old_positions()
returns void as $$
begin
  delete from perp_positions 
  where created_at < now() - interval '24 hours';
end;
$$ language plpgsql;

-- =============================================================
-- SAMPLE QUERIES
-- =============================================================

-- Get all new BTC positions in the last hour with notional > $10K
-- select * from perp_positions 
-- where market = 'BTC' 
--   and notional > 10000 
--   and created_at > now() - interval '1 hour'
-- order by notional desc;

-- Get position changes for whales (> $50K)
-- select * from position_changes 
-- where notional > 50000 
--   and change_type in ('NEW', 'INCREASED', 'FLIPPED_LONG', 'FLIPPED_SHORT')
-- order by notional_delta desc;

-- Get top 10 biggest new longs on any market
-- select * from perp_positions 
-- where size > 0 
--   and created_at > now() - interval '1 hour'
-- order by notional desc 
-- limit 10;

