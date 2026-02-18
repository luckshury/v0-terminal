import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const supabase = createClient(supabaseUrl, supabaseKey)

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const market = searchParams.get('market') || 'BTC'
  const side = searchParams.get('side') // 'long' | 'short' | null (both)
  const snapshotId = searchParams.get('snapshot_id') // Optional: specific snapshot
  const limit = parseInt(searchParams.get('limit') || '100')
  const minNotional = parseFloat(searchParams.get('min_notional') || '0')

  try {
    let query = supabase
      .from('perp_positions')
      .select('*')
      .eq('market', market.toUpperCase())
      .gte('notional', minNotional)
      .order('notional', { ascending: false })
      .limit(limit)

    // Filter by side (long = positive size, short = negative size)
    if (side === 'long') {
      query = query.gt('size', 0)
    } else if (side === 'short') {
      query = query.lt('size', 0)
    }

    // Filter by specific snapshot if provided
    if (snapshotId) {
      query = query.eq('snapshot_id', snapshotId)
    } else {
      // Get the latest snapshot only
      const { data: latestSnapshot } = await supabase
        .from('perp_positions')
        .select('snapshot_id')
        .eq('market', market.toUpperCase())
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (latestSnapshot) {
        query = query.eq('snapshot_id', latestSnapshot.snapshot_id)
      }
    }

    const { data, error } = await query

    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Format the response
    const positions = (data || []).map((pos: any) => ({
      address: pos.address,
      size: pos.size,
      notional: pos.notional,
      entryPrice: pos.entry_price,
      leverage: pos.leverage,
      leverageType: pos.leverage_type === 0 ? 'cross' : 'isolated',
      liquidationPrice: pos.liquidation_price,
      accountValue: pos.account_value,
      fundingPnl: pos.funding_pnl,
      side: pos.size > 0 ? 'long' : 'short',
    }))

    // Calculate summary stats
    const longs = positions.filter((p: any) => p.side === 'long')
    const shorts = positions.filter((p: any) => p.side === 'short')

    return NextResponse.json({
      market: market.toUpperCase(),
      snapshotId: data?.[0]?.snapshot_id || null,
      timestamp: data?.[0]?.created_at || null,
      summary: {
        totalPositions: positions.length,
        longCount: longs.length,
        shortCount: shorts.length,
        longNotional: longs.reduce((sum: number, p: any) => sum + p.notional, 0),
        shortNotional: shorts.reduce((sum: number, p: any) => sum + p.notional, 0),
      },
      positions,
    })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Get positions for a specific time range (for comparing snapshots)
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { market, startTime, endTime, side } = body

    let query = supabase
      .from('perp_positions')
      .select('*')
      .eq('market', (market || 'BTC').toUpperCase())
      .order('created_at', { ascending: false })
      .order('notional', { ascending: false })

    if (startTime) {
      query = query.gte('created_at', startTime)
    }
    if (endTime) {
      query = query.lte('created_at', endTime)
    }
    if (side === 'long') {
      query = query.gt('size', 0)
    } else if (side === 'short') {
      query = query.lt('size', 0)
    }

    const { data, error } = await query.limit(500)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Group by snapshot
    const snapshots: Record<string, any[]> = {}
    for (const pos of data || []) {
      if (!snapshots[pos.snapshot_id]) {
        snapshots[pos.snapshot_id] = []
      }
      snapshots[pos.snapshot_id].push({
        address: pos.address,
        size: pos.size,
        notional: pos.notional,
        entryPrice: pos.entry_price,
        side: pos.size > 0 ? 'long' : 'short',
        createdAt: pos.created_at,
      })
    }

    return NextResponse.json({
      market: (market || 'BTC').toUpperCase(),
      snapshots,
    })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

