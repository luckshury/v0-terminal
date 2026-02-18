import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const supabase = createClient(supabaseUrl, supabaseKey)

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const coin = (searchParams.get('coin') || 'BTC').toUpperCase()
  const timeframe = searchParams.get('timeframe') || '1H' // 1H, 4H, 24H
  const type = searchParams.get('type') || 'aggregates' // aggregates, positions, fills

  try {
    // Check if tables exist
    const { data: tableCheck, error: tableError } = await supabase
      .from('minute_aggregates')
      .select('coin')
      .limit(1)

    if (tableError) {
      return NextResponse.json({
        error: 'Tables not found',
        message: 'Please run the SQL from create-tables.sql in your Supabase dashboard first',
        sql_file: 'create-tables.sql',
        setup_required: true
      }, { status: 404 })
    }

    // Calculate time range based on timeframe
    const timeRanges: Record<string, number> = {
      '1H': 60,   // 60 minutes
      '4H': 240,  // 4 hours
      '24H': 1440 // 24 hours
    }

    const minutesBack = timeRanges[timeframe] || 60

    switch (type) {
      case 'aggregates':
        // Get minute aggregates for the specified coin and timeframe
        const { data: aggregates, error: aggregatesError } = await supabase
          .from('minute_aggregates')
          .select('*')
          .eq('coin', coin)
          .gte('minute_timestamp', new Date(Date.now() - minutesBack * 60 * 1000).toISOString())
          .order('minute_timestamp', { ascending: false })
          .limit(minutesBack)

        if (aggregatesError) throw aggregatesError

        return NextResponse.json({
          coin,
          timeframe,
          type: 'minute_aggregates',
          data: aggregates?.reverse() || [], // Reverse to get chronological order
          count: aggregates?.length || 0,
          latest_timestamp: aggregates?.[0]?.minute_timestamp || null,
          summary: {
            total_new_longs: aggregates?.reduce((sum, a) => sum + (a.new_longs || 0), 0) || 0,
            total_new_shorts: aggregates?.reduce((sum, a) => sum + (a.new_shorts || 0), 0) || 0,
            net_flow_total: aggregates?.reduce((sum, a) => sum + (a.net_total_flow || 0), 0) || 0,
            avg_unique_wallets: aggregates?.length > 0 
              ? Math.round(aggregates.reduce((sum, a) => sum + (a.unique_wallets || 0), 0) / aggregates.length)
              : 0
          }
        })

      case 'positions':
        // Get current position states for the coin
        const { data: positions, error: positionsError } = await supabase
          .from('position_states')
          .select('*')
          .eq('coin', coin)
          .neq('current_size', 0) // Only active positions
          .order('current_notional', { ascending: false })
          .limit(100)

        if (positionsError) throw positionsError

        return NextResponse.json({
          coin,
          type: 'current_positions',
          data: positions || [],
          count: positions?.length || 0,
          summary: {
            total_positions: positions?.length || 0,
            long_positions: positions?.filter(p => p.current_size > 0).length || 0,
            short_positions: positions?.filter(p => p.current_size < 0).length || 0,
            total_notional: positions?.reduce((sum, p) => sum + Math.abs(p.current_notional || 0), 0) || 0,
            whale_positions: positions?.filter(p => Math.abs(p.current_notional || 0) > 100000).length || 0
          }
        })

      case 'fills':
        // Get recent fills for the coin
        const { data: fills, error: fillsError } = await supabase
          .from('fills')
          .select('*')
          .eq('coin', coin)
          .gte('timestamp', new Date(Date.now() - 60 * 60 * 1000).toISOString()) // Last hour
          .order('timestamp', { ascending: false })
          .limit(100)

        if (fillsError) throw fillsError

        return NextResponse.json({
          coin,
          type: 'recent_fills',
          data: fills || [],
          count: fills?.length || 0,
          summary: {
            total_fills: fills?.length || 0,
            buy_fills: fills?.filter(f => f.side === 'B').length || 0,
            sell_fills: fills?.filter(f => f.side === 'A').length || 0,
            total_volume: fills?.reduce((sum, f) => sum + Math.abs((f.price || 0) * (f.size || 0)), 0) || 0,
            large_fills: fills?.filter(f => Math.abs((f.price || 0) * (f.size || 0)) > 10000).length || 0
          }
        })

      case 'whale_alerts':
        // Get recent whale alerts
        const { data: alerts, error: alertsError } = await supabase
          .from('whale_alerts')
          .select('*')
          .eq('coin', coin)
          .gte('timestamp', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours
          .order('timestamp', { ascending: false })
          .limit(50)

        if (alertsError) throw alertsError

        return NextResponse.json({
          coin,
          type: 'whale_alerts',
          data: alerts || [],
          count: alerts?.length || 0,
          summary: {
            total_alerts: alerts?.length || 0,
            new_whale_alerts: alerts?.filter(a => a.alert_type === 'NEW_WHALE').length || 0,
            whale_add_alerts: alerts?.filter(a => a.alert_type === 'WHALE_ADD').length || 0,
            whale_close_alerts: alerts?.filter(a => a.alert_type === 'WHALE_CLOSE').length || 0
          }
        })

      default:
        // Return overview of all data types
        const [aggregatesRes, positionsRes, fillsRes, alertsRes] = await Promise.all([
          supabase.from('minute_aggregates').select('*', { count: 'exact', head: true }).eq('coin', coin),
          supabase.from('position_states').select('*', { count: 'exact', head: true }).eq('coin', coin),
          supabase.from('fills').select('*', { count: 'exact', head: true }).eq('coin', coin),
          supabase.from('whale_alerts').select('*', { count: 'exact', head: true }).eq('coin', coin)
        ])

        // Get latest minute aggregate for summary
        const { data: latestAggregate } = await supabase
          .from('minute_aggregates')
          .select('*')
          .eq('coin', coin)
          .order('minute_timestamp', { ascending: false })
          .limit(1)
          .single()

        return NextResponse.json({
          coin,
          type: 'overview',
          setup_complete: true,
          record_counts: {
            minute_aggregates: aggregatesRes.count || 0,
            position_states: positionsRes.count || 0,
            fills: fillsRes.count || 0,
            whale_alerts: alertsRes.count || 0
          },
          latest_data: latestAggregate || null,
          available_endpoints: [
            `/api/realtime-positions?coin=${coin}&type=aggregates&timeframe=1H`,
            `/api/realtime-positions?coin=${coin}&type=positions`,
            `/api/realtime-positions?coin=${coin}&type=fills`,
            `/api/realtime-positions?coin=${coin}&type=whale_alerts`
          ]
        })
    }

  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
      coin,
      type
    }, { status: 500 })
  }
}

