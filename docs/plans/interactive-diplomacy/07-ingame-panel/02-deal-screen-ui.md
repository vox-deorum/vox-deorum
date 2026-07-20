# Stage 7.02: civ5-mod: native trade screen reused on mock data

> Part of the stage-7 sub-plan ([specs.md](specs.md); index [../07-ingame-panel.md](../07-ingame-panel.md)). This stage has no runtime server wiring. A mock driver exercises every screen mode against live game state, and the existing `inspect-deal` tool is used only as an adversarial development probe for shared-scratch clobbering. Stage 7.04 replaces the mock driver with transport.

## Objective

Reuse the VP EUI trade screen for Vox Deorum deal authoring and review. Include VP's `TradeLogic.lua` unchanged when the required seams prove safe, keep Vox Deorum behavior in a wrapper, and copy only the XML under a new name with the smallest practical additions. The screen must:

- use human-to-human structural legality for availability checks, every native `Add*` constructor, and amount changes;
- preserve the native `Deal Value for Them` bar as advisory information;
- support the five authorable promise kinds from `PROMISE_TYPES`;
- round-trip every ordinary term through `DealPayload` v1;
- distinguish authoring, incoming, own-open, and view-only modes explicitly;
- act for the shared effective seat in normal, human-strategist, and pure-observer sessions;
- keep an independent draft safe when another caller reuses the global scratch deal; and
- end every action at a delayed mock driver, with no transcript writes or enactment.

This stage retires the risky Civ V UI assumptions before transport work begins. The day-one probes cover context-local `UI` and `Game` facades, native callback replacement, event removal, synthetic `LeaderMessageHandler` entry, and popup layering.

## Current state and constraints

- `civ5-mod/UI/VoxDeorumDiploPanel.lua` already emits `VoxDeorumOpenDealScreen`, but its positional arguments cannot distinguish an incoming proposal from the caller's own open proposal.
- VP's `(3a) VP - EUI Compatibility Files/LUA/TradeLogic.lua` captures `UI.GetScratchDeal()` during include and keeps most callable functions global. This makes a wrapper possible, but only if the captured deal proxy and later function wraps are proven safe.
- The stage-3 and stage-6 `CvLuaDeal` bindings add a trailing `bTreatAsHumanToHuman` argument to legality reads and all 17 `Add*` constructors. Native TradeLogic omits that argument, so adapting only `IsPossibleToTradeItem` would leave enabled terms that silently fail to move onto the table.
- Native `ChangeGoldTrade`, `ChangeGoldPerTurnTrade`, and `ChangeResourceTrade` have no h2h binding. Calling them directly can reject an amount change under stock AI rules, so the proxy must implement those edits through the authoritative draft and a full h2h rebuild.
- `OpenDealReview` is not compatible with the copied `DiploTrade.xml`: it expects controls from a different context, does not show or queue this context, and leaves file-local review state behind. View-only behavior must be wrapper-owned.
- `UI.GetScratchDeal()` returns one shared object. Native edits and external clobbers must be distinguished so recovery never overwrites a legitimate click, amount change, or removal.
- There is no automated test harness for `civ5-mod`. Verification is packaging checks plus live-game probes and log inspection.

## Pinned design

### Open and driver contracts

Replace the positional event with one request table:

`VoxDeorumOpenDealScreen({ counterpartID, mode, deal?, proposalMessageID? })`

`mode` is one of `author`, `incoming`, `own`, or `view`. The panel derives it from proposal status and `SpeakerID`; the deal screen does not infer authorship from the payload. `incoming`, `own`, and `view` require a deal. The two open-proposal modes also require `proposalMessageID`.

The deal screen exposes `VoxDeorumDealUI.driver.onAction(action)` and `VoxDeorumDealUI.resolve(result)` inside its own context. The action contains `kind`, optional `deal`, and optional `proposalMessageID`. The wrapper also listens for `LuaEvents.VoxDeorumDealActionResolved(result)`, which delegates to the context-local resolver so the panel context can complete an action. The wrapper enters a visible pending state before calling the driver. A success closes the screen; an error restores the same mounted draft and shows its reason. Stage 7.02 supplies a mock driver with delayed success and failure paths. Stage 7.04 replaces only that driver and raises the result event after the matching durable row or transport error.

### Mode behavior

