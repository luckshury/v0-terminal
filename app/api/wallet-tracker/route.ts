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

interface CategoryData {
  count: number
  totalNotional: number
  avgNotional: number
  wallets: string[]
}

interface SideData {
  new: CategoryData
  adding: CategoryData
  reducing: CategoryData
  closed: CategoryData
}

interface WalletTrackerResponse {
  market: string
  timeframe: string
  currentSnapshotId: string | null
  previousSnapshotId: string | null
  currentTime: string | null
  previousTime: string | null
  long: SideData
  short: SideData
  summary: {
    totalNewWallets: number
    totalClosedWallets: number
    freshCapitalLong: number
    freshCapitalShort: number
    exitCapitalLong: number
    exitCapitalShort: number
    netFlowLong: number
    netFlowShort: number
    dominantSide: 'LONG' | 'SHORT' | 'NEUTRAL'
  }
}

const TIMEFRAME_CONFIG: Record<string, { hoursBack: number; label: string }> = {
  '1H': { hoursBack: 1, label: '1 Hour' },
  '4H': { hoursBack: 4, label: '4 Hours' }, 
  '24H': { hoursBack: 24, label: '24 Hours' },
}

function createEmptyCategory(): CategoryData {
  return {
    count: 0,
    totalNotional: 0,
    avgNotional: 0,
    wallets: []
  }
}

