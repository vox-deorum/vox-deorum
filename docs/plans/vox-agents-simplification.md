# Simplify and refactor vox-agents

> Implementation plan. Reduce the maintenance cost of `vox-agents` without changing agent behavior, public HTTP contracts, prompt wording, persistence rules, or concurrency semantics, except the two approved deviations below. Stages are independently shippable; each starts by locking current behavior with tests at the seam it moves. Extract before deduplicating: the first commit in each stage moves behavior with parity tests, and a later commit may collapse repetition once the seam is stable.

## Approved deviations

1. **Supervised player drain (Stage 6).** Replace the blind eight-second shutdown sleep with a drain of retained player-task promises under a fifteen-second timeout, on both final shutdown and `GameSwitched`. Fifteen seconds clears `VoxPlayer`'s greater-than-five-second post-shutdown settle.
2. **Canonical labels for all trade-item types (Stage 3).** `deal-metadata.ts` gains label fields for gold, gold per turn, resource, city, technology, third-party peace, third-party war, and vote commitment, so all 22 ledger terms derive from one source. Additive only.

Each deviation lands in its own commit, named in the message.

## Invariants

Non-obvious behaviors that must survive every move. Each is locked by a test before its stage touches source.

- **GameState cache**: in-place mutation of cached entries, no concurrent-miss deduplication, `mergedEvents` separate from the immutable `events` slice. The export-surface guard test pins the nine runtime exports of `strategy-parameters.ts`.
- **Chat turn**: the durable commit point sits inside `beginChatTurn`; pre-stream failures return non-2xx JSON with the current status mapping (busy/conflict 409, illegal deal 400, store failure 502); post-commit failures stream as committed outcomes; the retry decision is recomputed from the persisted slice via `needsRetryReply`; disconnect abort is scoped to the active run behind the `completed` guard, and `res.end()` never aborts.
- **Chat persistence**: ordinary chats in memory, diplomacy transcripts durable — two policies behind one store interface, never merged.
- **Ledger**: model-facing term text, ordering, aliases, and defaults byte-identical; the `LedgerTermLabel` literal union and its exhaustiveness checks survive derivation.
- **Browser bundle**: browser-reachable code imports `mcp-server/dist/utils/deal-metadata.js` (dependency-free) and never `deal-schema.js`, which pulls in zod.
- **UI streaming**: `closeAllConnections` spans native and POST SSE connections through one registry; `SendCommitState`, connection replacement, and duplicate-error suppression semantics are unchanged; the composed `api` singleton stays the sole entry point for its 19 consumers.
- **Batch preparation**: one `withRun` root per job, per-job error isolation, and the exact format-failure ceiling — `format failure N/10` message, ceiling of ten, `isRetryable = false` at the ceiling.
- **Session recovery**: crash recovery reuses players (identity reset); `GameSwitched` recreates them. Bus cancellation stays ordered before or with player abort.
- If extraction reveals a bug, fix it in a separate commit after the parity move, with its own failing test.

## Stage 1: Split strategy state concerns

`strategy-parameters.ts` (491 lines) mixes data contracts, MCP refresh with cache mutation, prompt construction, and event-window policy.

- Lock behavior first: add the missing contract cases (e.g. future-state culling) to the existing strategy suites.
- Add `src/strategist/strategy-types.ts` — `StrategistParameters` and `GameState`; report shapes re-export from `mcp-server/dist`.
- Add `src/strategist/game-state-store.ts` — `refreshGameState`, `ensureGameState`, `getGameState`, `getRecentGameState`, and the private refresh helpers.
- Add `src/strategist/event-window.ts` — `mergeCachedEvents`, `getDecisionEventWindows`, `withEventWindowFallback`.
- Add `src/strategist/game-context-messages.ts` — `buildGameContextMessages`, `getDecisionTurnContext`. It imports `getGameState` from the store; that is the only cross-module edge, so no cycle is possible.
- Turn `strategy-parameters.ts` into a compatibility barrel re-exporting the nine runtime exports. The 28 importers and all test suites continue through the barrel; remove it only in a later breaking-change release.

Checkpoint: strategy cache tests, pacing tests, and `vox-player-runs` pass; the type check reports no import cycles.

## Stage 2: Put chat behavior behind web-layer boundaries

`src/web/routes/agent.ts` (1108 lines) mixes the thread cache, route registration, a ~300-line turn/SSE handler, deal-status actions, both thread-construction paths, and enrichment helpers. New modules go under `src/web/chat/` and compose the `src/utils/diplomacy/` seams — `chat-turn-commit.ts`, the transcript utilities, and `deal.ts` — without becoming second owners of locking, archival, rollback, or reconciliation policy.

