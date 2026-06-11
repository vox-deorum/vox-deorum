# API Reference

Complete HTTP API reference for the Bridge Service.

## Base URL

Default: `http://127.0.0.1:5000`

Configurable via `config.json` or environment variables (`PORT`, `HOST`).

## Authentication

Currently no authentication is required. CORS is enabled for all origins in development.

**Production Note**: Consider adding authentication middleware before deploying to production.

## Response Format

All endpoints follow a standardized response format defined in [src/types/api.ts](../src/types/api.ts).

### Success Response
```typescript
{
  "success": true,
  "result": any  // Varies by endpoint
}
```

### Error Response
```typescript
{
  "success": false,
  "error": {
    "code": string,      // ErrorCode enum value
    "message": string,   // Human-readable message
    "details"?: string   // Optional additional details
  }
}
```

## Lua Operations

### Execute Single Function

**POST** `/lua/call`

Execute a registered Lua function and return its result.

**Request Body:**
```typescript
{
  "function": string,  // Function name (must be registered)
  "args": any          // Arguments (any JSON-compatible value, defaults to {})
}
```

**Success Response:**
```typescript
{
  "success": true,
  "result": any  // Function return value
}
```

**Example:**
```bash
curl -X POST http://127.0.0.1:5000/lua/call \
  -H "Content-Type: application/json" \
  -d '{"function": "GetGameTurn", "args": {}}'
```

**Timeout:** 300 seconds

### Execute Batch Functions

**POST** `/lua/batch`

Execute multiple Lua functions in sequence. Optimized for performance - up to 10x faster than individual calls.

**Request Body:**
```typescript
Array<{
  "function": string,
  "args": any
}>
```

**Success Response:**
```typescript
{
  "success": true,
  "result": {
    "results": Array<any>  // Results in same order as requests
  }
}
```

**Example:**
```bash
curl -X POST http://127.0.0.1:5000/lua/batch \
  -H "Content-Type: application/json" \
  -d '[
    {"function": "GetUnit", "args": {"id": 5}},
    {"function": "GetCity", "args": {"id": 10}}
  ]'
```

**Notes:**
- If any function fails, the entire batch fails
- Results maintain request order
- Recommended batch size: < 50 functions to avoid timeout

### Execute Raw Lua Script

**POST** `/lua/execute`

Execute arbitrary Lua code and return the result.

**Request Body:**
```typescript
{
  "script": string  // Lua code to execute
}
```

**Success Response:**
```typescript
{
  "success": true,
  "result": any  // Script return value
}
```

**Example:**
```bash
curl -X POST http://127.0.0.1:5000/lua/execute \
  -H "Content-Type: application/json" \
  -d '{"script": "return Game.GetGameTurn() * 2"}'
```

**Security Note:** Validate and sanitize scripts in production environments.

### List Registered Functions

**GET** `/lua/functions`

Get all currently registered Lua functions.

**Success Response:**
```typescript
{
  "success": true,
  "result": {
    "functions": Array<{
      "name": string,
      "description"?: string
    }>
  }
}
```

**Example:**
```bash
curl http://127.0.0.1:5000/lua/functions
```

## External Functions

### Register External Function

**POST** `/external/register`

Register an HTTP endpoint as a Lua-callable function.

**Request Body:**
```typescript
{
  "name": string,          // Function name (used in Lua)
  "url": string,           // HTTP endpoint URL
  "async": boolean,        // true: callback-based, false: blocking
  "timeout"?: number,      // Request timeout in ms (default: 5000)
  "description"?: string   // Optional description
}
```

**Success Response:**
```typescript
{
  "success": true
}
```

**Example:**
```bash
curl -X POST http://127.0.0.1:5000/external/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "AnalyzeThreat",
    "url": "http://127.0.0.1:4000/analyze",
    "async": true,
    "timeout": 10000,
    "description": "AI-powered threat analysis"
  }'
```

**Notes:**
- Registered functions persist until explicitly unregistered or DLL disconnects
- Functions are automatically re-registered after DLL reconnection
- URL must be a valid HTTP/HTTPS endpoint

### Unregister External Function

**DELETE** `/external/register/:name`

Remove a registered external function.

**Path Parameters:**
- `name` (string): The function name to unregister

**Success Response:**
```typescript
{
  "success": true
}
```

**Example:**
```bash
curl -X DELETE http://127.0.0.1:5000/external/register/AnalyzeThreat
```

### List External Functions

**GET** `/external/functions`

Get all currently registered external functions.

**Success Response:**
```typescript
{
  "success": true,
  "result": Array<{
    "name": string,
    "url": string,
    "async": boolean,
    "timeout": number,
    "description"?: string
  }>
}
```

## Game Control

### Pause Game (Manual)

**POST** `/external/pause`

Manually pause the game. Prevents auto-resume until manually resumed.

**Request Body:** `{}` (empty object)

**Success Response:**
```typescript
{
  "success": true
}
```

