# Concurrent root runs on a VoxContext

> Implementation plan. Refactor `VoxContext` so one seat can run a strategist turn, diplomat chats, deal responses, and background analysts concurrently without sharing execution state, while every run sees the correct game turn and event window.

## Implementation status

The refactor lands in staged checkpoints. Each checkpoint keeps the package type-checking and the existing suites green.

- [x] **Stage 1 — VoxContext run-model core.** ALS execution frames; `RootRun` objects; `withRun()`/`forkRun()`; the composed-parameter proxy; `baseParameters`/`currentParameters`; root-owned `AbortController` with all four signal sites migrated; `currentInput` resolved from the frame; `streamProgress`/`timeoutRefresh` as ALS-backed accessors; per-root token sink alongside the seat totals; and a simplified `shutdown()` that aborts every root and proceeds (no teardown wait). Tests: `tests/mock/context/vox-context-runs.test.ts` and `vox-context-execute-runs.test.ts`.
- [x] **Stage 2 — Strategist + game-state/pacing integration.** `VoxPlayer` sets base parameters once and wraps each turn in `withRun({ overrides: { turn, before, after } })`; the persistent event cursor moved onto `VoxPlayer` and advances after a successful refresh; turn telemetry now reads the run handle's token sink. `GameState.mergedEvents` added; `withEventWindowFallback()` writes only `mergedEvents` (snapshot/restore dropped); window readers (`simple-strategist`, `simple-strategist-staffed`, `simple-briefer`, `specialized-briefer`) switched to `mergedEvents ?? events` while pacing/`mergeCachedEvents` keep the immutable slice. Game-state cache concurrency: `_pendingRefresh` dedup removed, same-turn refresh updates the cached `GameState` in place (larger serialized `events` wins), culling is relative to the highest cached turn (never deletes future), and `getRecentGameState()` is bounded at-or-before the run turn. Tests: `tests/mock/strategist/strategy-parameters.test.ts`, `pacing.test.ts`, and new `vox-player-runs.test.ts`.
- [x] **Stage 3 — Web diplomacy/chat.** **Cache-correctness core:** `GameState.eventsAfter` records the lower event-ID bound a slice was fetched with; `ensureGameState()` is coverage-aware (a cached entry is a hit only when `eventsAfter <= parameters.after`, i.e. it covers the requested range — `undefined` means legacy/sufficient), and `refreshGameState()`'s same-turn in-place merge keeps the *wider*-covering slice (smaller `after` wins, serialized size only as a tiebreak at equal coverage). This closes the cache-hit race where a chat refreshing the live turn narrowly (`after = turn*1e6`) would let a lagging strategist (`after = its event cursor`, reaching back across a dropped turn) short-circuit its wider fetch and lose the dropped turn's events. **Web-route migration:** `/agents/message` now wraps the entire request — game-state prep, programmatic-agent handling, and `execute()` — in one `voxContext.withRun({ overrides: { turn, before, after }, streamProgress })` at the session's live turn (`currentTurnOf`); the SSE progress sink is passed through `VoxRunOptions` (no more shared `streamProgress` field), and per-run disconnect cancellation listens on `res` 'close' (the SSE connection, not `req`'s body stream), calling `run.abort()` — never the context-wide `voxContext.abort()` — guarded by a `completed` flag so the server's own `res.end()` is not treated as a disconnect; the live-turn-unavailable path still rolls back the queued message and returns an explicit SSE error. `respondToHumanDeal()` opens its own `withRun()` at the live turn around refresh + diplomat execution + transcript append. The `civIdentity()`/`currentTurnOf()` display helpers (and telepathist setup) moved off the `lastParameter` shim to the explicit `getBaseParameters()`/`setBaseParameters()`/`currentParameters` API, and `civIdentity()`'s "newest snapshot" lookup is bounded by the live session turn instead of `MAX_SAFE_INTEGER`. Tests: `strategy-parameters.test.ts` (coverage-aware hit/miss + wider-wins merge in both arrival orders); `web/agent-routes.test.ts` (new `makeMockContext` run-model fake; cases asserting the request opens one live-turn run with a `streamProgress` sink and never aborts on normal completion, that a client disconnect aborts only that run and not the context, and that `respondToHumanDeal` runs in its own live-turn root).
- [x] **Stage 4 — Standalone workflows + tool layer.** **Tool layer:** `simple-tools.ts` and `mcp-tools.ts` migrated off `lastParameter` — the simple-tool span `game.turn` and the `parameters` handed to the tool fn now resolve from `context.currentParameters` (active root's composed view, base fallback outside a run); the MCP-tool span `game.turn` reads `currentParameters` too (timeout refresh was already ALS-backed from Stage 1). `agent-tools.ts` was already on the run model (blocking branch `execute()`s directly in the caller's root; fire-and-forget `forkRun()`s with an OTEL `ROOT_CONTEXT` detach), and the negotiator/close-conversation tools already read `currentInput` — left as-is. **Standalone workflows:** `telepathist/console.ts` now `setBaseParameters()` (was `lastParameter=`) and wraps the top-level `execute()` in one `withRun({ streamProgress })` so preparation (which fans out its own per-turn roots) and the greeting share the logger progress sink. `oracle/replayer.ts` wraps each per-task `execute()` in `withRun({ parameters })` inside the existing `pLimit`, giving every concurrent replay its own root/token sink (the per-execute `tokenOutput` capture is preserved). `archivist/pipeline/telepathist-prep.ts` `setBaseParameters()` (no enclosing root — its fan-out needs per-turn roots) and the `finally` no longer double-closes the params (`shutdown()` owns the base now; the explicit close runs only if the context was never created). `telepathist/preparation/turn-preparation.ts` and `phase-preparation.ts` capture the progress sink once before the fan-out, then run each `pLimit(5)` task in its own `context.withRun({ overrides: { turn }, streamProgress })` (phase uses `turn: phase.toTurn`), dropping the `{ ...parameters, turn }` copies — the run's composed parameters carry the turn to the nested `callAgent`. `summarizeWithCache`/briefing generation and the concurrent same-turn nested briefers stay nested `callAgent()`s (no new roots). The `parameters` argument on `execute()`/`callAgent()` is unchanged (shim until Stage 5); inside a run it is ignored in favor of the root's composed parameters. **Tests:** `tests/helpers/fake-vox-context.ts` gained the run-model surface (`withRun`, `currentParameters`, `setBaseParameters`/`getBaseParameters`, `logger.child`); new `tests/mock/telepathist/preparation-runs.test.ts` asserts each turn/phase task opens its own root with its own `turn` override (no two concurrent summaries share a turn), that a failing task is isolated from siblings, and that a context-length signal is recorded per-turn without cancelling siblings; `replayer.test.ts`/`replayer-cache.test.ts` VoxContext fakes gained `withRun` (replayer asserts one live-`parameters` run per task); `mcp-tools-execute.test.ts`, `close-conversation-tool.test.ts`, and `negotiator.test.ts` stubs moved from `lastParameter` to `currentParameters`. **Review follow-ups:** (1) `withRun()` now links a run opened *inside* another run to the enclosing run's abort signal — a parent `run.abort()` (e.g. an SSE disconnect) cascades into nested per-turn/per-phase preparation roots, while each child keeps its own `AbortController` so siblings stay isolated and `forkRun()` stays detached; (2) `shutdown()` cleanup is unconditional — `baseParameters.close()` + registry unregister run in a `finally` so a failed telemetry flush can no longer leak the context-owned parameters; (3) `FakeVoxContext` now backs `withRun`/`currentParameters`/`streamProgress` with `AsyncLocalStorage` so concurrent runs are genuinely isolated in tests. New tests: nested parent→child abort cascade + already-aborted-parent short-circuit (`vox-context-runs.test.ts`), shutdown-flush-throws still closes params (`vox-context-execute-runs.test.ts`), and the prep test asserts ALS-isolated `currentParameters` per concurrent task.
- [x] **Stage 5 — Final API flip and shim removal.** `execute()` now *requires* an active run (rejecting with `VoxContext.execute requires an active run; call withRun() or forkRun().`), and both `execute()` and `callAgent()` dropped their `parameters` argument — the active root's composed parameters are the single source. `callAgent()` checks the active-run precondition *before* its agent-error try/catch so the missing-run programming error surfaces instead of being swallowed into `undefined`. The ephemeral-root compat branch in `execute()` is gone, as are the `lastParameter` getter/setter alias and the `_legacyStreamProgress`/`_legacyTimeoutRefresh` context fields: `streamProgress`/`timeoutRefresh` getters now resolve purely from the active root/frame (returning `undefined` outside a run) and their setters throw outside a run. `createAgentTool()` dropped its `toolsGetter` parameter (the wrapped agent resolves parameters from the active/forked root), and its registration in `registerTools()` no longer threads one. All callers migrated to the no-parameter signatures: `vox-player.ts`, `web/routes/agent.ts` (`/agents/message` + `respondToHumanDeal`), `telepathist/console.ts`, `oracle/replayer.ts`, `utils/tools/agent-tools.ts` (blocking + fire-and-forget), and the `callAgent` sites in `summarizer.ts`, `briefer/briefing-utils.ts`, `turn-preparation.ts`, `phase-preparation.ts`. Tests updated to the new signatures and run-model: `agent-tools.test.ts` (toolsGetter removed; execute asserted as `(name, input)`), `vox-context-current-input.test.ts` / `vox-context-execute-runs.test.ts` / `vox-context-timeout-refresh.test.ts` (executes wrapped in / nested inside `withRun`, parameter argument dropped), `replayer.test.ts` / `replayer-cache.test.ts` (execute mocks read the run's parameters captured by the `withRun` fake), `agent-routes.test.ts` (execute fakes/asserts on `(voice, thread, …)`), and `preparation-runs.test.ts` (summarizer turn read from `currentParameters`, context-length callback at the new positional index). Full suite green (832 passed) and the package type-checks.

