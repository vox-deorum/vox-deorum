# bridge-service — Configuration

The Bridge Service is configured from three sources, in order of precedence:

1. **Environment variables** — highest precedence.
2. A **`config.json`** file in the `bridge-service/` root.
3. The **built-in defaults** — lowest precedence.

Loading happens once at startup in `bridge-service/src/utils/config.ts`. Missing values fall back to defaults, and an invalid value logs a warning rather than preventing startup.

A `config.json` looks like this:

```json
{
  "rest": { "port": 5000, "host": "127.0.0.1" },
  "gamepipe": { "id": "vox-deorum-bridge", "retry": 5000 },
  "eventpipe": { "enabled": false, "name": "vox-deorum-events" },
  "logging": { "level": "info" }
}
```

## Settings

| Setting | Default | Environment variable | Meaning |
|---|---|---|---|
| `rest.port` | `5000` | `PORT` | HTTP server port. |
| `rest.host` | `127.0.0.1` | `HOST` | Bind address. Use `0.0.0.0` to accept connections from other machines. |
| `gamepipe.id` | `vox-deorum-bridge` | `gamepipe_ID` | Identifier for the DLL named pipe. Must match the DLL's pipe name. |
| `gamepipe.retry` | `5000` | `gamepipe_RETRY` | Cap, in milliseconds, on the reconnection backoff to the DLL. |
| `eventpipe.enabled` | `false` | `EVENTPIPE_ENABLED` | Whether to run the named-pipe event broadcaster (the alternative to SSE). |
| `eventpipe.name` | `vox-deorum-events` | `EVENTPIPE_NAME` | Identifier for the event pipe. |
| `logging.level` | `info` | `LOG_LEVEL` | One of `error`, `warn`, `info`, `debug`. |

### A note on pipe names

Both `gamepipe.id` and `eventpipe.name` are *identifiers*, not full pipe paths. The bridge uses `node-ipc`, which prepends a `tmp-app.` prefix, so the configured id `vox-deorum-bridge` becomes the actual pipe `\\.\pipe\tmp-app.vox-deorum-bridge`. The game DLL derives its pipe name from the same identifier the same way, which is how the two sides meet without hardcoded coordination.

To run several games side by side, give each its own `gamepipe.id`. This is the same name described from the DLL's side in [civ5-dll/connection.md](../civ5-dll/connection.md), and in more detail in [connection.md](connection.md).

## Other environment variables

- `BRIDGE_SHUTDOWN_URL_FILE` — if set, the service writes its real shutdown URL to this file once it is listening, so a launcher can discover the actual port. See [overview.md](overview.md).
- `NODE_ENV` — when `development`, error responses include more detail and an unhandled promise rejection will shut the service down.

## Settings that are not configurable

A handful of values are fixed in the source. They are listed here so they are not mistaken for missing config knobs; change them only by editing the source.

| Value | Setting | Where |
|---|---|---|
| 300 seconds | Timeout for a Lua call to the DLL | `bridge-service/src/services/dll-connector.ts` |
| 5 seconds (default) | Timeout for an outbound external call | per-function, overridable at registration |
| 5 seconds | SSE keep-alive ping interval | `bridge-service/src/routes/events.ts` |
| 50 ms / 100 events | Event batching window and size | `bridge-service/src/routes/events.ts` |
| `!@#$%^!` | Message delimiter on the pipes | throughout the connectors |
| 10 MB | Maximum HTTP request body (large Lua scripts) | `bridge-service/src/index.ts` |

## Common configurations

For development, lower `gamepipe.retry` so reconnection attempts come quickly, set `logging.level` to `debug`, and enable the event pipe if you want to watch events from a local process. For normal play, the defaults are appropriate — info logging, a 5-second retry cap, and the event pipe left disabled in favor of SSE.

To run multiple instances on one machine, give each a distinct `PORT`, `gamepipe_ID`, and (if used) `EVENTPIPE_NAME` via environment variables.
