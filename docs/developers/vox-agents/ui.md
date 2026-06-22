# vox-agents — Web UI

Vox-agents ships a web dashboard for watching and steering everything this folder describes: start and stop game sessions, chat with agents, stream logs, and browse telemetry.

It is a Vue 3 single-page app (`vox-agents/ui/`) served by an Express backend (`src/web/`) that runs **in the same Node process as the agents**. The backend does not talk to the agents over a network; it reads the same in-memory registries and telemetry exporter they use.

## The backend

`src/web/server.ts` starts Express on the configured port (5555 by default, falling back to 5556 if taken), serves the built UI from `dist-ui/`, and registers with the process manager for clean shutdown.

Two conventions help local orchestration:

- `POST /shutdown` routes through the normal shutdown flow.
- When `VOX_SHUTDOWN_URL_FILE` is set, the server writes a one-line file with its real shutdown URL after binding, so a launcher knows the actual port even after a fallback.

Real-time data flows over Server-Sent Events, coordinated by an `SSEManager` (`src/web/sse-manager.ts`) that tracks connected clients and heartbeats them to keep proxies from closing idle streams.

The API splits into four route groups under `src/web/routes/`:

| Group | File | What it does |
| --- | --- | --- |
| Session control | `session.ts` | List, save, and delete the session configs in `configs/`; start a [strategist session](strategist.md) in the background; query its status (it polls the session registry); stop it gracefully; and summarize the players in the running game with their AI assignments. |
| Agent chat | `agent.ts` | List registered agents; create chat threads against either a live context (an in-game [envoy](envoy.md) conversation) or a database path (a [telepathist](telepathist.md) session, whose context is created and later shut down with the thread); and the unified `POST /api/agents/message` endpoint, which executes the thread's agent and streams text, reasoning, tool-call, and tool-result events back as SSE. |
| Telemetry | `telemetry.ts` | Discover telemetry databases on disk, accept uploads, list the contexts currently exporting spans, stream a live context's new spans over SSE, and page through traces and spans of stored databases. See [observability.md](observability.md) for what these spans contain. |
| Config | `config.ts` | Read and write `config.json` (model definitions, agent-model mappings) and the API keys in `.env`, diffing against defaults and reloading the environment on save. |

## The dashboard

The Vue app uses PrimeVue components, Pinia stores, and virtual scrolling for the high-volume views. It organizes those APIs into a handful of views:

- **Session** — the control room: pick or edit a session config, start and stop the game, and watch session state (starting, running, recovering, stopping) and the player roster.
- **Chat** — the hub for agent conversations: start a chat against a running game or a telemetry database, resume an existing thread, and open the conversation view, which renders streamed text, model reasoning, and tool calls and results as they arrive. Opening a chat sends the agent's greeting special message; database-backed chats stream the telepathist's preparation progress before the first reply.
- **Telemetry** — browse live contexts and stored databases; drill from a database to its traces to the span hierarchy of a single trace, including the recorded LLM messages of each step. This is the primary debugging surface for agent behavior.
- **Logs** — the process's Winston log stream, live over SSE, filterable by source and level.
- **Config** — edit model definitions, per-agent model mappings, and API keys without touching files by hand.

## Development

The UI dev server (`cd ui && npm run dev`) proxies to the backend; `npm run build` at the module root builds both.

To verify a UI change type-checks, run `npm run type-check` (in `ui/`). It runs `vue-tsc --build`, which follows the project references and so checks `tests/` as well as `src/`. A bare `vue-tsc --noEmit` can pass while the build fails, because it skips the test files.

The dashboard starts automatically with every console workflow — strategist, telepathist, and friends — so there is always a window into a running session.

## Related: the player-facing replayer

Session review for *players* — rewatching a finished game — is a separate tool, the Vox Deorum Replayer. It lives in its own repository (`vox-deorum-replay`) and is covered in the players' documentation. This dashboard is the developer-facing surface.
