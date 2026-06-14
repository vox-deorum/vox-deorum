# Stage 9 — Static additivity / comparability review

> Part of the interactive-diplomacy plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

Confirm by **static review of the merged code** that the feature is additive apart from backward-compatible legality/reason signature extensions (the defaulted `bTreatAsHumanToHuman` override path) — the normal in-game deal pathway and the `CvDealAI` valuation behave exactly as before, and the new agent path honors the rule boundary in specs §4. Live end-to-end play (full human↔LLM games) is run separately by a human per the [specs.md](specs.md) success criteria and is not part of this review.

## Review checklist

- **Additive entrypoint only.** `EnactAgentDeal` is a new sibling of the accept path; `FinalizeDealValidAndAccepted` / `ActivateDeal` and the entire `CvDealAI` valuation are **not branched or modified**. The normal in-game deal screen is untouched.
- **The shared legality/reason edits are backward-compatible.** `IsPossibleToTradeItem` (stage 3) and `AreAllTradeItemsValid` (stage 6) each gain a single *defaulted* `bTreatAsHumanToHuman` parameter, and the inspection reason path uses the same semantics. Confirm: (a) the default value reproduces the prior computed `bHumanToHuman` by OR-ing in only the explicit override, so every stock caller that passes nothing behaves identically; (b) no other stock-path logic in those functions is changed; (c) the only callers passing `true` are the agent inspection wrapper and `EnactAgentDeal`. This is the main spot to keep merge-aware against upstream Vox Populi.
- **Rule boundary honored.** Everything in `CvDeal::IsPossibleToTradeItem` is honored (always-on structural guards still apply); everything in `CvDealAI` is bypassed *for acceptance* on the agent path, but read **read-only** to produce the value estimates surfaced to agents. The valuation-layer anti-exploit guards (last strategic resource, last luxury while unhappy) are bypassed by design.
- **No enum/save change.** No `TradeableItems` value added; no new save fields; promises write only state the game already persists (`SetXxxPromiseState`/`SetXxxPromiseTurn`, `SetCoopWarState`); no new `IsXxxAcceptable`/valuation logic (the `bTreatAsHumanToHuman` override gates *existing* checks, it does not add a check) — DLL stays merge-compatible with upstream Vox Populi. The whole entrypoint is gated behind `MOD_ACTIVE_DIPLOMACY`.
- **Promise behavior parity.** An enacted promise is governed thereafter by the game's existing `CvDiplomacyAI` timers and break-detection — not by any deal-item duration — exactly as a promise made through normal diplomacy.
- **Durable transcripts, live deal checks.** Conversation transcripts persist in the mcp-server (one conversation per player pair ordered by `playerID`, no thread/status table) and survive a restart; each message sets both participant visibility flags; the Web reads them **through vox-agents** (no direct Web→mcp channel); deal proposal/counter messages store proposed terms in `Payload.Deal` and optional `Payload.Value1` / `Payload.Value2` snapshots, accept/reject messages reference the proposal ID, and no message stores legality or enacted state.
- **Agreement and enactment are idempotent.** The transcript reducer identifies the current agreed proposal without a status column. `enact-agent-deal` confirms the proposal is still current, re-inspects it against live game state, validates all trade and promise terms before writing, and records the proposal message ID in the action/replay log to prevent double-enactment.
- **Per-seat agent resolution.** A conversation against an LLM civ resolves **that target seat's** configured diplomat/negotiator (and model) from the seat config, not a client-supplied agent name; each LLM seat can use different diplomat/negotiator agents.
- **Estimates never gate enactment.** Per-term value/agreeability estimates are advisory only on the agent path; acceptance is decided by the negotiation, and the game never refuses a deal on valuation grounds for an agent deal.

## Verify

Each checklist item is verified against the merged code, with findings (and any fixes) written into this file — mirroring human-control's stage 8 review.

## Done when

Every checklist item is confirmed against merged code with written findings; the remaining validation — full human↔LLM games and, in later phases, LLM↔LLM games — is run by a human per the success criteria in [specs.md](specs.md).
