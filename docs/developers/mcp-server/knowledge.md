# mcp-server — Knowledge

The knowledge system is the MCP server's memory. An agent reasoning about a game needs more than a snapshot of the current turn — it needs a persistent record of what has happened. The knowledge system provides exactly that: a per-game record of every event and the state of every player and city, all filtered by what each player is allowed to see.

The knowledge-query tools read from here. That is why they can answer "what did this civilization do over the last ten turns?" without ever touching the live game.

The source lives in `mcp-server/src/knowledge/`. This page explains how the system is shaped; how events flow *into* it is the subject of [events.md](events.md).

## The two halves

The system splits cleanly in two.

- **The manager** (`knowledge/manager.ts`) is the orchestrator. It watches the bridge for events and DLL-status changes, detects when the active game changes, owns the current per-game store, runs the auto-save timer, and pushes notifications back to MCP clients. It knows *which* game is in play.
- **The store** (`knowledge/store.ts`) is the persistence layer — one SQLite database per game, at `data/{gameId}.db`. It validates incoming events, writes them, holds the snapshots of player and city state, and answers queries. It knows *what* is in the game.

When the game changes, the manager detects the new game identity, saves and closes the old store, opens a new one, and notifies clients with a `GameSwitched` notification. Each game thus gets its own isolated database. Because that data is ephemeral and rebuilt from the game, there are no schema migrations — tables are simply created if they don't exist.

The store uses Kysely over SQLite in WAL mode for concurrent reads. A JSON-serialization plugin lets complex payloads live in single columns. A write queue (PQueue at concurrency 1) serializes all writes to avoid conflicts. The manager's auto-save timer flushes pending state to disk every 30 seconds, and a final save runs on shutdown.

## The four kinds of knowledge

Not all game data has the same shape, so the store models it in four tiers, each with its own storage strategy.

| Tier | What it holds | Storage strategy |
| --- | --- | --- |
| **Metadata** | turn number, timestamps, ID of the last event seen, other bookkeeping | plain key-value |
| **Public** | data visible to everyone, such as each civilization's static identity (name, leader, team, human or AI) | keyed and stored once, immutable |
| **Timed** | time-stamped data carrying per-player visibility — the event stream itself, each player's available strategic options, the AI's tactical-zone analysis | one row per item, recording its turn and a visibility flag per player |
| **Mutable** | data that evolves turn over turn — player summaries, the diplomatic-opinion matrix, detailed city information, victory progress, and the running record of strategy, policy, research, persona, flavor, and relationship decisions | versioned with change tracking, never overwritten |

The exact list of tables and their tier assignments is reference data; the current set is documented in `mcp-server/docs/knowledge.md`.

### How versioning works

Mutable knowledge is never overwritten — it is versioned. When new data arrives for a key, the store:

1. fetches the latest version,
2. compares it field by field, and
3. does nothing if nothing changed.

If something did change, the store marks the old version as no longer latest and inserts a new version. The new version carries an incremented number and a list of exactly which fields changed.

The result is an audit trail. An agent — or a developer debugging — can see not just the current state of a civilization but how and when it got there.

## Visibility — the fog of war

Knowledge is only useful to an agent if it respects what that agent's civilization can actually see. An agent that could read every rival's hidden plans would be cheating. So visibility is woven through the store rather than bolted on.

Visibility is tracked per player, with one flag for each of up to 22 major civilizations (`Player0` through `Player21`). The flags are graded:

- **none** — no visibility of the thing,
- **basic** — it exists, roughly where, basic stats, or
- **detailed** — production, yields, buildings.

The flags are set at the moment data is stored, computed by visibility analysis run against the game (see [events.md](events.md)). Query helpers in `knowledge/expressions.ts` let tools filter by visibility level, by turn, or by event ID. Because the filtering happens in the query, a knowledge-query tool asked for "player N's view" automatically gets back only what player N is entitled to see.

## Getters — pulling state from the game

Events tell the store *that* something happened, but the full state of a player or city has to be pulled from the game. That is the job of the **getters** in `knowledge/getters/`.

Each getter executes a Lua script through the bridge, post-processes the result (turning numeric IDs into readable names, filtering buildings, and so on), and stores it into the appropriate knowledge tier with the right visibility. Getters cover game identity, player information and summaries, opinions, strategies, personas, city information, military reports, victory progress, and more.

Getters are not run on every event — that would hammer the game. Instead the store triggers the expensive ones at natural checkpoints, most importantly when a player finishes their turn. A full snapshot of that player's world is captured once per turn rather than continuously. The triggering logic is part of the event pipeline described in [events.md](events.md).

## Where the details live

This page is the prose. The exact table list, schema columns, and tier assignments stay in `mcp-server/docs/knowledge.md`. The knowledge-query tools that read this store are listed in `mcp-server/docs/tools.md` and described in [tools.md](tools.md).