| Mode | Initial content | Editing | Actions |
|---|---|---|---|
| `author` | Empty deal and blank outgoing message | Yes | Propose, Cancel |
| `incoming` | Counterpart proposal and its read-only speech | Yes | Accept, Counter, Reject |
| `own` | Caller proposal and its public message | Yes | Counter, Retract |
| `view` | Historical proposal | No | Back |

Track `baselineItems`, `baselinePromises`, `draftItems`, `draftPromises`, `incomingMessage`, and `outgoingMessage` separately. Compare terms through a stable semantic fingerprint: remove server-owned `name`, normalize fixed durations and symmetric terms, and sort ordinary items and promises by all schema discriminator fields. Accept is enabled only while incoming terms still match the baseline and `outgoingMessage` is blank. Counter requires at least one term but may resend unchanged terms, matching the existing Web screen. This prevents accepting modified terms when Accept carries only a proposal ID. Reject, Retract, Cancel, and Back never serialize the edited draft.

Author and Counter modes show a compact, optional one-sentence message input above the value strip. Incoming speech remains in the native leader speech area and never enters the outgoing field. A counter to an incoming proposal starts with a blank outgoing message. Revising the caller's own proposal starts with its existing public message. Client-authored output always removes `rationale`, trims the public message, and strips the IPC delimiter.

### Reuse and fallback policy

The preferred path includes `(3a) VP - EUI Compatibility Files/LUA/TradeLogic.lua` unchanged. Before the include, the wrapper temporarily shadows the context's `UI` with a forwarding facade whose `GetScratchDeal` returns the Vox proxy. Restore the original global immediately after the include, including on failure. Around synthetic entry, temporarily shadow `Game.GetActivePlayer` with a forwarding facade that returns the bound effective seat. Wrapped `DisplayDeal` always supplies that seat as its override.

Do not mutate members on the engine's native `UI` or `Game` tables. Prove that rebinding the globals is isolated to this context and that stock contexts behave unchanged before, during, and after the Vox screen.

If a facade is unsafe or unwritable, callback replacement does not replace the native handler, event removal fails, or another required seam fails, copy the file under the unique name `VoxDeorumTradeLogic.lua`. Make only the necessary seam edits: pass h2h to legality and constructor calls, bind file-local identity to the effective seat, omit native Propose and Cancel registrations, omit the clear-table event registration when needed, and expose the wrapper hook points. Never ship a file named `TradeLogic.lua`.

## Work items

1. **Create and register the screen files.**

   - Copy `civ5-dll/(1) Community Patch/Core Files/Overrides/DiploTrade.xml` to `civ5-mod/UI/VoxDeorumDealScreen.xml` with attribution and a new name.
   - Add wrapper-owned promise pocket controls, promise table rows, the extra response buttons, an outgoing message input, and a wrapped status/error area. Add explicit instance templates or equivalent controls for promise pocket and table entries.
   - Add `civ5-mod/UI/VoxDeorumDealScreen.lua` and `VoxDeorumDealScreenMock.lua`. The mock is the final include, matching the panel's existing mock-driver pattern.
   - Update `civ5-mod/UI/VoxDeorumDiploPanel.lua` to emit the request table and derive the explicit mode. Add a callable panel coordination hook for deal-screen popup fallback; the deal screen cannot call the panel's local `demoteToStatic` function directly.
   - Add all new labels, validation messages, pending text, and mock messages to `civ5-mod/Text/VoxDeorum_Text.xml`.
   - Register the XML as an `InGameUIAddin`, add Lua files with `import="1"` and XML with `import="0"` in `VoxDeorum.modinfo`, then refresh hashes with `civ5-mod/update_md5.py`.

