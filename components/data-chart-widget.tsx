'use client'

import { useEffect, useRef, useState, memo, useCallback } from 'react'
import { createChart, ColorType, IChartApi, LineSeries, AreaSeries, HistogramSeries } from 'lightweight-charts'
import { Maximize2, Minimize2, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

type ChartType = 'line' | 'area' | 'histogram'
type TimeRange = '1Y' | '2Y' | '5Y'

interface ChartDataPoint {
  time: string
  value: number
  color?: string
}

// Demo data for dropdowns
const DEMO_EXCHANGES = ['Hyperliquid', 'Lighter', 'Bybit']
const DEMO_TICKERS = ['BTC', 'ETH', 'SOL', 'ARB', 'OP', 'AVAX', 'MATIC', 'LINK', 'UNI', 'AAVE']

interface DataChartWidgetProps {
  title: string
  chartType?: ChartType
  showTimeToggles?: boolean
  showDropdowns?: boolean
  footerValues?: {
    label: string
    value: string | number
    color?: 'green' | 'red' | 'yellow' | 'default'
  }[]
  data?: ChartDataPoint[]
  lineColor?: string
  areaTopColor?: string
  areaBottomColor?: string
  showSecondLine?: boolean
  secondLineData?: ChartDataPoint[]
  secondLineColor?: string
}

// Generate demo data for charts
const generateDemoData = (
  type: ChartType,
  range: TimeRange,
  trend: 'up' | 'down' | 'volatile' = 'volatile'
): ChartDataPoint[] => {
  const now = new Date()
  const years = range === '1Y' ? 1 : range === '2Y' ? 2 : 5
  const dataPoints = years * 52 // Weekly data points
  const data: ChartDataPoint[] = []
  
  let baseValue = 50 + Math.random() * 50
  
  for (let i = 0; i < dataPoints; i++) {
    const date = new Date(now)
    date.setDate(date.getDate() - (dataPoints - i) * 7)
    
    const time = date.toISOString().split('T')[0]
    
    // Add some randomness with trend
    const trendFactor = trend === 'up' ? 0.1 : trend === 'down' ? -0.1 : 0
    const volatility = type === 'histogram' ? 15 : 5
    baseValue = baseValue + (Math.random() - 0.5 + trendFactor) * volatility
    baseValue = Math.max(0, Math.min(100, baseValue))
    
    if (type === 'histogram') {
      const value = (Math.random() - 0.5) * 50
      data.push({
        time,
        value,
        color: value >= 0 ? 'rgba(76, 175, 80, 0.8)' : 'rgba(244, 67, 54, 0.8)',
      })
    } else {
      data.push({
        time,
        value: baseValue,
      })
    }
  }
  
  return data
}

// Generate second line data (for overlay lines like EMAs)
const generateSecondLineData = (range: TimeRange): ChartDataPoint[] => {
  const primaryData = generateDemoData('line', range, 'up')
  return primaryData.map((d) => ({
    ...d,
    value: d.value * (0.9 + Math.random() * 0.2),
  }))
}

export const DataChartWidget = memo(function DataChartWidget({
  title,
  chartType = 'area',
  showTimeToggles = true,
  showDropdowns = true,
  footerValues = [],
  data,
  lineColor,
  areaTopColor,
  areaBottomColor,
  showSecondLine = false,
  secondLineData,
  secondLineColor,
}: DataChartWidgetProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ReturnType<IChartApi['addSeries']> | null>(null)
  const secondSeriesRef = useRef<ReturnType<IChartApi['addSeries']> | null>(null)
  const [selectedRange, setSelectedRange] = useState<TimeRange>('1Y')
  const [chartData, setChartData] = useState<ChartDataPoint[]>([])
  const [secondChartData, setSecondChartData] = useState<ChartDataPoint[]>([])
  const [selectedExchange, setSelectedExchange] = useState(DEMO_EXCHANGES[0])
  const [selectedTicker, setSelectedTicker] = useState(DEMO_TICKERS[0])
  const [exchangeOpen, setExchangeOpen] = useState(false)
  const [tickerOpen, setTickerOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

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

  // Generate demo data on mount and range change
  useEffect(() => {
    if (data) {
      setChartData(data)
    } else {
      const trend = title.includes('Regime') ? 'up' : title.includes('Spread') ? 'volatile' : 'volatile'
      setChartData(generateDemoData(chartType, selectedRange, trend))
    }
    
    if (showSecondLine) {
      if (secondLineData) {
        setSecondChartData(secondLineData)
      } else {
        setSecondChartData(generateSecondLineData(selectedRange))
      }
    }
  }, [data, chartType, selectedRange, title, showSecondLine, secondLineData])

  // Initialize and update chart
  useEffect(() => {
    if (!chartContainerRef.current || chartData.length === 0) return

    // Chart colors based on props or defaults
    const primaryLineColor = lineColor || 'rgba(255, 255, 255, 0.9)'
    const primaryAreaTop = areaTopColor || 'rgba(38, 166, 154, 0.4)'
    const primaryAreaBottom = areaBottomColor || 'rgba(38, 166, 154, 0)'
    const secondaryLineColor = secondLineColor || 'rgba(255, 193, 7, 0.8)'

    // Create or update chart
    if (!chartRef.current) {
      chartRef.current = createChart(chartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: 'rgba(255, 255, 255, 0.5)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 10,
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { color: 'rgba(255, 255, 255, 0.05)', style: 1 },
        },
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
        rightPriceScale: {
          borderVisible: false,
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
        timeScale: {
          borderVisible: false,
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: {
          vertLine: { color: 'rgba(255, 255, 255, 0.2)', width: 1, style: 2 },
          horzLine: { color: 'rgba(255, 255, 255, 0.2)', width: 1, style: 2 },
        },
        handleScroll: false,
        handleScale: false,
        watermark: {
          visible: false,
        },
      })

      // Create series based on type - using v5 API
      if (chartType === 'histogram') {
        seriesRef.current = chartRef.current.addSeries(HistogramSeries, {
          priceLineVisible: false,
          lastValueVisible: false,
        })
      } else if (chartType === 'area') {
        seriesRef.current = chartRef.current.addSeries(AreaSeries, {
          lineColor: primaryLineColor,
          topColor: primaryAreaTop,
          bottomColor: primaryAreaBottom,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 4,
        })
      } else {
        seriesRef.current = chartRef.current.addSeries(LineSeries, {
          color: primaryLineColor,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 4,
        })
      }

      // Add second line if needed
      if (showSecondLine && chartType !== 'histogram') {
        secondSeriesRef.current = chartRef.current.addSeries(LineSeries, {
          color: secondaryLineColor,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          lineStyle: 0,
        })
      }
    }

    // Update data
    if (seriesRef.current) {
      seriesRef.current.setData(chartData as any)
    }
    if (secondSeriesRef.current && secondChartData.length > 0) {
      secondSeriesRef.current.setData(secondChartData as any)
    }

    // Fit content
    chartRef.current.timeScale().fitContent()

    // Handle resize
    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        })
      }
    }

    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(chartContainerRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [chartData, secondChartData, chartType, lineColor, areaTopColor, areaBottomColor, secondLineColor, showSecondLine])

  // Resize chart when expanded state changes
  useEffect(() => {
    if (chartRef.current && chartContainerRef.current) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        if (chartRef.current && chartContainerRef.current) {
          chartRef.current.applyOptions({
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
          })
          chartRef.current.timeScale().fitContent()
        }
      })
    }
  }, [isExpanded])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
        seriesRef.current = null
        secondSeriesRef.current = null
      }
    }
  }, [])

  const timeRanges: TimeRange[] = ['1Y', '2Y', '5Y']

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
      {/* Dropdowns Row */}
      {showDropdowns && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
          {/* Exchange Dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setExchangeOpen(!exchangeOpen)
                setTickerOpen(false)
              }}
              className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono font-medium bg-background border border-border rounded-sm hover:bg-muted transition-colors"
            >
              <span className="text-muted-foreground">Exchange:</span>
              <span className="text-foreground">{selectedExchange}</span>
              <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", exchangeOpen && "rotate-180")} />
            </button>
            {exchangeOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 min-w-[120px] bg-popover border border-border rounded-sm shadow-lg">
                {DEMO_EXCHANGES.map((exchange) => (
                  <button
                    key={exchange}
                    onClick={() => {
                      setSelectedExchange(exchange)
                      setExchangeOpen(false)
                    }}
                    className={cn(
                      "w-full px-3 py-1.5 text-left text-[10px] font-mono hover:bg-muted transition-colors",
                      selectedExchange === exchange ? "bg-muted text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {exchange}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Ticker Dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setTickerOpen(!tickerOpen)
                setExchangeOpen(false)
              }}
              className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono font-medium bg-background border border-border rounded-sm hover:bg-muted transition-colors"
            >
              <span className="text-muted-foreground">Ticker:</span>
              <span className="text-foreground">{selectedTicker}</span>
              <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", tickerOpen && "rotate-180")} />
            </button>
            {tickerOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 min-w-[100px] bg-popover border border-border rounded-sm shadow-lg max-h-[200px] overflow-y-auto">
                {DEMO_TICKERS.map((ticker) => (
                  <button
                    key={ticker}
                    onClick={() => {
                      setSelectedTicker(ticker)
                      setTickerOpen(false)
                    }}
                    className={cn(
                      "w-full px-3 py-1.5 text-left text-[10px] font-mono hover:bg-muted transition-colors",
                      selectedTicker === ticker ? "bg-muted text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {ticker}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <h3 className="font-mono text-xs font-semibold text-foreground tracking-wide">
          {title}
        </h3>
        <div className="flex items-center gap-1">
          {showTimeToggles && (
            <div className="flex gap-0.5 mr-2">
              {timeRanges.map((range) => (
                <button
                  key={range}
                  onClick={() => setSelectedRange(range)}
                  className={cn(
                    'px-2 py-0.5 text-[10px] font-mono font-medium rounded-sm transition-colors',
                    selectedRange === range
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  {range}
                </button>
              ))}
            </div>
          )}
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
        <div ref={chartContainerRef} className="absolute inset-0" />
        {/* Watermark */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03]">
          <span className="font-mono text-4xl font-bold tracking-widest text-foreground">
            DEMO
          </span>
        </div>
      </div>

      {/* Footer */}
      {footerValues.length > 0 && (
        <div className="flex items-center gap-4 px-3 py-2 border-t border-border bg-muted/30">
          {footerValues.map((item, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-muted-foreground">
                {item.label}:
              </span>
              <span
                className={cn(
                  'text-[11px] font-mono font-semibold',
                  item.color === 'green' && 'text-emerald-400',
                  item.color === 'red' && 'text-red-400',
                  item.color === 'yellow' && 'text-amber-400',
                  item.color === 'default' && 'text-foreground',
                  !item.color && 'text-foreground'
                )}
              >
                {item.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
    </>
  )
})

