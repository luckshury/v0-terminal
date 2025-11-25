import { NextRequest, NextResponse } from 'next/server';
import WebSocket from 'ws';

// Types
interface LiquidationFillDetails {
  coin: string;
  px: string;
  sz: string;
  side: 'B' | 'A';
  time: number;
  startPosition: string;
  dir: string;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  tid: number;
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

// Singleton WebSocket Manager
class LiquidationStreamManager {
  private static instance: LiquidationStreamManager | null = null;
  private ws: WebSocket | null = null;
  private liquidations: ProcessedLiquidation[] = [];
  private isConnected: boolean = false;
  private isConnecting: boolean = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private lastMessageTime: number = Date.now();
  private readonly MAX_LIQUIDATIONS = 5000;
  private readonly RECONNECT_DELAY = 5000;
  private readonly KEEP_ALIVE_INTERVAL = 30000;
  private readonly PING_INTERVAL = 15000;
  private readonly MESSAGE_TIMEOUT = 60000; // Consider stale if no message for 60s

  private constructor() {
    this.connect();
    this.startKeepAlive();
    this.startPingMonitor();
  }

  public static getInstance(): LiquidationStreamManager {
    if (!LiquidationStreamManager.instance) {
      LiquidationStreamManager.instance = new LiquidationStreamManager();
    }
    return LiquidationStreamManager.instance;
  }

  private connect(): void {
    if (this.isConnecting) {
      console.log('⏳ Connection already in progress...');
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('✅ WebSocket already connected');
      return;
    }

    this.isConnecting = true;
    console.log('🔌 Connecting to Hydromancer WebSocket for liquidations...');
    
    try {
      this.ws = new WebSocket('wss://api.hydromancer.xyz/ws');

      this.ws.on('open', () => {
        console.log('✅ Liquidations WebSocket opened, authenticating...');
        this.isConnecting = false;
        this.ws?.send(JSON.stringify({
          type: 'auth',
          apiKey: 'sk_nNhuLkdGdW5sxnYec33C2FBPzLjXBnEd'
        }));
      });

      this.ws.on('message', (data: Buffer) => {
        this.lastMessageTime = Date.now();
        
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === 'connected') {
            console.log('✅ Authenticated! Subscribing to liquidationFills...');
            this.isConnected = true;
            this.ws?.send(JSON.stringify({
              type: 'subscribe',
              subscription: {
                type: 'liquidationFills'
              }
            }));
          } else if (msg.type === 'subscriptionUpdate') {
            console.log('📊 Subscription update:', msg);
          } else if (msg.type === 'error') {
            console.error('❌ WS Error:', msg);
            this.isConnected = false;
          } else if (msg.type === 'liquidationFills') {
            console.log(`⚡ Received ${msg.fills.length} liquidations`);
            this.processLiquidations(msg.fills);
          } else if (msg.type === 'ping') {
            this.ws?.send(JSON.stringify({ type: 'pong' }));
          } else if (msg.type === 'pong') {
            // Acknowledge pong
          }
        } catch (e) {
          console.error('❌ Parse error:', e);
        }
      });

      this.ws.on('close', (code, reason) => {
        console.log(`🔌 Liquidations WebSocket closed (code: ${code}, reason: ${reason})`);
        this.isConnected = false;
        this.isConnecting = false;
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        console.error('❌ Liquidations WebSocket error:', error.message || error);
        this.isConnected = false;
        this.isConnecting = false;
      });
    } catch (error) {
      console.error('❌ Failed to create WebSocket:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private processLiquidations(fills: any[]): void {
    const newLiquidations: ProcessedLiquidation[] = [];
    
    fills.forEach((item: any) => {
      if (Array.isArray(item) && item.length >= 2) {
        const address = item[0];
        const d = item[1] as LiquidationFillDetails;
        
        const price = parseFloat(d.px);
        const size = parseFloat(d.sz);
        const value = price * size;

        const processed: ProcessedLiquidation = {
          id: `${d.oid}-${d.tid}-${Date.now()}`,
          address,
          coin: d.coin,
          price,
          size,
          side: d.side,
          time: d.time,
          value,
          fee: parseFloat(d.fee || '0'),
          pnl: parseFloat(d.closedPnl || '0'),
          dir: d.dir,
          hash: d.hash
        };

        newLiquidations.push(processed);
      }
    });

    // Prepend new liquidations (newest first) and limit array size
    if (newLiquidations.length > 0) {
      this.liquidations = [...newLiquidations.reverse(), ...this.liquidations].slice(0, this.MAX_LIQUIDATIONS);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    console.log(`🔄 Scheduling reconnect in ${this.RECONNECT_DELAY / 1000}s...`);
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, this.RECONNECT_DELAY);
  }

  private startKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }

