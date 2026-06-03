# Bridge Service

The Bridge Service is the critical communication layer between Civilization V's Community Patch DLL and external AI services. It provides REST APIs, real-time event streaming, and sophisticated game state management.

## What's Implemented

- **Full REST API with SSE** - Complete HTTP endpoints for Lua function execution and real-time game event streaming
- **Named Pipe IPC** - Robust Windows named pipe connection with automatic reconnection and exponential backoff
- **Game Pause System** - Intelligent pause/resume with per-player auto-pause for AI processing
- **Message Batching** - High-performance IPC using custom delimiter protocol (`!@#$%^!`) for bulk operations
- **External Functions** - Register HTTP endpoints as Lua-callable functions with timeout management
- **Comprehensive Error Handling** - Typed error codes with automatic recovery mechanisms

## Architecture

```
External Services ← REST/SSE → Bridge Service ← Named Pipe → Civ5 DLL
                                     ↓
                          State Management & Events
                         (Pause, Functions, Broadcasting)
```

### Core Components

- **DLL Connector** ([src/services/dll-connector.ts](src/services/dll-connector.ts)) - Named pipe communication with message batching and infinite retry
- **Lua Manager** ([src/services/lua-manager.ts](src/services/lua-manager.ts)) - Function registry and script execution with validation
- **External Manager** ([src/services/external-manager.ts](src/services/external-manager.ts)) - HTTP endpoint registration with re-registration on reconnect
- **Pause Manager** ([src/services/pause-manager.ts](src/services/pause-manager.ts)) - Game pause control with manual/auto state tracking
- **Event Pipe** ([src/services/event-pipe.ts](src/services/event-pipe.ts)) - Named pipe event broadcasting (alternative to SSE)

## Quick Start

```bash
npm install
npm run build
npm start       # Production mode

# Development
npm run dev     # With hot reload and watch mode
```

## API Overview

### Service Control
```bash
# Health check
GET /health

# Graceful local shutdown
POST /shutdown
```

### Lua Operations
```bash
# Execute single function
POST /lua/call
{"function": "GetGameState", "args": {}}

# Batch multiple calls (optimized)
POST /lua/batch
[{"function": "GetUnit", "args": {"id": 1}}, {"function": "GetCity", "args": {"id": 2}}]

# Execute raw Lua script
POST /lua/execute
{"script": "return Game.GetGameTurn() * 2"}

# List registered functions
GET /lua/functions
```

### External Functions
```bash
# Register HTTP endpoint as Lua function
POST /external/register
{
  "name": "AnalyzeThreat",
  "url": "http://127.0.0.1:4000/analyze",
  "async": true,
  "timeout": 5000
}

# Game control
POST /external/pause               # Manual pause
POST /external/resume              # Resume game
POST /external/pause-player/:id    # Auto-pause for player
DELETE /external/pause-player/:id  # Remove auto-pause
```

### Event Streaming
```javascript
// Connect to SSE endpoint
const events = new EventSource('http://127.0.0.1:5000/events');
events.onmessage = (e) => {
  const event = JSON.parse(e.data);
  console.log(`Event ${event.id}: ${event.type}`);
};
```

**Complete API documentation:** [docs/API-REFERENCE.md](docs/API-REFERENCE.md)

### Runtime Shutdown URL File

When `BRIDGE_SHUTDOWN_URL_FILE` is set, the service writes a one-line file after it starts listening:

```text
http://127.0.0.1:<actual-port>/shutdown
```

This is intended for local launchers such as `scripts/vox-deorum.cmd`, so they can discover the real port without parsing logs or JSON.

## Configuration

Create `config.json` in the bridge-service root:

```json
{
  "rest": {
    "port": 5000,
    "host": "127.0.0.1"
  },
  "gamepipe": {
    "id": "vox-deorum-bridge",
    "retry": 5000
  },
  "eventpipe": {
    "enabled": true,
    "name": "vox-deorum-events"
  },
  "logging": {
    "level": "info"
  }
}
```

**Configuration details:** [docs/CONFIGURATION.md](docs/CONFIGURATION.md)

### Key Settings

