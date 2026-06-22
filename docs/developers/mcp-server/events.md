# mcp-server — Events

Everything the agent knows about a live game starts as an event. As turns play out, the game emits a continuous stream — a city was founded, a unit finished building, war was declared, a player ended their turn. The MCP server consumes that stream, records it, and uses it to keep its knowledge of the game current.

This page traces an event from the wire to the store. The relevant source is `mcp-server/src/knowledge/` together with the event consumption in `mcp-server/src/bridge/`. The per-event schemas themselves are reference data and stay in `mcp-server/docs/events/`.

## Where events come from

Events originate in the game and reach the MCP server through the [bridge-service](../bridge-service/overview.md). The server subscribes to the bridge's event feed, preferring the local named **event pipe** and falling back to **Server-Sent Events** when the pipe is unavailable. The `BridgeManager` re-emits each one as a `gameEvent` for the rest of the server to handle.

The transport details of that subscription, including the pipe-to-SSE fallback, are covered in [bridge.md](bridge.md); this page picks up once an event has arrived. Each event carries a type, a payload, and a timestamp. The knowledge manager (`knowledge/manager.ts`) listens for them and decides what each one means.

## The pipeline

When an event arrives, the manager routes it down one of three paths.

**DLL-status events** signal that the game connection itself came up or went down. On connect, the manager confirms the game context, registers the Lua function used for visibility analysis (see below), and notifies clients with `DLLConnected`. On disconnect it flips the store into resyncing mode and sends `DLLDisconnected`. These events are about the connection, not the game world, so they never become knowledge.

**Render events** — those whose type is prefixed with `Render:` — are presentation cues meant for downstream consumers such as session recording. The manager strips the prefix, records the event, and forwards it to MCP clients as a notification carrying the player, turn, and payload. A consumer like an OBS segment recorder can then react to it. See [replay.md](../../players/replay.md) for where these are used.

**Ordinary game events** are the bulk of the stream, and they go to the store's event handler. Before an event is recorded, it passes through four steps:

1. **Validation.** Each event type has a Zod schema (in `knowledge/schema/events/`), and the incoming payload is validated against it. The schema set is the server's contract for what a given event looks like.
2. **Name remapping.** A few events are stored under a normalized name rather than their raw one, so that related signals land under consistent, self-explanatory names. For example, the game's confusingly-named `PlayerBuilt` — which fires on *completion* — is recorded as `UnitBuildCompleted`, and `PlayerBuilding` — which fires as work *starts* — as `UnitBuildStart`.
3. **Visibility analysis.** Every event is run through analysis that decides which players could have witnessed it, producing the per-player visibility flags the knowledge store keeps alongside it. This is what makes the recorded event respect fog of war when an agent later queries it — see [knowledge.md](knowledge.md). The analysis runs as a Lua function inside the game (`event-visibility.lua`), registered when the DLL connects, because only the game knows who can see what.
4. **Storage.** The validated, remapped, visibility-tagged event is written into the events table.

## Special events that do more than get recorded

Some events don't just get stored — they trigger work, because they mark moments when the server should refresh its picture of the world:

- **A player finishing their turn** is the main checkpoint. It triggers the knowledge getters (see [knowledge.md](knowledge.md)) to pull fresh snapshots of that player's summary, opinions, strategies, persona, and city information from the game via Lua. Doing this once per turn, rather than on every event, is what keeps the snapshot cost bounded.
- **Turn-progression events** keep the manager's notion of the active player and current turn in sync.
- **Victory events** mark the end of a game, prompting the server to archive the game's data and save a replay for later review.

## Resync after a reconnect

The game connection can drop and come back — a save reloaded, the bridge restarted. When the DLL reconnects, events that were already recorded before the drop may be replayed.

The store handles this by entering a resyncing state on disconnect and dropping duplicate events it has already seen once the stream resumes. So a reconnect doesn't double-count history. Combined with the per-game database keyed by game identity, this lets the server survive interruptions without corrupting its memory of the game.

## Injecting events

Events don't only flow inward. Action tools built on `DynamicEventTool` (see [tools.md](tools.md)) can inject a synthetic event into the store — for instance, the `relay-message` tool records a diplomatic or intelligence message as a game event. Injected events go through the same visibility analysis as real ones, so they respect the same fog of war.

## Where the details live

The per-event schemas and descriptions are reference data and stay in the component: `mcp-server/docs/events/md/` (human-readable) and `mcp-server/docs/events/json/` (machine-readable), with category tags in `mcp-server/docs/strategies/event-categories.json`. The events surfaced to agents through the knowledge-query tools (`get-events`, `get-diplomatic-events`) are listed in `mcp-server/docs/tools.md`.