**File layout.** The run-model types and pure construction helpers live in `infra/vox-run.ts`: `ExecuteTokenOutput`, `ExecuteOptions`, `VoxRunOptions`, `VoxRunHandle`, the internal `RootRun`/`ExecutionFrame`, and the factories `composeParameters`, `forkSnapshotParameters`, `createRootRun`, `createRunHandle`, `abortRun` (they touch only their arguments). `VoxContext` composes them with its `AsyncLocalStorage` store, active-run map, and lifecycle. Consumers import `ExecuteTokenOutput` from `infra/vox-run.ts`.

**Staging shim (Stages 1–4, removed in Stage 5 — done).** So the run-model core could land and be reviewed before callers migrated, `execute()`/`callAgent()` kept their original signatures (with the `parameters` argument) during the intermediate stages. When called outside an active run they wrapped themselves in an *ephemeral root* over the supplied `parameters`, so every existing caller kept working unchanged. Likewise `lastParameter` was a getter/setter alias of `currentParameters`/`setBaseParameters`, and `streamProgress`/`timeoutRefresh` kept a context-field fallback for callers that still assigned them before opening a run. **Stage 5 removed all of this:** `execute()`/`callAgent()` now *require* an active run (rejecting otherwise) and no longer take a `parameters` argument; the ephemeral-root path, the legacy `_legacyStreamProgress`/`_legacyTimeoutRefresh` fields, and `lastParameter` are gone.

