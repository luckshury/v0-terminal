'use client'

import React, { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { TableVirtuoso } from 'react-virtuoso';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, Zap, AlertTriangle, Filter, Radio } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

// Define Types - matching server-side types
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

interface LiquidationAPIResponse {
  isConnected: boolean;
  liquidations: ProcessedLiquidation[];
  timestamp: number;
  lastMessageAgo?: number;
  totalLiquidations?: number;
}

const formatCurrency = (value: number) => 
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value);

const formatTime = (timestamp: number) => 
  new Date(timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Optimized Row Component using React.memo - no transitions to prevent flashing
const LiquidationRow = memo(({ liquidation, isNew, className }: { liquidation: ProcessedLiquidation; isNew?: boolean; className?: string }) => {
  const isBuy = liquidation.side === 'B';
  
  // Use refs to store values for click handlers - prevents stale closures during rapid re-renders
  const addressRef = useRef(liquidation.address);
  const hashRef = useRef(liquidation.hash);
  addressRef.current = liquidation.address;
  hashRef.current = liquidation.hash;
  
  // Use useCallback with refs to ensure handlers are stable
  const handleAddressClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (addressRef.current) {
      window.open(`https://www.flowscan.xyz/address/${addressRef.current}`, '_blank', 'noopener,noreferrer');
    }
  }, []);
  
  const handleHashClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (hashRef.current) {
      window.open(`https://www.flowscan.xyz/tx/${hashRef.current}`, '_blank', 'noopener,noreferrer');
    }
  }, []);
  
  return (
    <>
      <td className={cn(
        "p-3 whitespace-nowrap font-mono text-xs text-muted-foreground",
        isNew && "bg-primary/20",
        className
      )}>
        {formatTime(liquidation.time)}
      </td>
      <td className={cn(
        "p-3 whitespace-nowrap font-bold font-mono text-xs",
        isNew && "bg-primary/20",
        className
      )}>
        {liquidation.coin}
      </td>
      <td className={cn(
        "p-3 whitespace-nowrap font-mono text-xs text-center",
        isBuy ? "text-green-500" : "text-red-500",
        isNew && "bg-primary/20",
        className
      )}>
        {isBuy ? 'BUY' : 'SELL'}
      </td>
      <td className={cn(
        "p-3 whitespace-nowrap font-mono text-xs text-right",
        isNew && "bg-primary/20",
        className
      )}>
        {formatCurrency(liquidation.price)}
      </td>
      <td className={cn(
        "p-3 whitespace-nowrap font-mono text-xs text-right",
        isNew && "bg-primary/20",
        className
      )}>
        {liquidation.size.toFixed(4)}
      </td>
      <td className={cn(
        "p-3 whitespace-nowrap font-mono text-xs text-right",
        isNew && "bg-primary/20",
        className
      )}>
        {formatCurrency(liquidation.value)}
      </td>
      <td className={cn(
        "p-3 whitespace-nowrap font-mono text-xs text-right hidden md:table-cell",
        isNew && "bg-primary/20",
        className
      )}>
        <span className={liquidation.pnl > 0 ? "text-green-500" : liquidation.pnl < 0 ? "text-red-500" : "text-muted-foreground"}>
          {liquidation.pnl !== 0 ? formatCurrency(liquidation.pnl) : '-'}
        </span>
      </td>
      <td className={cn(
        "p-3 whitespace-nowrap font-mono text-xs text-right hidden md:table-cell",
        isNew && "bg-primary/20",
        className
      )}>
        {formatCurrency(liquidation.fee)}
      </td>
      <td className={cn(
        "p-3 whitespace-nowrap font-mono text-[10px] text-center",
        isNew && "bg-primary/20",
        className
      )}>
        {liquidation.address ? (
          <button 
            onMouseDown={handleAddressClick}
            className="text-blue-500 underline cursor-pointer bg-transparent border-none p-0 font-mono text-[10px] select-none"
          >
            {liquidation.address.substring(0, 6)}...{liquidation.address.substring(liquidation.address.length - 4)}
          </button>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
      <td className={cn(
        "p-3 whitespace-nowrap font-mono text-[10px] text-center",
        isNew && "bg-primary/20",
        className
      )}>
        {liquidation.hash ? (
          <button 
            onMouseDown={handleHashClick}
            className="text-blue-500 underline cursor-pointer bg-transparent border-none p-0 font-mono text-[10px] select-none"
          >
            {liquidation.hash.substring(0, 6)}...{liquidation.hash.substring(liquidation.hash.length - 4)}
          </button>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
    </>
  );
}, (prev, next) => prev.liquidation.id === next.liquidation.id && prev.isNew === next.isNew);

LiquidationRow.displayName = 'LiquidationRow';

// Live pulse indicator component
const LivePulse = ({ isLive }: { isLive: boolean }) => (
  <div className="flex items-center gap-2">
    <span className="relative flex h-3 w-3">
      {isLive && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
      )}
      <span className={cn(
        "relative inline-flex rounded-full h-3 w-3",
        isLive ? "bg-green-500" : "bg-red-500"
      )}></span>
    </span>
    <span className={cn(
      "text-xs font-bold uppercase tracking-wider",
      isLive ? "text-green-500" : "text-red-500"
    )}>
      {isLive ? 'LIVE' : 'OFFLINE'}
    </span>
  </div>
);

export default function LiquidationsPage() {
  const [isConnected, setIsConnected] = useState(false);
  const [rows, setRows] = useState<ProcessedLiquidation[]>([]);
  const [lastMessageAgo, setLastMessageAgo] = useState<number>(0);
  const [totalLiquidations, setTotalLiquidations] = useState<number>(0);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [updateCount, setUpdateCount] = useState(0);
  const previousIdsRef = useRef<Set<string>>(new Set());
  
  // Filters
  const [coinFilter, setCoinFilter] = useState('');
  const [minSizeFilter, setMinSizeFilter] = useState('');
  const [sideFilter, setSideFilter] = useState<'ALL' | 'B' | 'A'>('ALL');

  // Fetch liquidations from server-side API
  const fetchLiquidations = useCallback(async () => {
    try {
      const response = await fetch('/api/liquidations');
      if (!response.ok) throw new Error('Failed to fetch liquidations');
      
      const data: LiquidationAPIResponse = await response.json();
      
      setIsConnected(data.isConnected);
      setLastMessageAgo(data.lastMessageAgo || 0);
      setTotalLiquidations(data.totalLiquidations || 0);
      
      // Detect new items
      const currentIds = new Set(data.liquidations.map(l => l.id));
      const newItemIds = new Set<string>();
      
      data.liquidations.forEach(l => {
        if (!previousIdsRef.current.has(l.id)) {
          newItemIds.add(l.id);
        }
      });
      
      if (newItemIds.size > 0) {
        setNewIds(newItemIds);
        setUpdateCount(prev => prev + newItemIds.size);
        
        // Clear new status after animation
        setTimeout(() => {
          setNewIds(new Set());
        }, 1000);
      }
      
      previousIdsRef.current = currentIds;
      setRows(data.liquidations);
    } catch (error) {
      console.error('Error fetching liquidations:', error);
      setIsConnected(false);
    }
  }, []);

  // Ultra-fast polling for live feel (50ms = 20fps)
  useEffect(() => {
    fetchLiquidations();
    const interval = setInterval(fetchLiquidations, 50);
    return () => clearInterval(interval);
  }, [fetchLiquidations]);

  // Client-side filtering
  const filteredRows = useMemo(() => {
    if (!coinFilter && !minSizeFilter && sideFilter === 'ALL') return rows;
    
    const lowerCoin = coinFilter.toLowerCase();
    const minVal = minSizeFilter ? parseFloat(minSizeFilter) : 0;

    return rows.filter(r => {
      if (coinFilter && 
          !r.coin.toLowerCase().includes(lowerCoin) && 
          !r.address.toLowerCase().includes(lowerCoin)) {
        return false;
      }
      if (minVal > 0 && r.value < minVal) return false;
      if (sideFilter !== 'ALL' && r.side !== sideFilter) return false;
      return true;
    });
  }, [rows, coinFilter, minSizeFilter, sideFilter]);

  return (
    <div className="h-screen flex flex-col bg-background p-4 gap-4">
      {/* Header Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 shrink-0 font-mono">
        {/* Live Status Card */}
        <Card className={cn(
          "border-2 transition-colors duration-300",
          isConnected ? "border-green-500/50" : "border-red-500/50"
        )}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium tracking-tight flex items-center gap-2">
              <Radio className={cn("h-4 w-4", isConnected && "animate-pulse text-green-500")} />
              Stream
            </CardTitle>
            <LivePulse isLive={isConnected} />
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tighter tabular-nums">
                  {updateCount.toLocaleString()}
                </span>
                <span className="text-xs text-muted-foreground">received</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className={cn(
                  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
                  lastMessageAgo < 5000 ? "bg-green-500/20 text-green-500" : "bg-yellow-500/20 text-yellow-500"
                )}>
                  <Activity className="h-3 w-3" />
                  {lastMessageAgo < 1000 ? 'Live' : `${Math.floor(lastMessageAgo / 1000)}s`}
                </span>
                <span>{totalLiquidations.toLocaleString()} cached</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium tracking-tight">Latest</CardTitle>
            <Zap className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            {rows[0] ? (
              <div className="space-y-1">
                <div className="text-lg font-bold tracking-tight">{rows[0].coin}</div>
                <div className={cn(
                  "text-sm font-mono",
                  rows[0].side === 'B' ? "text-green-500" : "text-red-500"
                )}>
                  {formatCurrency(rows[0].value)}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Waiting for data...</div>
            )}
          </CardContent>
        </Card>
        
        {/* Filters */}
        <Card className="col-span-1 md:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 tracking-tight">
              <Filter className="h-4 w-4" /> Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2 items-center">
            <Input 
              placeholder="Search Coin or Address..." 
              className="h-8 text-sm font-mono" 
              value={coinFilter}
              onChange={e => setCoinFilter(e.target.value)}
            />
            <Input 
              placeholder="Min Value ($)" 
              className="h-8 text-sm font-mono"
              type="number"
              value={minSizeFilter}
              onChange={e => setMinSizeFilter(e.target.value)}
            />
            <Select value={sideFilter} onValueChange={(val: 'ALL' | 'B' | 'A') => setSideFilter(val)}>
              <SelectTrigger className="h-8 w-[100px] font-mono text-xs">
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
              className="font-mono tracking-tight"
              onClick={() => { setCoinFilter(''); setMinSizeFilter(''); setSideFilter('ALL'); }}
            >
              Clear
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Main Table Area */}
      <Card className="flex-1 overflow-hidden flex flex-col">
        <CardHeader className="py-3 px-4 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="text-md font-medium font-mono tracking-tight">Liquidations Feed</CardTitle>
              <LivePulse isLive={isConnected} />
            </div>
            <Badge variant="outline" className="font-mono tracking-tight tabular-nums">
              {filteredRows.length.toLocaleString()} displayed
            </Badge>
          </div>
        </CardHeader>
        <div className="flex-1 min-h-0 bg-card font-mono">
          <TableVirtuoso
            data={filteredRows}
            fixedHeaderContent={() => (
              <tr className="bg-muted/50 border-b border-border">
                <th className="h-12 px-3 text-left align-middle font-medium text-muted-foreground text-xs">Time</th>
                <th className="h-12 px-3 text-left align-middle font-medium text-muted-foreground text-xs">Coin</th>
                <th className="h-12 px-3 text-center align-middle font-medium text-muted-foreground text-xs">Side</th>
                <th className="h-12 px-3 text-right align-middle font-medium text-muted-foreground text-xs">Price</th>
                <th className="h-12 px-3 text-right align-middle font-medium text-muted-foreground text-xs">Size</th>
                <th className="h-12 px-3 text-right align-middle font-medium text-muted-foreground text-xs">Value</th>
                <th className="h-12 px-3 text-right align-middle font-medium text-muted-foreground text-xs hidden md:table-cell">PnL</th>
                <th className="h-12 px-3 text-right align-middle font-medium text-muted-foreground text-xs hidden md:table-cell">Fee</th>
                <th className="h-12 px-3 text-center align-middle font-medium text-muted-foreground text-xs">Wallet</th>
                <th className="h-12 px-3 text-center align-middle font-medium text-muted-foreground text-xs">Tx Hash</th>
              </tr>
            )}
            itemContent={(index, liquidation) => (
              <LiquidationRow 
                liquidation={liquidation} 
                isNew={newIds.has(liquidation.id)}
              />
            )}
            components={{
              Table: (props) => <table {...props} className="w-full caption-bottom text-sm border-collapse" />,
              TableRow: (props) => <tr {...props} className="border-b" />,
            }}
          />
        </div>
      </Card>
    </div>
  );
}
