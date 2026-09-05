# bridge-service: Overview

The Bridge Service is the translator in the middle of the Vox Deorum stack. The game DLL speaks a private, Windows-only named-pipe protocol. The AI side (the MCP server and the agents above it) speaks HTTP. The bridge connects to the DLL as the single client of its pipe and re-exposes everything that flows over that pipe as an ordinary REST API plus a real-time event stream. The rest of the stack never has to know that a named pipe exists.

It is a small Node.js/TypeScript service. The source lives in `bridge-service/src/`, with the interesting logic in `bridge-service/src/services/`. This folder explains what the bridge does and why; exact request shapes and wire formats stay in the component's own reference material (see [Where the details live](#where-the-details-live)).

## What it does

The bridge carries three kinds of traffic between the game and external services:

- **Calls into the game.** External services run Lua inside the running game, either by invoking a Lua function the game registered by name or by submitting a raw Lua script. Requests can be sent one at a time or in batches that travel through the pipe together to cut per-message overhead. This is the path the MCP server uses to read game state on demand.
- **Calls out of the game.** Lua running inside the game can call back out to external HTTP endpoints that registered themselves with the bridge. This lets an agent expose a decision-making endpoint that the game's Lua invokes as if it were a local function. See [lua.md](lua.md).
- **Events out of the game.** The game emits a continuous stream of events as turns play out. The bridge fans these out to subscribers, either over Server-Sent Events (SSE) for HTTP clients or over a second named pipe for local processes.

The bridge also paces the game on the AI's behalf, so an agent has time to think. See [Pacing the game](#pacing-the-game).

## The HTTP surface

The REST API is an Express app defined in `bridge-service/src/index.ts`, with route handlers split across `bridge-service/src/routes/`. The endpoints group into four areas:

| Area | Source | Endpoints |
| --- | --- | --- |
| Service control | `index.ts` | `GET /` (discovery: version, running status, and a map of the other endpoints), `GET /health` (up and DLL-connected?), `GET /stats` (component statistics), `POST /shutdown` (graceful local shutdown) |
| Lua operations | `routes/lua.ts` | `POST /lua/call`, `POST /lua/batch`, `POST /lua/execute`, `GET /lua/functions` |
| External functions and game control | `routes/external.ts` | `/external/register`, `/external/functions`, `/external/pause`, `/external/resume`, `/external/pause-player/:id`, `/external/paused-players`, `/external/production-mode` |
| Event streaming | `routes/events.ts` | `GET /events` (a long-lived SSE connection) |

Every endpoint but one returns the same envelope: a `success` flag, a `result` on success, or a structured `error` on failure. The envelope is built by the `respondSuccess` and `respondError` helpers in `bridge-service/src/types/api.ts`, and every route uses them. The exception is `POST /shutdown`, which answers `202` with a short acknowledgement and then tears the process down.

A handled failure still comes back with HTTP 200, so callers should branch on `success`, not on the status code. Exact bodies are in [api-reference.md](../../../bridge-service/docs/api-reference.md); error codes and recovery are covered in [error-handling.md](error-handling.md).

## Pacing the game

Three separate mechanisms slow the game down, all owned by `bridge-service/src/services/pause-manager.ts`. They are independent: one can be on while the others are off.

| Mechanism | Endpoints | Scope | How it works |
| --- | --- | --- | --- |
| Manual pause | `POST /external/pause`, `POST /external/resume` | The whole game, immediately | The bridge holds a named Windows mutex (`TurnByTurn`) that the game watches. Paused means the mutex is held. |
| Per-player auto-pause | `POST` and `DELETE /external/pause-player/:id`, `GET` and `DELETE /external/paused-players` | One player's turn, when it comes around | The bridge keeps a set of player ids and forwards every change to the DLL. The DLL does the actual pausing from its own copy of that set. |
| Production mode | `POST /external/production-mode` | Every AI turn | A flag forwarded to the DLL, which applies a cooldown between AI turns. |

Manual pause depends on an optional native package, `windows-mutex-prebuilt`, imported in a `try`/`catch` when the pause manager loads. If the package is unavailable the manager logs one warning at startup and afterwards every pause and resume returns false, which the routes report as `INTERNAL_ERROR`. Nothing else degrades: per-player pause and production mode travel over the DLL pipe and never touch the mutex.

Because only manual pause lives in the bridge, only it survives a lost DLL connection. The other two are state mirrored to the DLL, and [connection.md](connection.md) describes what happens to them across a reconnect.

