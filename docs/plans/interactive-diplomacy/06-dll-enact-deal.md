# Stage 6 — civ5-dll + mcp-server: `EnactAgentDeal` (the only gameplay change)

> Part of the interactive-diplomacy plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

Flip on **real enactment**: an agreed deal — ordinary **trade items** and the **nine promises** — is enacted for real in the game, bypassing the AI's political refusal while honoring structural legality (specs §3, §4). This is the **only gameplay code change** in the feature and the last piece of human↔LLM Web v1. A new additive, `MOD_ACTIVE_DIPLOMACY`-gated DLL entrypoint does the work; `CvDealAI` valuation is left **completely untouched** and the normal in-game deal pathway **behaves exactly as before** (the shared legality/reason signature extensions are defaulted and preserve stock behavior).

## Approach: a new additive entrypoint, sibling of the existing accept path

The existing human-trade enactment path (`AreAllTradeItemsValid()` → `FinalizeDealValidAndAccepted` → `ActivateDeal`) does not call `CvDealAI` at all — acceptance is a parameter the caller passes in. The feature adds a sibling Lua-exposed function that builds the agreed `CvDeal`, validates it structurally **as human-to-human**, validates all promise commitments, and only then activates the deal with acceptance pre-decided and applies the promises. We **add** an entrypoint; we do not branch inside the existing ones.

## Work items

1. **`civ5-dll/.../Lua/CvLuaDeal.cpp`** — `lEnactAgentDeal`, registered in `PushMethods`, gated behind `MOD_ACTIVE_DIPLOMACY`:
   - builds the `CvDeal` of ordinary trade items via the existing `lAdd*Trade` constructors;
   - validates with `AreAllTradeItemsValid(bTreatAsHumanToHuman = true)` — **threading the stage-3 override through `AreAllTradeItemsValid`** (stage 3 added the override to `IsPossibleToTradeItem`; this stage adds the matching defaulted parameter to `AreAllTradeItemsValid`). Default-`false` preserves the stock path; passing `true` evaluates the structural guards in their most permissive form, so AI-only restrictions (one city per player, no peacetime selling of self-founded cities, the `DEALAI_DISABLE_CITY_TRADES` toggle, and other `!bHumanToHuman` gates) don't gate agent deals, while the always-on guards (ownership, quantity, capital, duplicate-luxury, banned luxuries, embassy-for-city, sapped/damaged cities) still apply (specs §4);
   - validates every promise commitment before any write, so a bad promise cannot leave behind already-activated trade items;
   - activates via `FinalizeDealValidAndAccepted` / `ActivateDeal` with acceptance pre-decided — **never** invoking `CvDealAI`.
2. **Promise commitments — same call** (`CvDiplomacyAI.*`): for the eight standing promises, call `SetXxxPromiseState(recipient, PROMISE_STATE_MADE)` + `SetXxxPromiseTurn`, preserving existing side-effects — Spy → `EvaluateSpiesAssignedToTargetPlayer`; No-Convert / No-Digging → `SetPlayerAskedNotToConvert` / `SetPlayerAskedNotToDig`. For **Coop War** (three-party), call `SetCoopWarState(ally, target, COOP_WAR_STATE_PREPARING)` instead of a promise-state setter. Because every promise writes state the game already persists, **no new save fields** are introduced, and honoring/expiry is governed by the game's existing `CvDiplomacyAI` timers and break-detection (e.g. a later DoW breaks the military promise).
3. **Light promise legality check in the entrypoint** (not via `IsPossibleToTradeItem`, since promises aren't `TradeableItems`): distinct living major civs; promiser/recipient match the two deal parties; not already `PROMISE_STATE_MADE` for that pair; Coop War needs a valid third-party target according to the existing cooperative-war state system.
4. **No enum/save change; version bump.** No `TradeableItems` addition, no serialization change, no new acceptability/valuation logic. The existing-function edits are defaulted legality/reason signature extensions (`IsPossibleToTradeItem`, `AreAllTradeItemsValid`, and the matched reason path from stage 3) — backward-compatible, stock behavior preserved. Bump the DLL version and rebuild (`scripts/release.py`, `CustomMods.h` `MOD_DLL_VERSION_NUMBER`).
5. **`mcp-server`** — an `inspect-deal`-adjacent **`enact-agent-deal`** tool (non-read-only, `ActionTool` + a `LuaFunction` wrapper) that first reduces the transcript to confirm the supplied proposal message is the current agreed deal, then calls `inspect-deal` fresh, then calls `EnactAgentDeal` with the trade items **and** the promise commitment list. Record the enactment in the replay/action log with the proposal message ID as an idempotency key, so a double-click or retry cannot enact the same accepted proposal twice. Register the factory in `tools/index.ts`. Wire the stage-4 Accept action and the stage-5 negotiator's accept path to it.

## Reuse

`AreAllTradeItemsValid()` (extended with the defaulted `bTreatAsHumanToHuman` override) / `FinalizeDealValidAndAccepted` / `ActivateDeal` and the existing `bHumanToHuman` classification in `CvDealClasses.cpp`; the `lAdd*Trade` constructors and `PushMethods` registration (`CvLuaDeal.cpp`); the eight `SetXxxPromiseState` / `SetXxxPromiseTurn` setters + their side-effects and `SetCoopWarState` / `COOP_WAR_STATE_PREPARING` (`CvDiplomacyAI.*`, `CvDiplomacyAIEnums.h`); `MOD_ACTIVE_DIPLOMACY` (`CustomMods.h`); the `ActionTool` + `LuaFunction` pattern and `tools/index.ts` (mcp-server).

## Verify

Via `lua-executor` and end to end through stages 2–5: enact a deal the **stock AI would refuse on political grounds** — items change hands for real. A structurally-illegal item is rejected with a reason (the always-on `IsPossibleToTradeItem` guards still apply). A bad promise in an otherwise valid item trade rejects before any trade item changes hands. A deal carrying a promise (and one carrying Coop War against a third party) writes real diplomacy state, and the promise thereafter **behaves like an in-game promise** — e.g. broken by a later declaration of war. Repeating the same accepted proposal does not enact it twice. The **normal in-game deal pathway and AI valuation behave exactly as before**; the agent path is a separate entrypoint with no `TradeableItems`/save-format change.

## Done when

Both sides agreeing in a Web conversation results in the deal being **enacted for real** — trade items and any of the nine promises — through the additive, `MOD_ACTIVE_DIPLOMACY`-gated entrypoint, with structurally-illegal items still rejected and the stock pathway untouched. **This completes human↔LLM Web v1** (specs § Success criteria).
