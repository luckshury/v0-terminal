'use client'

import { useState, useEffect, useMemo, useCallback, memo } from 'react'
import { format, subDays } from 'date-fns'
import { ChevronDownIcon, RefreshCw, AlertCircle, Check, ChevronsUpDown, CheckCircle, X, AlertTriangle } from 'lucide-react'
import { DateRange } from 'react-day-picker'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ReferenceDot,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DateRangePicker } from '@/components/date-range-picker'
import { cn } from '@/lib/utils'
import { useAppState } from '@/contexts/app-state-context'
import {
  parseHourlyCandles,
  calculateDailyPivots,
  calculateHourlyStats,
  adjustForCurrentDay,
  calculateWeeklyPivots,
  calculateDailyStats,
  getHeatmapColor,
  getTextColor,
  type HourlyStats,
  type DailyStats,
  type HeatmapScheme,
  type DailyPivot,
  type WeeklyPivot,
} from '@/lib/pivot-utils'

const WEEKDAY_OPTIONS = [
  { label: 'Monday', short: 'Mon', value: 1 },
  { label: 'Tuesday', short: 'Tue', value: 2 },
  { label: 'Wednesday', short: 'Wed', value: 3 },
  { label: 'Thursday', short: 'Thu', value: 4 },
  { label: 'Friday', short: 'Fri', value: 5 },
  { label: 'Saturday', short: 'Sat', value: 6 },
  { label: 'Sunday', short: 'Sun', value: 0 },
]

const HEATMAP_SCHEMES: { value: HeatmapScheme; label: string }[] = [
  { value: 'viridis', label: 'Viridis' },
  { value: 'plasma', label: 'Plasma' },
  { value: 'inferno', label: 'Inferno' },
  { value: 'turbo', label: 'Turbo' },
  { value: 'blues', label: 'Blues' },
  { value: 'green', label: 'Green' },
]

type HistogramBin = {
  mid: number
  rangeLabel: string
  count: number
  min: number
  max: number
}

function buildHistogram(values: number[], binCount = 32): HistogramBin[] {
  if (values.length === 0) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(1, max - min)
  const step = range / binCount

  const bins = Array.from({ length: binCount }, (_, idx) => {
    const start = min + idx * step
    const end = start + step
    return {
      mid: start + step / 2,
      rangeLabel: `${start.toFixed(1)}% to ${end.toFixed(1)}%`,
      count: 0,
      min: start,
      max: end,
    }
  })

  values.forEach(value => {
    let idx = Math.floor((value - min) / step)
    if (idx < 0) idx = 0
    if (idx >= binCount) idx = binCount - 1
    bins[idx].count += 1
  })

  return bins
}

type ReferenceLineConfig = {
  value: number
  color: string
  label?: string
}

// Add Highlight Type
type ChartHighlight = {
  chartId: 'open-p1' | 'p1-p2'
  mode: 'gt' | 'lt'
  value: number
} | null

// Update HistogramCard props
type HistogramCardProps = {
  title: string
  subtitle: string
  data: HistogramBin[]
  barColor: string
  isDark: boolean
  referenceLines?: ReferenceLineConfig[]
  onBarClick?: (bin: HistogramBin) => void
  highlightFilter?: ChartHighlight
}