**Example:**
```bash
curl -X POST http://127.0.0.1:5000/external/pause \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Resume Game (Manual)

**POST** `/external/resume`

Resume a manually paused game.

**Request Body:** `{}` (empty object)

**Success Response:**
```typescript
{
  "success": true
}
```

### Register Player for Auto-Pause

**POST** `/external/pause-player/:id`

Automatically pause the game when a specific player's turn begins.

**Path Parameters:**
- `id` (number): Player ID (0-based index, valid range: 0-63)

**Success Response:**
```typescript
{
  "success": true,
  "pausedPlayers": number[]  // Updated list of paused player IDs
}
```

**Example:**
```bash
curl -X POST http://127.0.0.1:5000/external/pause-player/0 \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Notes:**
- Game auto-pauses when registered player's turn starts (PlayerDoTurn event)
- Game auto-resumes when registered player's turn ends
- Multiple players can be registered simultaneously
- Auto-pause is synced with the DLL

### Unregister Player from Auto-Pause

**DELETE** `/external/pause-player/:id`

Remove a player from auto-pause list.

**Path Parameters:**
- `id` (number): Player ID to unregister (valid range: 0-63)

**Success Response:**
```typescript
{
  "success": true,
  "pausedPlayers": number[]  // Updated list
}
```

### Get Paused Players

**GET** `/external/paused-players`

Get the list of players registered for auto-pause and current game pause state.

**Success Response:**
```typescript
{
  "success": true,
  "pausedPlayers": number[],
  "isGamePaused": boolean
}
```

### Clear All Paused Players

**DELETE** `/external/paused-players`

Remove all players from auto-pause list.

**Success Response:**
```typescript
{
  "success": true,
  "pausedPlayers": []
}
```

## Event Streaming

### Subscribe to Events (SSE)

**GET** `/events`

Establish a Server-Sent Events connection to receive real-time game events.

**Headers Required:**
- `Accept: text/event-stream`

**Response Format:**
```
event: <event-type>
data: <json-payload>

```

**Event Data Structure:**
```typescript
{
  "id": number,      // Event ID: (turn * 1000000) + sequence
  "type": string,    // Event type
  "payload": object  // Event-specific data
}
```

**Example (JavaScript):**
```javascript
const events = new EventSource('http://127.0.0.1:5000/events');

events.onmessage = (e) => {
  const event = JSON.parse(e.data);
  console.log(`Event ${event.id}: ${event.type}`);
};

events.onerror = () => {
  console.error('SSE connection error');
};
```

**Notes:**
- Keep-alive messages sent every 5 seconds
- Connection automatically reconnects on network issues
- Events are batched (50ms timeout or 100 events max) before delivery
- See [protocol.md](protocol.md) for complete event list and formats

## Health & Monitoring

### Health Check

**GET** `/health`

Check if the service is running and connected to the DLL.

**Success Response:**
```typescript
{
  "success": true,
  "dll_connected": boolean,
  "uptime": number,     // Seconds since service started
  "version": string
}
```

**Example:**
```bash
curl http://127.0.0.1:5000/health
```

### Graceful Shutdown

**POST** `/shutdown`

Request a graceful local shutdown. Intended for localhost-only orchestration.

**Success Response:**
```typescript
{
  "success": true,
  "message": "Shutdown initiated"
}
```

**Example:**
```bash
curl -X POST http://127.0.0.1:5000/shutdown
```

### Service Statistics

**GET** `/stats`

Get detailed service statistics including connection info, function counts, event pipe, and memory usage.

**Success Response:**
```typescript
{
  "success": true,
  "result": {
    "uptime": number,              // Seconds since service started
    "dll": {
      "connected": boolean,
      "pendingRequests": number,
      "reconnectAttempts": number
    },
    "lua": {
      "registeredFunctions": number
    },
    "external": {
      "registeredFunctions": number,
      "functionNames": string[]
    },
    "eventPipe": {
      "enabled": boolean,
      "clients": number,
      "pipeName": string
    },
    "memory": {
      "used": number,             // Heap used in MB
      "total": number             // Heap total in MB
    },
    "sse": {
      "activeClients": number,
      "eventPipeStats": {
        "enabled": boolean,
        "clients": number,
        "pipeName": string
      }
    }
  }
}
```

**Example:**
```bash
curl http://127.0.0.1:5000/stats
```

## Error Codes

All errors include a `code` field from the `ErrorCode` enum. See [error-handling.md](../../docs/developers/bridge-service/error-handling.md) for complete error documentation.

Common error codes:
- `DLL_DISCONNECTED` - Bridge lost connection to game DLL
- `CALL_TIMEOUT` - Function execution exceeded timeout
- `INVALID_FUNCTION` - Function not registered
- `LUA_EXECUTION_ERROR` - Lua script failed to execute
- `NETWORK_ERROR` - HTTP request to external service failed

## Rate Limiting

Currently no rate limiting is implemented. Consider adding rate limiting middleware for production deployments.

## CORS

Cross-Origin Resource Sharing (CORS) is enabled for all origins in development. Configure appropriately for production.
