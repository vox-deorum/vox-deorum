# mcp-server — Tools

Tools are the only part of the MCP server an agent ever sees. Each one is a named, schema-validated capability: it declares what it takes in, what it returns, and a description the agent reads to decide when to use it. This page explains how the tools are organized and how the framework behind them works. The exact per-tool parameter listings — every field of every tool — live in `mcp-server/docs/TOOLS.md`, which stays as reference and is not duplicated here.

## The four categories

The roughly three dozen tools fall into four groups, by what they touch. The split matters because each group answers a different kind of question and reaches a different subsystem.

- **General tools** are utilities that don't fit the other buckets: a `calculator` for arithmetic, a `search-database` that fuzzy-searches across all the game-database tools and reranks the combined results, and `lua-executor`, which runs a raw Lua script in the game and is the escape hatch when no purpose-built tool exists. Because `lua-executor` can run anything, it is a trust boundary — see [influence.md](influence.md).

- **Database-query tools** answer "what does this game thing do?" from Civilization V's own rules data — technologies, policies, buildings, civilizations, units, and the AI economic and military strategies and flavors. They read the game database, not live game state, so their answers are static for a given ruleset. See [database.md](database.md).

- **Knowledge-query tools** answer "what is happening in *this* game right now?" — recent events, player summaries, diplomatic opinions, cities, victory progress, available strategic options. They read the per-game knowledge store, which means their answers are already filtered by what the asking player can see. See [knowledge.md](knowledge.md).

- **Action tools** change the game rather than read it. Some steer the AI (set strategies, flavors, personas, diplomatic relationships, next research, next policy), some record agent decisions into the knowledge store (set metadata, relay a message, keep the status quo), and a couple control pacing directly (pause and resume a player's turn). The ones that steer the AI are the subject of [influence.md](influence.md).

For the complete list and every tool's parameters, see `mcp-server/docs/TOOLS.md`.

## How a tool is built

Every tool — and every resource, since resources share the same machinery — extends a single abstract class, `ToolBase` (`mcp-server/src/tools/base.ts`). A tool declares four things: a name, a description, an input schema, and an output schema, plus an `execute()` method that does the work. The schemas are written with [Zod](https://zod.dev), so they serve double duty: they validate inputs and outputs at runtime *and* generate the TypeScript types and the MCP protocol documentation the agent reads. Every schema field carries a `.describe()` string for exactly this reason.

Rather than extending `ToolBase` directly, most tools extend one of three specialized base classes in `mcp-server/src/tools/abstract/`, each capturing a common pattern:

- **`DatabaseQueryTool`** backs the database-query tools. A subclass implements two methods: one that returns a cached summary list of all items, and one that fetches the full detail of a single item. The base class handles fuzzy matching over the summaries and automatically returns full detail when a search narrows to exactly one result, so the agent gets a list when it's browsing and a complete answer when it's specific.

- **`LuaFunctionTool`** backs tools that run Lua in the game. The subclass points at either an inline script or a `.lua` file in `mcp-server/lua/` and declares the arguments that script expects; the base class handles loading and executing it through the bridge. See [bridge.md](bridge.md).

- **`DynamicEventTool`** backs tools that inject a custom event into the game's event stream. The subclass names the event type and builds its payload; the base class runs the payload through visibility analysis before it is stored, so the synthetic event respects fog of war the same way real events do. See [events.md](events.md).

## Registration and lifecycle

Tools are not instantiated eagerly. `mcp-server/src/tools/index.ts` holds a registry of factory functions — one per tool — and the server constructs each tool lazily on first initialization, then caches the instance and shares it across every client connection. Adding a tool therefore means writing its class in the right `src/tools/` subdirectory and adding its factory to that registry; from there it is exposed automatically to every connecting agent. The mechanics of writing and testing a new tool are covered in the server's own development guide and in [testing.md](../testing.md).

Because tool instances are shared across connections, they hold no per-client state — anything game-specific lives in the managers (database, knowledge, bridge) they call into, which keeps every agent looking at the same consistent game.
