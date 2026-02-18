import { NextRequest, NextResponse } from 'next/server'

const BYBIT_API_URL = 'https://api.bybit.com'

// Cache for storing recent requests
const cache = new Map<string, { data: any; timestamp: number }>()
const CACHE_DURATION = 60000 // 1 minute

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const symbol = searchParams.get('symbol') || 'BTCUSDT'
  const interval = searchParams.get('interval') || '60' // 1 hour by default
  const start = searchParams.get('start')
  const end = searchParams.get('end')
  const limit = searchParams.get('limit') || '200'

  // Validate parameters
  if (!symbol) {
    return NextResponse.json(
      { retCode: 400, retMsg: 'Symbol is required' },
      { status: 400 }
    )
  }

  const cacheKey = `${symbol}-${interval}-${start}-${end}-${limit}`
  const cached = cache.get(cacheKey)
  
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json(cached.data)
  }

  try {
    // Build query parameters
    const params = new URLSearchParams({
      category: 'linear',
      symbol: symbol.toUpperCase(),
      interval,
      limit,
    })

    if (start) params.append('start', start)
    if (end) params.append('end', end)

    const url = `${BYBIT_API_URL}/v5/market/kline?${params.toString()}`
    
    // Retry logic for rate limiting
    let lastError: any = null
    const maxRetries = 2
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Wait before retrying (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)))
        }
        
        const response = await fetch(url, {
          headers: {
            'accept': 'application/json',
          },
        })

        if (!response.ok) {
          const errorText = await response.text()
          
          // If it's a rate limit error (429) or server error (503), retry
          if ((response.status === 429 || response.status === 503) && attempt < maxRetries - 1) {
            lastError = { status: response.status, text: errorText }
            continue // Retry
          }
          
          console.error('Bybit API error:', {
            status: response.status,
            symbol,
            interval,
            start,
            end,
            limit,
            url,
            error: errorText
          })
          
          return NextResponse.json(
            { 
              retCode: response.status, 
              retMsg: `Bybit API returned ${response.status}: ${errorText || 'Unknown error'}. ${response.status === 403 ? 'This may indicate the API is blocking requests or requires authentication.' : 'This may be due to rate limiting.'}`
            },
            { status: response.status }
          )
        }

        const result = await response.json()
        
        // Cache the result
        cache.set(cacheKey, { data: result, timestamp: Date.now() })
        
        return NextResponse.json(result)
      } catch (fetchError: any) {
        lastError = fetchError
        if (attempt === maxRetries - 1) {
          throw fetchError
        }
      }
    }
    
    throw lastError
  } catch (error: any) {
    console.error('Error fetching Bybit intraday data:', error)
    return NextResponse.json(
      { retCode: '500', retMsg: error?.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}


