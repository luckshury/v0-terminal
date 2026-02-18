'use client'

import { MinuteAggregatesWidget } from '@/components/minute-aggregates-widget'

export default function FlowsPage() {
  return (
    <div className="min-h-screen bg-zinc-950 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">Live Position Flows</h1>
          <p className="text-zinc-500 mt-1">Real-time 1-minute aggregated position data from Hyperliquid</p>
        </div>
        
        <MinuteAggregatesWidget />
      </div>
    </div>
  )
}

