# vox-agents: Overview

Vox-agents is the top of the Vox Deorum stack: the TypeScript framework in which language-model agents actually play Civilization V. The [MCP server](../mcp-server/overview.md) exposes the game as tools, and the bridge and DLL carry those tool calls into the running game. Everything player-facing (strategic decisions, in-character chat, post-game analysis) is produced here.

The source lives in `vox-agents/src/`. Generated API reference stays with the component in `vox-agents/docs/api/`.

The framework has a small core (an agent base class, an execution context, and a few global registries) with families of concrete agents built on top. Each family has its own page:

| Family | What it does |
| --- | --- |
| [Strategists](strategist.md) | Make the per-turn strategic decisions for the civilizations the LLM controls. |
| [Envoys](envoy.md) | Hold conversations: spokespersons and diplomats that players chat with in-game. |
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
| `getInitialMessages()` | Builds the opening context. For strategists, that is the formatted game state. |
| `getActiveTools()` | Names the tools the model may call this step. |
| `getExtraTools()` | Contributes agent-specific tools beyond the shared MCP set. |
| `prepareStep()` | Runs before each step. Can prune messages, drop already-used tools, or switch models mid-run. |
| `stopCheck()` | Decides after each step whether the loop is done. |
| `getOutput()` / `postprocessOutput()` | Turn the final exchange into a typed result, optionally validated against a Zod schema. |

Most agents declare `completionTools` to control stopping. The loop ends once one of those tools has been called successfully (a strategist stops after `set-strategy` or `keep-status-quo`, for example), with a maximum step count as a backstop. Some providers (Anthropic, Codex) reject a wire-level forced tool choice, which is why the required-tool-choice instruction exists. That instruction and the continuation nudge both name only the completion tools that remain active on the next step, so neither recommends a tool the model cannot call.

Two flags change the execution shape entirely:

- **`fireAndForget`**: the agent returns to its caller immediately and runs detached as its own root run, started with `forkRun()`. It gets an independent cancellation signal and token sink, so it survives cancellation of the caller's run. This is what lets a diplomat hand a report to an [analyst](support-agents.md) and keep talking without waiting for the intelligence processing.
- **`programmatic`**: the agent skips the LLM altogether and implements `handleMessage()` directly. The telepathist's episode retriever is one.

## VoxContext: the execution engine

`VoxContext` (`src/infra/vox-context.ts`) runs agents. It owns one seat's long-lived resources: the MCP client connection, the tool registry, and the on-disk cache of tool definitions. The actual work happens inside **root runs**.

### Root runs

A root run is one operation on the seat: a strategist turn, a diplomat chat, an automatic deal response, or a detached analyst. Each root run owns that operation's own cancellation signal, progress callback, timeout refresh, token sink, and run-local turn and event window.

Because every operation gets its own root, several can run on the same seat at once without overwriting one another's state. A strategist can finish an older queued turn while a diplomat chats on the current live turn, and a client disconnecting from one chat cancels only that chat.

The run-model types and helpers live in `src/infra/vox-run.ts`. There are three ways to enter or move between runs:

| Call | Behavior |
| --- | --- |
| `withRun()` | Opens a root run wrapping the whole operation, including the setup and game-state refresh before the first agent call. Hands its callback a run handle that can cancel just that operation. |
| `forkRun()` | Starts a *detached* root for fire-and-forget work that must outlive its caller, such as the analyst handoff above. |
| `callAgent(name, input)` | Runs a nested agent inside the active root. The nested call inherits the caller's cancellation and token accounting, replacing only the current agent input. |

`execute(agentName, input)` also runs inside the active root. Neither it nor `callAgent()` takes a parameters argument, because the run already carries them; calling either outside a run is therefore a programming error. `execute()` assembles the prompt from the agent's hooks and drives the step loop (calling the model, executing tool calls, consulting `stopCheck()`) until the agent is done. It streams text and tool events to an optional callback along the way, which is what the web UI's chat rides on.

