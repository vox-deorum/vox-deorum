# mcp-server: Tools

Tools are the only part of the MCP server an agent ever sees. Each tool is a named, schema-validated capability: it declares what it takes in, what it returns, and a description the agent reads to decide when to use it.

This page explains how the tools are organized and how the framework behind them works. The exact per-tool parameter listings, every field of every tool, stay in the reference at `mcp-server/docs/tools.md` rather than being repeated here.

## The categories

The registry in `mcp-server/src/tools/index.ts` holds 43 tools. The reference groups them into five categories by what they touch, because each group answers a different kind of question and reaches a different subsystem.

| Category | Count | Answers | Reaches |
| --- | --- | --- | --- |
| **General** | 4 | utilities that don't fit elsewhere | varies |
| **Database-query** | 8 | "what does this game thing do?" | the game database ([database.md](database.md)) |
| **Knowledge-query** | 13 | "what is happening in _this_ game right now?" | the per-game knowledge store ([knowledge.md](knowledge.md)) |
| **Action** | 15 | changes the game rather than reads it | the AI, the knowledge store, or the game itself |
| **Game control** | 3 | paces the game | the bridge's pause controls ([bridge.md](bridge.md)) |

**General tools** are the four utilities: `calculator` for arithmetic; `search-database`, which fuzzy-searches the game-database tools and reranks the combined results; `call-lua-function`, which calls a Lua function the game mod has registered, passing structured arguments; and `lua-executor`, which runs a raw Lua script in the game. `lua-executor` is the escape hatch when no purpose-built tool exists. Because it can run anything, it is a trust boundary, discussed in [influence.md](influence.md).

`search-database` does not cover every database tool. It searches technologies, policies, buildings, civilizations, units, and flavors: six of the eight. The two AI-strategy tools (`get-economic-strategies` and `get-military-strategies`) are deliberately excluded from its list, so an agent looking for a strategy must call those tools directly.

**Database-query tools** read Civilization V's own rules data: technologies, policies, buildings, civilizations, units, and the AI economic and military strategies and flavors. They read the game database, not live game state, so their answers are static for a given ruleset.

**Knowledge-query tools** read the per-game knowledge store: recent events, player summaries, diplomatic opinions, cities, victory progress, available strategic options, and diplomatic transcripts and draft deals. Their answers are already filtered by what the asking player can see.

**Action tools** divide into four kinds:

- Some steer the AI: set strategies, flavors, personas, diplomatic relationships, next research, next policy. These are the subject of [influence.md](influence.md).
- Some record agent decisions into the knowledge store: `set-metadata`, `relay-message`, `keep-status-quo`.
- The **deal tools** (`append-message`, `enact-agent-deal`, `reject-agent-deal`, and their read-side counterparts `read-transcript` and `inspect-deal`) carry agent-to-agent negotiation and turn an agreed draft into a real in-game deal. The full round trip is [diplomacy.md](../diplomacy.md).
- Two push content at a human watching the game: `post-notification` raises a native in-game notification, and `present-decision`, used by the [human-control mode](../vox-agents/strategist.md#human-control-mode), pushes the current option landscape into the in-game decision panel.

**Game-control tools** (`pause-game`, `resume-game`, `set-production-mode`) do not change the game world at all. They change when it runs, which is how an agent buys itself time to think.

For the complete list and every tool's parameters, see `mcp-server/docs/tools.md`.

## How a tool is built

Every tool extends the abstract class `ToolBase` (`mcp-server/src/tools/base.ts`), directly or through one of the specialized bases below. A tool declares four things (a name, a description, an input schema, and an output schema) plus an `execute()` method that does the work.

The schemas are written with [Zod](https://zod.dev), so they serve double duty. They validate inputs and outputs at runtime, _and_ they generate the TypeScript types and the MCP protocol documentation the agent reads. Every schema field carries a `.describe()` string for exactly this reason.

Extending `ToolBase` directly is the common case: 23 of the 43 tools do it, mostly the knowledge-query tools and the one-off actions whose work has no shared shape. The other 20 use one of four abstract bases in `mcp-server/src/tools/abstract/`, each capturing a recurring pattern:

| Base class | Tools | What it provides |
| --- | --- | --- |
| `DatabaseQueryTool` | 8 | fuzzy matching over cached summaries |
| `ActionTool` | 8 | the shared shape of a Lua-backed state change |
| `LuaFunctionTool` | 3 | loading and running a Lua script through the bridge |
| `DynamicEventTool` | 1 | injecting a synthetic event into the knowledge store |

- **`DatabaseQueryTool`** backs the database-query tools. A subclass implements two methods: one returns a cached summary list of all items, the other fetches the full detail of a single item. The base class handles fuzzy matching over the summaries and automatically returns full detail when a search narrows to exactly one result. So the agent gets a list when browsing and a complete answer when specific.
- **`LuaFunctionTool`** backs tools that run Lua in the game. The subclass points at an inline script or a `.lua` file in `mcp-server/lua/` and declares the arguments that script expects. The base class handles loading and executing it through the bridge. See [bridge.md](bridge.md).
- **`ActionTool`** extends `LuaFunctionTool` and is the shared base for the whole steering family: `set-strategy`, `set-persona`, `set-relationship`, `set-flavors`, `unset-flavors`, `set-research`, `set-policy`, and `keep-status-quo`. On top of the Lua plumbing it adds what every state change needs, including the recorded source turn. This is the base [influence.md](influence.md) is built around.
- **`DynamicEventTool`** backs tools that write a synthetic event into the knowledge store. The subclass names the event type and builds its payload. The base class then computes visibility itself, in TypeScript, rather than asking the game: it grants full visibility to the tool's explicit `PlayerID` or `VisibleTo` argument and none to anyone else. That is not the same analysis real events get, and the difference matters; see [events.md](events.md). `relay-message` is currently the only tool on this base.

The framework covers tools and nothing else: the server defines no MCP resources, and nothing in `mcp-server/src` registers any, despite a stale comment in `server.ts` that mentions resource registration.

## Registration and lifecycle

Tools are not instantiated eagerly. `mcp-server/src/tools/index.ts` holds a registry of factory functions, one per tool. The server constructs each tool lazily on first initialization, then caches the instance and shares it across every client connection.

Adding a tool therefore means two steps:

1. Write its class in the right `src/tools/` subdirectory.
2. Add its factory to the registry in `src/tools/index.ts`.

From there it is exposed automatically to every connecting agent. The mechanics of writing and testing a new tool are covered in `mcp-server/AGENTS.md` and in [testing.md](../testing.md).

Because tool instances are shared across connections, they hold no per-client state. Anything game-specific lives in the managers (database, knowledge, bridge) they call into, which keeps every agent looking at the same consistent game.
