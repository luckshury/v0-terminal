# Liquidations Page Architecture

## Overview
The liquidations page uses a **server-side persistent WebSocket connection** to continuously collect liquidation data from Hydromancer, even when no users are viewing the page. The frontend simply displays this data.

## Architecture

### Server-Side (`/app/api/liquidations/route.ts`)
**Persistent WebSocket Connection:**
- Connects to `wss://api.hydromancer.xyz/ws` on module load
- Maintains connection 24/7 (auto-reconnect every 5s if dropped)
- Authenticates and subscribes to `liquidationFills` stream
- Stores liquidation data in-memory (max 5,000 items)
- Handles ping/pong for keep-alive

**Benefits:**
- ✅ Single WebSocket connection regardless of number of users
- ✅ Data collection continues even when no one is viewing
- ✅ No client-side WebSocket overhead
- ✅ Reduced API load on Hydromancer
- ✅ Instant data availability when users navigate to page

### Client-Side (`/app/liquidations/page.tsx`)
**View-Only Display:**
- Polls `/api/liquidations` endpoint every 500ms (2 fps)
- No direct WebSocket connection
- Pure display/filter layer

## Optimizations (Same as All-Fills Page)

### 1. **List Virtualization** (Optimization #1)
```tsx
<TableVirtuoso
  data={filteredRows}
  // Only renders visible rows
/>
```
- Uses `react-virtuoso` for efficient rendering
- Only DOM elements for visible rows exist
- Handles 5,000+ items smoothly

### 2. **Buffered Updates** (Optimization #2)
**Server-side:**
- Incoming liquidations stored in global state
- No per-request buffering needed

**Client-side:**
- Polls at 500ms intervals (2 fps)
- Smooth, predictable update rate

### 3. **Dataset Limiting** (Optimization #3)
```typescript
const MAX_LIQUIDATIONS = 5000;
liquidations = [...newLiquidations.reverse(), ...liquidations].slice(0, MAX_LIQUIDATIONS);
```
- Server maintains only 5,000 most recent liquidations
- Prevents memory bloat
- Client receives pre-limited data

### 4. **React.memo Optimization** (Optimization #4)
```tsx
const LiquidationRow = memo(({ liquidation }) => {
  // Row content
}, (prev, next) => prev.liquidation.id === next.liquidation.id);
```
- Memoized row components
- Only re-renders when data changes
- Prevents unnecessary renders

### 5. **useMemo for Filtering** (Optimization #5)
```tsx
const filteredRows = useMemo(() => {
  // Filtering logic
}, [rows, coinFilter, minSizeFilter, sideFilter]);
```
- Client-side filtering cached
- Only recalculates when dependencies change

## Data Flow

```
┌─────────────────────────────────────┐
│   Hydromancer WebSocket API         │
│   wss://api.hydromancer.xyz/ws      │
└──────────────┬──────────────────────┘
               │ liquidationFills
               ▼
┌─────────────────────────────────────┐
│   Server (Next.js API Route)        │
│   /app/api/liquidations/route.ts    │
│   • Persistent WebSocket             │
│   • In-memory storage (5000 max)    │
│   • Global state                     │
└──────────────┬──────────────────────┘
               │ HTTP GET
               │ Polls every 500ms
               ▼
┌─────────────────────────────────────┐
│   Client (React Page)                │
│   /app/liquidations/page.tsx         │
│   • View only                        │
│   • Filters & Display                │
│   • Virtualized table                │
└─────────────────────────────────────┘
```

## Comparison: Old vs New

### Old Approach (Client-Side WebSocket)
```
User 1 → WebSocket connection
User 2 → WebSocket connection
User 3 → WebSocket connection
No users → No data collection ❌
```

### New Approach (Server-Side WebSocket)
```
Server → Single WebSocket connection (always on) ✅
User 1 → HTTP polling (lightweight)
User 2 → HTTP polling (lightweight)
User 3 → HTTP polling (lightweight)
No users → Data still collecting ✅
```

## Performance Characteristics

- **Memory Usage:** ~1-2MB for 5,000 liquidations
- **Server Load:** 1 WebSocket connection (constant)
- **Client Load:** HTTP polling at 500ms intervals
- **Network:** ~5-10KB per poll (JSON response)
- **Latency:** 500ms max from liquidation to display

## Future Enhancements

1. **Database Persistence:** Store liquidations in DB for historical analysis
2. **Server-Sent Events (SSE):** Replace polling with push updates
3. **Redis Cache:** Scale across multiple server instances
4. **Compression:** Gzip API responses for lower bandwidth
5. **WebSocket Broadcast:** Push updates to all connected clients

## Monitoring

Check server logs for:
```
🔌 Connecting to Hydromancer WebSocket for liquidations...
✅ WebSocket opened, authenticating...
✅ Authenticated! Subscribing to liquidationFills...
⚡ Received X liquidations
```

API health check:
```bash
curl http://localhost:4200/api/liquidations
```

Should return:
```json
{
  "isConnected": true,
  "stats": { "totalVol": 123456, "liqCount": 789 },
  "liquidations": [...],
  "timestamp": 1234567890
}
```





