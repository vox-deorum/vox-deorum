# mcp-server — Bridge Integration

The MCP server holds no special connection to the game. Everything it does to the live game — read state with Lua, listen for events, pause a turn — goes through the [bridge-service](../bridge-service/overview.md) over ordinary HTTP and a local event stream.

The `BridgeManager` (`mcp-server/src/bridge/manager.ts`) is the single component that owns that link; nothing else in the server makes HTTP calls to the bridge. This page is the MCP-side view of the connection. It is the counterpart to the bridge's own [connection.md](../bridge-service/connection.md) and [lua.md](../bridge-service/lua.md): the two sides describe the same link from opposite ends and should stay consistent.

## Two ways to run Lua

Reading game state means running Lua inside the game. The manager offers two paths with different trade-offs:

| Path | Method | Behavior | Backs |
| --- | --- | --- | --- |
| **Raw scripts** | `executeLuaScript` | posts a script straight to the bridge's execute endpoint on the fast path and returns its result | the `lua-executor` tool and any one-off script |
| **Named function calls** | `callLuaFunction` | queues the call and returns a promise; a background loop drains the queue in batches | the getters that refresh knowledge |

The queued path is the important one. `callLuaFunction` doesn't send right away — it pushes the call onto an internal queue. A background loop drains that queue in **batches of up to 50 calls**, sending them to the bridge's batch endpoint in a single request and matching each result back to its waiting caller. Batching is the point: the getters that refresh knowledge fire many small Lua calls per turn, and bundling them cuts the per-message overhead of crossing into the game.

If the DLL isn't connected, a queued call is rejected immediately rather than waiting, so callers get a fast, clear failure instead of a hang.

## Pacing the game under load

The queue is also where the server protects itself from getting overwhelmed. When the backlog of pending Lua calls stays large, the manager **pauses the game** so it can catch up, then **resumes** once the queue drains back down. This auto-pause/resume is tracked as a single overflow state, so the server doesn't thrash between pausing and resuming on every batch.

The effect is back-pressure: the game waits for the AI side when the AI side is busy, rather than the AI side dropping work or ballooning memory.

Pause and resume themselves go out on a **fast path** — a separate, small connection pool reserved for low-latency operations — so a control action doesn't queue up behind a pile of pending reads. The same fast path carries the per-player auto-pause registration and the production-mode toggle described below.

## Pausing specific players

Beyond the queue-driven pause, the manager exposes the bridge's finer pacing controls, which the agent framework above uses to take a turn:

- **Per-player auto-pause** registers a player so the game halts whenever it becomes that player's turn, giving an agent time to decide. Unregistering releases them.
- **Production mode** toggles a DLL-side throttle on AI turns.

These map directly onto the bridge's pause manager; the game-side semantics live in [connection.md](../bridge-service/connection.md).

## Consuming the event stream

The same manager is how events come *in*. It subscribes to the bridge's event feed, **preferring the local named event pipe** and **falling back to Server-Sent Events** when the pipe can't be used. It tries the pipe first, and on any pipe error switches to SSE, while never downgrading from a healthy pipe to SSE needlessly.

Messages on the pipe are framed by a delimiter and reassembled from a buffer, since a single read may contain several events or half of one. Each complete message is parsed and re-emitted as a `gameEvent`. What happens to those events next — validation, visibility analysis, storage — is [events.md](events.md).

One event type the manager handles itself rather than passing along: DLL-status messages. When the DLL's connected state flips, the manager updates its own view of the connection and, on disconnect, resets its registered Lua functions so that stale registrations aren't reused after the game comes back.

## Staying connected

The link is expected to drop and recover — the game restarts, a save reloads, the bridge bounces. The manager handles this without intervention:

- On a stream disconnect it schedules a reconnect, retrying the event pipe first (then SSE) after a short delay.
- When the DLL disconnects, the queue processor drops all pending Lua calls with a clear error rather than letting them hang, and resumes draining once the connection returns.

Health can be checked explicitly against the bridge's health endpoint, which also reports whether the DLL behind the bridge is connected.

On shutdown the manager stops the queue loop, drops anything still pending, disconnects both event streams, and releases the HTTP client.

## Where this sits

Below the MCP server, the bridge is the sole client of the DLL's pipe and the translator between that pipe and HTTP. Its side of this story — the wire protocol, the message types, the event-pipe format — is documented in the [bridge-service](../bridge-service/overview.md) folder and its kept reference. The full end-to-end path, from a tool call here down to the DLL and back, is assembled in [protocol.md](../protocol.md).
