# mcp-server — Tools

Tools are the only part of the MCP server an agent ever sees. Each tool is a named, schema-validated capability: it declares what it takes in, what it returns, and a description the agent reads to decide when to use it.

This page explains how the tools are organized and how the framework behind them works. The exact per-tool parameter listings — every field of every tool — live in `mcp-server/docs/tools.md`, which stays as reference and is not duplicated here.

## The four categories

The roughly three dozen tools fall into four groups, by what they touch. The split matters because each group answers a different kind of question and reaches a different subsystem.

| Category | Answers | Reaches | Reference |
| --- | --- | --- | --- |
| **General** | utilities that don't fit elsewhere | varies | below |
| **Database-query** | "what does this game thing do?" | the game database (static rules) | [database.md](database.md) |
| **Knowledge-query** | "what is happening in *this* game right now?" | the per-game knowledge store | [knowledge.md](knowledge.md) |
| **Action** | changes the game rather than reads it | the AI, the knowledge store, or pacing | [influence.md](influence.md) |

**General tools** are utilities: `calculator` for arithmetic, `search-database`, which fuzzy-searches across all the game-database tools and reranks the combined results, and `lua-executor`, which runs a raw Lua script in the game. `lua-executor` is the escape hatch when no purpose-built tool exists. Because it can run anything, it is a trust boundary — see [influence.md](influence.md).

**Database-query tools** read Civilization V's own rules data — technologies, policies, buildings, civilizations, units, and the AI economic and military strategies and flavors. They read the game database, not live game state, so their answers are static for a given ruleset.

**Knowledge-query tools** read the per-game knowledge store — recent events, player summaries, diplomatic opinions, cities, victory progress, available strategic options. Their answers are already filtered by what the asking player can see.

**Action tools** divide into three kinds:

- Some steer the AI: set strategies, flavors, personas, diplomatic relationships, next research, next policy. These are the subject of [influence.md](influence.md).
- Some record agent decisions into the knowledge store: set metadata, relay a message, keep the status quo.
- A couple control pacing directly: pause and resume a player's turn.

One action tool stands apart: `present-decision`, used by the [human-control mode](../vox-agents/strategist.md#human-control-mode), pushes the current option landscape into the in-game decision panel rather than touching the AI.

For the complete list and every tool's parameters, see `mcp-server/docs/tools.md`.

## How a tool is built

Every tool extends a single abstract class, `ToolBase` (`mcp-server/src/tools/base.ts`). Resources share the same machinery and extend it too. A tool declares four things — a name, a description, an input schema, and an output schema — plus an `execute()` method that does the work.

The schemas are written with [Zod](https://zod.dev), so they serve double duty. They validate inputs and outputs at runtime, *and* they generate the TypeScript types and the MCP protocol documentation the agent reads. Every schema field carries a `.describe()` string for exactly this reason.

Most tools don't extend `ToolBase` directly. Instead they extend one of three specialized base classes in `mcp-server/src/tools/abstract/`, each capturing a common pattern:

- **`DatabaseQueryTool`** backs the database-query tools. A subclass implements two methods: one returns a cached summary list of all items, the other fetches the full detail of a single item. The base class handles fuzzy matching over the summaries and automatically returns full detail when a search narrows to exactly one result. So the agent gets a list when browsing and a complete answer when specific.
- **`LuaFunctionTool`** backs tools that run Lua in the game. The subclass points at an inline script or a `.lua` file in `mcp-server/lua/` and declares the arguments that script expects. The base class handles loading and executing it through the bridge. See [bridge.md](bridge.md).
- **`DynamicEventTool`** backs tools that inject a custom event into the game's event stream. The subclass names the event type and builds its payload. The base class runs the payload through visibility analysis before it is stored, so the synthetic event respects fog of war the same way real events do. See [events.md](events.md).

## Registration and lifecycle

Tools are not instantiated eagerly. `mcp-server/src/tools/index.ts` holds a registry of factory functions, one per tool. The server constructs each tool lazily on first initialization, then caches the instance and shares it across every client connection.

Adding a tool therefore means two steps:

1. Write its class in the right `src/tools/` subdirectory.
2. Add its factory to the registry in `src/tools/index.ts`.

From there it is exposed automatically to every connecting agent. The mechanics of writing and testing a new tool are covered in the server's own development guide and in [testing.md](../testing.md).

Because tool instances are shared across connections, they hold no per-client state. Anything game-specific lives in the managers (database, knowledge, bridge) they call into, which keeps every agent looking at the same consistent game.
