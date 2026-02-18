// Fetch Trader Snapshots Script
// 
// This script fetches ALL perpetual market snapshots from Hydromancer
// and stores the parsed data in Supabase.
// 
// Run every 10 minutes via cron:
//   0,10,20,30,40,50 * * * * cd /path/to/project && npx tsx scripts/fetch-trader-snapshots.ts
// 
// Or with pm2:
//   pm2 start scripts/fetch-trader-snapshots.ts --cron "0,10,20,30,40,50 * * * *"

import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { decode } from '@msgpack/msgpack'
import { decompress } from 'fzstd'

// Configuration
const HYDROMANCER_API_URL = 'https://api.hydromancer.xyz/info'
const HYDROMANCER_API_KEY = process.env.HYDROMANCER_API_KEY || 'sk_nNhuLkdGdW5sxnYec33C2FBPzLjXBnEd'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials!')
  console.error('   Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

interface TraderSnapshot {
  snapshot_id: string
  coin: string
  timestamp: string
  long_count: number
  short_count: number
  total_traders: number
  long_short_ratio: number
  long_notional: number
  short_notional: number
}

interface PerpPosition {
  snapshot_id: string
  market: string
  address: string
  size: number
  notional: number
  entry_price: number
  leverage_type: number
  leverage: number
  liquidation_price: number | null
  account_value: number | null
  funding_pnl: number
}

// Minimum notional value to store (set to 0 to store ALL positions)
const MIN_POSITION_NOTIONAL = 0 // Store all positions

// Only store positions for these markets (to manage storage)
const MARKETS_TO_STORE = new Set(['BTC', 'ETH', 'HYPE'])

// Parse position data and count longs/shorts
function parsePositions(positions: any[], addresses: any[], snapshotId: string, market: string): {
  longCount: number
  shortCount: number
  longNotional: number
  shortNotional: number
  whalePositions: PerpPosition[]
} {
  let longCount = 0
  let shortCount = 0
  let longNotional = 0
  let shortNotional = 0
  const whalePositions: PerpPosition[] = []

  if (Array.isArray(positions)) {
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i]
      if (Array.isArray(pos) && pos.length >= 2) {
        const size = Number(pos[0])
        const notional = Math.abs(Number(pos[1]))

        if (size > 0) {
          longCount++
          longNotional += notional
        } else if (size < 0) {
          shortCount++
          shortNotional += notional
        }

        // Store all positions with valid addresses
        if (notional >= MIN_POSITION_NOTIONAL && addresses && addresses[i]) {
          whalePositions.push({
            snapshot_id: snapshotId,
            market: String(market),
            address: String(addresses[i]),
            size: size,
            notional: notional,
            entry_price: Number(pos[3]) || 0,
            leverage_type: Number(pos[4]) || 0,
            leverage: Number(pos[5]) || 1,
            liquidation_price: pos[6] ? Number(pos[6]) : null,
            account_value: pos[7] ? Number(pos[7]) : null,
            funding_pnl: Number(pos[2]) || 0,
          })
        }
      }
    }
  }

  return { longCount, shortCount, longNotional, shortNotional, whalePositions }
}

