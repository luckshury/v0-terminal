import { NextResponse } from 'next/server'
import WebSocket from 'ws'

const HYDROMANCER_ENABLED = false
const HYDROMANCER_WS_URL = 'wss://api.hydromancer.xyz/ws'
const API_KEY = process.env.HYDROMANCER_API_KEY || 'sk_nNhuLkdGdW5sxnYec33C2FBPzLjXBnEd'

// Asset price data structure
interface AssetPrice {
  coin: string
  oraclePx: number
  markPx: number
  midPx: number
  impactPxBid: number
  impactPxAsk: number
  timestamp: number
}

// Singleton state
let ws: WebSocket | null = null
let isConnected = false
let isConnecting = false
let lastError: string | null = null
let lastMessageTime = Date.now()
let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 10
const RECONNECT_DELAY_BASE = 1000

// Store prices for all subscribed assets
const assetPrices = new Map<string, AssetPrice>()

// Track subscribed coins
const subscribedCoins = new Set<string>()

// Default coins to subscribe to
const DEFAULT_COINS = ['BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'DOGE', 'AVAX', 'LINK', 'SUI', 'ARB']

function log(message: string, data?: any) {
  const timestamp = new Date().toISOString()
  if (data) {
    console.log(`[AssetPrices ${timestamp}] ${message}`, data)
  } else {
    console.log(`[AssetPrices ${timestamp}] ${message}`)
  }
}

function subscribeToCoins(coins: string[]) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    log('Cannot subscribe - WebSocket not open')
    return
  }
  
  for (const coin of coins) {
    if (subscribedCoins.has(coin)) continue
    
    const subscribeMsg = {
      method: 'subscribe',
      subscription: {
        type: 'activeAssetCtx',
        coin: coin
      }
    }
    
    ws.send(JSON.stringify(subscribeMsg))
    subscribedCoins.add(coin)
    log(`Subscribed to ${coin}`)
  }
}

function connect() {
  if (isConnecting || (ws && ws.readyState === WebSocket.OPEN)) {
    return
  }
  
  isConnecting = true
  log('Connecting to Hydromancer WebSocket for asset prices...')
  
  try {
    ws = new WebSocket(HYDROMANCER_WS_URL)
    
    ws.on('open', () => {
      log('WebSocket connected')
      isConnected = true
      isConnecting = false
      reconnectAttempts = 0
      lastError = null
      lastMessageTime = Date.now()
      
      // Authenticate
      ws!.send(JSON.stringify({
        type: 'auth',
        apiKey: API_KEY
      }))
    })
    
    ws.on('message', (data: Buffer) => {
      lastMessageTime = Date.now()
      
      try {
        const msg = JSON.parse(data.toString())
        
        // Handle authentication response
        if (msg.type === 'connected') {
          log('Authenticated successfully')
          // Subscribe to default coins after auth
          subscribeToCoins(DEFAULT_COINS)
          return
        }
        
        // Handle ping
        if (msg.type === 'ping') {
          ws!.send(JSON.stringify({ type: 'pong' }))
          return
        }
        
        // Handle subscription confirmation
        if (msg.type === 'subscriptionUpdate') {
          log('Subscription update:', msg)
          return
        }
        
        // Handle activeAssetCtx data
        if (msg.channel === 'activeAssetCtx' && msg.data) {
          const { coin, ctx } = msg.data
          
          if (coin && ctx) {
            const priceData: AssetPrice = {
              coin,
              oraclePx: parseFloat(ctx.oraclePx) || 0,
              markPx: parseFloat(ctx.markPx) || 0,
              midPx: parseFloat(ctx.midPx) || 0,
              impactPxBid: ctx.impactPxs ? parseFloat(ctx.impactPxs[0]) || 0 : 0,
              impactPxAsk: ctx.impactPxs ? parseFloat(ctx.impactPxs[1]) || 0 : 0,
              timestamp: Date.now()
            }
            
            assetPrices.set(coin, priceData)
          }
        }
        
        // Handle errors
        if (msg.type === 'error') {
          log('WebSocket error message:', msg)
          lastError = msg.message || 'Unknown error'
        }
        
      } catch (e) {
        log('Error parsing message:', e)
      }
    })
    
    ws.on('close', (code, reason) => {
      log(`WebSocket closed: ${code} - ${reason}`)
      isConnected = false
      isConnecting = false
      ws = null
      subscribedCoins.clear()
      
      // Attempt reconnect
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = RECONNECT_DELAY_BASE * Math.pow(2, reconnectAttempts)
        reconnectAttempts++
        log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`)
        setTimeout(connect, delay)
      } else {
        lastError = 'Max reconnection attempts reached'
        log(lastError)
      }
    })
    
    ws.on('error', (error) => {
      log('WebSocket error:', error.message)
      lastError = error.message
      isConnecting = false
    })
    
  } catch (error) {
    log('Failed to create WebSocket:', error)
    lastError = error instanceof Error ? error.message : 'Connection failed'
    isConnecting = false
  }
}

// Initialize connection on module load only when enabled
if (HYDROMANCER_ENABLED) {
  connect()

  // Heartbeat to keep connection alive and detect stale connections
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Check if we haven't received a message in 30 seconds
      if (Date.now() - lastMessageTime > 30000) {
        log('Connection appears stale, reconnecting...')
        ws.close()
      }
    } else if (!isConnecting && !isConnected) {
      log('Connection lost, attempting reconnect...')
      reconnectAttempts = 0
      connect()
    }
  }, 10000)
} else {
  log('Hydromancer asset price stream disabled')
}

export async function GET(request: Request) {
  if (!HYDROMANCER_ENABLED) {
    return NextResponse.json(
      { disabled: true, reason: 'Hydromancer asset price stream disabled' },
      { status: 503 }
    )
  }

  // Check if specific coins are requested
  const { searchParams } = new URL(request.url)
  const requestedCoins = searchParams.get('coins')?.split(',').filter(Boolean) || []
  
  // Subscribe to any new requested coins
  if (requestedCoins.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
    const newCoins = requestedCoins.filter(c => !subscribedCoins.has(c))
    if (newCoins.length > 0) {
      subscribeToCoins(newCoins)
    }
  }
  
  // Build response with all available prices
  const prices: Record<string, AssetPrice> = {}
  assetPrices.forEach((price, coin) => {
    prices[coin] = price
  })
  
  return NextResponse.json({
    isConnected,
    prices,
    subscribedCoins: Array.from(subscribedCoins),
    lastMessageAgo: Date.now() - lastMessageTime,
    totalAssets: assetPrices.size,
    error: lastError
  })
}

// POST endpoint to subscribe to additional coins
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { coins } = body
    
    if (!Array.isArray(coins) || coins.length === 0) {
      return NextResponse.json({ error: 'coins array required' }, { status: 400 })
    }
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      subscribeToCoins(coins)
      return NextResponse.json({ 
        success: true, 
        subscribedCoins: Array.from(subscribedCoins) 
      })
    } else {
      return NextResponse.json({ 
        error: 'WebSocket not connected',
        isConnected 
      }, { status: 503 })
    }
  } catch (error) {
    return NextResponse.json({ 
      error: 'Invalid request body' 
    }, { status: 400 })
  }
}







