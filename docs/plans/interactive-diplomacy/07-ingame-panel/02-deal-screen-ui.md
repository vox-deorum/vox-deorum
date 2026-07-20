# Stage 7.02: civ5-mod + civ5-dll: native trade screen as a Vox includer, on mock data

> Part of the stage-7 sub-plan ([specs.md](specs.md); index [../07-ingame-panel.md](../07-ingame-panel.md)). This stage has no runtime server wiring. A mock driver exercises every screen mode against live game state, and the existing `inspect-deal` tool is used only as an adversarial development probe for shared-scratch clobbering. Stage 7.04 replaces the mock driver with transport.
>
> **Revision note.** The first implementation (commit f8dd4b5a, removed in b943435d) failed: the dialog autoloaded as a skeleton with no real data, and the wrapper-around-unchanged-TradeLogic architecture — `UI`/`Game` facade shadowing, a scratch-deal proxy injecting the h2h flag into C++ argument slots, redefined native globals, a synthetic `LeaderMessageHandler` entry, and a fingerprint/dirty-flag reconciliation state machine — was too complex to debug. This revision replaces that architecture with **in-place, nil-defaulted seams inside VP's own (3a) TradeLogic.lua**. The panel-side contract, the DealPayload helpers, the mock driver, the text keys, and the modinfo registrations from the first attempt survive and are reused.

## Objective

Reuse the VP EUI trade screen by making the Vox deal screen a **third first-class includer** of `civ5-dll/(3a) VP - EUI Compatibility Files/LUA/TradeLogic.lua` — alongside `UI_bc1/Improvements/DiploTrade.lua` and SimpleDiploTrade. TradeLogic is an include file, not a context: its `Events.AILeaderMessage` registration is commented out (line 408) and it never installs an input handler; includers own entry, registration, and input. The Vox screen therefore includes it plainly — no facades, no proxies, no global shadowing — and Vox behavior enters through seams added directly to the (3a) file and the DLL, every one of which **defaults to vanilla behavior when nil/unset**. A stock game must be behaviorally identical.

The screen must:

- use human-to-human structural legality for availability checks, every native `Add*` constructor, and amount changes;
- preserve the native `Deal Value for Them` bar as advisory information;
- present the five authorable promise kinds from `PROMISE_TYPES` as a **normal trade-screen category** — pocket button, chooser sub-stack, table rows — exactly like trading cities or third-party war/peace, not an overlay;
- round-trip every ordinary term through `DealPayload` v1;
- distinguish authoring, incoming, own-open, and view-only modes explicitly;
- act for the shared effective seat in normal, human-strategist, and pure-observer sessions;
- keep an independent draft safe when another caller reuses the global scratch deal;
- never be visible outside the request-table open path (the skeleton-autoload cure); and
- end every action at a delayed mock driver, with no transcript writes or enactment.

## Already in place (reused, not rebuilt)

Surviving from the first attempt, all committed and unchanged by this stage unless noted:

- **`civ5-mod/UI/VoxDeorumDealUtils.lua`** — the pure DealPayload v1 helper module: `DeepCopy`, duration getters (`DurationForItem`, `DurationForPromise`), `NormalizeItems`/`NormalizePromises` (including symmetric-item and coop-war twin materialization), `ItemFingerprint`/`SemanticFingerprint`, `ValidatePayload`, `StripDelimiter`/`SanitizeMessage`. The rebuilt wrapper builds on it as-is.
- **`civ5-mod/UI/VoxDeorumDealScreenMock.lua`** — the stage-7.02 delayed mock driver with six FireTuner scenarios (`author`, `incoming`, `own`, `view`, `success`, `error`) via `LuaEvents.VoxDeorumOpenDealScreenMock`. It expects the `VoxDeorumDealUI` global and is currently orphaned; it becomes the rebuilt screen's final include again. Stage 7.04 replaces only that include.
- **The panel contract** in `civ5-mod/UI/VoxDeorumDiploPanel.lua/.xml` and `VoxDeorumDiploPanelMock.lua`: the request-table event `VoxDeorumOpenDealScreen({ counterpartID, mode, deal?, proposalMessageID? })`, mode derivation from the reducer (`author`/`incoming`/`own`/`view`), the `VoxDeorumDiploPanelDemoteForDeal`/`RestoreAfterDeal` coordination hooks, and the six hidden mock trigger buttons.
- **`civ5-mod/Text/VoxDeorum_Text.xml`** — the `TXT_KEY_VD_DEAL_*` block (promise labels, actions, errors, pending, mock strings). This stage adds only tooltip-reason keys for disabled promise kinds if needed.
- **`civ5-mod/VoxDeorum.modinfo`** — entries for `UI/VoxDeorumDealScreen.lua` (import="1"), `UI/VoxDeorumDealScreen.xml` (import="0") and its `InGameUIAddin` EntryPoint currently point at deleted files; recreating the files under the same names re-validates them. Rerun `civ5-mod/update_md5.py`.