## Objective

A `VoxContext` represents long-lived resources and state for one seat. It must safely support multiple concurrent **root runs**:

- one strategist turn;
- each diplomat chat request;
- each automatic diplomat response to a deal;
- each standalone or telepathist request;
- each fire-and-forget analyst submitted by another agent.

A root run owns its cancellation, progress callbacks, token accounting, current turn, and event window. Agents invoked synchronously inside that work, such as negotiators and briefers, are nested executions in the same root run: they inherit its cancellation, parameters, and token accounting while temporarily replacing only the active agent input. An analyst is “detached” because its `fireAndForget` handoff returns immediately and lets the analyst continue in the background; it therefore starts a new root run rather than remaining part of the caller’s run.

The refactor must also make chat-side agents use the session’s live turn while preserving the strategist’s queued decision turn. A strategist may legitimately be deciding an older turn while a diplomat speaks on the current live turn.

## Current problems

`VoxContext` currently stores execution state in shared instance fields:

- `abortController`;
- `currentInput`;
- `lastParameter`;
- `streamProgress`;
- `timeoutRefresh`;
- cumulative token counters used to derive strategist-turn token usage.

Overlapping `execute()` calls overwrite these fields. In particular, the web route calls `voxContext.abort()` when its SSE response closes, which can abort an unrelated strategist or chat. The route also assigns `streamProgress` before calling `execute()`, so moving state only inside `execute()` would be too late to isolate request setup and game-state refresh.

The strategist’s shared `StrategistParameters` object causes a second conflict. Its `turn`, `before`, and `after` fields describe the strategist decision loop, not the live game. Chats reuse that object and can therefore see turn `-1` at game load or a stale decision turn. Pacing also merges multi-turn events by temporarily replacing a cached `GameState.events`, allowing concurrent readers to observe the strategist’s mutable working window.

## Run model and VoxContext API

The run-model types and pure construction helpers live in `infra/vox-run.ts` (see Implementation status → File layout); `VoxContext` owns the runtime that composes them.

Add an `AsyncLocalStorage` store to `VoxContext`. The store represents the current execution frame and points to a root-run object.

The root-run object contains:

- a unique run ID;
- the composed parameters for this run;
- one `AbortController`;
- run-local `streamProgress` and `timeoutRefresh` callbacks;
- cumulative input, reasoning, and output token counts for all executions nested in the run;
- completion state used to make abort and cleanup idempotent.

An execution frame contains the root-run reference and the current agent input. Nested `execute()` calls create nested frames with a new input but the same root. `currentInput` therefore resolves from the current frame and naturally returns to the parent input when the nested call completes.

Expose the following context API:

```ts
interface VoxRunOptions<TParameters> {
  parameters?: TParameters;
  overrides?: Partial<TParameters>;
  streamProgress?: (message: string) => void;
}

interface VoxRunHandle<TParameters> {
  readonly parameters: TParameters;
  readonly signal: AbortSignal;
  readonly tokens: ExecuteTokenOutput;
  abort(): void;
}

withRun<TResult>(
  options: VoxRunOptions<TParameters>,
  callback: (run: VoxRunHandle<TParameters>) => Promise<TResult>
): Promise<TResult>;

forkRun(
  callback: (run: VoxRunHandle<TParameters>) => Promise<unknown>
): void;
```

`withRun()` creates and registers a root run, enters its ALS scope, invokes the callback, and unregisters it in `finally`. It covers all work belonging to the operation, including preparation before the first agent executes. The callback receives the run handle so HTTP/SSE code can cancel that specific operation.

Its parameter source is `options.parameters` when supplied, otherwise the context’s `baseParameters`; it throws before entering the run if neither exists. `options.overrides` seeds the run-local side of the composed parameter proxy. Reads and writes of those keys stay in the root run, while all other properties resolve against the selected parameter source. Strategist and chat callers pass their `turn`, `before`, and `after` values through `overrides`. Seat contexts normally omit `parameters` and compose over their base, while concurrent Oracle tasks supply their task-specific parameter object and need no overrides.

`forkRun()` is valid only inside an existing run. It shallow-copies the parent’s composed parameters into a new plain parameter object, copies the progress configuration, creates an independent root cancellation/token scope, starts it without awaiting completion, and logs failures. Top-level values such as `turn`, `before`, and `after` — and any other base primitive such as `lastDecisionTurn` — are snapshotted by value into the copy, while nested seat state such as `gameStates`, `workingMemory`, and `metadata` remains shared by reference. Later top-level writes in either run do not affect the other. Agent tools use it only for `fireAndForget` agents. The analyst keeps the turn and game view from the diplomat that submitted it, but survives cancellation of that diplomat request.

`run.abort()` always means cancellation. It aborts the root signal and its synchronous nested work; normal success is represented by the `withRun()` callback resolving and requires no explicit abort or success flag. Context-wide `context.abort(successful?)` may retain its existing lifecycle argument for `VoxPlayer` compatibility, but that flag is context/player completion metadata and is not propagated to individual run handles.

Add a code comment beside the run-construction logic documenting the parameter ownership convention:

