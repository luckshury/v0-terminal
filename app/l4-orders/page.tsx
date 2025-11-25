'use client'

import { useState, useEffect, useMemo } from 'react'
import { RefreshCw, AlertCircle, Eye, TrendingUp, TrendingDown, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useAppState } from '@/contexts/app-state-context'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell, ReferenceLine, BarChart, Bar, ComposedChart, Area, Line } from 'recharts'

interface TriggerOrder {
  orderId: string
  user: string
  side: 'buy' | 'sell'
  triggerPrice: number
  size: number
  orderType: string
  isStopLoss?: boolean
  isTakeProfit?: boolean
}

interface MarketData {
  coin: string
  triggerOrders: TriggerOrder[]
  totalOrders: number
}

export default function L4OrdersPage() {
  // Use persistent global state
  const { l4OrdersSettings, updateL4OrdersSettings } = useAppState()
  
  // Destructure settings for easier access
  const { selectedCoin, sortColumn, sortDirection, displayLimit } = l4OrdersSettings
  
  // Helper functions to update settings
  const setSelectedCoin = (value: string) => updateL4OrdersSettings({ selectedCoin: value })
  const setSortColumn = (value: 'triggerPrice' | 'size' | 'side' | null) => updateL4OrdersSettings({ sortColumn: value })
  const setSortDirection = (value: 'asc' | 'desc') => updateL4OrdersSettings({ sortDirection: value })
  const setDisplayLimit = (value: number) => updateL4OrdersSettings({ displayLimit: value })
  
  // Local state (not persisted)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [markets, setMarkets] = useState<MarketData[]>([])
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [metadata, setMetadata] = useState<any>(null)
  const [isCached, setIsCached] = useState(false)
  const [cacheExpiresIn, setCacheExpiresIn] = useState<number | null>(null)
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)

  // Fetch metadata first to show stats
  const fetchMetadata = async () => {
    try {
      const response = await fetch('/api/l4-orderbook')
      const data = await response.json()
      
      if (data.hasAccess && data.sampleData) {
        setMetadata(data.sampleData)
      }
    } catch (err) {
      console.error('Error fetching metadata:', err)
    }
  }

  // Fetch L4 snapshot data
  const fetchL4Data = async () => {
    setLoading(true)
    setError(null)

    try {
      console.log('Fetching L4 snapshot data...')
      const response = await fetch('/api/l4-snapshots')
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      console.log('Parsing JSON response...')
      const result = await response.json()
      
      if (!result.success || !result.data) {
        throw new Error('Invalid response format')
      }
      
      // Update cache info
      setIsCached(result.cached || false)
      setCacheExpiresIn(result.cacheExpiresIn || null)
      
      if (result.cached) {
        console.log(`Using cached data (age: ${result.cacheAge}s, expires in: ${result.cacheExpiresIn}s)`)
      }
      
      const data = result.data
      console.log('Data received successfully:', data)
      
      // Parse the L4 data structure
      // Structure: [height, [[coin, [[wallet, order], [wallet, order], ...]], ...]]
      if (Array.isArray(data) && data.length >= 2) {
        const [height, marketsArray] = data
        console.log('Height:', height, 'Markets array length:', marketsArray?.length)
        
        const parsedMarkets: MarketData[] = []
        
        if (Array.isArray(marketsArray)) {
          for (const marketEntry of marketsArray) {
            if (!Array.isArray(marketEntry) || marketEntry.length < 2) continue
            
            const [coinName, marketData] = marketEntry
            const triggerOrders: TriggerOrder[] = []
            
            // marketData is an OBJECT with book_orders and untriggered_orders arrays
            if (marketData && typeof marketData === 'object') {
              // Extract untriggered trigger orders (stop loss, take profit, etc.)
              const untriggeredOrders = marketData.untriggered_orders || []
              
              // untriggeredOrders is an array of [wallet_address, order_object] pairs
              if (Array.isArray(untriggeredOrders)) {
                for (const orderEntry of untriggeredOrders) {
                  if (!Array.isArray(orderEntry) || orderEntry.length < 2) continue
                  
                  const [walletAddress, orderData] = orderEntry
                  
                  // Check if orderData exists and has required fields
                  if (!orderData || typeof orderData !== 'object') continue
                  
                  const orderType = orderData.orderType || ''
                  const isStopLoss = orderType.toLowerCase().includes('stop')
                  const isTakeProfit = orderType.toLowerCase().includes('take profit') || orderType.toLowerCase().includes('tp')
                  
                  // Map side: "A" = Ask (sell), "B" = Bid (buy)
                  const side = orderData.side === 'B' ? 'buy' : 'sell'
                  
                  const order = {
                    orderId: orderData.oid?.toString() || `${Date.now()}-${Math.random()}`,
                    user: walletAddress || 'Unknown',
                    side,
                    triggerPrice: parseFloat(orderData.triggerPx || '0'),
                    size: parseFloat(orderData.sz || '0'),
                    orderType: orderType,
                    isStopLoss,
                    isTakeProfit,
                  }
                  
                  triggerOrders.push(order)
                  
                  // Log first order per market for debugging
                  if (triggerOrders.length === 1) {
                    console.log(`✅ First trigger order for ${coinName}:`, order)
                  }
                }
              }
            }
            
            // Clean up coin name (remove "xyz:" prefix if present)
            const cleanCoinName = coinName.includes(':') ? coinName.split(':')[1] : coinName
            
            parsedMarkets.push({
              coin: cleanCoinName,
              triggerOrders,
              totalOrders: triggerOrders.length,
            })
          }
        }
        
        // Sort markets by number of orders (descending) for better UX
        parsedMarkets.sort((a, b) => b.totalOrders - a.totalOrders)
        
        const totalOrders = parsedMarkets.reduce((sum, m) => sum + m.totalOrders, 0)
        console.log(`✅ Parsed ${parsedMarkets.length} markets with ${totalOrders} total trigger orders`)
        console.log('📊 Top 10 markets:', parsedMarkets.slice(0, 10).map(m => `${m.coin}: ${m.totalOrders}`).join(', '))
        
        setMarkets(parsedMarkets)
        setLastUpdate(new Date())
        
        // Auto-select first coin with orders, or just first coin
        const coinToSelect = parsedMarkets.find(m => m.totalOrders > 0)?.coin || parsedMarkets[0]?.coin
        if (coinToSelect) {
          console.log(`Auto-selecting coin: ${coinToSelect}`)
          setSelectedCoin(coinToSelect)
        }
      }
    } catch (err) {
      console.error('Error processing L4 data:', err)
      setError(err instanceof Error ? err.message : 'Failed to process L4 data')
    } finally {
      setLoading(false)
    }
  }

  // Fetch metadata on mount
  useEffect(() => {
    fetchMetadata()
  }, [])

  // Get current market data
  const currentMarket = markets.find(m => m.coin === selectedCoin)
  const rawTriggerOrders = currentMarket?.triggerOrders || []

  // Debug logging (only when needed, not on every render)
  useEffect(() => {
    if (markets.length > 0 && rawTriggerOrders.length === 0) {
      console.log(`No orders found for ${selectedCoin}. Available markets:`, markets.map(m => `${m.coin} (${m.totalOrders})`))
    }
  }, [markets, rawTriggerOrders.length, selectedCoin])

  // Handle column sorting
  const handleSort = (column: 'triggerPrice' | 'size' | 'side') => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      // New column, default to descending
      setSortColumn(column)
      setSortDirection('desc')
    }
    // Reset display limit when sorting changes
    setDisplayLimit(100)
  }

  // Reset display limit when market changes
  useEffect(() => {
    setDisplayLimit(100)
  }, [selectedCoin])

  // Apply sorting to trigger orders
  const triggerOrders = useMemo(() => {
    if (!sortColumn) return rawTriggerOrders

    const sorted = [...rawTriggerOrders].sort((a, b) => {
      let compareValue = 0

      if (sortColumn === 'triggerPrice') {
        compareValue = a.triggerPrice - b.triggerPrice
      } else if (sortColumn === 'size') {
        compareValue = a.size - b.size
      } else if (sortColumn === 'side') {
        // Sort alphabetically: buy < sell
        compareValue = a.side.localeCompare(b.side)
      }

      return sortDirection === 'asc' ? compareValue : -compareValue
    })

    return sorted
  }, [rawTriggerOrders, sortColumn, sortDirection])

  // Limit displayed orders for performance
  const displayedOrders = useMemo(() => {
    return triggerOrders.slice(0, displayLimit)
  }, [triggerOrders, displayLimit])

  // Calculate stats (use full dataset for accurate stats)
  const stopLossOrders = useMemo(() => triggerOrders.filter(o => o.isStopLoss), [triggerOrders])
  const takeProfitOrders = useMemo(() => triggerOrders.filter(o => o.isTakeProfit), [triggerOrders])
  const buyOrders = useMemo(() => triggerOrders.filter(o => o.side === 'buy'), [triggerOrders])
  const sellOrders = useMemo(() => triggerOrders.filter(o => o.side === 'sell'), [triggerOrders])

  // Calculate aggregate metrics
  const metrics = useMemo(() => {
    const buySize = buyOrders.reduce((sum, o) => sum + o.size, 0)
    const sellSize = sellOrders.reduce((sum, o) => sum + o.size, 0)
    const totalSize = buySize + sellSize
    
    const buyTriggerPrices = buyOrders.map(o => o.triggerPrice).filter(p => p > 0)
    const sellTriggerPrices = sellOrders.map(o => o.triggerPrice).filter(p => p > 0)
    const allTriggerPrices = triggerOrders.map(o => o.triggerPrice).filter(p => p > 0)
    
    const avgBuyPrice = buyTriggerPrices.length > 0 
      ? buyTriggerPrices.reduce((sum, p) => sum + p, 0) / buyTriggerPrices.length 
      : 0
    const avgSellPrice = sellTriggerPrices.length > 0 
      ? sellTriggerPrices.reduce((sum, p) => sum + p, 0) / sellTriggerPrices.length 
      : 0
    
    const minPrice = allTriggerPrices.length > 0 ? Math.min(...allTriggerPrices) : 0
    const maxPrice = allTriggerPrices.length > 0 ? Math.max(...allTriggerPrices) : 0
    const medianPrice = allTriggerPrices.length > 0 
      ? allTriggerPrices.sort((a, b) => a - b)[Math.floor(allTriggerPrices.length / 2)]
      : 0
    
    return {
      buySize,
      sellSize,
      totalSize,
      avgBuyPrice,
      avgSellPrice,
      minPrice,
      maxPrice,
      medianPrice,
      buyCount: buyOrders.length,
      sellCount: sellOrders.length,
    }
  }, [triggerOrders, buyOrders, sellOrders])

  // Prepare heatmap data - focus on 80th percentile to avoid extreme outliers
  const heatmapData = useMemo(() => {
    if (triggerOrders.length === 0) return { bins: [], minPrice: 0, maxPrice: 0, currentPrice: 0 }

    // Sort prices and filter to 10th-90th percentile (80% range centered)
    const sortedPrices = triggerOrders
      .map(o => o.triggerPrice)
      .filter(p => p > 0)
      .sort((a, b) => a - b)
    
    if (sortedPrices.length === 0) return { bins: [], minPrice: 0, maxPrice: 0, currentPrice: 0 }

    const p10Index = Math.floor(sortedPrices.length * 0.1)
    const p90Index = Math.floor(sortedPrices.length * 0.9)
    const minPrice = sortedPrices[p10Index]
    const maxPrice = sortedPrices[p90Index]
    const priceRange = maxPrice - minPrice

    // Create 200 bins for ultra-smooth gradient
    const numBins = 200
    const binSize = priceRange / numBins
    const bins: { priceLevel: number; priceRangeStart: number; priceRangeEnd: number; totalSize: number; buySize: number; sellSize: number; count: number; buyCount: number; sellCount: number }[] = []

    // Initialize bins
    for (let i = 0; i < numBins; i++) {
      const rangeStart = minPrice + (i * binSize)
      const rangeEnd = rangeStart + binSize
      bins.push({
        priceLevel: rangeStart + (binSize / 2), // Center of bin
        priceRangeStart: rangeStart,
        priceRangeEnd: rangeEnd,
        totalSize: 0,
        buySize: 0,
        sellSize: 0,
        count: 0,
        buyCount: 0,
        sellCount: 0,
      })
    }

    // Aggregate orders into bins
    triggerOrders.forEach(order => {
      if (order.triggerPrice < minPrice || order.triggerPrice > maxPrice) return
      
      const binIndex = Math.min(
        Math.floor((order.triggerPrice - minPrice) / binSize),
        numBins - 1
      )
      
      bins[binIndex].totalSize += order.size
      bins[binIndex].count++
      
      if (order.side === 'buy') {
        bins[binIndex].buySize += order.size
        bins[binIndex].buyCount++
      } else {
        bins[binIndex].sellSize += order.size
        bins[binIndex].sellCount++
      }
    })

    // Find max size for normalization
    const maxSize = Math.max(...bins.map(b => b.totalSize))

    // Normalize and calculate intensity (0-1)
    const normalizedBins = bins.map(bin => ({
      ...bin,
      intensity: maxSize > 0 ? bin.totalSize / maxSize : 0,
    }))

    return {
      bins: normalizedBins,
      minPrice,
      maxPrice,
      currentPrice: metrics.medianPrice, // Use median as proxy for current price
    }
  }, [triggerOrders, metrics.medianPrice])

  // Prepare histogram data for concentration visualization
  const histogramData = useMemo(() => {
    if (triggerOrders.length === 0) return []

    // Create price bins
    const prices = triggerOrders.map(o => o.triggerPrice).filter(p => p > 0).sort((a, b) => a - b)
    if (prices.length === 0) return []

    const minPrice = prices[0]
    const maxPrice = prices[prices.length - 1]
    const numBins = 30
    const binSize = (maxPrice - minPrice) / numBins

    const bins: { price: number; stopLoss: number; takeProfit: number; other: number; total: number }[] = []

    for (let i = 0; i < numBins; i++) {
      const binStart = minPrice + (i * binSize)
      const binEnd = binStart + binSize
      const binCenter = binStart + (binSize / 2)

      const ordersInBin = triggerOrders.filter(o => o.triggerPrice >= binStart && o.triggerPrice < binEnd)
      
      const stopLossCount = ordersInBin.filter(o => o.isStopLoss).length
      const takeProfitCount = ordersInBin.filter(o => o.isTakeProfit).length
      const otherCount = ordersInBin.filter(o => !o.isStopLoss && !o.isTakeProfit).length

      bins.push({
        price: Math.round(binCenter),
        stopLoss: stopLossCount,
        takeProfit: takeProfitCount,
        other: otherCount,
        total: ordersInBin.length,
      })
    }

    return bins
  }, [triggerOrders])


  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold font-mono tracking-tight">L4 Invisible Orders</h1>
            <p className="text-sm text-muted-foreground font-mono mt-1">
              Trigger orders not visible in standard L2/L3 orderbooks
            </p>
          </div>
          
          <Button
            onClick={fetchL4Data}
            disabled={loading}
            className="font-mono"
          >
            {loading ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <Eye className="mr-2 h-4 w-4" />
                Fetch Invisible Orders
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Controls */}
      <div className="border-b border-border bg-card px-6 py-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono text-muted-foreground">Ticker:</span>
            <Select value={selectedCoin} onValueChange={setSelectedCoin}>
              <SelectTrigger className="w-32 h-9 font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {markets.map(market => (
                  <SelectItem key={market.coin} value={market.coin} className="font-mono">
                    {market.coin} ({market.totalOrders})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {lastUpdate && (
            <div className="ml-auto text-xs text-muted-foreground font-mono flex items-center gap-3">
              <span>Last updated: {lastUpdate.toLocaleTimeString()}</span>
              {isCached && cacheExpiresIn !== null && (
                <span className="text-amber-500 font-semibold">
                  [CACHED - refreshes in {Math.floor(cacheExpiresIn / 60)}m {cacheExpiresIn % 60}s]
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Metadata Stats */}
      {metadata && (
        <div className="border-b border-border bg-muted/30 px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6 text-xs font-mono">
              <div>
                <span className="text-muted-foreground">Markets:</span>{' '}
                <span className="font-bold">{metadata.market_count}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Snapshot Size:</span>{' '}
                <span className="font-bold">{(metadata.compressed_size_bytes / 1024 / 1024).toFixed(1)}MB</span>
              </div>
              <div>
                <span className="text-muted-foreground">Compression:</span>{' '}
                <span className="font-bold">{metadata.compression_ratio.toFixed(1)}x</span>
              </div>
              <div>
                <span className="text-muted-foreground">Height:</span>{' '}
                <span className="font-bold">{metadata.height.toLocaleString()}</span>
              </div>
            </div>
            <div className="text-xs text-muted-foreground font-mono flex items-center gap-4">
              <span>Markets with orders: {markets.filter(m => m.totalOrders > 0).length}/{markets.length}</span>
              <span>•</span>
              <span>Rate limit: 5 requests / 5 minutes</span>
            </div>
          </div>
        </div>
      )}

      {/* Market Metrics & Distribution Chart */}
      {triggerOrders.length > 0 && (
        <div className="border-b border-border bg-card">
          <div className="px-6 py-4">
            {/* Metrics Grid */}
            <div className="grid grid-cols-5 gap-4 mb-4">
              {/* Buy Side Metrics */}
              <div className="bg-green-500/10 border border-green-500/30 rounded p-3">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  <span className="text-xs font-mono text-muted-foreground">BUY ORDERS</span>
                </div>
                <div className="text-2xl font-bold font-mono text-green-500">{metrics.buyCount}</div>
                <div className="text-xs text-muted-foreground font-mono mt-1">
                  Size: {metrics.buySize.toFixed(4)}
                </div>
                {metrics.avgBuyPrice > 0 && (
                  <div className="text-xs text-muted-foreground font-mono">
                    Avg: ${metrics.avgBuyPrice.toLocaleString()}
                  </div>
                )}
              </div>

              {/* Sell Side Metrics */}
              <div className="bg-red-500/10 border border-red-500/30 rounded p-3">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingDown className="h-4 w-4 text-red-500" />
                  <span className="text-xs font-mono text-muted-foreground">SELL ORDERS</span>
                </div>
                <div className="text-2xl font-bold font-mono text-red-500">{metrics.sellCount}</div>
                <div className="text-xs text-muted-foreground font-mono mt-1">
                  Size: {metrics.sellSize.toFixed(4)}
                </div>
                {metrics.avgSellPrice > 0 && (
                  <div className="text-xs text-muted-foreground font-mono">
                    Avg: ${metrics.avgSellPrice.toLocaleString()}
                  </div>
                )}
              </div>

              {/* Total Size */}
              <div className="bg-muted/50 border border-border rounded p-3">
                <div className="text-xs font-mono text-muted-foreground mb-2">TOTAL SIZE</div>
                <div className="text-2xl font-bold font-mono">{metrics.totalSize.toFixed(4)}</div>
                <div className="text-xs text-muted-foreground font-mono mt-1">
                  Buy: {((metrics.buySize / metrics.totalSize) * 100).toFixed(1)}%
                </div>
                <div className="text-xs text-muted-foreground font-mono">
                  Sell: {((metrics.sellSize / metrics.totalSize) * 100).toFixed(1)}%
                </div>
              </div>

              {/* Price Range */}
              <div className="bg-muted/50 border border-border rounded p-3">
                <div className="text-xs font-mono text-muted-foreground mb-2">PRICE RANGE</div>
                <div className="text-sm font-bold font-mono">${metrics.minPrice.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground font-mono">to</div>
                <div className="text-sm font-bold font-mono">${metrics.maxPrice.toLocaleString()}</div>
              </div>

              {/* Median Price */}
              <div className="bg-muted/50 border border-border rounded p-3">
                <div className="text-xs font-mono text-muted-foreground mb-2">MEDIAN PRICE</div>
                <div className="text-xl font-bold font-mono">${metrics.medianPrice.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground font-mono mt-1">
                  Spread: {(((metrics.maxPrice - metrics.minPrice) / metrics.medianPrice) * 100).toFixed(1)}%
                </div>
              </div>
            </div>

            {/* L4 Order Heatmap Bar */}
            {heatmapData.bins.length > 0 && (
              <div className="bg-muted/20 rounded border border-border p-4 mt-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-bold font-mono">L4 Liquidity Heatmap</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    ${heatmapData.minPrice.toLocaleString()} - ${heatmapData.maxPrice.toLocaleString()} (80th percentile)
                  </div>
                </div>
                
                {/* Heatmap Bar */}
                <div className="relative h-20 rounded overflow-hidden border border-border bg-background">
                  {/* Gradient bars for each bin */}
                  <div className="absolute inset-0 flex">
                    {heatmapData.bins.map((bin, idx) => {
                      // Skip rendering empty bins for performance
                      if (bin.count === 0) {
                        return (
                          <div
                            key={idx}
                            className="flex-1"
                            style={{
                              backgroundColor: 'transparent',
                              minWidth: '1px',
                            }}
                          />
                        )
                      }
                      
                      // Calculate color based on intensity and buy/sell ratio
                      const buyRatio = bin.totalSize > 0 ? bin.buySize / bin.totalSize : 0.5
                      const sellRatio = 1 - buyRatio
                      
                      // More buy = greener, more sell = redder, with better intensity scaling
                      const baseIntensity = Math.min(1, bin.intensity * 1.5) // Boost visibility
                      const red = Math.floor(255 * sellRatio * baseIntensity)
                      const green = Math.floor(255 * buyRatio * baseIntensity)
                      const blue = Math.floor(80 * (1 - baseIntensity))
                      
                      const opacity = 0.4 + (bin.intensity * 0.6) // Min 0.4, max 1.0
                      
                      return (
                        <div
                          key={idx}
                          className="flex-1 relative group cursor-pointer transition-all hover:scale-y-110 hover:z-20"
                          style={{
                            backgroundColor: `rgba(${red}, ${green}, ${blue}, ${opacity})`,
                            minWidth: '1px',
                          }}
                        >
                          {/* Enhanced Hover tooltip */}
                          <div className="invisible group-hover:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-card border border-border rounded-lg text-xs font-mono whitespace-nowrap z-50 shadow-xl">
                            <div className="font-bold text-sm mb-1 text-primary">
                              ${bin.priceRangeStart.toLocaleString()} - ${bin.priceRangeEnd.toLocaleString()}
                            </div>
                            <div className="border-t border-border pt-1 mt-1 space-y-0.5">
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">Total Orders:</span>
                                <span className="font-bold">{bin.count}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">Total Size:</span>
                                <span className="font-bold">{bin.totalSize.toFixed(6)}</span>
                              </div>
                            </div>
                            {(bin.buySize > 0 || bin.sellSize > 0) && (
                              <div className="border-t border-border pt-1 mt-1 space-y-0.5">
                                {bin.buySize > 0 && (
                                  <>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-green-500">Buy Orders:</span>
                                      <span className="text-green-500 font-bold">{bin.buyCount}</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-green-500">Buy Size:</span>
                                      <span className="text-green-500 font-bold">{bin.buySize.toFixed(6)}</span>
                                    </div>
                                  </>
                                )}
                                {bin.sellSize > 0 && (
                                  <>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-red-500">Sell Orders:</span>
                                      <span className="text-red-500 font-bold">{bin.sellCount}</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-red-500">Sell Size:</span>
                                      <span className="text-red-500 font-bold">{bin.sellSize.toFixed(6)}</span>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                            {(bin.buySize > 0 && bin.sellSize > 0) && (
                              <div className="border-t border-border pt-1 mt-1">
                                <div className="flex justify-between gap-4">
                                  <span className="text-muted-foreground">Buy/Sell Ratio:</span>
                                  <span className="font-bold">{(bin.buySize / bin.sellSize).toFixed(2)}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  
                  {/* Current price indicator */}
                  {heatmapData.currentPrice > 0 && 
                   heatmapData.currentPrice >= heatmapData.minPrice && 
                   heatmapData.currentPrice <= heatmapData.maxPrice && (
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-primary z-10"
                      style={{
                        left: `${((heatmapData.currentPrice - heatmapData.minPrice) / (heatmapData.maxPrice - heatmapData.minPrice)) * 100}%`,
                      }}
                    >
                      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-primary"></div>
                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-primary"></div>
                    </div>
                  )}
                </div>
                
                {/* Price labels */}
                <div className="flex justify-between mt-2 text-xs font-mono text-muted-foreground">
                  <span>${heatmapData.minPrice.toLocaleString()}</span>
                  {heatmapData.currentPrice > 0 && (
                    <span className="text-primary font-bold">
                      Current: ${heatmapData.currentPrice.toLocaleString()}
                    </span>
                  )}
                  <span>${heatmapData.maxPrice.toLocaleString()}</span>
                </div>
                
                {/* Legend */}
                <div className="flex items-center justify-center gap-6 mt-3 text-xs font-mono flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-3 rounded" style={{ background: 'linear-gradient(to right, rgba(0,255,0,0.3), rgba(0,255,0,1))' }}></div>
                    <span className="text-muted-foreground">Buy Orders</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-3 rounded" style={{ background: 'linear-gradient(to right, rgba(255,0,0,0.3), rgba(255,0,0,1))' }}></div>
                    <span className="text-muted-foreground">Sell Orders</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-0.5 h-4 bg-primary"></div>
                    <span className="text-muted-foreground">Median Price</span>
                  </div>
                  <span className="text-muted-foreground italic">Darker = More Liquidity</span>
                  <span className="text-muted-foreground italic">• Hover for details</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mx-6 mt-4 p-4 bg-destructive/10 border border-destructive rounded flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <span className="text-sm text-destructive font-mono">{error}</span>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading && triggerOrders.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground font-mono">Loading invisible orders...</p>
            </div>
          </div>
        ) : triggerOrders.length > 0 ? (
          <div className="space-y-4">
            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-card border border-border rounded p-4">
                <div className="text-xs text-muted-foreground font-mono mb-1">Total Trigger Orders</div>
                <div className="text-2xl font-bold font-mono">{triggerOrders.length}</div>
              </div>
              <div className="bg-card border border-border rounded p-4">
                <div className="text-xs text-muted-foreground font-mono mb-1">Stop Loss Orders</div>
                <div className="text-2xl font-bold font-mono text-red-500">{stopLossOrders.length}</div>
              </div>
              <div className="bg-card border border-border rounded p-4">
                <div className="text-xs text-muted-foreground font-mono mb-1">Take Profit Orders</div>
                <div className="text-2xl font-bold font-mono text-green-500">{takeProfitOrders.length}</div>
              </div>
              <div className="bg-card border border-border rounded p-4">
                <div className="text-xs text-muted-foreground font-mono mb-1">Buy / Sell</div>
                <div className="text-2xl font-bold font-mono">
                  <span className="text-green-500">{buyOrders.length}</span>
                  {' / '}
                  <span className="text-red-500">{sellOrders.length}</span>
                </div>
              </div>
            </div>

            {/* Matplotlib-style Visualization */}
            <div className="bg-card border border-border rounded p-6">
              <div className="mb-4">
                <h2 className="text-lg font-bold font-mono mb-1">Stop Loss & Take Profit Distribution</h2>
                <p className="text-xs text-muted-foreground font-mono">
                  Matplotlib-style scatter plot showing order concentration by price level
                </p>
              </div>
              
              <ResponsiveContainer width="100%" height={400}>
                <ScatterChart margin={{ top: 20, right: 30, bottom: 60, left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" opacity={0.3} />
                  
                  <XAxis 
                    type="number"
                    dataKey="triggerPrice"
                    name="Trigger Price"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(value) => `$${value.toLocaleString()}`}
                    label={{ value: 'Trigger Price ($)', position: 'bottom', offset: 40, style: { fontFamily: 'monospace', fontSize: 12 } }}
                    stroke="#888"
                    style={{ fontFamily: 'monospace', fontSize: 11 }}
                  />
                  
                  <YAxis 
                    type="number"
                    dataKey="size"
                    name="Size"
                    tickFormatter={(value) => value.toFixed(2)}
                    label={{ value: 'Order Size', angle: -90, position: 'left', offset: 40, style: { fontFamily: 'monospace', fontSize: 12 } }}
                    stroke="#888"
                    style={{ fontFamily: 'monospace', fontSize: 11 }}
                  />
                  
                  <Tooltip 
                    cursor={{ strokeDasharray: '3 3' }}
                    contentStyle={{ 
                      backgroundColor: 'rgba(0, 0, 0, 0.9)', 
                      border: '1px solid #333',
                      borderRadius: '4px',
                      fontFamily: 'monospace',
                      fontSize: '11px'
                    }}
                    formatter={(value: any, name: string) => {
                      if (name === 'Size') return [value.toFixed(4), name]
                      if (name === 'Trigger Price') return [`$${value.toLocaleString()}`, name]
                      return [value, name]
                    }}
                  />
                  
                  <Legend 
                    wrapperStyle={{ fontFamily: 'monospace', fontSize: '12px' }}
                    iconType="circle"
                  />
                  
                  {/* Current price reference line */}
                  {currentPrice && (
                    <ReferenceLine 
                      x={currentPrice} 
                      stroke="#888" 
                      strokeDasharray="5 5" 
                      strokeWidth={2}
                      label={{ 
                        value: `Current: $${currentPrice.toLocaleString()}`, 
                        position: 'top',
                        style: { fontFamily: 'monospace', fontSize: 11, fill: '#888' }
                      }}
                    />
                  )}
                  
                  {/* Stop Loss Orders (Red) */}
                  <Scatter 
                    name="Stop Loss Orders" 
                    data={stopLossOrders}
                    fill="#ef4444"
                    opacity={0.7}
                    shape="circle"
                  />
                  
                  {/* Take Profit Orders (Green) */}
                  <Scatter 
                    name="Take Profit Orders" 
                    data={takeProfitOrders}
                    fill="#22c55e"
                    opacity={0.7}
                    shape="circle"
                  />
                  
                  {/* Other Orders (Blue) */}
                  <Scatter 
                    name="Other Orders" 
                    data={triggerOrders.filter(o => !o.isStopLoss && !o.isTakeProfit)}
                    fill="#3b82f6"
                    opacity={0.5}
                    shape="circle"
                  />
                </ScatterChart>
              </ResponsiveContainer>
              
              {/* Chart Statistics */}
              <div className="mt-4 pt-4 border-t border-border grid grid-cols-4 gap-4 text-xs font-mono">
                <div>
                  <div className="text-muted-foreground mb-1">Price Range</div>
                  <div className="font-bold">${metrics.minPrice.toLocaleString()} - ${metrics.maxPrice.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Avg Stop Loss</div>
                  <div className="font-bold text-red-500">
                    ${(stopLossOrders.reduce((sum, o) => sum + o.triggerPrice, 0) / (stopLossOrders.length || 1)).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Avg Take Profit</div>
                  <div className="font-bold text-green-500">
                    ${(takeProfitOrders.reduce((sum, o) => sum + o.triggerPrice, 0) / (takeProfitOrders.length || 1)).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Total Volume</div>
                  <div className="font-bold">{metrics.totalSize.toFixed(2)}</div>
                </div>
              </div>
            </div>

            {/* Price Level Concentration (Histogram) */}
            <div className="bg-card border border-border rounded p-6">
              <div className="mb-4">
                <h2 className="text-lg font-bold font-mono mb-1">Order Concentration by Price Level</h2>
                <p className="text-xs text-muted-foreground font-mono">
                  Histogram showing where stop loss and take profit orders cluster (matplotlib-style)
                </p>
              </div>
              
              <ResponsiveContainer width="100%" height={350}>
                <ComposedChart data={histogramData} margin={{ top: 20, right: 30, bottom: 60, left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" opacity={0.3} />
                  
                  <XAxis 
                    dataKey="price"
                    tickFormatter={(value) => `$${value.toLocaleString()}`}
                    label={{ value: 'Price Level ($)', position: 'bottom', offset: 40, style: { fontFamily: 'monospace', fontSize: 12 } }}
                    stroke="#888"
                    style={{ fontFamily: 'monospace', fontSize: 11 }}
                  />
                  
                  <YAxis 
                    label={{ value: 'Order Count', angle: -90, position: 'left', offset: 40, style: { fontFamily: 'monospace', fontSize: 12 } }}
                    stroke="#888"
                    style={{ fontFamily: 'monospace', fontSize: 11 }}
                  />
                  
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(0, 0, 0, 0.9)', 
                      border: '1px solid #333',
                      borderRadius: '4px',
                      fontFamily: 'monospace',
                      fontSize: '11px'
                    }}
                    formatter={(value: any, name: string) => {
                      if (name === 'stopLoss') return [value, 'Stop Loss']
                      if (name === 'takeProfit') return [value, 'Take Profit']
                      if (name === 'other') return [value, 'Other']
                      return [value, name]
                    }}
                  />
                  
                  <Legend 
                    wrapperStyle={{ fontFamily: 'monospace', fontSize: '12px' }}
                    iconType="square"
                  />
                  
                  {/* Stacked bars showing order types */}
                  <Bar dataKey="stopLoss" name="Stop Loss" stackId="a" fill="#ef4444" opacity={0.8} />
                  <Bar dataKey="takeProfit" name="Take Profit" stackId="a" fill="#22c55e" opacity={0.8} />
                  <Bar dataKey="other" name="Other" stackId="a" fill="#3b82f6" opacity={0.6} />
                  
                  {/* Total order count line overlay */}
                  <Line 
                    type="monotone" 
                    dataKey="total" 
                    name="Total Orders" 
                    stroke="#fbbf24" 
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              
              {/* Concentration Statistics */}
              <div className="mt-4 pt-4 border-t border-border grid grid-cols-3 gap-4 text-xs font-mono">
                <div>
                  <div className="text-muted-foreground mb-1">Highest Concentration</div>
                  <div className="font-bold">
                    ${histogramData.length > 0 ? histogramData.reduce((max, bin) => bin.total > max.total ? bin : max, histogramData[0]).price.toLocaleString() : 0}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Stop Loss Density</div>
                  <div className="font-bold text-red-500">
                    {((stopLossOrders.length / triggerOrders.length) * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Take Profit Density</div>
                  <div className="font-bold text-green-500">
                    {((takeProfitOrders.length / triggerOrders.length) * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
            </div>

            {/* Orders Table */}
            <div className="bg-card border border-border rounded overflow-hidden">
              <table className="w-full font-mono text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Order ID</th>
                    <th className="px-4 py-3 text-left font-semibold">User</th>
                    <th className="px-4 py-3 text-left font-semibold">Type</th>
                    <th 
                      className="px-4 py-3 text-right font-semibold cursor-pointer hover:bg-muted/80 select-none"
                      onClick={() => handleSort('side')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span>Side</span>
                        {sortColumn === 'side' ? (
                          sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </div>
                    </th>
                    <th 
                      className="px-4 py-3 text-right font-semibold cursor-pointer hover:bg-muted/80 select-none"
                      onClick={() => handleSort('triggerPrice')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span>Trigger Price</span>
                        {sortColumn === 'triggerPrice' ? (
                          sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </div>
                    </th>
                    <th 
                      className="px-4 py-3 text-right font-semibold cursor-pointer hover:bg-muted/80 select-none"
                      onClick={() => handleSort('size')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span>Size</span>
                        {sortColumn === 'size' ? (
                          sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayedOrders.map((order, idx) => (
                    <tr key={order.orderId} className={cn(
                      "border-b border-border/50",
                      idx % 2 === 0 && "bg-muted/20"
                    )}>
                      <td className="px-4 py-3 text-xs">{order.orderId.substring(0, 12)}...</td>
                      <td className="px-4 py-3 text-xs font-mono">{order.user}</td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "px-2 py-1 rounded text-xs font-semibold",
                          order.isStopLoss && "bg-red-500/10 text-red-500",
                          order.isTakeProfit && "bg-green-500/10 text-green-500",
                          !order.isStopLoss && !order.isTakeProfit && "bg-blue-500/10 text-blue-500"
                        )}>
                          {order.isStopLoss ? 'STOP LOSS' : order.isTakeProfit ? 'TAKE PROFIT' : order.orderType.toUpperCase()}
                        </span>
                      </td>
                      <td className={cn(
                        "px-4 py-3 text-right font-bold",
                        order.side === 'buy' ? "text-green-500" : "text-red-500"
                      )}>
                        {order.side.toUpperCase()}
                      </td>
                      <td className="px-4 py-3 text-right">${order.triggerPrice.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">{order.size.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {/* Load More Button */}
              {triggerOrders.length > displayLimit && (
                <div className="border-t border-border bg-muted/30 px-4 py-3 flex items-center justify-between">
                  <div className="text-xs text-muted-foreground font-mono">
                    Showing {displayedOrders.length} of {triggerOrders.length} orders
                  </div>
                  <Button
                    onClick={() => setDisplayLimit(prev => prev + 100)}
                    size="sm"
                    variant="outline"
                    className="font-mono text-xs"
                  >
                    Load 100 More
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : markets.length > 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <Eye className="h-12 w-12 mx-auto mb-4 text-amber-500" />
              <p className="text-sm text-muted-foreground font-mono mb-2">
                No trigger orders found for <span className="font-bold text-foreground">{selectedCoin}</span>
              </p>
              <p className="text-xs text-muted-foreground font-mono mb-4">
                Try selecting a different market from the dropdown above
              </p>
              <div className="bg-muted/30 rounded p-3 text-xs font-mono text-left">
                <div className="text-muted-foreground mb-1">Debug Info:</div>
                <div>• Total markets loaded: {markets.length}</div>
                <div>• Markets with orders: {markets.filter(m => m.totalOrders > 0).length}</div>
                <div>• Selected coin: {selectedCoin}</div>
                <div>• Current market found: {currentMarket ? 'Yes' : 'No'}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Eye className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground font-mono mb-2">
                No data loaded yet
              </p>
              <p className="text-xs text-muted-foreground font-mono">
                Click "Fetch Invisible Orders" to load L4 orderbook data
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

