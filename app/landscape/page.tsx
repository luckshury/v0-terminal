'use client'

import { Suspense, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import * as THREE from 'three'
import { useLighterWS, LighterMarketData } from '@/hooks/use-lighter-ws'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Zap, WifiOff, RefreshCw, Search, X, TrendingUp, TrendingDown, Flame } from 'lucide-react'
import { cn } from '@/lib/utils'

// Market bar component - extends UP for gainers, DOWN for losers from daily open baseline
function MarketBar({ 
  market, 
  position, 
  onHover,
  onUnhover,
  isHovered,
}: { 
  market: LighterMarketData
  position: [number, number, number]
  onHover: (market: LighterMarketData) => void
  onUnhover: () => void
  isHovered: boolean
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [localHover, setLocalHover] = useState(false)
  
  const dailyChange = market.dailyChange ?? 0
  const absChange = Math.abs(dailyChange)
  const isGainer = dailyChange > 0.1
  const isLoser = dailyChange < -0.1
  
  // Height scaling based on % change magnitude
  const height = useMemo(() => {
    if (absChange < 0.1) return 0.15 // Tiny bar for unchanged
    if (absChange < 1) return 0.3 + absChange * 0.5
    if (absChange < 5) return 0.8 + (absChange - 1) * 0.8
    if (absChange < 10) return 4 + (absChange - 5) * 0.8
    return Math.min(8 + (absChange - 10) * 0.4, 12)
  }, [absChange])
  
  // Position Y - bars extend from y=0 (daily open baseline)
  // Gainers go UP (positive Y), Losers go DOWN (negative Y)
  const targetY = useMemo(() => {
    if (isGainer) return height / 2 // Bar extends upward
    if (isLoser) return -height / 2 // Bar extends downward
    return 0 // Neutral - tiny bar at baseline
  }, [height, isGainer, isLoser])
  
  const color = useMemo(() => {
    if (isGainer) return '#22c55e'
    if (isLoser) return '#ef4444'
    return '#64748b'
  }, [isGainer, isLoser])
  
  const emissiveIntensity = useMemo(() => {
    const baseIntensity = 0.1
    const changeBonus = Math.min(absChange / 20, 0.3)
    return baseIntensity + changeBonus
  }, [absChange])
  
  useFrame((state, delta) => {
    if (meshRef.current) {
      // Smoothly animate height and Y position
      meshRef.current.scale.y = THREE.MathUtils.lerp(meshRef.current.scale.y, height, delta * 4)
      meshRef.current.position.y = THREE.MathUtils.lerp(meshRef.current.position.y, targetY, delta * 4)
      
      // Hover scale effect
      const targetScale = (localHover || isHovered) ? 1.2 : 1
      meshRef.current.scale.x = THREE.MathUtils.lerp(meshRef.current.scale.x, targetScale, delta * 8)
      meshRef.current.scale.z = THREE.MathUtils.lerp(meshRef.current.scale.z, targetScale, delta * 8)
    }
  })
  
  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onPointerOver={(e) => {
          e.stopPropagation()
          setLocalHover(true)
          onHover(market)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          setLocalHover(false)
          onUnhover()
          document.body.style.cursor = 'auto'
        }}
      >
        <boxGeometry args={[0.8, 1, 0.8]} />
        <meshStandardMaterial 
          color={color} 
          emissive={color}
          emissiveIntensity={localHover || isHovered ? 0.5 : emissiveIntensity}
          metalness={0.3}
          roughness={0.4}
        />
      </mesh>
    </group>
  )
}

// Stable position map
const stablePositionMap = new Map<number, [number, number, number]>()
let positionsInitialized = false

function MarketLandscape({ 
  markets,
  onHover,
  onUnhover,
  hoveredMarket,
}: { 
  markets: LighterMarketData[]
  onHover: (market: LighterMarketData) => void
  onUnhover: () => void
  hoveredMarket: LighterMarketData | null
}) {
  const spacing = 2.2
  
  if (!positionsInitialized && markets.length > 0) {
    const sorted = [...markets].sort((a, b) => a.marketId - b.marketId)
    const cols = Math.max(Math.ceil(Math.sqrt(sorted.length * 1.5)), 4)
    
    sorted.forEach((market, i) => {
      const row = Math.floor(i / cols)
      const col = i % cols
      const x = (col - cols / 2) * spacing
      const z = (row - Math.ceil(sorted.length / cols) / 2) * spacing
      stablePositionMap.set(market.marketId, [x, 0, z])
    })
    positionsInitialized = true
  }
  
  markets.forEach((market) => {
    if (!stablePositionMap.has(market.marketId)) {
      const existingCount = stablePositionMap.size
      const cols = Math.max(Math.ceil(Math.sqrt((existingCount + 1) * 1.5)), 4)
      const row = Math.floor(existingCount / cols)
      const col = existingCount % cols
      const x = (col - cols / 2) * spacing
      const z = (row - Math.ceil((existingCount + 1) / cols) / 2) * spacing
      stablePositionMap.set(market.marketId, [x, 0, z])
    }
  })
  
  return (
    <group>
      {markets.map((market) => {
        const position = stablePositionMap.get(market.marketId) || [0, 0, 0]
        return (
          <MarketBar 
            key={market.marketId} 
            market={market} 
            position={position as [number, number, number]}
            onHover={onHover}
            onUnhover={onUnhover}
            isHovered={hoveredMarket?.marketId === market.marketId}
          />
        )
      })}
    </group>
  )
}

