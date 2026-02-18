-- =============================================================
-- MANUAL SETUP: Real-Time Position Tracking Tables
-- Copy and paste this SQL into your Supabase SQL Editor
-- =============================================================

-- 1. CREATE FILLS TABLE
CREATE TABLE IF NOT EXISTS fills (
  id BIGSERIAL PRIMARY KEY,
  
  -- Core fill data from Hydromancer allFills
  address TEXT NOT NULL,
  coin TEXT NOT NULL,
  price DECIMAL(24, 8) NOT NULL,
  size DECIMAL(24, 8) NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('B', 'A')), -- B=buy, A=sell
  direction TEXT NOT NULL, -- 'Open Long', 'Close Short', etc.
  start_position DECIMAL(24, 8) DEFAULT 0, -- Position before this fill
  closed_pnl DECIMAL(24, 4) DEFAULT 0,
  
  -- Timing and identification
  timestamp TIMESTAMPTZ NOT NULL,
  fill_hash TEXT UNIQUE NOT NULL,
  order_id BIGINT,
  trade_id BIGINT,
  
  -- Additional metadata
  fee DECIMAL(24, 4) DEFAULT 0,
  fee_token TEXT DEFAULT 'USDC',
  crossed BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraint: Only track BTC, ETH, HYPE
  CONSTRAINT valid_coins CHECK (coin IN ('BTC', 'ETH', 'HYPE'))
);

-- 2. CREATE POSITION STATES TABLE
CREATE TABLE IF NOT EXISTS position_states (
  address TEXT NOT NULL,
  coin TEXT NOT NULL,
  
  -- Current position metrics
  current_size DECIMAL(24, 8) NOT NULL DEFAULT 0, -- Positive=long, negative=short
  current_notional DECIMAL(24, 2) NOT NULL DEFAULT 0,
  avg_entry_price DECIMAL(24, 8),
  
  -- P&L tracking
  realized_pnl DECIMAL(24, 4) DEFAULT 0, -- Cumulative from fills
  unrealized_pnl DECIMAL(24, 4) DEFAULT 0, -- Mark-to-market
  
  -- Metadata
  first_entry_time TIMESTAMPTZ,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_volume DECIMAL(24, 2) DEFAULT 0, -- Cumulative volume traded
  
  PRIMARY KEY(address, coin),
  
  -- Constraint: Only track BTC, ETH, HYPE  
  CONSTRAINT valid_position_coins CHECK (coin IN ('BTC', 'ETH', 'HYPE'))
);

-- 3. CREATE MINUTE AGGREGATES TABLE
CREATE TABLE IF NOT EXISTS minute_aggregates (
  coin TEXT NOT NULL,
  minute_timestamp TIMESTAMPTZ NOT NULL, -- Rounded to minute boundary
  
  -- Position change counts
  new_longs INTEGER DEFAULT 0,           -- New long positions opened
  new_shorts INTEGER DEFAULT 0,          -- New short positions opened  
  closed_longs INTEGER DEFAULT 0,        -- Long positions fully closed
  closed_shorts INTEGER DEFAULT 0,       -- Short positions fully closed
  increased_longs INTEGER DEFAULT 0,     -- Existing longs increased
  increased_shorts INTEGER DEFAULT 0,    -- Existing shorts increased
  decreased_longs INTEGER DEFAULT 0,     -- Existing longs decreased
  decreased_shorts INTEGER DEFAULT 0,    -- Existing shorts decreased
  
  -- Volume metrics (in notional USD)
  long_volume_in DECIMAL(24, 2) DEFAULT 0,    -- Capital flowing into longs
  short_volume_in DECIMAL(24, 2) DEFAULT 0,   -- Capital flowing into shorts
  long_volume_out DECIMAL(24, 2) DEFAULT 0,   -- Capital flowing out of longs  
  short_volume_out DECIMAL(24, 2) DEFAULT 0,  -- Capital flowing out of shorts
  
  -- Net flows (computed columns)
  net_long_flow DECIMAL(24, 2) GENERATED ALWAYS AS (long_volume_in - long_volume_out) STORED,
  net_short_flow DECIMAL(24, 2) GENERATED ALWAYS AS (short_volume_in - short_volume_out) STORED,
  net_total_flow DECIMAL(24, 2) GENERATED ALWAYS AS ((long_volume_in - long_volume_out) - (short_volume_in - short_volume_out)) STORED,
  
  -- Wallet activity
  unique_wallets INTEGER DEFAULT 0,      -- Distinct wallets active this minute
  new_wallets INTEGER DEFAULT 0,         -- First-time wallets this minute
  whale_wallets INTEGER DEFAULT 0,       -- Wallets trading >$100K notional
  
  -- Price context
  avg_price DECIMAL(24, 8),             -- Average fill price this minute
  volume_weighted_price DECIMAL(24, 8), -- VWAP for this minute
  price_range_low DECIMAL(24, 8),       -- Lowest fill price
  price_range_high DECIMAL(24, 8),      -- Highest fill price
  total_volume DECIMAL(24, 2) DEFAULT 0, -- Total notional volume
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  PRIMARY KEY(coin, minute_timestamp),
  
  -- Constraint: Only track BTC, ETH, HYPE
  CONSTRAINT valid_aggregate_coins CHECK (coin IN ('BTC', 'ETH', 'HYPE'))
);

