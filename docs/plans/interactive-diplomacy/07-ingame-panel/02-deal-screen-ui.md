# Stage 7.02 — civ5-mod: vendored trade screen on mock data

> Part of the stage-7 sub-plan ([specs.md](specs.md); index [../07-ingame-panel.md](../07-ingame-panel.md)). Still UI-only: the screen is driven by a mock incoming `DealPayload` and a debug hook against real game state; its Propose/Counter/Accept flows end at stubbed emits. Server wiring is stage 04.

## Objective

Vendor the game's own trade screen into the mod and adapt it minimally: opened from our chat flow instead of the native diplo-AI flow, per-term legality and both-side value estimates computed **locally** with the same human-to-human semantics enactment uses, a **promises** category added, and the table serializable to `DealPayload` v1. Proven working in-game against mock data before any transport exists — this stage retires the three riskiest unknowns (instance definitions, popup layering, per-edit valuation cost) while iteration is cheapest.

## Work items

1. **Vendor + rename.** Copy `civ5-dll/(3a) VP - EUI Compatibility Files/LUA/TradeLogic.lua` → `civ5-mod/UI/VoxDeorumTradeLogic.lua` and `civ5-dll/(1) Community Patch/Core Files/Overrides/DiploTrade.xml` → `civ5-mod/UI/VoxDeorumDealScreen.xml`; add a thin `civ5-mod/UI/VoxDeorumDealScreen.lua` wrapper (`include("VoxDeorumTradeLogic")`, standalone context registration — the `SimpleDiploTrade.lua` shape). **Renaming is mandatory**: an `import="1"` file named `TradeLogic.lua` would VFS-override VP's include for the native screens. Copy the `Instance` definitions the trade logic needs (`CityInstance`, `PocketResource`, `PocketVote`, `TableStrategic`, `TableLuxury`, `TableVote`, `OtherPlayerEntry`, …) into our XML — under EUI they live in LeaderHeadRoot.xml, and carrying our own copies is safe in either layout. Register in `VoxDeorum.modinfo` (`InGameUIAddin`) + `update_md5.py`.

2. **Entry and exit.** Replace `LeaderMessageHandler`/`OnOpenPlayerDealScreen` with `OnOpenVoxDeal(counterpartID, incomingDeal?, proposalMessageID?)` raised by `LuaEvents.VoxDeorumOpenDealScreen`: set `g_iUs = Game.GetActivePlayer()`, `g_iThem = counterpartID`, clear and rebuild the scratch deal (`UI.GetScratchDeal()`), then the stock `DoClearTable()`/`DisplayDeal()` render. Delete the native proposal plumbing — `UI.DoProposeDeal` / `UI.DoFinalizePlayerDeal` / `UI.DoDemand` / `UI.DoEqualizeDealWithHuman`, the demand/concession/"what do you want" states, and every `Game.DoFromUIDiploEvent` call. Closing returns to the chat panel. Settle popup layering here: try `UIManager:QueuePopup` first, fall back to plain `SetHide(false)` layering (the HumanPanel deliberately avoids the popup stack — `civ5-mod/UI/VoxDeorumHumanPanel.lua:1496` explains why).

3. **Incoming-proposal render.** Build `g_Deal` from `DealPayload.items` using the h2h-aware `Add*` constructors — port `resolveItem` (and `durationFor`) from `mcp-server/lua/inspect-deal.lua`, cross-reference comments both ways. Load `promises` into the promise model (item 5). Cities map `cityID` ↔ plot via `Map.GetPlot(x,y):GetPlotCity()`.

4. **Local legality and values.** Pad every `g_Deal:IsPossibleToTradeItem(...)` call site (~30, throughout the vendored file) to the full arg list with `bTreatAsHumanToHuman = true` at **arg 9** (`civ5-dll/.../Lua/CvLuaDeal.cpp:151`; `inspect-deal.lua:141` shows the exact arg shape) so pocket enable/disable matches enactment semantics — an item the AI would politically refuse shows enabled; a structurally illegal one stays blocked with its `GetReasonsItemUntradeable` reason. On every table change recompute both sides' totals by summing `g_Deal:GetTradeItemValue(...)` per item (returns `valueToGiver, valueToReceiver` — `CvLuaDeal.cpp:185`) into two balance labels, mirroring the Web board's balance. All local calls — zero bridge traffic while editing. If per-edit valuation feels laggy, debounce to table-change events (the Web debounces its inspect at 250 ms for the same reason).

5. **Promises category.** New pocket/table sections on both sides listing the promise kinds from `mcp-server/src/utils/deal-metadata.ts` (`PROMISE_TYPES`), durations via the `Game.Get*PromiseDuration()` getters (pcall-guarded, as `inspect-deal.lua` does). Coop War expands into eligible targets computed locally (port `coopWarEligible`: both-met living majors, `Player:IsValidCoopWarTarget` both ways, not already preparing). Promise terms are not `TradeableItems` — they live in a plain Lua table beside `g_Deal` and render as table rows.

