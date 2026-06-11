# mcp-server — Overview

The MCP server is where the AI side of Vox Deorum meets the game. It exposes Civilization V's state and controls to language-model agents as a set of [Model Context Protocol](https://modelcontextprotocol.io) tools: an agent can ask "what technologies can this player research?" or tell the game "set this civilization's grand strategy to conquest," and the MCP server turns those requests into game-database queries, persisted knowledge lookups, or Lua executed inside the running game.

It sits one layer above the [bridge-service](../bridge-service/overview.md). The bridge speaks to the DLL over a Windows named pipe and re-exposes everything as HTTP; the MCP server is the bridge's primary consumer. It never touches the pipe directly — it drives queued Lua through the bridge's REST API and subscribes to the bridge's event stream. Above the MCP server are the vox-agents, which connect as MCP clients and call its tools. The end-to-end path across every layer is stitched together in [protocol.md](../protocol.md).

It is a Node.js/TypeScript service. The source lives in `mcp-server/src/`, and this folder documents what it does and how its pieces fit. Exact reference data — the per-tool parameter listings, the per-event schemas, the flavor and strategy tables, the generated API docs — stays inside the component under `mcp-server/docs/`; see [Where the details live](#where-the-details-live).

## What it does

The server's job is to be a faithful, queryable, controllable mirror of the game for an agent that cannot see the game directly. It does this through four cooperating subsystems:

- **Tools** are the agent-facing surface: roughly three dozen, split into general utilities, game-database queries, knowledge queries, and game actions. They are the only thing an agent sees. See [tools.md](tools.md).
- **The knowledge store** is the server's memory. As the game emits events, the server records them and periodically pulls snapshots of player and city state into a per-game SQLite database, filtered by what each player can actually see. Knowledge-query tools read from this store rather than hitting the game on every request. See [knowledge.md](knowledge.md) and [events.md](events.md).
- **The game database** is Civilization V's own rules data — every unit, building, technology, policy, and strategy — read directly from the game's SQLite files and localized into readable text. Database-query tools answer "what does this thing do?" from here. See [database.md](database.md).
- **The bridge integration** is how everything reaches the live game: a queue that batches Lua calls to the bridge, paces the game when the queue backs up, and consumes the event stream. See [bridge.md](bridge.md).

On top of reading state, a number of action tools *steer* the game's own AI — adjusting flavors, strategies, personas, and diplomatic relationships so that the influence of a language model is felt even by civilizations it does not directly control. How those tools reach into the tactical AI is the subject of [influence.md](influence.md).

## How the server is built

A single `MCPServer` singleton (`mcp-server/src/server.ts`) owns the whole service. It constructs the three managers — `BridgeManager`, `DatabaseManager`, `KnowledgeManager` — once and shares them across every client connection. Each connecting MCP client gets its own underlying `McpServer` instance from the SDK, but they all draw on the same managers and the same lazily-instantiated tool set, so a connection is cheap and game state is consistent regardless of how many agents are attached.

Tools are registered through a **factory pattern with lazy loading**. `mcp-server/src/tools/index.ts` holds a map of factory functions, one per tool; the actual tool objects are constructed on first server initialization and then cached and reused. This keeps startup fast and memory low, and it is the pattern any new tool plugs into. The tool framework itself — the `ToolBase` abstract class and the specialized base classes above it — is described in [tools.md](tools.md).

### Transports and server modes

The server supports two MCP transports, chosen by configuration:

- **stdio** — the server talks over standard input/output, the natural fit for an agent that launches the MCP server as a child process.
- **HTTP** — the server runs a Streamable-HTTP endpoint, for clients that connect over the network.

Tools, managers, and knowledge behave identically under both transports; only the wiring differs, and the test suite exercises both (see [testing.md](../testing.md)). When running over HTTP the server exposes a small set of endpoints — a `GET /health` probe, the MCP endpoint itself (`POST`/`GET`/`DELETE /mcp`), and a `POST /shutdown` for local orchestration that performs a graceful shutdown.

### Discovering the running port

Like the bridge service, the MCP server can be started on a dynamically chosen port. When the environment variable `MCP_SHUTDOWN_URL_FILE` is set, the HTTP server writes a one-line file containing its real shutdown URL (`http://127.0.0.1:<actual-port>/shutdown`) once it has bound, so a launcher can find the actual port without scraping logs.

## Notifications back to clients

The flow is not purely request/response. When the game advances — the DLL connects or disconnects, the active game switches, or a render-worthy event fires — the server pushes an MCP notification to connected clients (`DLLConnected`, `DLLDisconnected`, `GameSwitched`, and per-event render notifications). This lets an agent react to turns as they happen rather than polling. The notifications originate in the knowledge manager's handling of the event stream; see [events.md](events.md).

## Where this sits in the stack

Below is the [bridge-service](../bridge-service/overview.md), which the MCP server drives and subscribes to. The MCP-side view of that link — queued Lua and event consumption — is in [bridge.md](bridge.md), and it is the counterpart to the bridge's own [connection.md](../bridge-service/connection.md) and [lua.md](../bridge-service/lua.md); the two should be read together. Above is the vox-agents framework, whose agents consume these tools — [tools.md](tools.md) and [knowledge.md](knowledge.md) are the reference those pages point back to. The big picture across all five components is in [architecture.md](../architecture.md).

## Where the details live

Following the project's documentation rule, this folder explains *what and why* in prose, while exact reference data stays inside the component under `mcp-server/docs/`:

- `docs/tools.md` — every tool, with its category and input parameters.
- `docs/events/` — per-event schemas and descriptions (`md/` and `json/`).
- `docs/flavors/` — per-flavor deep dives into which AI subsystems each flavor steers.
- `docs/strategies/` — the economic, military, grand, and flavor strategy reference data.
- `docs/diplomacy/` and `docs/influence/` — diplomacy mechanics and the tactical-AI influence analysis.
- `docs/enums/` and `docs/database/` — game-database enum mappings and exported schema.
- `docs/api/` — generated TypeDoc API reference.

For building, running, and debugging the server, see [setup.md](../setup.md) and [testing.md](../testing.md).
