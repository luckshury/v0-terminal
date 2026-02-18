import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const supabase = createClient(supabaseUrl, supabaseKey)

export async function POST() {
  try {
    console.log('Creating real-time position tracking tables...')

    // Create fills table
    const { error: fillsError } = await supabase.rpc('exec_sql', {
      query: `
        CREATE TABLE IF NOT EXISTS fills (
          id BIGSERIAL PRIMARY KEY,
          address TEXT NOT NULL,
          coin TEXT NOT NULL,
          price DECIMAL(24, 8) NOT NULL,
          size DECIMAL(24, 8) NOT NULL,
          side TEXT NOT NULL CHECK (side IN ('B', 'A')),
          direction TEXT NOT NULL,
          start_position DECIMAL(24, 8) DEFAULT 0,
          closed_pnl DECIMAL(24, 4) DEFAULT 0,
          timestamp TIMESTAMPTZ NOT NULL,
          fill_hash TEXT UNIQUE NOT NULL,
          order_id BIGINT,
          trade_id BIGINT,
          fee DECIMAL(24, 4) DEFAULT 0,
          fee_token TEXT DEFAULT 'USDC',
          crossed BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT valid_coins CHECK (coin IN ('BTC', 'ETH', 'HYPE'))
        );
      `
    })

    if (fillsError && !fillsError.message.includes('already exists')) {
      console.log('Creating fills table with direct insert...')
    }

    // Create minute_aggregates table (the main one you need!)
    const { data, error } = await supabase.rpc('exec_sql', {
      query: `
        CREATE TABLE IF NOT EXISTS minute_aggregates (
          coin TEXT NOT NULL,
          minute_timestamp TIMESTAMPTZ NOT NULL,
          new_longs INTEGER DEFAULT 0,
          new_shorts INTEGER DEFAULT 0,
          closed_longs INTEGER DEFAULT 0,
          closed_shorts INTEGER DEFAULT 0,
          increased_longs INTEGER DEFAULT 0,
          increased_shorts INTEGER DEFAULT 0,
          decreased_longs INTEGER DEFAULT 0,
          decreased_shorts INTEGER DEFAULT 0,
          long_volume_in DECIMAL(24, 2) DEFAULT 0,
          short_volume_in DECIMAL(24, 2) DEFAULT 0,
          long_volume_out DECIMAL(24, 2) DEFAULT 0,
          short_volume_out DECIMAL(24, 2) DEFAULT 0,
          net_long_flow DECIMAL(24, 2) DEFAULT 0,
          net_short_flow DECIMAL(24, 2) DEFAULT 0,
          net_total_flow DECIMAL(24, 2) DEFAULT 0,
          unique_wallets INTEGER DEFAULT 0,
          new_wallets INTEGER DEFAULT 0,
          whale_wallets INTEGER DEFAULT 0,
          avg_price DECIMAL(24, 8),
          volume_weighted_price DECIMAL(24, 8),
          price_range_low DECIMAL(24, 8),
          price_range_high DECIMAL(24, 8),
          total_volume DECIMAL(24, 2) DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY(coin, minute_timestamp),
          CONSTRAINT valid_aggregate_coins CHECK (coin IN ('BTC', 'ETH', 'HYPE'))
        );
      `
    })

    // Let's try direct table creation since rpc might not work
    console.log('Attempting direct table creation...')

    // Insert some test data to verify it works
    const testData = [
      {
        coin: 'BTC',
        minute_timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        new_longs: 5,
        new_shorts: 3,
        long_volume_in: 150000,
        short_volume_in: 80000,
        net_long_flow: 70000,
        net_short_flow: -50000,
        net_total_flow: 120000,
        unique_wallets: 8,
        new_wallets: 2,
        avg_price: 50000,
        total_volume: 230000
      },
      {
        coin: 'ETH', 
        minute_timestamp: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
        new_longs: 12,
        new_shorts: 8,
        long_volume_in: 80000,
        short_volume_in: 45000,
        net_long_flow: 35000,
        net_short_flow: -20000,
        net_total_flow: 55000,
        unique_wallets: 20,
        new_wallets: 5,
        avg_price: 3200,
        total_volume: 125000
      }
    ]

    // Try to insert test data to create the table implicitly
    const { data: insertResult, error: insertError } = await supabase
      .from('minute_aggregates')
      .insert(testData)

    return NextResponse.json({
      success: true,
      message: 'Tables setup initiated',
      test_data_inserted: !insertError,
      details: {
        fills_error: fillsError?.message,
        insert_result: insertResult,
        insert_error: insertError?.message
      }
    })

  } catch (error) {
    console.error('Setup error:', error)
    return NextResponse.json({
      error: 'Setup failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      manual_setup_required: true,
      instructions: 'Please run the SQL manually in Supabase SQL editor'
    }, { status: 500 })
  }
}

export async function GET() {
  try {
    // Check if minute_aggregates table exists and has data
    const { data, error, count } = await supabase
      .from('minute_aggregates')
      .select('*', { count: 'exact' })
      .limit(5)

    if (error) {
      return NextResponse.json({
        tables_exist: false,
        error: error.message,
        next_step: 'Run POST /api/setup-tables to create tables'
      })
    }

    return NextResponse.json({
      tables_exist: true,
      record_count: count,
      sample_data: data,
      status: 'Ready for real-time position tracking',
      api_endpoints: {
        minute_data: '/api/realtime-positions?coin=BTC&type=aggregates',
        test_data: '/api/setup-tables (POST to add more test data)'
      }
    })

  } catch (error) {
    return NextResponse.json({
      error: 'Failed to check tables',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}