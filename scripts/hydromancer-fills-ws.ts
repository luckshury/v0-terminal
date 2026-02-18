/**
 * Hydromancer All Fills WebSocket Client
 * 
 * 24/7 WebSocket connection to Hydromancer allFills stream
 * Stores fills for BTC, ETH, HYPE in Supabase
 * 
 * Based on Hydromancer docs: https://docs.hydromancer.xyz/hydromancer-better-hyperliquid-apis/websocket/allfills
 * 
 * Run with PM2:
 *   pm2 start ecosystem.config.cjs --only hydromancer-fills
 * 
 * Or directly:
 *   npx tsx scripts/hydromancer-fills-ws.ts
 */

import WebSocket from 'ws';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables (check both .env and .env.local)
dotenv.config({ path: '.env.local' });
dotenv.config(); // Also try .env as fallback

// =============================================================================
// Configuration
// =============================================================================

const HYDROMANCER_API_KEY = process.env.HYDROMANCER_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const WEBSOCKET_URL = 'wss://api.hydromancer.xyz/ws';
// No filtering - store ALL fills from all coins
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 30000;
const HEARTBEAT_CHECK_INTERVAL_MS = 30000;
const STALE_CONNECTION_THRESHOLD_MS = 60000;
const BATCH_INSERT_SIZE = 50;
const BATCH_INSERT_DELAY_MS = 1000;

// =============================================================================
// Types (based on Hydromancer allFills docs)
// =============================================================================

interface HydromancerFill {
  coin: string;
  px: string;           // Fill price
  sz: string;           // Fill size
  side: 'B' | 'A';      // B=Buy, A=Sell
  time: number;         // Timestamp in milliseconds
  startPosition: string; // Position size before the fill
  dir: string;          // "Open Long", "Close Long", "Open Short", "Close Short"
  closedPnl: string;    // Realized PnL
  hash: string;         // Transaction hash
  oid: number;          // Order ID
  crossed: boolean;     // Was order crossed
  fee: string;          // Fee amount
  tid: number;          // Trade ID
  cloid?: string;       // Client Order ID (optional)
  builderFee?: string;  // Builder fee (optional)
  feeToken: string;     // Token used for fee
  builder?: string;     // Builder address
  twapId?: number;      // TWAP ID if part of TWAP order
}

interface HydromancerMessage {
  type: 'connected' | 'subscriptionUpdate' | 'allFills' | 'ping' | 'error';
  fills?: [string, HydromancerFill][]; // [address, fill_data] batched per block
  message?: string;
  error?: string;
}

interface FillInsert {
  address: string;
  coin: string;
  price: number;
  size: number;
  side: string;
  direction: string;
  start_position: number;
  closed_pnl: number;
  timestamp: string;
  fill_hash: string;
  order_id: number;
  trade_id: number;
  fee: number;
  fee_token: string;
  crossed: boolean;
}

// =============================================================================
// State
// =============================================================================

let ws: WebSocket | null = null;
let supabase: SupabaseClient;
let isConnected = false;
let reconnectAttempts = 0;
let lastHeartbeat = Date.now();
let fillsProcessed = 0;
let fillsInserted = 0;
let errors = 0;

// Batch insert buffer
let fillBuffer: FillInsert[] = [];
let batchTimeout: NodeJS.Timeout | null = null;

// =============================================================================
// Logging
// =============================================================================

function log(level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const prefix = {
    INFO: '\x1b[36m[INFO]\x1b[0m',
    WARN: '\x1b[33m[WARN]\x1b[0m',
    ERROR: '\x1b[31m[ERROR]\x1b[0m'
  }[level];
  
  console.log(`${timestamp} ${prefix} ${message}`, data ? JSON.stringify(data) : '');
}

// =============================================================================
// Database Operations
// =============================================================================

async function flushFillBuffer(): Promise<void> {
  if (fillBuffer.length === 0) return;
  
  const batch = fillBuffer.splice(0, BATCH_INSERT_SIZE);
  
  try {
    const { error } = await supabase
      .from('fills')
      .upsert(batch, { 
        onConflict: 'fill_hash,side',
        ignoreDuplicates: true 
      });
    
    if (error) {
      // Check if it's a duplicate error (expected for existing fills)
      if (error.code === '23505') {
        log('INFO', `Skipped ${batch.length} duplicate fills`);
      } else {
        log('ERROR', 'Failed to insert fills batch', { 
          error: error.message, 
          code: error.code,
          count: batch.length 
        });
        errors++;
      }
    } else {
      fillsInserted += batch.length;
      log('INFO', `Inserted ${batch.length} fills (total: ${fillsInserted})`);
    }
  } catch (err) {
    log('ERROR', 'Exception inserting fills', { error: err });
    errors++;
    // Re-add failed batch back to buffer for retry
    fillBuffer.unshift(...batch);
  }
  
  // Continue flushing if buffer is still large
  if (fillBuffer.length >= BATCH_INSERT_SIZE) {
    await flushFillBuffer();
  }
}

