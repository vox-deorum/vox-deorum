# mcp-server: Configuration

This page is for a developer running or deploying the MCP server. It covers every setting the server reads at startup, with its default and its environment variable, plus the values that are fixed in the source and cannot be configured at all.

The server reads its configuration from three sources, in order of precedence:

1. **Environment variables**, highest precedence.
2. A **`config.json`** file, read from the process's working directory (normally `mcp-server/`).
3. The **built-in defaults**, lowest precedence.

Loading happens once at startup in `mcp-server/src/utils/config.ts`, which exports a single frozen config object that the rest of the server imports. A missing `config.json` is fine, and a malformed one logs an error and is skipped rather than stopping the server. Two settings break the simple precedence rule; see [Precedence exceptions](#precedence-exceptions).

A `config.json` looks like this:

```json
{
  "server": { "name": "vox-deorum-mcp-server", "version": "1.0.0" },
  "transport": { "type": "http", "port": 4000, "host": "127.0.0.1" },
  "bridgeService": {
    "endpoint": { "host": "127.0.0.1", "port": 5000 },
    "eventPipe": { "enabled": false, "name": "vox-deorum-events" }
  },
  "database": { "language": "en_US" },
  "logging": { "level": "info" }
}
```

## Settings

| Setting | Default | Environment variable | Meaning |
| --- | --- | --- | --- |
| `transport.type` | `http` | `MCP_TRANSPORT` | `http` or `stdio`. See [overview.md](overview.md) for the difference. |
| `transport.port` | `4000` | `MCP_PORT` | Port for the HTTP transport. Set it to `0` to let the operating system pick a free one. Ignored under stdio. |
| `transport.host` | `127.0.0.1` | `MCP_HOST` | Bind address. Use `0.0.0.0` to accept connections from other machines. |
| `transport.cors.origin` | `true` (any origin) | `MCP_CORS_ORIGIN` | `true`, `false`, a single origin, or a comma-separated list, which is split into an array. |
| `transport.cors.credentials` | `true` | `MCP_CORS_CREDENTIALS` | Whether to send CORS credentials. |
| `transport.cors.methods` | `GET`, `POST`, `OPTIONS` | none | Allowed HTTP methods. File or default only. |
| `transport.cors.allowedHeaders` | `Content-Type`, `Authorization` | none | Allowed request headers. File or default only. |
| `bridge.url` | derived from the two settings below | `BRIDGE_SERVICE_URL` | Full base URL of the bridge service. When set, it wins outright over the host and port. |
| `bridgeService.endpoint.host` | `127.0.0.1` | `BRIDGE_SERVICE_HOST` | Bridge host, used to derive `bridge.url`. |
| `bridgeService.endpoint.port` | `5000` | `BRIDGE_SERVICE_PORT` | Bridge port, used to derive `bridge.url`. Must match the bridge's own `rest.port` in [bridge-service/configuration.md](../bridge-service/configuration.md). |
| `bridgeService.eventPipe.enabled` | `false` | `EVENTPIPE_ENABLED` | Whether to try the named-pipe event feed before falling back to SSE. Must agree with the bridge's own `eventpipe.enabled`. |
| `bridgeService.eventPipe.name` | `vox-deorum-events` | `EVENTPIPE_NAME` | Event-pipe identifier. Must match the bridge's `eventpipe.name`. |
| `database.language` | `en_US` | `DB_LANGUAGE` | Language for `TXT_KEY_*` lookups against the localization database. Also changeable at runtime. |
| `database.documentsPath` | auto-detected | `DB_DOCUMENTS_PATH` | Documents folder holding the game's cache. See below. |
| `logging.level` | `info` | `LOG_LEVEL` | One of `error`, `warn`, `info`, `debug`. |
| `server.name` | `vox-deorum-mcp-server` | `MCP_SERVER_NAME` | Server identity reported over MCP and on `/health`. |
| `server.version` | `1.0.0` | `MCP_SERVER_VERSION` | Server version reported over MCP and on `/health`. |

### Finding the game's database files

`database.documentsPath` exists because the server has to locate Civilization V's cache directory, where the game writes the SQLite files that [database.md](database.md) describes. The server appends `My Games/Sid Meier's Civilization 5/cache/` to this path and expects `Civ5DebugDatabase.db` and `Localization-Merged.db` there.

When the setting is left unset, the server auto-detects the folder by shelling out to PowerShell for the Windows "MyDocuments" location, then caches the answer for the rest of the session. If that call fails it falls back to `Documents` under `USERPROFILE` or `HOME`. Auto-detection is right for a normal Windows install, so set `DB_DOCUMENTS_PATH` only when your Documents folder is redirected, when the game lives on another drive, or when you are running the server somewhere the PowerShell probe cannot answer usefully.

If the path is wrong the server does not crash. It logs a failure and retries every five seconds forever, which looks identical to waiting for the game to start. A retry message that never stops is the symptom to check this setting against.

### Precedence exceptions

Two environment variables are one-way, because of how `config.ts` combines them:

- `EVENTPIPE_ENABLED` can only turn the event pipe **on**. It is compared against the string `true`, and any other value falls through to `config.json` and then the default. Setting it to `false` will not disable a pipe that `config.json` enabled.
- `MCP_CORS_CREDENTIALS` can only turn credentials **off**. It is compared against the string `false`; any other value falls through to `config.json` and then the default.

`MCP_PORT` is not one-way. Set it to `0` to have the operating system assign any free port, which is what the launcher relies on: the server then writes the port it actually bound to `MCP_SHUTDOWN_URL_FILE`. An unparseable value still falls through to `config.json` and then the default.

## Other environment variables

- `MCP_SHUTDOWN_URL_FILE`: if set, the HTTP transport writes its real shutdown URL to this file once it is listening, so a launcher can discover the running server without scraping logs. Read directly in `mcp-server/src/http.ts` rather than through `config.ts`. See [overview.md](overview.md).
- `NODE_ENV`: `production` switches the logger to JSON output; `test` suppresses the `process.exit` calls in the HTTP shutdown path so a test run can shut the server down without killing the runner.
- `TEST_TRANSPORT` and `USE_MOCK` are consumed by the test harness, not the server. See [testing.md](../testing.md).

## Settings that are not configurable

Several values a reader might go looking for are fixed in the source. They are listed here so they are not mistaken for missing knobs; change them only by editing the code.

| Value | What it controls | Where |
| --- | --- | --- |
| 50 calls | Maximum Lua calls per queued batch | `mcp-server/src/bridge/manager.ts` |
| 25 calls | Backlog at which the server auto-pauses the game | `mcp-server/src/bridge/manager.ts` |
| 1 second | Delay before retrying a dropped event stream | `mcp-server/src/bridge/manager.ts` |
| 50 / 5 connections | Standard and fast HTTP connection pools to the bridge | `mcp-server/src/bridge/http-client.ts` |
| 5 seconds | Retry interval while waiting for the game database | `mcp-server/src/database/manager.ts` |
| 30 seconds | Knowledge auto-save interval | `mcp-server/src/knowledge/manager.ts`, described in [knowledge.md](knowledge.md) |
| 10 MB, 5 or 10 files | Log file rotation size and retention | `mcp-server/src/utils/logger.ts` |

## Common configurations

For normal play the defaults are right: HTTP on port 4000, the bridge on port 5000, SSE rather than the event pipe, and info logging. For development, set `LOG_LEVEL=debug`. To run the server as a child process of an agent framework rather than as a network service, set `MCP_TRANSPORT=stdio`.

To run several games side by side, give each MCP server its own `MCP_PORT`, point it at that game's bridge with `BRIDGE_SERVICE_PORT`, and if you use the event pipe give each a distinct `EVENTPIPE_NAME` matching its bridge. Since the shutdown-URL file is a single path, give each instance its own `MCP_SHUTDOWN_URL_FILE` too.