## Pinned design

### Open and driver contracts (unchanged)

`VoxDeorumOpenDealScreen({ counterpartID, mode, deal?, proposalMessageID? })` — `mode` is one of `author`, `incoming`, `own`, or `view`; the panel derives it from proposal status and `SpeakerID`. `incoming`, `own`, and `view` require a deal; the two open-proposal modes also require `proposalMessageID`.

The deal screen exposes `VoxDeorumDealUI.driver.onAction(action)` and `VoxDeorumDealUI.resolve(result)` inside its own context, and listens for `LuaEvents.VoxDeorumDealActionResolved(result)` to let the panel context complete an action. The wrapper enters a visible pending state before calling the driver. A success closes the screen; an error restores the same mounted draft and shows its reason. Stage 7.02 uses the surviving mock driver; stage 7.04 replaces only that driver.

### Mode behavior (unchanged)

| Mode | Initial content | Editing | Actions |
|---|---|---|---|
| `author` | Empty deal and blank outgoing message | Yes | Propose, Cancel |
| `incoming` | Counterpart proposal and its read-only speech | Yes | Accept, Counter, Reject |
| `own` | Caller proposal and its public message | Yes | Counter, Retract |
| `view` | Historical proposal | No | Back |

Track `baselineItems`, `baselinePromises`, `draftItems`, `draftPromises`, `incomingMessage`, and `outgoingMessage` separately. Accept is enabled only while incoming terms still match the baseline (`SemanticFingerprint`) and `outgoingMessage` is blank. Counter requires at least one term but may resend unchanged terms. Reject, Retract, Cancel, and Back never serialize the edited draft. Author and Counter modes show a compact optional one-sentence message input above the value strip; incoming speech stays in the native leader speech area. Client-authored output always removes `rationale`, trims the public message, and strips the IPC delimiter.

### Reuse policy: in-place VP seams

The VP tree and the DLL are vendored in this repo and ship through `scripts/installer.iss`, so they are ours to modify — under one pinned rule: **every new argument, chunk-local, or hook defaults to vanilla behavior when nil/unset**. A second rule makes the deviations findable: **every change to a VP file — Lua, XML, or DLL source — and every Vox-specific divergence inside a copied VP file carries an explicit `Vox Deorum:` comment** (`-- Vox Deorum: …` in Lua, `<!-- Vox Deorum: … -->` in XML, `// Vox Deorum: …` in C++, the convention the existing `Add*` bindings already follow), so reviews and future VP-upstream merges can locate every deviation by grep. There is no fallback copy and no file named `TradeLogic.lua` may ever ship inside `civ5-mod`. Only the (3a) copy is modified; `(1) Community Patch/Core Files/Overrides/Includes/TradeLogic.lua` (the non-EUI variant) stays untouched — a VP+EUI install is a stated project assumption.

Vox mode and the seat enter TradeLogic as **call arguments** to a new parameterized mount entry and stick in chunk-locals; the TradeLogic→wrapper refresh channel is **LuaEvents**. Include-time registrations the Vox context must not keep are undone **wrapper-side after the include**, which works because `include` runs in the caller's context environment and the relevant TradeLogic functions (`DoClearDeal`, `OnPropose`, `OnBack`) are chunk-globals.

## Work items

