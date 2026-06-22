# vox-agents — Overview

Vox-agents is the top of the Vox Deorum stack: the TypeScript framework in which language-model agents actually play Civilization V. Everything below it exists to serve this layer — the [mcp-server](../mcp-server/overview.md) exposes the game as tools, the bridge and DLL carry those tool calls into the running game — and everything player-facing (strategic decisions, in-character chat, post-game analysis) is produced here. The source lives in `vox-agents/src/`; generated API reference stays with the component in `vox-agents/docs/api/`.

The framework is organized around a small core — an agent base class, an execution context, and a handful of global registries — with families of concrete agents built on top. Each family has its own page:

- **[Strategists](strategist.md)** make the per-turn strategic decisions for the civilizations the LLM controls.
- **[Envoys](envoy.md)** hold conversations: spokespersons and diplomats that players chat with in-game.
- **[Support agents](support-agents.md)** — briefers, analysts, librarians — do focused work the other agents delegate to.
- **[Telepathists](telepathist.md)** answer questions about a finished game by reading its recorded telemetry.
- **[Oracle](oracle.md)** replays past turns with modified prompts or different models for "what-if" experiments.
- **[Archivist](archivist.md)** batch-processes finished games into an episode database that strategists can learn from.
- The **[web UI](ui.md)**, **[media pipeline](media.md)**, and **[observability](observability.md)** pages cover the dashboard, OBS capture and video generation, and tracing/logging.

## VoxAgent: the base class

Every agent extends `VoxAgent` (`src/infra/vox-agent.ts`). An agent is not a long-running object — it is a bundle of *lifecycle hooks* that the execution context calls while driving an agentic loop. The main hooks, in the order they matter:

- `getModel()` chooses the LLM for this run (and can vary per input). It falls back to the per-agent and default model mappings in `config.json`.
- `getSystem()` returns the system prompt; `getInitialMessages()` builds the opening context — for strategists, the formatted game state.
- `getActiveTools()` names the tools the model may call this step, and `getExtraTools()` contributes agent-specific tools beyond the shared MCP set.
- `prepareStep()` runs before each step and can prune messages, drop already-used tools, or switch models mid-run.
- `stopCheck()` decides after each step whether the loop is done. Agents commonly declare `requiredTools` — the loop stops once one of them has been called successfully (a strategist stops after `set-strategy` or `keep-status-quo`, for example) — with a maximum step count as backstop.
- `getOutput()` and `postprocessOutput()` turn the final exchange into a typed result, optionally validated against a Zod schema.

Two flags change the execution shape entirely. A `fireAndForget` agent returns to its caller immediately and runs detached as its own root run (started with `forkRun()`, described below), with an independent cancellation signal and token sink, so it survives cancellation of the caller's run — this is what lets a diplomat hand a report to an [analyst](support-agents.md) and keep talking without waiting for the intelligence processing. A `programmatic` agent skips the LLM altogether and implements `handleMessage()` directly — the telepathist's episode retriever is one.

## VoxContext: the execution engine

`VoxContext` (`src/infra/vox-context.ts`) runs agents. It owns one seat's long-lived resources — the MCP client connection, the tool registry, and the on-disk cache of tool definitions — but the actual work happens inside **root runs**. A root run is one operation on the seat: a strategist turn, a diplomat chat, an automatic deal response, or a detached analyst. Each root run owns that operation's own cancellation signal, progress callback, timeout refresh, token sink, and run-local turn and event window. Because every operation gets its own root, several can run on the same seat at once without overwriting one another's state — a strategist can be finishing an older queued turn while a diplomat chats on the current live turn, and a client disconnecting from one chat cancels only that chat.

A caller opens a root run with `withRun()`, which wraps the entire operation — including the setup and game-state refresh that happen before the first agent call — and hands its callback a run handle that can cancel just that operation. `forkRun()` starts a *detached* root for fire-and-forget work that must outlive its caller (the analyst handoff above). `execute(agentName, input)` and `callAgent(name, input)` run inside the active root: they take no parameters argument because the run already carries them, and calling either outside a run is a programming error. A nested agent call — a strategist invoking a briefer, a diplomat invoking a negotiator — stays in the caller's root and inherits its cancellation and token accounting, replacing only the current agent input. `execute()` assembles the prompt from the agent's hooks and drives the step loop (calling the model, executing tool calls, consulting `stopCheck()`) until the agent is done, streaming text and tool events to an optional callback along the way — this is what the web UI's chat rides on.

