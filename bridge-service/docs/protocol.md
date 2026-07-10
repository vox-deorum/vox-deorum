# Communication Protocol

This document describes the communication protocol flows between the Community Patch DLL, Bridge Service, and external AI services in the Vox Deorum system.

## Overview

The Bridge Service acts as a communication hub using three primary channels:
- **Named Pipe**: IPC connection to the Community Patch DLL (using node-ipc)
- **HTTP REST API**: Endpoints for external services to call Lua functions and manage registrations
- **Server-Sent Events (SSE)**: Real-time event streaming to external clients

### Named Pipe Communication Details

- **Pipe Name**: `\\.\pipe\tmp-app.vox-deorum-bridge` (node-ipc adds `tmp-app.` prefix to configured ID)
- **Message Format**: JSON messages delimited by `!@#$%^!`
- **Batching**: Multiple messages can be sent in a single pipe write, separated by the delimiter

For complete message type reference, see [message-types.md](message-types.md).

## Protocol Flows

### 1. External Service → Lua Function Call

#### Single Function Call Flow

```
External Service                Bridge Service                  Community Patch DLL
       |                              |                                  |
       |  POST /lua/call             |                                  |
       |  {"function":"GetGameTurn"} |                                  |
       |----------------------------->|                                  |
       |                              |  lua_call message                |
       |                              |--------------------------------->|
       |                              |                                  |
       |                              |         Executes GetGameTurn()   |
       |                              |                                  |
       |                              |  lua_response message            |
       |                              |<---------------------------------|
       |  HTTP 200                    |                                  |
       |  {"success":true,"result":42}|                                  |
       |<-----------------------------|                                  |
```