async function fetchAndStoreSnapshots(): Promise<void> {
  const startTime = Date.now()
  console.log('\n📊 Fetching trader snapshots from Hydromancer...')
  console.log(`   Time: ${new Date().toISOString()}`)

  try {
    // Fetch ALL markets in one batch
    const response = await fetch(HYDROMANCER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HYDROMANCER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'perpSnapshots',
        market_names: ['ALL'],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`❌ Hydromancer API error: ${response.status}`)
      console.error(`   ${errorText}`)
      
      if (response.status === 429) {
        console.log('⏳ Rate limited - will retry on next scheduled run')
      }
      return
    }

    const arrayBuffer = await response.arrayBuffer()
    const binaryData = new Uint8Array(arrayBuffer)
    const payloadFormat = response.headers.get('x-payload-format')

    console.log(`   Payload format: ${payloadFormat}`)
    console.log(`   Downloaded: ${(binaryData.length / 1024 / 1024).toFixed(2)} MB`)

    const timestamp = new Date().toISOString()
    // Generate a unique fetch ID based on timestamp (ensures each fetch creates new rows)
    const fetchId = Date.now().toString(36)
    const snapshots: TraderSnapshot[] = []
    const allWhalePositions: PerpPosition[] = []

    if (payloadFormat === 'multi-zstd') {
      // Multiple markets format: [count][len1][zstd1][len2][zstd2]...
      const dataView = new DataView(arrayBuffer)
      const count = dataView.getUint32(0, true) // little-endian
      let offset = 4

      console.log(`   Processing ${count} markets...`)

      for (let i = 0; i < count; i++) {
        const length = dataView.getUint32(offset, true)
        offset += 4

        try {
          const zstdData = binaryData.slice(offset, offset + length)
          const decompressed = decompress(zstdData)
          const data = decode(decompressed) as any[]

          if (Array.isArray(data) && data.length >= 4) {
            const [snapshotId, market, positions, addresses] = data
            const uniqueSnapshotId = `${fetchId}_${snapshotId}`
            const { longCount, shortCount, longNotional, shortNotional, whalePositions } = 
              parsePositions(positions, addresses, uniqueSnapshotId, market)
            
            const totalTraders = longCount + shortCount
            const ratio = shortCount > 0 ? longCount / shortCount : longCount > 0 ? 999.99 : 1

            // Use fetchId + snapshotId to ensure uniqueness per fetch
            snapshots.push({
              snapshot_id: uniqueSnapshotId,
              coin: String(market),
              timestamp,
              long_count: longCount,
              short_count: shortCount,
              total_traders: totalTraders,
              long_short_ratio: Number(ratio.toFixed(4)),
              long_notional: longNotional,
              short_notional: shortNotional,
            })

            // Only collect positions for specific markets (BTC, ETH, HYPE)
            if (MARKETS_TO_STORE.has(String(market))) {
              allWhalePositions.push(...whalePositions)
            }
          }
        } catch (e) {
          // Skip malformed market data
        }

        offset += length
      }
    } else {
      // Single market response
      try {
        let decompressed: Uint8Array
        try {
          decompressed = decompress(binaryData)
        } catch {
          decompressed = binaryData
        }
        
        const data = decode(decompressed) as any[]

        if (Array.isArray(data) && data.length >= 4) {
          const [snapshotId, market, positions, addresses] = data
          const uniqueSnapshotId = `${fetchId}_${snapshotId}`
          const { longCount, shortCount, longNotional, shortNotional, whalePositions } = 
            parsePositions(positions, addresses, uniqueSnapshotId, market)
          
          const totalTraders = longCount + shortCount
          const ratio = shortCount > 0 ? longCount / shortCount : longCount > 0 ? 999.99 : 1

          // Use fetchId + snapshotId to ensure uniqueness per fetch
          snapshots.push({
            snapshot_id: uniqueSnapshotId,
            coin: String(market),
            timestamp,
            long_count: longCount,
            short_count: shortCount,
            total_traders: totalTraders,
            long_short_ratio: Number(ratio.toFixed(4)),
            long_notional: longNotional,
            short_notional: shortNotional,
          })

          // Only collect positions for specific markets (BTC, ETH, HYPE)
          if (MARKETS_TO_STORE.has(String(market))) {
            allWhalePositions.push(...whalePositions)
          }
        }
      } catch (e) {
        console.error('❌ Failed to parse single market response:', e)
      }
    }

    if (snapshots.length === 0) {
      console.log('⚠️  No snapshots parsed')
      return
    }

    console.log(`   Parsed ${snapshots.length} markets`)

    // Batch insert into Supabase (upsert to handle duplicates)
    const { error } = await supabase
      .from('trader_snapshots')
      .upsert(snapshots, {
        onConflict: 'snapshot_id,coin',
        ignoreDuplicates: true,
      })

    if (error) {
      console.error('❌ Supabase insert error:', error.message)
      return
    }

    console.log(`✅ Stored ${snapshots.length} snapshots`)

    // Insert all positions
    if (allWhalePositions.length > 0) {
      console.log(`\n📊 Storing ${allWhalePositions.length} positions...`)
      
      // Insert in batches of 1000 to avoid timeout
      const BATCH_SIZE = 1000
      let insertedCount = 0
      
      for (let i = 0; i < allWhalePositions.length; i += BATCH_SIZE) {
        const batch = allWhalePositions.slice(i, i + BATCH_SIZE)
        
        const { error: posError } = await supabase
          .from('perp_positions')
          .upsert(batch, {
            onConflict: 'snapshot_id,market,address',
            ignoreDuplicates: true,
          })
        
        if (posError) {
          console.error(`❌ Positions batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, posError.message)
        } else {
          insertedCount += batch.length
        }
      }
      
      console.log(`✅ Stored ${insertedCount} positions`)
      
      // Log top positions by size
      const topPositions = allWhalePositions
        .sort((a, b) => b.notional - a.notional)
        .slice(0, 5)
      
      console.log('\n   Top 5 positions by notional:')
      for (const w of topPositions) {
        const side = w.size > 0 ? '🟢 LONG' : '🔴 SHORT'
        console.log(`   - ${w.market} ${side}: $${w.notional.toLocaleString()} @ $${w.entry_price.toLocaleString()}`)
        console.log(`     ${w.address.slice(0, 10)}...${w.address.slice(-6)}`)
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`\n⏱️  Total time: ${elapsed}s`)

    // Log some stats
    const topMarkets = snapshots
      .sort((a, b) => b.total_traders - a.total_traders)
      .slice(0, 5)
    
    console.log('\n   Top 5 markets by trader count:')
    for (const m of topMarkets) {
      console.log(`   - ${m.coin}: ${m.total_traders} traders (L/S: ${m.long_short_ratio})`)
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error)
  }
}

// Run the script
fetchAndStoreSnapshots()
  .then(() => {
    console.log('\n✨ Script completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('💥 Script failed:', error)
    process.exit(1)
  })