function scheduleBatchInsert(): void {
  if (batchTimeout) return;
  
  batchTimeout = setTimeout(async () => {
    batchTimeout = null;
    await flushFillBuffer();
  }, BATCH_INSERT_DELAY_MS);
}

// =============================================================================
// Fill Processing
// =============================================================================

function processFill(address: string, fill: HydromancerFill): boolean {
  // NO FILTERING - store ALL fills from Hydromancer
  const price = parseFloat(fill.px);
  const size = parseFloat(fill.sz);
  
  // Minimal validation (allow all valid fills)
  if (isNaN(price) || isNaN(size) || price <= 0) {
    log('WARN', 'Invalid fill data', { address, coin: fill.coin, price, size, side: fill.side });
    return false;
  }
  
  const fillData: FillInsert = {
    address: address.toLowerCase(),
    coin: fill.coin,
    price,
    size,
    side: fill.side,
    direction: fill.dir || 'Unknown',
    start_position: parseFloat(fill.startPosition) || 0,
    closed_pnl: parseFloat(fill.closedPnl) || 0,
    timestamp: new Date(fill.time).toISOString(),
    fill_hash: fill.hash,
    order_id: fill.oid,
    trade_id: fill.tid,
    fee: parseFloat(fill.fee) || 0,
    fee_token: fill.feeToken || 'USDC',
    crossed: fill.crossed || false
  };
  
  // Add to buffer
  fillBuffer.push(fillData);
  fillsProcessed++;
  
  // Log large fills (>$50K notional)
  const notional = Math.abs(price * size);
  if (notional > 50000) {
    log('INFO', `🐋 Large fill: ${fill.coin} ${fill.side === 'B' ? 'BUY' : 'SELL'} $${Math.round(notional).toLocaleString()}`, {
      address: address.slice(0, 10) + '...',
      direction: fill.dir
    });
  }
  
  // Schedule batch insert if buffer is getting full
  if (fillBuffer.length >= BATCH_INSERT_SIZE) {
    flushFillBuffer();
  } else {
    scheduleBatchInsert();
  }
  
  return true;
}

function processFillsBatch(fills: [string, HydromancerFill][]): void {
  if (!fills || fills.length === 0) return;
  
  let processed = 0;
  for (const [address, fill] of fills) {
    if (processFill(address, fill)) {
      processed++;
    }
  }
  
  if (processed > 0) {
    log('INFO', `Received ${fills.length} fills, queued ${processed} for insert (buffer: ${fillBuffer.length})`);
  }
}

// =============================================================================
// WebSocket Connection
// =============================================================================