### Parameters and cancellation

The run's parameters come from the seat's base. `setBaseParameters()` installs the stable parameter object the context owns. `currentParameters` is the active root's composed view of it: it overlays that run's turn fields on the shared seat state, and falls back to the base outside a run.

Cancellation has two scopes that mirror these layers. `run.abort()` cancels a single operation. `context.abort()` cancels every active root, and is the one used by player abort, game switching, and shutdown.

Token usage accumulates into both the run's own sink and the seat-wide totals, so per-turn cost stays separable from the seat's running total.

### Tools

Tools come from two sources. `registerTools()` fetches the tool list from the [MCP server](../mcp-server/tools.md), wraps each one for the AI SDK (auto-filling identifiers like player ID and turn, and formatting JSON results as markdown), and caches the definitions on disk so a context can come up offline from `loadToolCache()`.

On top of those, every registered agent is itself wrapped as a `call-{name}` tool, so agents can invoke each other. A diplomat calling `call-diplomatic-analyst` is an ordinary tool call.

Agents can also bypass the LLM and invoke things directly. `callTool()` runs a single tool; it still takes explicit parameters and needs no active run, so setup and shutdown paths keep working. `callAgent()` runs a nested agent inside the current root and returns its typed output.

Each context has a stable ID. For a strategist player it is `{gameID}-player-{playerID}`, and that ID names the SQLite telemetry database all of the context's spans are exported to. See [observability.md](observability.md).

## Sessions, registries, and process lifecycle

A `VoxSession` (`src/infra/vox-session.ts`) is a long-running workflow: a game being played, or a narrator pipeline stage. It has a state machine (starting, running, recovering, stopping) that the web UI can display and control. `StrategistSession` is the main implementation; the [media pipeline](media.md) stages are others.

Sessions that launch the game itself do so through `VoxCivilization` (`src/infra/vox-civilization.ts`). It generates launch Lua from templates, prepares Civ's `config.ini` (including the random seeds described in [strategist.md](strategist.md)), spawns and binds to the CivilizationV.exe process, and kills it on shutdown.

Three global registries tie the process together:

- **`agentRegistry`** holds every available agent. All core agents register at startup in `src/infra/agent-registry.ts`.
- **`sessionRegistry`** tracks active sessions and enforces a single game session at a time.
- **`contextRegistry`** tracks live contexts so the web routes can find them.

`processManager` (`src/infra/process-manager.ts`) consolidates signal handling for SIGINT, SIGTERM, SIGBREAK, and SIGHUP. Every console entry point and long-lived service registers a named shutdown hook, and hooks run in registration order. The strategist console registers three: `terminal` restores the console, `session` stops the running game session, and `telemetry` flushes pending spans. Closing databases is not its own hook. Each `VoxContext` closes its own telemetry database as part of its shutdown, which the session hook triggers.

## Models and configuration

`vox-agents/config.json` holds the runtime configuration, including the `llms` block that maps a key like `openai/gpt-5-mini` to a provider and model name, with a `default` alias and an `embedder` alias for embedding models. That file is gitignored, so a fresh checkout has none. The effective values come from `src/utils/config/defaults.ts` merged with whatever the local file overrides; `src/utils/config.ts` performs the load, and `src/utils/config/diff.ts` does the per-entry merge and the diffing the dashboard's Config view shows.

The built-in registry contains only the openai-compatible default and embedder. `src/utils/models/rules.ts` provides recommended settings for known provider and model-name patterns, with prompt middleware scoped to the providers that serve open-weight models over an OpenAI-compatible surface (openai-compatible, Chutes, Synthetic, OpenRouter). Before agent work begins, `src/utils/models/resolution.ts` verifies unregistered provider-qualified IDs against provider catalogs and keeps matching configurations in memory for the process. A reference that is neither a registered `llms` alias nor a supported `provider/model` ID is an error, as is a confirmed live-catalog miss; discovery failures and static-list misses warn and fall back to rule synthesis. Catalog matching is exact first, then case-insensitive. Explicit local configuration always wins. Codex discovery reads the managed proxy's authenticated live catalog, while Claude Code uses static choices from `src/utils/models/discovery.ts`. Agent names are not model references: an agent resolves through its own name, and one with no `llms` assignment runs on `default`, so preflight verifies the assignment when it exists and `default` when it does not.

