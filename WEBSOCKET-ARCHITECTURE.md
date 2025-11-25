# WebSocket Architecture

## Overview

The liquidations and all-fills pages use a **server-side WebSocket singleton pattern** to ensure scalability and reliability. This architecture allows many users to access real-time data without each user connecting individually to the WebSocket.

## Architecture Pattern

```
┌─────────────────┐
│  WebSocket API  │
│ (hydromancer.xyz)│
└────────┬────────┘
         │
         │ Single persistent connection
         │
┌────────▼──────────────────────────┐
│  Server-Side WebSocket Manager    │
│  (Singleton Instance)              │
│  • Maintains connection            │
│  • Handles reconnection            │
│  • Stores data in memory (5000 max)│
│  • Health monitoring               │
│  • Automatic ping/pong             │
└───────────┬────────────────────────┘
            │
            │ HTTP polling (75ms)
            │
   ┌────────▼────────┐
   │  API Endpoint   │
   │  GET /api/...   │
   └────────┬────────┘
            │
     ┌──────▼──────┐  ┌──────────┐  ┌──────────┐
     │   Client 1  │  │ Client 2 │  │ Client N │
     └─────────────┘  └──────────┘  └──────────┘
```

## Key Features

### 1. **Singleton Pattern**
- Only ONE WebSocket connection to the API regardless of user count
- Connection is maintained server-side
- Shared memory cache for all clients

### 2. **Automatic Reconnection**
- Reconnects automatically on connection drop
- 5-second delay between reconnection attempts
- Keep-alive checks every 30 seconds
- Stale connection detection (60s timeout)

### 3. **Health Monitoring**
- Tracks last message timestamp
- Sends ping every 15 seconds
- Forces reconnection if no messages for 60 seconds
- Health check endpoint available

### 4. **Memory Management**
- Stores up to 5000 items (liquidations or fills)
- Oldest items automatically removed
- Newest items prepended for efficient display

### 5. **Client Polling**
- Clients poll every 75ms (~13 FPS)
- No individual WebSocket connections from clients
- Reduces server load significantly
- Works with many concurrent users

## Implementation Details

### Server-Side Manager

Both `/api/liquidations/route.ts` and `/api/all-fills/route.ts` implement:

```typescript
class StreamManager {
  private static instance: StreamManager | null = null;
  private ws: WebSocket | null = null;
  private data: ProcessedData[] = [];
  private isConnected: boolean = false;
  
  public static getInstance(): StreamManager {
    if (!StreamManager.instance) {
      StreamManager.instance = new StreamManager();
    }
    return StreamManager.instance;
  }
}
```

### Graceful Shutdown

The manager handles process termination:

```typescript
process.on('SIGTERM', () => streamManager.shutdown());
process.on('SIGINT', () => streamManager.shutdown());
```

## API Endpoints

### GET Endpoints

#### `/api/liquidations` or `/api/all-fills`
Returns current data:
```json
{
  "isConnected": true,
  "liquidations": [...], // or "fills"
  "timestamp": 1234567890,
  "lastMessageAgo": 500,
  "totalLiquidations": 1234 // or "totalFills"
}
```

#### `/api/liquidations?health=true` or `/api/all-fills?health=true`
Returns health status:
```json
{
  "healthy": true,
  "isConnected": true,
  "isConnecting": false,
  "wsState": 1,
  "lastMessageAgo": 500,
  "totalLiquidations": 1234,
  "timestamp": 1234567890
}
```

### POST Endpoints (Admin/Debug)

#### Force Reconnect
```bash
curl -X POST http://localhost:3001/api/liquidations \
  -H "Content-Type: application/json" \
  -d '{"action": "reconnect"}'
```

#### Get Detailed Status
```bash
curl -X POST http://localhost:3001/api/liquidations \
  -H "Content-Type: application/json" \
  -d '{"action": "status"}'
```

## Benefits

### For Users
- ✅ Always-on data stream (no reload needed)
- ✅ Fast updates (75ms polling)
- ✅ Reliable connection (auto-reconnect)
- ✅ Works for many concurrent users

### For Infrastructure
- ✅ Single connection to WebSocket API (not per-user)
- ✅ Reduced API rate limits
- ✅ Lower server resource usage
- ✅ Scales horizontally (with Redis/shared cache)

### For Development
- ✅ Easy to debug (single connection)
- ✅ Clear health monitoring
- ✅ Admin controls for reconnection
- ✅ Graceful shutdown handling

## Production Considerations

### Current Setup (Single Server)
The current implementation works well for a **dedicated server** or **container** environment where:
- The Node.js process stays running
- Memory is persistent
- One instance handles all requests

### Scaling to Multiple Servers

For **serverless** or **multi-instance** deployments, consider adding:

1. **Redis Cache**
   ```typescript
   // Store data in Redis instead of memory
   await redis.lpush('liquidations', JSON.stringify(data));
   await redis.ltrim('liquidations', 0, 4999); // Keep 5000
   ```

2. **Separate Worker Service**
   ```
   ┌─────────────────────┐
   │  Worker Service     │ ← Maintains WebSocket
   │  (Single Instance)  │   Writes to Redis
   └─────────────────────┘
            │
            ▼
      ┌──────────┐
      │  Redis   │
      └─────┬────┘
            │
     ┌──────▼─────┐
     │ API Servers│ ← Read from Redis
     │ (Scaled)   │   Serve clients
     └────────────┘
   ```

3. **Server-Sent Events (SSE)**
   - Replace polling with SSE for push notifications
   - Reduces client requests
   - Better latency for updates

4. **WebSocket Proxy**
   - Tools like Socket.io or Pusher
   - Managed WebSocket connections
   - Built-in scaling and failover

## Monitoring

Monitor these metrics:
- `lastMessageAgo`: Should be < 10 seconds
- `isConnected`: Should be `true`
- `wsState`: Should be `1` (OPEN)
- Connection drops and reconnection frequency

## Troubleshooting

### No Data Appearing
1. Check `/api/liquidations?health=true`
2. Look for `isConnected: true`
3. Check `lastMessageAgo` is recent

### Frequent Disconnections
1. Check network stability
2. Verify API key is valid
3. Check for rate limiting
4. Review server logs for errors

### Stale Data
1. Verify polling interval (75ms) is running
2. Check browser network tab for 200 responses
3. Verify WebSocket connection is healthy

## Future Improvements

- [ ] Add Redis integration for multi-server scaling
- [ ] Implement Server-Sent Events (SSE)
- [ ] Add Prometheus metrics export
- [ ] Create admin dashboard for monitoring
- [ ] Add data persistence (database backup)
- [ ] Implement message replay on reconnect
- [ ] Add WebSocket compression


