/**
 * Historical price calculation utilities
 */

export interface Candle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface HistoricalMetrics {
  dayChange?: number      // % change from 24h ago
  weekChange?: number     // % change from 7d ago
  monthChange?: number    // % change from 30d ago
  vwapPercent?: number    // % difference from VWAP
  zScore?: number         // Z-score relative to recent prices
  rvol?: number          // Relative volume (current vs average)
  adrPercent?: number    // Average Daily Range %
  high52w?: number       // % from 52-week high
  volume24h?: number     // 24h volume
}

/**
 * Calculate percentage change between two prices
 */
export function calculatePercentChange(currentPrice: number, historicalPrice: number): number {
  if (!historicalPrice || historicalPrice === 0) return 0
  return ((currentPrice - historicalPrice) / historicalPrice) * 100
}

/**
 * Calculate VWAP (Volume Weighted Average Price) from candles
 */
export function calculateVWAP(candles: Candle[]): number {
  if (candles.length === 0) return 0
  
  let totalVolume = 0
  let totalVolumePrice = 0
  
  for (const candle of candles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3
    totalVolumePrice += typicalPrice * candle.volume
    totalVolume += candle.volume
  }
  
  return totalVolume > 0 ? totalVolumePrice / totalVolume : 0
}

/**
 * Calculate Z-Score (standard deviations from mean)
 */
export function calculateZScore(currentPrice: number, prices: number[]): number {
  if (prices.length < 2) return 0
  
  const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length
  const stdDev = Math.sqrt(variance)
  
  if (stdDev === 0) return 0
  return (currentPrice - mean) / stdDev
}

/**
 * Calculate Average Daily Range as a percentage
 */
export function calculateADR(candles: Candle[]): number {
  if (candles.length === 0) return 0
  
  const dailyRanges = candles.map(candle => {
    const range = candle.high - candle.low
    const avgPrice = (candle.high + candle.low) / 2
    return avgPrice > 0 ? (range / avgPrice) * 100 : 0
  })
  
  return dailyRanges.reduce((sum, r) => sum + r, 0) / dailyRanges.length
}

/**
 * Calculate Relative Volume (current volume vs average)
 */
export function calculateRVOL(currentVolume: number, historicalCandles: Candle[]): number {
  if (historicalCandles.length === 0) return 1
  
  const avgVolume = historicalCandles.reduce((sum, c) => sum + c.volume, 0) / historicalCandles.length
  
  return avgVolume > 0 ? currentVolume / avgVolume : 1
}

/**
 * Get the price from a specific time ago
 */
export function getPriceAtTimeAgo(candles: Candle[], hoursAgo: number, currentTime: number): number | null {
  const targetTime = currentTime - (hoursAgo * 60 * 60 * 1000)
  
  // Find the candle closest to the target time
  let closestCandle = candles[0]
  let closestDiff = Math.abs(candles[0].timestamp - targetTime)
  
  for (const candle of candles) {
    const diff = Math.abs(candle.timestamp - targetTime)
    if (diff < closestDiff) {
      closestDiff = diff
      closestCandle = candle
    }
  }
  
  return closestCandle ? closestCandle.close : null
}

/**
 * Calculate all historical metrics for a symbol
 */
export function calculateHistoricalMetrics(
  currentPrice: number,
  candles: Candle[],
  currentTime: number = Date.now()
): HistoricalMetrics {
  if (candles.length === 0) {
    return {}
  }
  
  const metrics: HistoricalMetrics = {}
  
  // Sort candles by timestamp (oldest first)
  const sortedCandles = [...candles].sort((a, b) => a.timestamp - b.timestamp)
  
  // 24h change
  const price24hAgo = getPriceAtTimeAgo(sortedCandles, 24, currentTime)
  if (price24hAgo) {
    metrics.dayChange = calculatePercentChange(currentPrice, price24hAgo)
  }
  
  // 7d change
  const price7dAgo = getPriceAtTimeAgo(sortedCandles, 24 * 7, currentTime)
  if (price7dAgo) {
    metrics.weekChange = calculatePercentChange(currentPrice, price7dAgo)
  }
  
  // 30d change
  const price30dAgo = getPriceAtTimeAgo(sortedCandles, 24 * 30, currentTime)
  if (price30dAgo) {
    metrics.monthChange = calculatePercentChange(currentPrice, price30dAgo)
  }
  
  // VWAP (using last 24h of data)
  const last24hCandles = sortedCandles.filter(
    c => c.timestamp >= currentTime - (24 * 60 * 60 * 1000)
  )
  if (last24hCandles.length > 0) {
    const vwap = calculateVWAP(last24hCandles)
    if (vwap > 0) {
      metrics.vwapPercent = calculatePercentChange(currentPrice, vwap)
    }
  }
  
  // Z-Score (using last 30 days)
  const prices = sortedCandles.slice(-30).map(c => c.close)
  if (prices.length >= 2) {
    metrics.zScore = calculateZScore(currentPrice, prices)
  }
  
  // ADR (using last 14 days)
  const last14Days = sortedCandles.slice(-14)
  if (last14Days.length > 0) {
    metrics.adrPercent = calculateADR(last14Days)
  }
  
  // 52-week high
  const last52Weeks = sortedCandles.filter(
    c => c.timestamp >= currentTime - (52 * 7 * 24 * 60 * 60 * 1000)
  )
  if (last52Weeks.length > 0) {
    const high52w = Math.max(...last52Weeks.map(c => c.high))
    if (high52w > 0) {
      metrics.high52w = calculatePercentChange(currentPrice, high52w)
    }
  }
  
  // 24h volume
  if (last24hCandles.length > 0) {
    metrics.volume24h = last24hCandles.reduce((sum, c) => sum + c.volume, 0)
  }
  
  // Relative Volume (current hour vs average)
  const latestCandle = sortedCandles[sortedCandles.length - 1]
  if (latestCandle && sortedCandles.length > 24) {
    const last24hForAvg = sortedCandles.slice(-25, -1) // Exclude current
    metrics.rvol = calculateRVOL(latestCandle.volume, last24hForAvg)
  }
  
  return metrics
}

/**
 * Parse Bybit candle data into our Candle format
 */
export function parseBybitCandles(bybitData: any[]): Candle[] {
  return bybitData.map(candle => ({
    timestamp: parseInt(candle[0]),
    open: parseFloat(candle[1]),
    high: parseFloat(candle[2]),
    low: parseFloat(candle[3]),
    close: parseFloat(candle[4]),
    volume: parseFloat(candle[5])
  }))
}




