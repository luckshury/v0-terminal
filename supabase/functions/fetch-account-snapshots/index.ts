// Supabase Edge Function: Fetch Account Value Snapshots
// Fetches account value snapshots from Hydromancer and stores in Supabase
// Run every 10 minutes via pg_cron

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"
import { decode } from "npm:@msgpack/msgpack@3"
import { decompress } from "npm:fzstd@0.1.1"

// Configuration
const HYDROMANCER_API_URL = "https://api.hydromancer.xyz/info"
const HYDROMANCER_API_KEY = Deno.env.get("HYDROMANCER_API_KEY") || ""
const MIN_ACCOUNT_VALUE = 1000 // Only store accounts > $1,000

interface UserPosition {
  snapshot_id: string
  address: string
  account_value: number
  long_notional: number
  short_notional: number
}

interface SnapshotMetadata {
  snapshot_id: string
  collateral_token: string
  timestamp: string
  total_users: number
  total_account_value: number
  total_long_notional: number
  total_short_notional: number
}

// Check if there are new snapshots available
async function checkForUpdates(supabase: any): Promise<{ hasUpdates: boolean; snapshotId: string }> {
  console.log("🔍 Checking for snapshot updates...")

  const response = await fetch(HYDROMANCER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HYDROMANCER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "accountValueSnapshotTimestamp" }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Timestamp check failed: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const snapshotId = data.snapshot_id || String(data.timestamp)

  // Check if we already have this snapshot
  const { data: existing } = await supabase
    .from("account_value_snapshots")
    .select("snapshot_id")
    .eq("snapshot_id", snapshotId)
    .limit(1)

  const hasUpdates = !existing || existing.length === 0

  console.log(`   Current snapshot: ${snapshotId}`)
  console.log(`   Has updates: ${hasUpdates}`)

  return { hasUpdates, snapshotId }
}

// Parse user positions from the msgpack data
function parseUsers(usersMap: Record<string, unknown>): {
  users: Array<{ address: string; accountValue: number; longNotional: number; shortNotional: number }>
  totalAccountValue: number
  totalLongNotional: number
  totalShortNotional: number
} {
  const users: Array<{ address: string; accountValue: number; longNotional: number; shortNotional: number }> = []
  let totalAccountValue = 0
  let totalLongNotional = 0
  let totalShortNotional = 0

  for (const [address, userData] of Object.entries(usersMap)) {
    let accountValue: number
    let longNotional: number
    let shortNotional: number

    // Array format: [account_value, total_long_notional, total_short_notional]
    if (Array.isArray(userData) && userData.length >= 3) {
      accountValue = Number(userData[0])
      longNotional = Number(userData[1])
      shortNotional = Number(userData[2])
    }
    // Object format: {v, l, s}
    else if (typeof userData === "object" && userData !== null && "v" in userData) {
      const u = userData as { v: number; l?: number; s?: number }
      accountValue = Number(u.v)
      longNotional = Number(u.l || 0)
      shortNotional = Number(u.s || 0)
    } else {
      continue
    }

    totalAccountValue += accountValue
    totalLongNotional += longNotional
    totalShortNotional += shortNotional

    // Only store positions above minimum threshold
    if (accountValue >= MIN_ACCOUNT_VALUE) {
      users.push({
        address,
        accountValue,
        longNotional,
        shortNotional,
      })
    }
  }

  // Sort by account value descending
  users.sort((a, b) => b.accountValue - a.accountValue)

  return { users, totalAccountValue, totalLongNotional, totalShortNotional }
}

