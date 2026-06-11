# bridge-service — DLL Connection

This page describes the bridge's end of the named-pipe link to the game. It is the mirror image of [civ5-dll/connection.md](../civ5-dll/connection.md): there the DLL is the **server** that creates the pipe and waits; here the bridge is the **sole client** that connects to it. The two share one wire format and one pipe name, so they should be read together. The exact message types that travel over the pipe stay in the component reference, `bridge-service/docs/message-types.md`; this page covers the lifecycle — connecting, framing, tracking responses, and recovering from disconnects — all owned by the DLL connector in `bridge-service/src/services/dll-connector.ts`.

## The pipe

The bridge connects over a Windows named pipe using the `node-ipc` library, configured for raw-buffer mode with UTF-8 encoding. The pipe identifier comes from `gamepipe.id` (default `vox-deorum-bridge`); `node-ipc` adds its `tmp-app.` prefix, so the bridge dials `\\.\pipe\tmp-app.vox-deorum-bridge`. Because the DLL derives the same name from the same identifier, no other coordination is needed — see [configuration.md](configuration.md) for how the name is set.

Only one client ever connects: the bridge. If the game is not yet running, the initial connection simply fails and the bridge falls into its reconnection loop (below), waiting for the game and mod to load. There is a short settling delay after `node-ipc` reports a connection before the bridge treats it as ready, because Windows named pipes need a moment to become fully usable.

## Message framing

Every message in either direction is a JSON object, and messages are separated on the wire by the literal delimiter `!@#$%^!`. A single pipe write can carry several messages joined by that delimiter — this is how the bridge batches calls (see [lua.md](lua.md)) to reduce per-message overhead.

Because the pipe delivers a byte stream rather than discrete messages, the connector keeps a running buffer of incoming bytes. As data arrives it appends to the buffer, splits off every complete message up to a delimiter and handles it, and keeps any trailing partial message in the buffer until the rest of it arrives. The buffer is cleared whenever the connection drops, so a half-received message never bleeds into the next connection.

One rough edge worth knowing: the DLL sometimes emits raw control characters inside JSON strings that are not properly escaped. The connector sanitizes incoming text by escaping control characters before parsing, with a `TODO` to fix this on the DLL side. A message that still fails to parse is logged and dropped rather than crashing the connector.

## Sending and tracking responses

Outgoing traffic comes in three shapes:

- **Request/response calls** are sent with an identifier and tracked. The connector keeps a map of pending requests, each with its own timeout (300 seconds by default for Lua calls). When a `lua_response` arrives, the connector matches it to the pending request by id, resolves or rejects it based on the response's `success` flag, and clears the timeout. A response whose id matches nothing pending is logged and ignored. Batches work the same way — every message in the batch gets its own id and its own pending entry, and the batch resolves when all of them have answered or timed out.
- **Fire-and-forget notifications** are sent without waiting for a reply — used for things like registering an external function or telling the DLL to pause a player. These return immediately with success or a disconnected error.
- **Inbound messages that are not responses** — game events, registry notifications, external-call requests — are not matched to any pending request. The connector re-emits them as events by their `type`, and the other services subscribe: the [Lua manager](lua.md) listens for registry changes, the [external manager](lua.md) listens for outbound-call requests, and the event routes listen for game events.

If the bridge tries to send while disconnected, the call fails fast with a `DLL_DISCONNECTED` error rather than blocking — see [error-handling.md](error-handling.md).

## Reconnection

The link is built to survive either side restarting. When the connection drops unexpectedly, the connector marks itself disconnected, clears its incoming buffer, and immediately rejects every pending request with `DLL_DISCONNECTED` so no caller is left hanging. It then schedules a reconnection attempt.

Reconnection uses exponential backoff: the delay grows by a factor of 1.5 on each attempt, starting around 200 ms and capped at 5 seconds (the cap is `gamepipe.retry`). Retries are infinite — the bridge never gives up on the game. Only one reconnection attempt is ever in flight at a time, and none are scheduled once a graceful shutdown has begun.

A successful reconnection emits a `connected` event, which the other services use to restore the state the DLL lost when it went away:

- The **external manager** re-registers every outbound function it knows about, so the game's Lua bindings come back.
- The **pause manager** re-sends its set of auto-paused players and re-enables production mode if it was on.

This is why a crashed or restarted bridge never leaves the game stuck and never silently loses its registrations: the DLL clears per-connection state on disconnect, and the bridge replays it on reconnect.

## Graceful shutdown

Shutting down is distinct from an unexpected drop. The connector sets a shutting-down flag first, which suppresses the reconnection loop, then rejects any remaining pending requests with a shutdown error, clears its reconnection timer, and disconnects the pipe. It waits briefly for the disconnect to be acknowledged (with a timeout so shutdown can't hang) before returning. Because the flag is checked throughout, a disconnect during shutdown does not trigger a reconnect.

## The event pipe

Alongside the request/response pipe to the DLL, the bridge can run a *second*, outbound-only named pipe to broadcast game events to local subscribers — an alternative to Server-Sent Events for processes that prefer a pipe. It is implemented by `bridge-service/src/services/event-pipe.ts`, is off by default, and is enabled with `eventpipe.enabled` (see [configuration.md](configuration.md)).

Here the bridge is the **server**: it listens, accepts any number of clients, sends each a welcome message on connect and a goodbye on shutdown, and broadcasts batched events to all of them. It uses the same `node-ipc` raw-buffer transport and the same `!@#$%^!` delimiter as the DLL pipe, so a client buffers and splits incoming bytes exactly as the bridge does for the DLL. Events are batched on the same 50 ms / 100-event window the SSE stream uses, with status changes flushed immediately. The wire format and a complete client example live in `bridge-service/docs/event-pipe.md`.

## See also

- [civ5-dll/connection.md](../civ5-dll/connection.md) — the server end of the same pipe; keep it open alongside this page.
- `bridge-service/docs/message-types.md` — the exact JSON message types.
- `bridge-service/docs/protocol.md` — sequence diagrams for each flow.
- [protocol.md](../protocol.md) — the end-to-end narrative across all layers.