function StatsOverlay({ 
  stats,
  isConnected,
  isLoading,
}: { 
  stats: { totalMarkets: number; rising: number; falling: number; totalVolume: number }
  isConnected: boolean
  isLoading: boolean
}) {
  return (
    <div className="absolute top-4 left-4 z-10 font-mono">
      <div className="bg-black/80 backdrop-blur-sm border border-border rounded-lg p-4 min-w-[200px]">
        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
          <div className="w-2 h-2 rounded-full bg-cyan-400" />
          <span className="text-xs font-bold text-cyan-400 tracking-wider">LIGHTER.XYZ</span>
        </div>
        
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-3 font-bold">
          Market Overview
        </div>
        
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Markets</span>
            <span className="text-foreground font-bold">{stats.totalMarkets}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Rising</span>
            <span className="text-green-500 font-bold">{stats.rising}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Falling</span>
            <span className="text-red-500 font-bold">{stats.falling}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Daily Volume</span>
            <span className="text-foreground font-bold">
              ${(stats.totalVolume ?? 0) >= 1e9 
                ? ((stats.totalVolume ?? 0) / 1e9).toFixed(2) + 'B'
                : (stats.totalVolume ?? 0) >= 1e6
                ? ((stats.totalVolume ?? 0) / 1e6).toFixed(2) + 'M'
                : (stats.totalVolume ?? 0).toLocaleString()}
            </span>
          </div>
        </div>
        
        <div className="mt-3 pt-3 border-t border-border flex items-center gap-2 text-[10px]">
          {isConnected ? (
            <>
              <Zap className="h-3 w-3 text-green-500" />
              <span className="text-green-500 font-bold">LIVE</span>
            </>
          ) : isLoading ? (
            <>
              <RefreshCw className="h-3 w-3 text-amber-500 animate-spin" />
              <span className="text-amber-500 font-bold">CONNECTING</span>
            </>
          ) : (
            <>
              <WifiOff className="h-3 w-3 text-red-500" />
              <span className="text-red-500 font-bold">OFFLINE</span>
            </>
          )}
        </div>
      </div>
      
      <div className="bg-black/80 backdrop-blur-sm border border-border rounded-lg p-3 mt-3 min-w-[200px]">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 font-bold">
          Legend
        </div>
        <div className="space-y-1.5 text-[10px]">
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-center">
              <div className="w-3 h-3 rounded-sm bg-green-500" />
              <div className="w-0.5 h-1 bg-muted-foreground/30" />
            </div>
            <span className="text-muted-foreground">↑ Above daily open</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-center">
              <div className="w-0.5 h-1 bg-muted-foreground/30" />
              <div className="w-3 h-3 rounded-sm bg-red-500" />
            </div>
            <span className="text-muted-foreground">↓ Below daily open</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-1 rounded-sm bg-slate-500" />
            <span className="text-muted-foreground">— Unchanged</span>
          </div>
        </div>
        <div className="mt-2 pt-2 border-t border-border text-[9px] text-muted-foreground space-y-1">
          <div>Grid plane = Daily Open (00:00 UTC)</div>
          <div>Bar height = % change magnitude</div>
        </div>
      </div>
    </div>
  )
}

