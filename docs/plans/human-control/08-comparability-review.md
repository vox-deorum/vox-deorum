# Stage 8 — Static code review for comparability

> Part of the human-control plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

Confirm by **static review of the code** that a human game lands in the analysis stack identically to an LLM game (spec §5). Live end-to-end game runs are done separately by a human and are not part of this plan.

## Review checklist

- **Same write path.** Human decisions go through the same action tools — and therefore the same `*Changes` knowledge tables, replay messages, and `VoxDeorumAction` events — as LLM decisions. No separate write path anywhere.
- **Decision cost.** Deliberation time is recorded where LLM token cost is recorded (turn-span attribute + accumulated per-player metadata), so the analysis stack sees a comparable per-decision cost field.
- **Pacing parity.** The human seat goes through the same `isScheduledDecision` / `shouldInterruptDecision` checks in `VoxPlayer` with no human-specific bypass — neither more nor fewer decision opportunities than an LLM under the same pacing config (spec §4).
- **Mixed-seat safety.** The decision bus is keyed by playerID and owned per session; LLM and stock-AI seats never touch it.
- **Crash recovery.** The recovery path cancels and re-requests a pending decision rather than dropping it; the panel re-receives the options event after a relaunch (spec §6).
- **Fairness by omission.** The panel renders only the human civ's own data; the observer UI is simply not loaded in human-control mode, so no other player's rationale can render (spec §3).

## Done when

Every checklist item is verified against the merged code, with findings (and any fixes) written down. The remaining validation — full human games, mixed human+LLM games — is run by a human per the success criteria in [specs.md](specs.md).