The framework is provider-agnostic. OpenRouter, OpenAI, Anthropic, Google, AWS Bedrock, Codex, and OpenAI-compatible endpoints are supported. API-backed providers read keys from `.env`; Codex uses the player's ChatGPT login, and the bundled Claude Code runtime uses the player's local Claude Code sign-in. The Setup wizard fetches live, provider-reported model lists for API-backed and local providers, then saves the selected model with any rule-derived recommended settings. Codex reads its live choices through the authenticated managed proxy. Claude Code uses bundled static choices, which do not verify the local sign-in. AWS Bedrock remains a manual Settings-page configuration. Agents resolve their model through `getModel()`, so a config can assign different models to different agents, or different strategists to different players in the same game.

Provider-specific code lives under `src/utils/models/providers/` and imports shared types and sibling helpers without importing `models.ts`.

The shared `hostTools` policy governs what a CLI-backed model may do on the host machine. It is deny-by-default and speaks in three meta-tools: `Read`, `Write` (which implies `Read`), and `Web`. They are validated once in `host-tools.ts` and mapped per provider. Claude Code expands them to its vetted non-shell tool lists and always gives an enabled CLI an isolated temporary cwd. Codex creates a working directory only for Read or Write, and maps the policy onto its sandbox levels: Read becomes read-only and Write becomes workspace-write, while no filesystem access and Web-only both leave the sandbox disabled with no local environments. Web independently enables live search. Granting Codex Read or Write therefore enables command-capable local execution inside the selected sandbox.

The managed Codex proxy is pinned and starts lazily. It never adopts a listener already occupying its port, because `/health` and `/ready` do not expose enough identity to verify the required activity contract. Startup scans upward from the configured port for a free one, and fails only once every candidate is occupied. `CODEX_PROXY_COMMAND` remains a trusted launch override. See [Updating the Codex proxy](codex.md) for the version upgrade procedure.

Middleware sits between agents and providers:

- Per-model concurrency limiting (`src/utils/models/concurrency.ts`) caps parallel requests with semaphore-style tracking.
- Claude Code subscription limits wait until the provider's reset time, with a slow fallback when no valid reset is supplied.
- Codex response middleware converts observational `tool_calls` and `tool_results` into provider-executed AI SDK lifecycles, removes them from replay history, and leaves client game tools executable.
- The tool-rescue middleware (`src/utils/models/tool-rescue/`) salvages tool calls that weaker models emit as JSON text instead of structured calls.

Provider-executed Claude Code and Codex calls are shown in the dashboard and recorded as retrospective built-in tool spans. Preliminary progress is not a successful outcome: a failed or missing terminal result records an error.

## Where this sits in the stack

Vox-agents connects to the [MCP server](../mcp-server/overview.md) below it as an MCP client over stdio or HTTP, calls its tools, and reacts to its notifications (turn completion, game switches, DLL connect and disconnect). The agents never talk to the bridge or the game directly.

The end-to-end message path is traced in the top-level [protocol](../protocol.md) page, and the overall component map in the [architecture](../architecture.md) page.

## Where the details live

This folder explains what the framework does and why. The exact API surface stays with the component:

- `vox-agents/docs/api/` holds the generated TypeDoc reference for the source.
- `vox-agents/AGENTS.md` holds working conventions for contributors (imports, logging, testing rules).
- For building and testing the module, see [setup.md](../setup.md) and [testing.md](../testing.md).
