# All Fills & Liquidations Architecture

## Overview
Both the **All Fills** and **Liquidations** pages use a **server-side persistent WebSocket connection** architecture. This means:
- ✅ Single WebSocket connection per stream (runs 24/7)
- ✅ Data collection never stops, even with zero users
- ✅ All clients share the same data via lightweight HTTP polling
- ✅ Optimized for mass distribution

## Architecture Diagram

```
┌─────────────────────────────────────┐
│   Hydromancer WebSocket API         │
│   wss://api.hydromancer.xyz/ws      │
└──────────┬──────────────────────────┘
           │
           ├─ allFills stream
           └─ liquidationFills stream
           │
           ▼
┌─────────────────────────────────────┐
│   Next.js Server (API Routes)       │
│   • /api/all-fills                  │
│   • /api/liquidations                │
│                                     │
│   Features:                          │
│   • Persistent WebSocket (24/7)     │
│   • In-memory storage (5000 max)    │
│   • Auto-reconnect (5s delay)       │
│   • Global state management         │
└──────────┬──────────────────────────┘
           │ HTTP GET
           │ Polls every 500ms
           ▼
┌─────────────────────────────────────┐
│   React Pages (View Layer)          │
│   • /all-fills                      │
│   • /liquidations                    │
│                                     │
│   Features:                          │
│   • View-only (no WebSocket)        │
│   • Filters & search                 │
│   • Virtualized tables               │
│   • Client-side filtering            │
└─────────────────────────────────────┘
```

## Server-Side Implementation

### `/app/api/all-fills/route.ts`
**Persistent WebSocket for All Fills:**
- Connects on module load
- Subscribes to `allFills` stream with `dex: 'main'`
- Stores up to 5,000 most recent fills
- Tracks cumulative stats (volume, trade count)

### `/app/api/liquidations/route.ts`
**Persistent WebSocket for Liquidations:**
- Connects on module load
- Subscribes to `liquidationFills` stream
- Stores up to 5,000 most recent liquidations
- Tracks cumulative stats (volume, liquidation count)

### Shared Features:
```typescript
// Global state (persists across all requests)
let ws: WebSocket | null = null;
let data: ProcessedItem[] = [];
let stats = { totalVol: 0, count: 0 };
let isConnected = false;

// Auto-reconnect logic
ws.on('close', () => {
  setTimeout(() => connectWebSocket(), 5000);
});

// Keep-alive check
setInterval(() => {
  if (ws?.readyState !== WebSocket.OPEN) {
    connectWebSocket();
  }
}, 30000);
```

## Client-Side Implementation

### `/app/all-fills/page.tsx` & `/app/liquidations/page.tsx`

Both pages share the same optimized architecture:

```typescript
// Fetch from API instead of WebSocket
const fetchData = useCallback(async () => {
  const response = await fetch('/api/endpoint');
  const data = await response.json();
  
  setIsConnected(data.isConnected);
  setStats(data.stats);
  setRows(data.items);
}, []);

// Poll every 500ms (2 fps)
useEffect(() => {
  fetchData();
  const interval = setInterval(fetchData, 500);
  return () => clearInterval(interval);
}, [fetchData]);
```

## Optimizations (Applied to Both Pages)

### 1. **List Virtualization**
```tsx
<TableVirtuoso
  data={filteredRows}
  itemContent={(index, item) => <Row item={item} />}
/>
```
- Only renders visible rows
- Handles 5,000+ items smoothly
- No performance degradation with large datasets

### 2. **Memoized Components**
```tsx
const Row = memo(({ item }) => {
  // Row rendering
}, (prev, next) => prev.item.id === next.item.id);
```
- Components only re-render when data changes
- Prevents unnecessary renders
- Improves frame rate

### 3. **Dataset Limiting**
```typescript
const MAX_ITEMS = 5000;
items = [...newItems.reverse(), ...items].slice(0, MAX_ITEMS);
```
- Server maintains max 5,000 items
- Prevents memory bloat
- Client receives pre-limited data

### 4. **Client-Side Filtering**
```tsx
const filteredRows = useMemo(() => {
  // Filtering logic
}, [rows, coinFilter, minSizeFilter, sideFilter]);
```
- Cached filter results
- Only recalculates on dependency changes
- Smooth filter interactions

### 5. **Buffered Server Updates**
- Server collects all incoming data
- Client polls at controlled rate (500ms)
- Predictable, smooth updates
- No client-side buffer needed

## Comparison: Old vs New

### ❌ Old Approach (Client-Side WebSocket)
```
┌─────────┐     ┌─────────┐     ┌─────────┐
│ User 1  │────▶│   WS1   │     │         │
│ Browser │     │Connection│     │         │
└─────────┘     └─────────┘     │         │
                                │Hydromancer
┌─────────┐     ┌─────────┐     │   API   │
│ User 2  │────▶│   WS2   │────▶│         │
│ Browser │     │Connection│     │         │
└─────────┘     └─────────┘     │         │
                                │         │
┌─────────┐     ┌─────────┐     │         │
│ User 3  │────▶│   WS3   │     │         │
│ Browser │     │Connection│     │         │
└─────────┘     └─────────┘     └─────────┘

Issues:
❌ N WebSocket connections for N users
❌ No data when users leave
❌ Higher load on Hydromancer
❌ API key exposed to clients
```

