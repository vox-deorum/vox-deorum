# bridge-service — Event Pipe Test Plan

> See [README.md](README.md) for shared context, conventions, and shared-fixture prerequisites.

bridge-service is the best-covered package: connection lifecycle/reconnection, routes (lua, events, external, sse, pause, statistics), and services (dll-connector buffering, lua-manager, external-manager, pause-manager) are all tested. The one notable gap is **`event-pipe.ts`**, which broadcasts game events over a `node-ipc` named pipe and is not exercised by any test.

## Event pipe

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/services/event-pipe.test.ts` | [event-pipe.ts](../../../bridge-service/src/services/event-pipe.ts) | See cases below | Mock `node-ipc`; toggle `config.eventpipe.enabled` |

### Cases

- **`broadcastBatch`**
  - Joins events with the `!@#$%^!` delimiter and appends a trailing delimiter (one `ipc.server.broadcast` call with the exact concatenated payload).
  - No-ops (no broadcast) when: `config.eventpipe.enabled` is false, not serving, `shuttingDown` is true, or `events.length === 0`.
  - Catches broadcast errors without throwing (spy `broadcast` to throw; assert no rejection and error logged).
- **`getStats`** — returns `{ enabled, clients, pipeName }` reflecting config + current `connectedClientsCount`.
- **connect/disconnect handlers** — `connectedClientsCount` increments on connect, decrements on disconnect, and never drops below 0; a `connected` welcome payload is broadcast on connect.
- **`start`** — respects `config.eventpipe.enabled` (early return when disabled), is idempotent when already serving, resolves once `ipc.serve` callback fires, sets `isServing`.
- **`stop`** — broadcasts the `disconnecting` goodbye payload, calls `ipc.server.stop()`, resets `isServing`/`connectedClientsCount`, and is a no-op when not serving.

### Mocking approach

`vi.mock('node-ipc')` with a fake exposing `config`, `serve(cb)` (invoke `cb` synchronously), `server.start()`, `server.stop()`, `server.broadcast` (spy), and `server.on(event, handler)` (capture handlers so tests can fire `connect`/`disconnect`/`error`). Toggle `config.eventpipe.enabled`/`name` via `vi.mock('../../../src/utils/config.js')` or by mutating the imported config object. Note `event-pipe.ts` exports a singleton `eventPipe` and also the `EventPipe` class — instantiate a fresh `EventPipe` per test to avoid shared state, and keep the single-fork pool.

## Suggested order

Single self-contained file — no shared-fixture dependency. Low effort, closes the package's only meaningful gap.