The run's parameters come from the seat's base. `setBaseParameters()` installs the stable parameter object the context owns; `currentParameters` is the active root's composed view of it, overlaying that run's turn fields on the shared seat state and falling back to the base outside a run. Cancellation has two scopes that mirror these layers: `run.abort()` cancels a single operation, while `context.abort()` cancels every active root and is the one used by player abort, game switching, and shutdown. Token usage accumulates into both the run's own sink and the seat-wide totals, so per-turn cost stays separable from the seat's running total. The run-model types and helpers live in `src/infra/vox-run.ts`.

Tools come from two sources. `registerTools()` fetches the tool list from the [MCP server](../mcp-server/tools.md), wraps each one for the AI SDK (auto-filling identifiers like player ID and turn, formatting JSON results as markdown), and caches the definitions on disk so a context can come up offline from `loadToolCache()`. On top of those, every registered agent is itself wrapped as a `call-{name}` tool, so agents can invoke each other — a diplomat calling `call-diplomatic-analyst` is an ordinary tool call. Agents can also bypass the LLM and invoke things directly: `callTool()` runs a single tool — it still takes explicit parameters and needs no active run, so setup and shutdown paths keep working — and `callAgent()` runs a nested agent inside the current root and returns its typed output.

Each context has a stable ID (for a strategist player it is `{gameID}-player-{playerID}`), and that ID names the SQLite telemetry database all of the context's spans are exported to — see [observability.md](observability.md).

## Sessions, registries, and process lifecycle

A `VoxSession` (`src/infra/vox-session.ts`) is a long-running workflow — a game being played, a narrator pipeline stage — with a state machine (starting, running, recovering, stopping) that the web UI can display and control. `StrategistSession` is the main implementation; the [media pipeline](media.md) stages are others. Sessions that launch the game itself do so through `VoxCivilization` (`src/infra/vox-civilization.ts`), which generates launch Lua from templates, spawns and binds to the CivilizationV.exe process, and kills it on shutdown.

Three global registries tie the process together: `agentRegistry` holds every available agent (all the core agents register at startup in `src/infra/agent-registry.ts`), `sessionRegistry` tracks active sessions (and enforces a single game session at a time), and `contextRegistry` tracks live contexts so the web routes can find them. `processManager` (`src/infra/process-manager.ts`) consolidates signal handling: every console entry point and long-lived service registers a named shutdown hook, and on SIGINT/SIGTERM the hooks run in order — stop the session, flush telemetry, close databases.

## Models and configuration

Model definitions live in `vox-agents/config.json` under `llms`: each entry maps a key like `openai/gpt-5-mini` to a provider and model name, with a `default` alias and an `embedder` alias for embedding models. The framework is provider-agnostic — OpenRouter, OpenAI, Anthropic, Google, AWS Bedrock, and OpenAI-compatible endpoints are supported, with API keys supplied via `.env` (see `src/utils/models/models.ts`). Agents resolve their model through `getModel()`, so a config can assign different models to different agents, or different strategists to different players in the same game.

Two pieces of middleware sit between agents and providers. Per-model concurrency limiting (`src/utils/models/concurrency.ts`) caps parallel requests with semaphore-style tracking, and the tool-rescue middleware (`src/utils/models/tool-rescue/`) salvages tool calls that weaker models emit as JSON text instead of structured calls.

## Where this sits in the stack

Below is the [MCP server](../mcp-server/overview.md): vox-agents connects to it as an MCP client over stdio or HTTP, calls its tools, and reacts to its notifications (turn completion, game switches, DLL connect/disconnect). The agents never talk to the bridge or the game directly. The end-to-end message path is traced in the top-level protocol page, and the overall component map in the architecture page (both under `docs/developers/`).

## Where the details live

This folder explains what the framework does and why; exact API surface stays with the component:

- `vox-agents/docs/api/` — generated TypeDoc reference for the source.
- `vox-agents/AGENTS.md` — working conventions for contributors (imports, logging, testing rules).
- For building and testing the module, see [setup.md](../setup.md) and [testing.md](../testing.md).
