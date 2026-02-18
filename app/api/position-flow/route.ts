import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

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

interface CategoryStats {
  count: number
  notional: number
  addresses: string[]
}

interface SideFlow {
  new: CategoryStats
  adding: CategoryStats
  reducing: CategoryStats
  closed: CategoryStats
  totalInflow: number
  totalOutflow: number
  netFlow: number
}

interface FlowResponse {
  market: string
  timeframe: string
  currentSnapshotId: string | null
  previousSnapshotId: string | null
  currentTime: string | null
  previousTime: string | null
  longs: SideFlow
  shorts: SideFlow
  summary: {
    freshCapital: number
    exits: number
    netFlow: number
    netDirection: 'LONG' | 'SHORT' | 'NEUTRAL'
    convictionScore: number // -100 to +100
    totalNewTraders: number
    totalClosedTraders: number
  }
}

// Timeframe configurations (how far back to look for previous snapshot)
const TIMEFRAME_CONFIG: Record<string, { hoursBack: number; label: string }> = {
  '1H': { hoursBack: 1, label: '1 Hour' },
  '4H': { hoursBack: 4, label: '4 Hours' },
  '24H': { hoursBack: 24, label: '24 Hours' },
}

function createEmptySideFlow(): SideFlow {
  return {
    new: { count: 0, notional: 0, addresses: [] },
    adding: { count: 0, notional: 0, addresses: [] },
    reducing: { count: 0, notional: 0, addresses: [] },
    closed: { count: 0, notional: 0, addresses: [] },
    totalInflow: 0,
    totalOutflow: 0,
    netFlow: 0,
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const market = (searchParams.get('market') || 'BTC').toUpperCase()
  const timeframe = searchParams.get('timeframe') || '4H'
  
  const config = TIMEFRAME_CONFIG[timeframe] || TIMEFRAME_CONFIG['4H']

  try {
    // Get the latest snapshot for this market
    const { data: latestSnapshot, error: latestError } = await supabase
      .from('perp_positions')
      .select('snapshot_id, created_at')
      .eq('market', market)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (latestError || !latestSnapshot) {
      return NextResponse.json({
        error: 'No snapshots found for this market',
        market,
        timeframe,
      }, { status: 404 })
    }

    // Calculate the target time for the previous snapshot
    const currentTime = new Date(latestSnapshot.created_at)
    const targetPrevTime = new Date(currentTime.getTime() - config.hoursBack * 60 * 60 * 1000)

    // Find the closest snapshot to the target previous time
    const { data: prevSnapshotData, error: prevError } = await supabase
      .from('perp_positions')
      .select('snapshot_id, created_at')
      .eq('market', market)
      .lte('created_at', targetPrevTime.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    // If no previous snapshot found, try to get the oldest available
    let previousSnapshotId = prevSnapshotData?.snapshot_id
    let previousTime = prevSnapshotData?.created_at

    if (!previousSnapshotId) {
      // Get distinct snapshots by querying and deduplicating
      const { data: allSnapshots } = await supabase
        .from('perp_positions')
        .select('snapshot_id, created_at')
        .eq('market', market)
        .order('created_at', { ascending: false })
        .limit(1000)

      if (allSnapshots && allSnapshots.length > 0) {
        // Get unique snapshots by snapshot_id
        const seenSnapshots = new Set<string>()
        const uniqueSnapshots: { snapshot_id: string; created_at: string }[] = []
        
        for (const snap of allSnapshots) {
          if (!seenSnapshots.has(snap.snapshot_id)) {
            seenSnapshots.add(snap.snapshot_id)
            uniqueSnapshots.push(snap)
          }
        }
        
        console.log(`[PositionFlow] Found ${uniqueSnapshots.length} unique snapshots for ${market}:`, 
          uniqueSnapshots.map(s => s.snapshot_id).slice(0, 5))

        // Find the first snapshot that's different from the current one
        if (uniqueSnapshots.length > 1) {
          const prevSnap = uniqueSnapshots.find(s => s.snapshot_id !== latestSnapshot.snapshot_id)
          if (prevSnap) {
            previousSnapshotId = prevSnap.snapshot_id
            previousTime = prevSnap.created_at
          }
        }
      }
    }

    if (!previousSnapshotId) {
      // Only one snapshot exists, return empty flow data
      return NextResponse.json({
        market,
        timeframe: config.label,
        currentSnapshotId: latestSnapshot.snapshot_id,
        previousSnapshotId: null,
        currentTime: latestSnapshot.created_at,
        previousTime: null,
        longs: createEmptySideFlow(),
        shorts: createEmptySideFlow(),
        summary: {
          freshCapital: 0,
          exits: 0,
          netFlow: 0,
          netDirection: 'NEUTRAL' as const,
          convictionScore: 0,
          totalNewTraders: 0,
          totalClosedTraders: 0,
        },
        message: 'Only one snapshot available - need more data for comparison',
      })
    }

    // Fetch current positions
    const { data: currentPositions, error: currentError } = await supabase
      .from('perp_positions')
      .select('address, size, notional, entry_price, leverage, leverage_type')
      .eq('market', market)
      .eq('snapshot_id', latestSnapshot.snapshot_id)

    if (currentError) {
      throw new Error(`Failed to fetch current positions: ${currentError.message}`)
    }

    // Fetch previous positions
    const { data: previousPositions, error: prevPosError } = await supabase
      .from('perp_positions')
      .select('address, size, notional, entry_price, leverage, leverage_type')
      .eq('market', market)
      .eq('snapshot_id', previousSnapshotId)

    if (prevPosError) {
      throw new Error(`Failed to fetch previous positions: ${prevPosError.message}`)
    }

    // Create lookup maps
    const currentMap = new Map<string, Position>()
    for (const pos of currentPositions || []) {
      currentMap.set(pos.address, pos)
    }

    const prevMap = new Map<string, Position>()
    for (const pos of previousPositions || []) {
      prevMap.set(pos.address, pos)
    }

    // Initialize flow tracking
    const longs = createEmptySideFlow()
    const shorts = createEmptySideFlow()

    // Analyze current positions (NEW and ADDING/REDUCING)
    for (const [address, current] of currentMap) {
      const prev = prevMap.get(address)
      const isLong = current.size > 0
      const flow = isLong ? longs : shorts

      if (!prev) {
        // NEW position
        flow.new.count++
        flow.new.notional += Math.abs(current.notional)
        flow.new.addresses.push(address)
        flow.totalInflow += Math.abs(current.notional)
      } else {
        // Check if same side
        const wasLong = prev.size > 0
        
        if (isLong === wasLong) {
          // Same side - check if adding or reducing
          const notionalDelta = Math.abs(current.notional) - Math.abs(prev.notional)
          
          if (notionalDelta > 0) {
            // ADDING to position
            flow.adding.count++
            flow.adding.notional += notionalDelta
            flow.adding.addresses.push(address)
            flow.totalInflow += notionalDelta
          } else if (notionalDelta < 0) {
            // REDUCING position
            flow.reducing.count++
            flow.reducing.notional += Math.abs(notionalDelta)
            flow.reducing.addresses.push(address)
            flow.totalOutflow += Math.abs(notionalDelta)
          }
        } else {
          // Flipped sides - treat as close + new
          const oppositeFlow = isLong ? shorts : longs
          oppositeFlow.closed.count++
          oppositeFlow.closed.notional += Math.abs(prev.notional)
          oppositeFlow.closed.addresses.push(address)
          oppositeFlow.totalOutflow += Math.abs(prev.notional)
          
          flow.new.count++
          flow.new.notional += Math.abs(current.notional)
          flow.new.addresses.push(address)
          flow.totalInflow += Math.abs(current.notional)
        }
      }
    }

    // Find CLOSED positions (in prev but not in current)
    for (const [address, prev] of prevMap) {
      if (!currentMap.has(address)) {
        const wasLong = prev.size > 0
        const flow = wasLong ? longs : shorts
        
        flow.closed.count++
        flow.closed.notional += Math.abs(prev.notional)
        flow.closed.addresses.push(address)
        flow.totalOutflow += Math.abs(prev.notional)
      }
    }

    // Calculate net flows
    longs.netFlow = longs.totalInflow - longs.totalOutflow
    shorts.netFlow = shorts.totalInflow - shorts.totalOutflow

    // Calculate summary
    const freshCapital = longs.new.notional + shorts.new.notional + 
                         longs.adding.notional + shorts.adding.notional
    const exits = longs.closed.notional + shorts.closed.notional +
                  longs.reducing.notional + shorts.reducing.notional
    
    const longNetFlow = longs.netFlow
    const shortNetFlow = shorts.netFlow
    const overallNetFlow = longNetFlow - shortNetFlow

    // Conviction score: -100 (strong short) to +100 (strong long)
    const totalFlow = Math.abs(longNetFlow) + Math.abs(shortNetFlow)
    const convictionScore = totalFlow === 0 ? 0 : 
      Math.round((overallNetFlow / totalFlow) * 100)

    const response: FlowResponse = {
      market,
      timeframe: config.label,
      currentSnapshotId: latestSnapshot.snapshot_id,
      previousSnapshotId,
      currentTime: latestSnapshot.created_at,
      previousTime,
      longs,
      shorts,
      summary: {
        freshCapital,
        exits,
        netFlow: overallNetFlow,
        netDirection: overallNetFlow > 0 ? 'LONG' : overallNetFlow < 0 ? 'SHORT' : 'NEUTRAL',
        convictionScore,
        totalNewTraders: longs.new.count + shorts.new.count,
        totalClosedTraders: longs.closed.count + shorts.closed.count,
      },
    }

    // Limit addresses array to top 10 for response size
    response.longs.new.addresses = response.longs.new.addresses.slice(0, 10)
    response.longs.adding.addresses = response.longs.adding.addresses.slice(0, 10)
    response.longs.reducing.addresses = response.longs.reducing.addresses.slice(0, 10)
    response.longs.closed.addresses = response.longs.closed.addresses.slice(0, 10)
    response.shorts.new.addresses = response.shorts.new.addresses.slice(0, 10)
    response.shorts.adding.addresses = response.shorts.adding.addresses.slice(0, 10)
    response.shorts.reducing.addresses = response.shorts.reducing.addresses.slice(0, 10)
    response.shorts.closed.addresses = response.shorts.closed.addresses.slice(0, 10)

    return NextResponse.json(response)

  } catch (error) {
    console.error('[PositionFlow] Error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Internal server error',
      market,
      timeframe,
    }, { status: 500 })
  }
}