-- 4. CREATE WHALE ALERTS TABLE
CREATE TABLE IF NOT EXISTS whale_alerts (
  id BIGSERIAL PRIMARY KEY,
  
  address TEXT NOT NULL,
  coin TEXT NOT NULL,
  
  -- Alert details
  alert_type TEXT NOT NULL CHECK (alert_type IN ('NEW_WHALE', 'WHALE_ADD', 'WHALE_REDUCE', 'WHALE_CLOSE', 'WHALE_FLIP')),
  
  -- Position change details
  previous_size DECIMAL(24, 8),
  new_size DECIMAL(24, 8),
  size_delta DECIMAL(24, 8),
  notional_delta DECIMAL(24, 2),
  
  -- Context
  price DECIMAL(24, 8),
  timestamp TIMESTAMPTZ NOT NULL,
  fill_hash TEXT,
  
  -- Alert metadata
  is_processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraint: Only track BTC, ETH, HYPE
  CONSTRAINT valid_alert_coins CHECK (coin IN ('BTC', 'ETH', 'HYPE'))
);

-- =============================================================
-- CREATE INDEXES FOR PERFORMANCE
-- =============================================================

-- Fills table indexes
CREATE INDEX IF NOT EXISTS idx_fills_coin_timestamp ON fills(coin, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_fills_address_coin ON fills(address, coin);
CREATE INDEX IF NOT EXISTS idx_fills_timestamp ON fills(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_fills_direction ON fills(direction);
CREATE INDEX IF NOT EXISTS idx_fills_large ON fills(coin, abs(size)) WHERE abs(size * price) > 1000;

-- Position states indexes
CREATE INDEX IF NOT EXISTS idx_position_states_coin_size ON position_states(coin, abs(current_size) DESC) WHERE current_size != 0;
CREATE INDEX IF NOT EXISTS idx_position_states_notional ON position_states(coin, abs(current_notional) DESC) WHERE abs(current_notional) > 1000;
CREATE INDEX IF NOT EXISTS idx_position_states_updated ON position_states(last_updated DESC);

-- Minute aggregates indexes
CREATE INDEX IF NOT EXISTS idx_minute_aggregates_timestamp ON minute_aggregates(minute_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_minute_aggregates_flows ON minute_aggregates(coin, abs(net_total_flow) DESC);

-- Whale alerts indexes
CREATE INDEX IF NOT EXISTS idx_whale_alerts_unprocessed ON whale_alerts(created_at DESC) WHERE NOT is_processed;
CREATE INDEX IF NOT EXISTS idx_whale_alerts_coin_time ON whale_alerts(coin, timestamp DESC);

-- =============================================================
-- ENABLE ROW LEVEL SECURITY
-- =============================================================

-- Enable RLS on all tables
ALTER TABLE fills ENABLE ROW LEVEL SECURITY;
ALTER TABLE position_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE minute_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE whale_alerts ENABLE ROW LEVEL SECURITY;

-- Policies: Allow service role to insert, everyone to read
CREATE POLICY IF NOT EXISTS "Enable insert for fills" ON fills FOR INSERT WITH CHECK (TRUE);
CREATE POLICY IF NOT EXISTS "Enable read for fills" ON fills FOR SELECT USING (TRUE);

CREATE POLICY IF NOT EXISTS "Enable all for position_states" ON position_states FOR ALL USING (TRUE);

CREATE POLICY IF NOT EXISTS "Enable insert for minute_aggregates" ON minute_aggregates FOR INSERT WITH CHECK (TRUE);
CREATE POLICY IF NOT EXISTS "Enable read for minute_aggregates" ON minute_aggregates FOR SELECT USING (TRUE);

CREATE POLICY IF NOT EXISTS "Enable all for whale_alerts" ON whale_alerts FOR ALL USING (TRUE);

-- =============================================================
-- INSERT SAMPLE DATA FOR TESTING
-- =============================================================

-- Insert sample minute aggregates to test the table
INSERT INTO minute_aggregates (
  coin, minute_timestamp, new_longs, new_shorts, long_volume_in, short_volume_in,
  avg_price, total_volume, unique_wallets, new_wallets
) VALUES 
('BTC', date_trunc('minute', NOW() - INTERVAL '5 minutes'), 5, 3, 150000, 80000, 50000, 230000, 8, 2),
('BTC', date_trunc('minute', NOW() - INTERVAL '4 minutes'), 3, 7, 90000, 200000, 49800, 290000, 10, 1),
('BTC', date_trunc('minute', NOW() - INTERVAL '3 minutes'), 8, 2, 250000, 60000, 50200, 310000, 10, 3),
('ETH', date_trunc('minute', NOW() - INTERVAL '5 minutes'), 12, 8, 80000, 45000, 3200, 125000, 20, 5),
('ETH', date_trunc('minute', NOW() - INTERVAL '4 minutes'), 6, 15, 35000, 95000, 3180, 130000, 21, 2),
('HYPE', date_trunc('minute', NOW() - INTERVAL '5 minutes'), 20, 5, 25000, 8000, 12.5, 33000, 25, 8),
('HYPE', date_trunc('minute', NOW() - INTERVAL '4 minutes'), 15, 10, 18000, 15000, 12.8, 33000, 25, 3)
ON CONFLICT (coin, minute_timestamp) DO NOTHING;

-- =============================================================
-- VERIFICATION QUERIES
-- =============================================================

-- Check that tables were created successfully
SELECT 'Tables created successfully!' as status;

-- Check sample data
SELECT 
  coin,
  minute_timestamp,
  new_longs + new_shorts as total_new_positions,
  net_total_flow,
  unique_wallets
FROM minute_aggregates 
ORDER BY minute_timestamp DESC
LIMIT 5;

-- Show table info
SELECT 
  table_name,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public' 
AND table_name IN ('fills', 'position_states', 'minute_aggregates', 'whale_alerts')
ORDER BY table_name;