- Lock behavior first, closing the confirmed route-suite gaps: `DELETE` of a database-backed context asserting `context.shutdown()`; the telepathist/`databasePath` branch of `openOrdinaryChat`; reopening a diplomacy pair with a re-chosen direction and voice; optionally the 502 mappings for deal status-route store failures.
- Add `chat-thread-store.ts` — the `EnvoyThread` cache with injected context-shutdown on delete and transcript re-sync on diplomacy reads.
- Add `chat-enrichment.ts` — `getActiveAssignments`, `resolveHumanSeat`, `civIdentity`, `displayIdentity`, `enrichChat`, `currentTurnOf`, `mirrorDealRowsBestEffort`. Every route response spreads `...enrichChat(thread)`, so this layer needs a named home.
- Add a thread factory — `openDiplomacyChat`, `openOrdinaryChat`, `orderParticipants` — with injected context, agent, and session lookups plus the telepathist context factory, reproducing deterministic thread IDs, reopen direction changes, compaction timing, and audience identity fallback.
- Add a turn runner holding the `POST /agents/message` handler body — request parsing, pre-stream validation, `beginChatTurn` error mapping, `VoxContext.withRun`, agent execution, retry reply selection, terminal outcome creation — emitting through a typed stream sink (`connected`, `message`, `error`, `done`). One Express adapter owns SSE framing.
- Split route registration into discovery, message, and deal-status modules composed by `createAgentRoutes()` under the same paths. Propose and counter commit through `POST /agents/message` and belong to the message module; the deal-status module maps inspect, reject, accept, deals, and close over `deal.ts` and `withThreadLock`.

Checkpoint: the route suite (with the new cases) passes unchanged; SSE framing exists in exactly one adapter; store, factory, and enrichment have focused tests.

## Stage 3: Derive ledger vocabulary from canonical metadata

The 22 ledger term labels are maintained three times: the `deal-metadata.ts` tables, the `LEDGER_TERMS` tuple in `ledger-grammar.ts`, and the `TERM_MAP` keys in `ledger-resolver.ts`.

- Lock behavior first: exact-string parity tests for generated ledger terms, a direct `deal-metadata` completeness test, and an alias-uniqueness check.
- Extend `deal-metadata.ts` with labels for the non-agreement trade-item types (deviation 2) and expose the label-to-type direction that `TERM_MAP` needs.
- Derive `LEDGER_TERMS` and the `TERM_MAP` keys from the metadata tables through an `as const` construction so `LedgerTermLabel` stays a literal union.
- Repoint `ledger-resolver.ts` imports from `deal-schema.js` to `deal-metadata.js`.
- Aliases, parser categories, targeted-phrase regexes and renderers, suggestion pools, and the UI's presentation strings (`'Gold:'`, `'City:'`, …) are parser and presentation policy, local to their files.

Checkpoint: MCP deal-metadata tests, envoy ledger tests, diplomacy deal tests, and UI deal tests pass; model-facing ledger text is unchanged.

## Stage 4: Split the UI API client by transport and domain

`ui/src/api/client.ts` (707 lines, one class) holds every API domain plus both SSE transports.