2. **Build the scratch proxy and run the seam probes first.**

   The proxy forwards colon calls to the real scratch deal with the real deal as `self`. It adapts both legality methods by supplying argument 9 as `true`, and adapts the trailing h2h argument for all native constructors:

   - `AddGoldTrade`
   - `AddGoldPerTurnTrade`
   - `AddMapTrade`
   - `AddResourceTrade`
   - `AddCityTrade`
   - `AddAllowEmbassy`
   - `AddOpenBorders`
   - `AddDefensivePact`
   - `AddResearchAgreement`
   - `AddPeaceTreaty`
   - `AddThirdPartyPeace`
   - `AddThirdPartyWar`
   - `AddDeclarationOfFriendship`
   - `AddVoteCommitment`
   - `AddTechTrade`
   - `AddVassalageTrade`
   - `AddRevokeVassalageTrade`

   Reuse the signatures already encoded by `resolveItem` in `mcp-server/lua/inspect-deal.lua`. The proxy also classifies native item mutators, including Add, Change, Remove, and Clear methods, so the synchronization state machine knows when a scratch mismatch is expected.

   Do not forward `ChangeGoldTrade`, `ChangeGoldPerTurnTrade`, or `ChangeResourceTrade` to the real deal. Each adapter first restores an externally clobbered scratch if necessary, clones the current draft, changes the matching term only in the candidate clone, and performs a guarded full rebuild through the h2h `Add*` adapters. Because the Lua constructors return no success value, compare the rebuilt scratch fingerprint and item count with the complete candidate. Commit the candidate to the authoritative draft only on an exact match. On any omitted or invalid item, rebuild the previous draft and keep its old term and amount. This preserves stage 7.02 as UI-only while giving amount edits the same transactional h2h semantics as adds.

   Probe these seams before building the full UI:

   - the temporary `UI` facade is captured by the include without affecting another context;
   - the temporary `Game` facade gives `LeaderMessageHandler` the effective seat and restores cleanly;
   - re-registering `ProposeButton` and `CancelButton` replaces the native callbacks;
   - `Events.ClearDiplomacyTradeTable.Remove(DoClearDeal)` removes this context's handler;
   - global wraps are reached by native internal calls; and
   - a minimal pure-observer entry can set scratch participants, run `LeaderMessageHandler`, display value and pockets, add, change, remove, and serialize a term without a crash or invalid player assumption; and
   - stock trade, SimpleDiploTrade, and leader screens retain native behavior.

   If any required seam fails, switch to the renamed fallback described above and record which fallback was needed.

3. **Wrap the native entry and all unsafe exits.**

   Include TradeLogic without registering `Events.AILeaderMessage`, the equalize and What buttons, or the native input handler from `UI_bc1/Improvements/DiploTrade.lua`. Remove the included clear-table event handler. Wrap `DoUpdateButtons`, `DisplayDeal`, and `DoClearTable`; wrap `ResizeStacks` only if promise layout requires it.

   On open:

   1. Validate the request and bind `actorID = VoxDeorumSeat.EffectiveSeat()` plus the counterpart.
   2. Deep-copy and normalize the incoming terms, strip `rationale`, create separate baseline and editable term arrays, split incoming speech from the outgoing public-message draft, and reset pending and fingerprint state.
   3. Clear and rebuild the real scratch deal under the synchronization guard, including from/to players and h2h constructor adapters.
   4. Call synthetic `LeaderMessageHandler` in ordinary AI-trade state while the temporary Game facade returns `actorID`.
   5. Let native display and value updates run, then apply wrapper-owned mode controls, promise rows, message input, and status.

   Do not call `OnOpenPlayerDealScreen` or `OpenDealReview`. View mode uses normal synthetic entry, then the wrapper covers both native tables, hides or disables both pockets, renders promises read-only, and exposes only Back.

   Re-register every visible action control and install a wrapper input handler so native `OnPropose`, `OnBack`, `UI.DoProposeDeal`, `UI.RequestLeaveLeader`, and diplo-AI close calls are unreachable. Close clears the real scratch deal, draft, baseline, promise instances, fingerprints, pending state, and mode before dequeuing.

4. **Make draft and scratch synchronization explicit.**

   `draftItems` and `draftPromises` are the term-serialization source of truth. `incomingMessage` is display-only, while `outgoingMessage` is the only message serialized for Propose or Counter. Implement both item directions:

   - `resolveItem` maps one `DealPayload` item into the appropriate h2h `Add*` call.
   - `itemFromScratch` is its exact inverse over the `GetNextItem()` tuple. It covers gold, GPT, resources, city plot coordinates back to the giver's `cityID`, technologies, vote commitments and repeal flags, third-party peace and war, maps, agreements, peace, vassalage, and revocation.

   Use a small state machine:

   - `rebuilding` suppresses scratch-to-draft synchronization and proxy mutation tracking while the wrapper projects the draft.
   - `nativeEditDirty` is set by proxy-originated item mutators.
   - `expectedScratchFingerprint` records the last ordinary-item scratch state synchronized with the draft. It uses the same stable item ordering as the semantic draft fingerprint, but excludes promises because they never enter the scratch deal.
   - Before forwarding any proxy operation while neither rebuilding nor processing a native edit, compare the real scratch state with `expectedScratchFingerprint`. On an unexpected mismatch, restore the scratch from the draft first. If the incoming operation is a mutator, restore before marking `nativeEditDirty` and applying the requested edit.
   - After native `DoUpdateButtons` finishes, decode the scratch into `draftItems`, clear `nativeEditDirty`, refresh the fingerprint, and then refresh wrapper controls.

   Ensure an Add followed by native reads is not mistaken for clobbering. Cover amount changes and removals as well as additions. Rebuild before open, final validation, and serialization. A failed mock action keeps the existing draft and fingerprints mounted.