- `setBaseParameters()` transfers ownership to `VoxContext`; `shutdown()` closes `baseParameters`.
- Parameters supplied through `withRun({ parameters })` remain caller-owned. The caller closes them in its own `finally` when they contain resources.
- The shallow parameter copy created by `forkRun()` is borrowed and never closed by the fork. Its nested resource-bearing objects remain owned by their original base or caller.
- A caller may fork a run over caller-owned parameters only when it guarantees that the referenced resources outlive the detached child. The current fire-and-forget analyst path forks base-backed seat parameters, whose lifetime is already the context lifetime.
- `withRun()` and `forkRun()` never infer ownership or invoke `parameters.close()`.

`execute()` behaves as follows:

- it requires an active root run and rejects with `VoxContext.execute requires an active run; call withRun() or forkRun().` when called outside `withRun()` or `forkRun()`;
- inside a run, it creates only an execution frame and uses the root’s composed parameters;
- a synchronous nested agent invocation stays in the current root;
- it never mutates shared execution fields.

Remove the parameter argument from `execute()` because the active root is the single source of execution parameters:

```ts
execute(
  agentName: string,
  input: unknown,
  callback?: StreamingEventCallback,
  tokenOutput?: ExecuteTokenOutput,
  onContextLengthError?: () => void,
  options?: ExecuteOptions
): Promise<unknown>;
```

`callAgent()` follows the same rule and also removes its parameter argument. It checks the active-run precondition before its existing agent-error handling, so the missing-run programming error is never swallowed and calling it outside a root rejects:

```ts
callAgent<T = unknown>(
  name: string,
  input: unknown,
  onContextLengthError?: () => void
): Promise<T | undefined>;
```

Manual `callTool()` continues to accept explicit parameters and does not create or require a root by itself. This preserves setup, shutdown, and non-agent MCP calls that already carry their parameter context explicitly.

## Shared parameters and run-local parameters

Replace `lastParameter` as mutable “most recently executed” state with two explicit concepts:

- `baseParameters`: the stable long-lived parameter object owned by the context;
- `currentParameters`: the active root’s composed parameter view, falling back to `baseParameters` outside a run.

Add `setBaseParameters()` for `VoxPlayer`, telepathist setup, and other context owners. `execute()` does not replace the base. Context shutdown closes `baseParameters`.

The composed parameter view is a proxy over the base object plus an override object:

- `withRun({ overrides })` copies the supplied top-level entries into a new override object owned by the root;
- properties present in the override object read and write the override;
- every other property reads and writes the base object;
- nested shared objects retain their original references.

For strategist contexts, each root overrides:

- `turn`;
- `before`;
- `after`.

The following remain shared by reference:

- `gameStates`;
- `metadata`;
- `workingMemory`;
- `lastDecisionTurn` — within a `withRun()` proxy root, writes resolve to the base object and are seat-wide. Add a code comment at the proxy/shared-list definition stating that only the strategist root writes `lastDecisionTurn`; a chat root must never write it, since base writes are visible to every concurrent run on the seat. The comment must also note that a `forkRun()` child holds a snapshot copy of this primitive (see the parameter ownership convention above), so the seat-wide guarantee applies only to `withRun()` roots — a forked analyst's write would stay local and must never be relied on; forked analysts do not write it.
- `_pendingBriefings`;
- seat identity and configuration such as `playerID`, `gameID`, `mode`, `syncSeed`, and `_humanDecisionBus`.

**Proxy implementation notes.** The composed view was checked against every current consumer of the parameters object (`experimental_context` reads in `mcp-tools.ts`, agent hook calls, `Object.keys(parameters.gameStates)`, the `{ ...parameters, turn }` spreads in `turn-preparation.ts`/`phase-preparation.ts`). It is safe, with these requirements:

- Implement both `get` and `set` traps with override-overlay-on-base semantics (override keys read/write the override object; all others read/write the base).
- The planned override keys (`turn`, `before`, `after`) always also exist on the base `StrategistParameters`. Spreads/`Object.keys` over the proxy therefore stay correct because the base target enumerates those keys and `get` overlays the override value. To keep this robust if an override-only key is ever added, also implement `ownKeys` and `getOwnPropertyDescriptor` traps so the override keys remain enumerable.
- The proxy is never identity-compared, `JSON.stringify`-d, or `for…in`-d in current code, so no special handling is needed there; `execute()` stringifies `input`, not parameters.

Migrate tool wrappers and context consumers from `lastParameter` to `currentParameters`. This includes simple-tool and MCP-tool telemetry, agent-tool parameter lookup, diplomacy helpers, and web-route context reads. Code that needs seat state outside a root uses `baseParameters` explicitly. Accessing `currentParameters` outside a run may still return the base for non-agent tool and display operations, but that fallback never permits `execute()` or `callAgent()`.

## Cancellation and lifecycle

There are two distinct cancellation operations:

- `run.abort()` cancels one root run and everything synchronously nested in it;
- `context.abort()` cancels every active root run and remains the operation used by `VoxPlayer.abort()`, game switching, and shutdown.

All model calls use the active root’s abort signal. Nested negotiators and briefers stop when their parent root is aborted. A detached analyst has its own signal and is not cancelled by the originating chat, but context-wide abort still cancels it.

Every existing `this.abortController.signal` reference in `vox-context.ts` must be migrated to read the active root's signal from ALS. Run isolation breaks if even one is missed — a chat disconnect would still stop a sibling strategist turn, or vice versa. The exact sites to touch:

- [ ] `execute()` model call: `abortSignal: this.abortController.signal` in `streamTextWithConcurrency` (currently `vox-context.ts:561`).
- [ ] `executeAgentStep()` post-stream guard: `this.abortController.signal.aborted` (currently `vox-context.ts:581`).
- [ ] `executeAgentStep()` stop check: `this.abortController.signal.aborted` in the `shouldStop` expression (currently `vox-context.ts:630`).
- [ ] `executeAgentStep()` empty-steps branch: `this.abortController.signal.aborted` (currently `vox-context.ts:639`).
- [ ] Remove the shared instance `abortController` (constructor init and the recreate-after-abort in `abort()`); the only `AbortController`s now live on root-run objects.
- [ ] Test: abort one root mid-step and assert a concurrently-running second root's step loop completes unaffected (its signal never observes aborted).

