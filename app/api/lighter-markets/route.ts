import { NextRequest, NextResponse } from 'next/server'

const LIGHTER_BASE_URL = 'https://mainnet.zklighter.elliot.ai/api/v1'
const BYBIT_BASE_URL = 'https://api.bybit.com/v5/market'

interface OrderBookDetail {
  symbol: string
  market_id: number
  market_type: string
  status: string
  last_trade_price: number
  daily_trades_count: number
  daily_base_token_volume: number
  daily_quote_token_volume: number
  daily_price_change: number
  daily_price_low: number
  daily_price_high: number
  open_interest: number
}

interface LighterOrderBookDetails {
  code: number
  order_book_details: OrderBookDetail[]
}

interface MarketData {
  marketId: number
  symbol: string
  price: number
  markPrice: number
  indexPrice: number
  dailyOpen: number
  dailyChange: number
  dailyHigh: number
  dailyLow: number
  dailyVolume: number
  openInterest: number
  fundingRate: number
  lastUpdate: number
}

// Cache for daily open prices from Bybit
// Refreshed every 5 minutes since daily open only changes at midnight UTC
interface DailyOpenCache {
  open: number
  high: number
  low: number
  timestamp: number
}

let dailyOpenCache: Map<string, DailyOpenCache> = new Map()
let lastCacheUpdate = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
let isFetching = false

// Get start of today in UTC (00:00:00)
function getTodayStartUTC(): number {
  const now = new Date()
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))
  return todayStart.getTime()
}

// Map Lighter symbols to Bybit symbols
function toBybitSymbol(lighterSymbol: string): string {
  // Most symbols just need USDT appended
  // Handle special cases
  const mappings: Record<string, string> = {
    '1000BONK': 'BONKUSDT',
    '1000FLOKI': 'FLOKIUSDT',
    '1000PEPE': 'PEPEUSDT',
    '1000SHIB': 'SHIBUSDT',
    '1000TOSHI': '1000TOSHIUSDT',
    '1000RATS': '1000RATSUSDT',
    '1MBABYDOGE': '1MBABYDOGEUSDT',
  }

  if (mappings[lighterSymbol]) {
    return mappings[lighterSymbol]
  }

  return `${lighterSymbol}USDT`
}

// Fetch daily open from Bybit for multiple symbols
async function fetchBybitDailyOpens(symbols: string[]): Promise<Map<string, DailyOpenCache>> {
  const result = new Map<string, DailyOpenCache>()
  const startTimestamp = getTodayStartUTC()

  // Bybit allows batch requests via multiple symbols in tickers endpoint
  // But for klines we need individual requests - batch them in parallel with limits
  const BATCH_SIZE = 20

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE)

    const promises = batch.map(async (lighterSymbol) => {
      const bybitSymbol = toBybitSymbol(lighterSymbol)
      try {
        const response = await fetch(
          `${BYBIT_BASE_URL}/kline?category=linear&symbol=${bybitSymbol}&interval=D&start=${startTimestamp}&limit=1`,
          {
            headers: { 'Accept': 'application/json' },
            cache: 'no-store'
          }
        )

        if (!response.ok) return null

        const data = await response.json()

        if (data.retCode === 0 && data.result?.list?.[0]) {
          const candle = data.result.list[0]
          return {
            symbol: lighterSymbol,
            data: {
              open: parseFloat(candle[1]),
              high: parseFloat(candle[2]),
              low: parseFloat(candle[3]),
              timestamp: Date.now()
            }
          }
        }
        return null
      } catch {
        return null
      }
    })

    const results = await Promise.all(promises)
    results.forEach(r => {
      if (r) result.set(r.symbol, r.data)
    })

    // Small delay between batches to avoid rate limits
    if (i + BATCH_SIZE < symbols.length) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  return result
}

