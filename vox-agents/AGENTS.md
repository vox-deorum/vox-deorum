# AGENTS.md - Vox Agents

Backend LLM agent framework. For UI development, see `ui/AGENTS.md`.

## Critical Conventions

- **ESM**: Always use `.js` extensions in imports, even for `.ts` files (`"type": "module"`)
- **Winston logger only**: never `console.log/error/warn` in production code (OK in tests)
- **MCP tools**: Always read `mcp-server/src/tools/index.ts` to know which tools actually exist
- **Embedding models**: Set `options.embeddingSize` on model config. Use `embedder` alias in `config.llms`. Call `getEmbeddingModel()` from `utils/models/models.ts`
- **Provider-agnostic**: Model config supports openrouter, openai, google, compatible services. Apply middleware based on model characteristics (e.g., gemma-3)
- **Provider modules**: Provider-specific implementations live in `src/utils/models/providers/` and may import shared types or sibling helpers, but never `models.ts`
- **Config defaults**: `config.json` is gitignored. Effective values come from `src/utils/config/defaults.ts` merged by `src/utils/config/diff.ts`, loaded through `src/utils/config.ts`
- **Use Map for registries** (players, handlers, etc.)
- **Graceful cancellation**: each root run owns its `AbortController`; pass the active root's signal (resolved from `AsyncLocalStorage`) to async operations. `context.abort()` cancels every active root

## Testing

### Commands

| Command | What it runs |
| --- | --- |
| `npm test` | Default in-process mock tier |
| `npm run test:mock` | Default in-process mock tier |
| `npm run test:watch` | Watch mode for the mock tier |
| `npm run test:real` | Future real MCP Server and mock Bridge tier; currently passes with no tests |
| `npm run test:game` | Live Civilization V tests |
| `npm run test:obs` | Live OBS tests |
| `npm run test:coverage` | Coverage report for the mock tier |
| `npm run test:ui` | Vitest browser UI |

### Test Pathways

- **Mock** (`tests/mock/**`): Default in-process mock tier. Telepathist coverage lives in `tests/mock/telepathist` and can skip when recorded telemetry is unavailable.
- **Real** (`tests/real/**`): Reserved for a future out-of-process real MCP Server and mock Bridge bottom. `npm run test:real` currently passes with no tests.
- **Game** (`tests/live/game/**`): Live Civilization V tier. Launches CivilizationV.exe with long timeouts and sequential execution through `singleFork: true`.
- **OBS** (`tests/live/obs/**`): Live OBS tier. Requires OBS Studio with its WebSocket server and skips gracefully when OBS is unreachable.

### Test Rules

- **Don't touch OBS tests** unless changing OBS-related code (`obs-manager.ts`, `ProductionMode`)
- **Don't touch game tests** unless changing `VoxCivilization` or `ProcessManager`
- Use Vitest (not Jest). Test files: `tests/**/*.test.ts`, setup: `tests/setup.ts`
- Use nested describe blocks, `"should"` convention for test names

## Entry Points

- `npm run dev`: Development with hot reload (index.ts)
- `npm run strategist`: Strategist workflow (strategist/console.ts)
- `npm run telepathist`: Telepathist console (telepathist/console.ts)
- `npm run oracle -- -c <experiment.js>`: Oracle prompt replay (oracle/console.ts)
- `npm run archivist -- -a <archive-path> -o <output.duckdb> [-n <limit>] [-m <model>]`: Archivist batch pipeline (archivist/console.ts)
- Each workflow has a dedicated entry point with shared instrumentation (loaded via `--import`)

## Build

- `npm run dev`: Development with hot reload (tsx)
- `npm run build`: TypeScript compilation to dist/
- `npm run type-check`: Type checking without emit
- `npm run lint`: ESLint checks

## Agent Architecture

Classes registered in `agentRegistry` (`src/infra/agent-registry.ts`):

```
VoxAgent (Base)
├── Briefer (Game state analysis)
│   ├── SimpleBriefer (General briefing)
│   └── SpecializedBriefer (Military, Economy, Diplomacy)
├── Strategist (Strategic decisions)
│   ├── NoneStrategist (Baseline)
│   ├── NullStrategist (Neutral-reset baseline)
│   ├── HumanStrategist (Human occupies the seat)
│   └── SimpleStrategistBase (Shared turn loop)
│       ├── SimpleStrategist (Direct)
│       ├── SimpleStrategistBriefed (Single-briefer)
│       └── SimpleStrategistStaffed (Multi-briefer collaborative)
│           └── SimpleStrategistLearned (Adds episode retrieval)
├── Analyst (Fire-and-forget analysis)
│   └── DiplomaticAnalyst (Intelligence gatekeeping)
├── Librarian (Database research)
│   └── KeywordLibrarian (Keyword-based search)
├── Envoy (Chat-based interactions)
│   ├── LiveEnvoy (Game-specific chat)
│   │   ├── Diplomat (Intelligence gathering)
│   │   └── Spokesperson (Official representative)
│   └── Telepathist (Database-backed conversations)
│       └── TalkativeTelepathist (Post-game analysis)
├── Negotiator (Sole decider of deal terms)
├── EpisodeRetriever (Programmatic episode lookup, no LLM)
├── Summarizer (Unified turn/phase summarization)
└── OracleAgent (Counterfactual prompt replay)
```

### Creating New Agents

1. Choose base class (Briefer, Strategist, Analyst, Librarian, or Envoy)
2. Define parameter types (input, output, store)
3. Implement lifecycle hooks: `getModel()`, `getSystem()`, `getActiveTools()`, `getExtraTools()`, `getInitialMessages()`, `prepareStep()`, `stopCheck()`, `getOutput()`, `postprocessOutput()`
4. Register in `agentRegistry`

