-- =============================================================
-- REAL-TIME POSITION TRACKING SYSTEM
-- Supabase schema for tracking BTC, ETH, HYPE positions via Hydromancer allFills
-- =============================================================

-- =============================================================
-- 1. RAW FILLS TABLE
-- Stores every fill from Hydromancer allFills stream
-- =============================================================

CREATE TABLE IF NOT EXISTS fills (
  id BIGSERIAL PRIMARY KEY,
  
  -- Core fill data from Hydromancer
  address TEXT NOT NULL,
  coin TEXT NOT NULL,
  price DECIMAL(24, 8) NOT NULL,
  size DECIMAL(24, 8) NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('B', 'A')), -- B=buy, A=sell
  direction TEXT NOT NULL, -- 'Open Long', 'Close Short', 'Increase Long', etc.
  start_position DECIMAL(24, 8), -- Position before this fill
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

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_fills_coin_timestamp ON fills(coin, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_fills_address_coin ON fills(address, coin);
CREATE INDEX IF NOT EXISTS idx_fills_timestamp ON fills(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_fills_direction ON fills(direction);
CREATE INDEX IF NOT EXISTS idx_fills_size ON fills(coin, size DESC) WHERE abs(size) > 1; -- For whale queries

-- =============================================================
-- 2. POSITION STATES TABLE  
-- Current position state per wallet per coin
-- =============================================================

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

-- Indexes for position queries
CREATE INDEX IF NOT EXISTS idx_position_states_coin_size ON position_states(coin, current_size DESC) WHERE abs(current_size) > 0;
CREATE INDEX IF NOT EXISTS idx_position_states_notional ON position_states(coin, current_notional DESC) WHERE abs(current_notional) > 1000;
CREATE INDEX IF NOT EXISTS idx_position_states_updated ON position_states(last_updated DESC);

-- =============================================================
-- 3. MINUTE AGGREGATES TABLE
-- 1-minute aggregated position flow metrics per coin
-- =============================================================

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
  
  -- Net flows
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

-- Indexes for time-series queries
CREATE INDEX IF NOT EXISTS idx_minute_aggregates_timestamp ON minute_aggregates(minute_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_minute_aggregates_flows ON minute_aggregates(coin, net_total_flow DESC);

-- =============================================================
-- 4. WHALE ALERTS TABLE
-- Track significant position changes for alerts
-- =============================================================

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
  fill_hash TEXT REFERENCES fills(fill_hash),
  
  -- Alert metadata
  is_processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraint: Only track BTC, ETH, HYPE
  CONSTRAINT valid_alert_coins CHECK (coin IN ('BTC', 'ETH', 'HYPE'))
);

-- Index for alert queries
CREATE INDEX IF NOT EXISTS idx_whale_alerts_unprocessed ON whale_alerts(created_at DESC) WHERE NOT is_processed;
CREATE INDEX IF NOT EXISTS idx_whale_alerts_coin_time ON whale_alerts(coin, timestamp DESC);

-- =============================================================
-- 5. ENABLE ROW LEVEL SECURITY
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
-- 6. HELPER FUNCTIONS
-- =============================================================

-- Function to calculate position state from fills
CREATE OR REPLACE FUNCTION calculate_position_state(
  p_address TEXT,
  p_coin TEXT
) RETURNS RECORD AS $$
DECLARE
  result RECORD;
  total_size DECIMAL(24, 8) := 0;
  total_cost DECIMAL(24, 2) := 0;
  total_realized_pnl DECIMAL(24, 4) := 0;
  total_volume DECIMAL(24, 2) := 0;
  first_entry TIMESTAMPTZ;
BEGIN
  SELECT 
    COALESCE(SUM(
      CASE 
        WHEN side = 'B' THEN size  -- Buy increases position
        ELSE -size                  -- Sell decreases position
      END
    ), 0),
    COALESCE(SUM(
      CASE 
        WHEN side = 'B' THEN size * price  -- Cost of buys
        ELSE -size * price                  -- Revenue from sells  
      END
    ), 0),
    COALESCE(SUM(closed_pnl), 0),
    COALESCE(SUM(abs(size * price)), 0),
    MIN(timestamp)
  INTO total_size, total_cost, total_realized_pnl, total_volume, first_entry
  FROM fills 
  WHERE address = p_address AND coin = p_coin;
  
  SELECT 
    total_size as current_size,
    abs(total_size * (total_cost / NULLIF(total_size, 0))) as current_notional,
    CASE WHEN total_size != 0 THEN abs(total_cost / total_size) ELSE NULL END as avg_entry_price,
    total_realized_pnl as realized_pnl,
    first_entry as first_entry_time,
    total_volume
  INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to round timestamp to minute boundary  
CREATE OR REPLACE FUNCTION round_to_minute(ts TIMESTAMPTZ)
RETURNS TIMESTAMPTZ AS $$
BEGIN
  RETURN date_trunc('minute', ts);
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- 7. SAMPLE QUERIES FOR TESTING
-- =============================================================

-- Get current whale positions (>$100K)
-- SELECT * FROM position_states 
-- WHERE abs(current_notional) > 100000 
-- ORDER BY current_notional DESC;

-- Get minute flows for BTC in last hour
-- SELECT * FROM minute_aggregates 
-- WHERE coin = 'BTC' 
--   AND minute_timestamp > NOW() - INTERVAL '1 hour'
-- ORDER BY minute_timestamp DESC;

-- Get recent whale alerts
-- SELECT * FROM whale_alerts 
-- WHERE created_at > NOW() - INTERVAL '1 hour'
-- ORDER BY created_at DESC;

-- Get most active wallets by volume
-- SELECT address, coin, total_volume, current_size
-- FROM position_states 
-- WHERE total_volume > 50000
-- ORDER BY total_volume DESC;

COMMENT ON TABLE fills IS 'Raw fill data from Hydromancer allFills stream (BTC, ETH, HYPE only)';
COMMENT ON TABLE position_states IS 'Current position state per wallet per coin, calculated from fills';
COMMENT ON TABLE minute_aggregates IS '1-minute aggregated position flow metrics per coin';
COMMENT ON TABLE whale_alerts IS 'Significant position change alerts for whale tracking';