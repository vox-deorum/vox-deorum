# mcp-server — Knowledge

An agent reasoning about a game needs more than a snapshot of the current turn — it needs memory. The knowledge system is the MCP server's memory: a persistent, per-game record of everything that has happened and the state of every player and city, all filtered by what each player is actually allowed to see. The knowledge-query tools read from here, which is why they can answer "what did this civilization do over the last ten turns?" without ever touching the live game.

The source lives in `mcp-server/src/knowledge/`. This page explains how the system is shaped; how events flow *into* it is the subject of [events.md](events.md).

## The two halves

The system splits cleanly in two:

- **The manager** (`knowledge/manager.ts`) is the orchestrator. It watches the bridge for events and DLL-status changes, detects when the active game changes, owns the current per-game store, runs the auto-save timer, and pushes notifications back to MCP clients. It is the part that knows *which* game is in play.

- **The store** (`knowledge/store.ts`) is the persistence layer — one SQLite database per game, at `data/{gameId}.db`. It validates incoming events, writes them, holds the snapshots of player and city state, and answers queries. It is the part that knows *what* is in the game.

When the game changes, the manager detects the new game identity, saves and closes the old store, opens a new one for the new game, and notifies clients with a `GameSwitched` notification. Each game thus gets its own isolated database; because that data is ephemeral and rebuilt from the game, there are no schema migrations — tables are simply created if they don't exist.

The store uses Kysely over SQLite in WAL mode for concurrent reads, a JSON-serialization plugin so complex payloads can live in single columns, and a write queue (PQueue at concurrency 1) that serializes all writes to avoid conflicts. The manager's auto-save timer flushes pending state to disk every 30 seconds, and a final save runs on shutdown.

## The four kinds of knowledge

Not all game data has the same shape, so the store models it in four tiers, each with its own storage strategy.

- **Metadata** is a plain key-value store — turn number, timestamps, the ID of the last event seen, and other bookkeeping.

- **Public knowledge** is immutable data visible to everyone, such as the static identity of each civilization (name, leader, team, whether it is human or AI). It is keyed and stored once.

- **Timed knowledge** is time-stamped data carrying per-player visibility. The headline example is the stream of game events itself, alongside things like each player's currently available strategic options and the AI's tactical-zone analysis. Each row records the turn it belongs to and a visibility flag for every player.

- **Mutable knowledge** is versioned, change-tracked data — the things that evolve turn over turn: player summaries, the diplomatic-opinion matrix, detailed city information, and the running record of strategy, policy, research, persona, flavor, and relationship decisions, plus victory progress. Each of these is stored with a version history rather than overwritten.

The exact list of tables and their tier assignments is reference data; the current set is documented in `mcp-server/docs/knowledge.md`.

### How versioning works

For mutable knowledge, the store doesn't overwrite — it versions. When new data arrives for a key, the store fetches the latest version, compares field by field, and does nothing if nothing changed. If something did change, it marks the old version as no longer latest and inserts a new version with an incremented number and a list of exactly which fields changed. The result is an audit trail: an agent (or a developer debugging) can see not just the current state of a civilization but how and when it got there.

## Visibility — the fog of war

Knowledge is only useful to an agent if it respects what that agent's civilization can actually see; an agent that could read every rival's hidden plans would be cheating. So visibility is woven through the store rather than bolted on.

Visibility is tracked per player, with one flag for each of up to 22 major civilizations (`Player0` through `Player21`). The flags are graded — a player may have no visibility of a thing, basic visibility (it exists, roughly where, basic stats), or detailed visibility (production, yields, buildings). The flags are set at the moment data is stored, computed by visibility analysis run against the game (see [events.md](events.md)), and query helpers in `knowledge/expressions.ts` let tools filter by visibility level, by turn, or by event ID. Because the filtering happens in the query, a knowledge-query tool asked for "player N's view" automatically gets back only what player N is entitled to see.

## Getters — pulling state from the game

Events tell the store *that* something happened, but the full state of a player or city has to be pulled from the game. That is the job of the **getters** in `knowledge/getters/`. Each getter executes a Lua script through the bridge, post-processes the result (turning numeric IDs into readable names, filtering buildings, and so on), and stores it into the appropriate knowledge tier with the right visibility. Getters cover game identity, player information and summaries, opinions, strategies, personas, city information, military reports, victory progress, and more.

Getters are not run on every event — that would hammer the game. Instead the store triggers the expensive ones at natural checkpoints, most importantly when a player finishes their turn, so a full snapshot of that player's world is captured once per turn rather than continuously. The triggering logic is part of the event pipeline described in [events.md](events.md).

## Where the details live

This page is the prose. The exact table list, schema columns, and tier assignments stay in `mcp-server/docs/knowledge.md`. The knowledge-query tools that read this store are listed in `mcp-server/docs/tools.md` and described in [tools.md](tools.md).
