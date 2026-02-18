import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const coin = searchParams.get('coin')
  const minute = searchParams.get('minute') // ISO timestamp
  const type = searchParams.get('type') // 'long_in', 'short_in', 'buys', 'sells', 'all'
  const limit = parseInt(searchParams.get('limit') || '100')

  if (!coin || !minute || !type) {
    return NextResponse.json({ error: 'Missing required params: coin, minute, type' }, { status: 400 })
  }

  try {
    const minuteStart = new Date(minute)
    const minuteEnd = new Date(minuteStart.getTime() + 60000) // +1 minute

    // Build query - get ALL fills for this minute/coin first
    let query = supabase
      .from('fills')
      .select('address, coin, price, size, side, direction, timestamp, closed_pnl')
      .eq('coin', coin)
      .gte('timestamp', minuteStart.toISOString())
      .lt('timestamp', minuteEnd.toISOString())
      .order('timestamp', { ascending: false })
      .limit(limit)

    // Simple filtering by side (B=Buy, A=Sell)
    // This matches what users intuitively expect
    switch (type) {
      case 'long_in':
      case 'buys':
        // All buy-side fills (going long / closing short)
        query = query.eq('side', 'B')
        break
      case 'short_in':
      case 'sells':
        // All sell-side fills (going short / closing long)  
        query = query.eq('side', 'A')
        break
      case 'new_longs':
        query = query.eq('direction', 'Open Long')
        break
      case 'new_shorts':
        query = query.eq('direction', 'Open Short')
        break
      case 'all':
        // No filtering - show everything
        break
      default:
        // Default to all
        break
    }

    const { data, error } = await query

    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Calculate notional for each fill and aggregate by wallet
    const walletsMap = new Map<string, {
      address: string
      totalNotional: number
      buyNotional: number
      sellNotional: number
      fills: number
      avgPrice: number
      directions: string[]
      side: 'B' | 'A' | 'mixed'
      latestTimestamp: string
    }>()

    let totalBuyVolume = 0
    let totalSellVolume = 0

    for (const fill of data || []) {
      const notional = Math.abs(fill.price * fill.size)
      const isBuy = fill.side === 'B'
      
      if (isBuy) totalBuyVolume += notional
      else totalSellVolume += notional

      const existing = walletsMap.get(fill.address)
      
      if (existing) {
        existing.totalNotional += notional
        if (isBuy) existing.buyNotional += notional
        else existing.sellNotional += notional
        existing.fills += 1
        existing.avgPrice = (existing.avgPrice * (existing.fills - 1) + fill.price) / existing.fills
        if (!existing.directions.includes(fill.direction)) {
          existing.directions.push(fill.direction)
        }
        // Update side to 'mixed' if both buy and sell
        if (existing.side !== 'mixed' && existing.side !== fill.side) {
          existing.side = 'mixed'
        }
        if (fill.timestamp > existing.latestTimestamp) {
          existing.latestTimestamp = fill.timestamp
        }
      } else {
        walletsMap.set(fill.address, {
          address: fill.address,
          totalNotional: notional,
          buyNotional: isBuy ? notional : 0,
          sellNotional: isBuy ? 0 : notional,
          fills: 1,
          avgPrice: fill.price,
          directions: [fill.direction],
          side: fill.side,
          latestTimestamp: fill.timestamp
        })
      }
    }

    // Convert to array and sort by notional
    const wallets = Array.from(walletsMap.values())
      .sort((a, b) => b.totalNotional - a.totalNotional)

    return NextResponse.json({
      coin,
      minute,
      type,
      totalWallets: wallets.length,
      totalNotional: wallets.reduce((sum, w) => sum + w.totalNotional, 0),
      totalBuyVolume,
      totalSellVolume,
      wallets
    })

  } catch (err) {
    console.error('Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

