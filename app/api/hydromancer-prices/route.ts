import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Hydromancer enabled for Hyperliquid data
const HYDROMANCER_ENABLED = true;

// Types
interface PriceData {
  [symbol: string]: string;
}

interface EnrichedPriceData {
  symbol: string;
  price: number;
  dayChange?: number;
  weekChange?: number;
  monthChange?: number;
  longTraderCount?: number;
  shortTraderCount?: number;
  traderRatio?: number;
}

interface PriceManagerState {
  prices: PriceData;
  timestamp: number;
  tokenCount: number;
  isConnected: boolean;
  lastFetchTime: number;
  lastFetchDuration: number;
}

// Supabase client (only if credentials are available)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// Singleton REST Polling Manager
class HydromancerPriceManager {
  private static instance: HydromancerPriceManager | null = null;
  private prices: PriceData = {};
  private isConnected: boolean = false;
  private isFetching: boolean = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private snapshotInterval: NodeJS.Timeout | null = null;
  private lastFetchTime: number = 0;
  private lastFetchDuration: number = 0;
  private lastSnapshotTime: number = 0;
  private readonly POLL_INTERVAL = 30000; // 30 seconds for price data
  private readonly TRADER_POLL_INTERVAL = 60000; // 1 minute for trader data (metadata)
  private readonly SNAPSHOT_INTERVAL = 3600000; // 1 hour
  private readonly API_URL = 'https://api.hydromancer.xyz/info';
  private readonly PERP_URL = 'https://api.hydromancer.xyz/perpsnapshot';
  private readonly META_URL = 'https://api.hydromancer.xyz/meta';
  private readonly API_KEY = process.env.HYDROMANCER_API_KEY || 'sk_nNhuLkdGdW5sxnYec33C2FBPzLjXBnEd';
  private rateLimitDelay: number = 0;
  private lastRequestTime: number = 0;
  private traderDataCache: Map<string, {data: any, timestamp: number}> = new Map();
  private lastTraderDataFetch: number = 0;

  private constructor() {
    console.log('🚀 Initializing Hydromancer Price Manager...');
    if (!HYDROMANCER_ENABLED) {
      console.log('⚠️  Hydromancer API disabled - no points remaining');
      return;
    }
    if (supabase) {
      console.log('✅ Supabase client initialized - historical data enabled');
    } else {
      console.log('⚠️  Supabase not configured - historical data disabled');
    }
    this.startPolling();
    if (supabase) {
      this.startSnapshotting();
    }
  }

