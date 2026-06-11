# Message Types Reference

Complete reference for all IPC message types exchanged between the Bridge Service and the Community Patch DLL.

All message type definitions are available in [src/types/](../src/types/).

## Base Message Structure

All IPC messages extend the base `IPCMessage` interface:

```typescript
interface IPCMessage {
  type: string;      // Message type identifier
  id?: string;       // Optional request ID for tracking request/response pairs
}
```

**Delimiter:** Messages are delimited by `!@#$%^!` for batching support.

## Lua Operations

### Lua Function Call

**Bridge → DLL**

```typescript
{
  "type": "lua_call",
  "function": string,    // Function name (must be registered in Lua)
  "args": any,           // Function arguments (any JSON-compatible value)
  "id": string           // Unique request ID (UUID)
}
```

**Example:**
```json
{
  "type": "lua_call",
  "function": "GetGameTurn",
  "args": [],
  "id": "123e4567-e89b-12d3-a456-426614174000"
}
```

### Lua Script Execution

**Bridge → DLL**

```typescript
{
  "type": "lua_execute",
  "script": string,      // Raw Lua code to execute
  "id": string           // Unique request ID
}
```

**Example:**
```json
{
  "type": "lua_execute",
  "script": "return Game.GetGameTurn() * 2",
  "id": "123e4567-e89b-12d3-a456-426614174001"
}
```

### Lua Response

**DLL → Bridge**

```typescript
{
  "type": "lua_response",
  "id": string,          // Matches request ID
  "success": boolean,    // true if execution succeeded
  "result"?: any,        // Return value (if successful)
  "error"?: {            // Error details (if failed)
    "code": string,
    "message": string,
    "details"?: string
  }
}
```

**Success Example:**
```json
{
  "type": "lua_response",
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "success": true,
  "result": 42
}
```

**Error Example:**
```json
{
  "type": "lua_response",
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "success": false,
  "error": {
    "code": "LUA_EXECUTION_ERROR",
    "message": "Function not found",
    "details": "GetGameTurn is not defined"
  }
}
```

## Lua Function Registry

### Register Function

**DLL → Bridge**

Sent when a Lua function is registered and becomes callable.

```typescript
{
  "type": "lua_register",
  "function": string,        // Function name
  "description"?: string     // Optional function description
}
```

**Example:**
```json
{
  "type": "lua_register",
  "function": "GetCity",
  "description": "Gets a city by its ID"
}
```

### Unregister Function

**DLL → Bridge**

Sent when a Lua function is unregistered.

```typescript
{
  "type": "lua_unregister",
  "function": string         // Function name to unregister
}
```

### Clear All Functions

**DLL → Bridge**

Clears the entire function registry (typically on game load/restart).

```typescript
{
  "type": "lua_clear"
}
```

## External Functions

### Register External Function

**Bridge → DLL**

Notifies the DLL that an external HTTP endpoint is now available as a Lua function.

```typescript
{
  "type": "external_register",
  "name": string,            // Function name (used in Lua)
  "async": boolean           // true: callback-based, false: blocking
}
```

**Example:**
```json
{
  "type": "external_register",
  "name": "AnalyzeThreat",
  "async": true
}
```

### Unregister External Function

**Bridge → DLL**

Removes an external function from the Lua environment.

```typescript
{
  "type": "external_unregister",
  "name": string             // Function name to unregister
}
```

### External Function Call

**DLL → Bridge**

Lua code calls an external function, DLL forwards the request to Bridge.

```typescript
{
  "type": "external_call",
  "id": string,              // Unique request ID
  "function": string,        // External function name
  "args": any,               // Arguments from Lua
  "async": boolean           // Matches registration mode
}
```

**Example:**
```json
{
  "type": "external_call",
  "id": "ext-call-001",
  "function": "AnalyzeThreat",
  "args": {"unitId": 5, "playerId": 1},
  "async": true
}
```

### External Function Response

**Bridge → DLL**

Bridge returns the external HTTP endpoint result to the DLL.

```typescript
{
  "type": "external_response",
  "id": string,              // Matches request ID
  "success": boolean,
  "result"?: any,            // Response data (if successful)
  "error"?: {                // Error details (if failed)
    "code": string
  }
}
```

**Success Example:**
```json
{
  "type": "external_response",
  "id": "ext-call-001",
  "success": true,
  "result": {"threatLevel": "high", "recommendation": "retreat"}
}
```

**Error Example:**
```json
{
  "type": "external_response",
  "id": "ext-call-001",
  "success": false,
  "error": {
    "code": "CALL_TIMEOUT"
  }
}
```

## Game Pause Control

### Pause Player

