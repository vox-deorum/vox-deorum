# Concurrent runs on a VoxContext — per-run execution state and correct chat turn

> Plan for review. Refactors `VoxContext` so a diplomat chat and a strategist turn can run on the same seat at the same time, and so chats see the correct game turn.

## Objective

Make a single `VoxContext` safely support **more than one concurrent `execute()` run**, and give chat-side agents (diplomat, negotiator, analyst) the **correct live turn and game state** without disturbing the strategist's decision loop. Two issues, one root cause, one fix.

## Context

`VoxContext` was built assuming **one `execute()` run at a time per seat**. Interactive diplomacy breaks that: a human can chat or trade with an AI civ while that civ's strategist is mid-turn — both run on the *same* `VoxContext` (`${gameID}-player-${playerID}`). This produces two symptoms:

1. **Concurrency corruption.** Overlapping runs collide on per-run state stored in single instance slots (active input, abort, token counts), and a disconnecting chat can abort the strategist's turn.
2. **Wrong turn for chats.** The diplomat runs against the strategist's shared `parameters`, whose `turn` is `-1` at game load and otherwise reflects the strategist's last *decision* turn — not the live turn. So the diplomat reports the wrong turn and fetches the wrong game-state window.

Both stem from **per-run state living in shared single slots**. The fix separates per-run state from long-lived shared seat state.

## Verification of the problem (pre-checked against the code)

