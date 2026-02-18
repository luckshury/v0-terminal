import { NextResponse } from 'next/server'

// Hydromancer disabled - no points remaining
const HYDROMANCER_ENABLED = false;

const HYDROMANCER_API_URL = 'https://api.hydromancer.xyz'
const API_KEY = process.env.HYDROMANCER_API_KEY || 'sk_nNhuLkdGdW5sxnYec33C2FBPzLjXBnEd'

export async function GET() {
  if (!HYDROMANCER_ENABLED) {
    return NextResponse.json(
      { error: 'Hydromancer API disabled - no points remaining' },
      { status: 503 }
    )
  }

  try {
    // Test L4 orderbook access by checking the l4SnapshotTimestamp endpoint
    // This is the recommended way to verify access per Hydromancer docs
    const url = `${HYDROMANCER_API_URL}/info`
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        type: 'l4SnapshotTimestamp'
      })
    })

    const statusCode = response.status
    const responseText = await response.text()
    
    let data
    try {
      data = JSON.parse(responseText)
    } catch (e) {
      // If response is not JSON, return the raw text
      return NextResponse.json({
        hasAccess: false,
        error: 'Invalid API response',
        statusCode,
        rawResponse: responseText.substring(0, 500)
      }, { status: 500 })
    }

    if (statusCode === 401) {
      return NextResponse.json({
        hasAccess: false,
        error: 'Authentication failed',
        message: 'The API key is invalid or expired. Please check your Hydromancer API key.',
        statusCode,
        details: data,
        apiKeyUsed: API_KEY ? `${API_KEY.substring(0, 10)}...` : 'none',
        recommendation: 'Set HYDROMANCER_API_KEY environment variable with a valid API key'
      }, { status: 401 })
    }

    if (statusCode === 403) {
      return NextResponse.json({
        hasAccess: false,
        error: 'Permission denied',
        message: 'Your API key does not have access to L4 orderbook snapshots',
        statusCode,
        details: data,
        recommendation: 'Contact Hydromancer support (support@hydromancer.xyz) to request L4 orderbook access'
      }, { status: 403 })
    }

    if (!response.ok) {
      return NextResponse.json({
        hasAccess: false,
        error: `API Error: ${response.statusText}`,
        statusCode,
        details: data
      }, { status: statusCode })
    }

    return NextResponse.json({
      hasAccess: true,
      message: 'You have access to L4 orderbook snapshots!',
      statusCode,
      sampleData: data
    })
  } catch (error) {
    console.error('Error checking L4 orderbook access:', error)
    return NextResponse.json({
      hasAccess: false,
      error: 'Failed to check access',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

