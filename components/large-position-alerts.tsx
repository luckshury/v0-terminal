'use client'

import { memo } from 'react'
import { TableVirtuoso } from 'react-virtuoso'
import { Badge } from '@/components/ui/badge'
import { TrendingUp, TrendingDown, Zap } from 'lucide-react'

interface ProcessedFill {
  id: string
  address: string
  coin: string
  price: number
  size: number
  side: 'B' | 'A'
  time: number
  notionalValue: number
  dir: string
  isOpenLong: boolean
  isOpenShort: boolean
  isAggressive: boolean
  hash: string
}

interface LargePositionAlertsProps {
  fills: ProcessedFill[]
  minSize?: number
  showMarketOrdersOnly?: boolean
}

const RowComponent = memo(({ fill }: { fill: ProcessedFill }) => {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    })
  }

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(2)}M`
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`
    }
    return `$${value.toFixed(0)}`
  }

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const isWhale = fill.notionalValue >= 250000
  const isLarge = fill.notionalValue >= 100000 && fill.notionalValue < 250000

  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-accent/50 transition-colors border-b border-border">
      {/* Time */}
      <div className="w-[100px] text-sm text-muted-foreground font-mono">
        {formatTime(fill.time)}
      </div>

      {/* Direction */}
      <div className="w-[120px]">
        <Badge 
          variant={fill.isOpenLong ? 'default' : 'destructive'}
          className="flex items-center gap-1"
        >
          {fill.isOpenLong ? (
            <><TrendingUp className="h-3 w-3" /> Open Long</>
          ) : (
            <><TrendingDown className="h-3 w-3" /> Open Short</>
          )}
        </Badge>
      </div>

      {/* Size */}
      <div className="w-[100px] text-sm font-medium">
        {fill.size.toFixed(4)}
      </div>

      {/* Price */}
      <div className="w-[120px] text-sm font-mono">
        ${fill.price.toFixed(2)}
      </div>

      {/* Notional */}
      <div className="w-[120px]">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${isWhale ? 'text-red-500' : isLarge ? 'text-yellow-500' : ''}`}>
            {formatCurrency(fill.notionalValue)}
          </span>
          {isWhale && <span className="text-xs">🔴</span>}
          {isLarge && <span className="text-xs">🟡</span>}
        </div>
      </div>

      {/* Type */}
      <div className="w-[100px]">
        {fill.isAggressive ? (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Zap className="h-3 w-3" /> Market
          </Badge>
        ) : (
          <Badge variant="outline">Limit</Badge>
        )}
      </div>

      {/* Address */}
      <div className="flex-1 text-sm font-mono text-muted-foreground">
        <a
          href={`https://flowscan.xyz/address/${fill.address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-primary hover:underline"
        >
          {formatAddress(fill.address)}
        </a>
      </div>
    </div>
  )
}, (prev, next) => prev.fill.id === next.fill.id)

RowComponent.displayName = 'RowComponent'

export function LargePositionAlerts({ 
  fills, 
  minSize = 50000,
  showMarketOrdersOnly = false 
}: LargePositionAlertsProps) {
  // Filter fills
  const filteredFills = fills.filter(fill => {
    // Only opens
    if (!fill.isOpenLong && !fill.isOpenShort) return false
    
    // Size filter
    if (fill.notionalValue < minSize) return false
    
    // Market orders only filter
    if (showMarketOrdersOnly && !fill.isAggressive) return false
    
    return true
  })

  if (filteredFills.length === 0) {
    return (
      <div className="h-[400px] flex items-center justify-center text-muted-foreground">
        No large positions found. Waiting for data...
      </div>
    )
  }

  return (
    <div className="border rounded-lg">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 bg-muted/50 border-b border-border font-medium text-sm text-muted-foreground">
        <div className="w-[100px]">Time</div>
        <div className="w-[120px]">Direction</div>
        <div className="w-[100px]">Size</div>
        <div className="w-[120px]">Price</div>
        <div className="w-[120px]">Notional</div>
        <div className="w-[100px]">Type</div>
        <div className="flex-1">Address</div>
      </div>

      {/* Virtualized List */}
      <TableVirtuoso
        style={{ height: '400px' }}
        data={filteredFills}
        itemContent={(index, fill) => <RowComponent key={fill.id} fill={fill} />}
      />

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 bg-muted/30 border-t border-border text-xs text-muted-foreground">
        <div>
          Showing {filteredFills.length} large positions
          {showMarketOrdersOnly && ' (market orders only)'}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <span>🟡</span>
            <span>$100k-$250k</span>
          </div>
          <div className="flex items-center gap-1">
            <span>🔴</span>
            <span>{'>'}$250k</span>
          </div>
        </div>
      </div>
    </div>
  )
}

