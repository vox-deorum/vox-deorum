# vox-agents: Web UI

Vox-agents ships a web dashboard for watching and steering everything this folder describes: start and stop game sessions, chat with agents, inspect logs, and browse telemetry.

It is a Vue 3 single-page app (`vox-agents/ui/`) served by an Express backend (`src/web/`) that runs **in the same Node process as the agents**. The backend does not talk to the agents over a network; it reads the same in-memory registries and telemetry exporter they use.

## The backend

`src/web/server.ts` starts Express on the configured port (5555 by default, falling back to 5556 if taken), serves the built UI from `dist-ui/`, and registers with the process manager for clean shutdown.

Two conventions help local orchestration:

- `POST /shutdown` routes through the normal shutdown flow.
- When `VOX_SHUTDOWN_URL_FILE` is set, the server writes a one-line file with its real shutdown URL after binding, so a launcher knows the actual port even after a fallback.

Real-time data flows over Server-Sent Events, coordinated by an `SSEManager` (`src/web/sse-manager.ts`) that tracks connected clients and heartbeats them to keep proxies from closing idle streams.

The API splits into these groups:

| Group | Where the code lives | What it does |
| --- | --- | --- |
| Session control | `src/web/routes/session.ts` | List, save, and delete the session configs in `configs/`; start a [strategist session](strategist.md) in the background; query its status from the session registry; stop it gracefully; and summarize the players in the running game with their AI assignments. |
| Agent chat | `src/web/chat/` | List registered agents, create chat threads, and run the unified `POST /api/agents/message` endpoint, which executes the thread's agent and streams text, reasoning, tool-call, and tool-result events back as SSE. |
| Telemetry | `src/web/routes/telemetry.ts` | Discover telemetry databases on disk, accept uploads, list the contexts currently exporting spans, stream a live context's new spans over SSE, and page through traces and spans of stored databases. See [observability.md](observability.md) for what these spans contain. |
| Config | `src/web/routes/config.ts` | Read and write `config.json` (model definitions, agent-model mappings) and the API keys in `.env`, diffing against the defaults in `src/utils/config/defaults.ts` and reloading the environment on save. |

`src/web/routes/agent.ts` only composes the chat routers under their established paths, so start in `src/web/chat/` when working on chat:

- `factory.ts` opens ordinary and diplomacy threads against exactly one live context (an in-game [envoy](envoy.md) conversation) or database path (a [telepathist](telepathist.md) session with a read-only source connection and a context owned by that thread).
- `turn.ts` runs one chat turn end to end and guarantees exactly one terminal event per committed turn. It is transport-neutral; `message.ts` adapts it to SSE.
- `discovery.ts` lists agents and manages thread lifecycle, `deal.ts` serves conversation close plus deal inspection and actions, `store.ts` owns the in-memory thread cache, and `enrichment.ts` resolves participant identity (civilization, leader, human seat, current turn).

## The dashboard

The Vue app uses PrimeVue components, Pinia stores, and virtual scrolling for the high-volume views. It organizes those APIs into a handful of views:

- **Session** is the control room: pick or edit a session config, start and stop the game, and watch session state (starting, running, recovering, stopping) and the player roster.
- **Chat** is the hub for agent conversations: start a chat against a running game or a telemetry database, resume an existing thread, and open the conversation view, which renders streamed text, model reasoning, and tool calls and results as they arrive. An empty live chat shows a canned greeting line, and the agent first speaks when addressed. Opening a database-backed chat sends the telepathist's greeting special message and streams its preparation progress before the first reply.
- **Telemetry** browses live contexts and stored databases, drilling from a database to its traces to the span hierarchy of a single trace, including the recorded LLM messages of each step. This is the primary debugging surface for agent behavior. Opening a `strategist.turn.N` span shows the strategist turn view instead of the raw attributes. Spans and stored traces that have this view carry a sliders icon, and clicking it in a database's trace list opens the view without leaving the list. The view shares the raw attributes dialog's frame, so its header button switches between the two in place, and the header also shows the pacing flags (decided, interrupted, skipped). The left side shows the turn's decisions as strategy choices (including economic and military strategies in Strategy mode), flavor and persona scales, and relationship stances. It filters to changed values by default, and rationales render as markdown. The right side lists the turn's metadata: status, model and tokens, pacing, and the strategist LLM's own steps. Repeated partial tool calls retain each field's latest value and outcome, including MCP error responses. Evaluator and LLM strategists share the same sections. Evaluator rows add the score histogram and confidence, and hovering a row shows the evaluator's original answer. `api/strategist-turn.ts` builds the view from the trace, and the components live in `components/telemetry/strategist/`.
- **Debug** (`/logs` redirects here) gathers the logging views in one card: a Live tab streaming the process's Winston logs filterable by level and source, file tabs for the vox-agents, bridge, MCP, and Civ 5 log folders, and a **Download all** button that zips the latest logs for bug reports. The header's **Civ 5 logging** switch sets the game's `LoggingEnabled` value in its `config.ini`, which Civ 5 reads only at startup, so the page asks for a Civ 5 restart after a change.
- **Config** edits model definitions, per-agent model mappings, and API keys without touching files by hand.

How the Debug page works:

- File tabs open the newest log first for the service folders (rotated Winston files put the active one at the highest number) and `Lua.log` first for Civ 5, and give a file picker, a search box, a level filter for structured logs, and Refresh. Large files show only their last 512 KB.
- The page is backed by its own route group, `src/web/routes/debug.ts`, mounted at `/api/debug`: `GET /status`, `PUT /civ-logging`, `GET /logs/:source/:file`, and `GET /bundle`. The file route reads only names taken from the folder listing, never arbitrary paths.
- `src/utils/debug/log-sources.ts` locates the four log folders (sibling services are found next to the vox-agents folder) and `src/utils/debug/log-bundle.ts` builds the zip with yazl. The ini reads and writes go through `readCivLoggingEnabledContent` and `updateCivLoggingEnabledContent` in `src/utils/game/civ5-ini.ts`.
- The bundle contains the `.log` files under `vox-agents/`, `bridge-service/`, `mcp-server/`, and `civ5/`, plus `setup.txt` with the VD version, platform, Civ 5 logging state, installed mod folder names, and which files were included or skipped. For the three services it takes only the newest file of each rotated log (the newest `combined*.log` and `error*.log`); every Civ 5 log goes in, since the game rewrites them on each launch. Any file over 10 MB, such as the DLL's `connection-pipe.log` during a long game, contributes only its newest 10 MB. It never includes API keys, `.env`, config JSON, or telemetry databases.
- In the UI, `ui/src/views/DebugView.vue` composes the page from `ui/src/components/logging/`: `LogViewer.vue` for the live tab, `LogFileViewer.vue` for the file tabs, and a shared `LogTable.vue`.

## Development

The UI dev server (`cd ui && npm run dev`) proxies to the backend; `npm run build` at the module root builds both.

To verify a UI change type-checks, run `npm run type-check` in `ui/`. It runs `vue-tsc --build`, which follows the project references and so checks `tests/` as well as `src/`. A bare `vue-tsc --noEmit` can pass while the build fails, because it skips the test files.

The dashboard starts automatically with every console workflow (strategist, telepathist, and friends), so there is always a window into a running session.

## Related: the player-facing replayer

Session review for _players_, meaning rewatching a finished game, is a separate tool: the Vox Deorum Replayer. It lives in its own repository (`vox-deorum-replay`) and is covered in the players' documentation. This dashboard is the developer-facing surface.
