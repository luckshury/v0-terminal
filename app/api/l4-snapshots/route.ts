import { NextResponse } from 'next/server'
import { decode } from '@msgpack/msgpack'

// Hydromancer disabled - no points remaining
const HYDROMANCER_ENABLED = false;

const HYDROMANCER_API_URL = 'https://api.hydromancer.xyz'
const API_KEY = process.env.HYDROMANCER_API_KEY || 'sk_nNhuLkdGdW5sxnYec33C2FBPzLjXBnEd'

// Cache configuration
const CACHE_DURATION_MS = 5 * 60 * 1000 // 5 minutes (matches Hydromancer rate limit window)
let cachedData: any = null
let cacheTimestamp: number = 0

export async function GET() {
  if (!HYDROMANCER_ENABLED) {
    return NextResponse.json(
      { error: 'Hydromancer API disabled - no points remaining' },
      { status: 503 }
    )
  }

  try {
    // Check if we have valid cached data
    const now = Date.now()
    const cacheAge = now - cacheTimestamp
    
    if (cachedData && cacheAge < CACHE_DURATION_MS) {
      console.log(`[L4] Returning cached data (age: ${Math.floor(cacheAge / 1000)}s)`)
      return NextResponse.json({
        success: true,
        data: cachedData,
        cached: true,
        cacheAge: Math.floor(cacheAge / 1000),
        cacheExpiresIn: Math.floor((CACHE_DURATION_MS - cacheAge) / 1000)
      })
    }
    
    console.log('[L4] Cache miss or expired, fetching fresh data from Hydromancer...')
    const url = `${HYDROMANCER_API_URL}/info`
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        type: 'l4Snapshots'
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[L4] API Error:', response.status, errorText)
      return NextResponse.json(
        { error: `API Error: ${response.statusText}`, details: errorText },
        { status: response.status }
      )
    }

    console.log('[L4] Response headers:', Object.fromEntries(response.headers.entries()))

    // IMPORTANT: fetch() automatically decompresses zstd when Content-Encoding: zstd is present
    // So the data we receive is already decompressed msgpack binary
    const buffer = await response.arrayBuffer()
    console.log(`[L4] Received ${(buffer.byteLength / 1024 / 1024).toFixed(2)}MB of data`)
    
    // Decode msgpack directly (data is already decompressed by fetch)
    console.log('[L4] Decoding msgpack...')
    const data = decode(new Uint8Array(buffer)) as any
    
    // Validate format: [height, markets_data]
    if (!Array.isArray(data) || data.length < 2) {
      console.error('[L4] Invalid data format:', data)
      return NextResponse.json(
        { error: 'Invalid L4 snapshot format', details: 'Expected [height, markets]' },
        { status: 500 }
      )
    }

    console.log('[L4] Successfully decoded L4 data')
    
    // Cache the decoded data
    cachedData = data
    cacheTimestamp = Date.now()
    console.log('[L4] Data cached for 5 minutes')
    
    // Return the decoded data as JSON
    return NextResponse.json({
      success: true,
      data,
      cached: false,
      cacheAge: 0,
      cacheExpiresIn: 300 // 5 minutes
    })
  } catch (error) {
    console.error('[L4] Error fetching L4 snapshots:', error)
    return NextResponse.json(
      { error: 'Failed to fetch L4 snapshots', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

