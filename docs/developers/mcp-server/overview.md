# mcp-server: Overview

The MCP server is where the AI side of Vox Deorum meets the game. It exposes Civilization V's state and controls to language-model agents as a set of [Model Context Protocol](https://modelcontextprotocol.io) tools. An agent can ask "what technologies can this player research?" or tell the game "set this civilization's grand strategy to conquest." The server turns each request into a game-database query, a knowledge lookup, or Lua executed inside the running game.

It is a Node.js/TypeScript service. The source lives in `mcp-server/src/`, and this folder explains, for a developer new to the code, what it does and how its pieces fit. The exact reference data lives with the component itself; see [Where the details live](#where-the-details-live).

## Where it sits in the stack

The MCP server sits one layer above the [bridge-service](../bridge-service/overview.md) and one layer below the vox-agents.

- **Below:** the bridge speaks to the DLL over a Windows named pipe and re-exposes everything as HTTP. The MCP server is its primary consumer, and it never touches the pipe directly: it drives queued Lua through the bridge's REST API and subscribes to the bridge's event stream. The MCP-side view of that link is in [bridge.md](bridge.md).
- **Above:** the vox-agents connect as MCP clients and call the server's tools.

The full end-to-end path across all five components is assembled in [protocol.md](../protocol.md) and [architecture.md](../architecture.md).

## What it does

For an agent that cannot see the game directly, the server is a faithful mirror of it, one that can be queried and controlled. Four subsystems build that mirror:

| Subsystem | Job | Reference |
| --- | --- | --- |
| **Tools** | The agent-facing surface, and the only thing an agent sees. 43 tools, split into general utilities, game-database queries, knowledge queries, actions, and game control. | [tools.md](tools.md) |
| **Knowledge store** | The server's memory. Records events and periodically snapshots player and city state into a per-game SQLite database, filtered by what each player can see. | [knowledge.md](knowledge.md), [events.md](events.md) |
| **Game database** | Civilization V's own rules data (every unit, building, technology, policy, and strategy) read from the game's SQLite files and localized into readable text. | [database.md](database.md) |
| **Bridge integration** | How everything reaches the live game: a queue that batches Lua calls, paces the game when the queue backs up, and consumes the event stream. | [bridge.md](bridge.md) |

Beyond reading state, some action tools _steer_ the game's own AI by adjusting flavors, strategies, personas, and diplomatic relationships. This lets a language model influence even civilizations it does not directly control. How those tools reach into the tactical AI is the subject of [influence.md](influence.md). A separate family of action and knowledge tools handles agent-to-agent negotiation and in-game deals, which is covered in [diplomacy.md](../diplomacy.md).

## How the server is built

A single `MCPServer` singleton (`mcp-server/src/server.ts`) owns the whole service. It constructs the three managers (`BridgeManager`, `DatabaseManager`, `KnowledgeManager`) once and shares them across every client connection. Each connecting MCP client gets its own underlying `McpServer` instance from the SDK, but they all draw on the same managers and the same tool set. A connection is therefore cheap, and game state stays consistent no matter how many agents attach.

Tools register through a factory pattern with lazy loading. `mcp-server/src/tools/index.ts` holds a map of factory functions, one per tool. The actual tool objects are constructed on first server initialization, then cached and reused. This keeps startup fast and memory low, and it is the pattern any new tool plugs into. The tool framework itself, the `ToolBase` abstract class and its four specialized subclasses, is described in [tools.md](tools.md).

### Transports and server modes

The server supports two MCP transports, chosen by configuration:

- **stdio**: the server talks over standard input/output. This is the natural fit for an agent that launches the MCP server as a child process.
- **HTTP**: the server runs a Streamable-HTTP endpoint, for clients that connect over the network.

Tools, managers, and knowledge behave identically under both transports; only the wiring differs. The test suite exercises both (see [testing.md](../testing.md)). Which transport runs, and everything else the server reads at startup, is set in [configuration.md](configuration.md).

Over HTTP the server exposes a small set of endpoints: a `GET /health` probe, the MCP endpoint itself (`POST`/`GET`/`DELETE /mcp`), and a `POST /shutdown` that shuts the server down gracefully for local orchestration.

### Discovering the running port

A launcher that starts the MCP server needs a way to shut it down again. When the environment variable `MCP_SHUTDOWN_URL_FILE` is set, `mcp-server/src/http.ts` writes a one-line file containing the shutdown URL, so the launcher can find the server without scraping logs.

The write happens inside the `listen` callback and reads the host and port back off the bound server, so the file always records the address the OS actually assigned rather than the one that was requested. Wildcard and loopback bind addresses (`0.0.0.0`, `::`, `::1`, `localhost`) are normalized to `127.0.0.1` in the URL. Unlike the bridge service, though, this server cannot currently be asked for an OS-assigned port: a configured port of `0` falls through to the default. See [configuration.md](configuration.md).

## Notifications back to clients

The flow is not purely request/response. When the game advances, the server pushes a custom MCP notification, `vox-deorum/game-event`, to connected clients, carrying the event name, player, turn, and payload. An agent can therefore react to turns as they happen rather than polling for them.

Not every event is broadcast. `server.ts` holds an explicit allow-list, currently covering connection changes (`DLLConnected`, `DLLDisconnected`), game changes (`GameSwitched`), turn and victory (`PlayerDoneTurn`, `PlayerVictory`), the render cues used for session recording (`PlayerPanelSwitch`, `AnimationStarted`), the human-control decision (`HumanDecision`), and the diplomacy panel events. Anything not on that list is recorded but not pushed. A separate `vox-deorum/heartbeat` notification keeps the channel alive across long synchronous work such as the victory archive.

These notifications originate in the knowledge manager's handling of the event stream; see [events.md](events.md).

## Where the details live

This folder explains _what and why_ in prose. The exact reference data stays inside the component, under `mcp-server/docs/`:

- `docs/tools.md`: every tool, with its category and input parameters.
- `docs/events/`: per-event schemas and descriptions (`md/` and `json/`).
- `docs/flavors/`: per-flavor deep dives into which AI subsystems each flavor steers.
- `docs/strategies/`: the economic, military, grand, and flavor strategy reference data.
- `docs/diplomacy/` and `docs/influence/`: diplomacy mechanics and the tactical-AI influence analysis.
- `docs/enums/` and `docs/database/`: game-database enum mappings and exported schema.
- `docs/api/`: generated TypeDoc API reference.

For building, running, and debugging the server, see [setup.md](../setup.md) and [testing.md](../testing.md). For the environment variables and `config.json` keys it reads, see [configuration.md](configuration.md).
