# bridge-service: Configuration

The Bridge Service is configured from three sources, in order of precedence:

1. **Environment variables**, highest precedence.
2. A **`config.json`** file in the `bridge-service/` root.
3. The **built-in defaults**, lowest precedence.

A `config.json` looks like this:

```json
{
  "rest": { "port": 5000, "host": "127.0.0.1" },
  "gamepipe": { "id": "vox-deorum-bridge" },
  "eventpipe": { "enabled": false, "name": "vox-deorum-events" },
  "logging": { "level": "info" }
}
```

## Settings

| Setting | Default | Environment variable | Meaning |
| --- | --- | --- | --- |
| `rest.port` | `5000` | `PORT` | HTTP server port. Set it to `0` to let the operating system pick a free one. |
| `rest.host` | `127.0.0.1` | `HOST` | Bind address. `0.0.0.0` accepts connections from other machines, which the service is not hardened for; see the security note in [overview.md](overview.md). |
| `gamepipe.id` | `vox-deorum-bridge` | `gamepipe_ID` | Identifier for the DLL named pipe. Must match what the DLL was told to use. |
| `eventpipe.enabled` | `false` | `EVENTPIPE_ENABLED` | Whether to run the named-pipe event broadcaster, the alternative to SSE. |
| `eventpipe.name` | `vox-deorum-events` | `EVENTPIPE_NAME` | Identifier for the event pipe. |
| `logging.level` | `info` | `LOG_LEVEL` | One of `error`, `warn`, `info`, `debug`. |

## How loading behaves

Loading happens once at startup in `bridge-service/src/utils/config.ts`, and there is no validation anywhere in it. Missing values fall back through the three sources to a default, and whatever is found is used as-is.

The one failure the loader reports is a `config.json` that does not parse as JSON. That is logged as an error and then ignored, so the service starts on environment variables and defaults, and a stray comma in the file looks exactly like the file not existing. Everything else fails quietly: a `PORT` that is not a number falls through to the next source rather than raising anything, and an unrecognized `logging.level` is handed to the logger unchecked. If a setting seems to have no effect, check its spelling and re-read the startup log, which prints the configuration the service actually resolved.

## Pipe names, and how the two sides find each other

Both `gamepipe.id` and `eventpipe.name` are _identifiers_, not full pipe paths. The bridge uses `node-ipc`, which prepends a `tmp-app.` prefix, so the configured id `vox-deorum-bridge` becomes the actual pipe `\\.\pipe\tmp-app.vox-deorum-bridge`.

The game DLL builds its pipe name with the same prefix rule, but it reads its own setting to do it: the `VOX_DEORUM_PIPE_NAME` environment variable, described in [civ5-dll/connection.md](../civ5-dll/connection.md). Nothing links the two. They agree out of the box only because both default to `vox-deorum-bridge`.

The practical consequence is that `gamepipe.id` and `VOX_DEORUM_PIPE_NAME` must be set together, by hand, to the same value. Changing just one of them leaves the bridge dialing a pipe nobody is serving, and it will retry forever without reporting a mismatch. To run several games side by side, give each pair its own name.

## Other environment variables

- `BRIDGE_SHUTDOWN_URL_FILE`: if set, the service writes its real shutdown URL to this file once it is listening, so a launcher can discover the actual port. See [overview.md](overview.md).
- `NODE_ENV`: when `development`, error responses include more detail and an unhandled promise rejection will shut the service down.
- `USE_MOCK`: selects the mock DLL instead of a real game, for the test suite and for `npm run start:mock`. See [testing.md](../testing.md).

## Settings that are not configurable

A handful of values are fixed in the source. They are listed here so they are not mistaken for missing config knobs; change them only by editing the source.

| Value | Setting | Where |
| --- | --- | --- |
| 300 seconds | Timeout for a Lua call to the DLL | `bridge-service/src/services/dll-connector.ts` |
| 300 ms first delay, growing by 1.5x per attempt, capped at 5 seconds | Reconnection backoff to the DLL, retried indefinitely | `bridge-service/src/services/dll-connector.ts` |
| 2 seconds | How long a graceful shutdown waits for the DLL to acknowledge the disconnect before giving up | `bridge-service/src/services/dll-connector.ts` |
| 5 seconds (default) | Timeout for an outbound external call | per-function, overridable at registration |
| 5 seconds | SSE keep-alive ping interval | `bridge-service/src/routes/events.ts` |
| 50 ms / 100 events | Event batching window and size | `bridge-service/src/routes/events.ts` |
| `!@#$%^!` | Message delimiter on the pipes | throughout the connectors |
| 10 MB | Maximum HTTP request body (large Lua scripts) | `bridge-service/src/index.ts` |
| 1 hour | HTTP server keep-alive timeout, long enough that idle SSE clients are not dropped | `bridge-service/src/index.ts` |

## Common configurations

For development, set `logging.level` to `debug` and enable the event pipe if you want to watch events from a local process. For normal play the defaults are appropriate: info logging, and the event pipe left disabled in favor of SSE.

To run multiple instances on one machine, give each a distinct `PORT`, a distinct `gamepipe_ID` with a matching `VOX_DEORUM_PIPE_NAME` on the game side, and, if the event pipe is on, a distinct `EVENTPIPE_NAME`.
