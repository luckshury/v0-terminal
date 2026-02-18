'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const API_URL = '/api/all-fills'

export type FillSide = 'B' | 'A'

export interface HydromancerFill {
  id: string
  address: string
  symbol: string
  price: number
  size: number
  notional: number
  side: FillSide
  direction?: string
  timestamp: number
  orderId?: number
  tradeId?: number
  builder?: string
  builderFee?: number
  fee?: number
  feeToken?: string
  builderFeeToken?: string
  builderPayout?: string
  hash?: string
  startPosition?: number
  closedPnl?: number
  crossed?: boolean
  raw: Record<string, unknown>
}

export interface UseAllFillsOptions {
  limit?: number
  dex?: string
  aggregateByTime?: boolean
}

export interface UseAllFillsResult {
  fills: HydromancerFill[]
  isConnected: boolean
  lastUpdate: number | null
  totalReceived: number
  fillsPerMinute: number
  error?: string
  reconnecting: boolean
  clearFills: () => void
}

export function useAllFills(options: UseAllFillsOptions = {}): UseAllFillsResult {
  const {
    limit = 200,
    dex,
    aggregateByTime = false,
  } = options

  const [fills, setFills] = useState<HydromancerFill[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [lastUpdate, setLastUpdate] = useState<number | null>(null)
  const [totalReceived, setTotalReceived] = useState(0)
  const [fillsPerMinute, setFillsPerMinute] = useState(0)

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const fillsRef = useRef<HydromancerFill[]>([])
  const recentFillTimesRef = useRef<number[]>([])
  const limitRef = useRef(limit)
  const totalReceivedRef = useRef(0)
  const lastUpdateRef = useRef<number | null>(null)

  const clearFills = useCallback(() => {
    fillsRef.current = []
    recentFillTimesRef.current = []
    totalReceivedRef.current = 0
    lastUpdateRef.current = null
    
    setFills([])
    setFillsPerMinute(0)
    setTotalReceived(0)
    setLastUpdate(null)
  }, [])

  useEffect(() => {
    limitRef.current = limit
    fillsRef.current = fillsRef.current.slice(0, limit)
    setFills([...fillsRef.current])
  }, [limit])

  // REST API polling disabled - no longer fetching fills
  useEffect(() => {
    console.log('useAllFills: REST API polling disabled')
    setError('All-fills subscription cancelled')
    setIsConnected(false)
    setReconnecting(false)
    setFills([])
    return () => {}
  }, [limit, dex, aggregateByTime])

  return {
    fills,
    isConnected,
    lastUpdate,
    totalReceived,
    fillsPerMinute,
    error,
    reconnecting,
    clearFills,
  }
}
