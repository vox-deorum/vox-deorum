# vox-agents — Overview

Vox-agents is the top of the Vox Deorum stack: the TypeScript framework in which language-model agents actually play Civilization V. Everything below it exists to serve this layer. The [mcp-server](../mcp-server/overview.md) exposes the game as tools, and the bridge and DLL carry those tool calls into the running game. Everything player-facing — strategic decisions, in-character chat, post-game analysis — is produced here.

The source lives in `vox-agents/src/`. Generated API reference stays with the component in `vox-agents/docs/api/`.

The framework has a small core — an agent base class, an execution context, and a few global registries — with families of concrete agents built on top. Each family has its own page:

| Family | What it does |
| --- | --- |
| [Strategists](strategist.md) | Make the per-turn strategic decisions for the civilizations the LLM controls. |
| [Envoys](envoy.md) | Hold conversations — spokespersons and diplomats that players chat with in-game. |
| [Support agents](support-agents.md) | Briefers, analysts, and librarians that do focused work the other agents delegate to. |
| [Telepathists](telepathist.md) | Answer questions about a finished game by reading its recorded telemetry. |
| [Oracle](oracle.md) | Replays past turns with modified prompts or different models for "what-if" experiments. |
| [Archivist](archivist.md) | Batch-processes finished games into an episode database that strategists learn from. |

The [web UI](ui.md), [media pipeline](media.md), and [observability](observability.md) pages cover the dashboard, OBS capture and video generation, and tracing and logging.

## VoxAgent: the base class

Every agent extends `VoxAgent` (`src/infra/vox-agent.ts`). An agent is not a long-running object. It is a bundle of *lifecycle hooks* that the execution context calls while driving an agentic loop.

The main hooks, in the order they matter:

| Hook | Responsibility |
| --- | --- |
| `getModel()` | Chooses the LLM for this run, and can vary it per input. Falls back to the per-agent and default model mappings in `config.json`. |
| `getSystem()` | Returns the system prompt. |
| `getInitialMessages()` | Builds the opening context — for strategists, the formatted game state. |
| `getActiveTools()` | Names the tools the model may call this step. |
| `getExtraTools()` | Contributes agent-specific tools beyond the shared MCP set. |
| `prepareStep()` | Runs before each step. Can prune messages, drop already-used tools, or switch models mid-run. |
| `stopCheck()` | Decides after each step whether the loop is done. |
| `getOutput()` / `postprocessOutput()` | Turn the final exchange into a typed result, optionally validated against a Zod schema. |

Most agents declare `requiredTools` to control stopping. The loop ends once one of those tools has been called successfully — a strategist stops after `set-strategy` or `keep-status-quo`, for example — with a maximum step count as a backstop.

Two flags change the execution shape entirely:

- **`fireAndForget`** — the agent returns to its caller immediately and runs detached as its own root run (started with `forkRun()`, see below). It gets an independent cancellation signal and token sink, so it survives cancellation of the caller's run. This is what lets a diplomat hand a report to an [analyst](support-agents.md) and keep talking without waiting for the intelligence processing.
- **`programmatic`** — the agent skips the LLM altogether and implements `handleMessage()` directly. The telepathist's episode retriever is one.

## VoxContext: the execution engine

`VoxContext` (`src/infra/vox-context.ts`) runs agents. It owns one seat's long-lived resources: the MCP client connection, the tool registry, and the on-disk cache of tool definitions. The actual work happens inside **root runs**.

### Root runs

A root run is one operation on the seat — a strategist turn, a diplomat chat, an automatic deal response, or a detached analyst. Each root run owns that operation's own cancellation signal, progress callback, timeout refresh, token sink, and run-local turn and event window.

Because every operation gets its own root, several can run on the same seat at once without overwriting one another's state. A strategist can finish an older queued turn while a diplomat chats on the current live turn, and a client disconnecting from one chat cancels only that chat.

The run-model types and helpers live in `src/infra/vox-run.ts`. The three ways to enter or move between runs:

| Call | Behavior |
| --- | --- |
| `withRun()` | Opens a root run, wrapping the whole operation — including the setup and game-state refresh before the first agent call. Hands its callback a run handle that can cancel just that operation. |
| `forkRun()` | Starts a *detached* root for fire-and-forget work that must outlive its caller (the analyst handoff above). |
| `callAgent(name, input)` | Runs a nested agent inside the active root. The nested call inherits the caller's cancellation and token accounting, replacing only the current agent input. |

