'use client'

import { useEffect, useState, useCallback, memo } from 'react'
import { 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  Users, 
  RefreshCw,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  X,
  ExternalLink,
  Copy,
  Check
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface MinuteAggregate {
  coin: string
  minute_timestamp: string
  new_longs: number
  new_shorts: number
  closed_longs: number
  closed_shorts: number
  increased_longs: number
  increased_shorts: number
  decreased_longs: number
  decreased_shorts: number
  long_volume_in: number
  short_volume_in: number
  long_volume_out: number
  short_volume_out: number
  net_long_flow: number
  net_short_flow: number
  net_total_flow: number
  unique_wallets: number
  new_wallets: number
  whale_wallets: number
  avg_price: number
  volume_weighted_price: number
  price_range_low: number
  price_range_high: number
  total_volume: number
}

interface WalletDetail {
  address: string
  totalNotional: number
  buyNotional: number
  sellNotional: number
  fills: number
  avgPrice: number
  directions: string[]
  side: 'B' | 'A' | 'mixed'
  latestTimestamp: string
}

interface ModalData {
  coin: string
  minute: string
  type: 'long_in' | 'short_in' | 'new_longs' | 'new_shorts' | 'all'
  label: string
}

const COINS = ['BTC', 'ETH', 'HYPE'] as const
type Coin = typeof COINS[number]

const COIN_COLORS: Record<Coin, string> = {
  BTC: 'from-orange-500 to-amber-600',
  ETH: 'from-blue-500 to-indigo-600',
  HYPE: 'from-emerald-500 to-teal-600'
}

const COIN_ICONS: Record<Coin, string> = {
  BTC: '₿',
  ETH: 'Ξ',
  HYPE: '◈'
}

const formatVolume = (value: number): string => {
  if (!value || isNaN(value)) return '$0'
  const absValue = Math.abs(value)
  if (absValue >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (absValue >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value.toFixed(0)}`
}

const formatTime = (timestamp: string): string => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  })
}

const formatPrice = (price: number): string => {
  if (!price || isNaN(price)) return '-'
  if (price >= 1000) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (price >= 1) return `$${price.toFixed(2)}`
  return `$${price.toFixed(4)}`
}

const truncateAddress = (addr: string): string => {
  if (!addr) return ''
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

const FlowIndicator = memo(function FlowIndicator({ value }: { value: number }) {
  if (value > 0) {
    return (
      <div className="flex items-center gap-1 text-emerald-400">
        <ArrowUpRight className="w-3.5 h-3.5" />
        <span className="font-mono text-sm">{formatVolume(value)}</span>
      </div>
    )
  } else if (value < 0) {
    return (
      <div className="flex items-center gap-1 text-rose-400">
        <ArrowDownRight className="w-3.5 h-3.5" />
        <span className="font-mono text-sm">{formatVolume(value)}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1 text-zinc-500">
      <Minus className="w-3.5 h-3.5" />
      <span className="font-mono text-sm">$0</span>
    </div>
  )
})

const StatCard = memo(function StatCard({ 
  label, 
  value, 
  icon: Icon,
  trend,
  className 
}: { 
  label: string
  value: string | number
  icon: React.ElementType
  trend?: 'up' | 'down' | 'neutral'
  className?: string
}) {
  return (
    <div className={cn(
      "bg-zinc-900/50 rounded-lg p-3 border border-zinc-800/50",
      className
    )}>
      <div className="flex items-center gap-2 text-zinc-500 text-xs mb-1">
        <Icon className="w-3.5 h-3.5" />
        <span>{label}</span>
      </div>
      <div className={cn(
        "font-mono text-lg font-semibold",
        trend === 'up' && "text-emerald-400",
        trend === 'down' && "text-rose-400",
        !trend && "text-zinc-100"
      )}>
        {value}
      </div>
    </div>
  )
})

// Clickable cell component
const ClickableCell = memo(function ClickableCell({
  value,
  colorClass,
  onClick,
  disabled = false
}: {
  value: string
  colorClass: string
  onClick: () => void
  disabled?: boolean
}) {
  if (disabled || value === '$0') {
    return <span className={cn("font-mono text-sm", colorClass)}>{value}</span>
  }
  
  return (
    <button
      onClick={onClick}
      className={cn(
        "font-mono text-sm px-2 py-1 -mx-2 -my-1 rounded transition-all",
        "hover:bg-zinc-800 hover:scale-105 cursor-pointer",
        "border border-transparent hover:border-zinc-700",
        colorClass
      )}
    >
      {value}
    </button>
  )
})

// Modal for displaying wallet details
const WalletDetailModal = memo(function WalletDetailModal({
  isOpen,
  onClose,
  modalData
}: {
  isOpen: boolean
  onClose: () => void
  modalData: ModalData | null
}) {
  const [wallets, setWallets] = useState<WalletDetail[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null)
  const [totalNotional, setTotalNotional] = useState(0)
  const [totalBuyVolume, setTotalBuyVolume] = useState(0)
  const [totalSellVolume, setTotalSellVolume] = useState(0)

  useEffect(() => {
    if (!isOpen || !modalData) return

    const fetchDetails = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          coin: modalData.coin,
          minute: modalData.minute,
          type: modalData.type
        })
        const res = await fetch(`/api/fills-detail?${params}`)
        const data = await res.json()
        
        if (!res.ok) throw new Error(data.error)
        
        setWallets(data.wallets || [])
        setTotalNotional(data.totalNotional || 0)
        setTotalBuyVolume(data.totalBuyVolume || 0)
        setTotalSellVolume(data.totalSellVolume || 0)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setIsLoading(false)
      }
    }

    fetchDetails()
  }, [isOpen, modalData])

  const copyAddress = async (addr: string) => {
    await navigator.clipboard.writeText(addr)
    setCopiedAddr(addr)
    setTimeout(() => setCopiedAddr(null), 2000)
  }

  if (!isOpen || !modalData) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-900/50">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">
              {modalData.label}
            </h3>
            <div className="flex items-center gap-4 mt-1">
              <span className="text-sm text-zinc-500">
                {modalData.coin} • {formatTime(modalData.minute)}
              </span>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-emerald-400">
                  ↑ {formatVolume(totalBuyVolume)} buys
                </span>
                <span className="text-rose-400">
                  ↓ {formatVolume(totalSellVolume)} sells
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[60vh] p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-zinc-500" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-rose-400">{error}</div>
          ) : wallets.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              No wallets found for this period
            </div>
          ) : (
            <div className="space-y-2">
              {wallets.map((wallet, idx) => (
                <div 
                  key={wallet.address}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg border transition-colors",
                    "bg-zinc-900/50 hover:bg-zinc-900",
                    wallet.side === 'B' && "border-emerald-500/20 hover:border-emerald-500/40",
                    wallet.side === 'A' && "border-rose-500/20 hover:border-rose-500/40",
                    wallet.side === 'mixed' && "border-zinc-700/50 hover:border-zinc-600",
                    wallet.totalNotional >= 100000 && "border-amber-500/40 bg-amber-500/5"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-xs w-6 font-mono",
                        wallet.side === 'B' ? "text-emerald-500" : wallet.side === 'A' ? "text-rose-500" : "text-zinc-500"
                      )}>
                        {wallet.side === 'B' ? '↑' : wallet.side === 'A' ? '↓' : '↕'}
                      </span>
                      <code className="font-mono text-sm text-zinc-300">
                        {truncateAddress(wallet.address)}
                      </code>
                      <button
                        onClick={() => copyAddress(wallet.address)}
                        className="p-1 rounded hover:bg-zinc-800 transition-colors"
                        title="Copy address"
                      >
                        {copiedAddr === wallet.address ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 text-zinc-500" />
                        )}
                      </button>
                      <a
                        href={`https://hypurrscan.io/address/${wallet.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 rounded hover:bg-zinc-800 transition-colors"
                        title="View on Hypurrscan"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-zinc-500" />
                      </a>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className={cn(
                        "font-mono text-sm font-semibold",
                        wallet.side === 'B' ? "text-emerald-400" : wallet.side === 'A' ? "text-rose-400" : "text-zinc-100"
                      )}>
                        {formatVolume(wallet.totalNotional)}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {wallet.fills} fill{wallet.fills > 1 ? 's' : ''}
                      </div>
                    </div>
                    <div className="text-right min-w-[100px]">
                      <div className="text-xs text-zinc-400">
                        @ {formatPrice(wallet.avgPrice)}
                      </div>
                      <div className="text-xs text-zinc-600 truncate max-w-[100px]">
                        {wallet.directions[0]}
                      </div>
                    </div>
                    {wallet.totalNotional >= 100000 && (
                      <span className="text-lg" title="Whale">🐋</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

export const MinuteAggregatesWidget = memo(function MinuteAggregatesWidget() {
  const [selectedCoin, setSelectedCoin] = useState<Coin>('BTC')
  const [data, setData] = useState<MinuteAggregate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  
  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [modalData, setModalData] = useState<ModalData | null>(null)

  const openModal = useCallback((coin: string, minute: string, type: ModalData['type'], label: string) => {
    setModalData({ coin, minute, type, label })
    setModalOpen(true)
  }, [])

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch(`/api/minute-aggregates?coin=${selectedCoin}&limit=30`)
      const json = await response.json()

      if (!response.ok) {
        throw new Error(json.error || 'Failed to fetch')
      }

      setData(json.aggregates || [])
      setLastUpdate(new Date())
      setError(null)
    } catch (err) {
      console.error('Failed to fetch minute aggregates:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
    } finally {
      setIsLoading(false)
    }
  }, [selectedCoin])

  // Initial fetch
  useEffect(() => {
    setIsLoading(true)
    fetchData()
  }, []) // Only run once on mount
  
  // Polling (pause while modal is open)
  useEffect(() => {
    if (modalOpen) return // Don't auto-refresh while modal is open

    const interval = setInterval(fetchData, 5000) // Refresh every 5 seconds
    return () => clearInterval(interval)
  }, [fetchData, modalOpen])

  // Calculate summary stats from latest data
  const summary = data.length > 0 ? {
    totalVolume: data.slice(0, 5).reduce((sum, d) => sum + (d.total_volume || 0), 0),
    netFlow: data.slice(0, 5).reduce((sum, d) => sum + (d.net_total_flow || 0), 0),
    totalWallets: data.slice(0, 5).reduce((sum, d) => sum + (d.unique_wallets || 0), 0),
    whaleActivity: data.slice(0, 5).reduce((sum, d) => sum + (d.whale_wallets || 0), 0),
    latestPrice: data[0]?.volume_weighted_price || 0
  } : null

  return (
    <>
      <div className="bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-zinc-900 to-zinc-950 px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center text-white font-bold text-lg",
                COIN_COLORS[selectedCoin]
              )}>
                {COIN_ICONS[selectedCoin]}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-100">Position Flow</h2>
                <p className="text-xs text-zinc-500">1-minute aggregates • Click values to see wallets</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Coin Tabs */}
              <div className="flex bg-zinc-900 rounded-lg p-1 gap-1">
                {COINS.map((coin) => (
                  <button
                    key={coin}
                    onClick={() => setSelectedCoin(coin)}
                    className={cn(
                      "px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200",
                      selectedCoin === coin
                        ? "bg-zinc-800 text-zinc-100 shadow-sm"
                        : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
                    )}
                  >
                    {coin}
                  </button>
                ))}
              </div>
              
              {/* Refresh indicator */}
              <button 
                onClick={fetchData}
                className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 transition-colors"
              >
                <RefreshCw className={cn(
                  "w-4 h-4 text-zinc-500",
                  isLoading && "animate-spin"
                )} />
              </button>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-5 gap-3 p-4 border-b border-zinc-800/50">
            <StatCard 
              label="5min Volume" 
              value={formatVolume(summary.totalVolume)} 
              icon={Activity}
            />
            <StatCard 
              label="Net Flow" 
              value={formatVolume(summary.netFlow)} 
              icon={summary.netFlow >= 0 ? TrendingUp : TrendingDown}
              trend={summary.netFlow > 0 ? 'up' : summary.netFlow < 0 ? 'down' : 'neutral'}
            />
            <StatCard 
              label="Active Wallets" 
              value={summary.totalWallets} 
              icon={Users}
            />
            <StatCard 
              label="Whale Trades" 
              value={summary.whaleActivity} 
              icon={Zap}
              trend={summary.whaleActivity > 0 ? 'up' : 'neutral'}
            />
            <StatCard 
              label="VWAP" 
              value={formatPrice(summary.latestPrice)} 
              icon={Activity}
            />
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="text-xs text-zinc-500 border-b border-zinc-800/50">
                <th className="text-left py-3 px-4 font-medium">Time</th>
                <th className="text-right py-3 px-4 font-medium">New L/S</th>
                <th className="text-right py-3 px-4 font-medium">Long In</th>
                <th className="text-right py-3 px-4 font-medium">Short In</th>
                <th className="text-right py-3 px-4 font-medium">Net Flow</th>
                <th className="text-right py-3 px-4 font-medium">Volume</th>
                <th className="text-right py-3 px-4 font-medium">Wallets</th>
                <th className="text-right py-3 px-4 font-medium">VWAP</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && data.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-zinc-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Loading...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-rose-400">
                    {error}
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-zinc-500">
                    <Activity className="w-8 h-8 mx-auto mb-3 text-zinc-700" />
                    <p className="text-zinc-400 mb-1">No aggregated data yet</p>
                    <p className="text-xs text-zinc-600">Fills are being collected and will appear here shortly...</p>
                  </td>
                </tr>
              ) : (
                data.map((row, idx) => (
                  <tr 
                    key={row.minute_timestamp}
                    className={cn(
                      "border-b border-zinc-800/30 hover:bg-zinc-900/50 transition-colors",
                      idx === 0 && "bg-zinc-900/30"
                    )}
                  >
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2">
                        {idx === 0 && (
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        )}
                        <span className={cn(
                          "font-mono text-sm",
                          idx === 0 ? "text-zinc-100" : "text-zinc-400"
                        )}>
                          {formatTime(row.minute_timestamp)}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1 text-sm">
                        <ClickableCell
                          value={String(row.new_longs || 0)}
                          colorClass="text-emerald-400"
                          onClick={() => openModal(row.coin, row.minute_timestamp, 'new_longs', 'New Long Positions')}
                          disabled={(row.new_longs || 0) === 0}
                        />
                        <span className="text-zinc-600">/</span>
                        <ClickableCell
                          value={String(row.new_shorts || 0)}
                          colorClass="text-rose-400"
                          onClick={() => openModal(row.coin, row.minute_timestamp, 'new_shorts', 'New Short Positions')}
                          disabled={(row.new_shorts || 0) === 0}
                        />
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <ClickableCell
                        value={formatVolume(row.long_volume_in || 0)}
                        colorClass="text-emerald-400"
                        onClick={() => openModal(row.coin, row.minute_timestamp, 'all', `All Fills at ${formatTime(row.minute_timestamp)}`)}
                        disabled={(row.long_volume_in || 0) === 0}
                      />
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <ClickableCell
                        value={formatVolume(row.short_volume_in || 0)}
                        colorClass="text-rose-400"
                        onClick={() => openModal(row.coin, row.minute_timestamp, 'all', `All Fills at ${formatTime(row.minute_timestamp)}`)}
                        disabled={(row.short_volume_in || 0) === 0}
                      />
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <FlowIndicator value={row.net_total_flow || 0} />
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <ClickableCell
                        value={formatVolume(row.total_volume || 0)}
                        colorClass="text-zinc-300"
                        onClick={() => openModal(row.coin, row.minute_timestamp, 'all', 'All Activity')}
                        disabled={(row.total_volume || 0) === 0}
                      />
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Users className="w-3 h-3 text-zinc-600" />
                        <ClickableCell
                          value={String(row.unique_wallets || 0)}
                          colorClass="text-zinc-400"
                          onClick={() => openModal(row.coin, row.minute_timestamp, 'all', 'Active Wallets')}
                          disabled={(row.unique_wallets || 0) === 0}
                        />
                        {(row.whale_wallets || 0) > 0 && (
                          <span className="ml-1 px-1.5 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded">
                            🐋 {row.whale_wallets}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <span className="font-mono text-sm text-zinc-400">
                        {formatPrice(row.volume_weighted_price || 0)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-zinc-800/50 flex items-center justify-between text-xs text-zinc-600">
          <span>
            {data.length} rows • Auto-refresh every 5s
          </span>
          {lastUpdate && (
            <span>
              Last update: {lastUpdate.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Wallet Detail Modal */}
      <WalletDetailModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        modalData={modalData}
      />
    </>
  )
})

export default MinuteAggregatesWidget