**Bridge → DLL**

Register a player for auto-pause (game pauses when this player's turn starts).

```typescript
{
  "type": "pause_player",
  "playerID": number         // Player ID (0-based index)
}
```

**Example:**
```json
{
  "type": "pause_player",
  "playerID": 0
}
```

### Unpause Player

**Bridge → DLL**

Unregister a player from auto-pause.

```typescript
{
  "type": "unpause_player",
  "playerID": number         // Player ID to remove from pause list
}
```

### Clear Paused Players

**Bridge → DLL**

Remove all players from the auto-pause list.

```typescript
{
  "type": "clear_paused_players"
}
```

## Game Events

### Game Event

**DLL → Bridge**

Broadcast game events to all connected clients via SSE and event pipe.

```typescript
{
  "type": "game_event",
  "id": number,                    // Event ID: (turn * 1000000) + sequence
  "event": string,                 // Event type (e.g., "PlayerDoTurn")
  "payload": object,               // Event-specific data
  "extraPayload"?: object,         // Optional additional data
  "visibility"?: number[]          // Optional player visibility restrictions
}
```

**Example:**
```json
{
  "type": "game_event",
  "id": 1000001,
  "event": "PlayerDoTurn",
  "payload": {
    "PlayerID": 0,
    "Turn": 1
  },
  "visibility": [0]
}
```

**Event ID Format:**
- Formula: `(turn * 1000000) + eventSequence`
- Turn 1, Event 1: `1000001`
- Turn 123, Event 4567: `123004567`
- Event sequence resets to 1 at the start of each turn
- Event sequence persists between saves/loads

**Payload Structure:**
- Properties are defined by event schema in C++
- Arrays are sent as: count property + array items
- Boolean properties marked with `!` prefix in schema are converted from int
- Events without schemas or arguments are skipped

**Blacklisted Events:**

The following high-frequency or low-value events are NOT forwarded:

- `GameCoreUpdateBegin`, `GameCoreUpdateEnd`
- `GameCoreTestVictory`
- `PlayerPreAIUnitUpdate`
- `BattleStarted`, `BattleJoined`, `BattleFinished`, `CombatEnded`
- `PlayerEndTurnInitiated`, `PlayerEndTurnCompleted`
- `UnitPrekill`
- `GatherPerTurnReplayStats`
- `TerraformingPlot`
- `GameSave`
- `CityPrepared`
- `UnitGetSpecialExploreTarget`
- `PlayerCityFounded`
- `TeamSetHasTech`
- `BarbariansSpawnedUnit`
- `TileRevealed` (from non-major civs only)

## Message Flow Patterns

### Simple Request-Response

1. Bridge sends message with unique `id`
2. DLL processes and responds with same `id`
3. Bridge matches response to pending request

**Timeout:** 300 seconds (configurable in code)

### Registration Pattern

1. Service (Bridge or DLL) registers function/feature
2. Registration message sent to other side
3. Other side updates internal registry
4. No response required (fire-and-forget)

### Broadcasting Pattern

1. DLL sends event to Bridge
2. Bridge broadcasts to all connected clients (SSE + event pipe)
3. No acknowledgment required

## Type Definitions

Full TypeScript type definitions are available in:

- [src/types/lua.ts](../src/types/lua.ts) - Lua operations
- [src/types/external.ts](../src/types/external.ts) - External functions
- [src/types/event.ts](../src/types/event.ts) - Game events and IPC messages
- [src/types/api.ts](../src/types/api.ts) - API responses and error codes

## Error Handling

All response messages (lua_response, external_response) follow the standard error format:

```typescript
{
  "success": false,
  "error": {
    "code": ErrorCode,     // See error-handling.md
    "message"?: string,
    "details"?: string
  }
}
```

See [error-handling.md](../../docs/developers/bridge-service/error-handling.md) for complete error code documentation.

## Message Batching

Multiple messages can be sent in a single IPC write:

**Format:** `message1!@#$%^!message2!@#$%^!message3`

**Example:**
```
{"type":"lua_call","function":"GetUnit","args":[1],"id":"uuid1"}!@#$%^!{"type":"lua_call","function":"GetCity","args":[2],"id":"uuid2"}
```

**Benefits:**
- Reduces IPC overhead by up to 10x
- Critical for performance with high-frequency operations
- Automatic batching in Bridge Service for batch API endpoints

## Keep-Alive and Connection Management

No explicit keep-alive messages for the named pipe connection. Connection health is monitored by:

- Periodic status checks
- Message send/receive success
- Automatic reconnection on disconnect (exponential backoff)

DLL automatically clears paused players on disconnect to prevent stuck game states.
