'use client'

import React, { useState, useEffect, useCallback, memo, useMemo } from 'react';
import { TableVirtuoso } from 'react-virtuoso';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, TrendingUp, FileText, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

// Types matching server-side
interface ProcessedFill {
  id: string;
  user: string;
  coin: string;
  side: 'B' | 'A';
  price: number;
  amount: number;
  value: number;
  fee: number;
  timestamp: number;
  hash?: string;
  type: 'fill';
}

interface ProcessedOrderUpdate {
  id: string;
  user: string;
  coin: string;
  side: 'B' | 'A';
  price: number;
  size: number;
  status: string;
  orderType: string;
  timestamp: number;
  hash: string;
  oid: number;
  type: 'order';
}

interface IntelAPIResponse {
  isConnected: boolean;
  builder: string;
  fills: ProcessedFill[];
  orders: ProcessedOrderUpdate[];
  timestamp: number;
}

const formatCurrency = (value: number) => 
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value);

const formatTime = (timestamp: number) => 
  new Date(timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Fill Row Component
const FillRow = memo(({ fill }: { fill: ProcessedFill }) => {
  const isBuy = fill.side === 'B';
  
  return (
    <>
      <td className="p-3 whitespace-nowrap font-mono text-xs text-muted-foreground">
        {formatTime(fill.timestamp)}
      </td>
      <td className="p-3 whitespace-nowrap font-bold font-mono text-xs">
        {fill.coin}
      </td>
      <td className={cn("p-3 whitespace-nowrap font-mono text-xs text-center", isBuy ? "text-green-500" : "text-red-500")}>
        {isBuy ? 'BUY' : 'SELL'}
      </td>
      <td className="p-3 whitespace-nowrap font-mono text-xs text-right">
        {formatCurrency(fill.price)}
      </td>
      <td className="p-3 whitespace-nowrap font-mono text-xs text-right">
        {fill.amount.toFixed(4)}
      </td>
      <td className="p-3 whitespace-nowrap font-mono text-xs text-right">
        {formatCurrency(fill.value)}
      </td>
      <td className="p-3 whitespace-nowrap font-mono text-xs text-right hidden md:table-cell">
        {formatCurrency(fill.fee)}
      </td>
      <td className="p-3 whitespace-nowrap font-mono text-[10px] text-center">
        {fill.user ? (
          <button 
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              window.open(`https://www.flowscan.xyz/address/${fill.user}`, '_blank', 'noopener,noreferrer');
            }}
            className="text-blue-500 underline cursor-pointer bg-transparent border-none p-0 font-mono text-[10px] select-none"
          >
            {fill.user.substring(0, 6)}...{fill.user.substring(fill.user.length - 4)}
          </button>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
      <td className="p-3 whitespace-nowrap font-mono text-[10px] text-center">
        {fill.hash ? (
          <button 
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              window.open(`https://www.flowscan.xyz/tx/${fill.hash}`, '_blank', 'noopener,noreferrer');
            }}
            className="text-blue-500 underline cursor-pointer bg-transparent border-none p-0 font-mono text-[10px] select-none"
          >
            {fill.hash.substring(0, 6)}...{fill.hash.substring(fill.hash.length - 4)}
          </button>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
    </>
  );
}, (prev, next) => prev.fill.id === next.fill.id);

FillRow.displayName = 'FillRow';

// Order Row Component
const OrderRow = memo(({ order }: { order: ProcessedOrderUpdate }) => {
  const isBuy = order.side === 'B';
  const statusColor = order.status === 'filled' ? 'text-green-500' : 
                      order.status === 'cancelled' ? 'text-red-500' : 
                      'text-yellow-500';
  
  return (
    <>
      <td className="p-3 whitespace-nowrap font-mono text-xs text-muted-foreground">
        {formatTime(order.timestamp)}
      </td>
      <td className="p-3 whitespace-nowrap font-bold font-mono text-xs">
        {order.coin}
      </td>
      <td className={cn("p-3 whitespace-nowrap font-mono text-xs text-center", isBuy ? "text-green-500" : "text-red-500")}>
        {isBuy ? 'BUY' : 'SELL'}
      </td>
      <td className="p-3 whitespace-nowrap font-mono text-xs text-center">
        <Badge variant="outline" className="text-[10px] h-5">
          {order.orderType}
        </Badge>
      </td>
      <td className={cn("p-3 whitespace-nowrap font-mono text-xs text-center font-semibold", statusColor)}>
        {order.status.toUpperCase()}
      </td>
      <td className="p-3 whitespace-nowrap font-mono text-xs text-right">
        {formatCurrency(order.price)}
      </td>
      <td className="p-3 whitespace-nowrap font-mono text-xs text-right">
        {order.size.toFixed(4)}
      </td>
      <td className="p-3 whitespace-nowrap font-mono text-[10px] text-center">
        {order.user ? (
          <button 
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              window.open(`https://www.flowscan.xyz/address/${order.user}`, '_blank', 'noopener,noreferrer');
            }}
            className="text-blue-500 underline cursor-pointer bg-transparent border-none p-0 font-mono text-[10px] select-none"
          >
            {order.user.substring(0, 6)}...{order.user.substring(order.user.length - 4)}
          </button>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
      <td className="p-3 whitespace-nowrap font-mono text-[10px] text-center">
        {order.hash ? (
          <button 
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              window.open(`https://www.flowscan.xyz/tx/${order.hash}`, '_blank', 'noopener,noreferrer');
            }}
            className="text-blue-500 underline cursor-pointer bg-transparent border-none p-0 font-mono text-[10px] select-none"
          >
            {order.hash.substring(0, 6)}...{order.hash.substring(order.hash.length - 4)}
          </button>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
    </>
  );
}, (prev, next) => prev.order.id === next.order.id);

OrderRow.displayName = 'OrderRow';

export default function InsilicoIntelPage() {
  const [isConnected, setIsConnected] = useState(false);
  const [fills, setFills] = useState<ProcessedFill[]>([]);
  const [orders, setOrders] = useState<ProcessedOrderUpdate[]>([]);
  
  // Filters
  const [coinFilter, setCoinFilter] = useState('');
  const [sideFilter, setSideFilter] = useState<'ALL' | 'B' | 'A'>('ALL');

  // Fetch data from server-side API
  const fetchData = useCallback(async () => {
    try {
      const response = await fetch('/api/insilico-intel');
      if (!response.ok) throw new Error('Failed to fetch intel data');
      
      const data: IntelAPIResponse = await response.json();
      
      setIsConnected(data.isConnected);
      setFills(data.fills);
      setOrders(data.orders);
    } catch (error) {
      console.error('Error fetching intel data:', error);
      setIsConnected(false);
    }
  }, []);

  // Poll API for updates
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 75); // 75ms polling
    return () => clearInterval(interval);
  }, [fetchData]);

  // Client-side filtering
  const filteredFills = useMemo(() => {
    if (!coinFilter && sideFilter === 'ALL') return fills;
    
    const lowerCoin = coinFilter.toLowerCase();
    return fills.filter(f => {
      if (coinFilter && !f.coin.toLowerCase().includes(lowerCoin) && 
          !f.user.toLowerCase().includes(lowerCoin)) return false;
      if (sideFilter !== 'ALL' && f.side !== sideFilter) return false;
      return true;
    });
  }, [fills, coinFilter, sideFilter]);

  const filteredOrders = useMemo(() => {
    if (!coinFilter && sideFilter === 'ALL') return orders;
    
    const lowerCoin = coinFilter.toLowerCase();
    return orders.filter(o => {
      if (coinFilter && !o.coin.toLowerCase().includes(lowerCoin) && 
          !o.user.toLowerCase().includes(lowerCoin)) return false;
      if (sideFilter !== 'ALL' && o.side !== sideFilter) return false;
      return true;
    });
  }, [orders, coinFilter, sideFilter]);

  return (
    <div className="h-screen flex flex-col bg-background p-4 gap-4">
      {/* Header */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0 font-mono">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium tracking-tight">Status</CardTitle>
            <Activity className={cn("h-4 w-4", isConnected ? "text-green-500" : "text-red-500")} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tighter">{isConnected ? 'Live' : 'Disconnected'}</div>
            <p className="text-xs text-muted-foreground tracking-tight">
              $ insilico_builder
            </p>
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
              placeholder="Search Coin or User..." 
              className="h-8 text-sm font-mono" 
              value={coinFilter}
              onChange={e => setCoinFilter(e.target.value)}
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
              onClick={() => { setCoinFilter(''); setSideFilter('ALL'); }}
            >
              Clear
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Two Tables Side by Side */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-2 gap-4 min-h-0">
        {/* Fills Table */}
        <Card className="overflow-hidden flex flex-col">
          <CardHeader className="py-3 px-4 border-b shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-md font-medium font-mono tracking-tight flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Builder Fills
              </CardTitle>
              <Badge variant="outline" className="font-mono tracking-tight">
                {filteredFills.length}
              </Badge>
            </div>
          </CardHeader>
          <div className="flex-1 min-h-0 bg-card font-mono overflow-auto">
            <TableVirtuoso
              data={filteredFills}
              fixedHeaderContent={() => (
                <tr className="bg-muted/50 border-b border-border">
                  <th className="h-12 px-3 text-left align-middle font-medium text-muted-foreground text-xs">Time</th>
                  <th className="h-12 px-3 text-left align-middle font-medium text-muted-foreground text-xs">Coin</th>
                  <th className="h-12 px-3 text-center align-middle font-medium text-muted-foreground text-xs">Side</th>
                  <th className="h-12 px-3 text-right align-middle font-medium text-muted-foreground text-xs">Price</th>
                  <th className="h-12 px-3 text-right align-middle font-medium text-muted-foreground text-xs">Amount</th>
                  <th className="h-12 px-3 text-right align-middle font-medium text-muted-foreground text-xs">Value</th>
                  <th className="h-12 px-3 text-right align-middle font-medium text-muted-foreground text-xs hidden md:table-cell">Fee</th>
                  <th className="h-12 px-3 text-center align-middle font-medium text-muted-foreground text-xs">User</th>
                  <th className="h-12 px-3 text-center align-middle font-medium text-muted-foreground text-xs">Tx</th>
                </tr>
              )}
              itemContent={(index, fill) => <FillRow fill={fill} />}
              components={{
                Table: (props) => <table {...props} className="w-full caption-bottom text-sm border-collapse" />,
                TableRow: (props) => <tr {...props} className="border-b" />,
              }}
            />
          </div>
        </Card>

        {/* Orders Table */}
        <Card className="overflow-hidden flex flex-col">
          <CardHeader className="py-3 px-4 border-b shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-md font-medium font-mono tracking-tight flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Order Updates
              </CardTitle>
              <Badge variant="outline" className="font-mono tracking-tight">
                {filteredOrders.length}
              </Badge>
            </div>
          </CardHeader>
          <div className="flex-1 min-h-0 bg-card font-mono overflow-auto">
            <TableVirtuoso
              data={filteredOrders}
              fixedHeaderContent={() => (
                <tr className="bg-muted/50 border-b border-border">
                  <th className="h-12 px-3 text-left align-middle font-medium text-muted-foreground text-xs">Time</th>
                  <th className="h-12 px-3 text-left align-middle font-medium text-muted-foreground text-xs">Coin</th>
                  <th className="h-12 px-3 text-center align-middle font-medium text-muted-foreground text-xs">Side</th>
                  <th className="h-12 px-3 text-center align-middle font-medium text-muted-foreground text-xs">Type</th>
                  <th className="h-12 px-3 text-center align-middle font-medium text-muted-foreground text-xs">Status</th>
                  <th className="h-12 px-3 text-right align-middle font-medium text-muted-foreground text-xs">Price</th>
                  <th className="h-12 px-3 text-right align-middle font-medium text-muted-foreground text-xs">Size</th>
                  <th className="h-12 px-3 text-center align-middle font-medium text-muted-foreground text-xs">User</th>
                  <th className="h-12 px-3 text-center align-middle font-medium text-muted-foreground text-xs">Tx</th>
                </tr>
              )}
              itemContent={(index, order) => <OrderRow order={order} />}
              components={{
                Table: (props) => <table {...props} className="w-full caption-bottom text-sm border-collapse" />,
                TableRow: (props) => <tr {...props} className="border-b" />,
              }}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