function createEmptySideData(): SideData {
  return {
    new: createEmptyCategory(),
    adding: createEmptyCategory(),
    reducing: createEmptyCategory(),
    closed: createEmptyCategory(),
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const market = (searchParams.get('market') || 'BTC').toUpperCase()
  const timeframe = searchParams.get('timeframe') || '4H'
  const minNotional = parseFloat(searchParams.get('min_notional') || '1000')
  
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

    let previousSnapshotId = prevSnapshotData?.snapshot_id
    let previousTime = prevSnapshotData?.created_at

    if (!previousSnapshotId) {
      const { data: allSnapshots } = await supabase
        .from('perp_positions')
        .select('snapshot_id, created_at')
        .eq('market', market)
        .order('created_at', { ascending: false })
        .limit(100)

      if (allSnapshots && allSnapshots.length > 0) {
        const seenSnapshots = new Set<string>()
        const uniqueSnapshots: { snapshot_id: string; created_at: string }[] = []
        
        for (const snap of allSnapshots) {
          if (!seenSnapshots.has(snap.snapshot_id)) {
            seenSnapshots.add(snap.snapshot_id)
            uniqueSnapshots.push(snap)
          }
        }

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
      return NextResponse.json({
        market,
        timeframe: config.label,
        currentSnapshotId: latestSnapshot.snapshot_id,
        previousSnapshotId: null,
        currentTime: latestSnapshot.created_at,
        previousTime: null,
        long: createEmptySideData(),
        short: createEmptySideData(),
        summary: {
          totalNewWallets: 0,
          totalClosedWallets: 0,
          freshCapitalLong: 0,
          freshCapitalShort: 0,
          exitCapitalLong: 0,
          exitCapitalShort: 0,
          netFlowLong: 0,
          netFlowShort: 0,
          dominantSide: 'NEUTRAL' as const,
        },
        message: 'Only one snapshot available - need more data for comparison',
      })
    }

    // Fetch current positions (above minimum notional threshold)
    const { data: currentPositions, error: currentError } = await supabase
      .from('perp_positions')
      .select('address, size, notional, entry_price, leverage, leverage_type')
      .eq('market', market)
      .eq('snapshot_id', latestSnapshot.snapshot_id)
      .gte('notional', minNotional)

    if (currentError) {
      throw new Error(`Failed to fetch current positions: ${currentError.message}`)
    }

    // Fetch previous positions  
    const { data: previousPositions, error: prevPosError } = await supabase
      .from('perp_positions')
      .select('address, size, notional, entry_price, leverage, leverage_type')
      .eq('market', market)
      .eq('snapshot_id', previousSnapshotId)
      .gte('notional', minNotional)

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

    // Initialize tracking
    const longData = createEmptySideData()
    const shortData = createEmptySideData()

    // Analyze current positions for NEW and ADDING/REDUCING
    for (const [address, current] of Array.from(currentMap.entries())) {
      const prev = prevMap.get(address)
      const isLong = current.size > 0
      const sideData = isLong ? longData : shortData
      const absNotional = Math.abs(current.notional)

      if (!prev) {
        // NEW wallet position
        sideData.new.count++
        sideData.new.totalNotional += absNotional
        sideData.new.wallets.push(address)
      } else {
        // Check if same side
        const wasLong = prev.size > 0
        
        if (isLong === wasLong) {
          // Same side - check if adding or reducing
          const notionalDelta = Math.abs(current.notional) - Math.abs(prev.notional)
          
          if (notionalDelta > 1) { // Small threshold to avoid noise
            // ADDING to position (conviction)
            sideData.adding.count++
            sideData.adding.totalNotional += notionalDelta
            sideData.adding.wallets.push(address)
          } else if (notionalDelta < -1) {
            // REDUCING position
            sideData.reducing.count++
            sideData.reducing.totalNotional += Math.abs(notionalDelta)
            sideData.reducing.wallets.push(address)
          }
        } else {
          // Flipped sides - treat as close + new
          const prevSideData = isLong ? shortData : longData
          prevSideData.closed.count++
          prevSideData.closed.totalNotional += Math.abs(prev.notional)
          prevSideData.closed.wallets.push(address)
          
          sideData.new.count++
          sideData.new.totalNotional += absNotional
          sideData.new.wallets.push(address)
        }
      }
    }

    // Find CLOSED positions (in prev but not in current)
    for (const [address, prev] of Array.from(prevMap.entries())) {
      if (!currentMap.has(address)) {
        const wasLong = prev.size > 0
        const sideData = wasLong ? longData : shortData
        
        sideData.closed.count++
        sideData.closed.totalNotional += Math.abs(prev.notional)
        sideData.closed.wallets.push(address)
      }
    }

    // Calculate averages
    const calculateAverage = (category: CategoryData) => {
      if (category.count > 0) {
        category.avgNotional = category.totalNotional / category.count
      }
    }

    calculateAverage(longData.new)
    calculateAverage(longData.adding)
    calculateAverage(longData.reducing)
    calculateAverage(longData.closed)
    calculateAverage(shortData.new)
    calculateAverage(shortData.adding)
    calculateAverage(shortData.reducing)
    calculateAverage(shortData.closed)

    // Calculate summary statistics
    const freshCapitalLong = longData.new.totalNotional + longData.adding.totalNotional
    const freshCapitalShort = shortData.new.totalNotional + shortData.adding.totalNotional
    const exitCapitalLong = longData.closed.totalNotional + longData.reducing.totalNotional
    const exitCapitalShort = shortData.closed.totalNotional + shortData.reducing.totalNotional
    
    const netFlowLong = freshCapitalLong - exitCapitalLong
    const netFlowShort = freshCapitalShort - exitCapitalShort
    const overallNetFlow = netFlowLong - netFlowShort

    const response: WalletTrackerResponse = {
      market,
      timeframe: config.label,
      currentSnapshotId: latestSnapshot.snapshot_id,
      previousSnapshotId,
      currentTime: latestSnapshot.created_at,
      previousTime,
      long: longData,
      short: shortData,
      summary: {
        totalNewWallets: longData.new.count + shortData.new.count,
        totalClosedWallets: longData.closed.count + shortData.closed.count,
        freshCapitalLong,
        freshCapitalShort,
        exitCapitalLong,
        exitCapitalShort,
        netFlowLong,
        netFlowShort,
        dominantSide: overallNetFlow > 0 ? 'LONG' : overallNetFlow < 0 ? 'SHORT' : 'NEUTRAL',
      },
    }

    // Limit wallet arrays to top 5 for response size (sorted by notional)
    const limitWallets = (category: CategoryData) => {
      category.wallets = category.wallets.slice(0, 5)
    }

    limitWallets(response.long.new)
    limitWallets(response.long.adding)
    limitWallets(response.long.reducing)
    limitWallets(response.long.closed)
    limitWallets(response.short.new)
    limitWallets(response.short.adding)
    limitWallets(response.short.reducing)
    limitWallets(response.short.closed)

    return NextResponse.json(response)

  } catch (error) {
    console.error('[WalletTracker] Error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Internal server error',
      market,
      timeframe,
    }, { status: 500 })
  }
}