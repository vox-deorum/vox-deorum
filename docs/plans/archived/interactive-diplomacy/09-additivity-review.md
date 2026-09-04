# Stage 9 — Static additivity / comparability review

> Part of the interactive-diplomacy plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

Confirm by **static review of the merged code** that the feature is additive apart from backward-compatible legality/reason signature extensions (the defaulted `bTreatAsHumanToHuman` override path) — the normal in-game deal pathway and the `CvDealAI` valuation behave exactly as before, and the new agent path honors the rule boundary in specs §4. Live end-to-end play (full human↔LLM games) is run separately by a human per the [specs.md](specs.md) success criteria and is not part of this review.

## Review checklist

- **Additive surface only.** The enactment bindings (`Deal:Enact`, `Player:SetPromise`) are thin new registrations; the finalize chain (`FinalizeMPDeal` / `FinalizeDealValidAndAccepted` / `ActivateDeal`) and the `Add*` constructors are extended **only** by defaulted `bTreatAsHumanToHuman` parameters, and the entire `CvDealAI` valuation is **not branched or modified**. The normal in-game deal screen is untouched.
- **The shared legality/reason edits are backward-compatible.** `IsPossibleToTradeItem` (stage 3), and `AreAllTradeItemsValid`, the 17 `Add*` constructors, and the `FinalizeMPDeal` → `FinalizeDealValidAndAccepted` → `ActivateDeal` chain (stage 6) each gain a single *defaulted* `bTreatAsHumanToHuman` parameter, and the inspection reason path uses the same semantics. Confirm: (a) the default value reproduces the prior computed `bHumanToHuman` by OR-ing in only the explicit override, so every stock caller that passes nothing behaves identically; (b) no other stock-path logic in those functions is changed — in `ActivateDeal` the override feeds only the peace-surrender assignment, never the observer/debug notification gates; (c) the only callers passing `true` are the agent inspection wrapper and the enact-mode path (`Deal:Enact` and its override-aware `Add*` construction). This is the main spot to keep merge-aware against upstream Vox Populi.
- **Rule boundary honored.** Everything in `CvDeal::IsPossibleToTradeItem` is honored (always-on structural guards still apply); everything in `CvDealAI` is bypassed *for acceptance* on the agent path, but read **read-only** to produce the value estimates surfaced to agents. The valuation-layer anti-exploit guards (last strategic resource, last luxury while unhappy) are bypassed by design.
- **No enum/save change.** No `TradeableItems` value added; no new save fields; promises write only state the game already persists (`SetXxxPromiseState` — which stamp their own turn — and `SetCoopWarState`); no new `IsXxxAcceptable`/valuation logic (the `bTreatAsHumanToHuman` override gates *existing* checks, it does not add a check) — DLL stays merge-compatible with upstream Vox Populi. The finalize chain lives in the `MOD_ACTIVE_DIPLOMACY` region; the new bindings are plain additive registrations (the stage-3/4 convention).
- **Promise behavior parity.** An enacted promise is governed thereafter by the game's existing `CvDiplomacyAI` timers and break-detection — not by any deal-item duration — exactly as a promise made through normal diplomacy.
- **Durable transcripts, live deal checks.** Conversation transcripts persist in the mcp-server (one conversation per player pair ordered by `playerID`, no thread/status table) and survive a restart; transcript order is append `ID`; each message sets both participant visibility flags; the Web reads them **through vox-agents** (no direct Web→mcp channel); deal proposal/counter messages store proposed terms in `Payload.Deal` and optional `Payload.Value1` / `Payload.Value2` snapshots, accept/reject/enacted messages reference the proposal ID, and no message stores legality or live DLL state.
- **Agreement and enactment are idempotent, without a status column.** The transcript reducer identifies the current agreed proposal; the caller passes that proposal's deal object and message ID. `enact-agent-deal` enforces single-enactment by checking for a prior `deal-enacted` on the proposal ID, validates and enacts in one synchronous Lua invocation via the stateless DLL bindings (`Deal:Enact` + `Player:SetPromise`), and records `deal-enacted` on success. The `deal-enacted` message is the idempotency key — no status column, no action/replay-log dependency.
- **Per-seat agent defaults and override.** A conversation against an LLM civ resolves **that target seat's** configured diplomat/negotiator (and model) from the seat config as the displayed/default choice; the local Web debug surface may override the voicing agent; each LLM seat can use different diplomat/negotiator agents.
- **Estimates never gate enactment.** Per-term value/agreeability estimates are advisory only on the agent path; acceptance is decided by the negotiation, and the game never refuses a deal on valuation grounds for an agent deal.

## Verify

Each checklist item is verified against the merged code, with findings (and any fixes) written into this file — mirroring human-control's stage 8 review.

## Done when

Every checklist item is confirmed against merged code with written findings; the remaining validation — full human↔LLM games and, in later phases, LLM↔LLM games — is run by a human per the success criteria in [specs.md](specs.md).