- **Lua function timeout**: 300 seconds (hardcoded)
- **External function timeout**: 5 seconds default (configurable per registration)
- **SSE keep-alive**: 5 seconds
- **Pipe name format**: `\\.\pipe\tmp-app.{gamepipe.id}` (node-ipc adds prefix)

## Testing

```bash
npm test              # Run test suite
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

The test suite includes:
- Mock DLL server for isolation
- Integration tests with real IPC
- Extended timeouts for async operations
- Comprehensive error scenario coverage

**Testing guide:** [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#testing)

## Key Implementation Details

### Message Protocol
- Uses JSON with `!@#$%^!` delimiter for batching
- Thread-safe request tracking with unique IDs
- 300-second timeout with automatic cleanup

### Auto-Pause System
- Tracks manual vs automatic pause states
- Per-player registration for turn-based pausing
- Smart resume logic (only if not manually paused)
- Synced with DLL for reliable pause control

### Error Recovery
- Exponential backoff (200ms to 5s max)
- Infinite reconnection attempts to DLL
- Function re-registration after reconnection
- Graceful degradation when DLL unavailable

### Performance Optimizations
- Batch API reduces IPC overhead by 10x
- Event batching (50ms/100 events) for SSE and event pipe
- Efficient SSE client management
- Request queuing with overflow protection

**Implementation patterns:** [AGENTS.md](AGENTS.md)

## Development

### Debugging

Enable debug logging:
```bash
LOG_LEVEL=debug npm run dev
```

Or in `config.json`:
```json
{
  "logging": {
    "level": "debug"
  }
}
```

### Common Issues

**DLL Connection Failed**
- Ensure Civ5 running with modified DLL
- Check pipe name matches DLL config (`gamepipe.id`)
- Remember the `tmp-app.` prefix is added automatically
- Verify Windows Firewall settings

**Timeout Errors**
- Default timeout is 300s for Lua calls
- Check DLL performance/blocking
- Enable batch mode for bulk operations

**Event Stream Drops**
- SSE has 5s keep-alive
- Check network proxy settings
- Monitor client reconnection

**Troubleshooting guide:** [docs/ERROR-HANDLING.md](docs/ERROR-HANDLING.md)

## Integration Points

### With Civ5 DLL
- Named pipe: `\\.\pipe\tmp-app.vox-deorum-bridge` (node-ipc adds `tmp-app.` prefix)
- JSON protocol with delimited batching
- Function registration synchronization
- Event forwarding with structured payloads

### With MCP Server
- Primary game state data source
- Real-time event notifications via SSE
- Lua function execution gateway
- Game pause/resume control

### With External Services
- Any HTTP service can register functions
- Support for sync/async execution
- Configurable timeouts per function
- Automatic retry on network failures

**Protocol details:** [docs/PROTOCOL.md](docs/PROTOCOL.md)

## Documentation

- **[API Reference](docs/API-REFERENCE.md)** - Complete HTTP API documentation
- **[Configuration](docs/CONFIGURATION.md)** - Configuration options and examples
- **[Development Guide](docs/DEVELOPMENT.md)** - Development workflow, testing, debugging
- **[Message Types](docs/MESSAGE-TYPES.md)** - IPC message format reference
- **[Error Handling](docs/ERROR-HANDLING.md)** - Error codes and recovery strategies
- **[Protocol](docs/PROTOCOL.md)** - Communication protocol flows
- **[Event Pipe](docs/EVENT-PIPE.md)** - Named pipe event broadcasting
- **[Development Patterns](AGENTS.md)** - Internal development conventions

## Security Considerations

- CORS configured for development (restrict for production)
- Function name validation against injection
- URL validation for external endpoints
- Request size limit: 10MB
- Consider authentication for production

## Project Structure

```
bridge-service/
├── src/
│   ├── routes/          # API endpoints (lua, external, events)
│   ├── services/        # Core services (dll-connector, lua-manager, etc.)
│   ├── types/           # TypeScript interfaces
│   └── utils/           # Helpers & config
├── tests/
│   ├── connection/      # DLL connection tests
│   ├── routes/          # HTTP endpoint tests
│   └── test-utils/      # Mock DLL server & helpers
├── docs/                # Documentation
├── examples/            # Example client code
└── config.json          # Runtime configuration
```