## Lifecycle and orchestration

A single orchestrator, `BridgeService` in `bridge-service/src/service.ts`, owns the component lifecycle.

On **startup** the HTTP server in `index.ts` begins listening and publishes its shutdown URL first. `BridgeService` then connects the DLL connector to the game pipe and starts the event pipe (if enabled).

On **shutdown** it runs in reverse: the HTTP server stops accepting connections, the DLL connection is torn down, the event pipe is stopped, and the pause manager releases anything it was holding. Shutdown can be triggered by a signal (`SIGINT`, `SIGTERM`, or `SIGBREAK`), by an uncaught error, or by an HTTP `POST /shutdown`.

The components are singletons, each in `bridge-service/src/services/`, wired together through events:

- **DLL connector** (`dll-connector.ts`) owns the named-pipe connection, message framing, batching, request/response tracking, and reconnection. Everything else talks to the game through it. See [connection.md](connection.md).
- **Lua manager** (`lua-manager.ts`) is the registry of game-side Lua functions and the entry point for executing calls and scripts. See [lua.md](lua.md).
- **External manager** (`external-manager.ts`) is the registry of outbound HTTP functions and the dispatcher that calls them when the game asks. See [lua.md](lua.md).
- **Pause manager** (`pause-manager.ts`) holds manual pause and mirrors per-player pause and production mode to the DLL.
- **Event pipe** (`event-pipe.ts`) is the named-pipe broadcaster, an alternative to SSE for local subscribers.

### Discovering the running port

When the port is chosen dynamically, a launcher needs a way to find it without scraping logs. Set the environment variable `BRIDGE_SHUTDOWN_URL_FILE` and the service writes a one-line file with its real shutdown URL (`http://127.0.0.1:<actual-port>/shutdown`) once it is listening. This happens before the service starts its DLL and event-pipe connections, so the launcher can always request shutdown during IPC initialization. Local launchers such as `scripts/vox-deorum.cmd` read that file.

## Running without the game

You do not need Civilization V installed to exercise the bridge. Running `npm run start:mock` from `bridge-service/` boots the real Express server against an in-process mock DLL that speaks the same pipe protocol, so every route, the SSE stream, and the Lua plumbing behave normally. The mock lives in `bridge-service/tests/test-utils/mock-dll-server.ts` and is launched by `start-mock-bridge.ts` alongside it. The `USE_MOCK` environment variable is what selects mock or live mode, and the test suite uses the same switch. See [testing.md](../testing.md).

## Security posture

The bridge has no authentication, no authorization, and no rate limiting, and its CORS configuration in `index.ts` uses `origin: true`, which accepts any origin that asks. `POST /lua/execute` runs arbitrary Lua inside the running game, so anyone who can reach the port can do anything the game can do. Treat it as a localhost tool: keep the default `127.0.0.1` bind address and do not expose the port to a network you do not control. The same caveats appear in [api-reference.md](../../../bridge-service/docs/api-reference.md).

## Where this sits in the stack

Below the bridge is the [civ5-dll](../civ5-dll/overview.md) connection service. It is the **server** end of the same pipe, and the bridge is its sole client. The two share one wire format and should be read together: the DLL side in [civ5-dll/connection.md](../civ5-dll/connection.md), the bridge side in [connection.md](connection.md).

Above the bridge is the MCP server, its primary consumer. The MCP server drives queued Lua and subscribes to the event stream. The end-to-end story across all layers is stitched together in [protocol.md](../protocol.md).

## Where the details live

Following the project's documentation rule, this folder explains what and why in prose, while exact reference data stays inside the component:

- [api-reference.md](../../../bridge-service/docs/api-reference.md) covers every HTTP endpoint, with request and response shapes.
- [message-types.md](../../../bridge-service/docs/message-types.md) covers the JSON message types on the pipe, including which game events are dropped before they reach subscribers.
- [event-pipe.md](../../../bridge-service/docs/event-pipe.md) covers the event-pipe wire format and a client example.
- [protocol.md](../../../bridge-service/docs/protocol.md) has sequence diagrams for the message flows.

Before changing code here, read [bridge-service/AGENTS.md](../../../bridge-service/AGENTS.md). It carries the conventions this service is built on: singleton services, the `respondSuccess`/`respondError`/`handleAPIError` response pattern, SSE client handling, and the testing setup.

For settings, see [configuration.md](configuration.md). For failure modes and recovery, see [error-handling.md](error-handling.md).
