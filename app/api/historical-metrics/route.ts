import { NextResponse } from 'next/server'
import { parseBybitCandles, calculateHistoricalMetrics, type HistoricalMetrics } from '@/lib/historical-utils'

// Cache historical metrics to avoid hammering Bybit API
const metricsCache = new Map<string, { data: HistoricalMetrics; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * GET endpoint to fetch historical metrics for symbols
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const symbolsParam = searchParams.get('symbols')
    const useCache = searchParams.get('cache') !== 'false'
    
    if (!symbolsParam) {
      return NextResponse.json({ error: 'symbols parameter required' }, { status: 400 })
    }
    
    const symbols = symbolsParam.split(',').filter(Boolean)
    const results: Record<string, HistoricalMetrics | { error: string }> = {}
    
    // Process each symbol
    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const cacheKey = `${symbol}`
          
          // Check cache
          if (useCache) {
            const cached = metricsCache.get(cacheKey)
            if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
              results[symbol] = cached.data
              return
            }
          }
          
          // Fetch different timeframes to get comprehensive data
          // We'll fetch hourly candles for the past 30 days (720 hours)
          const maxCandles = 200 // Bybit limit per request
          
          // Fetch multiple chunks if needed
          const allCandles: any[] = []
          const hoursToFetch = 720 // 30 days
          const chunks = Math.ceil(hoursToFetch / maxCandles)
          
          for (let i = 0; i < Math.min(chunks, 4); i++) {
            const endTime = Date.now() - (i * maxCandles * 60 * 60 * 1000)
            const startTime = endTime - (maxCandles * 60 * 60 * 1000)
            
            const params = new URLSearchParams({
              category: 'linear',
              symbol: symbol,
              interval: '60',
              start: startTime.toString(),
              end: endTime.toString(),
              limit: maxCandles.toString()
            })
            
            const url = `https://api.bybit.com/v5/market/kline?${params.toString()}`
            const response = await fetch(url)
            
            if (response.ok) {
              const data = await response.json()
              if (data.retCode === 0 && data.result?.list) {
                allCandles.push(...data.result.list)
              }
            }
            
            // Small delay to avoid rate limits
            if (i < chunks - 1) {
              await new Promise(resolve => setTimeout(resolve, 100))
            }
          }
          
          if (allCandles.length === 0) {
            results[symbol] = { error: 'No data available' }
            return
          }
          
          // Parse candles
          const candles = parseBybitCandles(allCandles)
          
          // Get current price from most recent candle
          const currentPrice = candles[candles.length - 1]?.close || 0
          
          // Calculate metrics
          const metrics = calculateHistoricalMetrics(currentPrice, candles)
          
          // Cache the results
          metricsCache.set(cacheKey, { data: metrics, timestamp: Date.now() })
          
          results[symbol] = metrics
          
        } catch (error) {
          console.error(`Error fetching metrics for ${symbol}:`, error)
          results[symbol] = { 
            error: error instanceof Error ? error.message : 'Unknown error' 
          }
        }
      })
    )
    
    return NextResponse.json({
      success: true,
      metrics: results,
      cached: useCache,
      timestamp: Date.now()
    })
    
  } catch (error) {
    console.error('Historical metrics API error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch historical metrics',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

/**
 * POST endpoint for batch requests
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { symbols } = body
    
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return NextResponse.json({ error: 'symbols array required' }, { status: 400 })
    }
    
    // Redirect to GET with symbols as comma-separated
    const url = new URL(request.url)
    url.searchParams.set('symbols', symbols.join(','))
    
    return GET(new Request(url.toString()))
    
  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    )
  }
}




