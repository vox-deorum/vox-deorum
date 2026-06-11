# AGENTS.md - MCP Server Development Guide

This guide provides essential patterns and conventions for the MCP Server that aren't covered in the README.

**Developer guide:** [mcp-server overview](../docs/developers/mcp-server/overview.md) (role, modes, how tools are organized) and [setup.md](../docs/developers/setup.md) (build and run). **Reference in `docs/`:** [tools.md](docs/tools.md) (tool reference), [knowledge.md](docs/knowledge.md) (knowledge system). Reference data: `docs/events/`, `docs/flavors/`, `docs/strategies/`.

## MCP Protocol Implementation

### Singleton Server Architecture
- One singleton MCPServer manages multiple McpServer instances
- Each client connection gets its own McpServer instance
- Tools and managers are shared across all connections
- Centralized management of server lifecycle

### Transport Support
- Server supports both stdio and HTTP transports
- Transport type determined by configuration
- **Always test with both transports** using `TEST_TRANSPORT` environment variable
- Each transport has specific initialization and cleanup requirements

### Event Notifications
- Use `elicitInput` for client notifications
- Include relevant game context (playerID, turn, latestID)
- Set appropriate timeout values for responsiveness
- Schema should match expected client response format

## Tool Development Patterns

### Tool Base Architecture
- All tools inherit from `ToolBase` abstract class
- Required properties: name, description, input/output schemas
- Required method: execute() for tool logic
- **Resources and tools both extend ToolBase** to share the same infrastructure
- Use Zod schemas for validation and type safety

### Factory Pattern with Lazy Loading
- Tools are defined as factory functions returning ToolBase instances
- Factory map contains all available tool constructors
- **Tools are instantiated lazily** on first server init
- Tool instances are cached and shared across connections
- This pattern reduces startup time and memory usage

### Abstract Classes for Common Patterns

#### Database Query Tools
- Extend `DatabaseQueryTool` for database-backed tools
- Generic types: TSummary for list items, TFull for detailed info
- **Pattern**: Cache summaries, fetch full details only when needed
- Implement `fetchSummaries()` and `fetchFullInfo()` methods
- Automatic cache management for performance

#### Lua Function Tools
- Extend `LuaFunctionTool` for tools that execute Lua scripts
- Support both inline scripts and external script files
- Script files should be placed in the `lua/` directory
- Automatic script loading and execution handling

### Zod Schema Validation
- Define input/output schemas using Zod for type safety
- **Always use `.describe()`** for MCP protocol documentation
- Support optional fields with defaults
- Use appropriate Zod types (string, number, object, array, etc.)
- Schemas provide both TypeScript types and runtime validation

## Module System

### TypeScript & ESM
- Project uses ESM modules ("type": "module" in package.json)
- **Critical**: Always use `.js` extensions in imports, even for `.ts` files
- Follow strict TypeScript configuration for type safety
- TypeScript compiles to ES modules for Node.js compatibility

### Logging
- **Always use the project's logger** instead of console.log/console.error
- Import and create logger with component context
- Available log levels: debug, info, warn, error
- Logger automatically handles formatting, colors, and file output
- Use structured logging with metadata objects for errors
- Log files are rotated automatically (10MB max size)

### Code Structure
- Source code in `src/` directory
- Utilities in `src/utils/` subdirectory
- Tools in `src/tools/` subdirectory
- Tests mirror source structure in `tests/` directory
- Built output goes to `dist/` directory (gitignored)

## Testing

### Framework
- **Use Vitest for all testing** (not Jest)
- Test files in `tests/` directory with `.test.ts` extension
- Commands:
  - `npm test` - Run tests
  - `npm run test:watch` - Watch mode
  - `npm run test:coverage` - Coverage report
- Test setup file: `tests/setup.ts` for global configuration

### Real MCP Client Integration
- Create MCP client instances for integration testing
- Connect client to server using appropriate transport
- Set adequate timeouts for connection establishment (15 seconds)
- Clean up connections in afterAll hooks

### Transport-Agnostic Testing
- Test both stdio and HTTP transports
- Use `TEST_TRANSPORT` environment variable to switch
- Default to HTTP transport if not specified
- Ensure tests pass with both transport types

### Tool Testing Pattern
- Use `calculator.ts` tool as template for new tools
- Use `calculator.test.ts` as test template
- **Always test through MCP client calls**, not direct method invocation
- Test input validation, error handling, and expected outputs
- Tool/resource tests should use the mcpClient object exported by setup.ts
- Verify both successful operations and error cases

## Game State Management

### Multi-Level Caching
1. **Tool-Level**: Database tools cache summaries
2. **Manager-Level**: DatabaseManager caches connections and localization
3. **Knowledge Store**: SQLite databases per game in `data/{gameId}.db`

### Game Context Switching
- Check game identity on each significant operation
- Compare current gameId with stored gameId
- Switch context when game changes
- **Each game gets its own SQLite database** with automatic migration
- Clean up old game data based on retention policy

### Knowledge Persistence
- Extend TimedKnowledge for versioned data
- Track version numbers for change detection
- Mark latest versions with IsLatest flag
- Store change history in Changes array
- **Pattern**: Version tracking with player visibility and change detection
- Support rollback and audit trail functionality

## Database Development