**Message Details:**
- Request format: See [api-reference.md](api-reference.md#execute-single-function)
- IPC messages: See [message-types.md](message-types.md#lua-operations)
- Error codes: See [error-handling.md](../../docs/developers/bridge-service/error-handling.md)

#### Batch Function Calls Flow

```
External Service                Bridge Service                  Community Patch DLL
       |                              |                                  |
       |  POST /lua/batch             |                                  |
       |  [{func1}, {func2}]          |                                  |
       |----------------------------->|                                  |
       |                              |  lua_call (func1)                |
       |                              |--------------------------------->|
       |                              |  lua_call (func2)                |
       |                              |--------------------------------->|
       |                              |                                  |
       |                              |  lua_response (func1)            |
       |                              |<---------------------------------|
       |                              |  lua_response (func2)            |
       |                              |<---------------------------------|
       |  HTTP 200                    |                                  |
       |  [{result1}, {result2}]      |                                  |
       |<-----------------------------|                                  |
```

**Performance:**
- Batch API reduces IPC overhead by up to 10x
- Recommended for bulk operations
- Results maintain request order

#### Raw Lua Script Execution Flow

```
External Service                Bridge Service                  Community Patch DLL
       |                              |                                  |
       |  POST /lua/execute           |                                  |
       |  {"script":"return 42"}      |                                  |
       |----------------------------->|                                  |
       |                              |  lua_execute message             |
       |                              |--------------------------------->|
       |                              |                                  |
       |                              |  Evaluates script directly       |
       |                              |                                  |
       |                              |  lua_response message            |
       |                              |<---------------------------------|
       |  HTTP 200                    |                                  |
       |  {"success":true,"result":42}|                                  |
       |<-----------------------------|                                  |
```

### 2. Lua → External Service Function Call

#### Function Registration Flow

```
External Service                Bridge Service                  Community Patch DLL
       |                              |                                  |
       |  POST /external/register     |                                  |
       |  {name, url, async}          |                                  |
       |----------------------------->|                                  |
       |                              | Stores registration              |
       |  HTTP 200 {"success":true}   |                                  |
       |<-----------------------------|                                  |
       |                              |  external_register message       |
       |                              |--------------------------------->|
       |                              |                                  |
       |                              |  Creates Lua binding             |
       |                              |  (Game.CallExternal available)   |
```

**Post-Registration:**
- DLL creates Lua bindings for `Game.CallExternal(name, args)`
- Function persists until explicitly unregistered or DLL disconnects
- Automatically re-registered on Bridge→DLL reconnection

#### Function Invocation Flow

```
Game Lua Code                   Community Patch DLL              Bridge Service                  External Service
      |                                |                                  |                               |
      | Game.CallExternal(name, args)  |                                  |                               |
      |------------------------------->|                                  |                               |
      |                                |  external_call message           |                               |
      |                                |--------------------------------->|                               |
      |                                |                                  |  HTTP POST to registered URL  |
      |                                |                                  |------------------------------>|
      |                                |                                  |                               |
      |                                |                                  |  Processes request            |
      |                                |                                  |                               |
      |                                |                                  |  HTTP 200 {success, result}   |
      |                                |                                  |<------------------------------|
      |                                |  external_response message       |                               |
      |                                |<---------------------------------|                               |
      | Returns (result, error)        |                                  |                               |
      |<-------------------------------|                                  |                               |
```

**Execution Modes:**
- **Sync** (`async: false`): Lua code blocks until response received
- **Async** (`async: true`): Lua code continues, callback invoked on response

**Timeout Handling:**
- Default: 5 seconds (configurable per function)
- On timeout: Returns error to Lua, function remains registered
- See [error-handling.md](../../docs/developers/bridge-service/error-handling.md)

### 3. Game Event Streaming

#### Event Broadcasting Flow

```
Game Event Handler              Community Patch DLL              Bridge Service                  SSE Clients / Event Pipe
      |                                |                                  |                               |
      | Game.SendEvent(type, payload)  |                                  |                               |
      |------------------------------->|                                  |                               |
      |                                |  game_event message              |                               |
      |                                |--------------------------------->|                               |
      |                                |                                  |  Broadcasts to all clients    |
      |                                |                                  |------------------------------>|
      |                                |                                  |  SSE: event stream            |
      |                                |                                  |  Pipe: JSON + delimiter       |
```

**Event Batching:**
- Events buffered for 50ms or until 100 events accumulated
- Critical events (e.g., dll_status) flush immediately
- Improves throughput for high-frequency events

**Event ID Format:**
- Structure: `(turn * 1000000) + eventSequence`
- Example: Turn 1, Event 1 = `1000001`
- Example: Turn 123, Event 4567 = `123004567`
- Sequence resets each turn, persists across saves

**Blacklisted Events:**
High-frequency or low-value events are filtered. See [message-types.md](message-types.md#game-event) for complete list.

### 4. Game Pause Control

#### Auto-Pause Flow

```
External Service                Bridge Service                  Community Patch DLL              Game Core
       |                              |                                  |                               |
       |  POST /external/pause-player/0                               |                               |
       |----------------------------->|                                  |                               |
       |                              |  pause_player message            |                               |
       |                              |--------------------------------->|                               |
       |  HTTP 200                    |                                  | Adds player to pause set      |
       |  {pausedPlayers:[0]}         |                                  |                               |
       |<-----------------------------|                                  |                               |
       |                              |                                  |                               |
       |                              |  ... PlayerDoTurn event ...      |                               |
       |                              |<---------------------------------|                               |
       |                              | Checks active player ID          |                               |
       |                              | Player 0 in pause set            |                               |
       |                              |                                  | ProcessMessages() blocks      |
       |                              |                                  | Game paused (20ms sleep loop) |
```

**Auto-Pause Behavior:**
- Bridge tracks which players should trigger pause
- DLL blocks message processing when paused player is active
- `PlayerDoTurn` event triggers pause check
- `PlayerDoneTurn` event can trigger resume (if next player not paused)

**Manual Pause:**
- `POST /external/pause`: Manual pause (prevents auto-resume)
- `POST /external/resume`: Manual resume
- Manual pause takes precedence over auto-pause

**Pause Syncing:**
- Bridge syncs pause state with DLL via IPC messages
- DLL auto-clears paused players on disconnect (prevents stuck game)
- Bridge clears paused players on DLL disconnect

See [protocol.md](#auto-pause-on-player-turn-events) for detailed pause logic.

### Auto-Pause on Player Turn Events

The DLL performs the pause check internally using the paused player set synced from the Bridge Service:

1. **Player Turn Events (`PlayerDoTurn` / `PlayerDoneTurn`)**
   - The DLL checks the active player against its internal paused set during `ProcessMessages()`
   - If the active player is in the paused set, the game auto-pauses; otherwise it proceeds
   - The Bridge Service forwards these events to SSE clients but does not drive the pause decision

2. **DLL Disconnection**
   - On disconnect, Bridge clears all paused players
   - Prevents stuck pauses when game restarts

### DLL Message Processing Pause Behavior

When the DLL receives pause/unpause messages, it maintains an internal set of paused player IDs:

1. **Message Processing Loop**
   - The DLL's `ProcessMessages()` function checks if any active player is in the paused set
   - If paused: Blocks the game core thread, sleeping 20ms between checks, but still processes messages

2. **Pause Check Logic**
   - For regular turns: Checks if current player (GetActivePlayer) is paused
   - For simultaneous turns: Checks if ANY turn-active player is paused
   - Uses `ShouldPauseGameCore()` utility function for centralized logic

3. **Auto-Clear on Disconnect**
   - When Named Pipe disconnects, DLL automatically clears m_pausedPlayers set
   - Ensures game doesn't remain paused if Bridge Service crashes

## HTTP API Responses

All API endpoints use standardized response format. See [api-reference.md](api-reference.md#response-format) for details.

### Success Response
```json
{
  "success": true,
  "result": "<any-value>"
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": "Additional error details"
  }
}
```

## Error Handling

### Error Codes

Complete error code documentation: [error-handling.md](../../docs/developers/bridge-service/error-handling.md)

Quick reference:
- **DLL_DISCONNECTED**: Bridge lost connection to game DLL
- **LUA_EXECUTION_ERROR**: Lua script or function execution failed
- **CALL_TIMEOUT**: Function call exceeded timeout limit
- **CALL_FAILED**: External HTTP endpoint returned error
- **INVALID_FUNCTION**: Requested function not registered
- **INVALID_SCRIPT**: Malformed Lua script
- **INVALID_ARGUMENTS**: Wrong arguments provided
- **NETWORK_ERROR**: Network connectivity issues
- **SERIALIZATION_ERROR**: JSON parsing failed
- **INTERNAL_ERROR**: Internal bridge service error
- **NOT_FOUND**: Endpoint or resource not found

### Timeout Behavior

- **Lua Function Calls**: Default 300 second timeout
- **External Function Calls**: Configurable per function (default 5 seconds)
- **DLL Communication**: 300 second timeout for IPC operations
- **SSE Connections**: Keep-alive every 5 seconds

### Connection Recovery

#### DLL Connection Loss

1. Bridge detects named pipe/IPC disconnection
2. Bridge enters retry mode with exponential backoff (200ms → 5000ms max)
3. All pending requests fail with DLL_DISCONNECTED
4. Health check endpoint reports `dll_connected: false`
5. Upon reconnection, Bridge re-registers all external functions
6. Paused players list is cleared

#### External Service Unavailable

1. HTTP call to external service fails
2. Bridge returns error to Lua via DLL
3. Service remains registered for future calls
4. No automatic retry (handled by calling Lua code)

For detailed recovery strategies, see [error-handling.md](../../docs/developers/bridge-service/error-handling.md).

## Additional Documentation

- **API Endpoints**: [api-reference.md](api-reference.md)
- **Message Formats**: [message-types.md](message-types.md)
- **Configuration**: [configuration.md](../../docs/developers/bridge-service/configuration.md)
- **Error Handling**: [error-handling.md](../../docs/developers/bridge-service/error-handling.md)
- **Development**: [bridge-service overview](../../docs/developers/bridge-service/overview.md)
- **Event Pipe**: [event-pipe.md](event-pipe.md)
