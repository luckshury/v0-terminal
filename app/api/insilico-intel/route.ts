import { NextRequest, NextResponse } from 'next/server';
import WebSocket from 'ws';

const HYDROMANCER_ENABLED = false;

const BUILDER_ADDRESS = '0x2868fc0d9786a740b491577a43502259efa78a39';

// Types for Builder Fills (from Hydromancer docs)
interface BuilderFillDetails {
  coin: string;
  px: string;              // price
  sz: string;              // size
  side: 'B' | 'A';        // B=buy, A=sell
  time: number;           // timestamp (ms)
  startPosition: string;  // position before fill
  dir: string;            // direction
  closedPnl: string;      // realized PnL
  hash: string;           // fill hash
  oid: number;            // order ID
  crossed: boolean;       // was crossed
  fee: string;            // fee amount
  tid: number;            // trade ID
  cloid?: string;         // client order ID (optional)
  builderFee?: string;    // builder fee (optional)
  feeToken: string;       // fee token
  builder: string;        // builder address
  twapId?: number | null; // null if not a twap
}

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

// Types for Builder Order Updates
interface BuilderOrderUpdate {
  time: number;
  user: string;
  hash: string;
  builder?: {
    b: string;
    f: number;
  };
  status: string;
  order: {
    coin: string;
    side: 'B' | 'A';
    limitPx: string;
    sz: string;
    oid: number;
    timestamp: number;
    orderType: string;
    origSz?: string;
    tif?: string;
    cloid?: string;
  };
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

// Global state for persistent WebSocket connections
let ws: WebSocket | null = null;
let fills: ProcessedFill[] = [];
let orders: ProcessedOrderUpdate[] = [];
let isConnected = false;
let reconnectTimeout: NodeJS.Timeout | null = null;
const MAX_ITEMS = 2500; // Store 2500 of each type

function connectWebSocket() {
  if (!HYDROMANCER_ENABLED) {
    console.log('Hydromancer Insilico Intel streams disabled');
    return;
  }
  if (ws?.readyState === WebSocket.OPEN) {
    console.log('✅ Insilico Intel WebSocket already connected');
    isConnected = true;
    return;
  }

  // Clean up existing connection if any
  if (ws) {
    try {
      ws.removeAllListeners();
      if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    } catch (e) {
      console.error('Error cleaning up old WebSocket:', e);
    }
    ws = null;
  }

  console.log('🔌 Connecting to Hydromancer WebSocket for Insilico Intel...');
  isConnected = false;
  
  let connectionTimeout: NodeJS.Timeout | null = null;
  
  try {
    ws = new WebSocket('wss://api.hydromancer.xyz/ws');

    // Add connection timeout
    connectionTimeout = setTimeout(() => {
      if (ws && ws.readyState !== WebSocket.OPEN && !isConnected) {
        console.error('❌ Insilico Intel WebSocket connection timeout');
        try {
          ws.close();
        } catch (e) {
          console.error('Error closing timed out connection:', e);
        }
      }
    }, 10000); // 10 second timeout

    ws.on('open', () => {
      if (connectionTimeout) clearTimeout(connectionTimeout);
      console.log('✅ Insilico Intel WebSocket opened, authenticating...');
      try {
        ws?.send(JSON.stringify({
          type: 'auth',
          apiKey: 'sk_nNhuLkdGdW5sxnYec33C2FBPzLjXBnEd'
        }));
      } catch (e) {
        console.error('❌ Error sending auth:', e);
        isConnected = false;
      }
    });

    ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'connected') {
        console.log('✅ Insilico Intel authenticated! Subscribing to builder streams...');
        console.log(`📋 Builder address: ${BUILDER_ADDRESS}`);
        isConnected = true;
        
        try {
          // Subscribe to builderFills
          const fillsSub = {
            type: 'subscribe',
            subscription: {
              type: 'builderFills',
              builder: BUILDER_ADDRESS
            }
          };
          console.log('📤 Sending builderFills subscription:', JSON.stringify(fillsSub));
          ws?.send(JSON.stringify(fillsSub));
          
          // Subscribe to builderOrderUpdates
          const ordersSub = {
            type: 'subscribe',
            subscription: {
              type: 'builderOrderUpdates',
              builder: BUILDER_ADDRESS
            }
          };
          console.log('📤 Sending builderOrderUpdates subscription:', JSON.stringify(ordersSub));
          ws?.send(JSON.stringify(ordersSub));
          console.log('✅ Insilico Intel subscriptions sent');
        } catch (e) {
          console.error('❌ Error sending subscriptions:', e);
          isConnected = false;
        }
      } else if (msg.type === 'subscriptionUpdate') {
        console.log('📊 Insilico Intel subscription update:', JSON.stringify(msg, null, 2));
        // Ensure we're marked as connected if we receive subscription updates
        if (ws?.readyState === WebSocket.OPEN) {
          isConnected = true;
          console.log('✅ Insilico Intel subscription confirmed, connection active');
        }
      } else if (msg.type === 'error') {
        console.error('❌ Insilico Intel WS Error:', JSON.stringify(msg, null, 2));
        isConnected = false;
      } else if (msg.type === 'builderFills') {
        // builderFills subscription sends messages with type "builderFills"
        console.log(`⚡ Received ${msg.fills?.length || 0} builder fills`);
        // Mark as connected when we receive data
        if (ws?.readyState === WebSocket.OPEN) {
          isConnected = true;
        }
        
        const newFills: ProcessedFill[] = [];
        
        if (msg.fills && Array.isArray(msg.fills)) {
          // Each fill is a tuple: [address, fillDetails]
          msg.fills.forEach((fillTuple: [string, BuilderFillDetails]) => {
            const [userAddress, fillDetails] = fillTuple;
            
            const price = parseFloat(fillDetails.px || '0');
            const amount = parseFloat(fillDetails.sz || '0');
            const value = price * amount;
            const fee = parseFloat(fillDetails.fee || '0');

            const processed: ProcessedFill = {
              id: `fill-${fillDetails.oid}-${fillDetails.time}`,
              user: userAddress,
              coin: fillDetails.coin || 'UNKNOWN',
              side: fillDetails.side,
              price,
              amount,
              value,
              fee,
              timestamp: fillDetails.time,
              hash: fillDetails.hash,
              type: 'fill'
            };

            newFills.push(processed);
          });
        }

        if (newFills.length > 0) {
          fills = [...newFills.reverse(), ...fills].slice(0, MAX_ITEMS);
        }
      } else if (msg.type === 'builderOrderUpdates') {
        console.log(`⚡ Received ${msg.updates?.length || 0} builder order updates`);
        // Mark as connected when we receive data
        if (ws?.readyState === WebSocket.OPEN) {
          isConnected = true;
        }
        
        const newOrders: ProcessedOrderUpdate[] = [];
        
        if (msg.updates && Array.isArray(msg.updates)) {
          msg.updates.forEach((update: BuilderOrderUpdate) => {
            const price = parseFloat(update.order.limitPx || '0');
            const size = parseFloat(update.order.sz || '0');

            const processed: ProcessedOrderUpdate = {
              id: `order-${update.order.oid}-${Date.now()}`,
              user: update.user,
              coin: update.order.coin,
              side: update.order.side,
              price,
              size,
              status: update.status,
              orderType: update.order.orderType,
              timestamp: update.time || update.order.timestamp,
              hash: update.hash,
              oid: update.order.oid,
              type: 'order'
            };

            newOrders.push(processed);
          });
        }

        if (newOrders.length > 0) {
          orders = [...newOrders.reverse(), ...orders].slice(0, MAX_ITEMS);
        }
      } else if (msg.type === 'ping') {
        ws?.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (e) {
      console.error('❌ Insilico Intel parse error:', e);
    }
  });

