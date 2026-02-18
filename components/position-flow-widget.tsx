'use client'

import { useEffect, useState, memo, useCallback, useMemo, useRef } from 'react'
import ReactECharts from 'echarts-for-react'
import { Maximize2, Minimize2, ChevronDown, RefreshCw, Database, Search, TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'

const DEFAULT_COINS = ['BTC', 'ETH', 'SOL', 'ARB', 'OP', 'AVAX', 'DOGE', 'LINK']
const POLL_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes - matches Supabase update frequency

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

interface FlowBar {
  timestamp: string
  timeLabel: string
  longFlow: number      // Delta in long notional
  shortFlow: number     // Delta in short notional
  longTraderDelta: number
  shortTraderDelta: number
  netFlow: number       // longFlow - shortFlow
}

type Timeframe = '1H' | '4H' | '24H'

const TIMEFRAME_CONFIG: Record<Timeframe, { snapshots: number; bucketSize: number; label: string }> = {
  '1H': { snapshots: 7, bucketSize: 1, label: '10min bars' },   // 6 bars
  '4H': { snapshots: 25, bucketSize: 3, label: '30min bars' },  // 8 bars
  '24H': { snapshots: 145, bucketSize: 12, label: '2hr bars' }, // 12 bars
}

export const PositionFlowWidget = memo(function PositionFlowWidget() {
  const dropdownRef = useRef<HTMLDivElement>(null)
  
  const [selectedCoin, setSelectedCoin] = useState('BTC')
  const [coinDropdownOpen, setCoinDropdownOpen] = useState(false)
  const [coinSearch, setCoinSearch] = useState('')
  const [data, setData] = useState<ApiResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [timeframe, setTimeframe] = useState<Timeframe>('4H')

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

  // Fetch data from Supabase-backed API
  const fetchData = useCallback(async (coin: string) => {
    try {
      setIsLoading(true)
      setError(null)

      // Request enough snapshots for 24h view (144 snapshots at 10min intervals)
      const response = await fetch(`/api/trader-positioning?coin=${coin}&limit=150`)

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const result: ApiResponse = await response.json()

      if (result.error) {
        setError(result.error)
      }

      // Debug: log the data to see what we're getting
      if (result.history?.length > 0) {
        console.log('[PositionFlowWidget] Sample data:', {
          first: result.history[0],
          last: result.history[result.history.length - 1],
          count: result.history.length,
        })
      }

      setData(result)
      setLastFetchTime(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
      console.error('[PositionFlowWidget] Fetch error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Fetch when coin changes - poll every 10 minutes
  useEffect(() => {
    fetchData(selectedCoin)

    const interval = setInterval(() => {
      fetchData(selectedCoin)
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [selectedCoin, fetchData])

  // Calculate time since last update
  const getTimeSinceUpdate = () => {
    if (!lastFetchTime) return 'Never'
    const seconds = Math.floor((Date.now() - lastFetchTime.getTime()) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    return `${minutes}m ago`
  }

  // Calculate flow bars from history data
  const flowBars = useMemo((): FlowBar[] => {
    if (!data?.history?.length || data.history.length < 2) return []

    const config = TIMEFRAME_CONFIG[timeframe]
    const history = data.history.slice(-config.snapshots) // Get last N snapshots
    
    const bars: FlowBar[] = []
    
    // Calculate deltas between consecutive snapshots (or buckets)
    for (let i = config.bucketSize; i < history.length; i += config.bucketSize) {
      const current = history[i]
      const previous = history[i - config.bucketSize]
      
      if (!current || !previous) continue

      // Ensure we have numbers, not strings or null
      const currLongNotional = Number(current.longNotional) || 0
      const currShortNotional = Number(current.shortNotional) || 0
      const prevLongNotional = Number(previous.longNotional) || 0
      const prevShortNotional = Number(previous.shortNotional) || 0

      const longFlow = currLongNotional - prevLongNotional
      const shortFlow = currShortNotional - prevShortNotional

      const date = new Date(current.timestamp)
      const timeLabel = date.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      })

      bars.push({
        timestamp: current.timestamp,
        timeLabel,
        longFlow,
        shortFlow,
        longTraderDelta: (current.longCount || 0) - (previous.longCount || 0),
        shortTraderDelta: (current.shortCount || 0) - (previous.shortCount || 0),
        netFlow: longFlow - shortFlow,
      })
    }

    // Debug log
    if (bars.length > 0) {
      console.log('[PositionFlowWidget] Flow bars:', bars.slice(0, 3))
    }

    return bars
  }, [data?.history, timeframe])

  // Calculate summary stats for the timeframe
  const summary = useMemo(() => {
    if (!data?.history?.length || data.history.length < 2) {
      return { netFlow: 0, traderDelta: 0, ratioDelta: 0 }
    }

    const config = TIMEFRAME_CONFIG[timeframe]
    const history = data.history.slice(-config.snapshots)
    
    const oldest = history[0]
    const newest = history[history.length - 1]
    
    if (!oldest || !newest) {
      return { netFlow: 0, traderDelta: 0, ratioDelta: 0 }
    }

    const longFlowTotal = (Number(newest.longNotional) || 0) - (Number(oldest.longNotional) || 0)
    const shortFlowTotal = (Number(newest.shortNotional) || 0) - (Number(oldest.shortNotional) || 0)

    return {
      netFlow: longFlowTotal - shortFlowTotal,
      traderDelta: (newest.totalTraders || 0) - (oldest.totalTraders || 0),
      ratioDelta: (newest.longShortRatio || 0) - (oldest.longShortRatio || 0),
    }
  }, [data?.history, timeframe])

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

  // Prepare ECharts option - VERTICAL bars with time on X-axis
  const chartOption = useMemo(() => {
    if (!flowBars.length) return null

    const timeLabels = flowBars.map(b => b.timeLabel)
    const longFlows = flowBars.map(b => b.longFlow)
    const shortFlows = flowBars.map(b => -Math.abs(b.shortFlow)) // Negative to go down

    // Calculate Y-axis max for symmetry
    const maxVal = Math.max(
      ...longFlows.map(Math.abs),
      ...shortFlows.map(Math.abs),
      1 // minimum to avoid 0
    ) * 1.2

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'shadow',
        },
        backgroundColor: 'rgba(12, 12, 12, 0.95)',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        padding: [12, 16],
        textStyle: {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 11,
          color: '#fff',
        },
        formatter: (params: any[]) => {
          if (!params || params.length === 0) return ''
          const idx = params[0].dataIndex
          const bar = flowBars[idx]
          if (!bar) return ''

          const netFlow = bar.netFlow
          const netClass = netFlow >= 0 ? 'color:#10b981' : 'color:#ef4444'
          const netLabel = netFlow >= 0 ? 'LONG' : 'SHORT'

          return `
            <div style="margin-bottom:8px;color:rgba(255,255,255,0.6);font-size:10px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:6px;">
              ${bar.timeLabel}
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              <div style="display:flex;justify-content:space-between;gap:24px;">
                <span style="color:#10b981;">↑ Long Flow</span>
                <span style="font-weight:600;color:#10b981;">${bar.longFlow >= 0 ? '+' : ''}${formatCurrency(bar.longFlow)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;gap:24px;">
                <span style="color:#ef4444;">↓ Short Flow</span>
                <span style="font-weight:600;color:#ef4444;">${bar.shortFlow >= 0 ? '+' : ''}${formatCurrency(bar.shortFlow)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;gap:24px;border-top:1px solid rgba(255,255,255,0.1);padding-top:6px;margin-top:2px;">
                <span style="color:rgba(255,255,255,0.6);">Net Flow</span>
                <span style="font-weight:700;${netClass}">${netFlow >= 0 ? '+' : ''}${formatCurrency(netFlow)} ${netLabel}</span>
              </div>
              <div style="display:flex;justify-content:space-between;gap:24px;font-size:10px;">
                <span style="color:rgba(255,255,255,0.4);">Δ Traders</span>
                <span style="color:rgba(255,255,255,0.6);">L: ${bar.longTraderDelta >= 0 ? '+' : ''}${bar.longTraderDelta} / S: ${bar.shortTraderDelta >= 0 ? '+' : ''}${bar.shortTraderDelta}</span>
              </div>
            </div>
          `
        },
      },
      grid: {
        left: 55,
        right: 15,
        top: 20,
        bottom: 35,
        containLabel: false,
      },
      xAxis: {
        type: 'category',
        data: timeLabels,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: 'rgba(255, 255, 255, 0.5)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 9,
          interval: 0,
          rotate: flowBars.length > 8 ? 45 : 0,
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        min: -maxVal,
        max: maxVal,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: {
          show: true,
          lineStyle: {
            color: 'rgba(255, 255, 255, 0.04)',
            type: 'dashed',
          },
        },
        axisLabel: {
          color: 'rgba(255, 255, 255, 0.4)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 9,
          formatter: (value: number) => {
            if (value === 0) return '0'
            const absVal = Math.abs(value)
            if (absVal >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(0)}B`
            if (absVal >= 1_000_000) return `${(value / 1_000_000).toFixed(0)}M`
            if (absVal >= 1_000) return `${(value / 1_000).toFixed(0)}K`
            return value.toFixed(0)
          },
        },
      },
      series: [
        {
          name: 'Long Flow',
          type: 'bar',
          data: longFlows,
          itemStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 1,
              x2: 0,
              y2: 0,
              colorStops: [
                { offset: 0, color: 'rgba(16, 185, 129, 0.5)' },
                { offset: 1, color: 'rgba(16, 185, 129, 0.9)' },
              ],
            },
            borderRadius: [3, 3, 0, 0],
          },
          emphasis: {
            itemStyle: {
              color: '#10b981',
            },
          },
          barMaxWidth: 30,
        },
        {
          name: 'Short Flow',
          type: 'bar',
          data: shortFlows,
          itemStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(239, 68, 68, 0.5)' },
                { offset: 1, color: 'rgba(239, 68, 68, 0.9)' },
              ],
            },
            borderRadius: [0, 0, 3, 3],
          },
          emphasis: {
            itemStyle: {
              color: '#ef4444',
            },
          },
          barMaxWidth: 30,
        },
      ],
      // Zero line
      graphic: [
        {
          type: 'line',
          shape: {
            x1: 55,
            y1: '50%',
            x2: '100%',
            y2: '50%',
          },
          style: {
            stroke: 'rgba(255, 255, 255, 0.2)',
            lineWidth: 1,
          },
        },
      ],
    }
  }, [flowBars])

  const availableCoins = data?.availableCoins?.length ? data.availableCoins : DEFAULT_COINS
  
  // Filter coins based on search
  const filteredCoins = useMemo(() => {
    if (!coinSearch.trim()) return availableCoins
    const search = coinSearch.toUpperCase().trim()
    return availableCoins.filter(coin => coin.toUpperCase().includes(search))
  }, [availableCoins, coinSearch])

  const isNetLong = summary.netFlow >= 0

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
                <div className="px-2 py-1 border-t border-border text-[9px] font-mono text-muted-foreground/50">
                  {filteredCoins.length} of {availableCoins.length} coins
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
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
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
            {data?.source === 'supabase' && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-sm">
                <Database className="h-2.5 w-2.5" />
                DB
              </span>
            )}
            <span className="px-1.5 py-0.5 bg-muted text-muted-foreground rounded-sm">
              {TIMEFRAME_CONFIG[timeframe].label}
            </span>
            <span>Updated: {getTimeSinceUpdate()}</span>
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

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <h3 className="font-mono text-xs font-semibold text-foreground tracking-wide">
            Position Flow
          </h3>
          <div className="flex items-center gap-3 text-[10px] font-mono">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm bg-emerald-500" />
              <span className="text-muted-foreground">Long Δ</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm bg-red-500" />
              <span className="text-muted-foreground">Short Δ</span>
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

        {/* Chart */}
        <div className="flex-1 min-h-0 relative">
          {error && !flowBars.length ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center p-4">
                <p className="text-sm text-muted-foreground mb-2">Unable to load data</p>
                <p className="text-xs text-red-400">{error}</p>
                <button
                  onClick={() => fetchData(selectedCoin)}
                  className="mt-3 px-3 py-1.5 text-xs font-mono bg-muted hover:bg-muted/80 rounded-sm transition-colors"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : chartOption ? (
            <ReactECharts
              option={chartOption}
              style={{ width: '100%', height: '100%' }}
              opts={{ renderer: 'canvas' }}
              notMerge={true}
              lazyUpdate={true}
            />
          ) : null}

          {/* Watermark when no data */}
          {(!flowBars.length) && !error && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.08]">
              <span className="font-mono text-3xl font-bold tracking-widest text-foreground">
                {isLoading ? 'LOADING' : 'NO DATA'}
              </span>
            </div>
          )}
        </div>

        {/* Summary Footer */}
        <div className="flex items-center gap-4 px-3 py-2 border-t border-border bg-muted/30">
          {flowBars.length > 0 ? (
            <>
              {/* Net Flow */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-muted-foreground">Net Flow:</span>
                <span className={cn(
                  "text-[11px] font-mono font-semibold flex items-center gap-1",
                  isNetLong ? "text-emerald-400" : "text-red-400"
                )}>
                  {isNetLong ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {summary.netFlow !== 0 ? (
                    <>
                      {summary.netFlow > 0 ? '+' : ''}{formatCurrency(summary.netFlow)} {isNetLong ? 'LONG' : 'SHORT'}
                    </>
                  ) : (
                    'NEUTRAL'
                  )}
                </span>
              </div>
              
              {/* Trader Delta */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-muted-foreground">Δ Traders:</span>
                <span className={cn(
                  "text-[11px] font-mono font-semibold",
                  summary.traderDelta >= 0 ? "text-emerald-400" : "text-red-400"
                )}>
                  {summary.traderDelta >= 0 ? '+' : ''}{summary.traderDelta.toLocaleString()}
                </span>
              </div>

              {/* Ratio Delta */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-muted-foreground">Δ L/S:</span>
                <span className={cn(
                  "text-[11px] font-mono font-semibold",
                  summary.ratioDelta >= 0 ? "text-emerald-400" : "text-red-400"
                )}>
                  {summary.ratioDelta >= 0 ? '+' : ''}{summary.ratioDelta.toFixed(4)}
                </span>
              </div>
            </>
          ) : (
            <span className="text-[10px] font-mono text-muted-foreground">
              {isLoading ? 'Loading...' : 'No flow data available'}
            </span>
          )}
        </div>
      </div>
    </>
  )
})
