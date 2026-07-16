# Stage 7.02: civ5-mod: vendored trade screen on mock data

> Part of the stage-7 sub-plan ([specs.md](specs.md); index [../07-ingame-panel.md](../07-ingame-panel.md)). Still UI-only: the screen is driven by a mock incoming `DealPayload` and a debug hook against real game state; its Propose/Counter/Accept flows end at stubbed emits. Server wiring is stage 04.

## Objective

Vendor the game's own trade screen into the mod and adapt it minimally: opened from our chat flow instead of the native diplo-AI flow, per-term legality and both-side value estimates computed **locally** with the same human-to-human semantics enactment uses, a **promises** category added, and the table serializable to `DealPayload` v1. Proven working in-game against mock data before any transport exists: this stage retires the three riskiest unknowns (instance definitions, popup layering, per-edit valuation cost) while iteration is cheapest.

## Work items

1. **Vendor + rename.** Copy `civ5-dll/(3a) VP - EUI Compatibility Files/LUA/TradeLogic.lua` → `civ5-mod/UI/VoxDeorumTradeLogic.lua` and `civ5-dll/(1) Community Patch/Core Files/Overrides/DiploTrade.xml` → `civ5-mod/UI/VoxDeorumDealScreen.xml`; add a thin `civ5-mod/UI/VoxDeorumDealScreen.lua` wrapper (`include("VoxDeorumTradeLogic")`, standalone context registration: the `SimpleDiploTrade.lua` shape). **Renaming is mandatory**: an `import="1"` file named `TradeLogic.lua` would VFS-override VP's include for the native screens. Copy the `Instance` definitions the trade logic needs (`CityInstance`, `PocketResource`, `PocketVote`, `TableStrategic`, `TableLuxury`, `TableVote`, `OtherPlayerEntry`, …) into our XML: under EUI they live in LeaderHeadRoot.xml, and carrying our own copies is safe in either layout. Register in `VoxDeorum.modinfo` (`InGameUIAddin`) + `update_md5.py`.

2. **Entry, exit, and draft ownership.** Replace `LeaderMessageHandler` and `OnOpenPlayerDealScreen` with `OnOpenVoxDeal(counterpartID, incomingDeal?, proposalMessageID?)`, raised by `LuaEvents.VoxDeorumOpenDealScreen`. Set `g_iUs = Game.GetActivePlayer()` and `g_iThem = counterpartID`. Keep ordinary terms in a plain Lua `draftItems` model and promises in `draftPromises`. These models are the source of truth. A `rebuildScratchDeal()` helper projects `draftItems` into `UI.GetScratchDeal()` before rendering, validation, valuation, or submission. Every pocket and table edit updates the draft first. This prevents `inspect-deal.lua` or another server call from destroying an open draft when it reuses the global scratch deal. Remove `UI.DoProposeDeal`, `UI.DoFinalizePlayerDeal`, `UI.DoDemand`, `UI.DoEqualizeDealWithHuman`, the demand and concession states, and every `Game.DoFromUIDiploEvent` call. Closing returns to the chat panel. Try `UIManager:QueuePopup` first, then plain `SetHide(false)` if needed (`civ5-mod/UI/VoxDeorumHumanPanel.lua:1496`).

3. **Incoming-proposal render.** Load `DealPayload.items` into `draftItems` and `promises` into `draftPromises`, then call `rebuildScratchDeal()` and the stock `DoClearTable()`/`DisplayDeal()` path. Port `resolveItem` and `durationFor` from `mcp-server/lua/inspect-deal.lua`, with cross-reference comments in both files. Map cities between `cityID` and plots with `Map.GetPlot(x,y):GetPlotCity()`.

