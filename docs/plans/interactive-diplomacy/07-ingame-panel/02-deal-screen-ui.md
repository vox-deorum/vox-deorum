# Stage 7.02: civ5-mod: native trade screen reused on mock data

> Part of the stage-7 sub-plan ([specs.md](specs.md); index [../07-ingame-panel.md](../07-ingame-panel.md)). Still UI-only: the screen is driven by a mock incoming `DealPayload` and a debug hook against real game state; its Propose/Counter/Accept flows end at stubbed emits. Server wiring is stage 04.

## Objective

Reuse the game's own VP EUI trade screen with the repo's reuse policy — **include the EUI Lua untouched, put all our logic alongside in a wrapper, copy only the XML with minimal changes** — opened from our chat flow instead of the native diplo-AI flow. Per-term legality gets the human-to-human semantics enactment uses via a scratch-deal proxy; the native "Deal Value for Them" bar stays exactly as VP ships it; a **promises** category is added; the table serializes to `DealPayload` v1. Proven working in-game against mock data before any transport exists. This stage retires the riskiest unknowns while iteration is cheapest: the two override seams (is the context's `UI` table writable? does `RegisterCallback` re-registration replace the native handler?), the synthetic `LeaderMessageHandler` entry, and popup layering above the chat panel.

## Work items

1. **Files + registration (zero-copy Lua).** `civ5-mod/UI/VoxDeorumDealScreen.xml` = copy of `civ5-dll/(1) Community Patch/Core Files/Overrides/DiploTrade.xml` (324 lines, self-contained: all instance templates — `CityInstance`, `PocketResource`, `PocketTechnology`, `PocketVote`, `TableStrategic`, `TableLuxury`, `TableTechnology`, `TableVote`, `OtherPlayerEntry` — are defined in it at lines 7–66; nothing comes from LeaderHeadRoot.xml). Minimal additions only: promise pocket buttons + sub-stacks and table stacks on both sides, up to two extra buttons in the bottom stack for three-action response modes, and an attribution header comment. `civ5-mod/UI/VoxDeorumDealScreen.lua` = our wrapper, modeled on the native 50-line `civ5-dll/UI_bc1/Improvements/DiploTrade.lua`; it does `include("TradeLogic")`, which the VFS resolves to VP's `(3a) VP - EUI Compatibility Files/LUA/TradeLogic.lua` **without copying or renaming anything** — we ship no file named `TradeLogic.lua`, so the VFS-override hazard is avoided entirely rather than managed. Register the XML as `InGameUIAddin` in `VoxDeorum.modinfo`, add the `<File>` rows by hand (`update_md5.py` only refreshes hashes of listed files), then run `civ5-mod/update_md5.py`.

2. **The two override seams (probe these first — they are the stage's riskiest unknowns).**
   - *Scratch-deal proxy (h2h legality + clobber guard).* Before the include, replace `UI.GetScratchDeal` in our context with a function returning a proxy that forwards every method to the real scratch deal, padding `IsPossibleToTradeItem` and `GetReasonsItemUntradeable` to the full argument list with `bTreatAsHumanToHuman = true` at **argument 9** (`civ5-dll/.../Lua/CvLuaDeal.cpp:151`/`:169`; the `inspect-deal.lua:141` convention). TradeLogic captures `local g_Deal = UI.GetScratchDeal()` at line 47 during the include, so all 29 in-file legality call sites get h2h semantics with zero file edits. Items blocked only by AI politics show enabled; structurally illegal items stay blocked with `GetReasonsItemUntradeable` tooltips.
   - *Global-function wraps.* TradeLogic's functions are globals resolved at call time. After the include, wrap `DoUpdateButtons`, `DisplayDeal`, `DoClearTable` (and `ResizeStacks` if the promise stacks need it): call the native body first, then our additions. Internal calls from TradeLogic's own handlers route through the wraps too.
   - **Fallback**, only if a seam fails in-game (e.g. the `UI` table is not writable): copy the file as `civ5-mod/UI/VoxDeorumTradeLogic.lua` with *only* the edits that seam needed (the h2h arg pads / hook points), keep everything else in the wrapper unchanged, and keep the rename discipline (never `TradeLogic.lua`).

3. **Entry, exit, and unwiring.** The wrapper wires only what we need. It does **not** register `Events.AILeaderMessage` (TradeLogic has it commented out at :409; the native wrapper adds it — we don't), does not wire the five What*/equalize buttons (hidden by the native AI branch of `DoUpdateButtons` anyway), and calls `Events.ClearDiplomacyTradeTable.Remove(DoClearDeal)` after the include so native table-clear events can't disturb our context. Entry: `LuaEvents.VoxDeorumOpenDealScreen(counterpartID, incomingDeal?, proposalMessageID?)` (already emitted by `VoxDeorumDiploPanel.lua:278`/`:781`) → `OnOpenVoxDeal` calls the native global `LeaderMessageHandler(counterpartID, DiploUIStateTypes.DIPLO_UI_STATE_TRADE, speechText, 0, -1)`: it sets every file-local identity (`g_iUs` from `Game.GetActivePlayer()` — stage 04 swaps this to the effective seat by overriding `Game.GetActivePlayer` in our context pre-include, another alongside-not-inside seam), queues the popup at `PopupPriority.LeaderTrade`, sets the scratch from/to, seeds the speech bubble (`NameText`/`DiscussionText` — pass the incoming `DealPayload.message`, or a stock prompt when authoring), and runs the native `DoClearTable`/`DisplayDeal`/`DoUpdateButtons` path including the deal-value bar. Never use the PVP path `OnOpenPlayerDealScreen`: with `g_bPVPTrade = true`, `DoUpdateButtons` dereferences `ModifyButton`/`Pockets`/`ModificationBlock`/`MainStack`/`MainGrid` un-guarded (they exist only in SimpleDiploTrade.xml) and the value bar is skipped. For **view-only** mode reuse the native `OpenDealReview` (TradeLogic:487; `g_bTradeReview = true` engages the table covers) after rebuilding the scratch from the payload. Exit: re-register `CancelButton` and install our own ESC input handler; closing clears the draft + scratch and dequeues back to the chat panel. The native `OnBack`/`InputHandler` must never run — in AI-trade state `OnBack` calls `Players[g_iThem]:DoTradeScreenClosed`, `UI.SetOfferTradeRepeatCount(0)`, and `UI.RequestLeaveLeader()` (TradeLogic:564–608). Likewise re-register `ProposeButton` so native `OnPropose` (`UI.DoProposeDeal`) is unreachable. Popup layering above the chat panel (itself queued at `PopupPriority.LeaderTrade`, `VoxDeorumDiploPanel.lua:662`) is a probe item; the fallback is the panel's own `demoteToStatic` idiom (`:688`), and per the `VoxDeorumHumanPanel.lua:1496` lesson the context must never sit hidden in the popup queue.

4. **Draft ownership and two-way sync.** Keep ordinary terms in a plain Lua `draftItems` model and promises in `draftPromises` — the source of truth for serialization and for surviving scratch-deal clobbers (`inspect-deal` reuses the one global scratch deal). Because the untouched native handlers edit `g_Deal` directly, sync is event-driven rather than draft-first:
   - *scratch → draft* after every native edit: the `DoUpdateButtons` wrap (which runs after each `DoUIDealChangedByHuman`) re-derives `draftItems` from the scratch deal via `ResetIterator`/`GetNextItem`.
   - *draft → scratch* (`rebuildScratchDeal()`, built on the `resolveItem` add-closures) at open, when loading an incoming `DealPayload`, before the final legality pass, and before serialization.
   - The proxy doubles as the **clobber guard**: while the screen is visible, if a server call replaced the scratch contents out from under us, re-project the draft before forwarding the next call.
   Port `resolveItem` and `durationFor` from `mcp-server/lua/inspect-deal.lua` with cross-reference comments in both files; map cities between `cityID` and plots via `Players[...]:GetCityByID(...):GetX()/GetY()`.

5. **Deal value: native, untouched.** Keep the `PeaceDeal` bar exactly as VP ships it — `PeaceValue`/`PeaceMax` written by `DoUpdateButtons` from `g_pThem:GetTotalValueToMeNormal(g_Deal)` (and the war/surrender variants), with the Acceptable / Impossible / Embargo texts. No per-item `GetTradeItemValue` sums, no new balance labels, no debounce: the per-edit valuation risk is retired by not adding per-edit valuation. (Decision recorded: native single-sided game-AI valuation was chosen over Web-consistent per-item h2h sums.)

6. **Promises category.** Promise pocket buttons + table rows on both sides live in our XML copy and are driven entirely by the wrapper, using the promise kinds from `mcp-server/src/utils/deal-metadata.ts` (`PROMISE_TYPES`), durations through the `Game.Get*PromiseDuration()` getters `pcall`-guarded as in `inspect-deal.lua`, and Coop War expanding into locally computed eligible targets (living majors met by both sides, `Player:IsValidCoopWarTarget` in both directions, not already preparing — the `coopWarEligible` port). Promise terms are not `TradeableItems`: they live in `draftPromises` beside `draftItems`, never in `g_Deal`, and render as table rows from the `DisplayDeal` wrap. Reuse the native `SubStackHandler` expand/collapse idiom for the promises pocket (own registration on our controls).

7. **Mode buttons, serialization, stub emits.** After the native `DoUpdateButtons` body runs (keeping the value bar live), the wrap owns the bottom row: hide the What*/Denounce buttons and apply the opener's mode — **incoming** (Accept / Counter / Reject), **own** open (Counter / Retract), **view-only** (Back), **authoring** (Propose / Cancel). Reuse `ProposeButton` and `CancelButton`; the extra XML buttons cover three-action modes. Propose and Counter serialize `draftItems` + `draftPromises` directly into `DealPayload` v1 (`mcp-server/src/utils/deal-schema.ts`) — never the scratch deal. Immediately before submission run `rebuildScratchDeal()` plus the same h2h legality and promise checks used while editing; refuse locally invalid or oversized payloads with an on-screen reason. Accept and Retract carry the mock `proposalMessageID`; Retract emits `reject`. All actions end at stubbed emits (print + mock toast). The screen never calls `Deal:Enact()` — enactment is stage 04.

8. **Debug hook.** A temporary developer keybind or FireTuner call that opens the screen against real game state, supporting both a mock incoming `DealPayload` and an empty authoring flow, so every path can be exercised without the chat panel.

### Screen layout (native shape, text mockup)

The screen *is* the native VP EUI trade screen (see the reference screenshot): speech bubble + deal-value strip on top, the counterpart's pocket on the left edge, ours on the right edge, the two offer tables in the center, the button row at the bottom. Our diff adds only the promises category and the mode-dependent button row.

```
╔══════════════════════════════════════════════════════════════════════════════╗
║ (animated leader scene stays up behind when opened over it)                   ║
║   ╭─ Gajah Mada says: ────────────────────────────╮                           ║
║   │ <DealPayload.message | stock prompt>          │  ← native LeaderSpeech    ║
║   ╰───────────────────────────────────────────────╯    (NameText/Discussion)  ║
║        │ Deal Value for Them: Acceptable │           ← native PeaceDeal bar,  ║
╠══════════════╦═══════════════╦═══════════════╦═══════╧══════════════════════╣
║ Gajah Mada   ║  THEIR OFFER  ║  YOUR OFFER   ║ YOUR Items                    ║
║ Items        ║ (ThemTable)   ║ (UsTable)     ║  0 ⛀ GOLD                     ║
║ 199 ⛀ GOLD   ║  6 Wine (45t) ║  Open Borders ║  0 ⛀ GOLD PER TURN            ║
║ 68 ⛀ GPT     ║  120 Gold     ║  4 Iron (45t) ║  LUXURY RESOURCES             ║
║ LUXURY RES.  ║  ✋ No spying  ║               ║  STRATEGIC RESOURCES          ║
║ STRATEGIC R. ║   (promise)   ║               ║  TECHNOLOGIES                 ║
║ TECHNOLOGIES ║               ║               ║  WORLD CONGRESS               ║
║ WORLD CONGR. ║               ║               ║  WORLD MAP                    ║
║ WORLD MAP    ║               ║               ║  ACCEPT EMBASSY               ║
║ ACCEPT EMB.  ║               ║               ║  OPEN BORDERS                 ║
║ OPEN BORDERS ║               ║               ║  DEFENSIVE PACT               ║
║ DEFENSIVE P. ║               ║               ║  RESEARCH AGREEMENT           ║
║ VASSAL STATE ║               ║               ║  VASSAL STATE                 ║
║ LIBERATION   ║               ║               ║  LIBERATION                   ║
║ CITIES       ║               ║               ║  CITIES                       ║
║ OTHER PLAYERS║               ║               ║  OTHER PLAYERS                ║
║ PROMISES ▼   ║               ║               ║  PROMISES ▼          ← NEW    ║
║  No spying   ║               ║               ║   No settling near (50t)      ║
║  Coop War vs…║               ║               ║   No spying (30t)             ║
╠══════════════╩═══════════════╩═══════════════╩═══════════════════════════════╣
║  incoming:   [ Accept ]  [ Counter ]  [ Reject ]          ← mode from how the ║
║  own open:   [ Counter ] [ Retract ]                        chat card opened  ║
║  view-only:  [ Back ]                (native table covers via OpenDealReview) ║
║  authoring:  [ Propose ] [ Cancel ]                                           ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

Pocket entries behave natively: clicking moves the item to the table (the native handler edits `g_Deal`, then our `DoUpdateButtons` wrap re-derives `draftItems`); greyed structurally-illegal entries show their untradeable reason on hover; AI-politics-only blocks show enabled (h2h proxy). Promises use `draftPromises`, not `g_Deal`. All responses happen on this screen; chat cards only open it.

## Decisions recorded

- **Reuse policy applied** (user): include EUI Lua untouched via VFS; our logic alongside in the wrapper; only the XML is copied, minimally changed (the `LeaderHeadRoot.xml` precedent).
- **Deal value** (user): keep VP's native bar and computation exactly; no per-item sums or extra labels.

## Reuse

VP's `(3a)` `TradeLogic.lua` **in place via `include("TradeLogic")`** — zero lines copied; `DiploTrade.xml` (copied, minimal additions); the native 50-line `UI_bc1/Improvements/DiploTrade.lua` wrapper as the model for ours; native `LeaderMessageHandler` (entry), `OpenDealReview` (view-only), `SubStackHandler` (pocket expansion), `DoUpdateButtons` (value bar); `mcp-server/lua/inspect-deal.lua` helper ports (`resolveItem`, `durationFor`, `coopWarEligible`); `mcp-server/src/utils/deal-schema.ts` (DealPayload v1) and `deal-metadata.ts` (promise vocabulary); the stage-3/6 `CvLuaDeal` h2h bindings; `VoxDeorumDiploPanel.lua` popup + fallback idioms.

## Verify

In a live game with the debug hook:

1. **Seam probes pass** (day-one): the `UI.GetScratchDeal` proxy is captured by the include (legality reflects h2h); re-registered `ProposeButton`/`CancelButton` callbacks replace the native ones (clicking never reaches `UI.DoProposeDeal`/`OnBack` — verify via print + no diplo-AI reaction); `Events.ClearDiplomacyTradeTable.Remove` sticks. If a probe fails, fall back per work item 2 and record it.
2. A mock incoming proposal renders across categories (gold/GPT, resources, cities, techs, votes, toggles, third-party, promises) with the speech bubble showing the deal message; an empty open works for authoring; view-only shows the native table covers.
3. Legality is live and h2h-correct: an item blocked only by AI politics shows enabled; a structurally illegal one is blocked with a reason. The native deal-value bar updates on every edit. Bridge logs confirm **zero** traffic during editing.
4. The promises category lists the pinned kinds with durations; Coop War shows only eligible targets.
5. Propose and Counter print the expected `DealPayload` v1 from the draft model; Accept prints the mock proposal ID. While a draft is open, invoke `inspect-deal` and confirm the visible terms and submitted payload survive (clobber guard). A structurally invalid term fails the final pass; an oversized deal fails the size guard; both show on-screen reasons.
6. The native trade screen, SimpleDiploTrade, and leader flows are byte-identical and behave unchanged (we ship no `TradeLogic.lua`); no `Lua.log` errors; record which popup-layering approach won over the chat panel.

## Done when

The full deal-editing experience works in-game against mock data on the native VP EUI screen: incoming proposals, pockets with enactment (h2h) legality, the native deal-value bar, and promises. It produces the exact `DealPayload` v1 objects that stage 04 will send — with VP's trade logic reused entirely in place.
