# Web UI

Vox Agents ships a web dashboard for developers. From it you can start and stop games, chat with agents, read logs, and browse telemetry.

```
browser (Vue app, vox-agents/ui/)
   │  REST + Server-Sent Events
   ▼
Express backend (src/web/)  ── same Node process ──  agents, registries, telemetry exporter
```

The backend runs **in the same Node process as the agents**. It reads the same in-memory registries and telemetry exporter they use, so there is no network hop between the dashboard and the agents.

The strategist, telepathist, Oracle, and Archivist consoles start the dashboard automatically.

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

The Vue app uses PrimeVue components, reactive stores, and virtual scrolling for long lists.

| View | Use |
| --- | --- |
| **Session** | Pick or edit a session config, start and stop the game, and watch the session state and player list. |
| **Chat** | Start a chat with a running game or a telemetry database, resume a thread, and watch streamed text, reasoning, and tool calls. An empty live chat shows a fixed greeting (see [Live envoys](../agents/envoys.md#live-envoys)). A database chat first streams the telepathist's preparation progress. |
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

`ui/src/presentation/strategist-turn.ts` builds the view from the trace. The telemetry and log presentation helpers share that folder; `ui/src/api/client.ts` owns API requests. The components are in `components/telemetry/strategist/`.

### Debug page

The Debug page gathers logs into one card and can send the sample issue to the game:

- **Tabs.** Live Winston logs from the process, filterable by level and source, plus file tabs for Vox Agents, the bridge, the MCP server, and Civ 5. Service tabs open the newest log first (the Civ 5 tab opens `Lua.log`). Each tab has a file picker, search, a level filter for structured logs, and Refresh. Large files show only their last 512 KB.
- **Download all.** Zips the latest logs for bug reports: the newest rotated `combined*.log` and `error*.log` per service, every Civ 5 log (the game rewrites them each launch), and a `setup.txt` manifest with the Vox Deorum version, platform, Civ 5 logging state, installed mod folder names, and which files were included or skipped. A file over 10 MB contributes only its newest 10 MB. Never API keys, `.env`, config JSON, or telemetry databases.
- **Civ 5 logging switch.** Sets `LoggingEnabled` in the game's `config.ini`. Civ 5 reads it only at startup, so the page asks for a restart after a change.
- **Show newspaper.** Exports the packaged Victorian sample for the current seat and reports success once the game acknowledges opening it. See [show an issue in the game](../newspaper/renderer.md#show-an-issue-in-the-game) for setup and fallback behavior.

Log routes live under `/api/debug` in `src/web/routes/debug.ts` and accept only filenames from the folder listing. Discovery and zip creation live in `src/utils/debug/log-sources.ts` and `log-bundle.ts`, and ini updates in `src/game/civ5-ini.ts`. `ui/src/views/DebugView.vue` uses the components in `ui/src/components/logging/`.

### Writing Desk

Open **Debug → Writing Desk** from a writable source checkout. Use a configured chat model to draft stock variants, then save approved copy to the catalogue. See the [catalogue and authoring reference](../newspaper/editorial.md) for template fields.

1. **Choose variants.** Search, the All/Unsettled/Settled filter, and topic tags narrow the list. Unsettled variants are checked by default; **Generate** uses checked variants that match the filters.
2. **Generate.** Pick choices per model and one or more models. Requests group checked variants by voice, stance, and genre, up to eight per request, and include the [writing guide](../newspaper/writing.md) in the model prompt.
3. **Review.** A variant lists its current copy and candidates by model. Generated and settled copy has misspelled placeholders repaired to the listed names first (see [Placeholders and facts](../newspaper/editorial.md#placeholders-and-facts)). Click an unsettled row to edit; those working drafts survive editor and variant switches.
4. **Settle.** Settling saves the copy to the catalogue and marks it settled; **Unsettle** reopens it. **Settle multiple…** keeps one copy at the original ID and file and appends the rest as `-1`, `-2`, … in a companion such as `war-variants.json`. Each inherits the original's settings, including style, eligibility, weight, and links.
5. **Reset.** Stop a running batch, then **Clear drafts** to remove generated candidates and edits while keeping current copies.

The model field lists configured chat models; **More models…** adds a model from a saved provider connection for this visit. Choices default to 3 and cap at 30. **Edit style** corrects voice, stance, and genre and clears that variant's drafts for the old style; the article and its settled state stay. The writer sees each drafted template's settled variants and up to six from others with shared tags or style. Merge variants and `mode: llmOnly` templates are outside the desk.

In **Telemetry**, select an `agent.newspaper-writer` trace in the `newspaper-desk` database to read each call's prompt and reply. Search by variant or model; **Refresh** and **Load older traces** reach more. Replies in `newspaper/newspaper-desk-player-0.db` survive a restart; drafts do not. The desk shows provider token totals, and Telemetry splits visible output and reasoning.

The UI starts at `WritingDeskView.vue`. The catalogue and writer brief live in `vox-agents/src/newspaper/desk/`, and the prompt is `vox-agents/prompts/newspaper-writer.md`.

## Development

Install the service dependencies from the repository root with `npm install`. The UI has its own package and lockfile outside the npm workspaces; install it from the same root with `npm install --prefix vox-agents/ui --include=dev`.

- From `vox-agents/`, `cd ui && npm run dev` starts the UI dev server, which proxies to the backend.
- `npm run build` at the `vox-agents` root builds both.
- To check that a UI change type-checks, run `npm run type-check` in `ui/`. It runs `vue-tsc --build`, which also checks `tests/`. A bare `vue-tsc --noEmit` can pass while the build fails, because it skips the test files.