function HoveredInfo({ market }: { market: LighterMarketData | null }) {
  if (!market) return null
  
  const dailyChange = market.dailyChange ?? 0
  const price = market.price ?? 0
  const dailyOpen = market.dailyOpen ?? price // Use actual daily open from candlestick data
  const changeColor = dailyChange > 0 ? 'text-green-500' : dailyChange < 0 ? 'text-red-500' : 'text-muted-foreground'
  
  // Calculate price change in absolute terms from actual open
  const priceChange = price - dailyOpen
  
  return (
    <div className="absolute top-4 right-4 z-10 font-mono">
      <div className="bg-black/90 backdrop-blur-sm border border-border rounded-lg p-4 min-w-[220px]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xl font-bold text-foreground">{market.symbol}</span>
          <Badge className="text-[9px] px-1.5 py-0.5 bg-cyan-500/20 text-cyan-400 border-0">
            Lighter
          </Badge>
        </div>
        
        <div className="space-y-2 text-xs">
          <div className="flex justify-between items-baseline">
            <span className="text-muted-foreground">Price</span>
            <span className="text-lg font-bold text-foreground">
              ${price < 1 ? price.toFixed(6) : price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-muted-foreground">Daily Open</span>
            <span className="text-foreground">
              ${dailyOpen < 1 ? dailyOpen.toFixed(6) : dailyOpen.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-muted-foreground">Change</span>
            <div className="text-right">
              <span className={cn('font-bold', changeColor)}>
                {dailyChange >= 0 ? '+' : ''}{dailyChange.toFixed(2)}%
              </span>
              <div className={cn('text-[10px]', changeColor)}>
                {priceChange >= 0 ? '+' : ''}${Math.abs(priceChange) < 1 ? priceChange.toFixed(6) : priceChange.toFixed(2)}
              </div>
            </div>
          </div>
          
          <div className="flex justify-between">
            <span className="text-muted-foreground">24h Range</span>
            <span className="text-foreground">
              ${(market.dailyLow ?? 0) < 1 ? (market.dailyLow ?? 0).toFixed(4) : (market.dailyLow ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} - ${(market.dailyHigh ?? 0) < 1 ? (market.dailyHigh ?? 0).toFixed(4) : (market.dailyHigh ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-muted-foreground">Daily Volume</span>
            <span className="text-foreground font-semibold">
              ${(market.dailyVolume ?? 0) >= 1e6 
                ? ((market.dailyVolume ?? 0) / 1e6).toFixed(2) + 'M'
                : (market.dailyVolume ?? 0).toLocaleString()}
            </span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-muted-foreground">Open Interest</span>
            <span className="text-foreground">
              {(market.openInterest ?? 0) >= 1e6 
                ? ((market.openInterest ?? 0) / 1e6).toFixed(2) + 'M'
                : (market.openInterest ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

type FilterType = 'all' | 'gainers' | 'losers' | 'hot'

function FilterControls({
  searchQuery,
  setSearchQuery,
  activeFilter,
  setActiveFilter,
  totalCount,
  filteredCount,
}: {
  searchQuery: string
  setSearchQuery: (query: string) => void
  activeFilter: FilterType
  setActiveFilter: (filter: FilterType) => void
  totalCount: number
  filteredCount: number
}) {
  const filters: { id: FilterType; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'gainers', label: '↑' },
    { id: 'losers', label: '↓' },
    { id: 'hot', label: '🔥' },
  ]
  
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 font-mono">
      <div className="bg-black/80 backdrop-blur-sm border border-border rounded-full px-2 py-1 flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-6 pl-7 pr-6 text-[10px] bg-black/50 border-border/50 w-[120px] font-mono rounded-full"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        
        <div className="w-px h-4 bg-border/50" />
        
        <div className="flex gap-1">
          {filters.map((filter) => (
            <button
              key={filter.id}
              onClick={() => setActiveFilter(filter.id)}
              className={cn(
                'px-2 py-0.5 text-[10px] rounded-full transition-colors',
                activeFilter === filter.id
                  ? 'bg-cyan-500/20 text-cyan-400'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        
        <div className="w-px h-4 bg-border/50" />
        
        <span className="text-[9px] text-muted-foreground whitespace-nowrap">
          {filteredCount}/{totalCount}
        </span>
      </div>
    </div>
  )
}

function ControlsHint() {
  return (
    <div className="absolute bottom-4 right-4 z-10 font-mono text-[10px] text-muted-foreground">
      <div className="bg-black/60 backdrop-blur-sm border border-border/50 rounded px-3 py-2">
        <span className="font-bold">DRAG</span>: Rotate view &nbsp;|&nbsp; 
        <span className="font-bold">SCROLL</span>: Zoom &nbsp;|&nbsp;
        <span className="font-bold">HOVER</span>: Details
      </div>
    </div>
  )
}

export default function LandscapePage() {
  const { markets, isConnected, isLoading, error, stats, reconnect } = useLighterWS()
  const [hoveredMarket, setHoveredMarket] = useState<LighterMarketData | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterType>('all')
  
  const marketList = useMemo(() => Object.values(markets), [markets])
  
  const filteredMarkets = useMemo(() => {
    let filtered = marketList
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(m => m.symbol.toLowerCase().includes(query))
    }
    
    switch (activeFilter) {
      case 'gainers':
        filtered = filtered.filter(m => (m.dailyChange ?? 0) > 0.1)
        break
      case 'losers':
        filtered = filtered.filter(m => (m.dailyChange ?? 0) < -0.1)
        break
      case 'hot':
        filtered = [...filtered]
          .sort((a, b) => Math.abs(b.dailyChange ?? 0) - Math.abs(a.dailyChange ?? 0))
          .slice(0, 20)
        break
    }
    
    return filtered
  }, [marketList, searchQuery, activeFilter])
  
  return (
    <div className="h-full w-full relative bg-[#0a0a0f]">
      <Canvas
        camera={{ position: [12, 10, 12], fov: 50 }}
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.3} />
          <directionalLight
            position={[10, 20, 10]}
            intensity={1}
            castShadow
            shadow-mapSize={[2048, 2048]}
          />
          <pointLight position={[-10, 10, -10]} intensity={0.5} color="#22d3ee" />
          <pointLight position={[10, 5, 10]} intensity={0.3} color="#a855f7" />
          
          {/* Daily Open Baseline Grid - clean and minimal */}
          <Grid
            position={[0, 0, 0]}
            args={[40, 40]}
            cellSize={1.4}
            cellThickness={0.4}
            cellColor="#334155"
            sectionSize={7}
            sectionThickness={1}
            sectionColor="#64748b"
            fadeDistance={50}
            fadeStrength={2}
            infiniteGrid
          />
          
          {/* Daily Open baseline indicators - glowing rings visible from both sides */}
          <group position={[0, 0, 0]}>
            {/* Outer glow ring */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[16, 16.2, 64]} />
              <meshBasicMaterial color="#22d3ee" transparent opacity={0.25} side={THREE.DoubleSide} />
            </mesh>
            {/* Middle ring */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[10, 10.15, 64]} />
              <meshBasicMaterial color="#22d3ee" transparent opacity={0.35} side={THREE.DoubleSide} />
            </mesh>
            {/* Inner ring - brightest */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[4, 4.1, 64]} />
              <meshBasicMaterial color="#22d3ee" transparent opacity={0.5} side={THREE.DoubleSide} />
            </mesh>
            {/* Center marker */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.3, 32]} />
              <meshBasicMaterial color="#22d3ee" transparent opacity={0.6} side={THREE.DoubleSide} />
            </mesh>
            
            {/* Cross-hair lines for orientation */}
            <mesh position={[0, 0.005, 0]}>
              <boxGeometry args={[35, 0.01, 0.04]} />
              <meshBasicMaterial color="#475569" transparent opacity={0.4} />
            </mesh>
            <mesh position={[0, 0.005, 0]}>
              <boxGeometry args={[0.04, 0.01, 35]} />
              <meshBasicMaterial color="#475569" transparent opacity={0.4} />
            </mesh>
          </group>
          
          {filteredMarkets.length > 0 && (
            <MarketLandscape 
              markets={filteredMarkets}
              onHover={setHoveredMarket}
              onUnhover={() => setHoveredMarket(null)}
              hoveredMarket={hoveredMarket}
            />
          )}
          
          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.05}
            minDistance={5}
            maxDistance={50}
            minPolarAngle={Math.PI / 6}
            maxPolarAngle={Math.PI / 1.5}
            target={[0, 0, 0]}
          />
        </Suspense>
      </Canvas>
      
      {isLoading && marketList.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <div className="text-center">
            <RefreshCw className="h-8 w-8 text-cyan-400 animate-spin mx-auto mb-3" />
            <p className="text-sm text-muted-foreground font-mono">
              Connecting to Lighter.xyz...
            </p>
          </div>
        </div>
      )}
      
      {error && marketList.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <div className="text-center">
            <WifiOff className="h-8 w-8 text-red-500 mx-auto mb-3" />
            <p className="text-sm text-red-500 font-mono mb-2">{error}</p>
            <button 
              onClick={reconnect}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-mono"
            >
              Click to retry
            </button>
          </div>
        </div>
      )}
      
      <StatsOverlay
        stats={stats}
        isConnected={isConnected}
        isLoading={isLoading}
      />
      
      <FilterControls
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        activeFilter={activeFilter}
        setActiveFilter={setActiveFilter}
        totalCount={marketList.length}
        filteredCount={filteredMarkets.length}
      />
      
      <HoveredInfo market={hoveredMarket} />
      
      <ControlsHint />
    </div>
  )
}