### SQLite Queries
- **Always use `is` and `is not`** for SQLite null checking (not `=` or `!=`)
- Before implementing a database-related tool, always check the schema
- When you need a database table that's commented, uncomment it

### Type Patterns with Kysely
- Use `Generated<T>` for auto-managed database fields
- Use `JSONColumnType<T>` for JSON data columns
- Extend base interfaces for specialized knowledge types
- Keep interfaces aligned with database schema

### Player Visibility
- Track visibility for up to 22 players (Player0-Player21)
- Use Generated<number> for visibility flags (0 or 1)
- Check visibility before exposing sensitive game data
- Respect fog of war and player perspective

## Lua Script Development

### Script Organization
- Standalone Lua scripts must be placed in the `lua/` directory
- Follow existing patterns (e.g., `event-visibility.lua`, `game-identity.lua`)

### API Usage
**IMPORTANT**: Always check `civ5-dll/CvGameCoreDLL_Expansion2/Lua/` for existing Civ5 Lua APIs:
- Check wrapper classes: CvLuaGame, CvLuaPlayer, CvLuaUnit, CvLuaCity, etc.
- Use existing patterns like `LuaFunction` for callbacks
- **Never invent non-existent APIs**
- Scripts executed in-game have access to all Civ5's exposed Lua APIs

### Execution Context
Scripts are executed within the game context via BridgeManager

## Bridge Service Integration

### BridgeManager Usage
- **Always use BridgeManager** for all Bridge Service communication
- Located in `src/bridge/manager.ts`
- **Do NOT use direct fetch/HTTP calls** to the Bridge Service
- BridgeManager provides methods for Lua script execution, function calls, and SSE handling
- Follow protocol.md specifications

### Queue-Based Request Management
- Process batches of up to 50 Lua calls
- Auto-pause game when queue reaches capacity
- Track overflow state to manage resume
- **Performance**: Batch operations to reduce IPC overhead
- Implement backpressure to prevent memory issues

### Connection Pools
- Maintain separate pools for different operation types
- Standard pool: 50 connections for regular operations
- Fast pool: 5 connections for time-critical operations
- **Use `fast: true`** for low-latency operations (pause/resume)

### SSE Event Processing
- Parse incoming events as GameEvent type
- Handle dll_status events to track connection state
- Reset functions when DLL disconnects
- Emit events for other components to consume
- Handle connection failures and retry logic gracefully

## Build & Development

### Commands
- `npm run dev` - Development with hot reload using tsx
- `npm run build` - TypeScript compilation to dist/
- `npm run type-check` - TypeScript type checking without emit
- `npm run lint` - ESLint code quality checks

## Performance Considerations

### Lazy Loading
- Tools loaded on first init
- Database connections cached per session
- Localization results cached in memory
- Summary data cached at tool level

### Batch Processing
- Lua calls: Up to 50 per batch
- Knowledge storage: Batched writes
- Event processing: Async with queue management

### Auto-Pause Management
- Pause game when queue length exceeds threshold (50)
- Resume game when queue drains below threshold
- Track overflow state to prevent pause/resume thrashing
- Coordinate with game mutex manager

### Memory Management
- Auto-save every 30 seconds
- HTTP connection pooling via undici
- Proper SQLite cleanup on shutdown

## Development Guidelines

### Creating New Tools
1. **Extend abstract base classes** (`DatabaseQueryTool`, `LuaFunctionTool`) not `ToolBase` directly
2. **Use factory functions** for proper caching
3. **Add to toolFactories** in `tools/index.ts`
4. **Use Zod schemas** for validation
5. **Implement MCP-compliant error handling**
6. **Cache appropriately** for performance
7. **Consider player visibility** for game data

### Adding New Fields to Knowledge Tables
When adding a new field to an existing knowledge table (e.g., PlayerSummary):

1. **Update TypeScript Schema** - Add field to interface with proper type and documentation
2. **Update Lua Data Collection** - Modify corresponding Lua script to collect the new field
3. **Update Database Schema** - Add column to table creation (no migration needed - data is ephemeral)
4. **Update Related Tools** - Add field to Zod schemas in tools that expose this data
5. **Test the Changes** - Run type-check and verify in new game session

### Common Pitfalls
1. **Forgetting `.js` extensions** in imports
2. **Direct HTTP calls** instead of using BridgeManager
3. **Not testing both transports**
4. **Ignoring player visibility** in knowledge storage
5. **Not batching operations** for multiple Lua calls
6. **Using `=` or `!=`** for SQLite null checks (use `is`/`is not`)

### MCP Protocol Compliance
- Always follow Model Context Protocol specifications
- Use the official @modelcontextprotocol/sdk package
- Implement proper resource and tool registration
- Handle errors gracefully with proper MCP error responses
- Support multiple transport methods (stdio, HTTP)

## Integration Points

### With Bridge Service
- Connect as SSE client to `/events`
- Use BridgeManager for all communication
- Handle connection loss gracefully

### With Vox Agents
- Agents connect via MCP protocol
- Tools exposed automatically on connection
- Event notifications via `elicitInput`

### Event System
- Each event has typed Zod schema for validation
- Common event types: GameSave, PlayerTurn, CityFounded, etc.
- Events undergo visibility analysis before storage
- Visibility analysis determines which players can see the event
- Results stored as PlayerVisibility flags (0 or 1 per player)