`VoxContext` tracks active roots in a `Map`. Root runs are terminable through their `AbortController`: every awaited operation in a root, including model generation, receives the root signal, and execution checks that signal before continuing between steps. `shutdown()` marks the context as closing, aborts every active root, and then proceeds without waiting for the roots to unwind — it flushes telemetry, closes the base parameters, and unregisters the context. Shutdown needs roots to stop, not to succeed; aborted roots settle on their own afterwards. New roots are rejected once shutdown begins.

Shutdown does not close run-supplied parameters; it closes only the context-owned `baseParameters`. Because no run-scoped resource is closed during shutdown, there is nothing run-scoped to wait on, so shutdown does not block on root completion at all. This also avoids the current bug where `shutdown()` closes whichever `lastParameter` happened to run last (arbitrary under concurrency) without making `VoxContext` guess whether a run parameter object is owned, borrowed, or shares resources with another object.

- [ ] `shutdown()` closes only `baseParameters` (the context-owned object), replacing today's `lastParameter?.close?.()`.
- [ ] Callers that construct resource-bearing parameters for `withRun({ parameters })` retain their existing explicit `finally` cleanup; the run API does not close them.
- [ ] Oracle per-task `OracleParameters` are resource-free today, so their callers have nothing additional to close.
- [ ] Every root-owned asynchronous operation receives the root abort signal, and execution checks the signal before advancing after awaited work, so `run.abort()` makes the root settle rather than merely recording cancellation.
- [ ] `shutdown()` aborts every active root (via `abort()`) and proceeds; it does not wait on, or reject for, root completion.
- [ ] Test: call `shutdown()` while a root is active and assert the root's signal is aborted, base parameters are closed exactly once, and new runs are rejected afterwards.
- [ ] Test: keep one root pending despite abort and assert `shutdown()` still resolves promptly (it does not wait for the root) and completes cleanup.

In the web route, an HTTP disconnect means the browser or client closes the SSE request because of cancellation, navigation, tab closure, or network loss. Register the response-close listener immediately after creating the root and before awaiting refresh or agent work. It calls only `run.abort()`. Track whether the response completed normally so the server’s own `res.end()` does not treat successful completion as a disconnect.

## Token accounting and progress callbacks

Keep the existing context-wide input, reasoning, and output counters as seat totals. Every completed execution atomically adds its tokens to:

1. the current root’s cumulative token sink;
2. the context-wide seat totals;
3. an optional per-`execute()` `ExecuteTokenOutput`, preserving Oracle behavior.

Nested negotiators and briefers count toward their parent root. A detached analyst counts toward its own root and the seat total. Concurrent chat or analyst tokens therefore cannot appear in the strategist root’s turn delta.

`VoxPlayer` reads the strategist run handle’s token totals after the turn instead of subtracting context-wide counters.

Move `streamProgress` and `timeoutRefresh` into the active root. Existing context accessors may remain as getters/setters backed by ALS to reduce call-site churn. Their getters return the active root callback, or `undefined` when no run is active; their setters require an active run and throw otherwise. They must never create shared mutable request state. Telepathist console work and web requests therefore create their run before assigning progress callbacks, while archivist preparation can capture an absent callback and pass `undefined` to its per-item roots.

## Turn and game-state behavior

`StrategistSession.handleGameSwitched()` already sets `session.turn` before creating `VoxPlayer` contexts, so no extra session initialization is needed.

Each strategist turn creates a root around the entire turn operation, including pause, refresh, pacing evaluation, optional LLM decision, and resume. Its run-local values come from the queued turn:

- `turn = turnData.turn`;
- `before = turnData.turn * 1_000_000 + 999_999`;
- `after = the strategist’s persistent event cursor`.

`VoxPlayer` supplies those values through `withRun({ overrides: { turn, before, after } })`; the context’s base strategist parameters remain unchanged.

Move the persistent event cursor from shared `StrategistParameters.after` into `VoxPlayer`. Advance it after the game-state refresh succeeds, preserving the existing behavior where a failed refresh leaves the cursor unchanged and a later turn re-fetches the gap.

Each live diplomat chat or deal response creates a root using:

- `turn = context.session.getTurn()`;
- `before = turn * 1_000_000 + 999_999`;
- `after = turn * 1_000_000`.

The web route supplies those values through `withRun({ overrides: { turn, before, after }, streamProgress })`.

The chat performs `ensureGameState()` with its composed parameters before executing the envoy. The hint, game context, tools, negotiator, and any detached analyst therefore all use the live turn. If a live session unexpectedly has no turn, the route returns a clear unavailable-state error rather than silently using the strategist’s stale turn. Standalone and database-backed contexts continue to use their supplied parameter turn.

The strategist’s queued turn and the chat’s live turn remain independent even when both roots run concurrently.

## Immutable cached events and pacing windows

Add `mergedEvents?: EventsReport` to `GameState`, alongside `events`.

`GameState.events` is the per-turn live event slice for that turn. It is immutable as a *working window* — pacing and the event-window fallback must never mutate it in place — but a same-turn refresh may replace it with a larger slice for the same turn (see "Game-state cache concurrency"; the report with the larger serialized size wins). It only ever grows toward the largest serialized snapshot seen for that turn and is never repurposed as a multi-turn window. `GameState.mergedEvents` is the derived multi-turn pacing window associated with that state’s strategist decision. Keeping the fields separate preserves the per-turn slice while allowing the selected decision window to remain available to the strategist and its briefers.

