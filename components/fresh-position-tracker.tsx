'use client'

import { useEffect, useState, memo, useCallback, useMemo, useRef } from 'react'
import { 
  Maximize2, 
  Minimize2, 
  ChevronDown, 
  RefreshCw, 
  Search,
  TrendingUp,
  TrendingDown,
  Plus,
  Minus,
  X,
  Sparkles
} from 'lucide-react'
import { cn } from '@/lib/utils'

const DEFAULT_COINS = ['BTC', 'ETH', 'SOL', 'HYPE', 'ARB', 'OP', 'AVAX', 'DOGE', 'LINK']
const POLL_INTERVAL_MS = 60 * 1000 // 1 minute polling

type Timeframe = '1H' | '4H' | '24H'

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
    convictionScore: number
    totalNewTraders: number
    totalClosedTraders: number
  }
  message?: string
  error?: string
}

const formatNotional = (value: number): string => {
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

interface FlowCategoryRowProps {
  icon: React.ReactNode
  label: string
  count: number
  notional: number
  type: 'inflow' | 'outflow'
  highlight?: boolean
}

const FlowCategoryRow = memo(function FlowCategoryRow({ 
  icon, 
  label, 
  count, 
  notional, 
  type,
  highlight 
}: FlowCategoryRowProps) {
  const isInflow = type === 'inflow'
  
  return (
    <div className={cn(
      "flex items-center justify-between py-1.5 px-2 rounded-sm transition-colors",
      highlight && (isInflow ? "bg-emerald-500/10" : "bg-red-500/10")
    )}>
      <div className="flex items-center gap-2">
        <span className={cn(
          "flex items-center justify-center w-4 h-4",
          isInflow ? "text-emerald-400" : "text-red-400"
        )}>
          {icon}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-mono text-foreground/70 tabular-nums">
          {count}
        </span>
        <span className={cn(
          "text-[11px] font-mono font-semibold tabular-nums min-w-[70px] text-right",
          isInflow ? "text-emerald-400" : "text-red-400"
        )}>
          {isInflow ? '+' : '-'}{formatNotional(Math.abs(notional))}
        </span>
      </div>
    </div>
  )
})

interface SideFlowCardProps {
  title: string
  flow: SideFlow
  isLong: boolean
}

const SideFlowCard = memo(function SideFlowCard({ title, flow, isLong }: SideFlowCardProps) {
  const accentColor = isLong ? 'emerald' : 'red'
  const hasData = flow.new.count > 0 || flow.adding.count > 0 || 
                  flow.reducing.count > 0 || flow.closed.count > 0

  return (
    <div className={cn(
      "flex-1 rounded-sm border bg-card/50",
      isLong ? "border-emerald-500/20" : "border-red-500/20"
    )}>
      {/* Header */}
      <div className={cn(
        "flex items-center justify-between px-3 py-2 border-b",
        isLong ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"
      )}>
        <div className="flex items-center gap-2">
          {isLong ? (
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5 text-red-400" />
          )}
          <span className={cn(
            "text-[11px] font-mono font-bold uppercase tracking-wider",
            isLong ? "text-emerald-400" : "text-red-400"
          )}>
            {title}
          </span>
        </div>
        <span className={cn(
          "text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-sm",
          flow.netFlow >= 0 
            ? "bg-emerald-500/20 text-emerald-400" 
            : "bg-red-500/20 text-red-400"
        )}>
          {flow.netFlow >= 0 ? '+' : ''}{formatNotional(flow.netFlow)}
        </span>
      </div>

      {/* Categories */}
      <div className="p-1.5 space-y-0.5">
        {hasData ? (
          <>
            <FlowCategoryRow
              icon={<Sparkles className="h-3 w-3" />}
              label="New"
              count={flow.new.count}
              notional={flow.new.notional}
              type="inflow"
              highlight={flow.new.count > 0}
            />
            <FlowCategoryRow
              icon={<Plus className="h-3 w-3" />}
              label="Adding"
              count={flow.adding.count}
              notional={flow.adding.notional}
              type="inflow"
              highlight={flow.adding.count > 0}
            />
            <FlowCategoryRow
              icon={<Minus className="h-3 w-3" />}
              label="Reducing"
              count={flow.reducing.count}
              notional={flow.reducing.notional}
              type="outflow"
            />
            <FlowCategoryRow
              icon={<X className="h-3 w-3" />}
              label="Closed"
              count={flow.closed.count}
              notional={flow.closed.notional}
              type="outflow"
            />
          </>
        ) : (
          <div className="flex items-center justify-center py-4 text-[10px] font-mono text-muted-foreground/50">
            No activity
          </div>
        )}
      </div>
    </div>
  )
})

interface ConvictionMeterProps {
  score: number // -100 to +100
  direction: 'LONG' | 'SHORT' | 'NEUTRAL'
}

const ConvictionMeter = memo(function ConvictionMeter({ score, direction }: ConvictionMeterProps) {
  // Normalize score to 0-100 for display (center = 50)
  const normalizedScore = Math.min(100, Math.max(0, 50 + score / 2))
  
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
        Conviction
      </span>
      <div className="flex-1 relative h-2 bg-muted rounded-full overflow-hidden">
        {/* Center marker */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border z-10" />
        
        {/* Fill from center */}
        {score !== 0 && (
          <div 
            className={cn(
              "absolute top-0 bottom-0 transition-all duration-300",
              score > 0 
                ? "left-1/2 bg-gradient-to-r from-emerald-500/50 to-emerald-400" 
                : "right-1/2 bg-gradient-to-l from-red-500/50 to-red-400"
            )}
            style={{ 
              width: `${Math.abs(score) / 2}%`,
            }}
          />
        )}
      </div>
      <span className={cn(
        "text-[11px] font-mono font-bold min-w-[80px] text-right",
        direction === 'LONG' && "text-emerald-400",
        direction === 'SHORT' && "text-red-400",
        direction === 'NEUTRAL' && "text-muted-foreground"
      )}>
        {direction === 'NEUTRAL' ? 'NEUTRAL' : `${direction} ${Math.abs(score)}%`}
      </span>
    </div>
  )
})

export const FreshPositionTracker = memo(function FreshPositionTracker() {
  const dropdownRef = useRef<HTMLDivElement>(null)
  
  const [selectedCoin, setSelectedCoin] = useState('BTC')
  const [coinDropdownOpen, setCoinDropdownOpen] = useState(false)
  const [coinSearch, setCoinSearch] = useState('')
  const [data, setData] = useState<FlowResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [timeframe, setTimeframe] = useState<Timeframe>('4H')
  const [availableCoins, setAvailableCoins] = useState<string[]>(DEFAULT_COINS)

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

  // Fetch position flow data
  const fetchData = useCallback(async (coin: string, tf: Timeframe) => {
    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch(`/api/position-flow?market=${coin}&timeframe=${tf}`)

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const result: FlowResponse = await response.json()

      if (result.error) {
        setError(result.error)
      }

      setData(result)
      setLastFetchTime(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
      console.error('[FreshPositionTracker] Fetch error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Fetch available coins from trader-positioning API
  useEffect(() => {
    const fetchCoins = async () => {
      try {
        const response = await fetch('/api/trader-positioning?coin=BTC&limit=1')
        if (response.ok) {
          const data = await response.json()
          if (data.availableCoins?.length > 0) {
            setAvailableCoins(data.availableCoins)
          }
        }
      } catch (e) {
        // Silently fail, use defaults
      }
    }
    fetchCoins()
  }, [])

  // Fetch when coin or timeframe changes
  useEffect(() => {
    fetchData(selectedCoin, timeframe)

    const interval = setInterval(() => {
      fetchData(selectedCoin, timeframe)
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [selectedCoin, timeframe, fetchData])

  // Calculate time since last update
  const getTimeSinceUpdate = () => {
    if (!lastFetchTime) return 'Never'
    const seconds = Math.floor((Date.now() - lastFetchTime.getTime()) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    return `${minutes}m ago`
  }

  // Filter coins based on search
  const filteredCoins = useMemo(() => {
    if (!coinSearch.trim()) return availableCoins
    const search = coinSearch.toUpperCase().trim()
    return availableCoins.filter(coin => coin.toUpperCase().includes(search))
  }, [availableCoins, coinSearch])

  const hasData = data && !data.error && (
    data.longs.new.count > 0 || data.longs.adding.count > 0 ||
    data.longs.reducing.count > 0 || data.longs.closed.count > 0 ||
    data.shorts.new.count > 0 || data.shorts.adding.count > 0 ||
    data.shorts.reducing.count > 0 || data.shorts.closed.count > 0
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
        {/* Top Bar: Coin Selector & Timeframe */}
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
              <span className="text-muted-foreground">Market:</span>
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
                <div className="px-2 py-1 border-t border-border text-[9px] font-mono text-muted-foreground/50">
                  {filteredCoins.length} of {availableCoins.length} markets
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
                    ? "bg-primary/20 text-primary border border-primary/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Status indicators */}
          <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground">
            {data?.currentTime && (
              <span className="px-1.5 py-0.5 bg-muted text-muted-foreground rounded-sm">
                {new Date(data.currentTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <span>Updated: {getTimeSinceUpdate()}</span>
          </div>

          <button
            onClick={() => fetchData(selectedCoin, timeframe)}
            disabled={isLoading}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
          </button>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <h3 className="font-mono text-xs font-semibold text-foreground tracking-wide">
              Fresh Position Tracker
            </h3>
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

        {/* Main Content */}
        <div className="flex-1 min-h-0 overflow-auto p-3">
          {error && !hasData ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center p-4">
                <p className="text-sm text-muted-foreground mb-2">Unable to load data</p>
                <p className="text-xs text-red-400">{error}</p>
                <button
                  onClick={() => fetchData(selectedCoin, timeframe)}
                  className="mt-3 px-3 py-1.5 text-xs font-mono bg-muted hover:bg-muted/80 rounded-sm transition-colors"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : data?.message && !hasData ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center p-4">
                <p className="text-sm text-muted-foreground">{data.message}</p>
                <p className="text-xs text-muted-foreground/60 mt-2">
                  Position data is collected every 10 minutes
                </p>
              </div>
            </div>
          ) : hasData ? (
            <div className="space-y-3">
              {/* Side-by-side flow cards */}
              <div className="flex gap-3">
                <SideFlowCard title="Longs" flow={data!.longs} isLong={true} />
                <SideFlowCard title="Shorts" flow={data!.shorts} isLong={false} />
              </div>

              {/* Conviction Meter */}
              <div className="border border-border rounded-sm bg-card/50">
                <ConvictionMeter 
                  score={data!.summary.convictionScore} 
                  direction={data!.summary.netDirection} 
                />
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="text-3xl font-mono font-bold text-foreground/10 tracking-widest">
                  {isLoading ? 'LOADING' : 'NO DATA'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Summary Footer */}
        <div className="flex items-center gap-4 px-3 py-2 border-t border-border bg-muted/30">
          {hasData ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-muted-foreground">Fresh Capital:</span>
                <span className="text-[11px] font-mono font-semibold text-emerald-400">
                  +{formatNotional(data!.summary.freshCapital)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-muted-foreground">Exits:</span>
                <span className="text-[11px] font-mono font-semibold text-red-400">
                  -{formatNotional(data!.summary.exits)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-muted-foreground">Net Flow:</span>
                <span className={cn(
                  "text-[11px] font-mono font-semibold flex items-center gap-1",
                  data!.summary.netDirection === 'LONG' && "text-emerald-400",
                  data!.summary.netDirection === 'SHORT' && "text-red-400",
                  data!.summary.netDirection === 'NEUTRAL' && "text-muted-foreground"
                )}>
                  {data!.summary.netDirection === 'LONG' && <TrendingUp className="h-3 w-3" />}
                  {data!.summary.netDirection === 'SHORT' && <TrendingDown className="h-3 w-3" />}
                  {data!.summary.netFlow !== 0 ? (
                    <>
                      {data!.summary.netFlow > 0 ? '+' : ''}{formatNotional(data!.summary.netFlow)} {data!.summary.netDirection}
                    </>
                  ) : (
                    'NEUTRAL'
                  )}
                </span>
              </div>
              <div className="flex-1" />
              <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground/60">
                <span>New: {data!.summary.totalNewTraders}</span>
                <span>•</span>
                <span>Closed: {data!.summary.totalClosedTraders}</span>
              </div>
            </>
          ) : (
            <span className="text-[10px] font-mono text-muted-foreground">
              {isLoading ? 'Loading position flow data...' : 'No flow data available'}
            </span>
          )}
        </div>
      </div>
    </>
  )
})

