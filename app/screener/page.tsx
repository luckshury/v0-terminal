'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Search, TrendingUp, TrendingDown, Zap, WifiOff, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EnrichedPriceData {
  symbol: string
  price: number
  dayChange?: number
  weekChange?: number
  monthChange?: number
  longTraderCount?: number
  shortTraderCount?: number
  traderRatio?: number
}

interface PriceFlash {
  [symbol: string]: 'up' | 'down' | null
}

interface MarketBreadth {
  totalAssets: number
  upCount: number
  downCount: number
  neutralCount: number
  upPercent: number
  downPercent: number
  avgChange: number
  strongUpCount: number
  strongDownCount: number
}

export default function ScreenerPage() {
  const [prices, setPrices] = useState<EnrichedPriceData[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortColumn, setSortColumn] = useState<keyof EnrichedPriceData>('symbol')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [priceFlashes, setPriceFlashes] = useState<PriceFlash>({})
  const [hasHistoricalData, setHasHistoricalData] = useState(false)

  // Fetch prices from API
  const fetchPrices = useCallback(async () => {
    try {
      const response = await fetch('/api/hydromancer-prices?enriched=true&traders=false')
      const data = await response.json()
      
      if (data.error) {
        setIsConnected(false)
        setIsLoading(false)
        return
      }

      // Detect price changes and trigger flash effects
      if (prices.length > 0 && data.prices) {
        const newFlashes: PriceFlash = {}
        data.prices.forEach((newPrice: EnrichedPriceData) => {
          const oldPrice = prices.find(p => p.symbol === newPrice.symbol)
          if (oldPrice && oldPrice.price !== newPrice.price) {
            newFlashes[newPrice.symbol] = newPrice.price > oldPrice.price ? 'up' : 'down'
          }
        })
        
        if (Object.keys(newFlashes).length > 0) {
          setPriceFlashes(newFlashes)
          setTimeout(() => setPriceFlashes({}), 500)
        }
      }

      setPrices(data.prices || [])
      setIsConnected(data.isConnected || false)
      setHasHistoricalData(data.hasHistoricalData || false)
      setIsLoading(false)
    } catch (error) {
      console.error('Failed to fetch prices:', error)
      setIsConnected(false)
      setIsLoading(false)
    }
  }, [prices])

  // Poll for updates every 1 second
  useEffect(() => {
    fetchPrices()
    const interval = setInterval(fetchPrices, 1000)
    return () => clearInterval(interval)
  }, [])

  // Calculate market breadth
  const marketBreadth = useMemo<MarketBreadth>(() => {
    const totalAssets = prices.length
    let upCount = 0
    let downCount = 0
    let neutralCount = 0
    let strongUpCount = 0
    let strongDownCount = 0
    let totalChange = 0

    prices.forEach(price => {
      const change = price.dayChange || 0
      totalChange += change
      
      if (change > 0.1) upCount++
      else if (change < -0.1) downCount++
      else neutralCount++
      
      if (change > 5) strongUpCount++
      if (change < -5) strongDownCount++
    })

    return {
      totalAssets,
      upCount,
      downCount,
      neutralCount,
      upPercent: totalAssets > 0 ? (upCount / totalAssets) * 100 : 0,
      downPercent: totalAssets > 0 ? (downCount / totalAssets) * 100 : 0,
      avgChange: totalAssets > 0 ? totalChange / totalAssets : 0,
      strongUpCount,
      strongDownCount,
    }
  }, [prices])

  // Filter and sort prices
  const filteredPrices = useMemo(() => {
    let filtered = prices

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(p => p.symbol.toLowerCase().includes(query))
    }

    // Apply sorting
    filtered = [...filtered].sort((a, b) => {
      const aValue = a[sortColumn] ?? 0
      const bValue = b[sortColumn] ?? 0
      
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortDirection === 'asc' ? aValue - bValue : bValue - aValue
      }
      
      const aStr = String(aValue)
      const bStr = String(bValue)
      return sortDirection === 'asc' 
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr)
    })

    return filtered
  }, [prices, searchQuery, sortColumn, sortDirection])

  // Handle column header click for sorting
  const handleSort = (column: keyof EnrichedPriceData) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('desc')
    }
  }

  // Format price with appropriate decimal places
  const formatPrice = (price: number) => {
    if (price === 0) return '$0.00'
    if (price < 0.00001) return `$${price.toFixed(8)}`
    if (price < 0.0001) return `$${price.toFixed(7)}`
    if (price < 0.001) return `$${price.toFixed(6)}`
    if (price < 0.01) return `$${price.toFixed(5)}`
    if (price < 1) return `$${price.toFixed(4)}`
    if (price < 100) return `$${price.toFixed(3)}`
    return `$${price.toFixed(2)}`
  }

  // Format percentage
  const formatPercent = (value: number | undefined) => {
    if (value === undefined || value === null) return '--'
    const formatted = value.toFixed(2)
    return value > 0 ? `+${formatted}%` : `${formatted}%`
  }

  return (
    <div className="min-h-screen bg-zinc-950 font-mono">
      {/* Header */}
      <div className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold text-zinc-100">MARKET SCREENER</h1>
              <p className="text-xs text-zinc-500 mt-1">Live price data from Hydromancer API</p>
            </div>
            <div className="flex items-center gap-3">
              {isConnected ? (
                <Badge className="bg-green-500/20 text-green-400 border-0">
                  <Zap className="h-3 w-3 mr-1" />
                  LIVE
                </Badge>
              ) : isLoading ? (
                <Badge className="bg-amber-500/20 text-amber-400 border-0">
                  <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                  CONNECTING
                </Badge>
              ) : (
                <Badge className="bg-red-500/20 text-red-400 border-0">
                  <WifiOff className="h-3 w-3 mr-1" />
                  OFFLINE
                </Badge>
              )}
            </div>
          </div>

          {/* Market Breadth */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <div className="bg-zinc-800/50 border border-zinc-700 rounded p-2">
              <div className="text-[10px] text-zinc-500 uppercase mb-1">Total Assets</div>
              <div className="text-lg font-bold text-zinc-100">{marketBreadth.totalAssets}</div>
            </div>
            <div className="bg-zinc-800/50 border border-zinc-700 rounded p-2">
              <div className="text-[10px] text-zinc-500 uppercase mb-1">Up / Down</div>
              <div className="text-lg font-bold">
                <span className="text-green-500">{marketBreadth.upCount}</span>
                <span className="text-zinc-600 mx-1">/</span>
                <span className="text-red-500">{marketBreadth.downCount}</span>
              </div>
            </div>
            <div className="bg-zinc-800/50 border border-zinc-700 rounded p-2">
              <div className="text-[10px] text-zinc-500 uppercase mb-1">Market Bias</div>
              <div className={cn(
                "text-lg font-bold",
                marketBreadth.avgChange > 0 ? "text-green-500" : "text-red-500"
              )}>
                {formatPercent(marketBreadth.avgChange)}
              </div>
            </div>
            <div className="bg-zinc-800/50 border border-zinc-700 rounded p-2">
              <div className="text-[10px] text-zinc-500 uppercase mb-1">Strong Up</div>
              <div className="text-lg font-bold text-green-500">{marketBreadth.strongUpCount}</div>
            </div>
            <div className="bg-zinc-800/50 border border-zinc-700 rounded p-2">
              <div className="text-[10px] text-zinc-500 uppercase mb-1">Strong Down</div>
              <div className="text-lg font-bold text-red-500">{marketBreadth.strongDownCount}</div>
            </div>
          </div>

          {/* Market Breadth Bar */}
          <div className="mb-4">
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden flex">
              <div 
                className="bg-green-500 h-full transition-all duration-300"
                style={{ width: `${marketBreadth.upPercent}%` }}
              />
              <div 
                className="bg-red-500 h-full transition-all duration-300"
                style={{ width: `${marketBreadth.downPercent}%` }}
              />
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <Input
              type="text"
              placeholder="Search symbols..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-zinc-900/80 border-b border-zinc-800 sticky top-[220px] z-10">
            <tr>
              <th 
                onClick={() => handleSort('symbol')}
                className="px-4 py-2 text-left text-[10px] font-bold text-zinc-400 uppercase tracking-wider cursor-pointer hover:text-zinc-100"
              >
                Symbol {sortColumn === 'symbol' && (sortDirection === 'asc' ? '↑' : '↓')}
              </th>
              <th 
                onClick={() => handleSort('price')}
                className="px-4 py-2 text-right text-[10px] font-bold text-zinc-400 uppercase tracking-wider cursor-pointer hover:text-zinc-100"
              >
                Price {sortColumn === 'price' && (sortDirection === 'asc' ? '↑' : '↓')}
              </th>
              <th 
                onClick={() => handleSort('dayChange')}
                className="px-4 py-2 text-right text-[10px] font-bold text-zinc-400 uppercase tracking-wider cursor-pointer hover:text-zinc-100"
              >
                Day % {sortColumn === 'dayChange' && (sortDirection === 'asc' ? '↑' : '↓')}
              </th>
              <th 
                onClick={() => handleSort('weekChange')}
                className="px-4 py-2 text-right text-[10px] font-bold text-zinc-400 uppercase tracking-wider cursor-pointer hover:text-zinc-100"
              >
                Week % {sortColumn === 'weekChange' && (sortDirection === 'asc' ? '↑' : '↓')}
              </th>
              <th className="px-4 py-2 text-right text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                Z-Score
              </th>
              <th className="px-4 py-2 text-right text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                VWAP %
              </th>
              <th className="px-4 py-2 text-right text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                RVOL
              </th>
              <th className="px-4 py-2 text-right text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                ADR %
              </th>
              <th className="px-4 py-2 text-right text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                52W High
              </th>
              <th className="px-4 py-2 text-right text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                Vol 24H
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredPrices.map((item) => {
              const flash = priceFlashes[item.symbol]
              const dayChange = item.dayChange || 0
              const weekChange = item.weekChange || 0
              
              return (
                <tr 
                  key={item.symbol}
                  className={cn(
                    "border-b border-zinc-900 hover:bg-zinc-900/50 transition-colors",
                    flash === 'up' && "bg-green-500/10",
                    flash === 'down' && "bg-red-500/10"
                  )}
                >
                  <td className="px-4 py-2 text-sm font-bold text-zinc-100">
                    {item.symbol}
                  </td>
                  <td className={cn(
                    "px-4 py-2 text-sm text-right font-mono transition-colors",
                    flash === 'up' && "text-green-400",
                    flash === 'down' && "text-red-400",
                    !flash && "text-zinc-100"
                  )}>
                    {formatPrice(item.price)}
                  </td>
                  <td className={cn(
                    "px-4 py-2 text-sm text-right font-mono",
                    dayChange > 0 ? "text-green-500" : dayChange < 0 ? "text-red-500" : "text-zinc-500"
                  )}>
                    {formatPercent(dayChange)}
                  </td>
                  <td className={cn(
                    "px-4 py-2 text-sm text-right font-mono",
                    weekChange > 0 ? "text-green-500" : weekChange < 0 ? "text-red-500" : "text-zinc-500"
                  )}>
                    {formatPercent(weekChange)}
                  </td>
                  <td className="px-4 py-2 text-sm text-right font-mono text-zinc-500">--</td>
                  <td className="px-4 py-2 text-sm text-right font-mono text-zinc-500">--</td>
                  <td className="px-4 py-2 text-sm text-right font-mono text-zinc-500">--</td>
                  <td className="px-4 py-2 text-sm text-right font-mono text-zinc-500">--</td>
                  <td className="px-4 py-2 text-sm text-right font-mono text-zinc-500">--</td>
                  <td className="px-4 py-2 text-sm text-right font-mono text-zinc-500">--</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Empty State */}
      {filteredPrices.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center h-64">
          <Search className="h-12 w-12 text-zinc-700 mb-3" />
          <p className="text-zinc-500 text-sm">
            {searchQuery ? 'No symbols match your search' : 'No data available'}
          </p>
        </div>
      )}

      {/* Historical Data Notice */}
      {!hasHistoricalData && isConnected && (
        <div className="fixed bottom-4 right-4 bg-amber-500/20 border border-amber-500/50 rounded-lg p-3 max-w-sm">
          <p className="text-xs text-amber-400 mb-1 font-bold">Historical Data Disabled</p>
          <p className="text-[10px] text-amber-300">
            Configure Supabase to enable DAY % and WEEK % columns. See SCREENER-SETUP.md
          </p>
        </div>
      )}
    </div>
  )
}