`execute(agentName, input)` runs inside the active root, like `callAgent`. Both take no parameters argument because the run already carries them, so calling either outside a run is a programming error. `execute()` assembles the prompt from the agent's hooks and drives the step loop — calling the model, executing tool calls, consulting `stopCheck()` — until the agent is done. It streams text and tool events to an optional callback along the way, which is what the web UI's chat rides on.

### Parameters and cancellation

The run's parameters come from the seat's base. `setBaseParameters()` installs the stable parameter object the context owns. `currentParameters` is the active root's composed view of it: it overlays that run's turn fields on the shared seat state, and falls back to the base outside a run.

Cancellation has two scopes that mirror these layers:

- `run.abort()` cancels a single operation.
- `context.abort()` cancels every active root. This is the one used by player abort, game switching, and shutdown.

Token usage accumulates into both the run's own sink and the seat-wide totals, so per-turn cost stays separable from the seat's running total.

### Tools

Tools come from two sources. `registerTools()` fetches the tool list from the [MCP server](../mcp-server/tools.md), wraps each one for the AI SDK (auto-filling identifiers like player ID and turn, and formatting JSON results as markdown), and caches the definitions on disk so a context can come up offline from `loadToolCache()`.

On top of those, every registered agent is itself wrapped as a `call-{name}` tool, so agents can invoke each other. A diplomat calling `call-diplomatic-analyst` is an ordinary tool call.

Agents can also bypass the LLM and invoke things directly:

- `callTool()` runs a single tool. It still takes explicit parameters and needs no active run, so setup and shutdown paths keep working.
- `callAgent()` runs a nested agent inside the current root and returns its typed output.

Each context has a stable ID — for a strategist player it is `{gameID}-player-{playerID}`. That ID names the SQLite telemetry database all of the context's spans are exported to. See [observability.md](observability.md).

## Sessions, registries, and process lifecycle

A `VoxSession` (`src/infra/vox-session.ts`) is a long-running workflow — a game being played, or a narrator pipeline stage. It has a state machine (starting, running, recovering, stopping) that the web UI can display and control. `StrategistSession` is the main implementation; the [media pipeline](media.md) stages are others.

Sessions that launch the game itself do so through `VoxCivilization` (`src/infra/vox-civilization.ts`). It generates launch Lua from templates, spawns and binds to the CivilizationV.exe process, and kills it on shutdown.

Three global registries tie the process together:

- **`agentRegistry`** holds every available agent. All core agents register at startup in `src/infra/agent-registry.ts`.
- **`sessionRegistry`** tracks active sessions and enforces a single game session at a time.
- **`contextRegistry`** tracks live contexts so the web routes can find them.

`processManager` (`src/infra/process-manager.ts`) consolidates signal handling. Every console entry point and long-lived service registers a named shutdown hook. On SIGINT or SIGTERM the hooks run in order: stop the session, flush telemetry, close databases.

## Models and configuration

Model definitions live in `vox-agents/config.json` under `llms`. Each entry maps a key like `openai/gpt-5-mini` to a provider and model name, with a `default` alias and an `embedder` alias for embedding models.

The framework is provider-agnostic. OpenRouter, OpenAI, Anthropic, Google, AWS Bedrock, and OpenAI-compatible endpoints are supported, with API keys supplied via `.env` (see `src/utils/models/models.ts`). Agents resolve their model through `getModel()`, so a config can assign different models to different agents, or different strategists to different players in the same game.

Two pieces of middleware sit between agents and providers:

- Per-model concurrency limiting (`src/utils/models/concurrency.ts`) caps parallel requests with semaphore-style tracking.
- The tool-rescue middleware (`src/utils/models/tool-rescue/`) salvages tool calls that weaker models emit as JSON text instead of structured calls.

## Where this sits in the stack

Below vox-agents is the [MCP server](../mcp-server/overview.md). Vox-agents connects to it as an MCP client over stdio or HTTP, calls its tools, and reacts to its notifications (turn completion, game switches, DLL connect and disconnect). The agents never talk to the bridge or the game directly.

The end-to-end message path is traced in the top-level [protocol](../protocol.md) page, and the overall component map in the [architecture](../architecture.md) page.

## Where the details live

This folder explains what the framework does and why. The exact API surface stays with the component:

- `vox-agents/docs/api/` — generated TypeDoc reference for the source.
- `vox-agents/AGENTS.md` — working conventions for contributors (imports, logging, testing rules).
- For building and testing the module, see [setup.md](../setup.md) and [testing.md](../testing.md).
