'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface LighterMarketData {
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

interface LighterStats {
  totalMarkets: number
  rising: number
  falling: number
  totalVolume: number
}

interface LighterAPIResponse {
  markets: LighterMarketData[]
  stats: LighterStats
  lastFetch: number
  connected: boolean
  error?: string
}

export function useLighterWS() {
  const [markets, setMarkets] = useState<Record<string, LighterMarketData>>({})
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<LighterStats>({
    totalMarkets: 0,
    rising: 0,
    falling: 0,
    totalVolume: 0,
  })
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch('/api/lighter-markets')
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      
      const data: LighterAPIResponse = await response.json()
      
      if (data.error) {
        throw new Error(data.error)
      }
      
      // Convert array to record
      const marketsRecord: Record<string, LighterMarketData> = {}
      data.markets.forEach(market => {
        marketsRecord[market.symbol] = market
      })
      
      setMarkets(marketsRecord)
      setStats(data.stats)
      setIsConnected(data.connected)
      setError(null)
      setIsLoading(false)
    } catch (err) {
      console.error('[LighterWS] Fetch error:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
      setIsConnected(false)
      setIsLoading(false)
    }
  }, [])

  const reconnect = useCallback(() => {
    setIsLoading(true)
    setError(null)
    fetchData()
  }, [fetchData])

  useEffect(() => {
    // Initial fetch
    fetchData()
    
    // Poll every 2 seconds
    intervalRef.current = setInterval(fetchData, 2000)
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [fetchData])

  return {
    markets,
    isConnected,
    isLoading,
    error,
    stats,
    reconnect,
  }
}
