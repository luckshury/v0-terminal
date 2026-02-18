// Fetch Account Value Snapshots Script
// 
// This script fetches account value snapshots from Hydromancer
// and stores individual user positions in Supabase.
// 
// Run every 10 minutes via cron:
//   0,10,20,30,40,50 * * * * cd /path/to/project && npx tsx scripts/fetch-account-snapshots.ts
// 
// Or manually:
//   npx tsx scripts/fetch-account-snapshots.ts

import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { decode } from '@msgpack/msgpack'
import { decompress } from 'fzstd'

// Configuration
const HYDROMANCER_API_URL = 'https://api.hydromancer.xyz/info'
const HYDROMANCER_API_KEY = process.env.HYDROMANCER_API_KEY || ''

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// Only store positions above this threshold to manage storage
const MIN_ACCOUNT_VALUE = 1000 // $1,000 minimum

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials!')
  console.error('   Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables')
  process.exit(1)
}

if (!HYDROMANCER_API_KEY) {
  console.error('❌ Missing HYDROMANCER_API_KEY!')
  console.error('   Set HYDROMANCER_API_KEY in your .env.local file')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

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
async function checkForUpdates(): Promise<{ hasUpdates: boolean; snapshotId: string }> {
  console.log('🔍 Checking for snapshot updates...')
  
  const response = await fetch(HYDROMANCER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HYDROMANCER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'accountValueSnapshotTimestamp' }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Timestamp check failed: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const snapshotId = data.snapshot_id || String(data.timestamp)
  
  // Check if we already have this snapshot
  const { data: existing } = await supabase
    .from('account_value_snapshots')
    .select('snapshot_id')
    .eq('snapshot_id', snapshotId)
    .limit(1)
  
  const hasUpdates = !existing || existing.length === 0
  
  console.log(`   Current snapshot: ${snapshotId}`)
  console.log(`   Has updates: ${hasUpdates}`)
  
  return { hasUpdates, snapshotId }
}

// Parse user positions from the msgpack data
function parseUsers(usersMap: Record<string, any>): {
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
    else if (typeof userData === 'object' && userData.v !== undefined) {
      accountValue = Number(userData.v)
      longNotional = Number(userData.l || 0)
      shortNotional = Number(userData.s || 0)
    }
    else {
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

async function fetchAndStoreSnapshots(): Promise<void> {
  const startTime = Date.now()
  console.log('\n💰 Fetching account value snapshots from Hydromancer...')
  console.log(`   Time: ${new Date().toISOString()}`)

  try {
    // Check for updates first
    const { hasUpdates, snapshotId } = await checkForUpdates()
    
    if (!hasUpdates) {
      console.log('⏭️  No new snapshots - skipping download')
      return
    }

    // Fetch account value snapshots for Hyperliquid USDC
    console.log('\n📥 Downloading snapshot data...')
    
    const response = await fetch(HYDROMANCER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HYDROMANCER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'accountValueSnapshots',
        collateral_tokens: ['hyperliquid:USDC'],
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

    // Decompress and decode
    let decompressed: Uint8Array
    try {
      decompressed = decompress(binaryData)
      console.log(`   Decompressed: ${(decompressed.length / 1024 / 1024).toFixed(2)} MB`)
    } catch {
      // Already decompressed
      decompressed = binaryData
    }

    const data = decode(decompressed) as any

    // Parse the data
    let parsedSnapshotId: string
    let token: string
    let usersMap: Record<string, any>

    // Array format: [snapshot_id, token, users_map]
    if (Array.isArray(data) && data.length >= 3) {
      parsedSnapshotId = String(data[0])
      token = String(data[1])
      usersMap = data[2]
    }
    // Object format: {i, t, u}
    else if (typeof data === 'object' && data.i !== undefined) {
      parsedSnapshotId = String(data.i)
      token = String(data.t)
      usersMap = data.u
    }
    else {
      console.error('❌ Unknown data format:', typeof data)
      return
    }

    console.log(`   Snapshot ID: ${parsedSnapshotId}`)
    console.log(`   Token: ${token}`)
    console.log(`   Total users in snapshot: ${Object.keys(usersMap).length}`)

    // Parse users
    const { users, totalAccountValue, totalLongNotional, totalShortNotional } = parseUsers(usersMap)
    
    console.log(`   Users above $${MIN_ACCOUNT_VALUE}: ${users.length}`)
    console.log(`   Total Account Value: $${totalAccountValue.toLocaleString()}`)
    console.log(`   Total Long Notional: $${totalLongNotional.toLocaleString()}`)
    console.log(`   Total Short Notional: $${totalShortNotional.toLocaleString()}`)

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
      .from('account_value_snapshots')
      .upsert(snapshotMetadata, {
        onConflict: 'snapshot_id',
        ignoreDuplicates: true,
      })

    if (metaError) {
      console.error('❌ Error storing snapshot metadata:', metaError.message)
      return
    }

    console.log('\n📦 Storing user positions...')

    // Store user positions in batches
    const positions: UserPosition[] = users.map(u => ({
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
      
      const { error: posError } = await supabase
        .from('account_value_positions')
        .insert(batch)

      if (posError) {
        console.error(`❌ Error storing positions batch ${i / BATCH_SIZE + 1}:`, posError.message)
      } else {
        insertedCount += batch.length
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`\n✅ Stored ${insertedCount} positions in ${elapsed}s`)

    // Log top traders
    console.log('\n   Top 10 traders by account value:')
    for (const u of users.slice(0, 10)) {
      const shortAddr = `${u.address.slice(0, 6)}...${u.address.slice(-4)}`
      console.log(`   - ${shortAddr}: $${u.accountValue.toLocaleString()} (L: $${u.longNotional.toLocaleString()}, S: $${u.shortNotional.toLocaleString()})`)
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