  public static getInstance(): HydromancerPriceManager {
    if (!HydromancerPriceManager.instance) {
      HydromancerPriceManager.instance = new HydromancerPriceManager();
    }
    return HydromancerPriceManager.instance;
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minInterval = 1000 + this.rateLimitDelay; // 1 second base + backoff
    
    if (timeSinceLastRequest < minInterval) {
      const waitTime = minInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }

  private async makeApiRequest(url: string, body: any): Promise<any> {
    await this.waitForRateLimit();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.status === 429) {
      // Rate limited - exponential backoff
      this.rateLimitDelay = Math.min(this.rateLimitDelay * 2 || 1000, 30000);
      console.log(`⚠️ Rate limited, backing off for ${this.rateLimitDelay}ms`);
      throw new Error('Rate limited');
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Reset rate limit delay on success
    this.rateLimitDelay = 0;
    return response.json();
  }

  private async fetchAllPrices(): Promise<void> {
    if (this.isFetching) {
      return;
    }

    this.isFetching = true;
    const fetchStart = Date.now();

    try {
      const data: PriceData = await this.makeApiRequest(this.API_URL, {
        type: 'allMids',
        dex: 'ALL_DEXS',
      });
      
      // Update state
      this.prices = data;
      this.isConnected = true;
      this.lastFetchTime = Date.now();
      this.lastFetchDuration = Date.now() - fetchStart;

      console.log(`✅ Fetched ${Object.keys(data).length} token prices in ${this.lastFetchDuration}ms`);
    } catch (error) {
      console.error('❌ Failed to fetch prices:', error instanceof Error ? error.message : error);
      if (error instanceof Error && error.message !== 'Rate limited') {
        this.isConnected = false;
      }
    } finally {
      this.isFetching = false;
    }
  }

  private async fetchAllTraderData(): Promise<void> {
    const now = Date.now();
    
    // Only fetch trader data every minute (metadata approach)
    if (now - this.lastTraderDataFetch < this.TRADER_POLL_INTERVAL) {
      return;
    }

    try {
      // Use meta endpoint for bulk trader data instead of individual perpsnapshot calls
      const metaData = await this.makeApiRequest(this.META_URL, {});
      
      if (metaData && metaData.universe) {
        for (const asset of metaData.universe) {
          if (asset.name && this.prices[asset.name]) {
            // Cache trader data for this asset
            this.traderDataCache.set(asset.name, {
              data: {
                longTraderCount: asset.longTraderCount || 0,
                shortTraderCount: asset.shortTraderCount || 0,
                traderRatio: asset.shortTraderCount > 0 ? (asset.longTraderCount || 0) / asset.shortTraderCount : 0
              },
              timestamp: now
            });
          }
        }
      }
      
      this.lastTraderDataFetch = now;
      console.log(`✅ Fetched trader data for ${this.traderDataCache.size} assets`);
      
    } catch (error) {
      console.error('❌ Failed to fetch bulk trader data:', error instanceof Error ? error.message : error);
    }
  }

  private getCachedTraderData(symbol: string): {longTraderCount?: number, shortTraderCount?: number, traderRatio?: number} {
    const cached = this.traderDataCache.get(symbol);
    const now = Date.now();
    
    // Return cached data if it's less than 5 minutes old
    if (cached && (now - cached.timestamp) < 300000) {
      return cached.data;
    }
    
    return {};
  }

  private startPolling(): void {
    // Initial fetch
    this.fetchAllPrices();
    
    // Initial trader data fetch (delayed)
    setTimeout(() => {
      this.fetchAllTraderData();
    }, 5000);

    // Set up polling interval for prices
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    this.pollingInterval = setInterval(() => {
      this.fetchAllPrices();
      this.fetchAllTraderData(); // Fetch trader data every interval too
    }, this.POLL_INTERVAL);

    console.log(`⏰ Price polling started at ${this.POLL_INTERVAL}ms intervals`);
    console.log(`⏰ Trader data polling at ${this.TRADER_POLL_INTERVAL}ms intervals`);
  }

  private startSnapshotting(): void {
    // Initial snapshot (after a short delay to ensure prices are fetched)
    setTimeout(() => {
      this.storeSnapshot();
    }, 5000);

    // Set up snapshot interval
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
    }

    this.snapshotInterval = setInterval(() => {
      this.storeSnapshot();
    }, this.SNAPSHOT_INTERVAL);

    console.log(`📸 Snapshot storage started at ${this.SNAPSHOT_INTERVAL / 1000 / 60} minute intervals`);
  }

  private async storeSnapshot(): Promise<void> {
    if (!supabase || Object.keys(this.prices).length === 0) {
      return;
    }

    try {
      const now = new Date();
      const snapshots = Object.entries(this.prices).map(([symbol, price]) => ({
        symbol,
        price: parseFloat(price),
        timestamp: now.toISOString(),
      }));

      // Batch insert (Supabase handles this efficiently)
      const { error } = await supabase
        .from('price_snapshots')
        .insert(snapshots);

      if (error) {
        console.error('❌ Failed to store snapshot:', error.message);
      } else {
        this.lastSnapshotTime = Date.now();
        console.log(`📸 Stored snapshot: ${snapshots.length} prices at ${now.toISOString()}`);
      }
    } catch (error) {
      console.error('❌ Snapshot storage error:', error);
    }
  }

  private async getHistoricalPrice(symbol: string, hoursAgo: number): Promise<number | null> {
    if (!supabase) return null;

    try {
      const targetTime = new Date(Date.now() - hoursAgo * 3600000);
      
      // Get the closest snapshot to the target time
      const { data, error } = await supabase
        .from('price_snapshots')
        .select('price')
        .eq('symbol', symbol)
        .lte('timestamp', targetTime.toISOString())
        .order('timestamp', { ascending: false })
        .limit(1);

      if (error || !data || data.length === 0) {
        return null;
      }

      return data[0].price;
    } catch (error) {
      return null;
    }
  }