6. **Serialization + stub emits.** Propose/Counter serialize the table state — `g_Deal:ResetIterator()` / `GetNextItem()` (the 8-tuple; enum → `itemType` string) plus the promise table — into a `DealPayload` v1; Accept and Retract carry the mock `proposalMessageID` (Retract emits the reject action). All end at **stubbed emits** (print + mock toast). Include the coarse Lua-side length check with an on-screen refusal reason (specs size rules). The screen never calls `Deal:Enact()` locally — enactment is server-side only (stage 04). The response-mode button row (incoming / own / view-only / authoring) is chosen by the opener's arguments — see the mockup.

7. **Debug hook.** A temporary way to open the screen in-game with a mock incoming `DealPayload` (and empty, for the propose flow) against real game state — e.g. a dev keybind or FireTuner call — so every flow is exercisable without the chat panel.

### Screen layout (text mockup)

The vendored screen keeps the native trade screen's two-column pocket/table shape (the diff stays minimal); the additions are the two balance labels, the promises category, and the replaced button row. Left column = the counterpart, right column = the active player, exactly like the native screen.

```
╔══════════════════════════════════════════════════════════════════════════╗
║ [leader icon]  Negotiating with Napoleon — France          Turn 143   [X] ║
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
║       Horses (4)                  ║        Iron (4)  Coal (✗ embargo)      ║  ← structurally illegal: greyed
║   ▸ Cities                        ║    ▸ Cities                            ║    + GetReasonsItemUntradeable
║   ▸ Technologies                  ║    ▸ Technologies                      ║    tooltip; AI-politics-only
║   ▸ World Congress Votes          ║    ▸ World Congress Votes              ║    blocks show ENABLED (h2h)
║   ▸ Open Borders ✓ · Embassy ✓    ║    ▸ Defensive Pact · Research Agr.    ║  ← single-shot toggles
║   ▸ Third-Party Peace / War       ║    ▸ Third-Party Peace / War           ║
║   ▸ Promises                ▼     ║    ▸ Promises                  ▼       ║  ← NEW category: PROMISE_TYPES
║       No spying (30t)             ║        No settling near (50t)          ║    with durations; Coop War
║       Coop War vs…          ▼     ║        No spying (30t)                 ║    expands to eligible targets
║         Attila ✓  Gandhi ✗        ║                                        ║    (coopWarEligible port)
╠═══════════════════════════════════╩════════════════════════════════════════╣
║   Incoming proposal #482 — respond:                                        ║  ← mode from how the chat
║        [ Accept ]        [ Counter ]        [ Reject ]        [ Back ]     ║    panel's card was opened:
║   — your own open proposal: —                                              ║    incoming open / own open /
║        [ Counter ]       [ Retract ]                          [ Back ]     ║    settled-or-superseded
║   — settled or superseded proposal (view-only): —                          ║    (view-only) / empty-open
║                                                               [ Back ]     ║    (authoring)
║   — or authoring mode: —                                                   ║
║        [ Propose ]                                            [ Cancel ]   ║
╚════════════════════════════════════════════════════════════════════════════╝
```

Interaction notes the mock must exercise: clicking a pocket entry moves it to that side's table (and back via `[–]`), recomputing both balance labels on every change; a greyed pocket entry shows its untradeable reason on hover; the promises pocket behaves like any other category but writes to the promise table, not `g_Deal`; the button row is mode-dependent as annotated — **all deal responses happen on this screen** (the chat panel's cards only open it): Accept and Retract carry the proposal id (Retract emits the reject action), view-only mode locks editing; all flows end at this stage's stubbed emits, with the oversized-deal guard refusing loudly.

## Reuse

The vendored `(3a) TradeLogic.lua` + CP `DiploTrade.xml` themselves (the point of this stage is to keep as much of them intact as possible — the diff should concentrate in entry/exit, the h2h arg pads, the balance labels, the promises section, and serialization); `mcp-server/lua/inspect-deal.lua` helper ports (`resolveItem`, `valueOf`, `durationFor`, `coopWarEligible`); `mcp-server/src/utils/deal-schema.ts` (DealPayload v1) and `deal-metadata.ts` (promise vocabulary); the stage-3/6 `CvLuaDeal` bindings.

## Verify

In a live game with the debug hook:

1. A mock incoming proposal renders correctly across categories (gold/GPT, resources, cities, techs, votes, toggles, third-party, promises), and an empty open works for authoring.
2. Legality is live and h2h-correct: an item blocked only by AI politics shows enabled; a structurally illegal one is blocked with a reason. Editing updates both balance labels. Bridge logs confirm **zero** traffic during editing.
3. The promises category lists the pinned kinds with durations; Coop War shows only eligible targets.
4. Propose/Counter/Accept each print the expected `DealPayload` v1 (items + promises + durations; accept with the mock proposal id); the oversized-deal guard refuses with an on-screen reason.
5. The native trade screen and leader flows are unchanged (rename discipline held); no `Lua.log` errors; note which popup-layering approach won.

## Done when

The full deal-editing experience — incoming render, legal-by-enactment-semantics pockets, live balances, promises — works in-game against mock data, and its outputs are exactly the `DealPayload` v1 objects stage 04 will put on the wire.