5. **Keep native valuation visible but advisory.**

   Let native `DoUpdateButtons` update the existing `PeaceDeal`, `PeaceValue`, and `PeaceMax` controls through `GetTotalValueToMeNormal` and its war variants. Do not add per-item value calls or another balance label.

   After each native update, the wrapper reapplies its own action visibility and enabled state. Native AI political acceptability may display `Impossible`, but it never blocks Propose or Counter. Only structural legality, mode, an empty term set, pending state, actor drift, and payload size may block submission. Accept additionally requires unchanged incoming terms and no outgoing counter message.

6. **Add the authorable promises as wrapper-owned terms.**

   Build the promise inventory from the canonical metadata semantics, mirrored manually in Lua with cross-reference comments because TypeScript metadata is not available in the game context. The authorable kinds are `MILITARY`, `EXPANSION`, `BORDER`, `NO_DIGGING`, and `COOP_WAR`. Do not expose the dormant `SPY`, `NO_CONVERT`, `BULLY_CITY_STATE`, or `ATTACK_CITY_STATE` kinds.

   Promise terms never enter `g_Deal`. They live in `draftPromises`, render in wrapper-owned rows, and use wrapper-owned add and remove handlers.

   Validate pair membership, direction, duplicates, required Coop War target, both principals meeting the target, `IsValidCoopWarTarget` in both directions, and no already-preparing Coop War. Check already-made `MILITARY`, `EXPANSION`, and `BORDER` promises through their existing reads. Repeated `NO_DIGGING` remains idempotent because the game exposes no made-state read and current enactment treats reapplication as a harmless no-op. Stage 7.04 adds the same available checks to authoritative pre-archival validation. One visible Coop War selection adds the canonical symmetric twin rows to the draft, and removing it removes both.

   Read promise durations from the same sources as `inspect-deal.lua`: guarded `Game.GetMilitaryPromiseDuration()`, `Game.GetExpansionPromiseDuration()`, and `Game.GetBorderPromiseDuration()` calls, plus guarded `GameDefines.COOP_WAR_SOON_COUNTER` for Coop War. `NO_DIGGING` has no duration.

7. **Serialize and submit through the mock driver.**

   Before Propose or Counter:

   1. confirm the bound actor is still the current effective seat;
   2. rebuild the scratch from the draft;
   3. run a final h2h structural legality pass over every ordinary item;
   4. run the promise checks;
   5. require at least one ordinary item or promise, matching the native and existing Web screens;
   6. build `DealPayload` v1 from the draft and sanitized outgoing public message, without `rationale`; and
   7. apply a conservative recursive size estimate to the full future event envelope.

   Use a 48 KiB local ceiling as margin below stage 7.03's 64 KiB game-event document. Count string bytes, scalar values, table keys, array entries, and fixed per-node overhead. This is a loud client-side guard, not authoritative transport validation.

   Propose and Counter send the deal to `driver.onAction`. Accept, Reject, and Retract send only the proposal ID; Retract uses the reject action. The wrapper immediately shows a localized animated pending state and disables actions. The mock driver must demonstrate delayed success and delayed error recovery. The screen never calls `Deal:Enact()` and never writes transcript rows.

8. **Coordinate popup presentation and provide a debug entry.**

   First try normal `PopupPriority.LeaderTrade` queueing over the conversation panel. If same-priority layering is unstable, call an explicit panel hook that demotes the panel to its existing static presentation while preserving its transcript and driver state, then restore the prior presentation when the deal screen closes. No context may remain hidden in the popup queue.

   Make the ordinary request-table LuaEvent callable from FireTuner. Ship full-category mock requests for empty authoring, incoming, own-open, view-only, delayed success, and delayed error. Do not add a production keybind.

## Reuse