4. **Local legality and values.** Before each legality or value pass, call `rebuildScratchDeal()` from the authoritative draft. Pad every `g_Deal:IsPossibleToTradeItem(...)` call site (about 30 in the vendored file) to the full argument list with `bTreatAsHumanToHuman = true` at **argument 9** (`civ5-dll/.../Lua/CvLuaDeal.cpp:151`; `inspect-deal.lua:141`). Items blocked only by AI politics remain enabled. Structurally illegal items remain blocked and show `GetReasonsItemUntradeable`. After each table change, sum `g_Deal:GetTradeItemValue(...)` per item into the two balance labels. The call returns `valueToGiver, valueToReceiver` (`CvLuaDeal.cpp:185`). Editing uses no bridge traffic. If valuation is slow, debounce the recompute as the Web does at 250 ms.

5. **Promises category.** Add pocket and table sections on both sides using the promise kinds from `mcp-server/src/utils/deal-metadata.ts` (`PROMISE_TYPES`). Read durations through the `Game.Get*PromiseDuration()` getters, guarded with `pcall` as in `inspect-deal.lua`. Coop War expands into locally computed eligible targets: living major civilizations met by both sides, accepted by `Player:IsValidCoopWarTarget` in both directions, and not already preparing. Promise terms are not `TradeableItems`; they live in `draftPromises` beside `draftItems` and render as table rows.

6. **Serialization and stub emits.** Propose and Counter serialize `draftItems` and `draftPromises` directly into `DealPayload` v1. Do not serialize the shared scratch deal. Run `rebuildScratchDeal()` immediately before submission so current legality and values are checked against the exact draft. Accept and Retract carry the mock `proposalMessageID`; Retract emits `reject`. All actions end at stubbed emits (print plus mock toast). Refuse an oversized payload with an on-screen reason. The screen never calls `Deal:Enact()` locally because enactment belongs to stage 04. Choose the response buttons from the opener's mode: incoming, own, view-only, or authoring.

7. **Debug hook.** Add a temporary developer keybind or FireTuner call that opens the screen against real game state. Support both a mock incoming `DealPayload` and an empty authoring flow so every path can be exercised without the chat panel.

### Screen layout (text mockup)

The vendored screen keeps the native trade screen's two-column pocket/table shape (the diff stays minimal); the additions are the two balance labels, the promises category, and the replaced button row. Left column = the counterpart, right column = the active player, exactly like the native screen.

```
╔════════════════════════════════════════════════════════════════════════════╗
║ [leader icon]  Negotiating with Napoleon: France          Turn 143   [X]   ║
╠═══════════════════════════════════╦════════════════════════════════════════╣
║        NAPOLEON OFFERS            ║             YOU OFFER                  ║
║  Balance for them:  +180 ▲        ║   Balance for you:  +65 ▲              ║  ← per-side totals summed
╟───────────────────────────────────╫────────────────────────────────────────╢    live from GetTradeItemValue
║  ON THE TABLE                     ║   ON THE TABLE                         ║
║   ▸ 6 Wine            (45t) [–]   ║    ▸ Open Borders     (45t) [–]        ║  ← table rows; [–] returns the
║   ▸ 120 Gold                [–]   ║    ▸ 4 Iron           (45t) [–]        ║    item to its pocket
║   ▸ Promise: No spying      [–]   ║                                        ║  ← promise rows live beside
╟───────────────────────────────────╫────────────────────────────────────────╢    g_Deal, rendered alike
║  AVAILABLE (pocket)               ║   AVAILABLE (pocket)                   ║
║   ▸ Gold / Gold per Turn          ║    ▸ Gold / Gold per Turn              ║  ← stock pocket categories,
║   ▸ Luxury Resources        ▼     ║    ▸ Luxury Resources          ▼       ║    expandable; every entry
║       Wine (6)  Silk (2)          ║        Ivory (3)                       ║    gated by IsPossibleToTrade-
║   ▸ Strategic Resources     ▼     ║    ▸ Strategic Resources       ▼       ║    Item(... h2h=true)
║       Horses (4)                  ║        Iron (4)  Coal (✗ embargo)     ║  ← structurally illegal: greyed
║   ▸ Cities                        ║    ▸ Cities                            ║    + GetReasonsItemUntradeable
║   ▸ Technologies                  ║    ▸ Technologies                      ║    tooltip; AI-politics-only
║   ▸ World Congress Votes          ║    ▸ World Congress Votes              ║    blocks show ENABLED (h2h)
║   ▸ Open Borders ✓ · Embassy ✓   ║    ▸ Defensive Pact · Research Agr.    ║  ← single-shot toggles
║   ▸ Third-Party Peace / War       ║    ▸ Third-Party Peace / War           ║
║   ▸ Promises                ▼     ║    ▸ Promises                  ▼       ║  ← NEW category: PROMISE_TYPES
║       No spying (30t)             ║        No settling near (50t)          ║    with durations; Coop War
║       Coop War vs…          ▼     ║        No spying (30t)                 ║    expands to eligible targets
║         Attila ✓  Gandhi ✗       ║                                        ║    (coopWarEligible port)
╠═══════════════════════════════════╩════════════════════════════════════════╣
║   Incoming proposal #482: respond:                                       ║  ← mode from how the chat
║        [ Accept ]        [ Counter ]        [ Reject ]        [ Back ]     ║    panel's card was opened:
║   Your own open proposal:                                                  ║    incoming open / own open /
║        [ Counter ]       [ Retract ]                          [ Back ]     ║    settled-or-superseded
║   Settled or superseded proposal (view-only):                              ║    (view-only) / empty-open
║                                                               [ Back ]     ║    (authoring)
║   Authoring mode:                                                          ║
║        [ Propose ]                                            [ Cancel ]   ║
╚════════════════════════════════════════════════════════════════════════════╝
```

