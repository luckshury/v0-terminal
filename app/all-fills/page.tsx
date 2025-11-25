'use client'

import React, { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { 
  DockviewReact, 
  DockviewReadyEvent, 
  IDockviewPanelProps,
  DockviewApi,
  SerializedDockview
} from 'dockview-react';
import { TableVirtuoso } from 'react-virtuoso';
import { Badge } from '@/components/ui/badge';
import { Activity, Zap, Filter, Radio, TrendingUp, TrendingDown, BarChart3, Plus, Droplets, X, Settings2, BookOpen, RefreshCw, Sliders, ChevronDown, Target, AlertTriangle, Shield } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';

// ===== PERFORMANCE CONFIG =====
const FILLS_POLL_INTERVAL = 200; // ms - was 50
const LIQUIDATIONS_POLL_INTERVAL = 200; // ms - was 50
const ASSET_PRICES_POLL_INTERVAL = 1000; // ms - was 500
const L4_POLL_INTERVAL = 60000; // ms

// ===== TYPES =====

interface ProcessedFill {
  id: string;
  address: string;
  coin: string;
  price: number;
  size: number;
  side: 'B' | 'A';
  time: number;
  value: number;
  isLong: boolean;
  fee: number;
  pnl: number;
  dir: string;
  hash: string;
}

interface ProcessedLiquidation {
  id: string;
  address: string;
  coin: string;
  price: number;
  size: number;
  side: 'B' | 'A';
  time: number;
  value: number;
  fee: number;
  pnl: number;
  dir: string;
  hash: string;
}

interface FillAPIResponse {
  isConnected: boolean;
  fills: ProcessedFill[];
  timestamp: number;
  lastMessageAgo?: number;
  totalFills?: number;
}

interface LiquidationAPIResponse {
  isConnected: boolean;
  liquidations: ProcessedLiquidation[];
  timestamp: number;
  lastMessageAgo?: number;
  totalLiquidations?: number;
}

// Shared state for fills
interface FillsState {
  isConnected: boolean;
  rows: ProcessedFill[];
  filteredRows: ProcessedFill[];
  lastMessageAgo: number;
  totalFills: number;
  updateCount: number;
  newIds: Set<string>;
  coinFilter: string;
  minSizeFilter: string;
  sideFilter: 'ALL' | 'B' | 'A';
  setCoinFilter: (v: string) => void;
  setMinSizeFilter: (v: string) => void;
  setSideFilter: (v: 'ALL' | 'B' | 'A') => void;
  clearFilters: () => void;
  stats: {
    totalValue: number;
    buyCount: number;
    sellCount: number;
    avgSize: number;
    topCoins: { coin: string; count: number }[];
  };
}

// Shared state for liquidations
interface LiquidationsState {
  isConnected: boolean;
  rows: ProcessedLiquidation[];
  lastMessageAgo: number;
  totalLiquidations: number;
  newIds: Set<string>;
}

// L4 Orderbook types
interface L4Order {
  coin: string;
  side: 'A' | 'B';
  limitPx: string;
  sz: string;
  oid: number;
  timestamp: number;
  triggerCondition?: string;
  isTrigger: boolean;
  triggerPx: string;
  reduceOnly: boolean;
  orderType: string;
  origSz: string;
  tif: string | null;
}

interface L4MarketData {
  book_orders: Array<[string, L4Order]>;
  untriggered_orders: Array<[string, L4Order]>;
}

interface L4SnapshotData {
  height: number;
  markets: Map<string, L4MarketData>;
  marketList: string[];
  timestamp: number;
  cached: boolean;
  cacheAge: number;
}

interface L4State {
  data: L4SnapshotData | null;
  loading: boolean;
  error: string | null;
  lastFetch: number;
}

// Asset price from activeAssetCtx WebSocket
interface AssetPrice {
  coin: string;
  oraclePx: number;
  markPx: number;
  midPx: number;
  impactPxBid: number;
  impactPxAsk: number;
  timestamp: number;
}

interface AssetPricesState {
  isConnected: boolean;
  prices: Record<string, AssetPrice>;
  lastMessageAgo: number;
}

interface OrderDetail {
  address: string;
  size: number;
  price: number;
  oid: number;
  timestamp: number;
  isTrigger: boolean;
  triggerCondition?: string;
  reduceOnly: boolean;
}

interface AggregatedLevel {
  price: number;
  size: number;
  totalValue: number;
  orderCount: number;
  cumulative: number;
  orders: OrderDetail[]; // Individual orders at this level
}

// Global state holder
interface GlobalState {
  fills: FillsState;
  liquidations: LiquidationsState;
  l4: L4State;
  assetPrices: AssetPricesState;
  api: DockviewApi | null;
  addWidget: (type: string) => void;
  refreshL4: () => void;
}

// ===== HELPERS =====

const formatCurrency = (value: number) => 
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value);

const formatCompactCurrency = (value: number) => {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return formatCurrency(value);
};

const formatTime = (timestamp: number) => 
  new Date(timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

const getDirectionBadge = (dir: string) => {
  const lowerDir = dir.toLowerCase();
  if (lowerDir.includes('open long')) return <Badge variant="outline" className="text-[10px] h-5 bg-blue-500/10 text-blue-500 border-blue-500/20">Open Long</Badge>;
  if (lowerDir.includes('close long')) return <Badge variant="outline" className="text-[10px] h-5 bg-red-500/10 text-red-500 border-red-500/20">Close Long</Badge>;
  if (lowerDir.includes('open short')) return <Badge variant="outline" className="text-[10px] h-5 bg-blue-500/10 text-blue-500 border-blue-500/20">Open Short</Badge>;
  if (lowerDir.includes('close short')) return <Badge variant="outline" className="text-[10px] h-5 bg-red-500/10 text-red-500 border-red-500/20">Close Short</Badge>;
  if (lowerDir.includes('long > short')) return <Badge variant="outline" className="text-[10px] h-5 bg-blue-500/10 text-blue-500 border-blue-500/20">Flip Short</Badge>;
  if (lowerDir.includes('short > long')) return <Badge variant="outline" className="text-[10px] h-5 bg-blue-500/10 text-blue-500 border-blue-500/20">Flip Long</Badge>;
  if (lowerDir.includes('liquidated')) return <Badge variant="destructive" className="text-[10px] h-5">LIQ</Badge>;
  return <span className="text-[10px] text-muted-foreground">{dir}</span>;
};

const LivePulse = ({ isLive, size = 'md' }: { isLive: boolean; size?: 'sm' | 'md' }) => (
  <div className="flex items-center gap-1.5">
    <span className={cn("relative flex", size === 'sm' ? 'h-2 w-2' : 'h-3 w-3')}>
      {isLive && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
      )}
      <span className={cn(
        "relative inline-flex rounded-full",
        size === 'sm' ? 'h-2 w-2' : 'h-3 w-3',
        isLive ? "bg-green-500" : "bg-red-500"
      )}></span>
    </span>
    <span className={cn(
      "font-bold uppercase tracking-wider",
      size === 'sm' ? 'text-[10px]' : 'text-xs',
      isLive ? "text-green-500" : "text-red-500"
    )}>
      {isLive ? 'LIVE' : 'OFFLINE'}
    </span>
  </div>
);

// ===== PANEL COMPONENTS - All memoized for performance =====

// Stream Status Panel
const StreamStatusPanel = memo(({ params }: IDockviewPanelProps<{ globalState: GlobalState }>) => {
  const state = params?.globalState?.fills;
  if (!state) return <div className="p-4 text-muted-foreground">Loading...</div>;
  
  return (
    <div className="h-full p-4 flex flex-col gap-3 font-mono bg-card/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className={cn("h-4 w-4", state.isConnected && "animate-pulse text-green-500")} />
          <span className="text-sm font-medium">Stream</span>
        </div>
        <LivePulse isLive={state.isConnected} size="sm" />
      </div>
      
      <div className="flex-1 flex flex-col justify-center">
        <div className="text-3xl font-bold tracking-tighter tabular-nums text-center">
          {state.updateCount.toLocaleString()}
        </div>
        <div className="text-xs text-muted-foreground text-center">received</div>
      </div>
      
      <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-2">
        <span className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
          state.lastMessageAgo < 5000 ? "bg-green-500/20 text-green-500" : "bg-yellow-500/20 text-yellow-500"
        )}>
          <Activity className="h-3 w-3" />
          {state.lastMessageAgo < 1000 ? 'Live' : `${Math.floor(state.lastMessageAgo / 1000)}s`}
        </span>
        <span>{state.totalFills.toLocaleString()} cached</span>
      </div>
    </div>
  );
});

// Latest Fill Panel
const LatestFillPanel = memo(({ params }: IDockviewPanelProps<{ globalState: GlobalState }>) => {
  const state = params?.globalState?.fills;
  if (!state) return <div className="p-4 text-muted-foreground">Loading...</div>;
  
  const latest = state.rows[0];
  
  return (
    <div className="h-full p-4 flex flex-col gap-2 font-mono bg-card/50">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Latest Fill</span>
        <Zap className="h-4 w-4 text-yellow-500" />
      </div>
      
      {latest ? (
        <div className="flex-1 flex flex-col justify-center gap-1">
          <div className="text-2xl font-bold tracking-tight text-center">{latest.coin}</div>
          <div className={cn(
            "text-xl font-mono text-center",
            latest.side === 'B' ? "text-green-500" : "text-red-500"
          )}>
            {formatCurrency(latest.value)}
          </div>
          <div className="text-xs text-muted-foreground text-center">
            {formatTime(latest.time)} • {latest.side === 'B' ? 'BUY' : 'SELL'}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Waiting for data...
        </div>
      )}
    </div>
  );
});