// Update cache in background
async function updateDailyOpenCache(symbols: string[]): Promise<void> {
  if (isFetching) return
  if (Date.now() - lastCacheUpdate < CACHE_TTL && dailyOpenCache.size > 0) return

  isFetching = true
  try {
    console.log(`[LighterAPI] Fetching daily opens for ${symbols.length} symbols from Bybit...`)
    const newCache = await fetchBybitDailyOpens(symbols)

    // Merge with existing cache (keep old values for symbols that failed)
    newCache.forEach((value, key) => {
      dailyOpenCache.set(key, value)
    })

    lastCacheUpdate = Date.now()
    console.log(`[LighterAPI] Updated daily open cache: ${newCache.size}/${symbols.length} symbols`)
  } finally {
    isFetching = false
  }
}

export async function GET(request: NextRequest) {
  try {
    // Fetch order book details from Lighter
    const response = await fetch(`${LIGHTER_BASE_URL}/orderBookDetails`, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 2 }
    })

    if (!response.ok) {
      throw new Error(`Lighter API error: ${response.status}`)
    }

    const data: LighterOrderBookDetails = await response.json()

    if (!data.order_book_details) {
      throw new Error('Invalid response from Lighter API')
    }

    // Filter to only perp markets (not spot) and active status
    const perpMarkets = data.order_book_details.filter(
      m => m.market_type === 'perp' && m.status === 'active'
    )

    // Get all symbols for cache update
    const symbols = perpMarkets.map(m => m.symbol)

    // Trigger background cache update (non-blocking)
    updateDailyOpenCache(symbols).catch(console.error)

    // Sort by symbol for stable ordering
    const sortedStats = [...perpMarkets].sort((a, b) =>
      a.symbol.localeCompare(b.symbol)
    )

    // Transform to our format with accurate daily open from Bybit
    const markets: MarketData[] = sortedStats.map((stats) => {
      const currentPrice = stats.last_trade_price
      const cached = dailyOpenCache.get(stats.symbol)

      let dailyOpen: number
      let dailyHigh: number
      let dailyLow: number
      let dailyChange: number

      if (cached && cached.open > 0) {
        // Use actual daily open from Bybit candle data
        dailyOpen = cached.open
        dailyHigh = cached.high
        dailyLow = cached.low
        // Calculate % change from actual midnight UTC open
        dailyChange = ((currentPrice - dailyOpen) / dailyOpen) * 100
      } else {
        // Fallback to Lighter's rolling 24h data if Bybit data not available
        const rolling24hChange = stats.daily_price_change || 0
        dailyOpen = rolling24hChange !== 0
          ? currentPrice / (1 + rolling24hChange / 100)
          : currentPrice
        dailyHigh = stats.daily_price_high
        dailyLow = stats.daily_price_low
        dailyChange = rolling24hChange
      }

      return {
        marketId: stats.market_id,
        symbol: stats.symbol,
        price: currentPrice,
        markPrice: currentPrice,
        indexPrice: currentPrice,
        dailyOpen,
        dailyChange,
        dailyHigh,
        dailyLow,
        dailyVolume: stats.daily_quote_token_volume,
        openInterest: stats.open_interest,
        fundingRate: 0,
        lastUpdate: Date.now(),
      }
    })

    // Count markets with accurate daily open data
    const accurateCount = markets.filter(m => dailyOpenCache.has(m.symbol)).length

    const stats = {
      totalMarkets: markets.length,
      rising: markets.filter(m => m.dailyChange > 0).length,
      falling: markets.filter(m => m.dailyChange < 0).length,
      totalVolume: markets.reduce((sum, m) => sum + (m.dailyVolume || 0), 0),
    }

    return NextResponse.json({
      markets,
      stats,
      lastFetch: Date.now(),
      connected: true,
      dataSource: accurateCount > 0 ? 'bybit_daily_open' : 'lighter_24h_rolling',
      accurateCount,
    })

  } catch (error) {
    console.error('[LighterAPI] Error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        markets: [],
        stats: { totalMarkets: 0, rising: 0, falling: 0, totalVolume: 0 },
        connected: false,
      },
      { status: 500 }
    )
  }
}