The mock must exercise the full edit loop. Clicking a pocket entry updates the draft model, rebuilds the scratch deal, moves the row to the table, and recomputes both balance labels. The remove button performs the reverse operation. Greyed entries show their untradeable reason on hover. Promises use `draftPromises`, not `g_Deal`. All responses happen on this screen; chat cards only open it. Accept and Retract carry the proposal ID, and Retract emits `reject`. View-only mode disables editing. Every flow ends at a stubbed emit, and the oversized-deal guard refuses loudly.

## Reuse

The vendored `(3a) TradeLogic.lua` + CP `DiploTrade.xml` themselves (the point of this stage is to keep as much of them intact as possible: the diff should concentrate in entry/exit, the h2h arg pads, the balance labels, the promises section, and serialization); `mcp-server/lua/inspect-deal.lua` helper ports (`resolveItem`, `valueOf`, `durationFor`, `coopWarEligible`); `mcp-server/src/utils/deal-schema.ts` (DealPayload v1) and `deal-metadata.ts` (promise vocabulary); the stage-3/6 `CvLuaDeal` bindings.

## Verify

In a live game with the debug hook:

1. A mock incoming proposal renders correctly across categories (gold/GPT, resources, cities, techs, votes, toggles, third-party, promises), and an empty open works for authoring.
2. Legality is live and h2h-correct: an item blocked only by AI politics shows enabled; a structurally illegal one is blocked with a reason. Editing updates both balance labels. Bridge logs confirm **zero** traffic during editing.
3. The promises category lists the pinned kinds with durations; Coop War shows only eligible targets.
4. Propose and Counter print the expected `DealPayload` v1 from the independent draft model (items, promises, and durations); Accept prints the mock proposal ID. While a draft is open, invoke `inspect-deal` and confirm the visible terms and submitted payload remain unchanged. The oversized-deal guard refuses with an on-screen reason.
5. The native trade screen and leader flows are unchanged (rename discipline held); no `Lua.log` errors; note which popup-layering approach won.

## Done when

The full deal-editing experience: incoming render, legal-by-enactment-semantics pockets, live balances, promises: works in-game against mock data, and its outputs are exactly the `DealPayload` v1 objects stage 04 will put on the wire.