    this.keepAliveInterval = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN && !this.isConnecting) {
        console.log('🔄 WebSocket not open, reconnecting...');
        this.connect();
      }
    }, this.KEEP_ALIVE_INTERVAL);
  }

  private startPingMonitor(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      const timeSinceLastMessage = Date.now() - this.lastMessageTime;
      
      if (timeSinceLastMessage > this.MESSAGE_TIMEOUT) {
        console.log(`⚠️ No messages for ${timeSinceLastMessage / 1000}s, connection may be stale. Reconnecting...`);
        this.forceReconnect();
      } else if (this.ws?.readyState === WebSocket.OPEN) {
        // Send ping to keep connection alive
        this.ws?.send(JSON.stringify({ type: 'ping' }));
      }
    }, this.PING_INTERVAL);
  }

  private forceReconnect(): void {
    console.log('🔄 Forcing reconnection...');
    
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
    
    this.isConnected = false;
    this.isConnecting = false;
    this.connect();
  }

  public getState() {
    const timeSinceLastMessage = Date.now() - this.lastMessageTime;
    
    return {
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      liquidations: this.liquidations,
      timestamp: Date.now(),
      wsState: this.ws?.readyState,
      lastMessageAgo: timeSinceLastMessage,
      totalLiquidations: this.liquidations.length
    };
  }

  public getLiquidations(limit: number = 5000): ProcessedLiquidation[] {
    return this.liquidations.slice(0, limit);
  }

  public isHealthy(): boolean {
    const timeSinceLastMessage = Date.now() - this.lastMessageTime;
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN && timeSinceLastMessage < this.MESSAGE_TIMEOUT;
  }

  // Graceful shutdown
  public shutdown(): void {
    console.log('🛑 Shutting down liquidation stream...');
    
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    if (this.pingInterval) clearInterval(this.pingInterval);
    
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    
    this.isConnected = false;
    this.isConnecting = false;
  }
}

// Initialize the singleton instance when module loads
const streamManager = LiquidationStreamManager.getInstance();

// Ensure cleanup on process termination
if (typeof process !== 'undefined') {
  process.on('SIGTERM', () => streamManager.shutdown());
  process.on('SIGINT', () => streamManager.shutdown());
}

// API Route Handler - GET endpoint for polling
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get('limit') || '5000');
  const health = searchParams.get('health') === 'true';
  
  // Health check endpoint
  if (health) {
    const state = streamManager.getState();
    return NextResponse.json({
      healthy: streamManager.isHealthy(),
      ...state
    });
  }
  
  // Return current liquidations
  const state = streamManager.getState();
  return NextResponse.json({
    isConnected: state.isConnected,
    liquidations: streamManager.getLiquidations(limit),
    timestamp: state.timestamp,
    lastMessageAgo: state.lastMessageAgo,
    totalLiquidations: state.totalLiquidations
  });
}

// Force reconnect endpoint (for debugging/admin)
export async function POST(request: NextRequest) {
  const body = await request.json();
  
  if (body.action === 'reconnect') {
    streamManager['forceReconnect']();
    return NextResponse.json({ success: true, message: 'Reconnection initiated' });
  }
  
  if (body.action === 'status') {
    const state = streamManager.getState();
    return NextResponse.json(state);
  }
  
  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