- Lock behavior first: audit `client.test.ts` POST-SSE coverage and add cases only where the transport split would otherwise be unguarded.
- Add a JSON request helper owning base-URL resolution, the repeated method/headers/serialization setup, response parsing, and `ErrorResponse` mapping.
- Move `streamEventSource<T>` into a native-EventSource module.
- Add a POST SSE chat transport for `sse.js` — connection replacement, `SendCommitState`, duplicate-error suppression — with concrete event types for the callbacks, removing `any` at the boundary (tighten the config methods' `any` in passing).
- Give both transports one shared connection registry.
- Split domain modules (telemetry, session, config, chat, deal) under `ui/src/api/`. The deal module depends on the chat stream transport — propose/counter route through `streamAgentMessage` — and date revival moves into a shared chat/deal deserialization helper. Compose and export the same `api` singleton and `SendCommitState`.

Checkpoint: `client.test.ts`, `useThreadMessages.test.ts`, store tests, and chat-launch tests pass; no new `any` or `unknown` at the API boundary.

## Stage 5: Isolate batch workflow orchestration

### 5.1 Telepathist summary attempt

`turn-preparation.ts` and `phase-preparation.ts` duplicate the per-job run root, the `pLimit(5)` fan-out shape, the format-failure ceiling around `exponentialRetry`, and progress forwarding.

- Add a helper under `src/telepathist/preparation/` for one summary attempt: enter the supplied run turn, call `Summarizer`, enforce the format-failure ceiling, apply `exponentialRetry`, forward progress. It accepts an optional `onContextLengthError` callback (turn preparation passes one; phase preparation does not). The `pLimit(5)` constant and the capture-`streamProgress`-before-fan-out pattern move with it.
- Job records, existing-row checks, parsing, persistence, context-window collection, and `contextExceededTurns` tracking stay in the workflow modules. Migrate turn preparation first, then phase. If the helper needs more than the context, turn, summarizer input, parser, progress sink, and callback — stop; the remaining similarity is incidental.
- Add a unit test for the format-failure ceiling, its first direct coverage.

### 5.2 Archivist runner

`archivist/console.ts` (494 lines) implements the per-game pipeline (`processGame`, eight positional parameters) and worker dispatch (`workerLoop`, nine) alongside CLI validation, raw terminal handling, DuckDB UI startup, browser launch, and keepalive. The orchestration has no direct tests.

- Add `src/archivist/runner.ts` with an `ArchivistRunOptions` object replacing the positional parameters, and an `ArchivistRunnerDeps` set injecting `scanArchive`, `EpisodeWriter`, `selectLandmarks`, `computeTargetTurns`, `prepareTelepathist`, and `generateEmbeddings`, plus a stop-request predicate and progress hooks. Export production defaults for `console.ts`, which retains CLI parsing, raw TTY handling, the Ctrl+A toggle, DuckDB UI, browser launch, keepalive, and shutdown hooks.
- Add runner tests with fake archive entries, writer, and phase dependencies: queue limits, stop-after-current, skip flags, Phase C model assignment, stats aggregation, writer lifetime.
- The two runners share a refactoring principle, not a runtime abstraction — no shared framework.

Checkpoint: telepathist preparation tests and the Archivist mock suite pass; importing `archivist/runner.ts` has no process, terminal, browser, or CLI side effects.

## Stage 6: Make player task ownership explicit in StrategistSession

High-risk series requiring separate approval after Stages 1–5, in its own pull requests. `strategist-session.ts` (891 lines) fire-and-forgets `VoxPlayer.execute()` promises, sleeps a blind eight seconds on shutdown, and on `GameSwitched` aborts and drops the old generation while new players reuse the same player IDs. The only session-level test reaches privates via `as any`.

### 6.0 Orchestration characterization suite

- Add a mock `StrategistSession` suite covering notification dispatch, player replacement on `GameSwitched`, player-task shutdown and timeout, crash-recovery limits (maximum three attempts, decaying 0.5 per completed turn), identity reset during recovery versus recreation on switch, production calls, seating release, and idempotent shutdown. All tests pass against the current implementation before any source change.

### 6.1 Player supervisor

- Add `src/strategist/player-supervisor.ts` owning the player map, each captured `execute()` promise with an immediately attached rejection handler, status and assignment projection, turn notification, abort, and drain. `execute()` resolves even on internal failure, so drain completion is a timeout race, not rejection-driven; the realistic rejection surface is its `finally` block.
- Expose two generation operations: `resetIdentities` (crash recovery — same players, identity re-sent) and `replaceGeneration` (game switch — abort, drain, recreate, closing the same-player-ID overlap race).
- Define one bounded drain: abort every active player, race `Promise.allSettled` of the captured tasks against the fifteen-second timeout (deviation 1). On final shutdown, log the IDs of tasks still active at the timeout and proceed with process, MCP, OBS, and seating teardown. On `GameSwitched`, a drain timeout transitions the session to error and stops recovery rather than overlapping generations.
- Route unexpected player-task rejection to a session callback that records the failure and feeds the existing recovery or shutdown policy.

### 6.2 Ordered game-switch helpers

- Move pure launch-script selection, player-count calculation, metadata parsing, and player-assignment projection into named functions.
- Add a narrow game-switch coordinator only if the characterization tests show a clean dependency set for seating recovery, seed verification, metadata writes, player replacement, autoplay setup, production start, and human turn-zero presentation. Session state transitions, MCP notification registration, crash-recovery decisions, victory completion, and shutdown ownership remain in `StrategistSession`.

Checkpoint: the 6.0 suite passes with human-decision, random-seed, player-run, production-controller, and live-game guard tests.

## Verification

Targeted tests after each move; full component gates at each checkpoint.

- Backend: `npm --workspace vox-agents run type-check` and `npm --workspace vox-agents test`
- MCP (Stage 3): `npm --workspace mcp-server run type-check` and `npm --workspace mcp-server test`
- UI: `npm --prefix vox-agents/ui run type-check` and `npm --prefix vox-agents/ui run test:mock`
- Final: `npm run build:all` and `npm run test:all`

Game and OBS suites stay opt-in: `test:game` only for changes reaching `VoxCivilization`, player supervision, or live game sequencing; `test:obs` only for production/OBS changes.

## Out of scope

- prompts, agent selection, models, tool behavior, retry policy;
- REST paths, SSE event names, request/response shapes, the UI `api` facade;
- transcript, database, archive, and seating-state formats;
- Express, Vue, Vitest, Winston, `AsyncLocalStorage`, the AI SDK;
- a new workspace package for shared diplomacy metadata;
- decomposing `VoxContext`, `tool-rescue/middleware.ts`, `seating/state.ts`, the registries, or the batch converters — reassess `VoxContext` after Stage 6 as a separate high-risk plan;
- broad formatting, comment rewriting, unrelated type cleanup.