function HistogramCard({ title, subtitle, data, barColor, isDark, referenceLines, onBarClick, highlightFilter }: HistogramCardProps) {
  return (
    <div className="bg-card border border-border rounded-md p-3 flex flex-col h-full shadow-sm">
      <div className="mb-2 flex items-baseline justify-between">
        <div>
          <div className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">{title}</div>
          <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
      </div>

      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height="100%" minHeight={180}>
          <BarChart data={data} margin={{ top: 25, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#2c2c2c' : '#e5e7eb'} vertical={false} opacity={0.5} />
            <XAxis
              dataKey="mid"
              type="number"
              domain={['dataMin', 'dataMax']}
              tick={{ fontSize: 9, fill: isDark ? '#9ca3af' : '#6b7280', fontFamily: 'monospace' }}
              tickFormatter={(value: number) => `${value.toFixed(1)}%`}
              tickCount={8}
              axisLine={{ stroke: isDark ? '#2c2c2c' : '#e5e7eb' }}
              tickLine={{ stroke: isDark ? '#2c2c2c' : '#e5e7eb' }}
              dy={4}
            />
            <YAxis
              tick={{ fontSize: 9, fill: isDark ? '#9ca3af' : '#6b7280', fontFamily: 'monospace' }}
              width={35}
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: isDark ? '#ffffff10' : '#00000005' }}
              contentStyle={{
                backgroundColor: isDark ? '#18181b' : '#ffffff',
                borderColor: isDark ? '#27272a' : '#e5e7eb',
                borderRadius: '6px',
                fontSize: '11px',
                padding: '8px 12px',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
              }}
              labelFormatter={(_, payload: any) => (
                <span className="font-mono text-[10px] text-muted-foreground block mb-1">
                  Range: {payload?.[0]?.payload?.rangeLabel ?? ''}
                </span>
              )}
              formatter={(value: number) => [
                <span className="font-bold font-mono">{value}</span>, 
                <span className="text-xs text-muted-foreground ml-1">occurrences</span>
              ]}
            />
            {referenceLines?.map(line => (
              <ReferenceLine
                key={`${line.value}-${line.color}`}
                x={line.value}
                stroke={line.color}
                strokeWidth={1.5}
                strokeDasharray="3 3"
                label={{
                  value: line.label ?? `${line.value.toFixed(1)}%`,
                  position: 'top',
                  fill: line.color,
                  fontSize: 9,
                  fontWeight: 600,
                  fontFamily: 'monospace',
                }}
              />
            ))}
            <Bar 
              dataKey="count" 
              fill={barColor} 
              radius={[2, 2, 0, 0]}
              maxBarSize={40}
              onClick={(data: any) => {
                if (data && onBarClick) {
                  onBarClick(data)
                }
              }}
              className="cursor-pointer transition-opacity"
            >
              {data.map((entry, index) => {
                let opacity = 1
                if (highlightFilter) {
                   const matches = highlightFilter.mode === 'gt' 
                     ? entry.mid >= highlightFilter.value
                     : entry.mid <= highlightFilter.value
                   opacity = matches ? 1 : 0.2
                }
                return <Cell key={`cell-${index}`} fill={barColor} fillOpacity={opacity} />
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex-1 flex items-center justify-center border-2 border-dashed border-muted rounded-md bg-muted/10">
          <div className="text-xs text-muted-foreground font-mono">No data available</div>
        </div>
      )}
    </div>
  )
}

function DistanceKeyInsightsWidget({
  ticker,
  dataPoints,
  todayOpen,
  todayP1Price,
  todayP2Price,
  todayP1Type,
  todayP2Type,
  filteredPivots,
  isDark,
  selectedWeekdaysCount,
  onHighlight
}: any) {
  if (!todayOpen || !todayP1Price || !todayP2Price || !todayP1Type || !todayP2Type) {
    return (
      <div className="bg-card border border-border rounded-md p-4 h-full flex items-center justify-center text-xs text-muted-foreground text-center">
        Insufficient data for insights.
        <br />
        Waiting for intraday data...
      </div>
    )
  }

  const p1DistPct = ((todayP1Price - todayOpen) / todayOpen) * 100
  const p2DistPct = ((todayP2Price - todayOpen) / todayOpen) * 100
  
  const p1IsLow = todayP1Type === 'low'
  const p2IsHigh = todayP2Type === 'high'
  
  // P1 Status: % of P1s formed beyond current level
  const p1Exceeds = filteredPivots.filter((p: any) => {
    const dist = ((p.p1Price - p.open) / p.open) * 100
    if (p1IsLow) return dist < p1DistPct
    return dist > p1DistPct
  }).length
  const p1ExceedsPct = ((p1Exceeds / dataPoints) * 100).toFixed(1)

  // P2 Status: % of P2s that reached current P2 level
  const p2Reach = filteredPivots.filter((p: any) => {
    const dist = ((p.p2Price - p.open) / p.open) * 100
    if (p2IsHigh) return dist >= p2DistPct
    return dist <= p2DistPct
  }).length
  const p2ReachPct = ((p2Reach / dataPoints) * 100).toFixed(1)

  // Stat 3: Of the days that reached P2 level, how many became P1? (Reverse logic)
  // This means: Of days where High >= Current P2 (if High), was High == P1?
  const reachedLevel = filteredPivots.filter((p: any) => {
    const h = ((p.high - p.open) / p.open) * 100
    const l = ((p.low - p.open) / p.open) * 100
    if (p2IsHigh) return h >= p2DistPct
    return l <= p2DistPct
  })
  const becameP1 = reachedLevel.filter((p: any) => p.p1Type === todayP2Type).length
  const becameP1Pct = reachedLevel.length > 0 
    ? ((becameP1 / reachedLevel.length) * 100).toFixed(1) 
    : '0.0'

  // Flip Risk (Summary)
  // % of days took out the daily low/high (P1)
  const flipExceeds = filteredPivots.filter((p: any) => {
     const lowDist = ((p.low - p.open) / p.open) * 100
     const highDist = ((p.high - p.open) / p.open) * 100
     if (p1IsLow) return lowDist < p1DistPct
     return highDist > p1DistPct
  }).length
  const flipRiskPct = ((flipExceeds / dataPoints) * 100).toFixed(1)
  const flipRiskVal = parseFloat(flipRiskPct)
  
  // P2 In Risk (Summary)
  // % of days moved further than current displacement
  const currentDisp = Math.abs((todayP2Price - todayP1Price) / (todayP1Price)) * 100
  
  const dispExceeds = filteredPivots.filter((p: any) => {
     const d = Math.abs((p.p2Price - p.p1Price) / (p.p1Price || p.open)) * 100
     return d > currentDisp
  }).length
  const dispExceedsPct = ((dispExceeds / dataPoints) * 100).toFixed(1)
  const dispExceedsVal = parseFloat(dispExceedsPct)

  // Determine Risk Levels
  let flipRiskLevel = 'Low'
  let flipRiskColor = 'text-green-500'
  if (flipRiskVal > 40) { flipRiskLevel = 'High'; flipRiskColor = 'text-red-500' }
  else if (flipRiskVal > 20) { flipRiskLevel = 'Moderate'; flipRiskColor = 'text-yellow-500' }

  let p2InLikely = 'Likely'
  let p2InColor = 'text-green-500'
  // If 91% of days move further, it's UNLIKELY that P2 is "in" (finished).
  if (dispExceedsVal > 50) { p2InLikely = 'Unlikely'; p2InColor = 'text-red-500' }
  else if (dispExceedsVal > 20) { p2InLikely = 'Uncertain'; p2InColor = 'text-yellow-500' }

  const p1Desc = `Daily ${todayP1Type === 'high' ? 'High' : 'Low'} - ${Math.abs(p1DistPct).toFixed(1)}% ${p1DistPct >= 0 ? 'above' : 'below'} Open`
  const p2Desc = `Daily ${todayP2Type === 'high' ? 'High' : 'Low'} - ${Math.abs(p2DistPct).toFixed(1)}% ${p2DistPct >= 0 ? 'above' : 'below'} Open`

  return (
    <div className="bg-card border border-border rounded-md flex flex-col h-full overflow-hidden">
      <div className="p-3 border-b border-border bg-muted/20">
        <h3 className="font-bold text-sm font-mono mb-1">Key Insights</h3>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
          <span className="bg-green-500/20 text-green-500 px-1 py-0.5 rounded flex items-center gap-1">
            <Check className="h-3 w-3" />
            {dataPoints}
          </span>
          <span>data points used — statistics are reliable.</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 text-xs font-mono space-y-6">
        {/* Asset Table */}
        <div className="bg-muted/10 rounded border border-border/50">
          <div className="grid grid-cols-[auto_1fr_1fr] text-[10px] text-muted-foreground border-b border-border/50 bg-muted/30">
            <div className="px-2 py-1.5 font-semibold">Asset</div>
            <div className="px-2 py-1.5 font-semibold text-center">Current P1</div>
            <div className="px-2 py-1.5 font-semibold text-center">Current P2</div>
          </div>
          <div className="grid grid-cols-[auto_1fr_1fr] py-2">
            <div className="px-2 font-bold self-center">{ticker}</div>
            <div className="px-2 text-center text-[10px] leading-tight">{p1Desc}</div>
            <div className="px-2 text-center text-[10px] leading-tight">{p2Desc}</div>
          </div>
        </div>

        {/* P1 Status */}
        <div className="space-y-2">
          <div className="font-bold text-foreground border-b border-border pb-1">P1 Status</div>
          <div 
            className="grid grid-cols-[1fr_auto] gap-2 items-center py-1 border-b border-border/30 hover:bg-muted/50 cursor-pointer transition-colors rounded px-1 -mx-1"
            onClick={() => onHighlight?.({ chartId: 'open-p1', mode: p1IsLow ? 'lt' : 'gt', value: p1DistPct })}
          >
            <div className="text-muted-foreground">% of P1s formed {p1IsLow ? 'below' : 'above'} dOpen by more than {Math.abs(p1DistPct).toFixed(1)}% ({todayP1Type})</div>
            <div className="font-bold">{p1ExceedsPct}%</div>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 items-center py-1 border-b border-border/30">
            <div className="text-muted-foreground bg-muted/20 -mx-1 px-1 rounded">% of P2s that reached {Math.abs(p2DistPct).toFixed(1)}% {p2DistPct >= 0 ? 'above' : 'below'} dOpen ({todayP2Type})</div>
            <div className="font-bold">{p2ReachPct}%</div>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 items-center py-1">
            <div className="text-muted-foreground">% of those {todayP2Type === 'high' ? 'highs' : 'lows'} became P1 after reaching this level</div>
            <div className="font-bold">{becameP1Pct}%</div>
          </div>
        </div>

        {/* P2 Status */}
        <div className="space-y-2">
          <div className="font-bold text-foreground border-b border-border pb-1">P2 Status</div>
          <div 
            className="grid grid-cols-[1fr_auto] gap-2 items-center py-1 hover:bg-muted/50 cursor-pointer transition-colors rounded px-1 -mx-1"
            onClick={() => onHighlight?.({ chartId: 'p1-p2', mode: 'gt', value: currentDisp })}
          >
            <div className="text-muted-foreground">% of days with more than {currentDisp.toFixed(1)}% total displacement</div>
            <div className="font-bold">{dispExceedsPct}%</div>
          </div>
        </div>

        {/* Distance Summary */}
        <div className="space-y-3">
          <div>
            <div className="font-bold text-foreground mb-0.5">Distance Summary for Current Day — {ticker}</div>
            <div className="text-[10px] text-muted-foreground italic">Statistics are based on {selectedWeekdaysCount > 0 ? 'selected days' : 'all days'} only</div>
          </div>
          <div className="space-y-2">
            <div 
              className="bg-card border border-border rounded p-2.5 flex items-start gap-2.5 shadow-sm hover:bg-muted/50 cursor-pointer transition-colors"
              onClick={() => onHighlight?.({ chartId: 'open-p1', mode: p1IsLow ? 'lt' : 'gt', value: p1DistPct })}
            >
              <AlertTriangle className={cn("h-4 w-4 mt-0.5 shrink-0", flipRiskColor)} />
              <div>
                <span className={cn("font-bold", flipRiskColor)}>{flipRiskLevel} P1 flip risk</span>
                <span className="text-muted-foreground"> — {flipRiskPct}% of days took out the daily {todayP1Type} (P1)</span>
              </div>
            </div>
            
            <div 
              className="bg-card border border-border rounded p-2.5 flex items-start gap-2.5 shadow-sm hover:bg-muted/50 cursor-pointer transition-colors"
              onClick={() => onHighlight?.({ chartId: 'p1-p2', mode: 'gt', value: currentDisp })}
            >
              {p2InLikely === 'Likely' ? (
                <CheckCircle className={cn("h-4 w-4 mt-0.5 shrink-0", p2InColor)} />
              ) : (
                <X className={cn("h-4 w-4 mt-0.5 shrink-0", p2InColor)} />
              )}
              <div>
                <span className={cn("font-bold", p2InColor)}>{p2InLikely} that P2 is in</span>
                <span className="text-muted-foreground"> — {dispExceedsPct}% of days moved further than {currentDisp.toFixed(1)}%</span>
              </div>
            </div>

            {flipRiskLevel === 'Low' && p2InLikely === 'Likely' && (
              <div className="bg-card border border-border rounded p-2.5 flex items-start gap-2.5 shadow-sm">
                <Check className="h-4 w-4 mt-0.5 shrink-0 text-green-500" />
                <div className="font-bold text-green-500">No Warnings</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Memoized Row Component for better performance
const PivotRow = memo(({ 
  stat, 
  isDark, 
  heatmapScheme, 
  intensity, 
  currentHour, 
  todayP1Hour, 
  todayP2Hour, 
  popoverOpen, 
  setPopoverOpen, 
  dailyPivots 
}: {
  stat: HourlyStats,
  isDark: boolean,
  heatmapScheme: HeatmapScheme,
  intensity: number,
  currentHour: number,
  todayP1Hour: number | null,
  todayP2Hour: number | null,
  popoverOpen: string | null,
  setPopoverOpen: (id: string | null) => void,
  dailyPivots: any[]
}) => {
  const p1Color = getHeatmapColor(stat.p1Probability, isDark, heatmapScheme, intensity)
  const p2Color = getHeatmapColor(stat.p2Probability, isDark, heatmapScheme, intensity)
  const p1TextColor = getTextColor(p1Color)
  const p2TextColor = getTextColor(p2Color)
  const isCurrentHour = stat.hour === currentHour
  const isTodayP1 = todayP1Hour !== null && stat.hour === todayP1Hour
  const isTodayP2 = todayP2Hour !== null && stat.hour === todayP2Hour

  const p1PopoverId = `p1-${stat.hour}`
  const p2PopoverId = `p2-${stat.hour}`
  const isP1Open = popoverOpen === p1PopoverId
  const isP2Open = popoverOpen === p2PopoverId

  return (
    <tr
      className={cn(
        "border-b border-border/50 cursor-pointer transition-none",
        // Removed hover effect to prevent glitching
        isCurrentHour && "ring-2 ring-inset ring-primary/50"
      )}
    >
      <td className={cn(
        "px-4 py-2 font-bold",
        isCurrentHour && "text-primary"
      )}>
        {String(stat.hour).padStart(2, '0')}:00
      </td>
      <td
        className="px-4 py-2 text-right font-semibold"
        style={{
          backgroundColor: p1Color,
          color: p1TextColor,
        }}
      >
        <div className="flex items-center justify-end gap-1">
          {isTodayP1 && (
            <Check className="h-3 w-3 stroke-[3] text-green-500" />
          )}
          <span>{stat.p1Probability.toFixed(1)}</span>
        </div>
      </td>
      <td className="px-4 py-2 text-right text-xs opacity-70 hover:opacity-100">
        <Popover open={isP1Open} onOpenChange={(open) => setPopoverOpen(open ? p1PopoverId : null)}>
          <PopoverTrigger asChild>
            <button className="hover:underline decoration-current underline-offset-2">
              {stat.lastP1DaysAgo !== null ? `${stat.lastP1DaysAgo}d` : '-'}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-60 p-3" align="end">
            <div className="space-y-2">
              <h4 className="font-semibold text-xs font-mono">P1 at {String(stat.hour).padStart(2, '0')}:00</h4>
              <div className="max-h-48 overflow-auto space-y-1">
                {dailyPivots
                  .filter(p => p.p1Hour === stat.hour)
                  .slice(-10)
                  .reverse()
                  .map((p, idx) => (
                    <div key={idx} className="text-xs font-mono text-muted-foreground flex justify-between">
                      <span>{p.date}</span>
                      <span className={p.p1Type === 'high' ? 'text-green-500' : 'text-red-500'}>
                        {p.p1Type === 'high' ? '↑' : '↓'}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </td>
      <td
        className="px-4 py-2 text-right font-semibold"
        style={{
          backgroundColor: p2Color,
          color: p2TextColor,
        }}
      >
        <div className="flex items-center justify-end gap-1">
          {isTodayP2 && (
            <Check className="h-3 w-3 stroke-[3] text-green-500" />
          )}
          <span>{stat.p2Probability.toFixed(1)}</span>
        </div>
      </td>
      <td className="px-4 py-2 text-right text-xs opacity-70 hover:opacity-100">
        <Popover open={isP2Open} onOpenChange={(open) => setPopoverOpen(open ? p2PopoverId : null)}>
          <PopoverTrigger asChild>
            <button className="hover:underline decoration-current underline-offset-2">
              {stat.lastP2DaysAgo !== null ? `${stat.lastP2DaysAgo}d` : '-'}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-60 p-3" align="end">
            <div className="space-y-2">
              <h4 className="font-semibold text-xs font-mono">P2 at {String(stat.hour).padStart(2, '0')}:00</h4>
              <div className="max-h-48 overflow-auto space-y-1">
                {dailyPivots
                  .filter(p => p.p2Hour === stat.hour)
                  .slice(-10)
                  .reverse()
                  .map((p, idx) => (
                    <div key={idx} className="text-xs font-mono text-muted-foreground flex justify-between">
                      <span>{p.date}</span>
                      <span className={p.p2Type === 'high' ? 'text-green-500' : 'text-red-500'}>
                        {p.p2Type === 'high' ? '↑' : '↓'}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </td>
    </tr>
  )
}, (prev, next) => {
  const p1Id = `p1-${prev.stat.hour}`
  const p2Id = `p2-${prev.stat.hour}`
  
  const prevP1Open = prev.popoverOpen === p1Id
  const prevP2Open = prev.popoverOpen === p2Id
  const nextP1Open = next.popoverOpen === p1Id
  const nextP2Open = next.popoverOpen === p2Id

  return (
    prev.stat === next.stat &&
    prev.isDark === next.isDark &&
    prev.heatmapScheme === next.heatmapScheme &&
    prev.intensity === next.intensity &&
    prev.currentHour === next.currentHour &&
    prev.todayP1Hour === next.todayP1Hour &&
    prev.todayP2Hour === next.todayP2Hour &&
    prev.dailyPivots === next.dailyPivots &&
    prevP1Open === nextP1Open &&
    prevP2Open === nextP2Open
  )
})

// Memoized Weekly Row Component
const WeeklyRow = memo(({ 
  stat, 
  isDark, 
  heatmapScheme, 
  intensity, 
  currentDay, 
  thisWeekP1Day, 
  thisWeekP2Day, 
  popoverOpen, 
  setPopoverOpen, 
  weeklyPivots 
}: {
  stat: DailyStats,
  isDark: boolean,
  heatmapScheme: HeatmapScheme,
  intensity: number,
  currentDay: number,
  thisWeekP1Day: number | null,
  thisWeekP2Day: number | null,
  popoverOpen: string | null,
  setPopoverOpen: (id: string | null) => void,
  weeklyPivots: WeeklyPivot[]
}) => {
  const p1Color = getHeatmapColor(stat.p1Probability, isDark, heatmapScheme, intensity)
  const p2Color = getHeatmapColor(stat.p2Probability, isDark, heatmapScheme, intensity)
  const p1TextColor = getTextColor(p1Color)
  const p2TextColor = getTextColor(p2Color)
  const isCurrentDay = stat.day === currentDay
  const isThisWeekP1 = thisWeekP1Day !== null && stat.day === thisWeekP1Day
  const isThisWeekP2 = thisWeekP2Day !== null && stat.day === thisWeekP2Day

  const p1PopoverId = `wp1-${stat.day}`
  const p2PopoverId = `wp2-${stat.day}`
  const isP1Open = popoverOpen === p1PopoverId
  const isP2Open = popoverOpen === p2PopoverId
  
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const dayShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <tr
      className={cn(
        "border-b border-border/50 cursor-pointer transition-none",
        isCurrentDay && "ring-2 ring-inset ring-primary/50"
      )}
    >
      <td className={cn(
        "px-4 py-2 font-bold",
        isCurrentDay && "text-primary"
      )}>
        {dayNames[stat.day]}
      </td>
      <td
        className="px-4 py-2 text-right font-semibold"
        style={{
          backgroundColor: p1Color,
          color: p1TextColor,
        }}
      >
        <div className="flex items-center justify-end gap-1">
          {isThisWeekP1 && (
            <Check className="h-3 w-3 stroke-[3] text-green-500" />
          )}
          <span>{stat.p1Probability.toFixed(1)}</span>
        </div>
      </td>
      <td className="px-4 py-2 text-right text-xs opacity-70 hover:opacity-100">
        <Popover open={isP1Open} onOpenChange={(open) => setPopoverOpen(open ? p1PopoverId : null)}>
          <PopoverTrigger asChild>
            <button className="hover:underline decoration-current underline-offset-2">
              {stat.lastP1WeeksAgo !== null ? `${stat.lastP1WeeksAgo}w` : '-'}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-60 p-3" align="end">
            <div className="space-y-2">
              <h4 className="font-semibold text-xs font-mono">P1 on {dayShort[stat.day]}</h4>
              <div className="max-h-48 overflow-auto space-y-1">
                {weeklyPivots
                  .filter(p => p.p1Day === stat.day)
                  .slice(-10)
                  .reverse()
                  .map((p, idx) => (
                    <div key={idx} className="text-xs font-mono text-muted-foreground flex justify-between">
                      <span>W{p.weekNumber} {p.year}</span>
                      <span className={p.p1Type === 'high' ? 'text-green-500' : 'text-red-500'}>
                        {p.p1Type === 'high' ? '↑' : '↓'}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </td>
      <td
        className="px-4 py-2 text-right font-semibold"
        style={{
          backgroundColor: p2Color,
          color: p2TextColor,
        }}
      >
        <div className="flex items-center justify-end gap-1">
          {isThisWeekP2 && (
            <Check className="h-3 w-3 stroke-[3] text-green-500" />
          )}
          <span>{stat.p2Probability.toFixed(1)}</span>
        </div>
      </td>
      <td className="px-4 py-2 text-right text-xs opacity-70 hover:opacity-100">
        <Popover open={isP2Open} onOpenChange={(open) => setPopoverOpen(open ? p2PopoverId : null)}>
          <PopoverTrigger asChild>
            <button className="hover:underline decoration-current underline-offset-2">
              {stat.lastP2WeeksAgo !== null ? `${stat.lastP2WeeksAgo}w` : '-'}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-60 p-3" align="end">
            <div className="space-y-2">
              <h4 className="font-semibold text-xs font-mono">P2 on {dayShort[stat.day]}</h4>
              <div className="max-h-48 overflow-auto space-y-1">
                {weeklyPivots
                  .filter(p => p.p2Day === stat.day)
                  .slice(-10)
                  .reverse()
                  .map((p, idx) => (
                    <div key={idx} className="text-xs font-mono text-muted-foreground flex justify-between">
                      <span>W{p.weekNumber} {p.year}</span>
                      <span className={p.p2Type === 'high' ? 'text-green-500' : 'text-red-500'}>
                        {p.p2Type === 'high' ? '↑' : '↓'}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </td>
    </tr>
  )
}, (prev, next) => {
  const p1Id = `wp1-${prev.stat.day}`
  const p2Id = `wp2-${prev.stat.day}`
  
  const prevP1Open = prev.popoverOpen === p1Id
  const prevP2Open = prev.popoverOpen === p2Id
  const nextP1Open = next.popoverOpen === p1Id
  const nextP2Open = next.popoverOpen === p2Id

  return (
    prev.stat === next.stat &&
    prev.isDark === next.isDark &&
    prev.heatmapScheme === next.heatmapScheme &&
    prev.intensity === next.intensity &&
    prev.currentDay === next.currentDay &&
    prev.thisWeekP1Day === next.thisWeekP1Day &&
    prev.thisWeekP2Day === next.thisWeekP2Day &&
    prev.weeklyPivots === next.weeklyPivots &&
    prevP1Open === nextP1Open &&
    prevP2Open === nextP2Open
  )
})

export default function PivotAnalysisPage() {
  // Use persistent global state
  const { pivotAnalysisSettings, updatePivotAnalysisSettings } = useAppState()
  
  // Destructure settings for easier access
  const { ticker, selectedWeekdays, heatmapScheme, intensity: savedIntensity, daysBack } = pivotAnalysisSettings
  
  // Helper functions to update settings
  const setTicker = (value: string) => updatePivotAnalysisSettings({ ticker: value })
  const setSelectedWeekdays = (value: number[]) => updatePivotAnalysisSettings({ selectedWeekdays: value })
  const setHeatmapScheme = (value: HeatmapScheme) => updatePivotAnalysisSettings({ heatmapScheme: value })
  const updateIntensity = (value: number) => updatePivotAnalysisSettings({ intensity: value })
  
  // State for intensity slider (array format for UI component)
  const [intensity, setIntensity] = useState([savedIntensity])
  
  // Sync intensity with global state
  useEffect(() => {
    updateIntensity(intensity[0])
  }, [intensity])
  
  // Date range calculated from daysBack
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), daysBack),
    to: new Date(),
  })
  
  // Update daysBack when date range changes
  useEffect(() => {
    if (dateRange?.from) {
      const days = Math.ceil((new Date().getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24))
      updatePivotAnalysisSettings({ daysBack: days })
    }
  }, [dateRange])
  
  // Local UI state (not persisted)
  const [tickers, setTickers] = useState<string[]>([])
  const [tickerSearch, setTickerSearch] = useState('')
  const [tickerOpen, setTickerOpen] = useState(false)
  const [weekdayOpen, setWeekdayOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hourlyStats, setHourlyStats] = useState<HourlyStats[]>([])
  const [lastFetch, setLastFetch] = useState<Date | null>(null)
  const adjustForToday = false // Don't adjust for current day
  const [isDark, setIsDark] = useState(false)
  const [currentHour, setCurrentHour] = useState(new Date().getUTCHours())
  const [todayP1Hour, setTodayP1Hour] = useState<number | null>(null)
  const [todayP2Hour, setTodayP2Hour] = useState<number | null>(null)
  const [dailyPivots, setDailyPivots] = useState<DailyPivot[]>([])
  const [popoverOpen, setPopoverOpen] = useState<string | null>(null)
  const [todayP1Time, setTodayP1Time] = useState<string | null>(null)
  const [todayP2Time, setTodayP2Time] = useState<string | null>(null)
  const [todayP1Type, setTodayP1Type] = useState<'high' | 'low' | null>(null)
  const [todayP2Type, setTodayP2Type] = useState<'high' | 'low' | null>(null)
  const [todayChartData, setTodayChartData] = useState<any[]>([])
  const [todayP1Price, setTodayP1Price] = useState<number | null>(null)
  const [todayP2Price, setTodayP2Price] = useState<number | null>(null)
  const [selectedBin, setSelectedBin] = useState<{ bin: HistogramBin; type: 'open-p1' | 'p1-p2' } | null>(null)
  const [activeHighlight, setActiveHighlight] = useState<ChartHighlight>(null)
  
  // Weekly analysis state
  const [weeklyPivots, setWeeklyPivots] = useState<WeeklyPivot[]>([])
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([])
  const [currentDay, setCurrentDay] = useState(new Date().getUTCDay())
  const [thisWeekP1Day, setThisWeekP1Day] = useState<number | null>(null)
  const [thisWeekP2Day, setThisWeekP2Day] = useState<number | null>(null)

  // Update current hour and day every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentHour(new Date().getUTCHours())
      setCurrentDay(new Date().getUTCDay())
    }, 60000) // Update every minute
    
    return () => clearInterval(interval)
  }, [])

  // Detect dark mode
  useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'))
    }
    checkDarkMode()
    
    const observer = new MutationObserver(checkDarkMode)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    
    return () => observer.disconnect()
  }, [])

  // Fetch available tickers from Bybit
  useEffect(() => {
    const fetchTickers = async () => {
      try {
        const response = await fetch('/api/bybit-tickers')
        if (response.ok) {
          const data = await response.json()
          if (data.tickers && Array.isArray(data.tickers)) {
            setTickers(data.tickers)
          }
        }
      } catch (err) {
        console.error('Failed to fetch tickers:', err)
      }
    }
    fetchTickers()
  }, [])

  // Filter tickers based on search
  const filteredTickers = useMemo(() => {
    if (!tickerSearch) return tickers
    const search = tickerSearch.toLowerCase()
    return tickers.filter(t => t.toLowerCase().includes(search))
  }, [tickers, tickerSearch])

  // Fetch and calculate pivot data
  const fetchPivotData = useCallback(async () => {
    if (!dateRange?.from || !dateRange?.to) {
      setError('Please select a date range')
      return
    }

    setLoading(true)
    setError(null)

    try {
      let startMs = dateRange.from.getTime()
      let endMs = dateRange.to.getTime()
      const nowMs = Date.now()
      const oneHourMs = 60 * 60 * 1000
      
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        throw new Error('Invalid date range')
      }
      
      if (endMs < startMs) {
        const temp = startMs
        startMs = endMs
        endMs = temp
      }
      
      if (endMs > nowMs) {
        endMs = nowMs
      }
      
      if (startMs > nowMs) {
        startMs = nowMs - oneHourMs
      }
      
      // Ensure we always request at least one hour of data
      if (endMs - startMs < oneHourMs) {
        startMs = Math.max(0, endMs - oneHourMs)
      }
      
      const daysDiff = Math.max(1, Math.ceil((endMs - startMs) / (1000 * 60 * 60 * 24)))
      
      // Limit to reasonable date range to avoid rate limiting
      if (daysDiff > 365) {
        throw new Error('Date range cannot exceed 365 days. Please select a shorter period.')
      }
      
      const hoursNeeded = Math.max(1, Math.ceil((endMs - startMs) / (1000 * 60 * 60)))
      const maxCandlesPerRequest = 1000
      const chunks = Math.max(1, Math.ceil(hoursNeeded / maxCandlesPerRequest))
      
      // Log for debugging
      console.log(`Fetching ${daysDiff} days (${hoursNeeded} hours) in ${chunks} chunks for ${ticker}`)
      
      let allCandles: any[] = []
      
      const fetchWithTimeout = async (url: string, timeoutMs: number) => {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
        try {
          return await fetch(url, { signal: controller.signal })
        } finally {
          clearTimeout(timeoutId)
        }
      }
      
      for (let i = 0; i < chunks; i++) {
        const chunkStart = startMs + (i * maxCandlesPerRequest * 60 * 60 * 1000)
        const chunkEnd = Math.min(
          chunkStart + (maxCandlesPerRequest * 60 * 60 * 1000),
          endMs
        )
        
        const params = new URLSearchParams({
          symbol: ticker,
          interval: '60',
          start: chunkStart.toString(),
          end: chunkEnd.toString(),
          limit: '1000',
        })
        
        // Add delay between requests to avoid rate limiting (except for first request)
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 200)) // 200ms delay
        }
        
        const response = await fetchWithTimeout(
          `/api/bybit-intraday?${params.toString()}`,
          15000
        )
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          const errorMsg = errorData.retMsg || `API returned status ${response.status}`
          
          // Provide more helpful error messages
          if (response.status === 403) {
            throw new Error(`Access forbidden (403): ${errorMsg}. Try reducing the date range or waiting a moment before retrying. Bybit may be rate limiting or blocking requests.`)
          } else if (response.status === 429) {
            throw new Error(`Rate limit exceeded (429): ${errorMsg}. Please wait a moment before retrying.`)
          } else {
            throw new Error(`Failed to fetch data: ${errorMsg}`)
          }
        }
        
        const result = await response.json()
        
        if (result.retCode !== 0) {
          throw new Error(result.retMsg || 'Failed to fetch kline data')
        }
        
        if (result.result?.list) {
          allCandles = [...allCandles, ...result.result.list.reverse()]
        }
      }
      
      if (allCandles.length === 0) {
        throw new Error('No data available for the selected date range')
      }
      
      const hourlyCandles = parseHourlyCandles(allCandles)
      const pivots = calculateDailyPivots(hourlyCandles)
      
      // Store daily pivots for popover display
      setDailyPivots(pivots)
      
      // Find today's P1 and P2 hours
      const today = new Date()
      const todayKey = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`
      const todayPivot = pivots.find(p => p.date === todayKey)
      
      if (todayPivot) {
        setTodayP1Hour(todayPivot.p1Hour)
        setTodayP2Hour(todayPivot.p2Hour)
        setTodayP1Type(todayPivot.p1Type)
        setTodayP2Type(todayPivot.p2Type)
      } else {
        setTodayP1Hour(null)
        setTodayP2Hour(null)
        setTodayP1Type(null)
        setTodayP2Type(null)
      }
      
      // Fetch 15-minute data for today to get precise times
      if (todayPivot) {
        try {
          const todayStart = new Date(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()).getTime()
          const todayEnd = todayStart + (24 * 60 * 60 * 1000)
          
          const params15m = new URLSearchParams({
            symbol: ticker,
            interval: '15',
            start: todayStart.toString(),
            end: todayEnd.toString(),
            limit: '100',
          })
          
          const response15m = await fetchWithTimeout(
            `/api/bybit-intraday?${params15m.toString()}`,
            15000
          )
          if (response15m.ok) {
            const result15m = await response15m.json()
            if (result15m.retCode === 0 && result15m.result?.list) {
              const candles15m = result15m.result.list.reverse()
              
              // Find the actual daily high and low from all candles
              let actualDailyHigh = -Infinity
              let actualDailyLow = Infinity
              
              for (const candle of candles15m) {
                const h = parseFloat(candle[2])
                const l = parseFloat(candle[3])
                if (h > actualDailyHigh) actualDailyHigh = h
                if (l < actualDailyLow) actualDailyLow = l
              }
              
              // Now find when each was first reached
              let highTime = null
              let lowTime = null
              let highTimestamp = Infinity
              let lowTimestamp = Infinity
              
              for (const candle of candles15m) {
                const [timestamp, open, high, low, close] = candle
                const ts = parseInt(timestamp)
                const h = parseFloat(high)
                const l = parseFloat(low)
                
                // Check if this candle contains the daily high (within tolerance)
                if (!highTime && Math.abs(h - actualDailyHigh) < 0.01) {
                  highTime = ts
                  highTimestamp = ts
                }
                
                // Check if this candle contains the daily low (within tolerance)
                if (!lowTime && Math.abs(l - actualDailyLow) < 0.01) {
                  lowTime = ts
                  lowTimestamp = ts
                }
                
                if (highTime && lowTime) break
              }
              
              // Format times and prepare chart data
              let p1Time = null
              let p2Time = null
              let p1Price = null
              let p2Price = null
              
              if (highTimestamp < lowTimestamp) {
                // High came first = P1
                if (highTime) {
                  const date = new Date(highTime)
                  p1Time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
                  p1Price = actualDailyHigh
                }
                if (lowTime) {
                  const date = new Date(lowTime)
                  p2Time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
                  p2Price = actualDailyLow
                }
              } else {
                // Low came first = P1
                if (lowTime) {
                  const date = new Date(lowTime)
                  p1Time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
                  p1Price = actualDailyLow
                }
                if (highTime) {
                  const date = new Date(highTime)
                  p2Time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
                  p2Price = actualDailyHigh
                }
              }
              
              // Prepare chart data
              const chartData = candles15m.map((candle: any) => {
                const [timestamp, open, high, low, close] = candle
                const date = new Date(parseInt(timestamp))
                return {
                  time: `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`,
                  timestamp: parseInt(timestamp),
                  price: parseFloat(close),
                  high: parseFloat(high),
                  low: parseFloat(low),
                }
              })
              
              setTodayP1Time(p1Time)
              setTodayP2Time(p2Time)
              setTodayP1Price(p1Price)
              setTodayP2Price(p2Price)
              setTodayChartData(chartData)
            }
          }
        } catch (err) {
          console.error('Failed to fetch 15m data:', err)
        }
      } else {
        setTodayP1Time(null)
        setTodayP2Time(null)
        setTodayP1Price(null)
        setTodayP2Price(null)
        setTodayChartData([])
      }
      
      const stats = calculateHourlyStats(
        pivots,
        selectedWeekdays.length > 0 ? selectedWeekdays : undefined
      )
      
      const currentUTCHour = new Date().getUTCHours()
      const finalStats = adjustForToday 
        ? adjustForCurrentDay(stats, currentUTCHour)
        : stats
      
      setHourlyStats(finalStats)
      
      // Calculate weekly pivots and daily stats
      const weeklyPivotsData = calculateWeeklyPivots(pivots)
      setWeeklyPivots(weeklyPivotsData)
      
      const dailyStatsData = calculateDailyStats(weeklyPivotsData)
      setDailyStats(dailyStatsData)
      
      // Find this week's P1 and P2 days
      const now = new Date()
      const thisWeekStart = new Date(now)
      const dayOfWeek = now.getUTCDay()
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
      thisWeekStart.setUTCDate(thisWeekStart.getUTCDate() + diff)
      thisWeekStart.setUTCHours(0, 0, 0, 0)
      const thisWeekKey = thisWeekStart.toISOString().split('T')[0]
      const thisWeekPivot = weeklyPivotsData.find(p => p.weekStart === thisWeekKey)
      
      if (thisWeekPivot) {
        setThisWeekP1Day(thisWeekPivot.p1Day)
        setThisWeekP2Day(thisWeekPivot.p2Day)
      } else {
        setThisWeekP1Day(null)
        setThisWeekP2Day(null)
      }
      
      setLastFetch(new Date())
    } catch (err) {
      console.error('Error fetching pivot data:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch pivot data')
    } finally {
      setLoading(false)
    }
  }, [ticker, dateRange, selectedWeekdays, adjustForToday])

  // Auto-fetch on mount and when parameters change
  useEffect(() => {
    if (ticker && dateRange?.from && dateRange?.to) {
      fetchPivotData()
    }
  }, [ticker, dateRange?.from, dateRange?.to, selectedWeekdays, adjustForToday, fetchPivotData])

  const toggleWeekday = (value: number) => {
    setSelectedWeekdays(
      selectedWeekdays.includes(value)
        ? selectedWeekdays.filter(v => v !== value)
        : [...selectedWeekdays, value]
    )
  }

  const selectWeekdayPreset = (preset: 'all' | 'weekdays' | 'weekend') => {
    if (preset === 'all') {
      setSelectedWeekdays([])
    } else if (preset === 'weekdays') {
      setSelectedWeekdays([1, 2, 3, 4, 5]) // Mon-Fri
    } else if (preset === 'weekend') {
      setSelectedWeekdays([0, 6]) // Sat-Sun
    }
  }

  const filteredDailyPivots = useMemo(() => {
    if (selectedWeekdays.length === 0) return dailyPivots
    return dailyPivots.filter(p => selectedWeekdays.includes(p.dayOfWeek))
  }, [dailyPivots, selectedWeekdays])

  const openToP1Distances = useMemo(() => (
    filteredDailyPivots.map(p => ((p.p1Price - p.open) / p.open) * 100)
  ), [filteredDailyPivots])

  const p1ToP2Distances = useMemo(() => (
    filteredDailyPivots.map(p => ((p.p2Price - p.p1Price) / (p.p1Price || p.open)) * 100)
  ), [filteredDailyPivots])

  const openToP1Histogram = useMemo(() => buildHistogram(openToP1Distances, 34), [openToP1Distances])
  const p1ToP2Histogram = useMemo(() => buildHistogram(p1ToP2Distances, 34), [p1ToP2Distances])

  const distanceSubtitle =
    selectedWeekdays.length === 0
      ? 'Statistics include all days'
      : 'Statistics limited to selected weekdays'

  const todayKey = format(new Date(), 'yyyy-MM-dd')
  const todayPivot = useMemo(
    () => dailyPivots.find(p => p.date === todayKey),
    [dailyPivots, todayKey]
  )

  const todayHighFromOpenPct = todayPivot && todayPivot.open
    ? ((todayPivot.high - todayPivot.open) / todayPivot.open) * 100
    : null
  const todayLowFromOpenPct = todayPivot && todayPivot.open
    ? ((todayPivot.low - todayPivot.open) / todayPivot.open) * 100
    : null

  const openDistanceReferenceLines = useMemo<ReferenceLineConfig[] | undefined>(() => {
    if (todayHighFromOpenPct === null || todayLowFromOpenPct === null) return undefined

    return [
      {
        value: todayLowFromOpenPct,
        color: '#ef4444',
        label: `Current Low: ${todayLowFromOpenPct.toFixed(1)}%`,
      },
      {
        value: todayHighFromOpenPct,
        color: '#22c55e',
        label: `Current High: ${todayHighFromOpenPct.toFixed(1)}%`,
      },
    ]
  }, [todayHighFromOpenPct, todayLowFromOpenPct])

  // Memoize Key Insights calculation
  const keyInsights = useMemo(() => {
    if (todayP1Hour === null || todayP2Hour === null) return null

    // Filter pivots by selected weekdays to match table data
    const filteredPivots = filteredDailyPivots
    
    const totalDays = filteredPivots.length
    if (totalDays === 0) return null
    
    // Calculate all percentages
    const p1AfterP1 = filteredPivots.filter(p => p.p1Hour > todayP1Hour).length
    const p1AtOrAfterP2 = filteredPivots.filter(p => p.p1Hour >= todayP2Hour).length
    const p2AfterP2 = filteredPivots.filter(p => p.p2Hour > todayP2Hour).length
    const p2AfterNow = filteredPivots.filter(p => p.p2Hour > currentHour).length
    
    const pct1 = ((p1AfterP1 / totalDays) * 100).toFixed(1)
    const pct2 = ((p1AtOrAfterP2 / totalDays) * 100).toFixed(1)
    const pct3 = ((p2AfterP2 / totalDays) * 100).toFixed(1)
    const pct4 = ((p2AfterNow / totalDays) * 100).toFixed(1)
    
    const flipRisk = parseFloat(pct2) < 20 ? 'Low' : parseFloat(pct2) < 40 ? 'Moderate' : 'High'
    const flipRiskColor = parseFloat(pct2) < 20 ? 'text-green-500' : parseFloat(pct2) < 40 ? 'text-amber-500' : 'text-red-500'
    
    // High % means P2 still to come = UNLIKELY P2 is already in (RED = risky)
    // Low % means P2 unlikely to come = Likely P2 is in (GREEN = safe)
    const p2Likely = parseFloat(pct4) > 50 ? 'Unlikely' : 'Likely'
    const p2LikelyColor = parseFloat(pct4) > 50 ? 'text-red-500' : 'text-green-500'

    return {
      totalDays,
      pct1,
      pct2,
      pct3,
      pct4,
      flipRisk,
      flipRiskColor,
      p2Likely,
      p2LikelyColor
    }
  }, [todayP1Hour, todayP2Hour, filteredDailyPivots, currentHour])

  const renderControlSection = () => (
    <div className="border-b border-border bg-card px-4 py-3">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Ticker Search Dropdown */}
        <div className="w-40">
          <Popover open={tickerOpen} onOpenChange={setTickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={tickerOpen}
                className="w-full justify-between font-mono text-xs h-8"
              >
                {ticker}
                <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="start">
              <Command>
                <CommandInput 
                  placeholder="Search ticker..." 
                  value={tickerSearch}
                  onValueChange={setTickerSearch}
                />
                <CommandList>
                  <CommandEmpty>No ticker found.</CommandEmpty>
                  <CommandGroup>
                    {filteredTickers.slice(0, 100).map((t) => (
                      <CommandItem
                        key={t}
                        value={t}
                        onSelect={() => {
                          setTicker(t)
                          setTickerOpen(false)
                          setTickerSearch('')
                        }}
                        className="font-mono text-xs"
                      >
                        <Check
                          className={cn(
                            "mr-2 h-3 w-3",
                            ticker === t ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {t}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* Date Range Picker with Presets */}
        <DateRangePicker date={dateRange} onDateChange={setDateRange} />

        {/* Weekday Filter with Presets */}
        <DropdownMenu open={weekdayOpen} onOpenChange={setWeekdayOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-8 font-mono text-xs">
              {selectedWeekdays.length === 0
                ? 'All Days'
                : `${selectedWeekdays.length} day${selectedWeekdays.length === 1 ? '' : 's'}`}
              <ChevronDownIcon className="ml-2 h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52" onCloseAutoFocus={(e) => e.preventDefault()}>
            <DropdownMenuLabel className="font-mono text-xs">Quick Presets</DropdownMenuLabel>
            <div className="px-2 py-1 flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs flex-1"
                onClick={() => selectWeekdayPreset('all')}
              >
                All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs flex-1"
                onClick={() => selectWeekdayPreset('weekdays')}
              >
                Mon-Fri
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs flex-1"
                onClick={() => selectWeekdayPreset('weekend')}
              >
                Sat-Sun
              </Button>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="font-mono text-xs">Individual Days</DropdownMenuLabel>
            {WEEKDAY_OPTIONS.map(day => (
              <DropdownMenuCheckboxItem
                key={day.value}
                checked={selectedWeekdays.includes(day.value)}
                onCheckedChange={() => toggleWeekday(day.value)}
                onSelect={(e) => e.preventDefault()}
                className="font-mono text-xs"
              >
                {day.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Color Scheme Selector */}
        <Select value={heatmapScheme} onValueChange={(v) => setHeatmapScheme(v as HeatmapScheme)}>
          <SelectTrigger className="w-24 h-8 font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HEATMAP_SCHEMES.map(scheme => (
              <SelectItem key={scheme.value} value={scheme.value} className="font-mono text-xs">
                {scheme.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Intensity Slider */}
        <div className="flex items-center gap-3 w-52">
          <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">Int:</span>
          <Slider
            value={intensity}
            onValueChange={setIntensity}
            min={0.5}
            max={2.0}
            step={0.1}
            className="flex-1"
            fancy
          />
          <span className="text-xs text-muted-foreground font-mono w-8">{intensity[0].toFixed(1)}</span>
        </div>

        {/* Fetch Button */}
        <Button
          onClick={fetchPivotData}
          disabled={loading}
          size="sm"
          className="h-8 font-mono text-xs"
        >
          {loading ? 'Loading...' : 'fetch ⚡'}
        </Button>

        {/* Last Update */}
        {lastFetch && (
          <div className="ml-auto text-xs text-muted-foreground font-mono">
            {format(lastFetch, 'HH:mm:ss')}
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="mt-2 p-2 bg-destructive/10 border border-destructive rounded flex items-center gap-2">
          <AlertCircle className="h-3 w-3 text-destructive" />
          <span className="text-xs text-destructive font-mono">{error}</span>
        </div>
      )}
    </div>
  )

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Two-Level Tab Hierarchy */}
      <Tabs defaultValue="time" className="flex flex-col h-full">
        <div className="border-b border-border bg-card px-4 py-2">
          <TabsList className="h-9">
            <TabsTrigger value="time" className="font-mono text-xs">Time</TabsTrigger>
            <TabsTrigger value="distance" className="font-mono text-xs">Distance</TabsTrigger>
            <TabsTrigger value="summary" className="font-mono text-xs">Summary</TabsTrigger>
          </TabsList>
        </div>

        {/* Time Tab Content with Sub-tabs */}
        <TabsContent value="time" className="flex-1 flex flex-col m-0">
          <Tabs defaultValue="daily" className="flex flex-col h-full">
            <div className="border-b border-border bg-muted/30 px-4 py-1.5">
              <TabsList className="h-8 bg-background">
                <TabsTrigger value="daily" className="font-mono text-xs">Daily</TabsTrigger>
                <TabsTrigger value="weekly" className="font-mono text-xs">Weekly</TabsTrigger>
                <TabsTrigger value="session" className="font-mono text-xs">Session</TabsTrigger>
              </TabsList>
            </div>

            {/* Daily Tab - Current Content */}
            <TabsContent value="daily" className="flex-1 flex flex-col m-0">
              {renderControlSection()}

      {/* Main Content: Table + Key Insights */}
      <div className="flex-1 overflow-hidden p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full flex-col gap-4">
            {/* Futuristic Loading Animation */}
            <div className="w-64 space-y-2">
              <div className="h-1.5 w-full bg-secondary overflow-hidden rounded-full">
                <div className="h-full bg-primary w-full origin-left animate-[shimmer_1s_infinite_linear] relative">
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -skew-x-12 animate-[shimmer_1s_infinite_linear]" />
                </div>
              </div>
              <div className="flex justify-between text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                <span>Loading Analysis</span>
                <span className="animate-pulse text-primary">processing...</span>
              </div>
            </div>
          </div>
        ) : hourlyStats.length > 0 ? (
          <div className="flex gap-4 h-full">
            {/* Left: Pivot Table (60%) */}
            <div className="w-[60%] flex flex-col">
              <div className="bg-card border border-border rounded overflow-hidden flex-1 flex flex-col">
                <div className="overflow-auto flex-1">
                  <table className="w-full font-mono text-sm">
                    <thead className="sticky top-0 bg-muted/50 z-10">
                      <tr className="border-b border-border">
                        <th className="px-4 py-2.5 text-left font-semibold">Hour</th>
                        <th className="px-4 py-2.5 text-right font-semibold">P1 %</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Last</th>
                        <th className="px-4 py-2.5 text-right font-semibold">P2 %</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Last</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hourlyStats.map(stat => (
                        <PivotRow
                          key={stat.hour}
                          stat={stat}
                          isDark={isDark}
                          heatmapScheme={heatmapScheme}
                          intensity={intensity[0]}
                          currentHour={currentHour}
                          todayP1Hour={todayP1Hour}
                          todayP2Hour={todayP2Hour}
                          popoverOpen={popoverOpen}
                          setPopoverOpen={setPopoverOpen}
                          dailyPivots={dailyPivots}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {/* Stats Footer - Fixed at bottom */}
                <div className="border-t border-border bg-muted/30 px-4 py-2 flex gap-4 text-xs font-mono">
                  <div>
                    <span className="text-muted-foreground">Days:</span>{' '}
                    <span className="font-bold">{hourlyStats[0]?.totalDays || 0}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Scheme:</span>{' '}
                    <span className="font-bold capitalize">{heatmapScheme}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Key Insights (40%) */}
            <div className="w-[40%] flex flex-col">
              <div className="bg-card border border-border rounded p-4 flex-1 overflow-auto">
                <h3 className="text-sm font-bold font-mono mb-4 text-foreground sticky top-0 bg-card pb-2 border-b border-border">Key Insights</h3>
                <div className="space-y-4 text-xs font-mono">
                  {keyInsights ? (
                    <>
                      {/* Data Points */}
                      <div className="text-muted-foreground">
                        <span className="font-bold text-foreground">{keyInsights.totalDays}</span> data points used - stats are reliable
                      </div>

                      {/* Asset Section */}
                      <div className="space-y-1 pt-2">
                        <div className="text-muted-foreground">
                          <span className="text-foreground font-bold">Asset:</span> {ticker}
                        </div>
                        <div className="text-muted-foreground pl-2">
                          <span className="text-foreground">Current P1:</span> Daily {todayP1Type} ({todayP1Time || `${String(todayP1Hour).padStart(2, '0')}:00`})
                        </div>
                        <div className="text-muted-foreground pl-2">
                          <span className="text-foreground">Current P2:</span> Daily {todayP2Type} ({todayP2Time || `${String(todayP2Hour).padStart(2, '0')}:00`})
                        </div>
                      </div>

                      {/* P1 Status */}
                      <div className="space-y-1 pt-2">
                        <div className="font-bold text-foreground">P1 Status</div>
                        <div className="text-muted-foreground pl-2">
                          <span className="text-foreground">{keyInsights.pct1}%</span> of P1's formed after {String(todayP1Hour).padStart(2, '0')}:00
                        </div>
                        <div className="text-muted-foreground pl-2">
                          <span className="text-foreground">{keyInsights.pct2}%</span> of P1's formed at or after {String(todayP2Hour).padStart(2, '0')}:00
                        </div>
                      </div>

                      {/* P2 Status */}
                      <div className="space-y-1 pt-2">
                        <div className="font-bold text-foreground">P2 Status</div>
                        <div className="text-muted-foreground pl-2">
                          <span className="text-foreground">{keyInsights.pct3}%</span> of P2's formed after {String(todayP2Hour).padStart(2, '0')}:00
                        </div>
                        <div className="text-muted-foreground pl-2">
                          <span className="text-foreground">{keyInsights.pct4}%</span> of P2's formed after {String(currentHour).padStart(2, '0')}:00
                        </div>
                      </div>

                      {/* Summary */}
                      <div className="space-y-1 pt-2 border-t border-border">
                        <div className="font-bold text-foreground">Summary</div>
                        <div className="text-muted-foreground">
                          <span className={cn("font-bold", keyInsights.flipRiskColor)}>{keyInsights.flipRisk}</span> P1 flip risk - <span className="text-foreground">{keyInsights.pct2}%</span> of days took out the daily {todayP1Type}
                        </div>
                        <div className="text-muted-foreground">
                          <span className={cn("font-bold", keyInsights.p2LikelyColor)}>{keyInsights.p2Likely}</span> P2 is in - <span className="text-foreground">{keyInsights.pct4}%</span> of days form a new P2 after {String(currentHour).padStart(2, '0')}:00
                        </div>
                      </div>

                      {/* Price Chart */}
                      {todayChartData.length > 0 && todayP1Price && todayP2Price && (
                        <div className="pt-2 border-t border-border">
                          <div className="font-bold text-foreground mb-2">Today's Price Action</div>
                          <div className="bg-muted/20 rounded border border-border p-3">
                            <ResponsiveContainer width="100%" height={320}>
                              <LineChart data={todayChartData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                                <XAxis 
                                  dataKey="time" 
                                  tick={{ fontSize: 10, fill: isDark ? '#aaa' : '#666' }}
                                  interval={Math.floor(todayChartData.length / 8)}
                                  tickMargin={5}
                                  stroke={isDark ? '#444' : '#ddd'}
                                />
                                <YAxis 
                                  domain={['dataMin - 0.5%', 'dataMax + 0.5%']}
                                  tick={{ fontSize: 10, fill: isDark ? '#aaa' : '#666' }}
                                  width={60}
                                  tickFormatter={(value) => value.toFixed(2)}
                                  stroke={isDark ? '#444' : '#ddd'}
                                />
                                <Tooltip 
                                  contentStyle={{ 
                                    backgroundColor: isDark ? '#1a1a1a' : '#fff',
                                    border: `1px solid ${isDark ? '#333' : '#ddd'}`,
                                    borderRadius: '6px',
                                    fontSize: '11px'
                                  }}
                                  labelStyle={{ fontSize: '10px', fontWeight: 'bold' }}
                                  formatter={(value: any) => [parseFloat(value).toFixed(2), 'Price']}
                                />
                                {/* P1 Reference Line */}
                                <ReferenceLine 
                                  y={todayP1Price} 
                                  stroke="#3b82f6" 
                                  strokeWidth={2}
                                  strokeDasharray="5 5"
                                  label={{ 
                                    value: `P1 ${todayP1Type === 'high' ? '↑' : '↓'} ${todayP1Price.toFixed(2)}`, 
                                    position: 'insideTopRight',
                                    fontSize: 10,
                                    fill: '#3b82f6',
                                    fontWeight: 'bold'
                                  }}
                                />
                                {/* P2 Reference Line */}
                                <ReferenceLine 
                                  y={todayP2Price} 
                                  stroke="#f59e0b" 
                                  strokeWidth={2}
                                  strokeDasharray="5 5"
                                  label={{ 
                                    value: `P2 ${todayP2Type === 'high' ? '↑' : '↓'} ${todayP2Price.toFixed(2)}`, 
                                    position: 'insideBottomRight',
                                    fontSize: 10,
                                    fill: '#f59e0b',
                                    fontWeight: 'bold'
                                  }}
                                />
                                {/* Price Line */}
                                <Line 
                                  type="monotone" 
                                  dataKey="price" 
                                  stroke={isDark ? '#10b981' : '#059669'}
                                  strokeWidth={2}
                                  dot={false}
                                  isAnimationActive={false}
                                />
                                {/* P1 Marker */}
                                {todayP1Time && (
                                  <ReferenceDot
                                    x={todayP1Time}
                                    y={todayP1Price}
                                    r={6}
                                    fill="#3b82f6"
                                    stroke="#fff"
                                    strokeWidth={2}
                                  />
                                )}
                                {/* P2 Marker */}
                                {todayP2Time && (
                                  <ReferenceDot
                                    x={todayP2Time}
                                    y={todayP2Price}
                                    r={6}
                                    fill="#f59e0b"
                                    stroke="#fff"
                                    strokeWidth={2}
                                  />
                                )}
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-muted-foreground">
                      No data for today. Fetch data to see insights.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-muted-foreground font-mono">
              Select ticker and date range to analyze
            </p>
          </div>
        )}
      </div>
            </TabsContent>

            {/* Weekly Tab */}
            <TabsContent value="weekly" className="flex-1 flex flex-col m-0">
              {renderControlSection()}

              {/* Main Content: Weekly Table */}
              <div className="flex-1 overflow-hidden p-4">
                {loading ? (
                  <div className="flex items-center justify-center h-full flex-col gap-4">
                    {/* Futuristic Loading Animation */}
                    <div className="w-64 space-y-2">
                      <div className="h-1.5 w-full bg-secondary overflow-hidden rounded-full">
                        <div className="h-full bg-primary w-full origin-left animate-[shimmer_1s_infinite_linear] relative">
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -skew-x-12 animate-[shimmer_1s_infinite_linear]" />
                        </div>
                      </div>
                      <div className="flex justify-between text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                        <span>Loading Weekly Analysis</span>
                        <span className="animate-pulse text-primary">processing...</span>
                      </div>
                    </div>
                  </div>
                ) : dailyStats.length > 0 ? (
                  <div className="flex gap-4 h-full">
                    {/* Weekly Pivot Table */}
                    <div className="w-full flex flex-col">
                      <div className="bg-card border border-border rounded overflow-hidden flex-1 flex flex-col">
                        <div className="overflow-auto flex-1">
                          <table className="w-full font-mono text-sm">
                            <thead className="sticky top-0 bg-muted/50 z-10">
                              <tr className="border-b border-border">
                                <th className="px-4 py-2.5 text-left font-semibold">Day of Week</th>
                                <th className="px-4 py-2.5 text-right font-semibold">P1 %</th>
                                <th className="px-4 py-2.5 text-right font-semibold">Last</th>
                                <th className="px-4 py-2.5 text-right font-semibold">P2 %</th>
                                <th className="px-4 py-2.5 text-right font-semibold">Last</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dailyStats.map(stat => (
                                <WeeklyRow
                                  key={stat.day}
                                  stat={stat}
                                  isDark={isDark}
                                  heatmapScheme={heatmapScheme}
                                  intensity={intensity[0]}
                                  currentDay={currentDay}
                                  thisWeekP1Day={thisWeekP1Day}
                                  thisWeekP2Day={thisWeekP2Day}
                                  popoverOpen={popoverOpen}
                                  setPopoverOpen={setPopoverOpen}
                                  weeklyPivots={weeklyPivots}
                                />
                              ))}
                            </tbody>
                          </table>
                        </div>
                        
                        {/* Stats Footer - Fixed at bottom */}
                        <div className="border-t border-border bg-muted/30 px-4 py-2 flex gap-4 text-xs font-mono">
                          <div>
                            <span className="text-muted-foreground">Weeks:</span>{' '}
                            <span className="font-bold">{dailyStats[0]?.totalWeeks || 0}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Scheme:</span>{' '}
                            <span className="font-bold capitalize">{heatmapScheme}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-xs text-muted-foreground font-mono">
                      Select ticker and date range to analyze weekly patterns
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Session Tab - Placeholder */}
            <TabsContent value="session" className="flex-1 flex flex-col m-0">
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-muted-foreground font-mono">
                  Session pivot analysis coming soon
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* Distance Tab */}
        <TabsContent value="distance" className="flex-1 flex flex-col m-0">
          <Tabs defaultValue="daily" className="flex flex-col h-full">
            <div className="border-b border-border bg-muted/30 px-4 py-1.5">
              <TabsList className="h-8 bg-background">
                <TabsTrigger value="daily" className="font-mono text-xs">Daily</TabsTrigger>
                <TabsTrigger value="weekly" className="font-mono text-xs">Weekly</TabsTrigger>
                <TabsTrigger value="session" className="font-mono text-xs">Session</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="daily" className="flex-1 flex flex-col m-0">
              {renderControlSection()}
              <div className="flex-1 overflow-hidden p-4">
                <div className="flex gap-4 h-full">
                  <div className="flex flex-col gap-3 flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground font-mono px-2 flex-none">
                      {filteredDailyPivots.length > 0
                        ? `${filteredDailyPivots.length} day${filteredDailyPivots.length === 1 ? '' : 's'} used for these distributions`
                        : 'Fetch data to populate the distance distributions'}
                    </div>
                    <div className="flex-1 flex flex-col gap-3 min-h-0">
                      <div className="h-[48%] min-h-0">
                        <HistogramCard
                          title="Open → P1 Distance Distribution"
                          subtitle={distanceSubtitle}
                          data={openToP1Histogram}
                          barColor="#3b82f6"
                          isDark={isDark}
                          referenceLines={openDistanceReferenceLines}
                          onBarClick={(bin) => setSelectedBin({ bin, type: 'open-p1' })}
                          highlightFilter={activeHighlight?.chartId === 'open-p1' ? activeHighlight : null}
                        />
                      </div>
                      <div className="h-[48%] min-h-0">
                        <HistogramCard
                          title="P1 → P2 Distance Distribution"
                          subtitle={distanceSubtitle}
                          data={p1ToP2Histogram}
                          barColor="#16a34a"
                          isDark={isDark}
                          onBarClick={(bin) => setSelectedBin({ bin, type: 'p1-p2' })}
                          highlightFilter={activeHighlight?.chartId === 'p1-p2' ? activeHighlight : null}
                        />
                      </div>
                    </div>
                  </div>
                  
                  {/* Key Insights Widget */}
                  <div className="w-[340px] flex-none h-full overflow-hidden">
                    <DistanceKeyInsightsWidget
                      ticker={ticker}
                      dataPoints={filteredDailyPivots.length}
                      todayOpen={todayPivot?.open ?? null}
                      todayP1Price={todayP1Price}
                      todayP2Price={todayP2Price}
                      todayP1Type={todayP1Type}
                      todayP2Type={todayP2Type}
                      filteredPivots={filteredDailyPivots}
                      isDark={isDark}
                      selectedWeekdaysCount={selectedWeekdays.length}
                      onHighlight={(highlight: ChartHighlight) => {
                        // Toggle logic: if clicking the same one, clear it
                        setActiveHighlight(prev => {
                          if (prev && highlight && 
                              prev.chartId === highlight.chartId && 
                              prev.mode === highlight.mode && 
                              prev.value === highlight.value) {
                            return null
                          }
                          return highlight
                        })
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Bin Details Dialog */}
              {selectedBin && (
                <div 
                  className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
                  onClick={() => setSelectedBin(null)}
                >
                  <div 
                    className="bg-card border border-border rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="border-b border-border px-4 py-3 flex items-center justify-between bg-muted/30">
                      <div>
                        <h3 className="text-sm font-bold font-mono text-foreground">
                          {selectedBin.type === 'open-p1' ? 'Open → P1' : 'P1 → P2'} Occurrences
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {selectedBin.bin.rangeLabel} • {selectedBin.bin.count} occurrence{selectedBin.bin.count === 1 ? '' : 's'}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedBin(null)}
                        className="h-7 w-7 p-0"
                      >
                        ✕
                      </Button>
                    </div>
                    <div className="overflow-auto flex-1 p-3">
                      <table className="w-full text-xs font-mono border-collapse">
                        <thead className="sticky top-0 bg-muted z-10">
                          <tr className="border-b-2 border-border">
                            <th className="text-left py-1.5 px-2 font-semibold">Date</th>
                            <th className="text-left py-1.5 px-2 font-semibold">Day</th>
                            <th className="text-right py-1.5 px-2 font-semibold">Open</th>
                            {selectedBin.type === 'open-p1' ? (
                              <>
                                <th className="text-right py-1.5 px-2 font-semibold">P1</th>
                                <th className="text-right py-1.5 px-2 font-semibold">Δ%</th>
                                <th className="text-center py-1.5 px-2 font-semibold">Type</th>
                              </>
                            ) : (
                              <>
                                <th className="text-right py-1.5 px-2 font-semibold">P1</th>
                                <th className="text-right py-1.5 px-2 font-semibold">P2</th>
                                <th className="text-right py-1.5 px-2 font-semibold">Δ%</th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredDailyPivots
                            .map((pivot, idx) => {
                              const distance = selectedBin.type === 'open-p1'
                                ? ((pivot.p1Price - pivot.open) / pivot.open) * 100
                                : ((pivot.p2Price - pivot.p1Price) / (pivot.p1Price || pivot.open)) * 100
                              return { pivot, distance, idx }
                            })
                            .filter(({ distance }) => distance >= selectedBin.bin.min && distance < selectedBin.bin.max)
                            .sort((a, b) => b.pivot.date.localeCompare(a.pivot.date))
                            .map(({ pivot, distance, idx }) => (
                              <tr key={idx} className="border-b border-border/30 hover:bg-muted/50 transition-colors">
                                <td className="py-1.5 px-2 whitespace-nowrap">{pivot.date}</td>
                                <td className="py-1.5 px-2 text-muted-foreground text-[10px] uppercase">
                                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][pivot.dayOfWeek]}
                                </td>
                                <td className="py-1.5 px-2 text-right tabular-nums">{pivot.open.toFixed(2)}</td>
                                {selectedBin.type === 'open-p1' ? (
                                  <>
                                    <td className="py-1.5 px-2 text-right tabular-nums">{pivot.p1Price.toFixed(2)}</td>
                                    <td className={cn(
                                      "py-1.5 px-2 text-right font-bold tabular-nums",
                                      distance >= 0 ? "text-green-500" : "text-red-500"
                                    )}>
                                      {distance >= 0 ? '+' : ''}{distance.toFixed(2)}
                                    </td>
                                    <td className="py-1.5 px-2 text-center">
                                      <span className={cn(
                                        "inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold",
                                        pivot.p1Type === 'high' ? "bg-green-500/20 text-green-500" : "bg-red-500/20 text-red-500"
                                      )}>
                                        {pivot.p1Type === 'high' ? '↑' : '↓'}
                                      </span>
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td className="py-1.5 px-2 text-right tabular-nums">{pivot.p1Price.toFixed(2)}</td>
                                    <td className="py-1.5 px-2 text-right tabular-nums">{pivot.p2Price.toFixed(2)}</td>
                                    <td className={cn(
                                      "py-1.5 px-2 text-right font-bold tabular-nums",
                                      distance >= 0 ? "text-green-500" : "text-red-500"
                                    )}>
                                      {distance >= 0 ? '+' : ''}{distance.toFixed(2)}
                                    </td>
                                  </>
                                )}
                              </tr>
                            ))}
                        </tbody>
                      </table>
                      {filteredDailyPivots
                        .map((pivot) => {
                          const distance = selectedBin.type === 'open-p1'
                            ? ((pivot.p1Price - pivot.open) / pivot.open) * 100
                            : ((pivot.p2Price - pivot.p1Price) / (pivot.p1Price || pivot.open)) * 100
                          return distance
                        })
                        .filter((distance) => distance >= selectedBin.bin.min && distance < selectedBin.bin.max).length === 0 && (
                        <div className="text-center py-8 text-muted-foreground text-xs">
                          No occurrences found in this range
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="weekly" className="flex-1 flex flex-col m-0">
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-muted-foreground font-mono">
                  Weekly distance analysis coming soon
                </p>
              </div>
            </TabsContent>

            <TabsContent value="session" className="flex-1 flex flex-col m-0">
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-muted-foreground font-mono">
                  Session distance analysis coming soon
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* Summary Tab - Placeholder */}
        <TabsContent value="summary" className="flex-1 flex flex-col m-0">
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground font-mono">
              Summary analysis coming soon
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