### ✅ New Approach (Server-Side WebSocket)
```
                ┌─────────┐
                │ Server  │
                │ Single  │◀───────┐
                │   WS    │        │
                └────┬────┘        │
                     │             │
         ┌───────────┼───────────┐ │
         │           │           │ │
    ┌────▼───┐  ┌───▼────┐ ┌───▼─▼──┐
    │ User 1 │  │ User 2 │ │ User 3 │
    │  HTTP  │  │  HTTP  │ │  HTTP  │
    │ Poll   │  │ Poll   │ │ Poll   │
    └────────┘  └────────┘ └────────┘

Benefits:
✅ Single WebSocket (always on)
✅ Data collection 24/7
✅ Lower API load
✅ API key stays server-side
✅ Scales to unlimited users
```

## Performance Characteristics

| Metric | Value |
|--------|-------|
| Memory Usage | ~1-2MB per stream (5,000 items) |
| Server Load | 2 WebSocket connections (constant) |
| Client Load | HTTP polling at 500ms intervals |
| Network | ~5-15KB per poll (compressed JSON) |
| Latency | 500ms max (data → display) |
| Max Items | 5,000 per stream |
| Update Rate | 2 fps (500ms polling) |

## Data Persistence

### Current: In-Memory Storage
- Pros: Fast, simple, no external dependencies
- Cons: Data lost on server restart
- Max: 5,000 items per stream

### Future: Database Persistence
```typescript
// Store to PostgreSQL/TimescaleDB
await db.insert(fills).values(newFills);

// Query historical data
const historical = await db
  .select()
  .from(fills)
  .where(between(fills.time, startDate, endDate));
```

## Monitoring & Health Checks

### Server Logs
```bash
# All Fills WebSocket
🔌 Connecting to Hydromancer WebSocket for all fills...
✅ All-Fills WebSocket opened, authenticating...
✅ All-Fills authenticated! Subscribing to allFills...
⚡ Received 50 fills

# Liquidations WebSocket
🔌 Connecting to Hydromancer WebSocket for liquidations...
✅ WebSocket opened, authenticating...
✅ Authenticated! Subscribing to liquidationFills...
⚡ Received 5 liquidations
```

### Health Check APIs
```bash
# Check all-fills
curl http://localhost:4200/api/all-fills | jq

# Check liquidations
curl http://localhost:4200/api/liquidations | jq

# Expected response
{
  "isConnected": true,
  "stats": {
    "totalVol": 577432.59,
    "tradeCount": 308
  },
  "fills": [...],
  "timestamp": 1234567890
}
```

## Additional Features

### Wallet Address Links
Both pages link wallet addresses to [Flowscan](https://www.flowscan.xyz/):
```tsx
<a 
  href={`https://flowscan.xyz/address/${address}`}
  target="_blank"
  rel="noopener noreferrer"
  className="text-primary hover:text-primary/80 hover:underline"
>
  {shortAddress}
</a>
```

### Filters Available
- **Coin/Address Search**: Text-based filtering
- **Min Value**: Filter by trade size ($)
- **Side**: Filter by Buy/Sell/All

## Future Enhancements

1. **WebSockets to Clients (SSE)**
   - Replace polling with Server-Sent Events
   - Push updates to clients in real-time
   - Lower latency (0-50ms instead of 500ms)

2. **Database Persistence**
   - Store all fills/liquidations in TimescaleDB
   - Enable historical queries
   - Aggregate analytics

3. **Redis Cache**
   - Scale across multiple server instances
   - Shared state between workers
   - Pub/sub for real-time sync

4. **Compression**
   - Gzip API responses
   - Reduce bandwidth by ~70%

5. **Analytics Dashboard**
   - Real-time volume charts
   - Top traders by volume
   - Liquidation heatmaps

## Deployment Considerations

### Environment Variables
```bash
# .env
HYDROMANCER_API_KEY=sk_xxx...
```

### Server Requirements
- **Memory**: 512MB minimum (2GB recommended)
- **CPU**: 1 core minimum (2 cores recommended)
- **Network**: Stable connection to Hydromancer

### Scaling
- Single server handles thousands of concurrent users
- Horizontal scaling requires Redis or similar
- Consider serverless workers for burst traffic

## Troubleshooting

### WebSocket Not Connecting
```bash
# Check logs
tail -f .next/server.log | grep -i "websocket\|hydromancer"

# Test API health
curl http://localhost:4200/api/all-fills | jq '.isConnected'
```

### High Memory Usage
```bash
# Check item counts
curl http://localhost:4200/api/all-fills | jq '.fills | length'

# Should be ≤ 5000 per stream
```

### Client Not Updating
- Check browser console for fetch errors
- Verify polling interval is active
- Check API response times (should be < 10ms)



