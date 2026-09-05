# bridge-service: Error Handling

The bridge sits between a game that can crash or close at any moment and external services that may be slow or unreachable. Its error handling follows three rules:

- Keep the connection to the game alive at all costs.
- Fail individual requests cleanly rather than hanging.
- Report failures back to callers in a consistent shape.

This page explains the failure modes and how the bridge recovers from them. The enumerated list of codes is the `ErrorCode` enum in `bridge-service/src/types/api.ts`; what follows is the behavior behind it.

## The error envelope

Every HTTP endpoint returns the same envelope. On success it carries `success: true` and a `result`. On failure it carries `success: false` and an `error` object with a machine-readable `code`, a human-readable `message`, and optional `details`. Both shapes come from the `respondSuccess` and `respondError` helpers, and the game-control routes in `bridge-service/src/routes/external.ts` use them too, so a pause that cannot reach the game arrives as a real coded error rather than a bare flag. Setting production mode has no failure path at all and always succeeds.

One thing to watch: a handled failure is still sent with HTTP 200. The only endpoints that use a different status are an unhandled exception (500), an unknown route (404), and `POST /shutdown`, which acknowledges with 202. Branch on `success`, not on the status.

The codes a caller actually has to reason about:

| Code | What happened | Does the bridge recover? |
| --- | --- | --- |
| `DLL_DISCONNECTED` | The game pipe is down: the game is closed, restarting, or the mod is not loaded. Also returned when a pause or registration notification could not be delivered. | Yes, infinite reconnection with backoff. |
| `CALL_TIMEOUT` | A call exceeded its timeout: 300 seconds for Lua, per-registration for outbound external calls. | The request is abandoned and cleaned up; the connection stays up. |
| `LUA_EXECUTION_ERROR` | The Lua function or script ran but failed inside the game. | No, it is a caller or script problem. |
| `INVALID_FUNCTION` | A call named a function that is not registered, in either direction. | No. |
| `INVALID_SCRIPT`, `INVALID_ARGUMENTS` | Malformed request: missing script, invalid registration, or a player id outside 0 to 63. | No, fix the request. |
| `CALL_FAILED`, `NETWORK_ERROR` | An outbound external call returned an error or its endpoint was unreachable. `NETWORK_ERROR` also covers a failed write to the game pipe. | No, the registration persists and the caller decides whether to retry. |
| `INTERNAL_ERROR` | An unhandled exception in a route, or a manual pause or resume that could not be performed. | Varies. |
| `NOT_FOUND` | Unknown endpoint. | No. |

The enum declares one further code, `SERIALIZATION_ERROR`, that no code path in `src/` ever constructs. It is a leftover. A parse failure is handled the way [Malformed messages](#malformed-messages) describes, and it never reaches a caller as a response, so do not write client code that watches for it.

## Losing the game connection

This is the failure the bridge is most careful about, because it is the most common. Players close the game, and the bridge has to be running before the game starts. The connection lifecycle is described in full in [connection.md](connection.md). From an error-handling standpoint, the important guarantees are:

- **No request hangs across a disconnect.** When the pipe drops, every in-flight request is immediately settled with `DLL_DISCONNECTED` rather than being left to time out. Sends attempted while disconnected fail fast with the same code.
- **Reconnection is automatic and unbounded.** The bridge retries forever with exponential backoff, starting at 300 ms and levelling off at 5 seconds, so the game can come and go freely.
- **Registrations survive; auto-pauses deliberately do not.** Outbound external-function registrations are replayed on reconnect and production mode is re-enabled, so callers do not have to re-establish them. The paused-player set is cleared when the connection drops, on purpose, so that a crash cannot leave a player frozen. An agent that still needs a player paused registers it again.
- **Health reflects the truth, one level down.** `GET /health` always answers HTTP 200 with a successful envelope. The interesting flag is inside it: `result` carries `dll_connected`, `uptime`, `version`, and its own `success`, which is true only when the service is running _and_ the DLL is connected. `GET /stats` exposes the pending-request count and the reconnection-attempt count for deeper inspection.

## Timeouts

A Lua call that the game never answers is cleaned up after 300 seconds and returned as `CALL_TIMEOUT`. The pending entry is removed so it does not leak.

If a single Lua call is timing out, the usual cause is that the game is paused. A call issued for a paused player will not be serviced until the game resumes, and the pause may be one you asked for. The three pause mechanisms are compared in [overview.md](overview.md).

Outbound external calls have their own, much shorter timeout (5 seconds by default, set per registration), reported the same way.

## When an external service fails

Outbound calls, meaning game Lua reaching out to a registered HTTP endpoint, are the caller's responsibility. If the endpoint returns an error, is unreachable, or times out, the bridge returns the appropriate error code to the game and **leaves the registration in place**. It does not retry on its own.

Retry logic, if wanted, belongs in the game's Lua, which can check whether a function is registered and loop on failure. This keeps the bridge stateless about external-service health and stops it from silently swallowing or amplifying failures.

## Malformed messages

Defensive parsing runs throughout the connector. On the pipe, incoming data has unescaped control characters sanitized before parsing, a workaround for a DLL quirk noted in [connection.md](connection.md). Anything that still fails to parse is logged as an error and dropped. There is no pending request to attach a code to at that point, so the only trace is the log line; run with `LOG_LEVEL=debug` if you suspect the game is sending something the bridge cannot read.

A game event that simply never arrives is a different problem and usually not an error at all. Most often the DLL filtered it before sending. See [When an event never arrives](connection.md#when-an-event-never-arrives).

At the HTTP layer, unknown routes return `NOT_FOUND` with status 404. Any unhandled exception is caught by a wrapper around each route and by a global handler, both returning `INTERNAL_ERROR`, with the underlying message included only when `NODE_ENV` is `development`.

## See also

- `bridge-service/src/types/api.ts` holds the `ErrorCode` enum, the authoritative list of codes.
- [connection.md](connection.md) covers the reconnection and request-tracking machinery behind these guarantees.
- [configuration.md](configuration.md) shows which timeouts are settings and which are fixed in the source.