**Issue 1 — single-run assumption + a real parallel run.**
- Per-run state in single instance slots on `VoxContext`: `abortController` [vox-context.ts:79](vox-agents/src/infra/vox-context.ts#L79), `currentInput` [:108](vox-agents/src/infra/vox-context.ts#L108), `lastParameter` [:101](vox-agents/src/infra/vox-context.ts#L101), `streamProgress` [:120](vox-agents/src/infra/vox-context.ts#L120), `timeoutRefresh` [:83](vox-agents/src/infra/vox-context.ts#L83), `lastModelName` [:113](vox-agents/src/infra/vox-context.ts#L113), token counters [:88-96](vox-agents/src/infra/vox-context.ts#L88-L96).
- The diplomat chat is voiced from the **target seat's** context (`${gameID}-player-${targetPlayerID}`, [agent.ts:736](vox-agents/src/web/routes/agent.ts#L736)) — the same object the strategist loop owns. Web `execute()` calls ([agent.ts:416](vox-agents/src/web/routes/agent.ts#L416), [:186](vox-agents/src/web/routes/agent.ts#L186)) are not serialized against the strategist or each other. The Negotiator/Analyst handoffs are *not* the problem (nested-blocking, handled by `currentInput` save/restore). `req.on('close')` → `voxContext.abort()` ([agent.ts:445](vox-agents/src/web/routes/agent.ts#L445)) aborts the whole context's controller — a cross-run kill.
- Span routing already keys per-span on `vox.context.id`, so telemetry routing is unaffected by concurrency; only **token aggregation** is shared-mutable and gets misattributed. A per-run token sink already exists (`ExecuteTokenOutput`, [vox-context.ts:34/445](vox-agents/src/infra/vox-context.ts#L34)) and is reusable.

**Issue 2 — stale/`-1` turn + game state.**
- `turn` starts `-1` ([vox-player.ts:65](vox-agents/src/strategist/vox-player.ts#L65)); only the strategist loop advances it ([:142-144](vox-agents/src/strategist/vox-player.ts#L142-L144), `after` at [:179](vox-agents/src/strategist/vox-player.ts#L179)).
- The diplomat reads `parameters.turn` in its hint ("The time is at turn …", [live-envoy.ts:110](vox-agents/src/envoy/live-envoy.ts#L110)) and to fetch state ([strategy-parameters.ts:251](vox-agents/src/strategist/strategy-parameters.ts#L251), which throws "No game state available near turn …" if missing). The `get-events` window comes from `before/after` ([strategy-parameters.ts:113](vox-agents/src/strategist/strategy-parameters.ts#L113)).
- The authoritative live turn already exists: the session sets `this.turn` from the game's `GameSwitched`/`PlayerDoneTurn` notifications ([strategist-session.ts:413/433](vox-agents/src/strategist/strategist-session.ts#L413)), exposed as `session.getTurn()` ([vox-session.ts:44](vox-agents/src/infra/vox-session.ts#L44)). The web layer uses it for *display* (`currentTurnOf`, [agent.ts:165](vox-agents/src/web/routes/agent.ts#L165)) but never injects it into the parameters the diplomat *executes* with.
- `gameStates` is a shared per-turn cache with refresh dedup `_pendingRefresh` and briefing dedup `_pendingBriefings`; `ensureGameState`/`refreshGameState`/`getRecentGameState` operate on it ([strategy-parameters.ts](vox-agents/src/strategist/strategy-parameters.ts)). The cache should stay shared (both runs benefit); only the turn *cursor* should be per-run.

## Design

`VoxContext` keeps **long-lived shared seat state + resources**. A per-run `Run` object holds **per-run execution state and the turn window**, created by `execute()` and made ambient via `AsyncLocalStorage` so existing readers migrate with low churn. The `parameters` an agent sees is a **composed view**: the shared seat base with the run's turn window applied, and caches shared *by reference*.

### What is per-run vs. shared

| State | Today | Goes to | Why |
|---|---|---|---|
| active input (`currentInput`) | `context` slot + save/restore | **Run** | Each run has its own input (thread). Nesting = nested `als.run`. |
| abort (`abortController`) | `context` slot | **Run** (per-run token) | A disconnect aborts only its own run, never the strategist. |
| `streamProgress`, `timeoutRefresh` | `context` slots | **Run** | Per-request sinks; set by the web route per call. |
| token delta (per run) | shared `context` fields | **Run** sink (reuse `ExecuteTokenOutput`) | Strategist's per-turn delta must exclude concurrent chat tokens. |
| token total (seat cumulative) | shared `context` fields | **Shared**, incremented by **every** run | Seat total counts strategist turns *and* chats (true per-seat cost). |
| `lastModelName` dedup | shared `context` slot | **Shared** (strategist-only) | Only the strategist broadcasts model identity; low concern. |
| **`turn`** | shared `parameters` | **Run** | **Strategist = its own decision turn (unchanged); chat = `session.getTurn()`.** They legitimately diverge — see warning. |
| **`before` / `after`** | shared `parameters` | **Run** | Event window derived from the run's `turn`. |
| `lastDecisionTurn` | shared `parameters` | **Shared** (persistent) | Must persist across strategist turns; chat never writes it. |
| `gameStates` (+ `_pendingRefresh`, `_pendingBriefings`) | shared `parameters` | **Shared** cache (by reference) | Expensive cache; both runs read/populate; dedup must span runs. |
| `workingMemory` | shared `parameters` | **Shared** | Strategist memory; diplomat reads. |
| `metadata`, `mode`, `playerID`, `gameID`, `syncSeed`, `_humanDecisionBus` | shared `parameters` | **Shared** (static/config) | Per-seat identity/config, not per-run. |
| `tools`, `mcpToolMap`, `modelOverrides`, `session`, telemetry | `context` | **Shared** (resources) | Long-lived; unchanged. |

### Correct turn for chats (Issue 2)

- **Read the current turn at game load.** The authoritative live turn is established at load — the session sets `this.turn` from `GameSwitched` ([strategist-session.ts:433](vox-agents/src/strategist/strategist-session.ts#L433)), so `session.getTurn()` is valid before any chat opens. Belt-and-suspenders: if `start()`/`recoverGame()` ([:90](vox-agents/src/strategist/strategist-session.ts#L90)/[:586](vox-agents/src/strategist/strategist-session.ts#L586)) can run before the first notification, set `session.turn` there from the game's reported turn so it is never undefined when a chat opens.
- A chat/diplomat `Run` seeds `turn` from `context.session?.getTurn()` and derives `before`/`after` from it — instead of inheriting the strategist's `-1`/stale cursor. `ensureGameState` then fetches at the live turn into the **shared** `gameStates` cache (dedup still spans both runs), and the diplomat's hint + context show the live turn.
- **⚠️ The strategist run keeps its own turn, unchanged.** The strategist works the turn from its notification/decision queue ([vox-player.ts:142-144](vox-agents/src/strategist/vox-player.ts#L142-L144)), which may *lag behind* the session's live turn (the game can advance while the strategist is still owed a decision). It must **not** be switched to `session.getTurn()` — that could skip an un-decided turn. Only chat runs adopt the live turn. This divergence is exactly why `turn` must be per-run: strategist and diplomat can correctly be on different turns simultaneously.

### Execution isolation (Issue 1)

- `execute()` creates a `Run` and wraps the body in `als.run(run, …)`. Readers resolve the current run via the ALS store instead of `context.currentInput`/`lastParameter`.
- **Explicitly handle the detached boundary:** the fire-and-forget analyst ([agent-tools.ts:77](vox-agents/src/utils/tools/agent-tools.ts#L77)) detaches the OTEL context but *not* ALS, so it would inherit the parent's store — it must start a fresh `als.run(new Run(...))`.
- `req.on('close')` aborts via the run's own abort token; the strategist and other chats keep running.
- The strategist's per-turn token delta reads from its `Run`'s sink ([vox-player.ts:148/250](vox-agents/src/strategist/vox-player.ts#L148)); the seat cumulative total is incremented per-run by **all** runs.

### Blast radius (readers to migrate)

`currentInput`: [close-conversation-tool.ts:42](vox-agents/src/envoy/close-conversation-tool.ts#L42), [negotiator.ts:190/400/412](vox-agents/src/envoy/negotiator.ts#L400). `lastParameter`: [agent.ts](vox-agents/src/web/routes/agent.ts) (`civIdentity`, `currentTurnOf`, `respondToHumanDeal`, `/message`, deal routes), [simple-tools.ts](vox-agents/src/utils/tools/simple-tools.ts), [mcp-tools.ts](vox-agents/src/utils/tools/mcp-tools.ts), [vox-player.ts:82](vox-agents/src/strategist/vox-player.ts#L82). `streamProgress`/`timeoutRefresh`: web + telepathist (`console.ts`, `phase/turn-preparation.ts`), [concurrency.ts:79/125](vox-agents/src/utils/models/concurrency.ts#L79). Tests: `tests/mock/context/vox-context-current-input.test.ts`, envoy + web-route mocks.

## Critical files

- [vox-agents/src/infra/vox-context.ts](vox-agents/src/infra/vox-context.ts) — split shared seat state vs. `Run`; ALS; `execute()`.
- [vox-agents/src/strategist/strategy-parameters.ts](vox-agents/src/strategist/strategy-parameters.ts) — composed parameters view; keep `gameStates` shared.
- [vox-agents/src/strategist/vox-player.ts](vox-agents/src/strategist/vox-player.ts) — strategist `Run` seeding (turn unchanged) + token deltas.
- [vox-agents/src/strategist/strategist-session.ts](vox-agents/src/strategist/strategist-session.ts) — ensure live turn is set at load.
- [vox-agents/src/web/routes/agent.ts](vox-agents/src/web/routes/agent.ts) — seed chat `Run` turn from `session.getTurn()`; per-run abort; `ensureGameState`.
- [vox-agents/src/utils/tools/agent-tools.ts](vox-agents/src/utils/tools/agent-tools.ts) — nested vs. fire-and-forget `als.run`.
- [vox-agents/src/envoy/close-conversation-tool.ts](vox-agents/src/envoy/close-conversation-tool.ts), [vox-agents/src/envoy/negotiator.ts](vox-agents/src/envoy/negotiator.ts) — read run from ALS.

## Test plan

- **Concurrency:** drive a strategist turn and a diplomat chat on the same seat simultaneously; assert each sees its own input/turn and neither's tokens leak into the other.
- **Turn correctness:** at fresh game load (strategist `turn` still `-1`), open a diplomat chat and assert the hint + game context use `session.getTurn()`, not `-1`; assert `gameStates` is populated at the live turn and shared with the strategist.
- **Turn divergence:** with the live turn ahead of the strategist's pending decision turn, assert the strategist still decides its own (lagging) turn and the diplomat speaks to the live turn.
- **Abort isolation:** disconnect one chat; the strategist and other chats keep running.
- **Nesting:** diplomat→negotiator and diplomat→analyst (fire-and-forget) resolve correctly under load.
- **Regression:** `vox-context-current-input.test.ts`, envoy/web-route tests stay green; run the root TypeScript test and build suites.

## Done when

A diplomat chat and a strategist turn run concurrently on one seat without corrupting each other's input, abort, or token accounting; a chat reports and reasons about the **live** turn (correct even at game load) while the strategist independently completes its own (possibly lagging) decision turn; and all existing diplomacy, deal, and strategist behavior continues to pass.
