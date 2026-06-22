# bridge-service — Overview

The Bridge Service is the translator in the middle of the Vox Deorum stack. The game DLL speaks a private, Windows-only named-pipe protocol. The AI side — the MCP server and the agents above it — speaks HTTP. The bridge connects to the DLL as the single client of its pipe and re-exposes everything that flows over that pipe as an ordinary REST API plus a real-time event stream. The rest of the stack never has to know that a named pipe exists.

It is a small Node.js/TypeScript service. The source lives in `bridge-service/src/`, with the interesting logic in `bridge-service/src/services/`. This folder documents *what* the bridge does and *why*. The exact HTTP request/response shapes and the wire-level message formats are kept as reference material inside the component (see [Where the details live](#where-the-details-live)).

## What it does

The bridge carries three kinds of traffic between the game and external services:

- **Calls into the game.** External services run Lua inside the running game, either by invoking a Lua function the game registered by name or by submitting a raw Lua script. Requests can be sent one at a time or in batches that travel through the pipe together to cut per-message overhead. This is the path the MCP server uses to read game state on demand.
- **Calls out of the game.** Lua running inside the game can call back out to external HTTP endpoints that registered themselves with the bridge. This lets an agent expose a decision-making endpoint that the game's Lua invokes as if it were a local function. See [lua.md](lua.md).
- **Events out of the game.** The game emits a continuous stream of events as turns play out. The bridge fans these out to subscribers, either over Server-Sent Events (SSE) for HTTP clients or over a second named pipe for local processes.

The bridge also paces the game on the AI's behalf. It pauses specific players so an external agent can decide their turn, and it toggles a production mode that throttles AI turns. That control logic is documented alongside the connection in [connection.md](connection.md).

## The HTTP surface

The REST API is an Express app defined in `bridge-service/src/index.ts`, with route handlers split across `bridge-service/src/routes/`. The endpoints group into four areas:

| Area | Source | Endpoints |
|---|---|---|
| Service control | `index.ts` | `GET /health` (up and DLL-connected?), `GET /stats` (component statistics), `POST /shutdown` (graceful local shutdown) |
| Lua operations | `routes/lua.ts` | `POST /lua/call`, `POST /lua/batch`, `POST /lua/execute`, `GET /lua/functions` |
| External functions and game control | `routes/external.ts` | `/external/register`, `/external/functions`, `/external/pause`, `/external/resume`, `/external/pause-player/:id`, `/external/paused-players`, `/external/production-mode` |
| Event streaming | `routes/events.ts` | `GET /events` (a long-lived SSE connection) |

Every endpoint returns the same envelope: a `success` flag, a `result` on success, or a structured `error` on failure. The exact request and response bodies are in the component reference, `bridge-service/docs/api-reference.md`. Error codes and recovery are covered in [error-handling.md](error-handling.md).

## Lifecycle and orchestration

A single orchestrator, `BridgeService` in `bridge-service/src/service.ts`, owns the component lifecycle.

On **startup**, it connects the DLL connector to the game pipe and starts the event pipe (if enabled). The HTTP server in `index.ts` then begins listening.

On **shutdown**, it runs in reverse: the HTTP server stops accepting connections, the DLL connection is torn down, the event pipe is stopped, and the pause manager releases anything it was holding. Shutdown can be triggered by a signal (`SIGINT`/`SIGTERM`/`SIGBREAK`), by an uncaught error, or by an HTTP `POST /shutdown`.

The components are singletons, each in `bridge-service/src/services/`, wired together through events:

- **DLL connector** (`dll-connector.ts`) — owns the named-pipe connection, message framing, batching, request/response tracking, and reconnection. Everything else talks to the game through it. See [connection.md](connection.md).
- **Lua manager** (`lua-manager.ts`) — the registry of game-side Lua functions and the entry point for executing calls and scripts. See [lua.md](lua.md).
- **External manager** (`external-manager.ts`) — the registry of outbound HTTP functions and the dispatcher that calls them when the game asks. See [lua.md](lua.md).
- **Pause manager** (`pause-manager.ts`) — per-player auto-pause, manual pause, and production mode, kept in sync with the DLL.
- **Event pipe** (`event-pipe.ts`) — the named-pipe broadcaster, an alternative to SSE for local subscribers.

### Discovering the running port

When the port is chosen dynamically, a launcher needs a way to find it without scraping logs. Set the environment variable `BRIDGE_SHUTDOWN_URL_FILE` and the service writes a one-line file with its real shutdown URL (`http://127.0.0.1:<actual-port>/shutdown`) once it is listening. Local launchers such as `scripts/vox-deorum.cmd` read that file.

## Where this sits in the stack

Below the bridge is the [civ5-dll](../civ5-dll/) connection service. It is the **server** end of the same pipe, and the bridge is its sole client. The two share one wire format and should be read together: the DLL side in [civ5-dll/connection.md](../civ5-dll/connection.md), the bridge side in [connection.md](connection.md).

Above the bridge is the MCP server, its primary consumer. The MCP server drives queued Lua and subscribes to the event stream. The end-to-end story across all layers is stitched together in [protocol.md](../protocol.md).

## Where the details live

Following the project's documentation rule, this folder explains *what and why* in prose, while exact reference data stays inside the component:

- `bridge-service/docs/api-reference.md` — every HTTP endpoint, with request and response shapes.
- `bridge-service/docs/message-types.md` — the JSON message types on the pipe.
- `bridge-service/docs/event-pipe.md` — the event-pipe wire format and a client example.
- `bridge-service/docs/protocol.md` — sequence diagrams for the message flows.

For settings, see [configuration.md](configuration.md). For failure modes and recovery, see [error-handling.md](error-handling.md).
