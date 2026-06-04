# MCP Server

The MCP (Model Context Protocol) server exposes Civilization V game state and controls to AI agents. It provides a comprehensive toolkit for game analysis, decision-making, and automated gameplay through standardized MCP interfaces.

## What's Implemented

- **33 MCP Tools** across 5 categories with Zod validation
- **Real-time Event Integration** - SSE and Windows named pipe (event pipe) for game events
- **Civ5 Database Access** - Kysely ORM with multi-language localization and TXT_KEY resolution
- **Knowledge Management** - Per-game persistent state tracking with auto-save and player visibility filtering
- **Tool Framework** - Abstract base classes with factory pattern and type-safe schemas
- **Bridge Integration** - Queue-based Lua execution with batching and auto-pause
- **Multi-Transport Support** - Both stdio and HTTP transports for MCP clients

## Architecture

```
AI Agents ← MCP Protocol → MCP Server ← HTTP/SSE → Bridge Service ← Named Pipe → Civ5 DLL
                                ↓              ↑
                    Knowledge Store      Event Pipe (Windows)
                  (SQLite per game)
                        ↓
                 Civ5 Game Database
                  (SQLite, read-only)
```

### Core Components

- **Server** (`server.ts`) - Singleton MCPServer managing multiple client connections
- **Tool Framework** (`base.ts`, `tools/`) - Abstract base classes with factory pattern
- **Bridge Manager** (`bridge/manager.ts`) - Queue-based Lua execution with SSE/event pipe
- **Database Manager** (`database/manager.ts`) - Multi-database access with caching and localization
- **Knowledge Manager** (`knowledge/manager.ts`) - Per-game state persistence with auto-save
- **Knowledge Store** (`knowledge/store.ts`) - SQLite persistence with versioning and visibility

## Available Tools

### General Tools (3)
- `calculator` - Evaluate mathematical expressions using mathjs
- `lua-executor` - Execute raw Lua scripts in game context via Bridge Service
- `search-database` - Fuzzy search across all database tools with reranked results

### Database Query Tools (8)
- `get-technology` - Technology info with prerequisites and unlocks
- `get-policy` - Policy details and branch information
- `get-building` - Building specifications and requirements
- `get-civilization` - Civilization traits and leader abilities
- `get-unit` - Unit statistics, promotions, upgrades
- `get-economic-strategies` - AI economic strategy info with production/overall flavors
- `get-military-strategies` - AI military strategy info with production/overall flavors
- `get-flavors` - Flavor descriptions for AI preference tuning

### Knowledge Query Tools (11)
- `get-events` - Recent game events with turn/type/player filtering
- `get-diplomatic-events` - Diplomatic events (wars, peace, deals) grouped by turn
- `get-players` - Player summary information (economy, military, diplomacy)
- `get-opinions` - Diplomatic opinions to/from a player
- `get-cities` - City info from a player's perspective with owner filtering
- `get-game-settings` - Static game settings (speed, map, difficulty, victory types)
- `get-metadata` - Read a metadata value by key from the knowledge store
- `get-options` - Available strategic options (technologies, policies, strategies)
- `summarize-units` - Unit overview grouped by civilization and AI type
- `get-military-report` - Military report with units by AI type and tactical zones
- `get-victory-progress` - Victory progress for all players filtered by visibility

### Action Tools (10)
- `set-strategy` - Set grand, economic, and military strategies
- `set-persona` - Set diplomatic personality values (26 traits)
- `set-relationship` - Set diplomatic modifiers with another major civilization
- `set-flavors` - Set flavor values (0-100) and grand strategy
- `unset-flavors` - Clear all custom flavor values
- `set-metadata` - Store session metadata key-value pair
- `set-research` - Set next research technology
- `set-policy` - Set next policy selection
- `keep-status-quo` - Maintain current strategy with documented rationale
- `relay-message` - Relay diplomatic or intelligence message as game event, with high-importance relays interrupting pacing

### Game Control Tools (2)
- `pause-game` - Pause game during a player's turn
- `resume-game` - Resume game during a player's turn

> See [docs/TOOLS.md](docs/TOOLS.md) for detailed parameter reference.

## Quick Start

```bash
npm install
npm run build
npm start         # Production mode

# Development
npm run dev       # Hot reload with tsx
npm test          # Run test suite
```

## HTTP Endpoints

When running in HTTP transport mode, the server exposes:

```bash
GET /health
POST /shutdown
POST /mcp
GET /mcp
DELETE /mcp
```

`POST /shutdown` is intended for local orchestration and performs a graceful shutdown.

### Runtime Shutdown URL File

