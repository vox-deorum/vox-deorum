# civ5-dll — Connection Service

The connection service is the seam between the running game and everything outside it. It lives in the DLL as a singleton, `CvConnectionService`, and it owns one job: maintain an inter-process channel over which the game's state and events flow out and commands flow in. The other end of that channel is the [Bridge Service](../bridge-service/) — the DLL is the **server** and the bridge is the sole client. This page describes the DLL end; the bridge side of the same pipe is covered in the bridge-service folder, and the two should always be read together since they share one wire format.

## The named pipe

The channel is a **Windows named pipe**. The connection service creates it as a duplex, message-mode pipe and acts as the server, listening for a single client to connect. The pipe name is derived from the `VOX_DEORUM_PIPE_NAME` environment variable, defaulting to `vox-deorum-bridge`, and is exposed to the system under the `\\.\pipe\tmp-app.` prefix — so by default the full name is `\\.\pipe\tmp-app.vox-deorum-bridge`. Because the bridge derives the same name from the same environment variable, the two sides meet without any hardcoded coordination; running multiple games side by side just means giving each a distinct pipe name.

Only one client connects at a time — the bridge. If no client is present the server simply waits; if the client disconnects, the service tears down per-connection state (paused players, production mode) and loops back to listen for a fresh connection. This makes the link resilient to the bridge restarting: the game keeps running and the bridge can reconnect at any time.

## Two threads, one game

The hard constraint the connection service works around is that the gamecore is extremely sensitive about *when* its state is touched. As the upstream overview explains, changing game state from the wrong context risks "out of sync" errors in networked games and corrupts the brittle savegame serialization. Doing pipe I/O on the main game thread would also stall the game.

The service resolves this with a split:

- A dedicated **pipe thread** (started in `Setup`, run at high priority) owns all blocking pipe I/O — accepting the connection, reading incoming bytes, writing outgoing bytes. It never touches game state. It only moves serialized JSON strings between the pipe and a pair of thread-safe queues.
- The **main game thread** does all the actual game work. At safe points in the turn loop the gamecore calls `ProcessMessages`, which drains the incoming queue, acts on each message, and flushes queued outgoing events. These pump points are scattered through `CvGame`, `CvPlayer`, and the AI classes precisely so that messages are handled only when mutating state is safe.

The two queues — incoming (bridge → game) and outgoing (game → bridge) — are guarded by critical sections, and they are the only shared state between the threads. Everything the main thread does happens on the main thread; everything the pipe touches stays off it.

## The message format

Every message in either direction is a JSON object with a `type` field that names its kind. On the main thread, `RouteMessage` parses an incoming message, reads its `type`, and dispatches to the matching handler. The message kinds include:

- **`lua_execute`** — run a Lua script string inside the game and return its result, tagged with a caller-supplied `id`.
- **`lua_call`** — call a previously registered Lua function by name with a JSON array of arguments.
- **`game_event`** — emitted outward whenever the game fires an event the bridge cares about; each carries a unique event id derived from the current turn and a running sequence number.
- **External function registration and calls** — the game can register the names of functions the bridge implements, then call out to them (synchronously or asynchronously) and receive results back through the same channel; `echo` and `lua_register`/`lua_unregister` notifications round out the protocol.

Outgoing messages are assembled into a write buffer, serialized, and queued for the pipe thread; incoming messages are deserialized into a read buffer for handling. One sharp edge worth knowing when reading the code: the JSON library returns pointers that alias these shared buffers, so handlers copy any strings they need into stable locals before doing work that might re-enter `RouteMessage` — the comments in the source call this out at each such site.

## Flow control and game pacing

Beyond plain message passing, the service can pace the game on the bridge's behalf. The bridge can ask the game core to **pause** for specific players — when an external agent needs to make a decision for a player, the gamecore holds at a safe point until the answer comes back rather than letting the built-in AI act. The service tracks a set of paused players and checks it from the turn loop. It also supports a **production mode** that throttles AI turns with a cooldown so that visual capture (used by the agents' media pipeline) has time to keep up. Both of these are per-connection: they reset when the pipe disconnects, so a crashed or restarted bridge never leaves the game stuck.

## Where this connects next

The bridge consumes this channel and re-exposes it as a friendlier REST/SSE API for the rest of the stack. When reading the bridge's own connection lifecycle and Lua-registry documentation, keep this page open alongside it: the pipe name, the message-mode framing, and the `type`-tagged JSON described here are exactly what the bridge expects on the other side.
