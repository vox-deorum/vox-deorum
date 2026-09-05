# mcp-server: Events

Everything the agent knows about a live game starts as an event. As turns play out, the game emits a continuous stream: a city was founded, a unit finished building, war was declared, a player ended their turn. The MCP server consumes that stream, records it, and uses it to keep its knowledge of the game current.

This page traces an event from the wire to the store. The relevant source is `mcp-server/src/knowledge/` together with the event consumption in `mcp-server/src/bridge/`. The per-event schemas themselves are reference data and stay in `mcp-server/docs/events/`.

## Where events come from

Events originate in the game and reach the MCP server through the [bridge-service](../bridge-service/overview.md). The server subscribes to the bridge's event feed, preferring the local named **event pipe** and falling back to **Server-Sent Events** when the pipe is unavailable. The `BridgeManager` re-emits each one as a `gameEvent` for the rest of the server to handle.

The transport details of that subscription are covered in [bridge.md](bridge.md); this page picks up once an event has arrived. Each event carries a type, a payload, and a timestamp. The knowledge manager (`knowledge/manager.ts`) listens for them and decides what each one means.

## The pipeline

When an event arrives, the manager routes it down one of three paths.

**DLL-status events** signal that the game connection itself came up or went down. On connect, the manager confirms the game context, registers the Lua function used for visibility analysis (see below), and notifies clients with `DLLConnected`. On disconnect it flips the store into resyncing mode and sends `DLLDisconnected`. These events are about the connection, not the game world, so they never become knowledge.

**Render events**, those whose type is prefixed with `Render:`, are presentation cues meant for downstream consumers such as session recording. The manager strips the prefix, records the event, and forwards it to MCP clients as a notification carrying the player, turn, and payload. A consumer like an OBS segment recorder can then react to it. See [replay.md](../../players/replay.md) for where these are used.

**Ordinary game events** are the bulk of the stream, and they go to the store's event handler. Each one passes through four steps:

1. **Validation.** Each event type has a Zod schema (in `knowledge/schema/events/`), and the incoming payload is validated against it. The schema set is the server's contract for what a given event looks like.
2. **Name remapping.** A few events are stored under a normalized name rather than their raw one, so that related signals land under consistent, self-explanatory names. For example, the game's confusingly-named `PlayerBuilt`, which fires on _completion_, is recorded as `UnitBuildCompleted`, and `PlayerBuilding`, which fires as work _starts_, as `UnitBuildStart`.
3. **Visibility analysis.** Every event is run through analysis that decides which players could have witnessed it, producing the per-player visibility flags the knowledge store keeps alongside it. This is what makes the recorded event respect fog of war when an agent later queries it; see [knowledge.md](knowledge.md). The analysis runs as a Lua function inside the game (`mcp-server/lua/event-visibility.lua`), registered when the DLL connects, because only the game knows who can see what.
4. **Storage.** The validated, remapped, visibility-tagged event is written into the `GameEvents` table.

## Special events that do more than get recorded

Some events trigger work rather than only being stored, because they mark moments when the server should refresh its picture of the world. The main one is `PlayerDoneTurn`, and it fires two different refreshes depending on whose turn just ended:

- **A major civ finishing its turn** (a `PlayerID` below 22) refreshes that one player's **opinions, strategy, and persona**. These are per-player snapshots, taken 22 times a round at most.
- **The end of the round** refreshes **player summaries and city information** for everyone at once. The server detects this by watching for `PlayerID` 63, the barbarian slot, whose turn always ends last. Treating it as a sentinel means the expensive whole-world snapshot runs once per round instead of once per civ.

Two other event kinds matter:

- **Turn-progression events** (`PlayerDoTurn`, and the `NextPlayerID` carried on `PlayerDoneTurn`) keep the manager's notion of the active player and current turn in sync.
- **Victory events** mark the end of a game, prompting the server to save a replay and archive the game's data before it notifies clients.

Doing the heavy work at these checkpoints, rather than on every event, is what keeps the snapshot cost bounded. The getters themselves are described in [knowledge.md](knowledge.md).

## Resync after a reconnect

The game connection can drop and come back: a save reloaded, the bridge restarted. When the DLL reconnects, events that were already recorded before the drop may be replayed.

The store handles this by entering a resyncing state on disconnect and dropping duplicate events it has already seen once the stream resumes, so a reconnect doesn't double-count history. Combined with the per-game database keyed by game identity, this lets the server survive interruptions without corrupting its memory of the game.

## Injecting events

Events don't only flow inward. Tools built on `DynamicEventTool` (see [tools.md](tools.md)) can write a synthetic event straight into the store. `relay-message`, which records a diplomatic or intelligence message as a game event, is currently the only one.

**Injected events do not get the visibility analysis that real events get.** This is the difference to keep in mind. A real event's flags are computed by `event-visibility.lua` running inside the game, which can actually reason about who witnessed what. An injected event's flags come from `composeVisibility` in `mcp-server/src/utils/knowledge/visibility.ts`, a pure TypeScript function with no view of the game at all: it grants full visibility to the player IDs named in the tool's `VisibleTo` argument, or to its `PlayerID` if `VisibleTo` was omitted, and zero to everyone else.

So an injected event is visible to exactly the players the caller listed and nobody else; nothing about the game world widens or narrows that. If you are injecting events, their visibility is entirely your responsibility.

## Where the details live

The per-event schemas and descriptions are reference data and stay in the component: `mcp-server/docs/events/md/` (human-readable) and `mcp-server/docs/events/json/` (machine-readable), with category tags in `mcp-server/docs/strategies/event-categories.json`. The events surfaced to agents through the knowledge-query tools (`get-events`, `get-diplomatic-events`) are listed in `mcp-server/docs/tools.md`.
