// Supabase Edge Function: Fetch Trader Snapshots
// Fetches ALL perpetual market snapshots from Hydromancer and stores in Supabase
// Stores both aggregate counts AND individual whale positions
// Run every 10 minutes via pg_cron

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"
import { decode } from "npm:@msgpack/msgpack@3"
import { decompress } from "npm:fzstd@0.1.1"

// Configuration
const HYDROMANCER_API_URL = "https://api.hydromancer.xyz/info"
const HYDROMANCER_API_KEY = Deno.env.get("HYDROMANCER_API_KEY") || ""

// Minimum notional value to store (set to 0 to store ALL positions)
const MIN_POSITION_NOTIONAL = 0 // Store all positions

// Only store positions for these markets (to manage storage)
const MARKETS_TO_STORE = new Set(['BTC', 'ETH', 'HYPE'])

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

// Parse position data, count longs/shorts, and extract whale positions
function parsePositions(
  positions: unknown[],
  addresses: unknown[],
  snapshotId: string,
  market: string
): {
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

async function fetchAndStoreSnapshots(): Promise<{
  success: boolean
  marketsProcessed: number
  whalePositionsStored: number
  error?: string
}> {
  const startTime = Date.now()
  console.log("\n📊 Fetching trader snapshots from Hydromancer...")
  console.log(`   Time: ${new Date().toISOString()}`)

  // Initialize Supabase client
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Fetch ALL markets in one batch
    const response = await fetch(HYDROMANCER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HYDROMANCER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "perpSnapshots",
        market_names: ["ALL"],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`❌ Hydromancer API error: ${response.status}`)
      console.error(`   ${errorText}`)

      if (response.status === 429) {
        return { success: false, marketsProcessed: 0, whalePositionsStored: 0, error: "Rate limited" }
      }
      return { success: false, marketsProcessed: 0, whalePositionsStored: 0, error: `API error: ${response.status}` }
    }

    const arrayBuffer = await response.arrayBuffer()
    const binaryData = new Uint8Array(arrayBuffer)
    const payloadFormat = response.headers.get("x-payload-format")

    console.log(`   Payload format: ${payloadFormat}`)
    console.log(`   Downloaded: ${(binaryData.length / 1024 / 1024).toFixed(2)} MB`)

    const timestamp = new Date().toISOString()
    // Generate a unique fetch ID based on timestamp (ensures each fetch creates new rows)
    const fetchId = Date.now().toString(36)
    const snapshots: TraderSnapshot[] = []
    const allWhalePositions: PerpPosition[] = []

    if (payloadFormat === "multi-zstd") {
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
          const data = decode(decompressed) as unknown[]

          if (Array.isArray(data) && data.length >= 4) {
            const [snapshotId, market, positions, addresses] = data
            const uniqueSnapshotId = `${fetchId}_${snapshotId}`
            const { longCount, shortCount, longNotional, shortNotional, whalePositions } =
              parsePositions(positions as unknown[], addresses as unknown[], uniqueSnapshotId, String(market))

            const totalTraders = longCount + shortCount
            const ratio =
              shortCount > 0 ? longCount / shortCount : longCount > 0 ? 999.99 : 1

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
        } catch {
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

        const data = decode(decompressed) as unknown[]

        if (Array.isArray(data) && data.length >= 4) {
          const [snapshotId, market, positions, addresses] = data
          const uniqueSnapshotId = `${fetchId}_${snapshotId}`
          const { longCount, shortCount, longNotional, shortNotional, whalePositions } =
            parsePositions(positions as unknown[], addresses as unknown[], uniqueSnapshotId, String(market))

          const totalTraders = longCount + shortCount
          const ratio =
            shortCount > 0 ? longCount / shortCount : longCount > 0 ? 999.99 : 1

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
        console.error("❌ Failed to parse single market response:", e)
      }
    }

    if (snapshots.length === 0) {
      console.log("⚠️  No snapshots parsed")
      return { success: false, marketsProcessed: 0, whalePositionsStored: 0, error: "No snapshots parsed" }
    }

    console.log(`   Parsed ${snapshots.length} markets`)
    console.log(`   Found ${allWhalePositions.length} total positions`)

    // Batch insert trader snapshots into Supabase
    const { error } = await supabase.from("trader_snapshots").upsert(snapshots, {
      onConflict: "snapshot_id,coin",
      ignoreDuplicates: true,
    })

    if (error) {
      console.error("❌ Supabase trader_snapshots insert error:", error.message)
      return { success: false, marketsProcessed: 0, whalePositionsStored: 0, error: error.message }
    }

    console.log(`✅ Stored ${snapshots.length} trader snapshots`)

    // Insert whale positions
    let whalePositionsStored = 0
    if (allWhalePositions.length > 0) {
      // Insert in batches of 1000 to avoid timeout
      const BATCH_SIZE = 1000

      for (let i = 0; i < allWhalePositions.length; i += BATCH_SIZE) {
        const batch = allWhalePositions.slice(i, i + BATCH_SIZE)

        const { error: posError } = await supabase
          .from("perp_positions")
          .upsert(batch, {
            onConflict: "snapshot_id,market,address",
            ignoreDuplicates: true,
          })

        if (posError) {
          console.error(`❌ Whale positions batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, posError.message)
        } else {
          whalePositionsStored += batch.length
        }
      }

      console.log(`✅ Stored ${whalePositionsStored} positions`)

      // Log top positions by size
      const topPositions = allWhalePositions
        .sort((a, b) => b.notional - a.notional)
        .slice(0, 5)

      console.log("\n📊 Top 5 positions by notional:")
      for (const w of topPositions) {
        const side = w.size > 0 ? "🟢 LONG" : "🔴 SHORT"
        console.log(`   - ${w.market} ${side}: $${w.notional.toLocaleString()} @ $${w.entry_price.toLocaleString()}`)
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`\n⏱️  Total time: ${elapsed}s`)

    // Log some stats
    const topMarkets = snapshots
      .sort((a, b) => b.total_traders - a.total_traders)
      .slice(0, 5)

    console.log("\n   Top 5 markets by trader count:")
    for (const m of topMarkets) {
      console.log(`   - ${m.coin}: ${m.total_traders} traders (L/S: ${m.long_short_ratio})`)
    }

    return { success: true, marketsProcessed: snapshots.length, whalePositionsStored }
  } catch (error) {
    console.error("❌ Unexpected error:", error)
    return { success: false, marketsProcessed: 0, whalePositionsStored: 0, error: String(error) }
  }
}

// Main handler
Deno.serve(async (_req) => {
  console.log("🚀 Edge Function invoked: fetch-trader-snapshots")

  const result = await fetchAndStoreSnapshots()

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
    status: result.success ? 200 : 500,
  })
})