1. **(3a) TradeLogic.lua: the five in-place seams.** Every edited line or block carries a `-- Vox Deorum:` marker (call-site clusters like S2–S4 may share one marker per contiguous block). Each seam with its default-off reasoning:

   - **S1 — sticky Vox state via the parameterized mount entry.** New chunk-locals `g_bVDHumanToHuman`, `g_iVoxSeat` (nil by default; no native code path ever sets them) plus one new global defined inside the chunk (it must be — `g_iUs` and friends are chunk-locals):

     ```lua
     function VoxDeorumOpenDeal( iUs, iThem )
         g_bVDHumanToHuman, g_iVoxSeat = true, iUs
         g_bPVPTrade, g_bTradeReview, g_bNewDeal = false, false, true
         g_bMessageFromDiploAI, g_bAIMakingOffer = false, false
         g_iDiploUIState = DiploUIStateTypes.DIPLO_UI_STATE_TRADE
         g_iUs, g_pUs = iUs, Players[iUs];   g_iUsTeam = g_pUs:GetTeam();   g_pUsTeam = Teams[g_iUsTeam]
         g_iThem, g_pThem = iThem, Players[iThem];  g_iThemTeam = g_pThem:GetTeam();  g_pThemTeam = Teams[g_iThemTeam]
         ResetDisplay();  DisplayDeal();  DoUpdateButtons()
     end
     ```

     Sticky storage is required because the h2h flag must be visible to the legality calls inside `DoUpdateButtons`, which native click handlers invoke with no arguments. The function does no presentation — the wrapper owns show/hide. Default-off: a pure definition with no vanilla caller; the locals stay nil in every stock context.
   - **S2 — h2h on legality reads.** Append `g_bVDHumanToHuman` at every `g_Deal:IsPossibleToTradeItem` (~29) and `GetReasonsItemUntradeable` (~19) call site, padding absent middle arguments with explicit `nil` so the flag lands in the binding's h2h slot. An explicit nil is indistinguishable from a missing argument to `luaL_optbool`/`lua_toboolean`, so vanilla calls are bit-identical. Leave `IsTradeItemValuedImpossible` calls untouched — that is advisory AI valuation, deliberately unmodified.
   - **S3 — h2h on Add\*.** Append `g_bVDHumanToHuman` as the trailing argument at every `g_Deal:Add*` site; the stage-3/6 bindings already accept it.
   - **S4 — h2h on Change\*.** Append `g_bVDHumanToHuman` at the six `ChangeGoldTrade`/`ChangeGoldPerTurnTrade`/`ChangeResourceTrade` sites, enabled by work item 2. This is the seam that deletes the first attempt's transactional clone-and-rebuild machinery: an amount edit is now one native call validated under h2h inside `CvDeal`.
   - **S5 — seat fallback and LuaEvents hook points.** `DisplayDeal`'s side classification (line 2726) becomes `OverridePlayer or g_iVoxSeat or Game.GetActivePlayer()` so bare native refresh calls resolve to the bound seat in Vox mode. At the tails of `ResetDisplay`, `DoClearTable`, `DisplayDeal`, and `DoUpdateButtons`, fire vox-gated hooks:

     ```lua
     if g_bVDHumanToHuman then LuaEvents.VoxDeorumTradeLogicDisplayDeal() end
     ```

     (likewise `...ResetDisplay`, `...ClearTable`, `...UpdateButtons`). The gate means the native DiploTrade context — which includes the same modified file — never fires them, and LuaEvents members auto-create, so the calls are inert even in installs without the Vox mod.

   Pin the non-changes: `g_bPVPTrade`/`g_bTradeReview` stay false invariantly in Vox mode, keeping every code path that references controls absent from `DiploTrade.xml` unreachable; TradeLogic's include-tail `ResetDisplay(); DisplayDeal()` already early-returns while `g_iUs == -1`.

2. **DLL: h2h on the three Change bindings.** `civ5-dll/CvGameCoreDLL_Expansion2/`:

   - `CvDealClasses.h`: trailing `bool bTreatAsHumanToHuman = false` on `ChangeGoldTrade`, `ChangeGoldPerTurnTrade`, `ChangeResourceTrade`, matching the existing `// Vox Deorum:` comments and style on the `Add*` declarations. All three DLL files mark every changed block the same way.
   - `CvDealClasses.cpp`: thread the parameter into each body's internal `IsPossibleToTradeItem` call (which already carries it at position 9, defaulted false).
   - `Lua/CvLuaDeal.h/.cpp`: the three bindings are currently `BasicLuaMethod` templates and cannot see an optional argument; replace them with explicit `lChange*` implementations reading `luaL_optbool` at stack index 4 / 5 / 6 and preserving the bool return the native EditBox handlers rely on.

   Explicit non-changes: **no** `TradeableItems` enum addition, no serialization change, no `CvDealAI` change — promises never reach C++.