When `MCP_SHUTDOWN_URL_FILE` is set, the HTTP server writes a one-line file before initialization begins and rewrites it after the HTTP server binds:

```text
http://127.0.0.1:<actual-port>/shutdown
```

This lets launchers discover the real bound port without parsing logs.

## Configuration

Edit `config.json`:
```json
{
  "server": {
    "name": "vox-deorum-mcp-server",
    "version": "1.0.0"
  },
  "bridgeService": {
    "endpoint": {
      "host": "127.0.0.1",
      "port": 5000
    },
    "eventPipe": {
      "enabled": true,
      "name": "vox-deorum-events"
    }
  },
  "logging": {
    "level": "info"
  }
}
```

Hardcoded settings:
- Knowledge auto-save interval: 30 seconds
- Bridge retry delay: 5 seconds
- Database paths: auto-detected from standard Civ5 installation

## Key Implementation Details

### Bridge Integration
- Queue-based request management with batching (up to 50 Lua calls)
- SSE and event pipe (Windows named pipe) for real-time events
- Auto-pause game when queue reaches capacity
- Automatic reconnection with 5s retry

### Database Features
- Multi-database support (Gameplay, Localization)
- Automatic TXT_KEY resolution with fallbacks
- Connection pooling and localization caching
- Schema introspection with column metadata

### Knowledge System
- Per-game SQLite databases (`data/{gameId}.db`)
- Player visibility filtering (22-player fog of war)
- Versioned mutable knowledge with change tracking
- Automatic 30s interval saves
- Event-based knowledge updates from game events

> See [docs/KNOWLEDGE.md](docs/KNOWLEDGE.md) for architecture details.

### Error Handling
- MCP-compliant error responses
- Graceful Bridge Service disconnection
- Database connection recovery
- Tool execution isolation

## Testing

```bash
npm test                  # Run all tests
npm run test:watch        # Watch mode
npm run test:coverage     # Coverage report
```

Tests include:
- Real MCP client integration (both stdio and HTTP transports)
- Tool schema validation
- Bridge mock responses
- Database query verification

> See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for testing patterns and debugging.

## Integration Points

### With Bridge Service
- Primary communication channel to game
- Lua script execution gateway
- Real-time event streaming (SSE + event pipe)
- Game pause/resume control

### With Vox Agents
- MCP client connects via stdio/HTTP
- Tool execution for game queries and actions
- Knowledge storage for AI memory
- Event notifications for turn updates

### With Game Database
- Direct SQLite access to game rules (read-only)
- Localization for all text content
- Unit/building/tech/strategy specifications

## Project Structure

```
mcp-server/
├── src/
│   ├── server.ts           # Main MCP server (singleton)
│   ├── base.ts             # ToolBase abstract class
│   ├── bridge/             # Bridge Service integration
│   │   ├── manager.ts      # BridgeManager (queue, SSE, HTTP)
│   │   ├── http-client.ts  # HTTP client for Bridge
│   │   └── lua-function.ts # Lua script execution wrapper
│   ├── database/           # Civ5 database access
│   │   ├── manager.ts      # DatabaseManager
│   │   ├── database.d.ts   # Auto-generated type definitions
│   │   └── enums/          # Enum type definitions
│   ├── knowledge/          # Game state management
│   │   ├── manager.ts      # KnowledgeManager orchestrator
│   │   ├── store.ts        # KnowledgeStore (SQLite persistence)
│   │   ├── schema/         # Data type definitions
│   │   ├── getters/        # Data extraction via Lua
│   │   └── expressions.ts  # Kysely query helpers
│   ├── tools/              # MCP tool implementations
│   │   ├── index.ts        # Tool factory registry
│   │   ├── abstract/       # Abstract tool base classes
│   │   ├── general/        # General purpose tools
│   │   ├── databases/      # Game database query tools
│   │   ├── knowledge/      # Knowledge query tools
│   │   └── actions/        # Game control/action tools
│   └── utils/              # Utilities (logger, config, etc.)
├── lua/                    # Lua scripts for in-game execution
├── tests/                  # Vitest test suite
├── docs/                   # Documentation
│   ├── DEVELOPMENT.md      # Development guide
│   ├── TOOLS.md            # Tool reference
│   ├── KNOWLEDGE.md        # Knowledge system architecture
│   ├── events/             # Game event documentation
│   ├── flavors/            # AI flavor documentation
│   ├── strategies/         # Strategy reference data
│   ├── database/           # Database schema exports
│   └── api/                # Auto-generated TypeDoc
├── data/                   # Per-game knowledge databases
├── config.json             # Configuration
├── package.json            # Dependencies & scripts
└── vitest.config.ts        # Test configuration
```
