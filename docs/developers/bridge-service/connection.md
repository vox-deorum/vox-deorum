# bridge-service — DLL Connection

This page describes the bridge's end of the named-pipe link to the game: connecting, framing messages, tracking responses, and recovering from disconnects. All of it is owned by the DLL connector in `bridge-service/src/services/dll-connector.ts`.

It is the mirror image of [civ5-dll/connection.md](../civ5-dll/connection.md). There the DLL is the **server** that creates the pipe and waits; here the bridge is the **sole client** that connects to it. The two share one wire format and one pipe name, so read them together. The exact message types that travel over the pipe stay in the component reference, `bridge-service/docs/message-types.md`.

## The pipe

The bridge connects over a Windows named pipe using the `node-ipc` library, configured for raw-buffer mode with UTF-8 encoding. The pipe identifier comes from `gamepipe.id` (default `vox-deorum-bridge`). `node-ipc` adds its `tmp-app.` prefix, so the bridge dials `\\.\pipe\tmp-app.vox-deorum-bridge`. The DLL derives the same name from the same identifier, so no other coordination is needed. See [configuration.md](configuration.md) for how the name is set.

Only one client ever connects: the bridge. If the game is not yet running, the initial connection fails and the bridge falls into its [reconnection loop](#reconnection), waiting for the game and mod to load. After `node-ipc` reports a connection, the bridge waits a short settling delay before treating it as ready, because Windows named pipes need a moment to become fully usable.

## Message framing

Every message in either direction is a JSON object. Messages are separated on the wire by the literal delimiter `!@#$%^!`. A single pipe write can carry several messages joined by that delimiter — this is how the bridge batches calls (see [lua.md](lua.md)) to cut per-message overhead.

The pipe delivers a byte stream rather than discrete messages, so the connector keeps a running buffer of incoming bytes. As data arrives, it:

1. Appends the new bytes to the buffer.
2. Splits off every complete message up to a delimiter and handles it.
3. Keeps any trailing partial message in the buffer until the rest arrives.

The buffer is cleared whenever the connection drops, so a half-received message never bleeds into the next connection.

One rough edge is worth knowing: the DLL sometimes emits raw control characters inside JSON strings without properly escaping them. The connector sanitizes incoming text by escaping control characters before parsing, with a `TODO` to fix this on the DLL side. A message that still fails to parse is logged and dropped rather than crashing the connector.

## Sending and tracking responses

Outgoing traffic comes in three shapes:

- **Request/response calls** are sent with an identifier and tracked. The connector keeps a map of pending requests, each with its own timeout (300 seconds by default for Lua calls). When a `lua_response` arrives, the connector matches it to the pending request by id, resolves or rejects it based on the response's `success` flag, and clears the timeout. A response whose id matches nothing pending is logged and ignored. Batches work the same way: every message in the batch gets its own id and pending entry, and the batch resolves once all of them have answered or timed out.
- **Fire-and-forget notifications** are sent without waiting for a reply, used for things like registering an external function or telling the DLL to pause a player. They return immediately with success or a disconnected error.
- **Inbound messages that are not responses** — game events, registry notifications, external-call requests — match no pending request. The connector re-emits them as events by their `type`, and the other services subscribe: the [Lua manager](lua.md) listens for registry changes, the [external manager](lua.md) listens for outbound-call requests, and the event routes listen for game events.

If the bridge tries to send while disconnected, the call fails fast with a `DLL_DISCONNECTED` error rather than blocking. See [error-handling.md](error-handling.md).

## Reconnection

The link is built to survive either side restarting, and the bridge never gives up on the game. When the connection drops unexpectedly, the connector:

1. Marks itself disconnected and clears its incoming buffer.
2. Immediately rejects every pending request with `DLL_DISCONNECTED`, so no caller is left hanging.
3. Schedules a reconnection attempt.

Reconnection uses exponential backoff. The delay starts around 200 ms and grows by a factor of 1.5 on each attempt, capped at 5 seconds (the cap is `gamepipe.retry`). Retries are infinite. Only one reconnection attempt is ever in flight at a time, and none are scheduled once a graceful shutdown has begun.

A successful reconnection emits a `connected` event. The other services use it to restore the state the DLL lost when it went away:

- The **external manager** re-registers every outbound function it knows about, so the game's Lua bindings come back.
- The **pause manager** re-sends its set of auto-paused players and re-enables production mode if it was on.

This is why a crashed or restarted bridge never leaves the game stuck and never silently loses its registrations: the DLL clears per-connection state on disconnect, and the bridge replays it on reconnect.

## Graceful shutdown

A graceful shutdown is distinct from an unexpected drop, and it must not trigger a reconnect. The connector handles it in order:

1. Sets a shutting-down flag, which suppresses the reconnection loop.
2. Rejects any remaining pending requests with a shutdown error.
3. Clears its reconnection timer and disconnects the pipe.
4. Waits briefly for the disconnect to be acknowledged (with a timeout so shutdown can't hang) before returning.

Because the flag is checked throughout, a disconnect during shutdown does not start a reconnect.

## The event pipe

Alongside the request/response pipe to the DLL, the bridge can run a *second*, outbound-only named pipe that broadcasts game events to local subscribers — an alternative to SSE for processes that prefer a pipe. It is implemented by `bridge-service/src/services/event-pipe.ts`, is off by default, and is enabled with `eventpipe.enabled` (see [configuration.md](configuration.md)).

On this pipe the bridge is the **server**: it listens, accepts any number of clients, sends each a welcome message on connect and a goodbye on shutdown, and broadcasts batched events to all of them. It uses the same `node-ipc` raw-buffer transport and the same `!@#$%^!` delimiter as the DLL pipe, so a client buffers and splits incoming bytes exactly as the bridge does for the DLL. Events are batched on the same 50 ms / 100-event window the SSE stream uses, with status changes flushed immediately. The wire format and a complete client example live in `bridge-service/docs/event-pipe.md`.

## See also

- [civ5-dll/connection.md](../civ5-dll/connection.md) — the server end of the same pipe; keep it open alongside this page.
- `bridge-service/docs/message-types.md` — the exact JSON message types.
- `bridge-service/docs/protocol.md` — sequence diagrams for each flow.
- [protocol.md](../protocol.md) — the end-to-end narrative across all layers.
