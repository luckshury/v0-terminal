'use client'

import { useEffect, useState, memo, useCallback, useMemo, useRef } from 'react'
import { Maximize2, Minimize2, ChevronDown, RefreshCw, Database, Search, TrendingUp, TrendingDown, Users, UserPlus, UserMinus, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'

const DEFAULT_COINS = ['BTC', 'ETH', 'SOL', 'ARB', 'OP', 'AVAX', 'DOGE', 'LINK']
const POLL_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes

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

interface WalletTrackerData {
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
  error?: string
  message?: string
}

type Timeframe = '1H' | '4H' | '24H'

const TIMEFRAME_CONFIG: Record<Timeframe, { label: string }> = {
  '1H': { label: '1 Hour' },
  '4H': { label: '4 Hours' },
  '24H': { label: '24 Hours' },
}

export const WalletTrackerWidget = memo(function WalletTrackerWidget() {
  const dropdownRef = useRef<HTMLDivElement>(null)
  
  const [selectedCoin, setSelectedCoin] = useState('BTC')
  const [coinDropdownOpen, setCoinDropdownOpen] = useState(false)
  const [coinSearch, setCoinSearch] = useState('')
  const [data, setData] = useState<WalletTrackerData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [timeframe, setTimeframe] = useState<Timeframe>('4H')
  const [minNotional, setMinNotional] = useState(1000)

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

  // Handle escape key to close fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isExpanded) {
        setIsExpanded(false)
      }
    }
    
    if (isExpanded) {
      document.addEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'hidden'
    }
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [isExpanded])

  const toggleExpand = useCallback(() => {
    setIsExpanded(prev => !prev)
  }, [])

  // Fetch data from API
  const fetchData = useCallback(async (coin: string, tf: Timeframe, minNot: number) => {
    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch(`/api/wallet-tracker?market=${coin}&timeframe=${tf}&min_notional=${minNot}`)

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const result: WalletTrackerData = await response.json()

      if (result.error) {
        setError(result.error)
      }

      setData(result)
      setLastFetchTime(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
      console.error('[WalletTrackerWidget] Fetch error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Fetch when coin/timeframe/minNotional changes
  useEffect(() => {
    fetchData(selectedCoin, timeframe, minNotional)

    const interval = setInterval(() => {
      fetchData(selectedCoin, timeframe, minNotional)
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [selectedCoin, timeframe, minNotional, fetchData])

  // Calculate time since last update
  const getTimeSinceUpdate = () => {
    if (!lastFetchTime) return 'Never'
    const seconds = Math.floor((Date.now() - lastFetchTime.getTime()) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    return `${minutes}m ago`
  }

  // Format currency for display
  const formatCurrency = (value: number) => {
    const absValue = Math.abs(value)
    if (absValue >= 1_000_000_000) {
      return `$${(value / 1_000_000_000).toFixed(2)}B`
    } else if (absValue >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(2)}M`
    } else if (absValue >= 1_000) {
      return `$${(value / 1_000).toFixed(1)}K`
    }
    return `$${value.toFixed(0)}`
  }

  const availableCoins = DEFAULT_COINS
  
  // Filter coins based on search
  const filteredCoins = useMemo(() => {
    if (!coinSearch.trim()) return availableCoins
    const search = coinSearch.toUpperCase().trim()
    return availableCoins.filter(coin => coin.toUpperCase().includes(search))
  }, [availableCoins, coinSearch])

  // Category card component
  const CategoryCard = ({ 
    title, 
    category, 
    icon: Icon, 
    color, 
    side 
  }: { 
    title: string
    category: CategoryData
    icon: any
    color: string
    side: 'long' | 'short'
  }) => (
    <div className={cn(
      "p-3 rounded-sm border border-border bg-card/50",
      side === 'long' ? "border-l-4 border-l-emerald-500/50" : "border-l-4 border-l-red-500/50"
    )}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("h-4 w-4", color)} />
        <span className="text-xs font-mono font-medium text-foreground">{title}</span>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-mono text-muted-foreground">Count:</span>
          <span className="text-[11px] font-mono font-semibold text-foreground">{category.count.toLocaleString()}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-mono text-muted-foreground">Total:</span>
          <span className="text-[11px] font-mono font-semibold text-foreground">{formatCurrency(category.totalNotional)}</span>
        </div>
        {category.count > 0 && (
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-mono text-muted-foreground">Avg:</span>
            <span className="text-[10px] font-mono text-muted-foreground">{formatCurrency(category.avgNotional)}</span>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* Backdrop when expanded */}
      {isExpanded && (
        <div 
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm"
          onClick={toggleExpand}
        />
      )}
      <div className={cn(
        "flex flex-col bg-card border border-border rounded-sm overflow-hidden",
        isExpanded 
          ? "fixed inset-4 z-50 shadow-2xl" 
          : "h-full"
      )}>
        {/* Top Bar: Controls */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
          {/* Coin Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => {
                setCoinDropdownOpen(!coinDropdownOpen)
                if (coinDropdownOpen) setCoinSearch('')
              }}
              className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono font-medium bg-background border border-border rounded-sm hover:bg-muted transition-colors"
            >
              <span className="text-muted-foreground">Coin:</span>
              <span className="text-foreground">{selectedCoin}</span>
              <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", coinDropdownOpen && "rotate-180")} />
            </button>
            {coinDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 min-w-[140px] bg-popover border border-border rounded-sm shadow-lg">
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

          {/* Timeframe Selector */}
          <div className="flex items-center gap-1 ml-2">
            {(['1H', '4H', '24H'] as Timeframe[]).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={cn(
                  "px-2 py-0.5 text-[10px] font-mono font-medium rounded-sm transition-colors",
                  timeframe === tf
                    ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Min Notional Filter */}
          <div className="flex items-center gap-1 ml-2">
            <span className="text-[10px] font-mono text-muted-foreground">Min:</span>
            <select
              value={minNotional}
              onChange={(e) => setMinNotional(Number(e.target.value))}
              className="px-2 py-0.5 text-[10px] font-mono bg-background border border-border rounded-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value={1000}>$1K+</option>
              <option value={10000}>$10K+</option>
              <option value={50000}>$50K+</option>
              <option value={100000}>$100K+</option>
            </select>
          </div>

          <div className="flex-1" />

          {/* Status indicators */}
          <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground">
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded-sm">
              <Database className="h-2.5 w-2.5" />
              DB
            </span>
            <span className="px-1.5 py-0.5 bg-muted text-muted-foreground rounded-sm">
              {TIMEFRAME_CONFIG[timeframe].label}
            </span>
            <span>Updated: {getTimeSinceUpdate()}</span>
          </div>

          <button
            onClick={() => fetchData(selectedCoin, timeframe, minNotional)}
            disabled={isLoading}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
          </button>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <h3 className="font-mono text-xs font-semibold text-foreground tracking-wide">
            Wallet Activity Tracker
          </h3>
          <div className="flex items-center gap-3 text-[10px] font-mono">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm bg-emerald-500" />
              <span className="text-muted-foreground">Long</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm bg-red-500" />
              <span className="text-muted-foreground">Short</span>
            </div>
            <button 
              onClick={toggleExpand}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              title={isExpanded ? "Exit fullscreen" : "Expand to fullscreen"}
            >
              {isExpanded ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 p-3 overflow-auto">
          {error && !data ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center p-4">
                <p className="text-sm text-muted-foreground mb-2">Unable to load data</p>
                <p className="text-xs text-red-400">{error}</p>
                <button
                  onClick={() => fetchData(selectedCoin, timeframe, minNotional)}
                  className="mt-3 px-3 py-1.5 text-xs font-mono bg-muted hover:bg-muted/80 rounded-sm transition-colors"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : data ? (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <h4 className="text-xs font-mono font-semibold text-emerald-400 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    LONG POSITIONS
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    <CategoryCard
                      title="NEW"
                      category={data.long.new}
                      icon={UserPlus}
                      color="text-green-400"
                      side="long"
                    />
                    <CategoryCard
                      title="ADDING"
                      category={data.long.adding}
                      icon={TrendingUp}
                      color="text-emerald-400"
                      side="long"
                    />
                    <CategoryCard
                      title="REDUCING"
                      category={data.long.reducing}
                      icon={TrendingDown}
                      color="text-yellow-400"
                      side="long"
                    />
                    <CategoryCard
                      title="CLOSED"
                      category={data.long.closed}
                      icon={UserMinus}
                      color="text-red-400"
                      side="long"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-mono font-semibold text-red-400 flex items-center gap-2">
                    <TrendingDown className="h-4 w-4" />
                    SHORT POSITIONS
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    <CategoryCard
                      title="NEW"
                      category={data.short.new}
                      icon={UserPlus}
                      color="text-green-400"
                      side="short"
                    />
                    <CategoryCard
                      title="ADDING"
                      category={data.short.adding}
                      icon={TrendingUp}
                      color="text-emerald-400"
                      side="short"
                    />
                    <CategoryCard
                      title="REDUCING"
                      category={data.short.reducing}
                      icon={TrendingDown}
                      color="text-yellow-400"
                      side="short"
                    />
                    <CategoryCard
                      title="CLOSED"
                      category={data.short.closed}
                      icon={UserMinus}
                      color="text-red-400"
                      side="short"
                    />
                  </div>
                </div>
              </div>

              {/* Summary Footer */}
              <div className="border-t border-border pt-3">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground mb-1">Fresh Capital</div>
                    <div className="text-sm font-mono font-semibold text-emerald-400">
                      {formatCurrency(data.summary.freshCapitalLong + data.summary.freshCapitalShort)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground mb-1">Net Flow</div>
                    <div className={cn(
                      "text-sm font-mono font-semibold flex items-center justify-center gap-1",
                      data.summary.dominantSide === 'LONG' ? "text-emerald-400" : 
                      data.summary.dominantSide === 'SHORT' ? "text-red-400" : "text-muted-foreground"
                    )}>
                      {data.summary.dominantSide === 'LONG' && <TrendingUp className="h-3 w-3" />}
                      {data.summary.dominantSide === 'SHORT' && <TrendingDown className="h-3 w-3" />}
                      {data.summary.dominantSide === 'NEUTRAL' && <Activity className="h-3 w-3" />}
                      {data.summary.dominantSide}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground mb-1">Net Wallets</div>
                    <div className={cn(
                      "text-sm font-mono font-semibold",
                      (data.summary.totalNewWallets - data.summary.totalClosedWallets) > 0 ? "text-emerald-400" : "text-red-400"
                    )}>
                      {data.summary.totalNewWallets - data.summary.totalClosedWallets > 0 ? '+' : ''}{data.summary.totalNewWallets - data.summary.totalClosedWallets}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Watermark when no data */}
          {!data && !error && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.08]">
              <span className="font-mono text-3xl font-bold tracking-widest text-foreground">
                {isLoading ? 'LOADING' : 'NO DATA'}
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  )
})