`withEventWindowFallback()` computes each candidate with `mergeCachedEvents()` and assigns it to `state.mergedEvents` before invoking the attempt. It does not mutate `state.events`. The first strategist attempt receives the full decision window through `mergedEvents`; narrower retries replace only the derived field on that same `GameState`. The successful window remains on the state for subsequent nested or cached briefer consumption. If every attempt fails, the final attempted window remains for diagnostics and does not affect the immutable event slice.

Strategists and briefers consume:

```ts
state.mergedEvents ?? state.events
```

This applies to simple and specialized briefers and any strategist prompt that reads events. A briefer nested under a strategist reads the current candidate window from the shared state object. An on-demand briefer uses `mergedEvents` when that turn has an established strategist decision window; otherwise it falls back to the immutable live-turn slice.

The exhaustive set of `state.events` reader sites, from grepping `.events` over `src`. Each must be classified as a **window reader** (switch to `state.mergedEvents ?? state.events`) or a **slice reader** (deliberately keep `state.events`):

- [x] `briefer/specialized-briefer.ts` (`filterEventsByCategory(state.events! …)`) — window reader; switch.
- [x] `briefer/simple-briefer.ts` (`jsonToMarkdown(state.events)`) — window reader; switch.
- [x] `strategist/agents/simple-strategist.ts` (`jsonToMarkdown(state.events)`) — window reader; switch.
- [x] `strategist/agents/simple-strategist-staffed.ts` (`JSON.stringify(state.events!)` size gate) — window reader; switch.
- [x] `strategist/pacing/important-events.ts` (`flattenEvents(state.events)`) — slice reader; **keep `state.events`**. Pacing computes importance to *decide* the window, so it must read the immutable per-turn slice, not the merged window. Verify and comment this intent.
- [x] `strategist/strategy-parameters.ts` `mergeCachedEvents()` (`gameStates[turn]?.events`, `report.events`) — slice reader; **keep `state.events`**. This is the source that *builds* `mergedEvents` from each turn's immutable slice.
- [x] `strategist/strategy-parameters.ts` `withEventWindowFallback()` (`state.events = mergeCachedEvents(…)` and the `cachedCurrentEvents` snapshot/restore) — rewrite to assign `state.mergedEvents` and drop the snapshot/restore workaround entirely.
- [x] Test: assert window readers pick up `mergedEvents` when present and fall back to `events` when absent; assert slice readers (pacing, `mergeCachedEvents`) are unaffected by a set `mergedEvents`.

## Game-state cache concurrency

Keep `gameStates` shared so strategist, diplomat, negotiator, and analyst runs reuse snapshots and reports.

Remove the single `_pendingRefresh` field and its deduplication. Concurrent cache misses may issue independent MCP refreshes; refresh cost is acceptable, and runs for different turns must never receive one another’s promise.

When two refreshes target the same turn, the later successful refresh must **update the existing cached `GameState` in place rather than replace the object reference**. Briefing deduplication (`briefing-utils.ts`) closes over the specific `GameState` instance: `requestBriefing()` writes the in-flight promise to `state._pendingBriefings[reportKey]`, and `generateBriefing()` writes the resolved report to that same `state.reports` after the LLM returns. Swapping the map entry for a fresh object would orphan any briefing promise still in flight — it would resolve into the discarded object, its `finally` cleanup would no longer match the live entry (`state._pendingBriefings?.[reportKey] === tracked` becomes false), and the expensive report would be lost. Copying fields forward at swap time does not fix this, because the in-flight closure already captured the old reference.

