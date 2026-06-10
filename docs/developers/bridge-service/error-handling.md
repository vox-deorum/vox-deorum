# bridge-service — Error Handling

The bridge sits between a game that can crash or be closed at any moment and external services that may be slow or unreachable. Its error handling is built around that reality: keep the connection to the game alive at all costs, fail individual requests cleanly rather than hanging, and report failures back to callers in a consistent shape. This page explains the failure modes and how the bridge recovers from them. The full enumerated list of error codes is kept as reference in `bridge-service/docs/ERROR-HANDLING.md`; what follows is the behavior behind it.

## The error envelope

Every HTTP endpoint returns the same envelope. On success it carries a `success: true` and a `result`; on failure it carries `success: false` and an `error` object with a machine-readable `code`, a human-readable `message`, and optional `details`. Codes are defined in `bridge-service/src/types/api.ts`. The ones a caller actually has to reason about are:

| Code | What happened | Does the bridge recover? |
|---|---|---|
| `DLL_DISCONNECTED` | The game pipe is down — the game is closed, restarting, or the mod isn't loaded. | Yes — infinite reconnection with backoff. |
| `CALL_TIMEOUT` | A call exceeded its timeout (300 s for Lua, configurable for external calls). | The request is abandoned and cleaned up; the connection stays up. |
| `LUA_EXECUTION_ERROR` | The Lua function or script ran but failed inside the game. | No — it's a caller/script problem. |
| `INVALID_FUNCTION` | A call named a function that isn't registered. | No. |
| `INVALID_SCRIPT` / `INVALID_ARGUMENTS` | Malformed request — missing script, bad arguments, invalid registration. | No — fix the request. |
| `CALL_FAILED` / `NETWORK_ERROR` | An outbound external call returned an error or its endpoint was unreachable. | No — the registration persists; the caller decides whether to retry. |
| `SERIALIZATION_ERROR` | A message couldn't be parsed as JSON. | The bad message is logged and dropped. |
| `INTERNAL_ERROR` / `NOT_FOUND` | Unexpected service error, or an unknown endpoint. | Varies / no. |

## Losing the game connection

This is the failure the bridge is most careful about, because it is the most common — players close the game, and the bridge has to be running before the game starts. The connection lifecycle is described in full in [connection.md](connection.md); from an error-handling standpoint the important guarantees are:

- **No request hangs across a disconnect.** When the pipe drops, every in-flight request is immediately rejected with `DLL_DISCONNECTED` rather than being left to time out. Sends attempted while disconnected fail fast with the same code.
- **Reconnection is automatic and unbounded.** The bridge retries forever with exponential backoff (roughly 200 ms growing to a 5-second cap), so the game can come and go freely.
- **State is restored on reconnect.** Outbound external-function registrations are replayed and pause/production state is re-synced, so callers don't have to re-establish anything after a game restart.
- **Health reflects the truth.** `GET /health` reports `dll_connected`, and only returns an overall success when the service is running *and* connected. `GET /stats` exposes the pending-request count and reconnection-attempt count for deeper inspection.

## Timeouts

A Lua call that the game never answers is cleaned up after 300 seconds and returned as `CALL_TIMEOUT`; the pending entry is removed so it doesn't leak. If a single Lua call is timing out, the usual cause is that the game is paused — auto-pause holds the game core, and a call issued for a paused player won't be serviced until the game resumes. Outbound external calls have their own, much shorter timeout (5 seconds by default, set per registration), reported the same way.

## When an external service fails

Outbound calls — game Lua reaching out to a registered HTTP endpoint — are treated as the caller's responsibility. If the endpoint returns an error, is unreachable, or times out, the bridge returns the appropriate error code to the game and **leaves the registration in place**. It does not retry on its own. Retry logic, if wanted, belongs in the game's Lua, which can check whether a function is registered and loop on failure. This keeps the bridge stateless about external-service health and avoids it silently swallowing or amplifying failures.

## Malformed messages

Defensive parsing runs throughout the connector. Incoming pipe data has unescaped control characters sanitized before parsing (a workaround for a DLL quirk noted in [connection.md](connection.md)); anything that still fails to parse is logged and dropped rather than crashing the connection. At the HTTP layer, unknown routes return `NOT_FOUND` and any unhandled exception is caught by a global handler that returns `INTERNAL_ERROR` — with the underlying message included only when `NODE_ENV` is `development`.

## See also

- `bridge-service/docs/ERROR-HANDLING.md` — the complete error-code reference and troubleshooting checklist.
- [connection.md](connection.md) — the reconnection and request-tracking machinery behind these guarantees.
- [configuration.md](configuration.md) — where the timeout, retry, and logging settings come from.
