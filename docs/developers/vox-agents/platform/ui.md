# Web UI

Vox Agents ships a web dashboard for developers. From it you can start and stop games, chat with agents, read logs, and browse telemetry.

```
browser (Vue app, vox-agents/ui/)
   │  REST + Server-Sent Events
   ▼
Express backend (src/web/)  ── same Node process ──  agents, registries, telemetry exporter
```

The backend runs **in the same Node process as the agents**. It reads the same in-memory registries and telemetry exporter they use, so there is no network hop between the dashboard and the agents.

The dashboard starts automatically with every console workflow (strategist, telepathist, and others), so there is always a window into a running session.

The player-facing tool for rewatching a finished game is a separate project, the Vox Deorum Replayer (`vox-deorum-replay`), covered in the players' documentation.

## The backend

`src/web/server.ts` starts Express on the configured port (5555 by default, or 5556 if that is taken), serves the built UI from `dist-ui/`, and registers with the process manager for a clean shutdown.

For launchers:

- `POST /shutdown` goes through the normal shutdown flow.
- When `VOX_SHUTDOWN_URL_FILE` is set, the server writes its real shutdown URL to that file after it starts, so a launcher knows the port even after a fallback.

Live data flows over Server-Sent Events. `SSEManager` (`src/web/sse-manager.ts`) tracks connected clients and sends heartbeats so proxies do not close idle streams.

### API groups

| Group | Code | What it does |
| --- | --- | --- |
| Session control | `src/web/routes/session.ts` | List, save, and delete session configs; start a [game session](../agents/strategists/game-session.md) in the background; report its status; stop it; list the players and their AI assignments. |
| Agent chat | `src/web/chat/` | List agents, create threads, and run `POST /api/agents/message`, which streams the agent's reply over SSE. |
| Telemetry | `src/web/routes/telemetry.ts` | Find telemetry databases, accept uploads, list live contexts, stream new spans, page through stored traces, and [export a seat's workspace](../workspace/store.md#reading-the-store-from-outside). |
| Config | `src/web/routes/config.ts` | Read and write `config.json` and the API keys in `.env`, compare against the defaults, and reload the environment on save. |
| Debug | `src/web/routes/debug.ts` | Log files and the log bundle. See [Debug page](#debug-page). |

### Agent chat

`src/web/routes/agent.ts` only mounts the chat routers, so start in `src/web/chat/` when working on chat:

| File | Role |
| --- | --- |
| `factory.ts` | Opens a thread against either a live context (an in-game [envoy](../agents/envoys.md) chat) or a database path (a [telepathist](../agents/telepathist.md) session, with a read-only source connection and its own context). |
| `turn.ts` | Runs one chat turn end to end, and guarantees exactly one final event per saved turn. It does not depend on the transport. |
| `message.ts` | Connects `turn.ts` to SSE. |
| `discovery.ts` | Lists agents and manages thread lifecycle. |
| `deal.ts` | Closing conversations, and deal inspection and actions. |
| `store.ts` | The in-memory thread cache. |
| `enrichment.ts` | Fills in participant identity: civilization, leader, human seat, current turn. |

## The dashboard

The Vue app uses PrimeVue components, Pinia stores, and virtual scrolling for long lists.

| View | Use |
| --- | --- |
| **Session** | Pick or edit a session config, start and stop the game, and watch the session state and player list. |
| **Chat** | Start a chat with a running game or a telemetry database, resume a thread, and watch streamed text, reasoning, and tool calls. An empty live chat shows a fixed greeting, and the agent speaks once addressed. A database chat first streams the telepathist's preparation progress. |
| **Telemetry** | Browse live contexts and stored databases, from database to trace to span tree, including each step's recorded messages. The main debugging tool for agent behavior. |
| **Debug** | Logs from every service in one place. `/logs` redirects here. |
| **Config** | Edit models, per-agent model assignments, and API keys. |

### Strategist turn view

Opening a `strategist.turn.N` span in Telemetry shows a summary of that turn instead of raw attributes.

- **Finding it.** Spans and stored traces that have this view show a sliders icon. Clicking it in a trace list opens the view without leaving the list.
- **Switching.** The view shares a frame with the raw attributes dialog, and a header button switches between them. The header also shows the pacing flags (decided, interrupted, skipped).
- **Left side: decisions.** Strategy choices (including economic and military strategies in Strategy mode), flavor and persona scales, and relationship stances. Only changed values show by default. Rationales render as Markdown.
- **Right side: metadata.** Status, model and tokens, pacing, and the strategist model's own steps.
- **Repeated calls.** When a tool was called several times, each field shows its latest value and outcome, including MCP errors.
- **Evaluator strategist.** It shares the same sections. Its rows add a score histogram and confidence, and hovering a row shows the evaluator's original answer.

`api/strategist-turn.ts` builds the view from the trace. The components are in `components/telemetry/strategist/`.

### Debug page

The Debug page gathers logs into one card:

- **Live tab.** The process's Winston logs as they happen, filterable by level and source.
- **File tabs.** Log folders for Vox Agents, the bridge, the MCP server, and Civ 5. Service tabs open the newest log first (rotated Winston files give the active one the highest number). The Civ 5 tab opens `Lua.log` first. Each tab has a file picker, search, a level filter for structured logs, and Refresh. Large files show only their last 512 KB.
- **Download all.** Zips the latest logs for bug reports.
- **Civ 5 logging switch.** Sets `LoggingEnabled` in the game's `config.ini`. Civ 5 reads it only at startup, so the page asks for a restart after a change.

**What the bundle contains:**

- The `.log` files under `vox-agents/`, `bridge-service/`, `mcp-server/`, and `civ5/`.
- For the three services, only the newest file of each rotated log (`combined*.log` and `error*.log`). Every Civ 5 log, since the game rewrites them each launch.
- Any file over 10 MB (such as the DLL's `connection-pipe.log` in a long game) contributes only its newest 10 MB.
- `setup.txt` with the Vox Deorum version, platform, Civ 5 logging state, installed mod folder names, and which files were included or skipped.
- Never API keys, `.env`, config JSON, or telemetry databases.

**Code:**

| Piece | Location |
| --- | --- |
| Routes (`GET /status`, `PUT /civ-logging`, `GET /logs/:source/:file`, `GET /bundle` under `/api/debug`) | `src/web/routes/debug.ts`. The file route only serves names from the folder listing, never arbitrary paths. |
| Finding the four log folders | `src/utils/debug/log-sources.ts`. Sibling services are found next to the `vox-agents` folder. |
| Building the zip (with yazl) | `src/utils/debug/log-bundle.ts` |
| Reading and writing the ini setting | `readCivLoggingEnabledContent` and `updateCivLoggingEnabledContent` in `src/utils/game/civ5-ini.ts` |
| The page | `ui/src/views/DebugView.vue`, built from `ui/src/components/logging/` (`LogViewer.vue`, `LogFileViewer.vue`, and the shared `LogTable.vue`) |

## Development

- `cd ui && npm run dev` starts the UI dev server, which proxies to the backend.
- `npm run build` at the `vox-agents` root builds both.
- To check that a UI change type-checks, run `npm run type-check` in `ui/`. It runs `vue-tsc --build`, which also checks `tests/`. A bare `vue-tsc --noEmit` can pass while the build fails, because it skips the test files.
