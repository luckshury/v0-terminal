import { NextResponse } from 'next/server'

// Direct Hyperliquid API - no authentication needed
const HYPERLIQUID_API_URL = 'https://api.hyperliquid.xyz/info'

export async function GET() {
  try {
    // Fetch all mid prices directly from Hyperliquid public API
    const response = await fetch(HYPERLIQUID_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'allMids',
      }),
      // Cache for 5 seconds to reduce load
      next: { revalidate: 5 },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Hyperliquid API error:', errorText)
      return NextResponse.json(
        { error: `Failed to fetch tickers: ${response.status}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    
    console.log(`[Tickers] Fetched ${Object.keys(data).length} tickers from Hyperliquid`)
    
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in tickers API route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