  public async getEnrichedPrices(includeTraderData: boolean = false): Promise<EnrichedPriceData[]> {
    const enrichedPrices: EnrichedPriceData[] = [];

    for (const [symbol, priceStr] of Object.entries(this.prices)) {
      const currentPrice = parseFloat(priceStr);
      
      const enriched: EnrichedPriceData = {
        symbol,
        price: currentPrice,
      };

      // Calculate % changes if Supabase is available
      if (supabase) {
        // 24 hours ago
        const price24h = await this.getHistoricalPrice(symbol, 24);
        if (price24h) {
          enriched.dayChange = ((currentPrice - price24h) / price24h) * 100;
        }

        // 7 days ago
        const price7d = await this.getHistoricalPrice(symbol, 24 * 7);
        if (price7d) {
          enriched.weekChange = ((currentPrice - price7d) / price7d) * 100;
        }

        // 30 days ago
        const price30d = await this.getHistoricalPrice(symbol, 24 * 30);
        if (price30d) {
          enriched.monthChange = ((currentPrice - price30d) / price30d) * 100;
        }
      }

      // Include cached trader data if requested
      if (includeTraderData) {
        const traderData = this.getCachedTraderData(symbol);
        Object.assign(enriched, traderData);
      }

      enrichedPrices.push(enriched);
    }

    return enrichedPrices;
  }

  public getState(): PriceManagerState {
    return {
      prices: this.prices,
      timestamp: Date.now(),
      tokenCount: Object.keys(this.prices).length,
      isConnected: this.isConnected,
      lastFetchTime: this.lastFetchTime,
      lastFetchDuration: this.lastFetchDuration,
    };
  }

  public getPrices(): PriceData {
    return this.prices;
  }

  public isHealthy(): boolean {
    const timeSinceLastFetch = Date.now() - this.lastFetchTime;
    // Consider unhealthy if no successful fetch in last 10 seconds
    return this.isConnected && timeSinceLastFetch < 10000;
  }

  // Graceful shutdown
  public shutdown(): void {
    console.log('🛑 Shutting down price manager...');
    
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }
    
    this.isConnected = false;
  }

  public getLastSnapshotTime(): number {
    return this.lastSnapshotTime;
  }
}

// Initialize the singleton instance when module loads (only if enabled)
const priceManager = HYDROMANCER_ENABLED ? HydromancerPriceManager.getInstance() : null;

// Ensure cleanup on process termination
if (typeof process !== 'undefined' && priceManager) {
  process.on('SIGTERM', () => priceManager.shutdown());
  process.on('SIGINT', () => priceManager.shutdown());
}

// API Route Handler - GET endpoint for client polling
export async function GET(request: NextRequest) {
  if (!HYDROMANCER_ENABLED) {
    return NextResponse.json(
      { error: 'Hydromancer API disabled' },
      { status: 503 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const health = searchParams.get('health') === 'true';
  const enriched = searchParams.get('enriched') === 'true';
  const includeTraders = searchParams.get('traders') === 'true';
  
  // Health check endpoint
  if (health) {
    const state = priceManager.getState();
    return NextResponse.json({
      healthy: priceManager.isHealthy(),
      isConnected: state.isConnected,
      tokenCount: state.tokenCount,
      lastFetchTime: state.lastFetchTime,
      lastFetchDuration: state.lastFetchDuration,
      timeSinceLastFetch: Date.now() - state.lastFetchTime,
      lastSnapshotTime: priceManager.getLastSnapshotTime(),
      supabaseEnabled: !!supabase,
    });
  }

  // Return enriched prices with historical % changes and optional trader data
  if (enriched) {
    const enrichedPrices = await priceManager.getEnrichedPrices(includeTraders);
    return NextResponse.json({
      prices: enrichedPrices,
      timestamp: Date.now(),
      tokenCount: enrichedPrices.length,
      isConnected: priceManager.isHealthy(),
      hasHistoricalData: !!supabase,
      hasTraderData: includeTraders,
    });
  }
  
  // Return current prices as array (for consistency)
  const state = priceManager.getState();
  const pricesArray = Object.entries(state.prices).map(([symbol, priceStr]) => ({
    symbol,
    price: parseFloat(priceStr),
  }));
  
  return NextResponse.json({
    prices: pricesArray,
    timestamp: state.timestamp,
    tokenCount: state.tokenCount,
    isConnected: state.isConnected,
    hasHistoricalData: !!supabase,
  });
}

// Force refresh endpoint (for debugging/admin)
export async function POST(request: NextRequest) {
  const body = await request.json();
  
  if (body.action === 'refresh') {
    await priceManager['fetchAllPrices']();
    return NextResponse.json({ success: true, message: 'Refresh initiated' });
  }
  
  if (body.action === 'status') {
    const state = priceManager.getState();
    return NextResponse.json(state);
  }
  
  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}