async function fetchAndStoreSnapshots(): Promise<{
  success: boolean
  positionsStored: number
  error?: string
}> {
  const startTime = Date.now()
  console.log("\n💰 Fetching account value snapshots from Hydromancer...")
  console.log(`   Time: ${new Date().toISOString()}`)

  // Initialize Supabase client
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Check for updates first
    const { hasUpdates, snapshotId } = await checkForUpdates(supabase)

    if (!hasUpdates) {
      console.log("⏭️  No new snapshots - skipping download")
      return { success: true, positionsStored: 0 }
    }

    // Fetch account value snapshots
    console.log("\n📥 Downloading snapshot data...")

    const response = await fetch(HYDROMANCER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HYDROMANCER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "accountValueSnapshots",
        collateral_tokens: ["hyperliquid:USDC"],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`❌ Hydromancer API error: ${response.status}`)

      if (response.status === 429) {
        return { success: false, positionsStored: 0, error: "Rate limited" }
      }
      return { success: false, positionsStored: 0, error: `API error: ${response.status} - ${errorText}` }
    }

    const arrayBuffer = await response.arrayBuffer()
    const binaryData = new Uint8Array(arrayBuffer)
    const payloadFormat = response.headers.get("x-payload-format")

    console.log(`   Payload format: ${payloadFormat}`)
    console.log(`   Downloaded: ${(binaryData.length / 1024 / 1024).toFixed(2)} MB`)

    // Decompress and decode
    let decompressed: Uint8Array
    try {
      decompressed = decompress(binaryData)
      console.log(`   Decompressed: ${(decompressed.length / 1024 / 1024).toFixed(2)} MB`)
    } catch {
      decompressed = binaryData
    }

    const data = decode(decompressed) as unknown

    // Parse the data
    let parsedSnapshotId: string
    let token: string
    let usersMap: Record<string, unknown>

    // Array format: [snapshot_id, token, users_map]
    if (Array.isArray(data) && data.length >= 3) {
      parsedSnapshotId = String(data[0])
      token = String(data[1])
      usersMap = data[2] as Record<string, unknown>
    }
    // Object format: {i, t, u}
    else if (typeof data === "object" && data !== null && "i" in data) {
      const d = data as { i: string; t: string; u: Record<string, unknown> }
      parsedSnapshotId = String(d.i)
      token = String(d.t)
      usersMap = d.u
    } else {
      console.error("❌ Unknown data format")
      return { success: false, positionsStored: 0, error: "Unknown data format" }
    }

    console.log(`   Snapshot ID: ${parsedSnapshotId}`)
    console.log(`   Token: ${token}`)
    console.log(`   Total users in snapshot: ${Object.keys(usersMap).length}`)

    // Parse users
    const { users, totalAccountValue, totalLongNotional, totalShortNotional } = parseUsers(usersMap)

    console.log(`   Users above $${MIN_ACCOUNT_VALUE}: ${users.length}`)

    // Store snapshot metadata
    const snapshotMetadata: SnapshotMetadata = {
      snapshot_id: parsedSnapshotId,
      collateral_token: token,
      timestamp: new Date().toISOString(),
      total_users: Object.keys(usersMap).length,
      total_account_value: totalAccountValue,
      total_long_notional: totalLongNotional,
      total_short_notional: totalShortNotional,
    }

    const { error: metaError } = await supabase
      .from("account_value_snapshots")
      .upsert(snapshotMetadata, {
        onConflict: "snapshot_id",
        ignoreDuplicates: true,
      })

    if (metaError) {
      console.error("❌ Error storing snapshot metadata:", metaError.message)
      return { success: false, positionsStored: 0, error: metaError.message }
    }

    console.log("\n📦 Storing user positions...")

    // Store user positions in batches
    const positions: UserPosition[] = users.map((u) => ({
      snapshot_id: parsedSnapshotId,
      address: u.address,
      account_value: u.accountValue,
      long_notional: u.longNotional,
      short_notional: u.shortNotional,
    }))

    // Insert in batches of 1000
    const BATCH_SIZE = 1000
    let insertedCount = 0

    for (let i = 0; i < positions.length; i += BATCH_SIZE) {
      const batch = positions.slice(i, i + BATCH_SIZE)

      const { error: posError } = await supabase.from("account_value_positions").insert(batch)

      if (posError) {
        console.error(`❌ Error storing positions batch ${i / BATCH_SIZE + 1}:`, posError.message)
      } else {
        insertedCount += batch.length
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`\n✅ Stored ${insertedCount} positions in ${elapsed}s`)

    return { success: true, positionsStored: insertedCount }
  } catch (error) {
    console.error("❌ Unexpected error:", error)
    return { success: false, positionsStored: 0, error: String(error) }
  }
}

// Main handler
Deno.serve(async (_req) => {
  console.log("🚀 Edge Function invoked: fetch-account-snapshots")

  const result = await fetchAndStoreSnapshots()

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
    status: result.success ? 200 : 500,
  })
})

