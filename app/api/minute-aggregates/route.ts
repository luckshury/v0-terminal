import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const coin = searchParams.get('coin') || 'BTC'
  const limit = parseInt(searchParams.get('limit') || '30')

  try {
    const { data, error } = await supabase
      .from('minute_aggregates')
      .select('*')
      .eq('coin', coin)
      .order('minute_timestamp', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      coin,
      aggregates: data || [],
      timestamp: new Date().toISOString()
    })
  } catch (err) {
    console.error('API error:', err)
    return NextResponse.json(
      { error: 'Failed to fetch minute aggregates' },
      { status: 500 }
    )
  }
}