3. **Recreate the screen files.**

   - `civ5-mod/UI/VoxDeorumDealScreen.xml`: a full copy of `civ5-dll/(1) Community Patch/Core Files/Overrides/DiploTrade.xml` with attribution and `Hidden="1"` on the root Context; every divergence from the copied original — including the root rename/hide — is marked with a `<!-- Vox Deorum: … -->` comment so a diff against upstream `DiploTrade.xml` stays reviewable. The wrapper-owned additions: the promise category controls (work item 4), the outgoing-message EditBox above the value strip, a pending/status label, and a hidden third bottom button so `incoming` mode can show Accept / Counter / Reject. A full copy is include-safe by construction: an audit confirmed every control and instance template TradeLogic touches at include time exists in `DiploTrade.xml` (the city/vote instance managers and their stacks, the pocket sub-stack buttons and stacks, gold/GPT EditBoxes, `ProposeButton`/`CancelButton`/`DenounceButton`, the resource/technology pocket builds, the city and leader chooser controls, the six-per-player `OtherPlayerEntry` builds, and the four peace/war duration labels). Carry that list as the drift checklist for future VP `DiploTrade.xml` changes.
   - `civ5-mod/UI/VoxDeorumDealScreen.lua`, the thin wrapper. Load order: `include("VoxDeorumDealUtils")` → `include("TradeLogic")` → assert `GenerationalInstanceManager ~= nil` (proves the EUI (3a) copy and EUI's InstanceManager won VFS resolution) → post-include cleanup → hooks → driver plumbing → final `include("VoxDeorumDealScreenMock")`. Post-include cleanup, all same-context and possible because the targets are chunk-globals:
     - `Events.ClearDiplomacyTradeTable.Remove(DoClearDeal)` — engine-wide clears never touch the Vox table or state;
     - re-register `Controls.ProposeButton` and `Controls.CancelButton` to wrapper handlers (`RegisterCallback` is single-slot, so this replaces the native `OnPropose`/`OnBack`; their only internal callers sit in `LeaderMessageHandler`, never registered here, and in TradeLogic's `InputHandler`, never installed here);
     - install the wrapper's own input handler (ESC = Vox close; TradeLogic never calls `SetInputHandler` — includers do);
     - override the show-hide handler, chaining the native `OnShowHide` exactly as UI_bc1's DiploTrade does.
   - Mount path: validate the request table (mode vocabulary, living-major counterpart, required deal/proposalMessageID per mode) → bind `actorID = VoxDeorumSeat.EffectiveSeat()` → deep-copy and normalize incoming terms, strip `rationale`, split baseline/draft arrays and incoming/outgoing messages, reset pending and fingerprint state → clear and project the deal into the scratch via direct `g_Deal:Add*(…, true)` calls → `VoxDeorumOpenDeal(actorID, counterpartID)` → `ContextPtr:SetHide(false)` plus the panel demote hook. Close clears the scratch, drafts, fingerprints, pending state, and mode, then fires the panel restore hook.
   - Presentation is pinned: plain `SetHide(false)` over the demoted panel — the popup queue is not used (retires the specs open risk).

4. **The promise category, wrapper-owned and hook-driven.** Promises never enter `g_Deal`, so the `GetNextItem()` render loop cannot carry them; the category renders on the S5 hooks instead, and all of its logic lives in the wrapper (keeping VP's shared file free of Vox-only dead weight).

   - **XML** (in the copied context XML only): a `PromiseEntry` instance template modeled on `OtherPlayerEntry`/`CityInstance` (Button + Name label + Duration label); per side, a `…PocketPromise` toggle button plus a `…PocketPromiseStack` sub-stack with five kind buttons (`Military`, `Expansion`, `Border`, `NoDigging`, `CoopWar`) — the `UsPocketOtherPlayer` sub-stack pattern, with the toggle handled by a wrapper mirror of `SubStackHandler`; per side, a `…PocketPromiseTargetStack` coop-war target chooser using the `CityClose`/`LeaderClose` swap pattern; per side, a `…TablePromiseStack` with a header label inside `UsTableStack`/`ThemTableStack`, rows built from wrapper `GenerationalInstanceManager`s.
   - **Enablement** (on the `ResetDisplay` hook): per side and kind, enable/disable with a tooltip reason — already-made `MILITARY`/`EXPANSION`/`BORDER` through their existing reads (mirroring `mcp-server/lua/inspect-deal.lua`); `NO_DIGGING` always enabled (no made-state read exists; reapplication is a harmless no-op); duplicates versus `draftPromises` disabled; `COOP_WAR` enabled only when an eligible target exists (both principals met the target, `IsValidCoopWarTarget` in both directions, no already-preparing coop war). View mode hides the pocket promise button entirely.
   - **Add/remove**: a kind click appends the `NormalizePromise` output to `draftPromises` (promiser = that side's player); the coop-war click opens the target chooser, and a target click adds the promise with its target, letting `NormalizePromises` materialize the canonical symmetric twin. One visible coop-war row per side pair; removing a table row removes the twin too. Shared refresh = `DoClearTable(); DisplayDeal()`, so ordinary items and promises always redraw through the same cycle the native handlers use.
   - **Render** (on the `DisplayDeal` hook; instance reset on the `ClearTable` hook): one `PromiseEntry` per draft promise on the promiser's side; label = kind text plus the target leader for coop war; duration from `VoxDeorumDealUtils.DurationForPromise` (guarded `Game.GetMilitaryPromiseDuration()` etc., `GameDefines.COOP_WAR_SOON_COUNTER`; `NO_DIGGING` has none). View mode renders rows disabled.

5. **Draft and scratch synchronization, simplified.** The first attempt treated the Lua draft as live truth and the scratch as a hostile mirror; this revision inverts that:

   - **The scratch deal is the live editing truth.** Native handlers mutate it directly, now under h2h semantics via S2–S4. No proxy exists; nothing classifies mutators.
   - **`draftItems` is a passive decode of the scratch**, refreshed on the `DisplayDeal` **and** `UpdateButtons` hooks (amount edits reach `DoUpdateButtons` without a full `DisplayDeal`) through `itemFromScratch` — the exact inverse of the `GetNextItem()` 8-tuple, covering gold, GPT, resources, city plot coordinates back to the giver's `cityID`, technologies, vote commitments and repeal flags, third-party peace and war, maps, agreements, peace, vassalage, and revocation. Each decode refreshes `expectedScratchFingerprint` (`VoxDeorumDealUtils.ItemFingerprint`).
   - **`draftPromises` is wrapper-only truth**, and serialization always builds from `draftItems + draftPromises + outgoingMessage`.
   - **The scratch is rebuilt from the draft in exactly three situations**: (a) on open; (b) on clobber detection — a throttled (~4/s) check on the wrapper's existing `SetUpdate` tick compares the live scratch fingerprint with `expectedScratchFingerprint` while the screen is visible, and a mismatch restores from `draftItems` (the only clobber source is a server-side tool such as `inspect-deal` firing between UI interactions, so a frame-tick check beats any human click and is self-healing); (c) immediately before final legality and serialization for Propose or Counter.
   - **Surviving state: two fields** — `expectedScratchFingerprint` and one `m_rebuilding` boolean suppressing decode/detection during wrapper-initiated projection. Deleted outright: the proxy, mutator classification, `nativeEditDirty`, and the transactional clone-and-rebuild for amount edits (an illegal amount now simply fails inside `CvDeal`, the native handler redisplays the true scratch state, and the decode follows).

6. **Keep native valuation visible but advisory.** Let native `DoUpdateButtons` update the existing `PeaceDeal`, `PeaceValue`, and `PeaceMax` controls through `GetTotalValueToMeNormal` and its war variants. Do not add per-item value calls or another balance label. On the `UpdateButtons` hook, the wrapper reapplies its own action visibility and enabled state (native code rewrites Propose/Cancel text on every update) and force-hides the What/Denounce controls, whose callbacks are includer-registered and therefore dead in this context. Native AI political acceptability may display `Impossible`, but it never blocks Propose or Counter: only structural legality, mode, an empty term set, pending state, or actor drift may block submission; Accept additionally requires unchanged incoming terms and no outgoing counter message.

7. **Serialize and submit through the mock driver.** Before Propose or Counter: confirm the bound actor is still the current effective seat; rebuild the scratch from the draft; run a final h2h structural legality pass over every ordinary item; run the promise checks; require at least one ordinary item or promise; build `DealPayload` v1 from the draft and sanitized outgoing public message, without `rationale`; and apply a conservative recursive size estimate to the full future event envelope. DO NOT create a local ceiling as a deal is very unlikely to go over that. In that event, we will raise the buffer space.

   Propose and Counter send the deal to `driver.onAction`. Accept, Reject, and Retract send only the proposal ID, using distinct `accept`, `reject`, and `retract` driver kinds; stage 7.04 maps the local `retract` kind to the backend's canonical reject action. The wrapper immediately shows a localized animated pending state and disables actions. The mock driver demonstrates delayed success and delayed error recovery. The screen never calls `Deal:Enact()` and never writes transcript rows.

8. **Debug entry.** The surviving mock plumbing already covers this: the request-table LuaEvent is FireTuner-callable, `VoxDeorumDealScreenMock.lua` ships the six full-category scenarios, and the panel's six hidden mock buttons expose them while the mock panel driver is installed. No production keybind.

## Dev iteration and packaging

The (3a) and DLL changes do **not** ship through `civ5-mod/deploy.bat`. During development, copy the edited `TradeLogic.lua` directly into the game's `MODS\(3a) VP - EUI Compatibility Files\LUA\` (the game does not enforce modinfo MD5s at load); DLL changes rebuild through the existing DLL build. Release always flows through `scripts/installer.iss`, which recurses the `civ5-dll/(3a)` tree. The `civ5-mod` files keep the modinfo + `civ5-mod/update_md5.py` + `deploy.bat` flow.

## Reuse

- VP `(3a)` `TradeLogic.lua`, included as-is by the Vox context after the in-place seams land
- `DiploTrade.xml`, copied under a unique name with the promise category and wrapper controls added
- `UI_bc1/Improvements/DiploTrade.lua`, the reference for what an includer owns (input handler, show-hide, entry registration)
- `civ5-mod/UI/VoxDeorumDealUtils.lua`, `VoxDeorumDealScreenMock.lua`, the panel request-table contract, `TXT_KEY_VD_DEAL_*`, and the modinfo entries (all surviving)
- `mcp-server/lua/inspect-deal.lua` mappings for item signatures, duration lookup, and coop-war eligibility
- `mcp-server/src/utils/deal-schema.ts` and `deal-metadata.ts` as the canonical payload and promise vocabulary
- `VoxDeorumSeat.EffectiveSeat` and the panel's existing presentation patterns

## Verification

### Packaging and static checks

1. Run `python civ5-mod/update_md5.py`; a second run reports every hash current.
2. Confirm `VoxDeorum.modinfo`'s deal-screen entries point at existing files again (Lua imported, XML not imported, InGameUIAddin registered).
3. Confirm no file under `civ5-mod` is named `TradeLogic.lua`.
4. Marker audit: every hunk in the (3a) `TradeLogic.lua` and DLL diffs contains a `Vox Deorum:` comment, and every divergence of `VoxDeorumDealScreen.xml` from the copied `DiploTrade.xml` carries its `<!-- Vox Deorum: … -->` marker (check by diffing the copy against the original).
5. Deploy with `civ5-mod/deploy.bat`, copy the (3a) edit into the game MODS folder, rebuild the DLL, and inspect `Lua.log` after every live scenario.

### Vanilla-unchanged regression (mandatory)

With the modified (3a) file and DLL installed, in a normal VP game with no Vox screen open, exercise the native AI trade screen end to end: pocket enable/disable and tooltips; add, change, and remove gold, GPT, resources, cities, and third-party war/peace; propose, accept, and refuse; the AI demand flow; ESC. Behavior and `Lua.log` must be indistinguishable from stock. Confirm the Vox deal context loads but is **never visible** at game start (the skeleton-autoload check), and that no `VoxDeorumTradeLogic*` LuaEvent fires during native trade.

### Vox screen live checks

1. Exercise all four explicit modes. Confirm view mode has no editable native or promise control. Confirm modified incoming terms or a typed outgoing counter message disable Accept. Confirm Propose and Counter reject a message-only or empty deal with a localized reason.
2. Round-trip every supported ordinary item family through `DealPayload -> scratch -> DealPayload`, including amount changes and removal. Use an AI-politics-only term to prove it is enabled, added, changed through the native h2h `Change*` path, serialized, and locally valid under h2h semantics. Try an invalid gold, GPT, and resource amount; each refusal must preserve the prior term and amount.
3. Confirm the native value bar changes after edits but remains advisory: a structurally legal deal may still submit while the bar says `Impossible`.
4. Exercise all five authorable promise kinds through the pocket category: the three promise-duration getters, `GameDefines.COOP_WAR_SOON_COUNTER`, the absent `NO_DIGGING` duration, directed standing promises, one-row coop-war presentation with symmetric payload twins, eligible-target filtering, and removal of both twins.
5. Confirm the public message input is sanitized, `rationale` never appears in client-authored output, and a mock error preserves both terms and message.
6. While a draft is open, invoke the existing `inspect-deal` development tool to replace the global scratch contents, both while idle and mid-edit. The throttled check restores the visible draft without rolling back a legitimate native edit.
7. Confirm the Propose/Cancel re-registration replaced the native callbacks: no route reaches native `OnPropose`/`OnBack`, `UI.DoProposeDeal`, or `UI.RequestLeaveLeader` (ESC lands in the wrapper's input handler).
8. Test normal play, a pinned human strategist, and a pure observer. Legality, value, columns, serialization actor, and from/to participants must all use the effective seat. Treat any native crash or unsupported observer-slot assumption as a stage blocker, not a reason to silently disable the pinned capability.
9. Test both animated-leader and static-panel backgrounds, reopen, ESC, Cancel, Back, mock success, and mock error. The chat panel demotes while the screen is up and returns with its transcript and state intact.
10. Confirm there is no bridge traffic during editing, no native enactment, and no Lua errors.

## Risks and resolution paths

- **VFS include resolution:** `include("TradeLogic")` must resolve to the (3a) copy and `GenerationalInstanceManager` to EUI's InstanceManager. Both are asserted at wrapper load, and the (3a) file's line-1 print appears once per including context in `Lua.log`.
- **`RegisterCallback` replacement:** the single-slot assumption is a day-one verify item; if a native callback survives re-registration, fall back to a small vox-gated early-return added to `OnPropose`/`OnBack` in (3a) — still in-place and nil-defaulted, just a wider seam.
- **`itemFromScratch` completeness:** the decode must invert every `GetNextItem()` family; the round-trip check in verification is the gate.
- **Observer-slot native reads:** `ResetDisplay`/`DoUpdateButtons` call `GetResearchAgreementCost`, `GetTotalValueToMeNormal`, and `GetCachedValueOfPeaceWithHuman` against the bound seat; a pure observer must not crash them. A failure requires a plan-level design decision before stage 7.04.
- **XML-copy drift:** future VP `DiploTrade.xml` changes do not propagate to the copy; accepted, guarded by the include-time control checklist in work item 3.

## Out of scope

- Runtime bridge or server event wiring
- Server-side legality, stale-proposal, thread-lock, or closed-turn enforcement
- Transcript writes and proposal reduction changes
- Deal enactment
- Per-item valuation or changes to `CvDealAI`
- New automated test infrastructure for `civ5-mod`

## Done when

The native-shaped deal screen works in a live game for every explicit mode and effective-seat flavor, with all ordinary terms using h2h legality (including amount changes through the new `Change*` bindings), the five canonical promises presented as a native trade-screen category, advisory native valuation, safe scratch recovery, message authoring, pending/error feedback, and exact `DealPayload` v1 serialization. Every action stops at the mock driver, native diplomacy screens remain unchanged, and a stock VP game with the modified (3a) file and DLL is behaviorally identical to today.