    ws.on('close', (code, reason) => {
      if (connectionTimeout) clearTimeout(connectionTimeout);
      console.log(`🔌 Insilico Intel WebSocket closed (code: ${code}, reason: ${reason?.toString() || 'unknown'}), will reconnect in 5s...`);
      isConnected = false;
      ws = null;
      
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      reconnectTimeout = setTimeout(() => {
        console.log('🔄 Attempting to reconnect Insilico Intel WebSocket...');
        connectWebSocket();
      }, 5000);
    });

    ws.on('error', (error) => {
      console.error('❌ Insilico Intel WebSocket error:', error.message || error);
      isConnected = false;
      // Don't close here, let the 'close' event handle cleanup
    });
  } catch (e) {
    console.error('❌ Error creating WebSocket:', e);
    isConnected = false;
    if (connectionTimeout) clearTimeout(connectionTimeout);
  }
}

// Initialize WebSocket connection when module loads
if (HYDROMANCER_ENABLED) {
  connectWebSocket();

  // Keep connection alive
  setInterval(() => {
    const currentState = ws?.readyState;
    if (currentState !== WebSocket.OPEN) {
      console.log(`🔄 Insilico Intel WebSocket not open (state: ${currentState}), reconnecting...`);
      isConnected = false;
      connectWebSocket();
    }
  }, 30000);
} else {
  console.log('Hydromancer Insilico Intel streams disabled');
}

// API Route Handler
export async function GET(request: NextRequest) {
  if (!HYDROMANCER_ENABLED) {
    return NextResponse.json(
      { disabled: true, reason: 'Hydromancer builder streams disabled' },
      { status: 503 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get('limit') || '2500');
  
  return NextResponse.json({
    isConnected,
    builder: BUILDER_ADDRESS,
    fills: fills.slice(0, limit),
    orders: orders.slice(0, limit),
    timestamp: Date.now()
  });
}

