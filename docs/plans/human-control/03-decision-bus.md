# Stage 3 — vox-agents: flesh out `human-strategist` + per-session decision bus

> Part of the human-control plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

The full agent loop works with the panel still simulated: the strategist presents the decision, blocks on the per-session bus, and a `lua-executor`-injected submission routes through stage 2's notification to issue the action tools and resume the game.

## Work items

1. **`vox-agents/src/strategist/human-decision-bus.ts`** (new) — a `HumanDecisionBus` class (one instance per session) wrapping a map from playerID to a pending `{resolve, reject, requestedAt}`, with `request` / `resolve` / `cancel` / `isPending` methods.
2. **`vox-agents/src/strategist/agents/human-strategist.ts`** — flesh out the stage 1 stub. `getSystem(parameters, _input, context)` (the three-argument `VoxAgent` form):
   1. `ensureGameState` for the turn's state (normally already cached by `VoxPlayer`) — needed for the action-tool mapping below, not for presentation.
   2. Call `present-decision` with just the player and turn. The tool fetches the Flavor-mode `OptionsReport` itself server-side (stage 2, revised work item 6) — the strategist does **not** hand it the options, avoiding a round-trip of the report back across the MCP wire. Because the game is paused and `get-options` reads cached knowledge, the panel still receives the same snapshot the strategist's context was built from.
   3. Take the bus from `parameters._humanDecisionBus`, call `request(playerID)`, and await the human's submission.
   4. Compute wall-clock deliberation time from the request timestamp to the submission (spec §4 — no foreground/active-time accounting).
   5. Map the submission onto action tools, replicating the single rationale across every call (spec §2/§3). A `StatusQuo` submission calls `keep-status-quo` with the **human's actual rationale** — never the `"[skipped]"` sentinel, which tells that tool to refresh AI settings *without* recording a decision (it's what `VoxPlayer`'s paced-skip path sends); a human keep-status-quo IS a decision and must be recorded as one. Otherwise the human path runs in **Flavor mode** → `set-flavors` plus `set-research` / `set-policy` (and `set-persona` / `set-relationship` once those panel sections exist). (The legacy Strategy mode — `set-strategy` instead of `set-flavors` — is outdated and not supported for human decision-makers.) Each tool fires only when the panel actually submitted that field.
   6. Record deliberation time twice, paralleling token usage. **Note:** the turn span is *not* the active span inside `getSystem` — `VoxContext.execute` wraps the agent run in its own `agent.<name>` span — so reach the turn span the same way token cost does: stash the turn's deliberation in `parameters.workingMemory`, and have `VoxPlayer` set a `deliberation.ms` attribute in the same turn-span `setAttributes` block where it records `tokens.*` (absent/0 for non-human seats). Second slot: an accumulated per-player total written via `set-metadata` (key `deliberationMs-<playerID>`, overwritten with the running total each decision — idempotent and crash-safe), paralleling the `inputTokens-<playerID>` totals `VoxPlayer` writes. Keep the running total in `parameters.workingMemory` too.
   7. Return `""` to skip the LLM loop.
3. **`vox-agents/src/strategist/strategy-parameters.ts`** — add a non-serialized `_humanDecisionBus?` field to `StrategistParameters`, beside `_pendingRefresh`.
4. **`vox-agents/src/strategist/vox-player.ts`** — accept the session's bus as a constructor argument and expose it as `parameters._humanDecisionBus` (populated for every seat; only the human strategist reads it). Also add the `deliberation.ms` turn-span attribute next to the existing `tokens.*` attributes (see work item 2.6).
5. **`vox-agents/src/strategist/strategist-session.ts`**:
   - construct one `HumanDecisionBus` per session;
   - pass it into each `new VoxPlayer(...)` in `handleGameSwitched`;
   - add a `HumanDecision` case to the notification switch that resolves the bus for the notifying player with the notification payload;
   - cancel pending bus requests from the shutdown/abort paths so a pending wait rejects cleanly — `VoxPlayer`'s per-turn error handling catches it and still resumes the game.

## Crash recovery (spec §6)

On a crash, the relaunch path (`handleGameExit` → `handleGameSwitched`) aborts and recreates all VoxPlayers, which cancels the old bus wait; the fresh human-strategist run re-presents the decision, and the panel re-receives the options LuaEvent. `cancel` must clear the pending entry so the new `request` isn't shadowed by the old one.

## Verify (headless, panel simulated)

With a session running: the strategist logs that it is presenting a decision and blocks (no turn advance). A synthetic `HumanDecision` injected via `lua-executor` — once with `StatusQuo`, once with a full sample decision — routes to the right action tools (replay messages appear), the game resumes, and deliberation time is recorded in both slots. Kill the game mid-wait: the session recovers and the decision is re-presented.

## Done when

A complete decision round-trip works end to end with synthetic submissions, including keep-status-quo, a full decision, deliberation-time recording, and crash recovery mid-wait.