Therefore the refresh updates the freshly-fetched snapshot fields on the existing object and leaves `reports`, `_pendingBriefings`, and `mergedEvents` untouched. The non-event fields (`players`, `cities`, `options`, `military`, `victory`) take the newest fetch. For `events`, **the wider-covering slice wins** (Stage 3 refinement). Each slice records the exclusive lower event-ID bound it was fetched with in `GameState.eventsAfter` (the `after` passed to `get-events`); a *smaller* `after` is a *wider* window. On a same-turn in-place update: if the fetched `after` is smaller than the existing `eventsAfter`, the fetched (wider) slice wins regardless of serialized size and `eventsAfter` widens; at *equal* coverage (same `after`, or a legacy entry whose `eventsAfter` is unknown) the **larger serialized report wins** as before. Concurrent same-turn refreshes can complete in any order, so neither dimension is decided by arrival order — a fuller report supersedes a smaller partial one at equal coverage, while a wider slice (e.g. a lagging strategist's fetch folding in a turn dropped while it was busy) is never clobbered by a narrower same-turn chat refresh even when that narrow refresh is serialized-larger. This preserves the briefing dedup invariant and the strategist's selected pacing window simultaneously, with no orphaned references.

The matching read path is **coverage-aware** too: `ensureGameState()` treats a cached `gameStates[turn]` as a hit only when its slice covers the requested range (`eventsAfter <= parameters.after`, or `eventsAfter === undefined` for legacy/hand-built entries). Otherwise it refreshes. Without this, once chat refreshes the live turn narrowly, a chat-populated entry would let a lagging strategist short-circuit its wider fetch, advance its event cursor past the dropped turn, and lose those events permanently.

- [x] Touch: same-turn refresh path updates the cached `GameState` fields in place; never reassigns `gameStates[turn]` to a new object when an entry already exists. Overwrite `players`/`cities`/`options`/`military`/`victory` with the newest fetch; set `events`/`eventsAfter` to the wider-covering slice (smaller `after`), falling back to the larger `JSON.stringify(...).length` at equal coverage.
- [x] Touch: `ensureGameState()` is coverage-aware — a cached entry is a hit only when `eventsAfter <= parameters.after` (or `eventsAfter` is undefined); otherwise it refreshes so the strategist's wider window is fetched even when a chat already cached the turn narrowly.
- [x] Test: same-turn refresh keeps the existing `GameState` reference, preserves `reports`/`_pendingBriefings`, and keeps the larger serialized `events` slice at equal coverage (covered in `strategy-parameters.test.ts` "same-turn in-place update"; the closed-over briefing-dedup reference is preserved because the object identity is retained).
- [x] Test: issue two same-turn refreshes with differing coverage (`after`) in both arrival orders; assert the cached `events` is always the wider-covering slice and is never overwritten by a narrower one, even when the narrower slice is serialized-larger.
- [x] Test: `ensureGameState()` refreshes when the cached slice does not cover the requested wider range (the chat-narrow / strategist-wide race), and is a no-fetch hit when the cached slice already covers the request.

Change state culling so a lagging strategist never deletes a newer chat snapshot. After inserting a state:

1. find the highest cached turn;
2. delete only turns older than `highestTurn - cullLimit`;
3. never delete entries because they are later than the refreshing run’s turn.

Keep briefing promise deduplication on each `GameState` because briefing generation is expensive and same-state callers should share it.

Change `getRecentGameState()` consumers that are executing inside a root to prefer the state at `parameters.turn`; “most recent” must not make a lagging strategist accidentally read a newer chat snapshot. Briefer and librarian helpers should use an exact/nearest-at-or-before lookup bounded by the active run turn. Once that state is selected, briefing lookup and generation continue to use the selected state’s shared `reports` and `_pendingBriefings`, so nested briefers still join the same per-state/per-report promise rather than bypassing deduplication.

## Integration changes

### Strategist

- Set the context’s base parameters once in the `VoxPlayer` constructor.
- Keep queued turn and event cursor in `VoxPlayer`.
- Change `VoxPlayer.execute()` so each processed turn enters `context.withRun()` before pause, refresh, pacing, or strategist work.
- Change `executeDecisionWithEventFallback()` to call `context.execute(strategistName, input, ...)` inside that established root, without passing parameters.
- Pass the run’s composed parameters to refreshes, tools, pacing, strategist execution, and nested briefers.
- Record turn token telemetry from the run handle.

### Web diplomacy and chat

- Change `/agents/message` in `web/routes/agent.ts` to enter `voxContext.withRun()` around the full request operation, including game-state preparation and programmatic-agent handling; its `voxContext.execute()` call becomes a nested execution with no parameter argument.
- Pass the SSE progress callback in `VoxRunOptions`.
- Install per-run disconnect cancellation before asynchronous work starts.
- Change `respondToHumanDeal()` in the same route to create its own `withRun()` around refresh, diplomat execution, and transcript handling.
- Keep identity and thread-open display helpers on stable base parameters plus `session.getTurn()` because they run outside an execution root.

### Agent tools

- Change the blocking branch in `utils/tools/agent-tools.ts` to call `execute()` directly inside the caller’s existing root; it must not call `withRun()`.
- Change the `fireAndForget` branch in that file to call `forkRun()`, detach the OpenTelemetry context inside the fork, and call `execute()` from the forked root.
- Negotiator and close-conversation tools read `currentInput` from the active execution frame.
- Simple and MCP tools receive `currentParameters`; MCP timeout refresh resolves from the current root.

### Standalone workflows

- Change `telepathist/console.ts` to set base parameters and wrap initialization, preparation, and the top-level telepathist `execute()` in one `withRun()` carrying the logger progress callback.
- Change each task in `oracle/replayer.ts` to call `withRun({ parameters })` around the Oracle `execute()`. Every concurrent replay task gets its own root and token sink on the shared Oracle context.
- Change `archivist/pipeline/telepathist-prep.ts` to set base parameters once. It does **not** wrap itself in a single root, because `prepareTurnSummaries()` fans out concurrent per-turn summaries that each need a different `turn`.
- Change `telepathist/preparation/turn-preparation.ts`: capture the caller’s current progress callback once before starting the fan-out. Each complete `pLimit(5)` task then runs inside its own `context.withRun({ overrides: { turn }, streamProgress }, async () => { ... })`, replacing `{ ...parameters, turn }`. The root covers the opening progress message, situation/decision reads, retry loop, nested summarizer calls, result progress, and database persistence. Each concurrent turn therefore has its own `turn`, signal, and token sink while composing over the same base parameters.
- Change `telepathist/preparation/phase-preparation.ts` the same way: capture the progress callback before fan-out, then wrap each complete phase task in `context.withRun({ overrides: { turn: phase.toTurn }, streamProgress }, async () => { ... })`. The root covers progress, input construction, retries, nested summarizer calls, and persistence. Sharing the same logger/SSE callback function across roots is fine; each task stores it in its own root rather than a shared context field.
- Keep `summarizeWithCache()` and briefing generation on `callAgent()` without creating roots themselves; their telepathist/strategist entry point or the surrounding per-item root is responsible for the enclosing root.
- Concurrent **same-turn** nested briefers stay nested in the caller's existing root and must **not** get their own roots: the `get-briefing` tool's `Promise.all` over categories (`briefer/briefing-utils.ts`) and `simple-strategist-staffed.ts`'s parallel Military/Economy/Diplomacy briefers all share one `state`/`turn` and parameters. Under the no-parameter `callAgent()`, they correctly resolve the caller root's composed turn and continue to share `_pendingBriefings` dedup. Wrapping them in separate roots would wrongly fork their turn and break dedup.
- Test fakes expose `baseParameters`, `currentParameters`, run creation, and frame-local input as needed by the code under test.

### Required execute/callAgent migration map

| Current caller | Required change |
|---|---|
| `strategist/vox-player.ts` strategist execution | Enclose the complete processed turn in `withRun()`; nested `execute()` only. |
| `web/routes/agent.ts` `/agents/message` | Enclose the complete request in `withRun()`; use the handle for disconnect abort. |
| `web/routes/agent.ts` `respondToHumanDeal()` | Create a separate `withRun()` per automatic deal response. |
| `telepathist/console.ts` | Enclose bootstrap/preparation/execution in `withRun()`. |
| `oracle/replayer.ts` | Create one `withRun()` per replay task, inside the existing concurrency limiter. |
| `archivist/pipeline/telepathist-prep.ts` | Set base parameters; do not wrap in a single root (its fan-out needs per-turn roots). |
| `telepathist/preparation/turn-preparation.ts` | Enclose each complete concurrent turn task in `withRun({ overrides: { turn } })` (5 roots), including progress, retries, and persistence. |
| `telepathist/preparation/phase-preparation.ts` | Enclose each complete concurrent phase task in `withRun({ overrides: { turn: phase.toTurn } })`, including progress, retries, and persistence. |
| `utils/tools/agent-tools.ts` blocking handoff | Stay in the existing root and call `execute()` directly. |
| `utils/tools/agent-tools.ts` fire-and-forget handoff | Create an independent root with `forkRun()`, then call `execute()`. |
| `briefer/briefing-utils.ts` | Continue using nested `callAgent()`; no new root. |
| `telepathist/summarizer.ts` (`summarizeWithCache`) | Continue using nested `callAgent()`; no new root (its enclosing per-item root supplies the turn). |
| `briefer/briefing-utils.ts` `get-briefing` tool, `simple-strategist-staffed.ts` parallel briefers | Keep concurrent same-turn briefers nested in the caller's root; no new roots, preserves `_pendingBriefings` dedup. |
| Direct `VoxContext.execute()` tests | Wrap intended executions in `withRun()` and add an explicit outside-run failure test. |

## Test plan

### Run isolation

- Start two root runs on one context and hold them concurrently.
- Assert each sees its own parameters, input, progress callback, timeout callback, and abort signal.
- Call `execute()` and `callAgent()` without a root and assert both reject with the documented programming error.
- Abort one root and verify the other remains active.
- Call context-wide abort and verify every active root stops.
- Verify shutdown rejects new roots, aborts every active root, and proceeds with cleanup without waiting for the roots to unwind.

### Nested and detached agents

- Run a blocking nested agent and assert it inherits the parent parameters, cancellation, and token sink while seeing its own input.
- After it returns, assert the parent input is restored.
- Fork a fire-and-forget analyst and assert it receives the parent turn snapshot but has a different run ID, abort signal, and token sink.
- Abort the parent chat and verify the analyst continues.
- Abort the context and verify the analyst stops.

### Turn correctness

- With strategist base turn still `-1`, open a chat after `GameSwitched` and assert the diplomat hint, context, and tools use `session.getTurn()`.
- Run a lagging strategist turn and a live-turn diplomat concurrently and assert each retains its own turn and event bounds.
- Verify a missing live session turn produces an explicit route error.
- Verify a detached analyst keeps the submitting diplomat’s turn even if the session advances afterward.

### Game-state and pacing safety

- Refresh two different turns concurrently and assert each caller receives and caches its requested turn.
- Refresh the same turn concurrently and assert the final cache entry keeps the `events` slice with the larger serialized size regardless of arrival order, and preserves reports and pending briefings.
- Insert a newer chat state, then refresh a lagging strategist state and assert the newer state is not culled.
- Run event-window fallback and assert it never mutates cached `GameState.events` (the fallback path only writes `mergedEvents`).
- Assert each retry updates only `state.mergedEvents`, and the selected/final attempted window remains on that state.
- Assert simple and specialized briefers consume `state.mergedEvents` when present, while states without a decision window fall back to their immutable `state.events` slice.
- Assert lagging briefer/librarian helpers do not select a future chat snapshot.

### Accounting and routes

- Run strategist, chat, and detached analyst roots concurrently with known token usage.
- Assert strategist turn telemetry contains strategist plus nested briefer/negotiator tokens only.
- Assert chat and analyst roots have independent totals.
- Assert context seat totals equal the sum of all executions.
- Simulate an SSE client disconnect during refresh and generation; assert only that chat root is aborted.
- Complete an SSE response normally and assert `res.end()` does not trigger cancellation.
- Run concurrent turn/phase preparation and assert each fanned-out summary runs in its own root with its own `turn` (no two concurrent summaries observe the same turn override), and that one task's failure or context-length abort does not cancel its siblings.
- Run existing envoy, deal-route, strategist pacing, context-input, Oracle, type-check, test, and build suites.

## Done when

A strategist turn, multiple diplomat chats, deal responses, and detached analysts can overlap on one seat without sharing input, cancellation, progress callbacks, timeout refresh, token deltas, or turn cursors. Chats always reason at the session’s live turn, strategists finish their queued turn even when it lags, cached per-turn `events` remain immutable, each `GameState` retains its separate derived `mergedEvents` decision window, context-wide shutdown still cancels all work, and seat-wide token totals remain complete.
