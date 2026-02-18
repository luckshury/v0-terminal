import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const supabase = createClient(supabaseUrl, supabaseKey)

interface Position {
  address: string
  size: number
  notional: number
  entry_price: number
  leverage: number
  leverage_type: number
}

interface PositionDelta {
  address: string
  size: number
  notional: number
  entryPrice: number
  leverage: number
  leverageType: string
  side: 'long' | 'short'
  changeType: 'NEW' | 'INCREASED' | 'DECREASED' | 'CLOSED'
  prevSize: number | null
  prevNotional: number | null
  sizeDelta: number
  notionalDelta: number
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { market, side, snapshotId, prevSnapshotId } = body

    if (!market || !snapshotId || !prevSnapshotId) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }

    // Fetch current snapshot positions
    let currentQuery = supabase
      .from('perp_positions')
      .select('address, size, notional, entry_price, leverage, leverage_type')
      .eq('market', market.toUpperCase())
      .eq('snapshot_id', snapshotId)

    // Filter by side
    if (side === 'long') {
      currentQuery = currentQuery.gt('size', 0)
    } else if (side === 'short') {
      currentQuery = currentQuery.lt('size', 0)
    }

    // Fetch previous snapshot positions
    let prevQuery = supabase
      .from('perp_positions')
      .select('address, size, notional, entry_price, leverage, leverage_type')
      .eq('market', market.toUpperCase())
      .eq('snapshot_id', prevSnapshotId)

    if (side === 'long') {
      prevQuery = prevQuery.gt('size', 0)
    } else if (side === 'short') {
      prevQuery = prevQuery.lt('size', 0)
    }

    const [currentResult, prevResult] = await Promise.all([currentQuery, prevQuery])

    if (currentResult.error) {
      console.error('Current snapshot error:', currentResult.error)
      return NextResponse.json({ error: currentResult.error.message }, { status: 500 })
    }

    if (prevResult.error) {
      console.error('Previous snapshot error:', prevResult.error)
      return NextResponse.json({ error: prevResult.error.message }, { status: 500 })
    }

    const currentPositions = currentResult.data || []
    const prevPositions = prevResult.data || []

    // Create lookup maps
    const currentMap = new Map<string, Position>()
    for (const pos of currentPositions) {
      currentMap.set(pos.address, pos)
    }

    const prevMap = new Map<string, Position>()
    for (const pos of prevPositions) {
      prevMap.set(pos.address, pos)
    }

    const deltas: PositionDelta[] = []

    // Find NEW and INCREASED positions (in current but not in prev, or larger in current)
    for (const [address, current] of currentMap) {
      const prev = prevMap.get(address)
      
      if (!prev) {
        // NEW position
        deltas.push({
          address,
          size: current.size,
          notional: current.notional,
          entryPrice: current.entry_price,
          leverage: current.leverage,
          leverageType: current.leverage_type === 0 ? 'cross' : 'isolated',
          side: current.size > 0 ? 'long' : 'short',
          changeType: 'NEW',
          prevSize: null,
          prevNotional: null,
          sizeDelta: current.size,
          notionalDelta: current.notional,
        })
      } else if (Math.abs(current.notional) > Math.abs(prev.notional)) {
        // INCREASED position
        deltas.push({
          address,
          size: current.size,
          notional: current.notional,
          entryPrice: current.entry_price,
          leverage: current.leverage,
          leverageType: current.leverage_type === 0 ? 'cross' : 'isolated',
          side: current.size > 0 ? 'long' : 'short',
          changeType: 'INCREASED',
          prevSize: prev.size,
          prevNotional: prev.notional,
          sizeDelta: current.size - prev.size,
          notionalDelta: current.notional - prev.notional,
        })
      } else if (Math.abs(current.notional) < Math.abs(prev.notional)) {
        // DECREASED position
        deltas.push({
          address,
          size: current.size,
          notional: current.notional,
          entryPrice: current.entry_price,
          leverage: current.leverage,
          leverageType: current.leverage_type === 0 ? 'cross' : 'isolated',
          side: current.size > 0 ? 'long' : 'short',
          changeType: 'DECREASED',
          prevSize: prev.size,
          prevNotional: prev.notional,
          sizeDelta: current.size - prev.size,
          notionalDelta: current.notional - prev.notional,
        })
      }
    }

    // Find CLOSED positions (in prev but not in current)
    for (const [address, prev] of prevMap) {
      if (!currentMap.has(address)) {
        deltas.push({
          address,
          size: 0,
          notional: 0,
          entryPrice: prev.entry_price,
          leverage: prev.leverage,
          leverageType: prev.leverage_type === 0 ? 'cross' : 'isolated',
          side: prev.size > 0 ? 'long' : 'short',
          changeType: 'CLOSED',
          prevSize: prev.size,
          prevNotional: prev.notional,
          sizeDelta: -prev.size,
          notionalDelta: -prev.notional,
        })
      }
    }

    // Sort by absolute notional delta (biggest changes first)
    deltas.sort((a, b) => Math.abs(b.notionalDelta) - Math.abs(a.notionalDelta))

    // Limit to top 100
    const limitedDeltas = deltas.slice(0, 100)

    // Calculate summary
    const newCount = deltas.filter(d => d.changeType === 'NEW').length
    const increasedCount = deltas.filter(d => d.changeType === 'INCREASED').length
    const decreasedCount = deltas.filter(d => d.changeType === 'DECREASED').length
    const closedCount = deltas.filter(d => d.changeType === 'CLOSED').length

    return NextResponse.json({
      market: market.toUpperCase(),
      side,
      snapshotId,
      prevSnapshotId,
      summary: {
        totalChanges: deltas.length,
        new: newCount,
        increased: increasedCount,
        decreased: decreasedCount,
        closed: closedCount,
        netTraderChange: newCount - closedCount,
      },
      positions: limitedDeltas,
    })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