// Stats Panel
const StatsPanel = memo(({ params }: IDockviewPanelProps<{ globalState: GlobalState }>) => {
  const state = params?.globalState?.fills;
  if (!state) return <div className="p-4 text-muted-foreground">Loading...</div>;
  
  const { stats } = state;
  
  return (
    <div className="h-full p-4 flex flex-col gap-3 font-mono bg-card/50 overflow-auto">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Fill Statistics</span>
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-background/50 rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">Total Value</div>
          <div className="text-lg font-bold text-primary">{formatCompactCurrency(stats.totalValue)}</div>
        </div>
        <div className="bg-background/50 rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">Avg Size</div>
          <div className="text-lg font-bold">{formatCompactCurrency(stats.avgSize)}</div>
        </div>
        <div className="bg-background/50 rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-green-500" /> Buys
          </div>
          <div className="text-lg font-bold text-green-500">{stats.buyCount.toLocaleString()}</div>
        </div>
        <div className="bg-background/50 rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <TrendingDown className="h-3 w-3 text-red-500" /> Sells
          </div>
          <div className="text-lg font-bold text-red-500">{stats.sellCount.toLocaleString()}</div>
        </div>
      </div>
      
      {stats.topCoins.length > 0 && (
        <div className="mt-2">
          <div className="text-xs text-muted-foreground mb-2">Top Coins</div>
          <div className="flex flex-wrap gap-1">
            {stats.topCoins.slice(0, 5).map(({ coin, count }) => (
              <Badge key={coin} variant="secondary" className="text-[10px] font-mono">
                {coin}: {count}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

// Filters Panel
const FiltersPanel = memo(({ params }: IDockviewPanelProps<{ globalState: GlobalState }>) => {
  const state = params?.globalState?.fills;
  if (!state) return <div className="p-4 text-muted-foreground">Loading...</div>;
  
  return (
    <div className="h-full p-4 flex flex-col gap-3 font-mono bg-card/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4" />
          <span className="text-sm font-medium">Filters</span>
        </div>
        <Badge variant="outline" className="font-mono text-[10px]">
          {state.filteredRows.length.toLocaleString()} shown
        </Badge>
      </div>
      
      <div className="flex-1 flex flex-col gap-2">
        <Input 
          placeholder="Coin or Address..." 
          className="h-8 text-xs font-mono bg-background/50" 
          value={state.coinFilter}
          onChange={e => state.setCoinFilter(e.target.value)}
        />
        <Input 
          placeholder="Min Value ($)" 
          className="h-8 text-xs font-mono bg-background/50"
          type="number"
          value={state.minSizeFilter}
          onChange={e => state.setMinSizeFilter(e.target.value)}
        />
        <Select value={state.sideFilter} onValueChange={(val: 'ALL' | 'B' | 'A') => state.setSideFilter(val)}>
          <SelectTrigger className="h-8 font-mono text-xs bg-background/50">
            <SelectValue placeholder="Side" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL" className="font-mono text-xs">All Sides</SelectItem>
            <SelectItem value="B" className="font-mono text-xs text-green-500">Buy Only</SelectItem>
            <SelectItem value="A" className="font-mono text-xs text-red-500">Sell Only</SelectItem>
          </SelectContent>
        </Select>
        <Button 
          variant="secondary" 
          size="sm"
          className="font-mono text-xs mt-auto"
          onClick={state.clearFilters}
        >
          Clear All
        </Button>
      </div>
    </div>
  );
});

// Main Fills Table Panel - Memoized
const FillsTablePanel = memo(({ params }: IDockviewPanelProps<{ globalState: GlobalState }>) => {
  const state = params?.globalState?.fills;
  if (!state) return <div className="p-4 text-muted-foreground">Loading...</div>;
  
  return (
    <div className="h-full flex flex-col font-mono bg-card/30">
      <div className="px-4 py-2 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">All Fills Feed</span>
          <LivePulse isLive={state.isConnected} size="sm" />
        </div>
        <Badge variant="outline" className="font-mono text-[10px] tabular-nums">
          {state.filteredRows.length.toLocaleString()} displayed
        </Badge>
      </div>
      
      <div className="flex-1 min-h-0">
        <TableVirtuoso
          data={state.filteredRows}
          overscan={10}
          fixedHeaderContent={() => (
            <tr className="bg-muted/50 border-b border-border">
              <th className="h-10 px-2 text-left align-middle font-medium text-muted-foreground text-[11px] w-20">Time</th>
              <th className="h-10 px-2 text-left align-middle font-medium text-muted-foreground text-[11px] w-16">Coin</th>
              <th className="h-10 px-2 text-left align-middle font-medium text-muted-foreground text-[11px] w-12">Side</th>
              <th className="h-10 px-2 text-right align-middle font-medium text-muted-foreground text-[11px] w-24">Price</th>
              <th className="h-10 px-2 text-right align-middle font-medium text-muted-foreground text-[11px] w-24">Value</th>
              <th className="h-10 px-2 text-right align-middle font-medium text-muted-foreground text-[11px] w-24">PnL</th>
              <th className="h-10 px-2 text-center align-middle font-medium text-muted-foreground text-[11px] w-28">Wallet</th>
            </tr>
          )}
          itemContent={(index, fill) => {
            const isNew = state.newIds.has(fill.id);
            const isBuy = fill.side === 'B';
  
            return (
              <>
                <td className={cn("p-2 whitespace-nowrap font-mono text-[11px] text-muted-foreground h-9", isNew && "bg-primary/20")}>
                  {formatTime(fill.time)}
                </td>
                <td className={cn("p-2 whitespace-nowrap font-bold font-mono text-[11px] h-9", isNew && "bg-primary/20")}>
                  {fill.coin}
                </td>
                <td className={cn("p-2 whitespace-nowrap font-mono text-[11px] h-9", isBuy ? "text-green-500" : "text-red-500", isNew && "bg-primary/20")}>
                  {isBuy ? 'BUY' : 'SELL'}
                </td>
                <td className={cn("p-2 whitespace-nowrap font-mono text-[11px] text-right h-9", isNew && "bg-primary/20")}>
                  {formatCurrency(fill.price)}
                </td>
                <td className={cn("p-2 whitespace-nowrap font-mono text-[11px] text-right h-9", isNew && "bg-primary/20")}>
                  {formatCurrency(fill.value)}
                </td>
                <td className={cn("p-2 whitespace-nowrap font-mono text-[11px] text-right h-9", isNew && "bg-primary/20")}>
                  <span className={fill.pnl > 0 ? "text-green-500" : fill.pnl < 0 ? "text-red-500" : "text-muted-foreground"}>
                    {fill.pnl !== 0 ? formatCurrency(fill.pnl) : '-'}
                  </span>
                </td>
                <td className={cn("p-2 whitespace-nowrap font-mono text-[10px] text-center h-9", isNew && "bg-primary/20")}>
                  {fill.address ? (
                    <button 
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        window.open(`https://www.flowscan.xyz/address/${fill.address}`, '_blank', 'noopener,noreferrer');
                      }}
                      className="text-blue-500 underline cursor-pointer bg-transparent border-none p-0 font-mono text-[10px] select-none"
                    >
                      {fill.address.substring(0, 6)}...{fill.address.substring(fill.address.length - 4)}
                    </button>
                  ) : '-'}
                </td>
              </>
            );
          }}
          components={{
            Table: (props) => <table {...props} className="w-full caption-bottom text-sm border-collapse" />,
            TableRow: (props) => <tr {...props} className="border-b border-border/50 h-9" />,
          }}
        />
      </div>
    </div>
  );
});

// ===== WIDGET FILTER PERSISTENCE =====
const WIDGET_FILTERS_KEY_PREFIX = 'widget-filters-';

interface WidgetFilters {
  coinFilter: string;
  minValueFilter: string;
  sideFilter: 'ALL' | 'B' | 'A';
  showFilters: boolean;
}

const loadWidgetFilters = (widgetId: string): WidgetFilters => {
  if (typeof window === 'undefined') return { coinFilter: '', minValueFilter: '', sideFilter: 'ALL', showFilters: false };
  try {
    const saved = localStorage.getItem(`${WIDGET_FILTERS_KEY_PREFIX}${widgetId}`);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load widget filters:', e);
  }
  return { coinFilter: '', minValueFilter: '', sideFilter: 'ALL', showFilters: false };
};

const saveWidgetFilters = (widgetId: string, filters: WidgetFilters) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${WIDGET_FILTERS_KEY_PREFIX}${widgetId}`, JSON.stringify(filters));
  } catch (e) {
    console.error('Failed to save widget filters:', e);
  }
};

// Quick coin presets for liquidations
const LIQUIDATION_COIN_PRESETS = [
  { label: 'All', value: '' },
  { label: 'BTC', value: 'BTC' },
  { label: 'ETH', value: 'ETH' },
  { label: 'SOL', value: 'SOL' },
  { label: 'HYPE', value: 'HYPE' },
];

const VALUE_PRESETS = [
  { label: 'Any', value: '' },
  { label: '>$1K', value: '1000' },
  { label: '>$5K', value: '5000' },
  { label: '>$10K', value: '10000' },
  { label: '>$50K', value: '50000' },
  { label: '>$100K', value: '100000' },
];

// ===== LIQUIDATION WIDGET =====
// Memoized for performance - each instance has its own filters
const LiquidationWidget = memo(({ params }: IDockviewPanelProps<{ globalState: GlobalState; widgetId: string }>) => {
  const globalState = params?.globalState;
  const widgetId = params?.widgetId || 'default';
  
  // Local filter state for this widget instance
  const [coinFilter, setCoinFilter] = useState('');
  const [minValueFilter, setMinValueFilter] = useState('');
  const [sideFilter, setSideFilter] = useState<'ALL' | 'B' | 'A'>('ALL');
  const [showFilters, setShowFilters] = useState(false);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  
  // Load filters from localStorage when widgetId is available
  useEffect(() => {
    if (widgetId && !filtersLoaded) {
      const savedFilters = loadWidgetFilters(widgetId);
      setCoinFilter(savedFilters.coinFilter);
      setMinValueFilter(savedFilters.minValueFilter);
      setSideFilter(savedFilters.sideFilter);
      setShowFilters(savedFilters.showFilters);
      setFiltersLoaded(true);
    }
  }, [widgetId, filtersLoaded]);
  
  // Save filters - debounced
  useEffect(() => {
    if (!filtersLoaded || !widgetId) return;
    const timeout = setTimeout(() => {
      saveWidgetFilters(widgetId, { coinFilter, minValueFilter, sideFilter, showFilters });
    }, 300);
    return () => clearTimeout(timeout);
  }, [widgetId, coinFilter, minValueFilter, sideFilter, showFilters, filtersLoaded]);
  
  // Extract data - handle case when globalState is not yet available
  const liquidationsData = globalState?.liquidations;
  const rows = liquidationsData?.rows ?? [];
  const isConnected = liquidationsData?.isConnected ?? false;
  const newIds = liquidationsData?.newIds ?? new Set<string>();
  
  // Apply local filters - hooks must always be called in same order
  const filteredRows = useMemo(() => {
    if (rows.length === 0) return [];
    if (!coinFilter && !minValueFilter && sideFilter === 'ALL') return rows;
    
    const lowerCoin = coinFilter.toLowerCase();
    const minVal = minValueFilter ? parseFloat(minValueFilter) : 0;

    return rows.filter(r => {
      if (coinFilter && !r.coin.toLowerCase().includes(lowerCoin) && !r.address.toLowerCase().includes(lowerCoin)) return false;
      if (minVal > 0 && r.value < minVal) return false;
      if (sideFilter !== 'ALL' && r.side !== sideFilter) return false;
      return true;
    });
  }, [rows, coinFilter, minValueFilter, sideFilter]);
  
  // Calculate stats for this filtered view
  const stats = useMemo(() => {
    const totalValue = filteredRows.reduce((sum, r) => sum + r.value, 0);
    const buyCount = filteredRows.filter(r => r.side === 'B').length;
    const sellCount = filteredRows.filter(r => r.side === 'A').length;
    return { totalValue, buyCount, sellCount };
  }, [filteredRows]);
  
  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (coinFilter) count++;
    if (minValueFilter) count++;
    if (sideFilter !== 'ALL') count++;
    return count;
  }, [coinFilter, minValueFilter, sideFilter]);
  
  // Show loading state if no data yet
  if (!liquidationsData) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="h-full flex flex-col font-mono bg-card/30">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0 bg-card/50">
        <div className="flex items-center gap-2">
          <Droplets className="h-4 w-4 text-red-500" />
          <span className="text-sm font-medium">Liquidations</span>
          <LivePulse isLive={isConnected} size="sm" />
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-[10px] tabular-nums">
            {filteredRows.length.toLocaleString()}
          </Badge>
          <Button 
            variant={showFilters ? "default" : "ghost"} 
            size="sm" 
            className="h-6 w-6 p-0 relative"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className={cn("h-3 w-3", showFilters && "text-primary-foreground")} />
            {activeFilterCount > 0 && !showFilters && (
              <span className="absolute -top-1 -right-1 h-3.5 w-3.5 text-[8px] bg-primary text-primary-foreground rounded-full flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>
      </div>
      
      {/* Filter Bar (collapsible) - with quick presets */}
      {showFilters && (
        <div className="px-3 py-2 border-b border-border bg-muted/30 flex flex-col gap-2 shrink-0">
          {/* Quick coin presets */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground w-12">Coin:</span>
            {LIQUIDATION_COIN_PRESETS.map(preset => (
              <Button
                key={preset.value}
                variant={coinFilter === preset.value ? "default" : "ghost"}
                size="sm"
                className="h-5 px-2 text-[10px]"
                onClick={() => setCoinFilter(preset.value)}
              >
                {preset.label}
              </Button>
            ))}
            <Input 
              placeholder="Custom..." 
              className="h-5 text-[10px] font-mono bg-background/50 w-20 ml-1" 
              value={coinFilter}
              onChange={e => setCoinFilter(e.target.value)}
            />
          </div>
          
          {/* Quick value presets */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground w-12">Value:</span>
            {VALUE_PRESETS.map(preset => (
              <Button
                key={preset.value}
                variant={minValueFilter === preset.value ? "default" : "ghost"}
                size="sm"
                className="h-5 px-2 text-[10px]"
                onClick={() => setMinValueFilter(preset.value)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          
          {/* Side filter and clear */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground w-12">Side:</span>
            <Button
              variant={sideFilter === 'ALL' ? "default" : "ghost"}
              size="sm"
              className="h-5 px-2 text-[10px]"
              onClick={() => setSideFilter('ALL')}
            >
              All
            </Button>
            <Button
              variant={sideFilter === 'B' ? "default" : "ghost"}
              size="sm"
              className="h-5 px-2 text-[10px] text-green-500"
              onClick={() => setSideFilter('B')}
            >
              Long Liqs
            </Button>
            <Button
              variant={sideFilter === 'A' ? "default" : "ghost"}
              size="sm"
              className="h-5 px-2 text-[10px] text-red-500"
              onClick={() => setSideFilter('A')}
            >
              Short Liqs
            </Button>
            {activeFilterCount > 0 && (
              <Button 
                variant="ghost" 
                size="sm"
                className="h-5 text-[10px] px-2 ml-auto text-muted-foreground"
                onClick={() => { setCoinFilter(''); setMinValueFilter(''); setSideFilter('ALL'); }}
              >
                Clear All
              </Button>
            )}
          </div>
        </div>
      )}
      
      {/* Stats Bar */}
      <div className="px-3 py-1.5 border-b border-border bg-muted/20 flex items-center gap-4 text-[10px] shrink-0">
        <span className="text-muted-foreground">
          Total: <span className="text-foreground font-medium">{formatCompactCurrency(stats.totalValue)}</span>
        </span>
        <span className="text-green-500">
          Longs: {stats.buyCount}
        </span>
        <span className="text-red-500">
          Shorts: {stats.sellCount}
        </span>
      </div>
      
      {/* Table - optimized with fixed row heights */}
      <div className="flex-1 min-h-0">
        <TableVirtuoso
          data={filteredRows}
          overscan={10}
          fixedHeaderContent={() => (
            <tr className="bg-muted/50 border-b border-border">
              <th className="h-8 px-2 text-left align-middle font-medium text-muted-foreground text-[10px]">Time</th>
              <th className="h-8 px-2 text-left align-middle font-medium text-muted-foreground text-[10px]">Coin</th>
              <th className="h-8 px-2 text-left align-middle font-medium text-muted-foreground text-[10px]">Side</th>
              <th className="h-8 px-2 text-right align-middle font-medium text-muted-foreground text-[10px]">Price</th>
              <th className="h-8 px-2 text-right align-middle font-medium text-muted-foreground text-[10px]">Size</th>
              <th className="h-8 px-2 text-right align-middle font-medium text-muted-foreground text-[10px]">Value</th>
              <th className="h-8 px-2 text-right align-middle font-medium text-muted-foreground text-[10px]">PnL</th>
            </tr>
          )}
          itemContent={(index, liq) => {
            const isNew = newIds.has(liq.id);
            const isBuy = liq.side === 'B';
            
            return (
              <>
                <td className={cn("p-2 whitespace-nowrap font-mono text-[10px] text-muted-foreground h-8", isNew && "bg-red-500/20")}>
                  {formatTime(liq.time)}
                </td>
                <td className={cn("p-2 whitespace-nowrap font-bold font-mono text-[10px] h-8", isNew && "bg-red-500/20")}>
                  {liq.coin}
                </td>
                <td className={cn("p-2 whitespace-nowrap font-mono text-[10px] h-8", isBuy ? "text-green-500" : "text-red-500", isNew && "bg-red-500/20")}>
                  {isBuy ? 'LONG' : 'SHORT'}
                </td>
                <td className={cn("p-2 whitespace-nowrap font-mono text-[10px] text-right h-8", isNew && "bg-red-500/20")}>
                  {formatCurrency(liq.price)}
                </td>
                <td className={cn("p-2 whitespace-nowrap font-mono text-[10px] text-right h-8", isNew && "bg-red-500/20")}>
                  {liq.size.toFixed(4)}
                </td>
                <td className={cn("p-2 whitespace-nowrap font-mono text-[10px] text-right h-8", isNew && "bg-red-500/20")}>
                  {formatCurrency(liq.value)}
                </td>
                <td className={cn("p-2 whitespace-nowrap font-mono text-[10px] text-right h-8", isNew && "bg-red-500/20")}>
                  <span className={liq.pnl > 0 ? "text-green-500" : liq.pnl < 0 ? "text-red-500" : "text-muted-foreground"}>
                    {liq.pnl !== 0 ? formatCurrency(liq.pnl) : '-'}
                  </span>
                </td>
              </>
            );
          }}
          components={{
            Table: (props) => <table {...props} className="w-full caption-bottom text-sm border-collapse" />,
            TableRow: (props) => <tr {...props} className="border-b border-border/50 h-8" />,
          }}
        />
      </div>
    </div>
  );
});

// Liquidation Stats Widget - Memoized
const LiquidationStatsWidget = memo(({ params }: IDockviewPanelProps<{ globalState: GlobalState }>) => {
  const globalState = params?.globalState;
  
  // Extract data - handle case when globalState is not yet available
  const liquidationsData = globalState?.liquidations;
  const rows = liquidationsData?.rows ?? [];
  const isConnected = liquidationsData?.isConnected ?? false;
  const totalLiquidations = liquidationsData?.totalLiquidations ?? 0;
  
  // Calculate stats - hooks must always be called in same order
  const stats = useMemo(() => {
    if (rows.length === 0) {
      return { totalValue: 0, buyCount: 0, sellCount: 0, avgValue: 0, totalPnl: 0, topCoins: [] as { coin: string; count: number; value: number }[] };
    }
    
    const totalValue = rows.reduce((sum, r) => sum + r.value, 0);
    const buyCount = rows.filter(r => r.side === 'B').length;
    const sellCount = rows.filter(r => r.side === 'A').length;
    const avgValue = rows.length > 0 ? totalValue / rows.length : 0;
    const totalPnl = rows.reduce((sum, r) => sum + r.pnl, 0);
    
    // Count by coin
    const coinCounts: Record<string, { count: number; value: number }> = {};
    rows.forEach(r => {
      if (!coinCounts[r.coin]) coinCounts[r.coin] = { count: 0, value: 0 };
      coinCounts[r.coin].count++;
      coinCounts[r.coin].value += r.value;
    });
    const topCoins = Object.entries(coinCounts)
      .map(([coin, data]) => ({ coin, ...data }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
    
    return { totalValue, buyCount, sellCount, avgValue, totalPnl, topCoins };
  }, [rows]);
  
  // Show loading state if no data yet
  if (!liquidationsData) return <div className="p-4 text-muted-foreground">Loading...</div>;
  
  return (
    <div className="h-full p-4 flex flex-col gap-3 font-mono bg-card/50 overflow-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Droplets className="h-4 w-4 text-red-500" />
          <span className="text-sm font-medium">Liquidation Stats</span>
        </div>
        <LivePulse isLive={isConnected} size="sm" />
      </div>
      
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-background/50 rounded-lg p-2.5">
          <div className="text-[10px] text-muted-foreground mb-0.5">Total Value</div>
          <div className="text-base font-bold text-red-500">{formatCompactCurrency(stats.totalValue)}</div>
        </div>
        <div className="bg-background/50 rounded-lg p-2.5">
          <div className="text-[10px] text-muted-foreground mb-0.5">Total PnL</div>
          <div className={cn("text-base font-bold", stats.totalPnl > 0 ? "text-green-500" : "text-red-500")}>
            {formatCompactCurrency(stats.totalPnl)}
          </div>
        </div>
        <div className="bg-background/50 rounded-lg p-2.5">
          <div className="text-[10px] text-muted-foreground mb-0.5">Avg Liq Size</div>
          <div className="text-base font-bold">{formatCompactCurrency(stats.avgValue)}</div>
        </div>
        <div className="bg-background/50 rounded-lg p-2.5">
          <div className="text-[10px] text-muted-foreground mb-0.5">Count</div>
          <div className="text-base font-bold">{totalLiquidations.toLocaleString()}</div>
        </div>
      </div>
      
      <div className="flex gap-4 text-xs">
        <span className="text-green-500">Longs Liq: {stats.buyCount}</span>
        <span className="text-red-500">Shorts Liq: {stats.sellCount}</span>
      </div>
      
      {stats.topCoins.length > 0 && (
        <div className="mt-1">
          <div className="text-[10px] text-muted-foreground mb-1.5">Top Liquidated</div>
          <div className="space-y-1">
            {stats.topCoins.map(({ coin, count, value }) => (
              <div key={coin} className="flex items-center justify-between text-[10px]">
                <span className="font-medium">{coin}</span>
                <span className="text-muted-foreground">{count} liqs • {formatCompactCurrency(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

// ===== L4 ORDERBOOK WIDGET =====

// Helper to get smart grouping options based on price
const getGroupingOptions = (price: number): number[] => {
  if (price > 50000) return [10, 50, 100, 500, 1000, 5000];
  if (price > 10000) return [5, 10, 50, 100, 500, 1000];
  if (price > 1000) return [1, 5, 10, 50, 100, 500];
  if (price > 100) return [0.5, 1, 5, 10, 50, 100];
  if (price > 10) return [0.1, 0.5, 1, 5, 10, 50];
  if (price > 1) return [0.01, 0.05, 0.1, 0.5, 1, 5];
  return [0.001, 0.005, 0.01, 0.05, 0.1, 0.5];
};

// L4 filter types
type L4OrderTypeFilter = 'all' | 'book' | 'triggers' | 'sl' | 'tp';
type L4SideFilter = 'both' | 'asks' | 'bids';

interface L4FilterConfig {
  orderType: L4OrderTypeFilter;
  sideFilter: L4SideFilter;
  minSize: number;
  reduceOnlyOnly: boolean;
  hideSmallOrders: boolean; // Hide orders < 0.1% of total depth
}

// Aggregate orders into price levels with advanced filtering
const aggregateOrders = (
  orders: Array<[string, L4Order]>,
  grouping: number,
  side: 'A' | 'B',
  limit: number = 15,
  filters?: Partial<L4FilterConfig>,
  currentPrice?: number
): AggregatedLevel[] => {
  const levels = new Map<number, AggregatedLevel>();
  const minSize = filters?.minSize || 0;
  const reduceOnlyOnly = filters?.reduceOnlyOnly || false;
  
  for (const [address, order] of orders) {
    if (order.side !== side) continue;
    
    // Apply reduceOnly filter - only show orders that will reduce/close a position
    if (reduceOnlyOnly && !order.reduceOnly) continue;
    
    // Use triggerPx for trigger orders, limitPx for regular orders
    const price = parseFloat(order.isTrigger && order.triggerPx ? order.triggerPx : order.limitPx);
    const size = parseFloat(order.sz);
    if (isNaN(price) || isNaN(size) || size <= 0 || price <= 0) continue;
    
    // CRITICAL: Filter by current price - STRICT comparison, no overlap
    // Asks must be ABOVE current price (sellers want higher prices)
    // Bids must be BELOW current price (buyers want lower prices)
    if (currentPrice && currentPrice > 0) {
      if (side === 'A' && price <= currentPrice) continue; // Asks strictly ABOVE current price
      if (side === 'B' && price >= currentPrice) continue; // Bids strictly BELOW current price
    }
    
    // Apply min size filter
    if (size < minSize) continue;
    
    const bucket = Math.floor(price / grouping) * grouping;
    
    const existing = levels.get(bucket) || {
      price: bucket,
      size: 0,
      totalValue: 0,
      orderCount: 0,
      cumulative: 0,
      orders: [],
    };
    
    existing.size += size;
    existing.totalValue += size * price;
    existing.orderCount += 1;
    existing.orders.push({
      address,
      size,
      price,
      oid: order.oid,
      timestamp: order.timestamp,
      isTrigger: order.isTrigger,
      triggerCondition: order.triggerCondition,
      reduceOnly: order.reduceOnly,
    });
    
    levels.set(bucket, existing);
  }
  
  // For asks: sort low to high, take closest to current price (lowest asks)
  // For bids: sort high to low, take closest to current price (highest bids)
  let sorted = [...levels.values()];
  
  if (side === 'A') {
    // Asks: sort ascending (lowest first), take lowest N (closest to spread)
    sorted = sorted.sort((a, b) => a.price - b.price).slice(0, limit);
    // Then reverse so highest is at top (for display: high prices at top of asks section)
    sorted = sorted.reverse();
  } else {
    // Bids: sort descending (highest first), take highest N (closest to spread)
    sorted = sorted.sort((a, b) => b.price - a.price).slice(0, limit);
  }
  
  // Calculate cumulative from spread outward
  let cumulative = 0;
  const forCumulative = side === 'A' ? [...sorted].reverse() : sorted;
  for (const level of forCumulative) {
    cumulative += level.size;
    level.cumulative = cumulative;
    // Sort orders within each level by size (largest first)
    level.orders.sort((a, b) => b.size - a.size);
  }
  
  return sorted;
};

// Quick ticker presets for L4
const TICKER_PRESETS = {
  'Major': ['BTC', 'ETH', 'SOL'],
  'L1s': ['AVAX', 'DOT', 'ADA', 'ATOM', 'NEAR'],
  'L2s': ['ARB', 'OP', 'MATIC', 'BASE'],
  'Memes': ['DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK'],
  'DeFi': ['UNI', 'AAVE', 'LINK', 'MKR', 'SNX'],
};

// Order details popup component
const OrderDetailsPopup = memo(({ 
  level, 
  side, 
  onClose,
  position 
}: { 
  level: AggregatedLevel; 
  side: 'ask' | 'bid';
  onClose: () => void;
  position: { x: number; y: number };
}) => {
  const popupRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  
  // Adjust position to stay within viewport
  useEffect(() => {
    const popupWidth = 380;
    const popupHeight = 320;
    const padding = 10;
    
    let x = position.x;
    let y = position.y;
    
    // Check right edge
    if (x + popupWidth > window.innerWidth - padding) {
      x = window.innerWidth - popupWidth - padding;
    }
    // Check left edge
    if (x < padding) {
      x = padding;
    }
    // Check bottom edge - if popup would go off bottom, show above the click point
    if (y + popupHeight > window.innerHeight - padding) {
      y = position.y - popupHeight - 30; // Show above
    }
    // Check top edge
    if (y < padding) {
      y = padding;
    }
    
    setAdjustedPosition({ x, y });
  }, [position]);
  
  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);
  
  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);
  
  const isAsk = side === 'ask';
  
  return (
    <div 
      ref={popupRef}
      className="fixed z-[100] bg-card border border-border rounded-lg shadow-2xl font-mono text-xs overflow-hidden"
      style={{ 
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        width: 380,
        maxHeight: 320,
      }}
    >
      {/* Header */}
      <div className={cn(
        "px-3 py-2 border-b border-border flex items-center justify-between",
        isAsk ? "bg-red-500/10" : "bg-green-500/10"
      )}>
        <div className="flex items-center gap-2">
          <span className={cn("font-bold", isAsk ? "text-red-400" : "text-green-400")}>
            ${level.price.toLocaleString()}
          </span>
          <Badge variant="outline" className="text-[9px]">
            {level.orderCount} orders
          </Badge>
          <Badge variant="outline" className="text-[9px]">
            {level.size.toFixed(4)} total
          </Badge>
        </div>
        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      
      {/* Orders list */}
      <div className="max-h-[280px] overflow-y-auto">
        <table className="w-full text-[10px]">
          <thead className="sticky top-0 bg-muted/90 backdrop-blur-sm">
            <tr className="border-b border-border">
              <th className="py-1.5 px-2 text-left font-medium text-muted-foreground">Address</th>
              <th className="py-1.5 px-2 text-right font-medium text-muted-foreground">Size</th>
              <th className="py-1.5 px-2 text-right font-medium text-muted-foreground">Price</th>
              <th className="py-1.5 px-2 text-center font-medium text-muted-foreground">Type</th>
            </tr>
          </thead>
          <tbody>
            {level.orders.map((order, idx) => (
              <tr key={`${order.address}-${order.oid}-${idx}`} className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-1.5 px-2">
                  <button
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      window.open(`https://www.flowscan.xyz/address/${order.address}`, '_blank', 'noopener,noreferrer');
                    }}
                    className="text-blue-400 hover:text-blue-300 underline cursor-pointer bg-transparent border-none p-0 font-mono text-[10px]"
                  >
                    {order.address.substring(0, 6)}...{order.address.substring(order.address.length - 4)}
                  </button>
                </td>
                <td className={cn("py-1.5 px-2 text-right font-mono", isAsk ? "text-red-400" : "text-green-400")}>
                  {order.size.toFixed(4)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">
                  ${order.price.toLocaleString()}
                </td>
                <td className="py-1.5 px-2 text-center">
                  {order.isTrigger ? (
                    <Badge variant="outline" className={cn(
                      "text-[8px] h-4",
                      order.triggerCondition === 'sl' ? "bg-orange-500/20 text-orange-400 border-orange-500/30" :
                      order.triggerCondition === 'tp' ? "bg-green-500/20 text-green-400 border-green-500/30" :
                      "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                    )}>
                      {order.triggerCondition === 'sl' ? 'SL' : 
                       order.triggerCondition === 'tp' ? 'TP' : 'TRIG'}
                    </Badge>
                  ) : order.reduceOnly ? (
                    <Badge variant="outline" className="text-[8px] h-4 bg-purple-500/20 text-purple-400 border-purple-500/30">
                      RO
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[8px] h-4">
                      LMT
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Footer with totals */}
      <div className="px-3 py-2 border-t border-border bg-muted/30 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Total Value: {formatCompactCurrency(level.totalValue)}</span>
        <span className="text-[9px]">Click address to view on Flowscan</span>
      </div>
    </div>
  );
});

// L4 Orderbook Widget Component - Memoized for performance
const L4OrderbookWidget = memo(({ params }: IDockviewPanelProps<{ globalState: GlobalState; widgetId: string }>) => {
  const globalState = params?.globalState;
  const widgetId = params?.widgetId || 'default';
  
  // Widget-specific state
  const [selectedTicker, setSelectedTicker] = useState('BTC');
  const [grouping, setGrouping] = useState(100);
  const [viewMode, setViewMode] = useState<L4OrderTypeFilter>('all');
  const [sideFilter, setSideFilter] = useState<L4SideFilter>('both');
  const [levelsToShow, setLevelsToShow] = useState(15);
  const [minSize, setMinSize] = useState(0);
  const [reduceOnlyOnly, setReduceOnlyOnly] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  
  // Popup state for order details
  const [selectedLevel, setSelectedLevel] = useState<{ level: AggregatedLevel; side: 'ask' | 'bid'; position: { x: number; y: number } } | null>(null);
  
  // Handle click on size to show order details
  const handleSizeClick = useCallback((e: React.MouseEvent, level: AggregatedLevel, side: 'ask' | 'bid') => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setSelectedLevel({
      level,
      side,
      position: { x: rect.left, y: rect.bottom + 5 }
    });
  }, []);
  
  // Load saved settings
  useEffect(() => {
    if (widgetId && !filtersLoaded) {
      try {
        const saved = localStorage.getItem(`l4-orderbook-${widgetId}`);
        if (saved) {
          const s = JSON.parse(saved);
          if (s.selectedTicker) setSelectedTicker(s.selectedTicker);
          if (s.grouping) setGrouping(s.grouping);
          if (s.viewMode) setViewMode(s.viewMode);
          if (s.sideFilter) setSideFilter(s.sideFilter);
          if (s.levelsToShow) setLevelsToShow(s.levelsToShow);
          if (s.minSize !== undefined) setMinSize(s.minSize);
          if (s.reduceOnlyOnly !== undefined) setReduceOnlyOnly(s.reduceOnlyOnly);
        }
      } catch (e) {
        console.error('Failed to load L4 orderbook settings:', e);
      }
      setFiltersLoaded(true);
    }
  }, [widgetId, filtersLoaded]);
  
  // Save settings - debounced
  useEffect(() => {
    if (!filtersLoaded || !widgetId) return;
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(`l4-orderbook-${widgetId}`, JSON.stringify({
          selectedTicker, grouping, viewMode, sideFilter, levelsToShow, minSize, reduceOnlyOnly
        }));
      } catch (e) {}
    }, 300);
    return () => clearTimeout(timeout);
  }, [widgetId, selectedTicker, grouping, viewMode, sideFilter, levelsToShow, minSize, reduceOnlyOnly, filtersLoaded]);
  
  const l4Data = globalState?.l4;
  const marketData = l4Data?.data?.markets?.get(selectedTicker);
  const marketList = l4Data?.data?.marketList ?? [];
  
  // Get live price data for selected ticker
  const livePrice = globalState?.assetPrices?.prices?.[selectedTicker];
  const currentPrice = livePrice?.markPx || livePrice?.midPx || 0;
  const isPriceConnected = globalState?.assetPrices?.isConnected ?? false;
  
  // Filter config
  const filterConfig = useMemo(() => ({
    minSize,
    reduceOnlyOnly,
    hideSmallOrders: false,
  }), [minSize, reduceOnlyOnly]);
  
  // Debug: Log the raw market data structure
  useEffect(() => {
    console.log('[L4 DEBUG] marketData for', selectedTicker + ':', marketData);
    console.log('[L4 DEBUG] marketData keys:', marketData ? Object.keys(marketData) : 'null');
    
    if (marketData) {
      console.log('[L4 DEBUG] book_orders count:', marketData.book_orders?.length ?? 'undefined');
      console.log('[L4 DEBUG] untriggered_orders count:', marketData.untriggered_orders?.length ?? 'undefined');
      
      // Log the actual structure of untriggered_orders
      const triggerOrders = marketData.untriggered_orders;
      if (triggerOrders && triggerOrders.length > 0) {
        console.log('[L4 DEBUG] First trigger order RAW:', JSON.stringify(triggerOrders[0], null, 2));
        
        // Log first 5 orders
        console.log('[L4 DEBUG] First 5 trigger orders:');
        triggerOrders.slice(0, 5).forEach(([addr, order]: [string, any], i: number) => {
          console.log(`  [${i}] addr=${addr?.substring(0,10)}..., side=${order?.side}, triggerCondition="${order?.triggerCondition}", orderType="${order?.orderType}"`);
        });
        
        // Count by side and triggerCondition pattern
        const patterns: Record<string, number> = {};
        triggerOrders.forEach(([, o]: [string, any]) => {
          const cond = String(o?.triggerCondition || '').toLowerCase();
          const hasAbove = cond.includes('above');
          const hasBelow = cond.includes('below');
          const key = `${o?.side}|above:${hasAbove}|below:${hasBelow}`;
          patterns[key] = (patterns[key] || 0) + 1;
        });
        console.log('[L4 DEBUG] Side + Above/Below patterns:', patterns);
      } else {
        console.log('[L4 DEBUG] No trigger orders found or undefined');
      }
    }
  }, [marketData, selectedTicker]);
  
  // Helper function to determine if an order is a Stop Loss or Take Profit
  // The orderType field from Hydromancer directly tells us:
  // - "Stop Market" = Stop Loss
  // - "Take Profit Market" = Take Profit
  const classifyTriggerOrder = useCallback((order: L4Order): 'sl' | 'tp' | 'unknown' => {
    const orderType = (order.orderType || '').toLowerCase();
    
    // Primary classification: use orderType field directly
    // This is the most reliable indicator from Hydromancer API
    if (orderType.includes('take profit')) {
      return 'tp';
    }
    if (orderType.includes('stop')) {
      return 'sl';
    }
    
    // Fallback: if orderType doesn't clearly indicate, check trigger condition
    // This handles edge cases where orderType might be generic
    if (order.isTrigger && order.triggerCondition) {
      const cond = order.triggerCondition.toLowerCase();
      
      // Explicit markers in condition
      if (cond.includes('tp:') || cond.includes('take profit')) {
        return 'tp';
      }
      if (cond.includes('sl:') || cond.includes('stop loss')) {
        return 'sl';
      }
    }
    
    return 'unknown';
  }, []);
  
  // Analyze trigger orders
  const triggerStats = useMemo(() => {
    const triggerOrders = marketData?.untriggered_orders ?? [];
    let stopLosses = 0;
    let takeProfits = 0;
    let other = 0;
    const orderTypes: Record<string, number> = {};
    const classifications: Record<string, number> = { sl: 0, tp: 0, unknown: 0 };
    
    for (const [, order] of triggerOrders) {
      // Count by orderType
      const ot = order.orderType || 'unknown';
      orderTypes[ot] = (orderTypes[ot] || 0) + 1;
      
      // Classify as SL or TP
      const classification = classifyTriggerOrder(order);
      classifications[classification]++;
      if (classification === 'sl') stopLosses++;
      else if (classification === 'tp') takeProfits++;
      else other++;
    }
    
    console.log('[L4] Total trigger orders:', triggerOrders.length);
    console.log('[L4] Order types found:', orderTypes);
    console.log('[L4] Classifications:', classifications);
    return { stopLosses, takeProfits, other, total: triggerOrders.length, orderTypes };
  }, [marketData, classifyTriggerOrder]);
  
  // Get orders based on view mode with memoization
  const { filteredBookOrders, filteredTriggerOrders } = useMemo(() => {
    const bookOrders = marketData?.book_orders ?? [];
    const triggerOrders = marketData?.untriggered_orders ?? [];
    
    // Filter trigger orders by type
    let filteredTriggers = triggerOrders;
    
    if (viewMode === 'sl') {
      // Stop Loss only
      filteredTriggers = triggerOrders.filter(([, o]) => classifyTriggerOrder(o) === 'sl');
    } else if (viewMode === 'tp') {
      // Take Profit only
      filteredTriggers = triggerOrders.filter(([, o]) => classifyTriggerOrder(o) === 'tp');
    } else if (viewMode === 'triggers') {
      // All triggers
      filteredTriggers = triggerOrders;
    }
    
    // Determine which order types to include based on viewMode
    const includeBookOrders = viewMode === 'all' || viewMode === 'book';
    const includeTriggerOrders = viewMode !== 'book';
    
    return {
      filteredBookOrders: includeBookOrders ? bookOrders : [],
      filteredTriggerOrders: includeTriggerOrders ? filteredTriggers : [],
    };
  }, [marketData, viewMode, classifyTriggerOrder]);
  
  // Combine orders for aggregation
  const combinedOrders = useMemo(() => {
    return [...filteredBookOrders, ...filteredTriggerOrders];
  }, [filteredBookOrders, filteredTriggerOrders]);
  
  // Aggregate levels - only when needed, filtered by current price
  const asks = useMemo(() => {
    if (sideFilter === 'bids') return [];
    return aggregateOrders(combinedOrders, grouping, 'A', levelsToShow, filterConfig, currentPrice);
  }, [combinedOrders, grouping, levelsToShow, filterConfig, sideFilter, currentPrice]);
  
  const bids = useMemo(() => {
    if (sideFilter === 'asks') return [];
    return aggregateOrders(combinedOrders, grouping, 'B', levelsToShow, filterConfig, currentPrice);
  }, [combinedOrders, grouping, levelsToShow, filterConfig, sideFilter, currentPrice]);
  
  // Calculate max size for depth bars
  const maxSize = useMemo(() => {
    const allSizes = [...asks, ...bids].map(l => l.size);
    return Math.max(...allSizes, 1);
  }, [asks, bids]);
  
  // Get smart grouping options based on live price or orderbook mid price
  const midPrice = useMemo(() => {
    if (currentPrice > 0) return currentPrice;
    const lowestAsk = asks[asks.length - 1]?.price;
    const highestBid = bids[0]?.price;
    if (lowestAsk && highestBid) return (lowestAsk + highestBid) / 2;
    return lowestAsk || highestBid || 0;
  }, [asks, bids, currentPrice]);
  
  const groupingOptions = useMemo(() => getGroupingOptions(midPrice), [midPrice]);
  
  // Auto-update grouping when price changes significantly
  useEffect(() => {
    if (midPrice > 0 && filtersLoaded) {
      const newOptions = getGroupingOptions(midPrice);
      if (!newOptions.includes(grouping)) {
        setGrouping(newOptions[2] || newOptions[0]);
      }
    }
  }, [midPrice, filtersLoaded, grouping]);
  
  // Spread calculation
  const spread = useMemo(() => {
    const lowestAsk = asks[asks.length - 1]?.price;
    const highestBid = bids[0]?.price;
    if (lowestAsk && highestBid && midPrice > 0) {
      const spreadValue = lowestAsk - highestBid;
      const spreadPercent = ((spreadValue / midPrice) * 100).toFixed(3);
      return { value: spreadValue, percent: spreadPercent, lowestAsk, highestBid };
    }
    return null;
  }, [asks, bids, midPrice]);
  
  // Stats
  const stats = useMemo(() => {
    const totalAskSize = asks.reduce((sum, l) => sum + l.size, 0);
    const totalBidSize = bids.reduce((sum, l) => sum + l.size, 0);
    const askOrders = asks.reduce((sum, l) => sum + l.orderCount, 0);
    const bidOrders = bids.reduce((sum, l) => sum + l.orderCount, 0);
    const imbalance = totalBidSize + totalAskSize > 0 
      ? ((totalBidSize - totalAskSize) / (totalBidSize + totalAskSize) * 100).toFixed(1)
      : '0';
    return { totalAskSize, totalBidSize, askOrders, bidOrders, imbalance };
  }, [asks, bids]);
  
  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (viewMode !== 'all') count++;
    if (sideFilter !== 'both') count++;
    if (minSize > 0) count++;
    if (reduceOnlyOnly) count++;
    return count;
  }, [viewMode, sideFilter, minSize, reduceOnlyOnly]);
  
  if (!l4Data) return <div className="p-4 text-muted-foreground">Loading...</div>;
  
  if (l4Data.loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading L4 data...</span>
        </div>
      </div>
    );
  }
  
  if (l4Data.error) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-red-500 text-sm mb-2">Error loading L4 data</div>
          <div className="text-xs text-muted-foreground">{l4Data.error}</div>
          <Button 
            variant="outline" 
            size="sm" 
            className="mt-3"
            onClick={() => globalState?.refreshL4?.()}
          >
            <RefreshCw className="h-3 w-3 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="h-full flex flex-col font-mono bg-card/30 overflow-hidden">
      {/* Header with ticker selector */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0 bg-card/50">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-blue-500" />
          
          {/* Ticker selector with presets dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 font-mono text-xs font-bold gap-1">
                {selectedTicker}
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56 max-h-80 overflow-y-auto">
              <DropdownMenuLabel>Quick Select</DropdownMenuLabel>
              {Object.entries(TICKER_PRESETS).map(([category, tickers]) => (
                <DropdownMenuSub key={category}>
                  <DropdownMenuSubTrigger className="text-xs">{category}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {tickers.map(ticker => (
                      <DropdownMenuItem 
                        key={ticker} 
                        onClick={() => setSelectedTicker(ticker)}
                        className="text-xs font-mono"
                      >
                        {ticker}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>All Markets</DropdownMenuLabel>
              {marketList.slice(0, 30).map(market => (
                <DropdownMenuItem 
                  key={market} 
                  onClick={() => setSelectedTicker(market)}
                  className="text-xs font-mono"
                >
                  {market}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          
          {isPriceConnected && (
            <Badge variant="outline" className="text-[9px] bg-green-500/10 text-green-500 border-green-500/30">
              LIVE
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="font-mono text-[9px] tabular-nums">
            {l4Data.data?.cached ? `${l4Data.data.cacheAge}s` : 'Fresh'}
          </Badge>
          <Button 
            variant={showAdvanced ? "default" : "ghost"} 
            size="sm" 
            className="h-6 w-6 p-0"
            onClick={() => setShowAdvanced(!showAdvanced)}
            title="Advanced filters"
          >
            <Sliders className="h-3 w-3" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 h-3.5 w-3.5 text-[8px] bg-primary text-primary-foreground rounded-full flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-6 w-6 p-0"
            onClick={() => globalState?.refreshL4?.()}
            title="Refresh L4 data"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>
      
      {/* Primary Controls */}
      <div className="px-3 py-1.5 border-b border-border bg-muted/30 flex items-center gap-2 shrink-0 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">Group:</span>
          {groupingOptions.slice(0, 5).map(g => (
            <Button
              key={g}
              variant={grouping === g ? "default" : "ghost"}
              size="sm"
              className="h-5 px-1.5 text-[10px] font-mono"
              onClick={() => setGrouping(g)}
            >
              ${g >= 1 ? g.toLocaleString() : g}
            </Button>
          ))}
        </div>
        <div className="h-3 w-px bg-border" />
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">Type:</span>
          <Select value={viewMode} onValueChange={(v: L4OrderTypeFilter) => setViewMode(v)}>
            <SelectTrigger className="h-5 text-[10px] w-20 bg-background/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-[10px]">All</SelectItem>
              <SelectItem value="book" className="text-[10px]">Book</SelectItem>
              <SelectItem value="triggers" className="text-[10px]">Triggers</SelectItem>
              <SelectItem value="sl" className="text-[10px]">
                <span className="flex items-center gap-1">
                  <Shield className="h-3 w-3 text-orange-500" />
                  Stop Loss
                </span>
              </SelectItem>
              <SelectItem value="tp" className="text-[10px]">
                <span className="flex items-center gap-1">
                  <Target className="h-3 w-3 text-green-500" />
                  Take Profit
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      
      {/* Advanced Filters Panel - Collapsible */}
      {showAdvanced && (
        <div className="px-3 py-2 border-b border-border bg-muted/50 flex items-center gap-3 shrink-0 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Side:</span>
            <Select value={sideFilter} onValueChange={(v: L4SideFilter) => setSideFilter(v)}>
              <SelectTrigger className="h-6 text-[10px] w-20 bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both" className="text-[10px]">Both</SelectItem>
                <SelectItem value="asks" className="text-[10px] text-red-500">Asks Only</SelectItem>
                <SelectItem value="bids" className="text-[10px] text-green-500">Bids Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Min Size:</span>
            <Input
              type="number"
              value={minSize || ''}
              onChange={(e) => setMinSize(parseFloat(e.target.value) || 0)}
              className="h-6 w-16 text-[10px] font-mono bg-background/50"
              placeholder="0"
            />
          </div>
          
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Levels:</span>
            <Select value={levelsToShow.toString()} onValueChange={(v) => setLevelsToShow(parseInt(v))}>
              <SelectTrigger className="h-6 text-[10px] w-14 bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10" className="text-[10px]">10</SelectItem>
                <SelectItem value="15" className="text-[10px]">15</SelectItem>
                <SelectItem value="20" className="text-[10px]">20</SelectItem>
                <SelectItem value="30" className="text-[10px]">30</SelectItem>
                <SelectItem value="50" className="text-[10px]">50</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <Button
            variant={reduceOnlyOnly ? "default" : "secondary"}
            size="sm"
            className="h-6 px-2 text-[10px] gap-1"
            onClick={() => setReduceOnlyOnly(!reduceOnlyOnly)}
          >
            <AlertTriangle className="h-3 w-3" />
            ReduceOnly
          </Button>
          
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-muted-foreground"
              onClick={() => {
                setViewMode('all');
                setSideFilter('both');
                setMinSize(0);
                setReduceOnlyOnly(false);
              }}
            >
              Clear Filters
            </Button>
          )}
        </div>
      )}
      
      {/* Stats bar */}
      <div className="px-3 py-1 border-b border-border bg-muted/20 flex items-center justify-between text-[10px] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-red-500">
            Asks: {stats.askOrders} ({stats.totalAskSize.toFixed(2)})
          </span>
          <span className="text-green-500">
            Bids: {stats.bidOrders} ({stats.totalBidSize.toFixed(2)})
          </span>
          {/* Show trigger stats when viewing triggers */}
          {viewMode !== 'book' && triggerStats.total > 0 && (
            <span className="text-muted-foreground border-l border-border pl-3 ml-1">
              <span className="text-orange-400" title="Stop Market/Limit orders">SL:{triggerStats.stopLosses}</span>
              {' '}
              <span className="text-cyan-400" title="Take Profit Market/Limit orders">TP:{triggerStats.takeProfits}</span>
              {triggerStats.other > 0 && (
                <span className="text-muted-foreground" title="Other trigger orders"> Other:{triggerStats.other}</span>
              )}
            </span>
          )}
        </div>
        <span className={cn(
          "font-medium",
          parseFloat(stats.imbalance) > 0 ? "text-green-500" : parseFloat(stats.imbalance) < 0 ? "text-red-500" : "text-muted-foreground"
        )}>
          Imbalance: {stats.imbalance}%
        </span>
      </div>
      
      {/* Orderbook - optimized with fixed row heights */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {/* Asks section - scrollable with content aligned to bottom */}
        {sideFilter !== 'bids' && (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col">
            {/* Spacer to push content to bottom when not scrolled */}
            <div className="flex-1" />
            <table className="w-full text-[10px]">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                <tr className="border-b border-border">
                  <th className="py-1 px-2 text-left font-medium text-muted-foreground text-[9px]">Price</th>
                  <th className="py-1 px-2 text-right font-medium text-muted-foreground text-[9px]">Size</th>
                  <th className="py-1 px-2 text-right font-medium text-muted-foreground text-[9px]">#</th>
                  <th className="py-1 px-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {asks.map((level) => (
                  <tr key={`ask-${level.price}`} className="border-b border-border/20 relative h-5">
                    <td className="py-0.5 px-2 font-mono text-red-400 relative z-10">${level.price.toLocaleString()}</td>
                    <td 
                      className="py-0.5 px-2 text-right font-mono relative z-10 cursor-pointer hover:bg-red-500/20 hover:text-white rounded transition-colors"
                      onClick={(e) => handleSizeClick(e, level, 'ask')}
                      title={`Click to view ${level.orderCount} orders`}
                    >
                      {level.size.toFixed(4)}
                    </td>
                    <td className="py-0.5 px-2 text-right font-mono text-muted-foreground relative z-10">{level.orderCount}</td>
                    <td className="py-0.5 px-2 relative">
                      <div className="absolute right-0 top-0 bottom-0 bg-red-500/20" style={{ width: `${(level.size / maxSize) * 100}%` }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        
        {/* Current price & spread row */}
        <div className="shrink-0 bg-card border-y-2 border-yellow-500/50 py-2 px-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {currentPrice > 0 ? (
                <div className="flex items-center gap-2">
                  <span className={cn("inline-flex h-2 w-2 rounded-full", isPriceConnected ? "bg-green-500 animate-pulse" : "bg-yellow-500")} />
                  <span className="font-bold text-lg text-white">
                    ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              ) : (
                <span className="text-muted-foreground text-sm">No live price</span>
              )}
            </div>
            <div className="flex items-center gap-3 text-[10px]">
              {livePrice && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>M: ${livePrice.markPx?.toLocaleString()}</span>
                  <span>O: ${livePrice.oraclePx?.toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
          {spread && (
            <div className="flex items-center justify-center gap-4 mt-1 text-[10px] text-muted-foreground">
              <span className="text-red-400">Ask: ${spread.lowestAsk?.toLocaleString()}</span>
              <span className="text-yellow-500 font-medium">Spread: ${spread.value.toFixed(2)} ({spread.percent}%)</span>
              <span className="text-green-400">Bid: ${spread.highestBid?.toLocaleString()}</span>
            </div>
          )}
        </div>
        
        {/* Bids section - scrollable */}
        {sideFilter !== 'asks' && (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            <table className="w-full text-[10px]">
              <tbody>
                {bids.map((level) => (
                  <tr key={`bid-${level.price}`} className="border-b border-border/20 relative h-5">
                    <td className="py-0.5 px-2 font-mono text-green-400 relative z-10">${level.price.toLocaleString()}</td>
                    <td 
                      className="py-0.5 px-2 text-right font-mono relative z-10 cursor-pointer hover:bg-green-500/20 hover:text-white rounded transition-colors"
                      onClick={(e) => handleSizeClick(e, level, 'bid')}
                      title={`Click to view ${level.orderCount} orders`}
                    >
                      {level.size.toFixed(4)}
                    </td>
                    <td className="py-0.5 px-2 text-right font-mono text-muted-foreground relative z-10">{level.orderCount}</td>
                    <td className="py-0.5 px-2 relative w-20">
                      <div className="absolute right-0 top-0 bottom-0 bg-green-500/20" style={{ width: `${(level.size / maxSize) * 100}%` }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        
        {/* Empty state */}
        {asks.length === 0 && bids.length === 0 && (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            No orders found for {selectedTicker}
          </div>
        )}
      </div>
      
      {/* Footer with filter info */}
      {(viewMode === 'sl' || viewMode === 'tp' || reduceOnlyOnly) && (
        <div className="px-3 py-1.5 border-t border-border bg-orange-500/5 text-[10px] text-orange-400 shrink-0">
          {viewMode === 'sl' && `🛡️ Stop Loss filter: Found ${triggerStats.stopLosses} SL orders out of ${triggerStats.total} triggers`}
          {viewMode === 'tp' && `🎯 Take Profit filter: Found ${triggerStats.takeProfits} TP orders out of ${triggerStats.total} triggers`}
          {reduceOnlyOnly && viewMode !== 'sl' && viewMode !== 'tp' && '⚠️ ReduceOnly filter: showing orders that close positions'}
        </div>
      )}
      
      {/* Debug info - shows classification results and sample data */}
      {viewMode !== 'book' && (
        <div className="px-3 py-1 border-t border-border bg-blue-500/5 text-[9px] text-blue-400 shrink-0 overflow-x-auto">
          <div>
            Triggers: {triggerStats.total} → SL:{triggerStats.stopLosses} TP:{triggerStats.takeProfits} Unknown:{triggerStats.other}
          </div>
          {marketData?.untriggered_orders?.[0] && (
            <div className="mt-1 text-[8px] text-muted-foreground">
              Sample: side="{marketData.untriggered_orders[0][1]?.side}" 
              triggerCond="{String(marketData.untriggered_orders[0][1]?.triggerCondition).substring(0, 30)}" 
              orderType="{marketData.untriggered_orders[0][1]?.orderType}"
            </div>
          )}
        </div>
      )}
      
      {/* Order details popup */}
      {selectedLevel && (
        <OrderDetailsPopup
          level={selectedLevel.level}
          side={selectedLevel.side}
          position={selectedLevel.position}
          onClose={() => setSelectedLevel(null)}
        />
      )}
    </div>
  );
});

// Panel components registry
const components = {
  streamStatus: StreamStatusPanel,
  latestFill: LatestFillPanel,
  stats: StatsPanel,
  filters: FiltersPanel,
  fillsTable: FillsTablePanel,
  liquidationWidget: LiquidationWidget,
  liqStats: LiquidationStatsWidget,
  l4Orderbook: L4OrderbookWidget,
};

// Storage key for layout persistence
const LAYOUT_STORAGE_KEY = 'all-fills-dockview-layout-v2';

let widgetCounter = 0;

export default function AllFillsPage() {
  const [api, setApi] = useState<DockviewApi | null>(null);
  
  // Fills state
  const [fillsConnected, setFillsConnected] = useState(false);
  const [fillsRows, setFillsRows] = useState<ProcessedFill[]>([]);
  const [fillsLastMessageAgo, setFillsLastMessageAgo] = useState<number>(0);
  const [fillsTotalFills, setFillsTotalFills] = useState<number>(0);
  const [fillsNewIds, setFillsNewIds] = useState<Set<string>>(new Set());
  const [fillsUpdateCount, setFillsUpdateCount] = useState(0);
  const fillsPreviousIdsRef = useRef<Set<string>>(new Set());
  
  // Fills filters
  const [coinFilter, setCoinFilter] = useState('');
  const [minSizeFilter, setMinSizeFilter] = useState('');
  const [sideFilter, setSideFilter] = useState<'ALL' | 'B' | 'A'>('ALL');
  
  // Liquidations state
  const [liqConnected, setLiqConnected] = useState(false);
  const [liqRows, setLiqRows] = useState<ProcessedLiquidation[]>([]);
  const [liqLastMessageAgo, setLiqLastMessageAgo] = useState<number>(0);
  const [liqTotalLiquidations, setLiqTotalLiquidations] = useState<number>(0);
  const [liqNewIds, setLiqNewIds] = useState<Set<string>>(new Set());
  const liqPreviousIdsRef = useRef<Set<string>>(new Set());
  
  // L4 orderbook state
  const [l4Data, setL4Data] = useState<L4SnapshotData | null>(null);
  const [l4Loading, setL4Loading] = useState(false);
  const [l4Error, setL4Error] = useState<string | null>(null);
  const [l4LastFetch, setL4LastFetch] = useState(0);
  
  // Asset prices state (from activeAssetCtx WebSocket)
  const [assetPricesConnected, setAssetPricesConnected] = useState(false);
  const [assetPrices, setAssetPrices] = useState<Record<string, AssetPrice>>({});
  const [assetPricesLastMessageAgo, setAssetPricesLastMessageAgo] = useState(0);

  // Fetch fills
  const fetchFills = useCallback(async () => {
    try {
      const response = await fetch('/api/all-fills');
      if (!response.ok) return;
      
      const data: FillAPIResponse = await response.json();
      
      setFillsConnected(data.isConnected);
      setFillsLastMessageAgo(data.lastMessageAgo || 0);
      setFillsTotalFills(data.totalFills || 0);
      
      const currentIds = new Set(data.fills.map(f => f.id));
      const newItemIds = new Set<string>();
      
      data.fills.forEach(f => {
        if (!fillsPreviousIdsRef.current.has(f.id)) {
          newItemIds.add(f.id);
        }
      });
      
      if (newItemIds.size > 0) {
        setFillsNewIds(newItemIds);
        setFillsUpdateCount(prev => prev + newItemIds.size);
        setTimeout(() => setFillsNewIds(new Set()), 1000);
      }
      
      fillsPreviousIdsRef.current = currentIds;
      setFillsRows(data.fills);
    } catch (error) {
      console.error('Error fetching fills:', error);
      setFillsConnected(false);
    }
  }, []);

  // Fetch liquidations
  const fetchLiquidations = useCallback(async () => {
    try {
      const response = await fetch('/api/liquidations');
      if (!response.ok) return;
      
      const data: LiquidationAPIResponse = await response.json();
      
      setLiqConnected(data.isConnected);
      setLiqLastMessageAgo(data.lastMessageAgo || 0);
      setLiqTotalLiquidations(data.totalLiquidations || 0);
      
      const currentIds = new Set(data.liquidations.map(l => l.id));
      const newItemIds = new Set<string>();
      
      data.liquidations.forEach(l => {
        if (!liqPreviousIdsRef.current.has(l.id)) {
          newItemIds.add(l.id);
        }
      });
      
      if (newItemIds.size > 0) {
        setLiqNewIds(newItemIds);
        setTimeout(() => setLiqNewIds(new Set()), 1000);
      }
      
      liqPreviousIdsRef.current = currentIds;
      setLiqRows(data.liquidations);
    } catch (error) {
      console.error('Error fetching liquidations:', error);
      setLiqConnected(false);
    }
  }, []);
  
  // Fetch L4 orderbook data
  const fetchL4Data = useCallback(async () => {
    // Don't refetch if we have recent data (data is cached server-side for 5 min)
    const now = Date.now();
    if (l4Data && now - l4LastFetch < 30000) {
      return; // Skip if last fetch was less than 30 seconds ago
    }
    
    setL4Loading(true);
    setL4Error(null);
    
    try {
      const response = await fetch('/api/l4-snapshots');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }
      
      const [height, marketsArray] = result.data;
      
      // Convert markets array to Map for easy lookup
      const markets = new Map<string, L4MarketData>();
      const marketList: string[] = [];
      
      for (const [marketName, marketData] of marketsArray) {
        markets.set(marketName, marketData as L4MarketData);
        marketList.push(marketName);
      }
      
      // Sort market list alphabetically, but put major coins first
      const majorCoins = ['BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT'];
      marketList.sort((a, b) => {
        const aIdx = majorCoins.indexOf(a);
        const bIdx = majorCoins.indexOf(b);
        if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
        if (aIdx >= 0) return -1;
        if (bIdx >= 0) return 1;
        return a.localeCompare(b);
      });
      
      setL4Data({
        height,
        markets,
        marketList,
        timestamp: Date.now(),
        cached: result.cached,
        cacheAge: result.cacheAge,
      });
      setL4LastFetch(now);
    } catch (error) {
      console.error('Error fetching L4 data:', error);
      setL4Error(error instanceof Error ? error.message : 'Failed to fetch L4 data');
    } finally {
      setL4Loading(false);
    }
  }, [l4Data, l4LastFetch]);

  // Fetch asset prices
  const fetchAssetPrices = useCallback(async () => {
    try {
      const response = await fetch('/api/asset-prices');
      if (!response.ok) return;
      
      const data = await response.json();
      setAssetPricesConnected(data.isConnected);
      setAssetPrices(data.prices || {});
      setAssetPricesLastMessageAgo(data.lastMessageAgo || 0);
    } catch (error) {
      console.error('Error fetching asset prices:', error);
      setAssetPricesConnected(false);
    }
  }, []);

  // Polling - optimized intervals for better performance
  useEffect(() => {
    fetchFills();
    fetchLiquidations();
    fetchL4Data();
    fetchAssetPrices();
    
    const fillsInterval = setInterval(fetchFills, FILLS_POLL_INTERVAL);
    const liqInterval = setInterval(fetchLiquidations, LIQUIDATIONS_POLL_INTERVAL);
    const l4Interval = setInterval(fetchL4Data, L4_POLL_INTERVAL);
    const pricesInterval = setInterval(fetchAssetPrices, ASSET_PRICES_POLL_INTERVAL);
    
    return () => {
      clearInterval(fillsInterval);
      clearInterval(liqInterval);
      clearInterval(l4Interval);
      clearInterval(pricesInterval);
    };
  }, [fetchFills, fetchLiquidations, fetchL4Data, fetchAssetPrices]);

  // Filtered fills
  const filteredFillsRows = useMemo(() => {
    if (!coinFilter && !minSizeFilter && sideFilter === 'ALL') return fillsRows;
    
    const lowerCoin = coinFilter.toLowerCase();
    const minVal = minSizeFilter ? parseFloat(minSizeFilter) : 0;

    return fillsRows.filter(r => {
      if (coinFilter && !r.coin.toLowerCase().includes(lowerCoin) && !r.address.toLowerCase().includes(lowerCoin)) return false;
      if (minVal > 0 && r.value < minVal) return false;
      if (sideFilter !== 'ALL' && r.side !== sideFilter) return false;
      return true;
    });
  }, [fillsRows, coinFilter, minSizeFilter, sideFilter]);

  // Fills stats
  const fillsStats = useMemo(() => {
    const totalValue = fillsRows.reduce((sum, r) => sum + r.value, 0);
    const buyCount = fillsRows.filter(r => r.side === 'B').length;
    const sellCount = fillsRows.filter(r => r.side === 'A').length;
    const avgSize = fillsRows.length > 0 ? totalValue / fillsRows.length : 0;
    
    const coinCounts: Record<string, number> = {};
    fillsRows.forEach(r => {
      coinCounts[r.coin] = (coinCounts[r.coin] || 0) + 1;
    });
    const topCoins = Object.entries(coinCounts)
      .map(([coin, count]) => ({ coin, count }))
      .sort((a, b) => b.count - a.count);
    
    return { totalValue, buyCount, sellCount, avgSize, topCoins };
  }, [fillsRows]);

  const clearFilters = useCallback(() => {
    setCoinFilter('');
    setMinSizeFilter('');
    setSideFilter('ALL');
  }, []);
  
  // Force refresh L4 data
  const refreshL4 = useCallback(() => {
    setL4LastFetch(0); // Reset last fetch to force refresh
    fetchL4Data();
  }, [fetchL4Data]);

  // Add widget function
  const addWidget = useCallback((type: string) => {
    const currentApi = api;
    if (!currentApi) {
      console.warn('API not ready yet');
      return;
    }
    
    const id = `widget_${type}_${++widgetCounter}_${Date.now()}`;
    
    try {
      switch (type) {
        case 'liquidation':
          currentApi.addPanel({
            id,
            component: 'liquidationWidget',
            title: 'Liquidations',
            params: { globalState: globalStateRef.current, widgetId: id },
          });
          break;
        case 'fills':
          currentApi.addPanel({
            id,
            component: 'fillsTable',
            title: 'All Fills',
            params: { globalState: globalStateRef.current },
          });
          break;
        case 'stats':
          currentApi.addPanel({
            id,
            component: 'stats',
            title: 'Statistics',
            params: { globalState: globalStateRef.current },
          });
          break;
        case 'liqStats':
          currentApi.addPanel({
            id,
            component: 'liqStats',
            title: 'Liq Stats',
            params: { globalState: globalStateRef.current },
          });
          break;
        case 'l4Orderbook':
          currentApi.addPanel({
            id,
            component: 'l4Orderbook',
            title: 'L4 Orderbook',
            params: { globalState: globalStateRef.current, widgetId: id },
          });
          break;
      }
    } catch (err) {
      console.error('Failed to add widget:', err);
    }
  }, [api]);

  // Global state object
  const fillsState: FillsState = useMemo(() => ({
    isConnected: fillsConnected,
    rows: fillsRows,
    filteredRows: filteredFillsRows,
    lastMessageAgo: fillsLastMessageAgo,
    totalFills: fillsTotalFills,
    updateCount: fillsUpdateCount,
    newIds: fillsNewIds,
    coinFilter,
    minSizeFilter,
    sideFilter,
    setCoinFilter,
    setMinSizeFilter,
    setSideFilter,
    clearFilters,
    stats: fillsStats,
  }), [fillsConnected, fillsRows, filteredFillsRows, fillsLastMessageAgo, fillsTotalFills, 
      fillsUpdateCount, fillsNewIds, coinFilter, minSizeFilter, sideFilter, clearFilters, fillsStats]);

  const liquidationsState: LiquidationsState = useMemo(() => ({
    isConnected: liqConnected,
    rows: liqRows,
    lastMessageAgo: liqLastMessageAgo,
    totalLiquidations: liqTotalLiquidations,
    newIds: liqNewIds,
  }), [liqConnected, liqRows, liqLastMessageAgo, liqTotalLiquidations, liqNewIds]);
  
  const l4State: L4State = useMemo(() => ({
    data: l4Data,
    loading: l4Loading,
    error: l4Error,
    lastFetch: l4LastFetch,
  }), [l4Data, l4Loading, l4Error, l4LastFetch]);
  
  const assetPricesState: AssetPricesState = useMemo(() => ({
    isConnected: assetPricesConnected,
    prices: assetPrices,
    lastMessageAgo: assetPricesLastMessageAgo,
  }), [assetPricesConnected, assetPrices, assetPricesLastMessageAgo]);

  const globalState: GlobalState = useMemo(() => ({
    fills: fillsState,
    liquidations: liquidationsState,
    l4: l4State,
    assetPrices: assetPricesState,
    api,
    addWidget,
    refreshL4,
  }), [fillsState, liquidationsState, l4State, assetPricesState, api, addWidget, refreshL4]);

  // Keep a ref to global state for addWidget
  const globalStateRef = useRef(globalState);
  globalStateRef.current = globalState;

  // Update panel params when state changes - throttled to reduce re-renders
  const lastUpdateRef = useRef(0);
  useEffect(() => {
    if (!api) return;
    
    // Throttle updates to max once per 100ms
    const now = Date.now();
    if (now - lastUpdateRef.current < 100) return;
    lastUpdateRef.current = now;
    
    // Use requestAnimationFrame to batch updates
    requestAnimationFrame(() => {
      api.panels.forEach(panel => {
        panel.api.updateParameters({ globalState });
      });
    });
  }, [api, globalState]);

  // Save layout on changes - debounced to avoid excessive writes
  // Note: We use a custom serializer because params contain non-serializable references (api, functions, globalState)
  useEffect(() => {
    if (!api) return;
    
    let saveTimeout: NodeJS.Timeout | null = null;
    
    const saveLayout = () => {
      try {
        const layout = api.toJSON();
        
        // Use a custom replacer to handle circular references and strip out non-serializable params
        const seen = new WeakSet();
        const serialized = JSON.stringify(layout, (key, value) => {
          // Skip params entirely - we'll restore them from globalState when loading
          if (key === 'params') {
            // Only keep widgetId if it exists
            if (value && typeof value === 'object' && value.widgetId) {
              return { widgetId: value.widgetId };
            }
            return {};
          }
          
          // Handle circular references
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
              return undefined; // Skip circular reference
            }
            seen.add(value);
          }
          
          return value;
        });
        
        localStorage.setItem(LAYOUT_STORAGE_KEY, serialized);
      } catch (err) {
        console.error('Failed to save layout:', err);
      }
    };
    
    const disposable = api.onDidLayoutChange(() => {
      // Debounce saves to avoid excessive localStorage writes
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(saveLayout, 100);
    });
    
    // Also save on unmount to capture final state
    return () => {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveLayout();
      disposable.dispose();
    };
  }, [api]);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    setApi(event.api);
    
    // Try to load saved layout
    const savedLayout = localStorage.getItem(LAYOUT_STORAGE_KEY);
    let layoutLoaded = false;
    
    if (savedLayout) {
      try {
        const layout: SerializedDockview = JSON.parse(savedLayout);
        event.api.fromJSON(layout);
        layoutLoaded = true;
        
        // CRITICAL: Immediately update all panel params with fresh globalState
        // This is necessary because serialized params lose their function references
        setTimeout(() => {
          event.api.panels.forEach(panel => {
            const panelId = panel.id;
            panel.api.updateParameters({ 
              globalState: globalStateRef.current,
              widgetId: panelId
            });
          });
        }, 0);
      } catch (err) {
        console.error('Failed to load saved layout:', err);
        // Don't remove layout on error - just use default
        layoutLoaded = false;
      }
    }
    
    // Create default layout if no saved layout
    if (!layoutLoaded) {
      // Liquidation widget as main panel
      const liqPanel = event.api.addPanel({
        id: 'liq_main',
        component: 'liquidationWidget',
        title: 'Liquidations',
        params: { globalState: globalStateRef.current, widgetId: 'liq_main' },
      });

      // Liq stats to the right
      event.api.addPanel({
        id: 'liqStats_main',
        component: 'liqStats',
        title: 'Liq Stats',
        params: { globalState: globalStateRef.current },
        position: { referencePanel: liqPanel, direction: 'right' },
      });
    }
  }, []);

  return (
    <div className="h-screen w-full bg-background flex flex-col">
      {/* Fixed Toolbar - Cannot be removed */}
      <div className="h-10 shrink-0 border-b border-border bg-card/80 backdrop-blur-sm flex items-center px-4 gap-4 font-mono z-50">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 h-7">
              <Plus className="h-3.5 w-3.5" />
              Add Widget
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>Available Widgets</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => addWidget('liquidation')}>
              <Droplets className="h-4 w-4 mr-2 text-red-500" />
              Liquidation Feed
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => addWidget('fills')}>
              <Activity className="h-4 w-4 mr-2 text-blue-500" />
              All Fills Feed
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => addWidget('stats')}>
              <BarChart3 className="h-4 w-4 mr-2 text-green-500" />
              Statistics
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => addWidget('liqStats')}>
              <TrendingDown className="h-4 w-4 mr-2 text-orange-500" />
              Liquidation Stats
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => addWidget('l4Orderbook')}>
              <BookOpen className="h-4 w-4 mr-2 text-purple-500" />
              L4 Orderbook
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        
        <div className="h-4 w-px bg-border" />
        
        <Button 
          variant="ghost" 
          size="sm" 
          className="gap-2 h-7 text-xs"
          onClick={() => {
            localStorage.removeItem(LAYOUT_STORAGE_KEY);
            window.location.reload();
          }}
        >
          Reset Layout
        </Button>
        
        <div className="flex-1" />
        
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Activity className="h-3 w-3" />
            <span>Fills:</span>
            {fillsConnected ? 
              <span className="text-green-500 font-medium">LIVE</span> : 
              <span className="text-red-500 font-medium">OFF</span>
            }
          </div>
          <div className="flex items-center gap-1.5">
            <Droplets className="h-3 w-3" />
            <span>Liqs:</span>
            {liqConnected ? 
              <span className="text-green-500 font-medium">LIVE</span> : 
              <span className="text-red-500 font-medium">OFF</span>
            }
          </div>
        </div>
      </div>
      
      {/* Dockview Container */}
      <div className="flex-1 min-h-0">
        <DockviewReact
          components={components}
          onReady={onReady}
          className="dockview-theme-abyss"
        />
      </div>
    </div>
  );
}
