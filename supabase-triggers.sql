-- =============================================================
-- DATABASE TRIGGERS FOR AUTOMATIC AGGREGATION
-- Automatically update position_states and minute_aggregates when new fills arrive
-- =============================================================

-- =============================================================
-- 1. POSITION STATE UPDATE FUNCTION
-- Updates position_states table when new fill arrives
-- =============================================================

CREATE OR REPLACE FUNCTION update_position_state()
RETURNS TRIGGER AS $$
DECLARE
  current_pos DECIMAL(24, 8);
  new_size DECIMAL(24, 8);
  size_change DECIMAL(24, 8);
  notional_change DECIMAL(24, 2);
  is_new_position BOOLEAN := FALSE;
  is_whale_activity BOOLEAN := FALSE;
  whale_threshold DECIMAL(24, 2) := 100000; -- $100K threshold
  alert_type TEXT;
  prev_size DECIMAL(24, 8) := 0;
BEGIN
  -- Get current position size (0 if doesn't exist)
  SELECT COALESCE(current_size, 0) INTO current_pos
  FROM position_states 
  WHERE address = NEW.address AND coin = NEW.coin;
  
  -- Store previous size for alerts
  prev_size := COALESCE(current_pos, 0);
  
  -- Calculate size change from this fill
  size_change := CASE 
    WHEN NEW.side = 'B' THEN NEW.size     -- Buy = increase position
    ELSE -NEW.size                         -- Sell = decrease position  
  END;
  
  -- Calculate new position size
  new_size := COALESCE(current_pos, 0) + size_change;
  
  -- Calculate notional change
  notional_change := abs(size_change * NEW.price);
  
  -- Check if this is a new position (wallet didn't exist before)
  IF current_pos IS NULL THEN
    is_new_position := TRUE;
  END IF;
  
  -- Check if this is whale-level activity
  IF notional_change >= whale_threshold THEN
    is_whale_activity := TRUE;
  END IF;
  
  -- Upsert position state
  INSERT INTO position_states (
    address,
    coin,
    current_size,
    current_notional,
    avg_entry_price,
    realized_pnl,
    first_entry_time,
    last_updated,
    total_volume
  ) VALUES (
    NEW.address,
    NEW.coin,
    new_size,
    abs(new_size * NEW.price),
    NEW.price,
    NEW.closed_pnl,
    NEW.timestamp,
    NEW.timestamp,
    notional_change
  )
  ON CONFLICT (address, coin) DO UPDATE SET
    current_size = new_size,
    current_notional = abs(new_size * NEW.price),
    -- Update avg entry price only for position increases
    avg_entry_price = CASE 
      WHEN (position_states.current_size = 0) OR 
           (position_states.current_size > 0 AND new_size > position_states.current_size) OR
           (position_states.current_size < 0 AND new_size < position_states.current_size)
      THEN (position_states.avg_entry_price * abs(position_states.current_size) + NEW.price * abs(size_change)) / abs(new_size)
      ELSE position_states.avg_entry_price
    END,
    realized_pnl = position_states.realized_pnl + NEW.closed_pnl,
    last_updated = NEW.timestamp,
    total_volume = position_states.total_volume + notional_change;
  
  -- Generate whale alerts if necessary
  IF is_whale_activity THEN
    -- Determine alert type
    IF is_new_position AND abs(new_size) > 0 THEN
      alert_type := 'NEW_WHALE';
    ELSIF prev_size = 0 AND new_size != 0 THEN
      alert_type := 'NEW_WHALE';  
    ELSIF prev_size != 0 AND new_size = 0 THEN
      alert_type := 'WHALE_CLOSE';
    ELSIF (prev_size > 0 AND new_size < 0) OR (prev_size < 0 AND new_size > 0) THEN
      alert_type := 'WHALE_FLIP';
    ELSIF abs(new_size) > abs(prev_size) THEN
      alert_type := 'WHALE_ADD';
    ELSIF abs(new_size) < abs(prev_size) THEN  
      alert_type := 'WHALE_REDUCE';
    END IF;
    
    -- Insert whale alert
    INSERT INTO whale_alerts (
      address,
      coin,
      alert_type,
      previous_size,
      new_size,
      size_delta,
      notional_delta,
      price,
      timestamp,
      fill_hash
    ) VALUES (
      NEW.address,
      NEW.coin,
      alert_type,
      prev_size,
      new_size,
      size_change,
      notional_change,
      NEW.price,
      NEW.timestamp,
      NEW.fill_hash
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- 2. MINUTE AGGREGATION FUNCTION
-- Updates minute_aggregates table when new fill arrives
-- =============================================================

CREATE OR REPLACE FUNCTION update_minute_aggregates()
RETURNS TRIGGER AS $$
DECLARE
  minute_ts TIMESTAMPTZ;
  prev_size DECIMAL(24, 8) := 0;
  new_size DECIMAL(24, 8);
  size_change DECIMAL(24, 8);
  notional_change DECIMAL(24, 2);
  is_new_wallet BOOLEAN := FALSE;
  is_whale_wallet BOOLEAN := FALSE;
  whale_threshold DECIMAL(24, 2) := 100000;
  change_type TEXT;
BEGIN
  -- Round timestamp to minute boundary
  minute_ts := date_trunc('minute', NEW.timestamp);
  
  -- Get previous position size
  SELECT COALESCE(current_size, 0) INTO prev_size
  FROM position_states 
  WHERE address = NEW.address AND coin = NEW.coin;
  
  -- Calculate position change
  size_change := CASE 
    WHEN NEW.side = 'B' THEN NEW.size
    ELSE -NEW.size  
  END;
  
  new_size := COALESCE(prev_size, 0) + size_change;
  notional_change := abs(size_change * NEW.price);
  
  -- Check if this is a new wallet (first time we see this address for this coin)
  IF prev_size IS NULL OR prev_size = 0 THEN
    is_new_wallet := TRUE;
  END IF;
  
  -- Check if this is whale-level activity
  IF notional_change >= whale_threshold THEN
    is_whale_wallet := TRUE;
  END IF;
  
  -- Determine change type
  IF prev_size = 0 AND new_size != 0 THEN
    change_type := 'NEW';
  ELSIF prev_size != 0 AND new_size = 0 THEN
    change_type := 'CLOSE';
  ELSIF abs(new_size) > abs(prev_size) THEN
    change_type := 'INCREASE';
  ELSIF abs(new_size) < abs(prev_size) THEN
    change_type := 'DECREASE';
  ELSE
    change_type := 'UNCHANGED';
  END IF;
  
  -- Upsert minute aggregate
  INSERT INTO minute_aggregates (
    coin,
    minute_timestamp,
    
    -- Initialize counters based on this fill
    new_longs,
    new_shorts, 
    closed_longs,
    closed_shorts,
    increased_longs,
    increased_shorts,
    decreased_longs,
    decreased_shorts,
    
    -- Volume metrics
    long_volume_in,
    short_volume_in,
    long_volume_out,
    short_volume_out,
    
    -- Wallet metrics
    unique_wallets,
    new_wallets,
    whale_wallets,
    
    -- Price metrics
    avg_price,
    volume_weighted_price,
    price_range_low,
    price_range_high,
    total_volume
    
  ) VALUES (
    NEW.coin,
    minute_ts,
    
    -- Position change counters
    CASE WHEN change_type = 'NEW' AND new_size > 0 THEN 1 ELSE 0 END,
    CASE WHEN change_type = 'NEW' AND new_size < 0 THEN 1 ELSE 0 END,
    CASE WHEN change_type = 'CLOSE' AND prev_size > 0 THEN 1 ELSE 0 END,
    CASE WHEN change_type = 'CLOSE' AND prev_size < 0 THEN 1 ELSE 0 END,
    CASE WHEN change_type = 'INCREASE' AND new_size > 0 THEN 1 ELSE 0 END,
    CASE WHEN change_type = 'INCREASE' AND new_size < 0 THEN 1 ELSE 0 END,
    CASE WHEN change_type = 'DECREASE' AND new_size > 0 THEN 1 ELSE 0 END,
    CASE WHEN change_type = 'DECREASE' AND new_size < 0 THEN 1 ELSE 0 END,
    
    -- Volume flows
    CASE WHEN (change_type = 'NEW' OR change_type = 'INCREASE') AND new_size > 0 THEN notional_change ELSE 0 END,
    CASE WHEN (change_type = 'NEW' OR change_type = 'INCREASE') AND new_size < 0 THEN notional_change ELSE 0 END,
    CASE WHEN (change_type = 'CLOSE' OR change_type = 'DECREASE') AND (prev_size > 0 OR new_size > 0) THEN notional_change ELSE 0 END,
    CASE WHEN (change_type = 'CLOSE' OR change_type = 'DECREASE') AND (prev_size < 0 OR new_size < 0) THEN notional_change ELSE 0 END,
    
    -- Wallet counts
    1, -- unique_wallets (will be corrected in UPDATE)
    CASE WHEN is_new_wallet THEN 1 ELSE 0 END,
    CASE WHEN is_whale_wallet THEN 1 ELSE 0 END,
    
    -- Price data
    NEW.price,
    NEW.price, -- Will be recalculated as VWAP
    NEW.price,
    NEW.price,
    notional_change
    
  ) ON CONFLICT (coin, minute_timestamp) DO UPDATE SET
    
    -- Update position change counters
    new_longs = minute_aggregates.new_longs + 
      CASE WHEN change_type = 'NEW' AND new_size > 0 THEN 1 ELSE 0 END,
    new_shorts = minute_aggregates.new_shorts + 
      CASE WHEN change_type = 'NEW' AND new_size < 0 THEN 1 ELSE 0 END,
    closed_longs = minute_aggregates.closed_longs + 
      CASE WHEN change_type = 'CLOSE' AND prev_size > 0 THEN 1 ELSE 0 END,
    closed_shorts = minute_aggregates.closed_shorts + 
      CASE WHEN change_type = 'CLOSE' AND prev_size < 0 THEN 1 ELSE 0 END,
    increased_longs = minute_aggregates.increased_longs + 
      CASE WHEN change_type = 'INCREASE' AND new_size > 0 THEN 1 ELSE 0 END,
    increased_shorts = minute_aggregates.increased_shorts + 
      CASE WHEN change_type = 'INCREASE' AND new_size < 0 THEN 1 ELSE 0 END,
    decreased_longs = minute_aggregates.decreased_longs + 
      CASE WHEN change_type = 'DECREASE' AND new_size > 0 THEN 1 ELSE 0 END,
    decreased_shorts = minute_aggregates.decreased_shorts + 
      CASE WHEN change_type = 'DECREASE' AND new_size < 0 THEN 1 ELSE 0 END,
    
    -- Update volume flows
    long_volume_in = minute_aggregates.long_volume_in + 
      CASE WHEN (change_type = 'NEW' OR change_type = 'INCREASE') AND new_size > 0 THEN notional_change ELSE 0 END,
    short_volume_in = minute_aggregates.short_volume_in + 
      CASE WHEN (change_type = 'NEW' OR change_type = 'INCREASE') AND new_size < 0 THEN notional_change ELSE 0 END,
    long_volume_out = minute_aggregates.long_volume_out + 
      CASE WHEN (change_type = 'CLOSE' OR change_type = 'DECREASE') AND (prev_size > 0 OR new_size > 0) THEN notional_change ELSE 0 END,
    short_volume_out = minute_aggregates.short_volume_out + 
      CASE WHEN (change_type = 'CLOSE' OR change_type = 'DECREASE') AND (prev_size < 0 OR new_size < 0) THEN notional_change ELSE 0 END,
    
    -- Update wallet counts (simplified - could be more accurate with HyperLogLog)
    unique_wallets = minute_aggregates.unique_wallets + 1,
    new_wallets = minute_aggregates.new_wallets + 
      CASE WHEN is_new_wallet THEN 1 ELSE 0 END,
    whale_wallets = minute_aggregates.whale_wallets + 
      CASE WHEN is_whale_wallet THEN 1 ELSE 0 END,
    
    -- Update price metrics  
    avg_price = (minute_aggregates.avg_price * minute_aggregates.total_volume + NEW.price * notional_change) / 
      (minute_aggregates.total_volume + notional_change),
    volume_weighted_price = (minute_aggregates.volume_weighted_price * minute_aggregates.total_volume + NEW.price * notional_change) / 
      (minute_aggregates.total_volume + notional_change),
    price_range_low = LEAST(minute_aggregates.price_range_low, NEW.price),
    price_range_high = GREATEST(minute_aggregates.price_range_high, NEW.price),
    total_volume = minute_aggregates.total_volume + notional_change;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- 3. CREATE TRIGGERS
-- =============================================================

-- Trigger to update position state after each fill
DROP TRIGGER IF EXISTS trigger_update_position_state ON fills;
CREATE TRIGGER trigger_update_position_state
  AFTER INSERT ON fills
  FOR EACH ROW 
  EXECUTE FUNCTION update_position_state();

-- Trigger to update minute aggregates after each fill  
DROP TRIGGER IF EXISTS trigger_update_minute_aggregates ON fills;
CREATE TRIGGER trigger_update_minute_aggregates
  AFTER INSERT ON fills
  FOR EACH ROW 
  EXECUTE FUNCTION update_minute_aggregates();

-- =============================================================
-- 4. CLEANUP FUNCTIONS
-- =============================================================

-- Function to clean old data (run periodically)
CREATE OR REPLACE FUNCTION cleanup_old_data(days_to_keep INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
BEGIN
  -- Clean old fills (keep specified days)
  DELETE FROM fills 
  WHERE timestamp < NOW() - INTERVAL '1 day' * days_to_keep;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Clean old minute aggregates (keep more days since they're smaller)
  DELETE FROM minute_aggregates 
  WHERE minute_timestamp < NOW() - INTERVAL '1 day' * (days_to_keep * 2);
  
  -- Clean processed whale alerts older than 7 days
  DELETE FROM whale_alerts 
  WHERE created_at < NOW() - INTERVAL '7 days' 
    AND is_processed = TRUE;
  
  -- Clean position states for wallets with 0 position and no recent activity
  DELETE FROM position_states 
  WHERE current_size = 0 
    AND last_updated < NOW() - INTERVAL '1 day' * 7;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to manually recalculate position state (for corrections)
CREATE OR REPLACE FUNCTION recalculate_position_state(
  p_address TEXT, 
  p_coin TEXT
) RETURNS VOID AS $$
DECLARE
  pos_data RECORD;
BEGIN
  -- Calculate position from all fills
  SELECT INTO pos_data * FROM calculate_position_state(p_address, p_coin);
  
  -- Update or insert corrected position state
  INSERT INTO position_states (
    address, coin, current_size, current_notional, 
    avg_entry_price, realized_pnl, first_entry_time, 
    last_updated, total_volume
  ) VALUES (
    p_address, p_coin, pos_data.current_size, pos_data.current_notional,
    pos_data.avg_entry_price, pos_data.realized_pnl, pos_data.first_entry_time,
    NOW(), pos_data.total_volume
  ) ON CONFLICT (address, coin) DO UPDATE SET
    current_size = EXCLUDED.current_size,
    current_notional = EXCLUDED.current_notional,
    avg_entry_price = EXCLUDED.avg_entry_price,
    realized_pnl = EXCLUDED.realized_pnl,
    first_entry_time = EXCLUDED.first_entry_time,
    last_updated = NOW(),
    total_volume = EXCLUDED.total_volume;
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- 5. TESTING AND VERIFICATION
-- =============================================================

-- Test function to insert sample fill data
CREATE OR REPLACE FUNCTION insert_test_fill(
  p_address TEXT DEFAULT '0x742d35cc6634c0532925a3b844bc9e7595f7f2e2',
  p_coin TEXT DEFAULT 'BTC',
  p_price DECIMAL DEFAULT 50000.00,
  p_size DECIMAL DEFAULT 1.0,
  p_side TEXT DEFAULT 'B'
) RETURNS VOID AS $$
BEGIN
  INSERT INTO fills (
    address, coin, price, size, side, direction,
    start_position, closed_pnl, timestamp, fill_hash,
    order_id, trade_id
  ) VALUES (
    p_address, p_coin, p_price, p_size, p_side,
    CASE WHEN p_side = 'B' THEN 'Open Long' ELSE 'Open Short' END,
    0, 0, NOW(), 
    'test_' || extract(epoch from NOW())::TEXT || '_' || random()::TEXT,
    floor(random() * 1000000)::BIGINT,
    floor(random() * 1000000)::BIGINT
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_position_state() IS 'Automatically updates position_states and generates whale alerts when new fills arrive';
COMMENT ON FUNCTION update_minute_aggregates() IS 'Automatically aggregates position flow metrics per minute when new fills arrive';
COMMENT ON FUNCTION cleanup_old_data(INTEGER) IS 'Cleans old data to maintain database size - run periodically';

-- Example: Test the triggers
-- SELECT insert_test_fill('0xtest123', 'BTC', 50000.00, 2.0, 'B');
-- SELECT * FROM position_states WHERE address = '0xtest123';
-- SELECT * FROM minute_aggregates WHERE coin = 'BTC' ORDER BY minute_timestamp DESC LIMIT 1;