function handleMessage(data: WebSocket.Data): void {
  try {
    const message: HydromancerMessage = JSON.parse(data.toString());
    
    switch (message.type) {
      case 'connected':
        isConnected = true;
        reconnectAttempts = 0;
        lastHeartbeat = Date.now();
        log('INFO', '✅ Connected to Hydromancer WebSocket');
        
        // Subscribe to allFills stream (per Hydromancer docs)
        ws?.send(JSON.stringify({
          type: 'subscribe',
          subscription: {
            type: 'allFills',
            dex: 'main',           // Optional: filter by DEX
            aggregateByTime: false // We want individual fills
          }
        }));
        log('INFO', '📡 Subscribed to allFills stream (ALL coins, no filtering)');
        break;
        
      case 'subscriptionUpdate':
        log('INFO', '✅ Subscription confirmed', message);
        break;
        
      case 'allFills':
        lastHeartbeat = Date.now();
        if (message.fills && Array.isArray(message.fills)) {
          processFillsBatch(message.fills);
        }
        break;
        
      case 'ping':
        // Respond to keep connection alive
        ws?.send(JSON.stringify({ type: 'pong' }));
        lastHeartbeat = Date.now();
        break;
        
      case 'error':
        log('ERROR', 'Hydromancer error', { message: message.message || message.error });
        errors++;
        break;
        
      default:
        // Ignore unknown message types
        break;
    }
  } catch (err) {
    log('ERROR', 'Failed to parse WebSocket message', { error: err, data: data.toString().slice(0, 200) });
    errors++;
  }
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  
  const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(1.5, reconnectAttempts), MAX_RECONNECT_DELAY_MS);
  log('INFO', `🔌 Connecting to Hydromancer...`, { attempt: reconnectAttempts + 1, delay: `${delay}ms` });
  
  ws = new WebSocket(WEBSOCKET_URL);
  
  ws.on('open', () => {
    log('INFO', '🔓 WebSocket opened, authenticating...');
    
    // Authenticate with API key (required per Hydromancer docs)
    if (HYDROMANCER_API_KEY) {
      ws?.send(JSON.stringify({
        type: 'auth',
        apiKey: HYDROMANCER_API_KEY
      }));
    } else {
      log('WARN', '⚠️ No HYDROMANCER_API_KEY set - authentication may fail');
    }
  });
  
  ws.on('message', handleMessage);
  
  ws.on('error', (err) => {
    log('ERROR', 'WebSocket error', { error: err.message });
    errors++;
  });
  
  ws.on('close', (code, reason) => {
    isConnected = false;
    log('WARN', `🔌 WebSocket closed`, { code, reason: reason.toString() });
    
    // Flush any remaining fills
    flushFillBuffer();
    
    // Reconnect with exponential backoff
    reconnectAttempts++;
    const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(1.5, reconnectAttempts), MAX_RECONNECT_DELAY_MS);
    
    log('INFO', `Reconnecting in ${Math.round(delay / 1000)}s...`);
    setTimeout(connect, delay);
  });
}

// =============================================================================
// Health Monitoring
// =============================================================================

function startHealthMonitor(): void {
  setInterval(() => {
    const now = Date.now();
    const timeSinceHeartbeat = now - lastHeartbeat;
    
    // Check for stale connection
    if (isConnected && timeSinceHeartbeat > STALE_CONNECTION_THRESHOLD_MS) {
      log('WARN', '⚠️ Stale connection detected, forcing reconnect', {
        timeSinceHeartbeat: `${Math.round(timeSinceHeartbeat / 1000)}s`
      });
      ws?.close();
    }
    
    // Log stats periodically
    log('INFO', '📊 Health check', {
      connected: isConnected,
      fills_processed: fillsProcessed,
      fills_inserted: fillsInserted,
      buffer_size: fillBuffer.length,
      errors,
      reconnect_attempts: reconnectAttempts,
      uptime: `${Math.round((now - startTime) / 1000 / 60)}min`
    });
  }, HEARTBEAT_CHECK_INTERVAL_MS);
}

// =============================================================================
// Graceful Shutdown
// =============================================================================

function shutdown(signal: string): void {
  log('INFO', `Received ${signal}, shutting down gracefully...`);
  
  // Flush remaining fills
  if (fillBuffer.length > 0) {
    log('INFO', `Flushing ${fillBuffer.length} remaining fills...`);
    flushFillBuffer().then(() => {
      ws?.close();
      process.exit(0);
    });
  } else {
    ws?.close();
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// =============================================================================
// Main
// =============================================================================

const startTime = Date.now();

async function main(): Promise<void> {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║     Hydromancer All Fills WebSocket Client                    ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
  
  // Validate environment
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    log('ERROR', 'Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  
  if (!HYDROMANCER_API_KEY) {
    log('WARN', 'HYDROMANCER_API_KEY not set - some features may not work');
  }
  
  log('INFO', 'Configuration', {
    supabase_url: SUPABASE_URL.slice(0, 30) + '...',
    filtering: 'NONE - storing ALL fills',
    has_api_key: !!HYDROMANCER_API_KEY
  });
  
  // Initialize Supabase client
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  });
  
  // Test Supabase connection
  try {
    const { count, error } = await supabase
      .from('fills')
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      log('ERROR', 'Failed to connect to Supabase', { error: error.message });
      process.exit(1);
    }
    
    log('INFO', `✅ Connected to Supabase (${count ?? 0} existing fills)`);
  } catch (err) {
    log('ERROR', 'Supabase connection error', { error: err });
    process.exit(1);
  }
  
  // Start health monitoring
  startHealthMonitor();
  
  // Connect to WebSocket
  connect();
  
  log('INFO', '🚀 Hydromancer fills processor started');
}

main().catch((err) => {
  log('ERROR', 'Fatal error', { error: err });
  process.exit(1);
});
