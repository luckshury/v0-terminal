import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null

/**
 * Kiyotaka.ai Indicator API
 * 
 * Returns trader positioning data from Hyperliquid (via Hydromancer) in a format
 * suitable for kiyotaka.ai custom data source integration.
 * 
 * This endpoint provides trader positioning metrics that can be integrated into
 * kiyotaka.ai as a custom data source, then accessed via KScript v2.
 * 
 * Query parameters:
 * - coin: Symbol (e.g., BTC, ETH, SOL) - defaults to BTC
 * - metric: Which metric to return:
 *   - longShortRatio: Ratio of longs to shorts (default)
 *   - longCount: Number of long positions
 *   - shortCount: Number of short positions
 *   - totalTraders: Total number of traders
 *   - longNotional: Total notional value of long positions
 *   - shortNotional: Total notional value of short positions
 * - limit: Number of data points (default: 1000, max: 10000)
 * - format: Response format - 'timeseries' (default) or 'json'
 * 
 * Data updates every 10 minutes (snapshot interval).
 * 
 * Integration with kiyotaka.ai:
 * 1. Contact kiyotaka.ai support to add this as a custom data source
 * 2. Provide them this endpoint URL
 * 3. Once integrated, access via custom data source function in KScript
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const coin = searchParams.get('coin')?.toUpperCase() || 'BTC'
  const metric = searchParams.get('metric') || 'longShortRatio'
  const limitParam = searchParams.get('limit')
  const format = searchParams.get('format') || 'timeseries'
  const limit = Math.min(parseInt(limitParam || '1000'), 10000)

  // Valid metrics
  const validMetrics = [
    'longShortRatio',
    'longCount',
    'shortCount',
    'totalTraders',
    'longNotional',
    'shortNotional',
  ]

  if (!validMetrics.includes(metric)) {
    return NextResponse.json({
      error: `Invalid metric. Must be one of: ${validMetrics.join(', ')}`,
    }, { status: 400 })
  }

  // Check if Supabase is configured
  if (!supabase) {
    return NextResponse.json({
      error: 'Supabase not configured',
      message: 'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables',
    }, { status: 503 })
  }

  try {
    // Get historical data for the requested coin
    const { data: history, error: historyError } = await supabase
      .from('trader_snapshots')
      .select('*')
      .eq('coin', coin)
      .order('timestamp', { ascending: false })
      .limit(limit * 2) // Get more rows to account for duplicates

    if (historyError) {
      console.error('[KiyotakaIndicator] Supabase query error:', historyError)
      return NextResponse.json({
        error: historyError.message,
      }, { status: 500 })
    }

    // Deduplicate by rounding timestamps to 10-minute intervals
    const uniqueSnapshots = new Map<string, typeof history[0]>()
    
    for (const snapshot of history || []) {
      const date = new Date(snapshot.timestamp)
      const roundedMinutes = Math.floor(date.getMinutes() / 10) * 10
      date.setMinutes(roundedMinutes, 0, 0)
      const timeKey = `${snapshot.coin}_${date.toISOString()}`
      
      if (!uniqueSnapshots.has(timeKey)) {
        uniqueSnapshots.set(timeKey, snapshot)
      }
    }
    
    // Convert back to array, sort chronologically, and limit
    const deduplicatedHistory = Array.from(uniqueSnapshots.values())
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(-limit)

    // Format response based on requested format
    if (format === 'json') {
      // Return full JSON object with all metrics
      return NextResponse.json({
        coin,
        metric,
        dataPoints: deduplicatedHistory.length,
        timeseries: deduplicatedHistory.map(h => ({
          timestamp: h.timestamp,
          longShortRatio: h.long_short_ratio,
          longCount: h.long_count,
          shortCount: h.short_count,
          totalTraders: h.total_traders,
          longNotional: h.long_notional,
          shortNotional: h.short_notional,
        })),
      })
    } else {
      // Return timeseries format optimized for kScript
      // Format: { timestamp: number, value: number }[]
      const timeseries = deduplicatedHistory.map(h => {
        let value: number
        switch (metric) {
          case 'longShortRatio':
            value = h.long_short_ratio
            break
          case 'longCount':
            value = h.long_count
            break
          case 'shortCount':
            value = h.short_count
            break
          case 'totalTraders':
            value = h.total_traders
            break
          case 'longNotional':
            value = h.long_notional
            break
          case 'shortNotional':
            value = h.short_notional
            break
          default:
            value = h.long_short_ratio
        }
        
        return {
          timestamp: new Date(h.timestamp).getTime(), // Unix timestamp in milliseconds
          value: value,
        }
      })

      // Get latest value for quick access
      const latest = timeseries.length > 0 ? timeseries[timeseries.length - 1] : null

      return NextResponse.json({
        coin,
        metric,
        latest: latest?.value || null,
        latestTimestamp: latest?.timestamp || null,
        dataPoints: timeseries.length,
        timeseries,
      })
    }

  } catch (error) {
    console.error('[KiyotakaIndicator] API error:', error)
    return NextResponse.json({
      error: 'Internal server error',
      details: String(error),
    }, { status: 500 })
  }
}
