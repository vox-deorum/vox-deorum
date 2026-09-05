# mcp-server: Knowledge

The knowledge system is the MCP server's memory. An agent reasoning about a game needs more than a snapshot of the current turn. It needs a persistent record of what has happened, and that is what this system holds: a per-game record of every event and the state of every player and city, all filtered by what each player is allowed to see.

The knowledge-query tools read from here. That is why they can answer "what did this civilization do over the last ten turns?" without ever touching the live game.

The source lives in `mcp-server/src/knowledge/`. This page explains how the system is shaped; how events flow _into_ it is the subject of [events.md](events.md).

## The two halves

The system splits cleanly in two.

- **The manager** (`knowledge/manager.ts`) is the orchestrator. It watches the bridge for events and DLL-status changes, detects when the active game changes, owns the current per-game store, runs the auto-save timer, and pushes notifications back to MCP clients. It knows _which_ game is in play.
- **The store** (`knowledge/store.ts`) is the persistence layer, one SQLite database per game at `data/{gameId}.db`. It validates incoming events, writes them, holds the snapshots of player and city state, and answers queries. It knows _what_ is in the game.

When the game changes, the manager detects the new game identity, saves and closes the old store, opens a new one, and notifies clients with a `GameSwitched` notification. Each game thus gets its own isolated database. Because that data is ephemeral and rebuilt from the game, there are no schema migrations: tables are simply created if they don't exist.

The store uses Kysely over SQLite in WAL mode for concurrent reads. A JSON-serialization plugin lets complex payloads live in single columns. A write queue (PQueue at concurrency 1) serializes all writes to avoid conflicts. The manager's auto-save timer flushes pending state to disk every 30 seconds, and a final save runs on shutdown.

## The four kinds of knowledge

Not all game data has the same shape, so the store models it in four tiers, each with its own storage strategy. The tiers are declared in `knowledge/schema/base.ts` and the tables are created in `knowledge/schema/setup.ts`.

| Tier | Storage strategy | Example tables |
| --- | --- | --- |
| **Metadata** | plain key-value, no visibility | `GameMetadata` |
| **Public** | keyed and stored once, immutable, visible to everyone | `PlayerInformations` |
| **Timed** | one row per item, recording its turn and a visibility flag per player | `GameEvents`, `DiplomaticMessages`, `RelationshipChanges` |
| **Mutable** | Timed plus versioning: a key, a version number, an `IsLatest` flag, and the list of fields that changed | `PlayerSummaries`, `PlayerOpinions`, `CityInformations` |

The examples above are illustrative, not the full set. The complete table list with each table's tier is reference data in `mcp-server/docs/knowledge.md`, and the schema itself is the authority. Two of those tables have a home elsewhere in this folder: `DiplomaticMessages` carries the durable agent-to-agent negotiation transcripts described in [diplomacy.md](../diplomacy.md), and `RelationshipChanges` records the diplomatic modifiers that [influence.md](influence.md) covers.

A caution when reading names: a table whose name ends in `Changes` is not necessarily Mutable. `RelationshipChanges` is a Timed table, plain time-stamped rows with no versioning, while `StrategyChanges`, `PolicyChanges`, `ResearchChanges`, `PersonaChanges`, and `FlavorChanges` are Mutable. Check `setup.ts` rather than the name.

### How versioning works

Mutable knowledge is never overwritten, it is versioned. When new data arrives for a key, the store:

1. fetches the latest version,
2. compares it field by field, and
3. does nothing if nothing changed.

If something did change, the store marks the old version as no longer latest and inserts a new version. The new version carries an incremented number and a list of exactly which fields changed.

The result is an audit trail. An agent, or a developer debugging, can see not just the current state of a civilization but how and when it got there. Timed tables have no such trail: each row simply stands on its own at the turn it was written.

## Visibility, the fog of war

Knowledge is only useful to an agent if it respects what that agent's civilization can actually see. An agent that could read every rival's hidden plans would be cheating. So visibility is woven through the store rather than bolted on.

Visibility is tracked per player, with one flag for each of up to 22 major civilizations (`Player0` through `Player21`). The flags are graded:

- **0, none**: no visibility of the thing,
- **1, basic**: it exists, roughly where, basic stats, or
- **2, detailed**: production, yields, buildings.

The flags are set at the moment data is stored. For real game events they are computed by Lua running inside the game (see [events.md](events.md)); for events injected by a tool they are set in TypeScript from the caller's own arguments, which is a meaningful difference covered on that page. Query helpers in `knowledge/expressions.ts` let tools filter by visibility level, by turn, or by event ID. Because the filtering happens in the query, a knowledge-query tool asked for "player N's view" automatically gets back only what player N is entitled to see.

## Getters: pulling state from the game

Events tell the store _that_ something happened, but the full state of a player or city has to be pulled from the game. That is the job of the **getters** in `knowledge/getters/`.

Each getter executes a Lua script through the bridge, post-processes the result (turning numeric IDs into readable names, filtering buildings, and so on), and stores it into the appropriate knowledge tier with the right visibility. Getters cover game identity, player information and summaries, opinions, strategies, personas, city information, military reports, victory progress, and more.

Getters are not run on every event, which would hammer the game. The store triggers them at two different checkpoints, and the distinction is worth knowing:

- When a **major civ finishes its turn**, the store refreshes that one player's opinions, strategy, and persona.
- When the **round ends**, the store refreshes player summaries and city information for everyone at once.

[events.md](events.md) explains how the store tells those two cases apart.

## Where the details live

This page is the prose. The exact table list, schema columns, and tier assignments stay in `mcp-server/docs/knowledge.md`. The knowledge-query tools that read this store are listed in `mcp-server/docs/tools.md` and described in [tools.md](tools.md).
