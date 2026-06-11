# Human Control — Staged Implementation Plan

This folder holds the human-control condition: the specification ([specs.md](specs.md)) and this staged implementation plan. Each numbered file is a self-contained stage: objective, work items, what it reuses, and how to verify it. Implement in order — each stage is independently verifiable, and the panel stages (5–7) are gated by the approved mockup (stage 4).

The goal in one line: a person occupies a strategist seat — a `human-strategist` registered in the agent registry and assignable in `llmPlayers` like any other — and steers one civ through the *same* influence-level action space the LLM strategists use, landing in the same telemetry, replay, and `game_outcomes` databases so human and LLM games are analyzed by the same tools.

| Stage | Plan | Objective |
|---|---|---|
| 1 | [01-launcher.md](01-launcher.md) | Launcher human-control mode + stub `human-strategist` (launch, observe, auto-play with human tweaks). |
| 2 | [02-mcp-round-trip.md](02-mcp-round-trip.md) | mcp-server decision round-trip plumbing: inbound event, outbound `present-decision`, SSE heartbeat. |
| 3 | [03-decision-bus.md](03-decision-bus.md) | Flesh out `human-strategist` + per-session decision bus (panel still simulated). |
| 4 | [04-mockup.md](04-mockup.md) | Settle the panel UI as an HTML mockup; user approval gates the Civ work. |
| 5 | [05-panel-status-quo.md](05-panel-status-quo.md) | In-game panel v1: keep-status-quo + rationale + submit, end to end. |
| 6 | [06-panel-one-choice.md](06-panel-one-choice.md) | Panel v2: one real option category — spike on hijacking the native research/policy screens. |
| 7 | [07-panel-full-parity.md](07-panel-full-parity.md) | Panel v3: the rest of the action space, full LLM parity. |
| 8 | [08-comparability-review.md](08-comparability-review.md) | Static code review for comparability (live games are run by a human, outside this plan). |

Stages 1–3 build the full pipeline with the panel **simulated** via the `lua-executor` MCP tool (injecting a synthetic `Game.BroadcastEvent("HumanDecision", ...)`). Stages 5–7 replace the simulation with the real, incrementally built in-game panel.

## How it fits the existing code

- **`human-strategist` follows the `null-strategist` idiom.** `NullStrategist` (`vox-agents/src/strategist/agents/null-strategist.ts`) does all its work inside `getSystem()` via `context.callTool(...)` and then returns an empty string, which `VoxContext` treats as "no model call" — the LLM loop is skipped entirely. The human-strategist does the same: present the decision, block on the human, map the submission onto action tools, return `""`.
- **Options are already fetched before the strategist runs.** `VoxPlayer.execute` calls `ensureGameState` (which runs `get-options` through `refreshGameState` in `strategy-parameters.ts`) before `context.execute`, so the turn's `OptionsReport` is ready to hand to the panel — no extra fetch.
- **The game is already paused across the wait.** `VoxPlayer.execute` calls `pause-game` before, and `resume-game` after, the strategist runs. An unbounded `await` inside `getSystem` simply holds that pause; no new pause machinery.
- **The decision bridge** (the one genuinely new mechanism): a **per-session** decision bus — a map from playerID to a pending `{resolve, reject, requestedAt}` — **owned by the `StrategistSession` instance**, not a module-level global, so one vox-agents process could in principle run multiple games each with its own bus. The session threads its bus to each `VoxPlayer` (constructor argument) and on to the strategist via a non-serialized `parameters._humanDecisionBus` field (mirroring the existing `_pendingRefresh` internal-field convention in `strategy-parameters.ts`). The strategist awaits `bus.request(playerID)`; the session's notification handler resolves it when the `HumanDecision` event arrives.
- **The inbound decision path reuses the notification channel.** `Game.BroadcastEvent` → DLL → bridge → the MCP store's `handleGameEvent` → `sendNotification` → the vox-agents MCP client → the `StrategistSession` notification switch. The client notification schema is `.passthrough()` and `sendNotification` already spreads an extra-params object into the notification, so the human's choices ride the notification itself.
- **The outbound "present decision" path reuses the `LuaFunction` pattern** from `mcp-server/src/utils/lua/player-actions.ts`: a preregistered Lua function receiving JSON-serialized string arguments over the bridge batch queue (never inline-interpolated into a script), firing `LuaEvents.VoxDeorumHumanDecision(...)` into the panel.

### Deviation from the spec's "mcp-server nearly unchanged"

The bridge is genuinely unchanged. mcp-server needs a handful of small, localized additions — not just the whitelist entry the spec mentions (all consolidated into stage 2):

1. an **event schema** for `HumanDecision` — the store's `handleGameEvent` *drops* any event whose type isn't schema-registered, so without one the inbound `BroadcastEvent` is silently discarded;
2. the **whitelist entry** in `eventsForNotification`;
3. **payload forwarding** — the store's generic notification call doesn't pass the event payload, so the human event needs a small special case forwarding its data as the extra-params argument;
4. the **outbound `present-decision` tool** (LuaFunction-backed);
5. a **regular server-side heartbeat timer** so the SSE channel survives an unbounded human pause.

Everything else (action tools, archivist, telemetry, replayer, oracle, telepathist) is reused unchanged.

## Risks / watch-items

- **SSE liveness across an unbounded human pause.** Addressed by the always-on server-side heartbeat timer (stage 2); the interval must stay comfortably under the MCP client's 600-second body timeout.
- **Native-UI hijack feasibility (stage 6).** Whether the native research/policy screens can be driven for an autoplay-controlled civ is unproven — hence a spike with a custom-list fallback. If any self-rendered policy list survives, the display-name suffix (`" (Branch)"` / `" (Policy)"`) must be stripped before `set-policy`, as `null-strategist` does.
- **Schema gate drops un-modeled events.** Keep the `HumanDecision` schema permissive (required `PlayerID` and `Rationale` only) so the panel can evolve its payload without silent drops at validation.
- **`SetObserverUIOverridePlayer` ordering and seating.** Use the seating-mapped actual playerID and set it before `SetAIAutoPlay` — the visibility copy happens at autoplay activation. Re-issue after crash recovery (defensive; the override is serialized in saves). The DLL side is "verify, not build."
- **Loading foreign saves.** Because the visibility copy happens only at autoplay activation, human-control games must start fresh (`gameMode: 'start'`) or resume saves created by a human-control session. Loading a save where autoplay began without the override will not retroactively copy visibility. Crash recovery of a human game is unaffected.
- **Decision bus stays per-session and keyed by playerID** so mixed seats and (in principle) concurrent games stay isolated.

## Open items to settle during implementation

- **UI design (stage 4):** layout and interaction model, plus the native-vs-custom split per option category — approved via the HTML mockup before any Civ UI work.
- **Deliberation-time telemetry slot:** stage 3 records wall-clock deliberation both as a turn-span attribute and as accumulated per-player metadata, paralleling token usage; confirm which one the analysis stack reads as "decision cost."