### Diplomacy & Envoy Layout

`src/envoy/` is everything about envoy _agents_; `src/utils/diplomacy/` is the chat-route and conversation plumbing. Keep new files on the correct side of that line.

```
src/envoy/          envoy.ts, live-envoy.ts (base classes)
  agents/           diplomat, negotiator, spokesperson, resolve-negotiator
  tools/            send-message-tool, close-conversation-tool
  ledger/           deal-ledger, give-receive-menu, ledger-grammar, ledger-resolver
  context/          diplomacy-context, diplomat-utils, negotiator-utils, envoy-prompts

src/utils/diplomacy/  constants.ts (cross-cutting constants)
  transcript/       transcript, transcript-utils
  turn/             chat-turn-commit, active-turn-state, live-turn
  deal/             deal, deal-reduce, deal-actions
  ingame/           ingame-bridge, notify, civ5-markup
```

Dependency direction is `envoy/` → `utils/diplomacy/`; never the reverse. `tests/mock/{diplomacy,envoy,web}/` mirror these subfolders. No `index.ts` barrels: import the specific module.

## Dual Mode

- **Standalone**: Entry via `console.ts`. Configure `StrategistSessionConfig` with `llmPlayers` array, `autoPlay`. Session loops with crash recovery
- **Component**: Integrates through `VoxContext` API for web UI. Supports interactive control and manual intervention

## Infrastructure

### ProcessManager (`src/infra/process-manager.ts`)

Singleton signal handler (SIGINT, SIGTERM, SIGBREAK, SIGHUP). `processManager.register(name, hook)`: hooks execute in insertion order during shutdown. All console entry points register here.

### ObsManager (`src/infra/obs-manager.ts`)

Controls OBS Studio for recording/livestreaming via `obs-websocket-js` (WebSocket v5).

- Lifecycle: `initialize()` → `setGameID()` → `startProduction()` → `pauseProduction()`/`resumeProduction()` → `stopProduction()` → `destroy()`
- Creates game capture scenes, organizes recordings under `{baseRecordDir}/{gameID}/`
- Health monitoring with bounded recovery (max 3 attempts). Self-registers with ProcessManager
- See [media.md](../docs/developers/vox-agents/media.md) for OBS capture and the narrators pipeline

### ProductionController (`src/infra/production-controller.ts`)

Wraps ObsManager to add segment-based recording driven by game render events.

- Recording: segments start on `PlayerPanelSwitch`, stop 10s after first `AnimationStarted` (estimated end)
- Livestream: pass-through to ObsManager
- Writes `segments.jsonl` with faithful wall-clock timestamps per segment
- Strategist session always calls through this, so no mode branching is needed

### ProductionMode

- `'none'` | `'test'` | `'livestream'` | `'recording'`
- `isVisualMode(mode?)`: true for test/livestream/recording (play animations)
- `isObsMode(mode?)`: true for livestream/recording (use OBS)

## Advanced Patterns

- **Run model**: `execute()`/`callAgent()` require an active root run. Open one with `withRun()` (or `forkRun()` for detached work). Read seat state through `baseParameters`/`currentParameters` (the active root's composed view); the old `lastParameter` field is gone. Run-model types live in `infra/vox-run.ts`
- **Fire-and-forget agents**: Set `fireAndForget: true`. Detaches via `forkRun()` into its own root run (independent signal and token sink), caller continues immediately
- **Special messages**: `{{{MessageType}}}` triple-brace tokens trigger behaviors via `getSpecialMessages()` in Envoy subclasses
- **Tool rescue middleware**: Extracts JSON tool calls from malformed LLM text responses via `toolRescueMiddleware()`
- **Concurrency**: Per-model rate limiting via `streamTextWithConcurrency()` with semaphore-like tracking
- **Global agent registry**: Singleton `agentRegistry` pre-registers all core agents. Import and call `.get(name)` to resolve
- **Dual-database**: Telepathist uses read-only telemetry DB plus read-write analysis DB via `createTelepathistParameters()`
- **Archivist pipeline**: Phase A (extract/transform/write, no LLM), Phase B (select diverse landmarks), Phase C (generate summaries + embeddings). CLI flags: `--skip-telepathist`, `--skip-embeddings`, `--force`, `--model`
- **game_outcomes table**: Populated in Phase A. Reader's `fetchOutcomes()` uses `LEAST(turn + horizon, max_turn)` for outcome turn capping
- **TelepathistTool**: Abstract base for DB query tools with span hierarchy traversal helpers and `Summarizer` integration
- **Unified Summarizer**: Flexible instruction parameter, content-hash caching, shared historian guidelines

## Type Safety

- **GameState**: Import types from MCP server build output: `import type { CitiesReport } from "../../../mcp-server/dist/tools/knowledge/get-cities.js"`
- **Zod schemas**: Agent tools use Zod for input/output validation via `dynamicTool` wrapper
- **Config**: Interface-driven with environment variable overrides

## Documentation Maintenance

After each successful implementation, update relevant docs:

- **AGENTS.md** if new patterns or conventions were introduced
- **README.md** if the public-facing interface changed
- Keep docs concise. Describe what exists, not implementation details that get outdated

## Common Pitfalls

1. Calling `execute()` or `callAgent()` outside an active run (open one with `withRun()`/`forkRun()` first)
2. Forgetting sequential test execution for IPC tests
3. Not handling crash recovery in standalone mode
4. Missing telemetry flushing on exit
5. Forgetting `.js` extensions in imports
6. Not using proper shutdown handlers via ProcessManager
