'use client'

import { useEffect, useState, memo, useCallback, useMemo, useRef } from 'react'
import { TrendingUp, TrendingDown, RefreshCw, ChevronDown, Search, Activity, Flame, Zap, X, ExternalLink, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const DEFAULT_COINS = ['BTC', 'ETH', 'HYPE', 'SOL', 'ARB', 'OP', 'AVAX', 'DOGE', 'LINK']
const SUPPORTED_POSITION_MARKETS = new Set(['BTC', 'ETH', 'HYPE']) // Markets with position data
const POLL_INTERVAL_MS = 60 * 1000

interface TraderSnapshot {
  timestamp: string
  snapshotId: string
  coin: string
  longCount: number
  shortCount: number
  totalTraders: number
  longShortRatio: number
  longNotional: number
  shortNotional: number
}

interface ApiResponse {
  current: TraderSnapshot | null
  history: TraderSnapshot[]
  error?: string
  totalMarketsInCache?: number
  totalSnapshots?: number
  availableCoins?: string[]
  source?: string
}

interface DeltaData {
  timestamp: string
  snapshotId: string      // Current snapshot ID
  prevSnapshotId: string  // Previous snapshot ID (for comparison)
  // Trader counts
  longDelta: number
  shortDelta: number
  totalDelta: number
  netFlow: number
  // Notional (OI-style)
  longNotionalDelta: number
  shortNotionalDelta: number
  totalNotionalDelta: number
  netNotionalFlow: number
  // Current values
  longCount: number
  shortCount: number
  totalTraders: number
  longNotional: number
  shortNotional: number
}

interface Position {
  address: string
  size: number
  notional: number
  entryPrice: number
  leverage: number
  leverageType: string
  liquidationPrice: number | null
  accountValue: number | null
  side: 'long' | 'short'
  // Delta-specific fields
  changeType?: 'NEW' | 'INCREASED' | 'DECREASED' | 'CLOSED' | 'UNCHANGED'
  prevSize?: number
  prevNotional?: number
  sizeDelta?: number
  notionalDelta?: number
}

interface PositionsModalState {
  isOpen: boolean
  side: 'long' | 'short' | null
  market: string
  isLoading: boolean
  positions: Position[]
  error: string | null
  deltaInfo?: {
    longDelta: number
    shortDelta: number
    timestamp: string
  }
}

// Format large numbers
const formatNotional = (value: number): string => {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return (value / 1_000_000_000).toFixed(2) + 'B'
  if (abs >= 1_000_000) return (value / 1_000_000).toFixed(2) + 'M'
  if (abs >= 1_000) return (value / 1_000).toFixed(1) + 'K'
  return value.toFixed(0)
}

const formatCompact = (value: number): string => {
  const abs = Math.abs(value)
  const sign = value >= 0 ? '+' : ''
  if (abs >= 1_000_000_000) return sign + (value / 1_000_000_000).toFixed(1) + 'B'
  if (abs >= 1_000_000) return sign + (value / 1_000_000).toFixed(1) + 'M'
  if (abs >= 1_000) return sign + (value / 1_000).toFixed(0) + 'K'
  return sign + value.toFixed(0)
}

export const PositionDeltaWidget = memo(function PositionDeltaWidget() {
  const dropdownRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  
  const [selectedCoin, setSelectedCoin] = useState('BTC')
  const [coinDropdownOpen, setCoinDropdownOpen] = useState(false)
  const [coinSearch, setCoinSearch] = useState('')
  const [data, setData] = useState<ApiResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Positions modal state
  const [modal, setModal] = useState<PositionsModalState>({
    isOpen: false,
    side: null,
    market: '',
    isLoading: false,
    positions: [],
    error: null,
  })

  // Fetch position deltas for modal (shows who contributed to the +/- change)
  const fetchPositionDeltas = useCallback(async (
    market: string, 
    side: 'long' | 'short',
    snapshotId: string,
    prevSnapshotId: string,
    deltaInfo: { longDelta: number, shortDelta: number, timestamp: string }
  ) => {
    setModal(prev => ({ 
      ...prev, 
      isOpen: true, 
      side, 
      market, 
      isLoading: true, 
      positions: [], 
      error: null,
      deltaInfo 
    }))
    
    try {
      const response = await fetch('/api/perp-positions/delta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market,
          side,
          snapshotId,
          prevSnapshotId,
        }),
      })
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }
      
      const result = await response.json()
      
      if (result.error) {
        throw new Error(result.error)
      }
      
      setModal(prev => ({ ...prev, isLoading: false, positions: result.positions || [] }))
    } catch (err) {
      setModal(prev => ({ 
        ...prev, 
        isLoading: false, 
        error: err instanceof Error ? err.message : 'Failed to fetch positions' 
      }))
    }
  }, [])

  const closeModal = useCallback(() => {
    setModal(prev => ({ ...prev, isOpen: false }))
  }, [])

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setCoinDropdownOpen(false)
        setCoinSearch('')
      }
    }
    
    if (coinDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [coinDropdownOpen])

  // Fetch data
  const fetchData = useCallback(async (coin: string) => {
    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch(`/api/trader-positioning?coin=${coin}&limit=48`)

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const result: ApiResponse = await response.json()

      if (result.error) {
        setError(result.error)
      }

      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData(selectedCoin)

    const interval = setInterval(() => {
      fetchData(selectedCoin)
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [selectedCoin, fetchData])

  // Calculate deltas from history
  const deltaHistory = useMemo((): DeltaData[] => {
    if (!data?.history || data.history.length < 2) return []

    const deltas: DeltaData[] = []
    
    for (let i = 1; i < data.history.length; i++) {
      const prev = data.history[i - 1]
      const curr = data.history[i]
      
      const longDelta = curr.longCount - prev.longCount
      const shortDelta = curr.shortCount - prev.shortCount
      const longNotionalDelta = curr.longNotional - prev.longNotional
      const shortNotionalDelta = curr.shortNotional - prev.shortNotional
      
      deltas.push({
        timestamp: curr.timestamp,
        snapshotId: curr.snapshotId,
        prevSnapshotId: prev.snapshotId,
        longDelta,
        shortDelta,
        totalDelta: longDelta + shortDelta,
        netFlow: longDelta - shortDelta,
        longNotionalDelta,
        shortNotionalDelta,
        totalNotionalDelta: longNotionalDelta + shortNotionalDelta,
        netNotionalFlow: longNotionalDelta - shortNotionalDelta,
        longCount: curr.longCount,
        shortCount: curr.shortCount,
        totalTraders: curr.totalTraders,
        longNotional: curr.longNotional,
        shortNotional: curr.shortNotional,
      })
    }
    
    return deltas
  }, [data?.history])

  // Summary stats for last hour
  const summary = useMemo(() => {
    if (deltaHistory.length === 0) return null

    const recent = deltaHistory.slice(-6) // Last hour (6 x 10min intervals)
    
    // Trader deltas
    const recentLongDelta = recent.reduce((sum, d) => sum + d.longDelta, 0)
    const recentShortDelta = recent.reduce((sum, d) => sum + d.shortDelta, 0)
    const recentTotalDelta = recent.reduce((sum, d) => sum + d.totalDelta, 0)
    
    // Notional deltas
    const recentLongNotional = recent.reduce((sum, d) => sum + d.longNotionalDelta, 0)
    const recentShortNotional = recent.reduce((sum, d) => sum + d.shortNotionalDelta, 0)
    const recentTotalNotional = recent.reduce((sum, d) => sum + d.totalNotionalDelta, 0)

    // Detect significant activity
    const avgTraderDelta = Math.abs(recentTotalDelta) / 6
    const isHot = Math.abs(recentTotalDelta) > 100 || Math.abs(recentTotalNotional) > 10_000_000

    return {
      recentLongDelta,
      recentShortDelta,
      recentTotalDelta,
      recentLongNotional,
      recentShortNotional,
      recentTotalNotional,
      traderBias: recentLongDelta - recentShortDelta > 0 ? 'LONG' : recentLongDelta - recentShortDelta < 0 ? 'SHORT' : 'NEUTRAL',
      notionalBias: recentLongNotional - recentShortNotional > 0 ? 'LONG' : recentLongNotional - recentShortNotional < 0 ? 'SHORT' : 'NEUTRAL',
      isHot,
      avgTraderDelta,
    }
  }, [deltaHistory])

  // Detect spikes in the timeline
  const spikeThreshold = useMemo(() => {
    if (deltaHistory.length < 3) return { traders: 50, notional: 5_000_000 }
    const avgTraders = deltaHistory.reduce((sum, d) => sum + Math.abs(d.totalDelta), 0) / deltaHistory.length
    const avgNotional = deltaHistory.reduce((sum, d) => sum + Math.abs(d.totalNotionalDelta), 0) / deltaHistory.length
    return {
      traders: Math.max(avgTraders * 2, 30),
      notional: Math.max(avgNotional * 2, 1_000_000),
    }
  }, [deltaHistory])

  const availableCoins = data?.availableCoins?.length ? data.availableCoins : DEFAULT_COINS
  
  const filteredCoins = useMemo(() => {
    if (!coinSearch.trim()) return availableCoins
    const search = coinSearch.toUpperCase().trim()
    return availableCoins.filter(coin => coin.toUpperCase().includes(search))
  }, [availableCoins, coinSearch])

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="flex flex-col bg-card border border-border rounded-sm overflow-hidden h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <Activity className="h-3.5 w-3.5 text-amber-400" />
        <h3 className="font-mono text-xs font-semibold text-foreground tracking-wide">
          Position Flow
        </h3>
        
        {summary?.isHot && (
          <div className="flex items-center gap-1 px-1.5 py-0.5 bg-orange-500/20 border border-orange-500/30 rounded-sm animate-pulse">
            <Flame className="h-3 w-3 text-orange-400" />
            <span className="text-[9px] font-mono font-bold text-orange-400">HOT</span>
          </div>
        )}
        
        <div className="flex-1" />

        {/* Coin Selector */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => {
              setCoinDropdownOpen(!coinDropdownOpen)
              if (coinDropdownOpen) setCoinSearch('')
            }}
            className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono font-medium bg-background border border-border rounded-sm hover:bg-muted transition-colors"
          >
            <span className="text-foreground">{selectedCoin}</span>
            <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", coinDropdownOpen && "rotate-180")} />
          </button>
          {coinDropdownOpen && (
            <div className="absolute top-full right-0 mt-1 z-50 min-w-[140px] bg-popover border border-border rounded-sm shadow-lg">
              <div className="p-1.5 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <input
                    type="text"
                    value={coinSearch}
                    onChange={(e) => setCoinSearch(e.target.value)}
                    placeholder="Search..."
                    className="w-full pl-6 pr-2 py-1 text-[10px] font-mono bg-background border border-border rounded-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                    autoFocus
                  />
                </div>
              </div>
              <div className="max-h-[280px] overflow-y-auto">
                {filteredCoins.length > 0 ? (
                  filteredCoins.map((coin) => (
                    <button
                      key={coin}
                      onClick={() => {
                        setSelectedCoin(coin)
                        setCoinDropdownOpen(false)
                        setCoinSearch('')
                      }}
                      className={cn(
                        "w-full px-3 py-1.5 text-left text-[10px] font-mono hover:bg-muted transition-colors",
                        selectedCoin === coin ? "bg-muted text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {coin}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-[10px] font-mono text-muted-foreground/50">
                    No coins found
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => fetchData(selectedCoin)}
          disabled={isLoading}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
        </button>
      </div>


      {/* Sticky Column Headers */}
      {deltaHistory.length > 0 && (
        <div className="grid grid-cols-[44px_1fr_1fr_1fr_32px] gap-1 px-4 py-1.5 text-[8px] font-mono text-muted-foreground/60 uppercase tracking-wider border-b border-border/50 bg-muted/20">
          <div>Time</div>
          <div className="text-center">L Traders</div>
          <div className="text-center">S Traders</div>
          <div className="text-center">OI Δ</div>
          <div></div>
        </div>
      )}

      {/* Delta Timeline */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {error && deltaHistory.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center p-4">
              <p className="text-sm text-muted-foreground mb-2">Unable to load data</p>
              <p className="text-xs text-red-400">{error}</p>
            </div>
          </div>
        ) : deltaHistory.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs font-mono text-muted-foreground">
              {isLoading ? 'Loading...' : 'Waiting for delta data...'}
            </span>
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {/* Delta Rows - most recent first */}
            {[...deltaHistory].reverse().slice(0, 20).map((delta, idx) => {
              const isRecent = idx < 3
              const isTraderSpike = Math.abs(delta.totalDelta) > spikeThreshold.traders
              const isNotionalSpike = Math.abs(delta.totalNotionalDelta) > spikeThreshold.notional
              const isSpike = isTraderSpike || isNotionalSpike
              
              // Generate tooltip message based on the data
              const getFlowDescription = () => {
                // Determine dominant trader flow
                if (delta.longDelta > 0 && delta.shortDelta > 0) {
                  if (delta.longDelta > delta.shortDelta) {
                    return 'More longs opening than shorts'
                  } else if (delta.shortDelta > delta.longDelta) {
                    return 'More shorts opening than longs'
                  } else {
                    return 'Equal longs & shorts opening'
                  }
                } else if (delta.longDelta > 0 && delta.shortDelta <= 0) {
                  return 'Longs opening, shorts closing'
                } else if (delta.shortDelta > 0 && delta.longDelta <= 0) {
                  return 'Shorts opening, longs closing'
                } else if (delta.longDelta < 0 && delta.shortDelta < 0) {
                  if (Math.abs(delta.longDelta) > Math.abs(delta.shortDelta)) {
                    return 'More longs closing than shorts'
                  } else {
                    return 'More shorts closing than longs'
                  }
                }
                return 'No change in positions'
              }

              // OI change (use longNotional since L and S are always equal)
              const oiChange = delta.longNotionalDelta
              
              return (
                <div 
                  key={delta.timestamp}
                  className={cn(
                    "grid grid-cols-[44px_1fr_1fr_1fr_32px] gap-1 px-2 py-1.5 rounded-sm transition-colors items-center",
                    isSpike ? "bg-amber-500/10 border border-amber-500/20" :
                    isRecent ? "bg-muted/40" : "hover:bg-muted/20"
                  )}
                >
                  {/* Time */}
                  <div className="text-[10px] font-mono text-muted-foreground">
                    {formatTime(delta.timestamp)}
                  </div>
                  
                  {/* Long Traders Delta - Clickable if supported market */}
                  <div className="text-center">
                    {SUPPORTED_POSITION_MARKETS.has(selectedCoin) && delta.longDelta !== 0 ? (
                      <button
                        onClick={() => fetchPositionDeltas(
                          selectedCoin, 
                          'long',
                          delta.snapshotId,
                          delta.prevSnapshotId,
                          { longDelta: delta.longDelta, shortDelta: delta.shortDelta, timestamp: delta.timestamp }
                        )}
                        className={cn(
                          "text-[10px] font-mono font-medium hover:underline cursor-pointer transition-opacity hover:opacity-80",
                          delta.longDelta > 0 ? "text-blue-400" :
                          delta.longDelta < 0 ? "text-red-400" : "text-muted-foreground/40"
                        )}
                        title={delta.longDelta > 0 ? "Click to see who opened longs" : "Click to see who closed longs"}
                      >
                        {delta.longDelta > 0 ? '+' : ''}{delta.longDelta}
                      </button>
                    ) : (
                      <span className={cn(
                        "text-[10px] font-mono font-medium",
                        delta.longDelta > 0 ? "text-blue-400" :
                        delta.longDelta < 0 ? "text-red-400" : "text-muted-foreground/40"
                      )}>
                        {delta.longDelta > 0 ? '+' : ''}{delta.longDelta}
                      </span>
                    )}
                  </div>
                  
                  {/* Short Traders Delta - Clickable if supported market */}
                  <div className="text-center">
                    {SUPPORTED_POSITION_MARKETS.has(selectedCoin) && delta.shortDelta !== 0 ? (
                      <button
                        onClick={() => fetchPositionDeltas(
                          selectedCoin, 
                          'short',
                          delta.snapshotId,
                          delta.prevSnapshotId,
                          { longDelta: delta.longDelta, shortDelta: delta.shortDelta, timestamp: delta.timestamp }
                        )}
                        className={cn(
                          "text-[10px] font-mono font-medium hover:underline cursor-pointer transition-opacity hover:opacity-80",
                          delta.shortDelta > 0 ? "text-blue-400" :
                          delta.shortDelta < 0 ? "text-red-400" : "text-muted-foreground/40"
                        )}
                        title={delta.shortDelta > 0 ? "Click to see who opened shorts" : "Click to see who closed shorts"}
                      >
                        {delta.shortDelta > 0 ? '+' : ''}{delta.shortDelta}
                      </button>
                    ) : (
                      <span className={cn(
                        "text-[10px] font-mono font-medium",
                        delta.shortDelta > 0 ? "text-blue-400" :
                        delta.shortDelta < 0 ? "text-red-400" : "text-muted-foreground/40"
                      )}>
                        {delta.shortDelta > 0 ? '+' : ''}{delta.shortDelta}
                      </span>
                    )}
                  </div>
                  
                  {/* OI Change (single column) */}
                  <div className="text-center">
                    <span className={cn(
                      "text-[10px] font-mono font-medium",
                      oiChange > 0 ? "text-amber-400" :
                      oiChange < 0 ? "text-amber-400/60" : "text-muted-foreground/40"
                    )}>
                      {formatCompact(oiChange)}
                    </span>
                  </div>
                  
                  {/* Spike/Flow Indicator with Tooltip */}
                  <div className="flex justify-center relative group">
                    {isSpike ? (
                      <Zap className="h-3 w-3 text-amber-400 cursor-help" />
                    ) : delta.totalDelta > 0 ? (
                      <TrendingUp className="h-3 w-3 text-emerald-400/60 cursor-help" />
                    ) : delta.totalDelta < 0 ? (
                      <TrendingDown className="h-3 w-3 text-red-400/60 cursor-help" />
                    ) : null}
                    
                    {/* Tooltip */}
                    {(delta.totalDelta !== 0 || isSpike) && (
                      <div className="absolute right-0 bottom-full mb-1 hidden group-hover:block z-50">
                        <div className="bg-popover border border-border rounded-sm shadow-lg px-2 py-1.5 text-[9px] font-mono text-foreground whitespace-nowrap">
                          {getFlowDescription()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer with current totals */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-muted/30 text-[9px] font-mono text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="text-emerald-400 font-medium">{data?.current?.longCount?.toLocaleString() || '—'} L</span>
          <span className="text-muted-foreground/30">|</span>
          <span className="text-red-400 font-medium">{data?.current?.shortCount?.toLocaleString() || '—'} S</span>
          <span className="text-muted-foreground/30">|</span>
          <span>OI: <span className="text-foreground font-medium">{formatNotional((data?.current?.longNotional || 0) + (data?.current?.shortNotional || 0))}</span></span>
        </div>
        <div className="text-muted-foreground/50">
          {SUPPORTED_POSITION_MARKETS.has(selectedCoin) ? 'Click L/S to view positions' : '1h data'}
        </div>
      </div>

      {/* Positions Modal */}
      {modal.isOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && closeModal()}
        >
          <div 
            ref={modalRef}
            className="bg-card border border-border rounded-lg shadow-2xl w-[90vw] max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  modal.side === 'long' ? "bg-emerald-400" : "bg-red-400"
                )} />
                <h3 className="font-mono text-sm font-semibold text-foreground">
                  {modal.market} {modal.side === 'long' ? 'Long' : 'Short'} Position Changes
                </h3>
                {modal.deltaInfo && (
                  <span className={cn(
                    "text-[10px] font-mono font-medium px-1.5 py-0.5 rounded",
                    (modal.side === 'long' ? modal.deltaInfo.longDelta : modal.deltaInfo.shortDelta) > 0 
                      ? "bg-blue-500/20 text-blue-400" 
                      : "bg-red-500/20 text-red-400"
                  )}>
                    {(modal.side === 'long' ? modal.deltaInfo.longDelta : modal.deltaInfo.shortDelta) > 0 ? '+' : ''}
                    {modal.side === 'long' ? modal.deltaInfo.longDelta : modal.deltaInfo.shortDelta} traders
                  </span>
                )}
              </div>
              <button 
                onClick={closeModal}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto">
              {modal.isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
                </div>
              ) : modal.error ? (
                <div className="flex items-center justify-center py-12">
                  <p className="text-sm text-red-400">{modal.error}</p>
                </div>
              ) : modal.positions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <p className="text-sm text-muted-foreground">No position changes found</p>
                  <p className="text-xs text-muted-foreground/60 text-center max-w-xs">
                    Position data is only available for BTC, ETH, HYPE and requires 2+ snapshots in the database. 
                    Data updates every 10 minutes.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {/* Table Header */}
                  <div className="grid grid-cols-[70px_1fr_100px_100px_60px] gap-2 px-4 py-2 text-[9px] font-mono text-muted-foreground/60 uppercase tracking-wider bg-muted/20 sticky top-0">
                    <div>Change</div>
                    <div>Wallet</div>
                    <div className="text-right">Notional</div>
                    <div className="text-right">Δ Notional</div>
                    <div className="text-right">Lev</div>
                  </div>

                  {/* Position Rows */}
                  {modal.positions.map((pos, idx) => (
                    <div 
                      key={pos.address + idx}
                      className={cn(
                        "grid grid-cols-[70px_1fr_100px_100px_60px] gap-2 px-4 py-2.5 hover:bg-muted/30 transition-colors items-center",
                        pos.changeType === 'NEW' && "bg-blue-500/5",
                        pos.changeType === 'CLOSED' && "bg-red-500/5"
                      )}
                    >
                      {/* Change Type Badge */}
                      <div>
                        <span className={cn(
                          "text-[9px] font-mono font-medium px-1.5 py-0.5 rounded",
                          pos.changeType === 'NEW' && "bg-blue-500/20 text-blue-400",
                          pos.changeType === 'INCREASED' && "bg-emerald-500/20 text-emerald-400",
                          pos.changeType === 'DECREASED' && "bg-amber-500/20 text-amber-400",
                          pos.changeType === 'CLOSED' && "bg-red-500/20 text-red-400",
                        )}>
                          {pos.changeType}
                        </span>
                      </div>
                      
                      {/* Wallet Address */}
                      <div className="flex items-center gap-2">
                        <a
                          href={`https://app.hyperliquid.xyz/explorer/address/${pos.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] font-mono text-foreground hover:text-blue-400 transition-colors flex items-center gap-1"
                        >
                          {pos.address.slice(0, 6)}...{pos.address.slice(-4)}
                          <ExternalLink className="h-3 w-3 opacity-50" />
                        </a>
                      </div>
                      
                      {/* Current Notional */}
                      <div className="text-right">
                        <span className={cn(
                          "text-[11px] font-mono font-medium",
                          pos.side === 'long' ? "text-emerald-400" : "text-red-400"
                        )}>
                          {pos.changeType === 'CLOSED' ? '—' : `$${pos.notional.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                        </span>
                      </div>
                      
                      {/* Notional Delta */}
                      <div className="text-right">
                        <span className={cn(
                          "text-[11px] font-mono font-medium",
                          (pos.notionalDelta || 0) > 0 ? "text-blue-400" : "text-red-400"
                        )}>
                          {(pos.notionalDelta || 0) > 0 ? '+' : ''}
                          ${Math.abs(pos.notionalDelta || pos.notional).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                      
                      {/* Leverage */}
                      <div className="text-right">
                        <span className="text-[10px] font-mono text-amber-400">
                          {pos.leverage}x
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-2 border-t border-border bg-muted/30 text-[9px] font-mono text-muted-foreground">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span>
                    <span className="text-blue-400">{modal.positions.filter(p => p.changeType === 'NEW').length}</span> new
                  </span>
                  <span>
                    <span className="text-emerald-400">{modal.positions.filter(p => p.changeType === 'INCREASED').length}</span> increased
                  </span>
                  <span>
                    <span className="text-amber-400">{modal.positions.filter(p => p.changeType === 'DECREASED').length}</span> decreased
                  </span>
                  <span>
                    <span className="text-red-400">{modal.positions.filter(p => p.changeType === 'CLOSED').length}</span> closed
                  </span>
                </div>
                <span className="text-muted-foreground/50">
                  Click wallet → Hyperliquid Explorer
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