// POST endpoint to manually insert test data
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { coin = 'BTC', action = 'insert_test_data' } = body

    if (action === 'insert_test_data') {
      // Insert test minute aggregate data
      const testData = []
      const now = Date.now()
      
      for (let i = 10; i >= 0; i--) {
        const minuteTimestamp = new Date(now - i * 60 * 1000)
        minuteTimestamp.setSeconds(0, 0) // Round to minute boundary
        
        testData.push({
          coin,
          minute_timestamp: minuteTimestamp.toISOString(),
          new_longs: Math.floor(Math.random() * 10) + 1,
          new_shorts: Math.floor(Math.random() * 10) + 1,
          increased_longs: Math.floor(Math.random() * 15),
          increased_shorts: Math.floor(Math.random() * 15),
          decreased_longs: Math.floor(Math.random() * 8),
          decreased_shorts: Math.floor(Math.random() * 8),
          closed_longs: Math.floor(Math.random() * 5),
          closed_shorts: Math.floor(Math.random() * 5),
          long_volume_in: Math.random() * 500000 + 50000,
          short_volume_in: Math.random() * 500000 + 50000,
          long_volume_out: Math.random() * 300000 + 20000,
          short_volume_out: Math.random() * 300000 + 20000,
          unique_wallets: Math.floor(Math.random() * 50) + 10,
          new_wallets: Math.floor(Math.random() * 10),
          whale_wallets: Math.floor(Math.random() * 5),
          avg_price: coin === 'BTC' ? 50000 + Math.random() * 2000 - 1000 :
                     coin === 'ETH' ? 3200 + Math.random() * 200 - 100 :
                     12.5 + Math.random() * 2 - 1, // HYPE
          total_volume: Math.random() * 1000000 + 100000
        })
      }

      const { data, error } = await supabase
        .from('minute_aggregates')
        .upsert(testData, { 
          onConflict: 'coin,minute_timestamp',
          ignoreDuplicates: false 
        })

      if (error) throw error

      return NextResponse.json({
        success: true,
        message: `Inserted ${testData.length} test records for ${coin}`,
        data: testData
      })
    }

    return NextResponse.json({
      error: 'Invalid action',
      available_actions: ['insert_test_data']
    }, { status: 400 })

  } catch (error) {
    console.error('POST error:', error)
    return NextResponse.json({
      error: 'Failed to insert test data',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}