'use client'

import { useEffect, useState, memo, useCallback, useMemo, useRef } from 'react'
import ReactECharts from 'echarts-for-react'
import { Maximize2, Minimize2, ChevronDown, RefreshCw, Database, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

const DEFAULT_COINS = ['BTC', 'ETH', 'SOL', 'ARB', 'OP', 'AVAX', 'DOGE', 'LINK']
const POLL_INTERVAL_MS = 60 * 1000 // 1 minute polling (data updates every 10 min)

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

export const TraderPositioningWidget = memo(function TraderPositioningWidget() {
  const dropdownRef = useRef<HTMLDivElement>(null)
  
  const [selectedCoin, setSelectedCoin] = useState('BTC')
  const [coinDropdownOpen, setCoinDropdownOpen] = useState(false)
  const [coinSearch, setCoinSearch] = useState('')
  const [data, setData] = useState<ApiResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)

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

      const response = await fetch(`/api/trader-positioning?coin=${coin}&limit=all`)

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const result: ApiResponse = await response.json()

      if (result.error) {
        setError(result.error)
      }

      setData(result)
      setLastFetchTime(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
      console.error('[TraderPositioningWidget] Fetch error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Fetch when coin changes
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

  // Prepare ECharts option
  const chartOption = useMemo(() => {
    if (!data?.history?.length) return null

    const timestamps = data.history.map(s => {
      const date = new Date(s.timestamp)
      return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
      }) + ', ' + date.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      })
    })
    
    const tradersData = data.history.map(s => s.totalTraders)
    const ratioData = data.history.map(s => s.longShortRatio > 100 ? 100 : s.longShortRatio)
    
    // Calculate min/max for Traders with padding for better visibility
    const tradersMin = Math.min(...tradersData)
    const tradersMax = Math.max(...tradersData)
    const tradersPadding = (tradersMax - tradersMin) * 0.1 || 100
    const tradersAxisMin = Math.max(0, tradersMin - tradersPadding)
    const tradersAxisMax = tradersMax + tradersPadding
    
    // Calculate min/max for L/S ratio with padding for better visibility
    const ratioMin = Math.min(...ratioData)
    const ratioMax = Math.max(...ratioData)
    const ratioPadding = (ratioMax - ratioMin) * 0.1 || 0.05
    const ratioAxisMin = Math.max(0, ratioMin - ratioPadding)
    const ratioAxisMax = ratioMax + ratioPadding

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20, 20, 20, 0.95)',
        borderColor: '#333',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 10,
          color: '#fff',
        },
        formatter: (params: any[]) => {
          if (!params || params.length === 0) return ''
          const time = params[0].axisValue
          let html = `<div style="margin-bottom:6px;color:rgba(255,255,255,0.8);font-size:9px;">${time}</div>`
          
          params.forEach((param: any) => {
            const color = param.seriesName === 'Traders' ? '#26a69a' : '#ffc107'
            const value = param.seriesName === 'Traders' 
              ? param.value?.toLocaleString() 
              : param.value?.toFixed(4)
            const dotStyle = param.seriesName === 'Traders'
              ? `background:${color};`
              : `border:1.5px solid ${color};background:transparent;`
            
            html += `
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:3px;">
                <div style="display:flex;align-items:center;gap:5px;">
                  <span style="display:inline-block;width:6px;height:6px;border-radius:50%;${dotStyle}"></span>
                  <span style="color:rgba(255,255,255,0.6);font-size:9px;">${param.seriesName === 'Traders' ? 'Traders' : 'L/S'}</span>
                </div>
                <span style="font-weight:500;font-size:10px;">${value ?? '—'}</span>
              </div>
            `
          })
          return html
        },
      },
      legend: {
        show: false,
      },
      grid: {
        left: 50,
        right: 55,
        top: 12,
        bottom: 60,
        containLabel: false,
      },
      xAxis: {
        type: 'category',
        data: timestamps,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: 'rgba(255, 255, 255, 0.4)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 9,
          margin: 8,
        },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: '',
          position: 'right',
          scale: true,
          min: tradersAxisMin,
          max: tradersAxisMax,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: 'rgba(38, 166, 154, 0.7)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: 9,
            formatter: (value: number) => value >= 1000 ? (value / 1000).toFixed(1) + 'k' : value,
          },
          splitLine: {
            show: true,
            lineStyle: {
              color: 'rgba(255, 255, 255, 0.04)',
              type: 'dashed',
            },
          },
        },
        {
          type: 'value',
          name: '',
          position: 'left',
          scale: true,
          min: ratioAxisMin,
          max: ratioAxisMax,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: 'rgba(255, 193, 7, 0.7)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: 9,
            formatter: (value: number) => value.toFixed(2),
          },
          splitLine: { show: false },
        },
      ],
      dataZoom: [
        {
          type: 'slider',
          xAxisIndex: 0,
          start: 0,
          end: 100,
          height: 20,
          bottom: 8,
          borderColor: 'transparent',
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          fillerColor: 'rgba(38, 166, 154, 0.15)',
          handleIcon: 'path://M-9,0 L-9,20 L-6,25 L-6,0 L-9,0 M6,0 L6,20 L9,25 L9,0 L6,0 Z',
          handleSize: '100%',
          handleStyle: {
            color: '#26a69a',
            borderColor: '#26a69a',
          },
          moveHandleSize: 4,
          textStyle: {
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: 9,
          },
          dataBackground: {
            lineStyle: {
              color: 'rgba(38, 166, 154, 0.3)',
              width: 1,
            },
            areaStyle: {
              color: 'rgba(38, 166, 154, 0.08)',
            },
          },
          selectedDataBackground: {
            lineStyle: {
              color: '#26a69a',
              width: 1,
            },
            areaStyle: {
              color: 'rgba(38, 166, 154, 0.2)',
            },
          },
          brushSelect: false,
        },
        {
          type: 'inside',
          xAxisIndex: 0,
          start: 0,
          end: 100,
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
        },
      ],
      series: [
        {
          name: 'Traders',
          type: 'line',
          yAxisIndex: 0,
          data: tradersData,
          smooth: false,
          symbol: 'none',
          lineStyle: {
            color: '#26a69a',
            width: 2,
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(38, 166, 154, 0.25)' },
                { offset: 1, color: 'rgba(38, 166, 154, 0.02)' },
              ],
            },
          },
          emphasis: {
            lineStyle: { width: 2.5 },
          },
        },
        {
          name: 'L/S Ratio',
          type: 'line',
          yAxisIndex: 1,
          data: ratioData,
          smooth: false,
          symbol: 'none',
          lineStyle: {
            color: '#ffc107',
            width: 2,
          },
          emphasis: {
            lineStyle: { width: 2.5 },
          },
        },
      ],
    }
  }, [data])

  const current = data?.current
  const availableCoins = data?.availableCoins?.length ? data.availableCoins : DEFAULT_COINS
  
  // Filter coins based on search
  const filteredCoins = useMemo(() => {
    if (!coinSearch.trim()) return availableCoins
    const search = coinSearch.toUpperCase().trim()
    return availableCoins.filter(coin => coin.toUpperCase().includes(search))
  }, [availableCoins, coinSearch])

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
      {/* Coin Selector */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
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
              {/* Search input */}
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
              {/* Coins list */}
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
              {/* Total count */}
              <div className="px-2 py-1 border-t border-border text-[9px] font-mono text-muted-foreground/50">
                {filteredCoins.length} of {availableCoins.length} coins
              </div>
            </div>
          )}
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
          {data?.totalMarketsInCache && data.totalMarketsInCache > 0 && (
            <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded-sm">
              {data.totalMarketsInCache} coins
            </span>
          )}
          {data?.totalSnapshots && data.totalSnapshots > 0 && (
            <span className="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded-sm">
              {data.totalSnapshots} pts
            </span>
          )}
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
          Trader Positioning
        </h3>
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-muted-foreground">Traders</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-muted-foreground">L/S Ratio</span>
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
        {error && !data?.history?.length ? (
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
        {(!data?.history?.length || data.history.length < 2) && !error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.08]">
            <span className="font-mono text-3xl font-bold tracking-widest text-foreground">
              {isLoading ? 'LOADING' : 'NO DATA'}
            </span>
          </div>
        )}
      </div>

      {/* Footer with current stats */}
      <div className="flex items-center gap-4 px-3 py-2 border-t border-border bg-muted/30">
        {current ? (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-muted-foreground">Longs:</span>
              <span className="text-[11px] font-mono font-semibold text-emerald-400">
                {current.longCount.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-muted-foreground">Shorts:</span>
              <span className="text-[11px] font-mono font-semibold text-red-400">
                {current.shortCount.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-muted-foreground">Ratio:</span>
              <span className={cn(
                "text-[11px] font-mono font-semibold",
                current.longShortRatio >= 1 ? "text-emerald-400" : "text-red-400"
              )}>
                {current.longShortRatio > 100 ? '>100' : current.longShortRatio.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-muted-foreground">Total:</span>
              <span className="text-[11px] font-mono font-semibold text-foreground">
                {current.totalTraders.toLocaleString()}
              </span>
            </div>
          </>
        ) : (
          <span className="text-[10px] font-mono text-muted-foreground">
            {isLoading ? 'Loading...' : 'No data - run fetch script to populate'}
          </span>
        )}
      </div>
    </div>
    </>
  )
})
