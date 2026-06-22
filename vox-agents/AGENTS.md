# AGENTS.md - Vox Agents

Backend LLM agent framework. For UI development, see `ui/AGENTS.md`.

## Critical Conventions

- **ESM**: Always use `.js` extensions in imports, even for `.ts` files (`"type": "module"`)
- **Winston logger only** — never `console.log/error/warn` in production code (OK in tests)
- **MCP tools**: Always read `mcp-server/src/tools/index.ts` to know which tools actually exist
- **Embedding models**: Set `options.embeddingSize` on model config. Use `embedder` alias in `config.llms`. Call `getEmbeddingModel()` from `utils/models/models.ts`
- **Provider-agnostic**: Model config supports openrouter, openai, google, compatible services. Apply middleware based on model characteristics (e.g., gemma-3)
- **Use Map for registries** (players, handlers, etc.)
- **Graceful cancellation** — each root run owns its `AbortController`; pass the active root's signal (resolved from `AsyncLocalStorage`) to async operations. `context.abort()` cancels every active root

## Testing

### Commands
| Command | What it runs |
|---------|-------------|
| `npm test` | All tests except game and OBS |
| `npm run test:watch` | Watch mode (excludes game and OBS) |
| `npm run test:unit` | Same as `npm test` |
| `npm run test:game` | Game tests only (requires Windows + Civ V) |
| `npm run test:obs` | OBS tests only (requires running OBS Studio) |
| `npm run test:coverage` | Coverage report (excludes game and OBS) |
| `npm run test:ui` | Vitest browser UI |

### Test Pathways
- **Unit** (`tests/utils/`) — Pure functions, no external deps, fast
- **Telepathist** (`tests/telepathist/`) — Real telemetry DB records (no live game/LLM). Skips if DB absent
- **Game** (`tests/infra/`) — Launches CivilizationV.exe. 90-180s timeouts, sequential via `singleFork: true`. Includes Civ5 guard
- **OBS** (`tests/obs/`) — Requires OBS Studio with WebSocket server. Skips gracefully if OBS unreachable

### Test Rules
- **Don't touch OBS tests** unless changing OBS-related code (`obs-manager.ts`, `ProductionMode`)
- **Don't touch game tests** unless changing `VoxCivilization` or `ProcessManager`
- Use Vitest (not Jest). Test files: `tests/**/*.test.ts`, setup: `tests/setup.ts`
- Use nested describe blocks, `"should"` convention for test names

## Entry Points

- `npm run dev` — Development with hot reload (index.ts)
- `npm run strategist` — Strategist workflow (strategist/console.ts)
- `npm run telepathist` — Telepathist console (telepathist/console.ts)
- `npm run oracle -- -c <experiment.js>` — Oracle prompt replay (oracle/console.ts)
- `npm run archivist -- -a <archive-path> -o <output.duckdb> [-n <limit>] [-m <model>]` — Archivist batch pipeline (archivist/console.ts)
- Each workflow has a dedicated entry point with shared instrumentation (loaded via `--import`)

## Build

- `npm run dev` — Development with hot reload (tsx)
- `npm run build` — TypeScript compilation to dist/
- `npm run type-check` — Type checking without emit
- `npm run lint` — ESLint checks

## Agent Architecture

```
VoxAgent (Base)
├── Briefer (Game state analysis)
│   ├── SimpleBriefer (General briefing)
│   └── SpecializedBriefer (Military, Economy, Diplomacy)
├── Strategist (Strategic decisions)
│   ├── NoneStrategist (Baseline)
│   ├── SimpleStrategist (Direct)
│   ├── SimpleStrategistBriefed (Single-briefer)
│   └── SimpleStrategistStaffed (Multi-briefer collaborative)
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
├── Summarizer (Unified turn/phase summarization)
└── Oracle (Counterfactual prompt replay)
```

### Creating New Agents
1. Choose base class (Briefer, Strategist, Analyst, Librarian, or Envoy)
2. Define parameter types (input, output, store)
3. Implement lifecycle hooks: `getModel()`, `getSystem()`, `getActiveTools()`, `getExtraTools()`, `getInitialMessages()`, `prepareStep()`, `stopCheck()`, `getOutput()`, `postprocessOutput()`
4. Register in `agentRegistry`

## Dual Mode

- **Standalone**: Entry via `console.ts`. Configure `StrategistSessionConfig` with `llmPlayers` array, `autoPlay`. Session loops with crash recovery
- **Component**: Integrates through `VoxContext` API for web UI. Supports interactive control and manual intervention

## Infrastructure

### ProcessManager (`src/infra/process-manager.ts`)
Singleton signal handler (SIGINT, SIGTERM, SIGBREAK, SIGHUP). `processManager.register(name, hook)` — hooks execute in insertion order during shutdown. All console entry points register here.

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
- Strategist session always calls through this — no mode branching needed

### ProductionMode
- `'none'` | `'test'` | `'livestream'` | `'recording'`
- `isVisualMode(mode?)` — true for test/livestream/recording (play animations)
- `isObsMode(mode?)` — true for livestream/recording (use OBS)

## Advanced Patterns

- **Run model**: `execute()`/`callAgent()` require an active root run — open one with `withRun()` (or `forkRun()` for detached work). Read seat state through `baseParameters`/`currentParameters` (the active root's composed view); the old `lastParameter` field is gone. Run-model types live in `infra/vox-run.ts`
- **Fire-and-forget agents**: Set `fireAndForget: true` — detaches via `forkRun()` into its own root run (independent signal and token sink), caller continues immediately
- **Special messages**: `{{{MessageType}}}` triple-brace tokens trigger behaviors via `getSpecialMessages()` in Envoy subclasses
- **Tool rescue middleware**: Extracts JSON tool calls from malformed LLM text responses via `toolRescueMiddleware()`
- **Concurrency**: Per-model rate limiting via `streamTextWithConcurrency()` with semaphore-like tracking
- **Global agent registry**: Singleton `agentRegistry` pre-registers all core agents. Import and call `.get(name)` to resolve
- **Dual-database**: Telepathist uses read-only telemetry DB + read-write analysis DB via `createTelepathistParameters()`
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
- **AGENTS.md** — if new patterns or conventions were introduced
- **README.md** — if public-facing interface changed
- Keep docs concise — describe what exists, not implementation details that get outdated

## Common Pitfalls

1. Calling `execute()` or `callAgent()` outside an active run (open one with `withRun()`/`forkRun()` first)
2. Forgetting sequential test execution for IPC tests
3. Not handling crash recovery in standalone mode
4. Missing telemetry flushing on exit
5. Forgetting `.js` extensions in imports
6. Not using proper shutdown handlers via ProcessManager
