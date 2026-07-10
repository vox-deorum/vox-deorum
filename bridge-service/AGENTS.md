# AGENTS.md - Bridge Service Development Guide

This guide provides essential patterns and conventions for the Bridge Service that aren't covered in the README.

## Architecture Patterns

### Singleton Services
Core components are exported as singleton instances for consistent state management. Only `DLLConnector` extends `EventEmitter`, because callers subscribe to its DLL-driven events (`game_event`, `connected`, `disconnected`, and so on). The other singletons (`BridgeService`, `PauseManager`, `EventPipe`) are plain classes that expose their behaviour through direct method calls.

### Layered Architecture
- `src/index.ts` - Express setup and middleware
- `src/service.ts` - Main orchestration (BridgeService class)
- `src/routes/` - HTTP endpoints
- `src/services/` - Core business logic (singletons)
- `src/utils/` - Shared utilities

## Error Handling Patterns

### Standardized API Responses
- Use helper functions for consistent response format: `respondSuccess()` and `respondError()`
- Wrap all route handlers with `handleAPIError()` for proper error handling
- Include appropriate error codes and detailed messages for debugging

## SSE Implementation

### Client Management Pattern
- Use Map for client registry to manage SSE connections efficiently
- Implement auto-cleanup on disconnect to prevent memory leaks
- Clear intervals and timers when connections close

### Resilient Broadcasting
- Check connection state before sending messages
- Track disconnected clients during broadcast iteration
- Clean up disconnected clients after iteration completes
- Handle errors gracefully without affecting other connections

### Keep-Alive Pattern
Always implement 5-second keep-alive pings for SSE connections to prevent timeout.

## IPC Communication

### Message Batching Protocol
- Use delimiter `!@#$%^!` for message batching
- Join messages with delimiter before sending
- Split and parse messages using the same delimiter
- Filter out empty messages during parsing

### Reconnection Strategy
- Implement exponential backoff with maximum delay cap (5000ms)
- Start with 200ms base delay, multiply by 1.5 per attempt
- Always check shutdown state before reconnecting
- Prevent reconnection during graceful shutdown

## State Management

### Game Pause Manager Pattern
- Track paused player IDs using a Set for efficient lookups
- Manual pause is held through a named Windows mutex; the paused state is derived from `mutex !== null` rather than a separate boolean flag
- Sync the paused player set with the DLL via IPC messages
- The DLL performs the actual turn-based pausing from its own paused set, so the bridge does not track the active player
- Clear the paused player set on DLL disconnect to avoid stuck pauses

### Function Registry Pattern
- Use Map for dynamic function registration and management
- Listen to connector events for function updates
- Store function metadata alongside implementations
- Clear registry on disconnect to maintain consistency

## Performance Optimizations

### Batch Operations
- Always provide batch endpoints to reduce IPC overhead
- Support both single and batch operations for flexibility
- Prefer batch calls when performing multiple operations
- Limit batch size to prevent timeout issues

### IPC Connection
- Single named pipe connection to the DLL via node-ipc
- Automatic reconnection with exponential backoff (200ms base, capped at 5s)
- Request tracking with UUID-based message correlation and 300s timeout

## Module System
- **ESM imports**: When you see `import from '*.js'`, read the corresponding .ts file instead

## Testing Patterns

### Framework
- Use **Vitest**, not Jest, for testing
- Test files in `tests/` directory with `.test.ts` extension
- Commands: `npm test`, `npm run test:watch`, `npm run test:coverage`
- Test setup: `tests/setup.ts` for global configuration

### Mock DLL Server
- Create comprehensive mocks that implement the full IPC protocol
- Extend EventEmitter for event simulation
- Support adding Lua functions dynamically for testing
- Enable game event simulation for integration tests

### Test Configuration
- Configure mock servers with adjustable response delays
- Use faster delays for tests (e.g., 50ms)
- Control automatic events generation (manual vs auto)
- Support both delay simulation and instant responses

## Common Pitfalls

1. **Don't forget request cleanup** - Always clear timeouts on response
2. **Check connection state** - Verify `res.destroyed` before SSE writes
3. **Handle batch parsing errors** - Individual message failures shouldn't crash batch processing
4. **Understand pause ownership** - Manual pause is held via the mutex; the DLL owns turn-based pausing from its synced player set
5. **Clean up on shutdown** - Implement graceful cleanup in all services

## Development Workflow

### Adding New Endpoints
1. Define route in appropriate domain file
2. Wrap with `handleAPIError`
3. Use standard response format
4. Add to OpenAPI documentation if public
5. Create batch variant if applicable

### Adding New Services
1. Export a singleton instance
2. Implement a shutdown()/stop() method
3. Register with BridgeService
4. Add error recovery logic
5. Only extend EventEmitter when callers need to subscribe to asynchronous events (as DLLConnector does)

### Debugging
- Enable debug logs: `LOG_LEVEL=debug`
- Monitor IPC traffic in console
- Check SSE connections via `/events` endpoint
- Use mock DLL server for isolated testing

## Integration Guidelines

### With DLL
- All communication through DLLConnector singleton
- Handle disconnections gracefully
- Implement reconnection logic

### With MCP Server
- MCP connects as SSE client
- Bridge broadcasts all game events
- No direct Bridge → MCP calls

### With External Services
- Register functions via `/external/register`
- Include timeout configuration
- Handle network errors specifically