- VP `(3a)` `TradeLogic.lua`, included unchanged when the probes pass
- `DiploTrade.xml`, copied under a unique name with wrapper controls added
- `UI_bc1/Improvements/DiploTrade.lua`, used only as a reference for native context wiring
- Native `LeaderMessageHandler`, `DoUpdateButtons`, `DisplayDeal`, and `SubStackHandler` interaction patterns
- `mcp-server/lua/inspect-deal.lua` mappings for `resolveItem`, duration lookup, and Coop War eligibility
- `mcp-server/src/utils/deal-schema.ts` and `deal-metadata.ts` as the canonical payload and promise vocabulary
- `VoxDeorumSeat.EffectiveSeat` and the panel's existing presentation patterns

## Verification

### Packaging and static checks

1. Run `python civ5-mod/update_md5.py`; a second run reports every hash current.
2. Confirm `VoxDeorum.modinfo` registers the XML add-in, Lua files as imported, and XML as not imported.
3. Confirm no file under `civ5-mod` is named `TradeLogic.lua`.
4. Deploy with `civ5-mod/deploy.bat` and inspect `Lua.log` after every live scenario.

### Live game checks

1. Run the day-one seam probes. Record whether the preferred include path or renamed fallback is active, and verify stock screens before, during, and after the Vox screen.
2. Exercise all four explicit modes. Confirm view mode has no editable native or promise control. Confirm modified incoming terms or a typed outgoing counter message disable Accept. Confirm Propose and Counter reject a message-only or empty deal with a localized reason.
3. Round-trip every supported ordinary item family through `DealPayload -> scratch -> DealPayload`, including amount changes and removal. Use an AI-politics-only term to prove that it is enabled, added, changed through a proxy-side rebuild, serialized, and locally valid under h2h semantics. Try an invalid gold, GPT, and resource amount; each refusal must preserve the prior term and amount.
4. Confirm the native value bar changes after edits but remains advisory. A structurally legal deal may still submit while the bar says `Impossible`.
5. Exercise all five authorable promise kinds. Check the three promise-duration getters, `GameDefines.COOP_WAR_SOON_COUNTER`, the absent `NO_DIGGING` duration, directed standing promises, one-row Coop War presentation, symmetric payload twins, eligible targets, and removal of both twins.
6. Confirm the public message input is sanitized, `rationale` never appears in client-authored output, and a mock error preserves both terms and message.
7. While a draft is open, invoke the existing `inspect-deal` development tool to replace the global scratch contents. The next UI interaction restores the visible draft. Repeat while adding, changing, and removing a term to prove legitimate native edits are not rolled back.
8. Test normal play, a pinned human strategist, and a pure observer. Legality, value, columns, serialization actor, and from/to participants must all use the effective seat. Treat any native crash or unsupported observer-slot assumption as a stage blocker, not a reason to silently disable the pinned capability.
9. Test both animated-leader and static-panel backgrounds, same-priority reopen, ESC, Cancel, Back, mock success, and mock error. The chat panel returns with its transcript and state intact.
10. Confirm there is no bridge traffic during editing, no native enactment, and no Lua errors.

## Risks and resolution paths

- **Context facade isolation:** if context-local rebinding cannot be proven, use the renamed fallback file.
- **Callback or event replacement:** if native callbacks or the clear event remain active, omit those registrations in the fallback file.
- **Pure-observer native assumptions:** this stage must prove the pinned full-deal capability against the concrete observer slot. A failure requires a plan-level design decision before stage 7.04.
- **Shared scratch races:** the draft remains authoritative, and the fingerprint state machine restores only unexpected mismatches.
- **Payload sizing:** the 48 KiB estimator is conservative. Stage 7.03 owns the real 64 KiB serializer capacity and overflow failure.

## Out of scope

- Runtime bridge or server event wiring
- Server-side legality, stale-proposal, thread-lock, or closed-turn enforcement
- Transcript writes and proposal reduction changes
- Deal enactment
- Per-item valuation or changes to `CvDealAI`
- New automated test infrastructure for `civ5-mod`

## Done when

The native-shaped deal screen works in a live game for every explicit mode and effective-seat flavor, with all ordinary terms using h2h legality, the five canonical promises, advisory native valuation, safe scratch recovery, message authoring, pending/error feedback, and exact `DealPayload` v1 serialization. Every action stops at the mock driver, and native diplomacy screens remain unchanged.
