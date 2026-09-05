# civ5-dll: Connection Service

The connection service is the seam between the running game and everything outside it. It is a singleton in the DLL, `CvConnectionService`, with one job: maintain an inter-process channel over which the game's state and events flow out and commands flow in.

The other end of that channel is the [Bridge Service](../bridge-service/). The DLL is the **server**; the bridge is the sole client. This page describes the DLL end. Read it alongside the bridge's own [connection page](../bridge-service/connection.md), since the two share one wire format.

The code is `CvGameCoreDLL_Expansion2/CvConnectionService.cpp` and its header. A good reading order is `Setup`, then `NamedPipeServerThread`, then `DrainIncomingMessages` and `RouteMessage`.

## The named pipe

The channel is a **Windows named pipe**: duplex, message mode, non-blocking, one instance. The service creates it, acts as the server, and listens for a single client to connect.

The pipe name comes from the `VOX_DEORUM_PIPE_NAME` environment variable, defaulting to `vox-deorum-bridge`. The system exposes it under the `\\.\pipe\tmp-app.` prefix, so the default full name is `\\.\pipe\tmp-app.vox-deorum-bridge`. The bridge derives the same name from the same variable, so the two sides meet without hardcoded coordination. To run several games side by side, give each a distinct pipe name.

Only one client connects at a time. If none is present, the server waits. If the client disconnects, the service tears down per-connection state (paused players, production mode) and loops back to listen for a fresh connection, so a bridge restart never strands the game.

## Framing

Do not rely on the pipe's message mode for framing. The service joins and splits messages with the literal delimiter `!@#$%^!`:

- Outgoing, each serialized JSON object gets the delimiter appended and is written in chunks of at most 32 KB, so one message can span several writes.
- Incoming, bytes accumulate in a buffer and every complete segment up to a delimiter is queued as one message.

A single pipe write can therefore carry a batch of messages, which is how the bridge amortizes per-message overhead. The bridge documents the same delimiter from its side, and the two ends have to stay in step.

## Threads and pump points

The gamecore is sensitive about _when_ its state is touched. Mutating it from the wrong context risks "out of sync" errors in networked games and corrupts the brittle savegame serialization, and blocking pipe I/O on the main thread would stall the game.

The service splits the work across two threads:

- A dedicated **pipe thread**, started in `Setup` and run at high priority, owns all blocking pipe I/O. It never touches game state; it only moves serialized JSON between the pipe and a pair of thread-safe queues.
- The **main game thread** does the real work. At safe points the gamecore calls `ProcessMessages`, which drains the incoming queue and dispatches each message. Those pump points live in `CvGame`, `CvPlayer`, `CvPlayerAI`, and `CvMilitaryAI`, placed where mutating state is safe.

The incoming and outgoing queues, each guarded by a critical section, are the only state the two threads share.

## The UI-thread drain

`ProcessMessagesFromUI` is a second drain, exposed to Lua as `Game.ProcessConnectionMessages`.

It exists because the engine stops ticking `CvGame::update` while the leaderhead scene is up, and every game-core pump point hangs off that tick. For as long as a player sits in a diplomacy conversation, nothing routes the bridge's pushes: the bridge's call never returns, neither end raises an error, and the in-game panel simply reaches its timeout. A UI context that keeps running there can pump on the game core's behalf, so the mod's [diplomacy panel](../civ5-mod/diplomacy-panel.md) and [deal screen](../civ5-mod/deal-screen.md) both call it once per frame.

It is deliberately not the same drain. A UI-thread caller runs off the game core's execution boundary, so `RouteMessage` first asks `IsGameCoreOnlyMessageType` whether the type may run there at all. Types that may not are handed back to the queue in arrival order for the next game-core pump. That predicate is currently a stub that admits everything, so treat it as the hook to extend rather than a live restriction: **when you add a message type, decide whether it is safe to route from the UI thread and record the answer there.** Anything that mutates game state, advances a turn, or reaches into the AI belongs on a game-core pump.

Two more rules the shared drain body enforces:

- Only one drain runs at a time. Contention is tested, never waited on, so whichever caller loses skips that pump instead of stalling a render frame or a turn.
- Drains do not nest, with one exception. The wait loop inside a synchronous `Game.CallExternal` pumps reentrantly, because it is the only path that can route the `external_response` it is waiting for. That nesting is depth-capped, so a misused synchronous call times out rather than recursing without bound.

## The message format

Every message in either direction is a JSON object with a `type` field naming its kind. On the main thread, `RouteMessage` parses the message, reads `type`, and dispatches to the matching handler.

Incoming, bridge to game:

| `type` | Purpose |
| --- | --- |
| `lua_execute` | Run a Lua script string inside the game. Answered with a `lua_response` carrying the caller's `id`. |
| `lua_call` | Call a game-registered Lua function by name with a JSON array of `args`. Answered with a `lua_response`. |
| `external_register` / `external_unregister` | Add or drop a name in the registry of functions the **bridge** implements, with an `async` flag. |
| `external_response` | The bridge's answer to an `external_call`, matched by `id`. |
| `pause_player` / `unpause_player` | Add or remove one `playerID` from the paused set. |
| `clear_paused_players` | Empty the paused set. |
| `set_production_mode` | Turn production mode on or off. |

Outgoing, game to bridge:

| `type` | Purpose |
| --- | --- |
| `lua_response` | Result or error for a `lua_execute` or `lua_call`, tagged with the request `id`. |
| `game_event` | A game event the bridge cares about, with a payload named by that event's schema. Events forwarded from the gamecore carry an id derived from the current turn and a running sequence number; Lua broadcasts get one only when they ask for it. |
| `lua_register` / `lua_unregister` | Sent when game-side Lua registers or drops a callable function, so the bridge learns what it may call. |
| `external_call` | The game invoking a bridge-implemented function, carrying an `id` the bridge echoes back in its `external_response`. |
| `echo_response` | Any message whose `type` matches no handler is bounced straight back. Doubles as a connectivity check. |

The two registries are easy to confuse, and they point in opposite directions. `lua_register` announces a function that lives **in the game** for the bridge to call with `lua_call`. `external_register` announces a function that lives **in the bridge** for the game to call with `external_call`, which game Lua reaches through `Game.CallExternal`. Each side publishes its own registry to the other.

One sharp edge when reading the code: the JSON library returns pointers that alias shared main-thread buffers. Handlers copy every string they need into stable locals before doing work that might re-enter `RouteMessage`. The source comments mark each such site.

## Flow control and game pacing

Beyond message passing, the service can pace the game on the bridge's behalf. Both controls are per-connection and reset when the pipe disconnects, so a crashed bridge never leaves the game stuck.

- **Pause for specific players.** When an external agent needs to decide for a player, the bridge holds the gamecore at a safe point until the answer arrives rather than letting the built-in AI act. The service keeps a set of paused players and the turn loop checks it.
- **Production mode.** This throttles AI turns with a cooldown so the agents' visual capture pipeline can keep up.

## Where this connects next

The bridge consumes this channel and re-exposes it as a friendlier REST/SSE API for the rest of the stack. Its connection lifecycle and Lua registry pages assume exactly the pipe name, delimiter framing, and `type`-tagged JSON described here.
