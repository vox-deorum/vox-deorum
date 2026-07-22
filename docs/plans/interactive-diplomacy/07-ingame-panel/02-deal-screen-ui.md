# Stage 7.02: civ5-mod + civ5-dll: interactive deal editor on mock data

> Part of the stage-7 sub-plan ([specs.md](specs.md); index [../07-ingame-panel.md](../07-ingame-panel.md)). This stage builds the game-side screen and its local legality checks. It uses a delayed mock driver only: it does not write transcript rows, call the bridge, or enact a deal. Stage 7.04 replaces the driver with transport.

## Objective

Reuse the VP EUI trade screen for authoring and editing every active deal. Incoming and own proposals mount their normalized `DealPayload` into the native editor, where the scratch deal presents the editable ordinary draft and the wrapper presents editable promises.

The screen supports three modes and five footer states:

| Mode and draft state | Content | Actions |
|---|---|---|
| `author` | An empty native editor at peace, or an editor seeded with paired peace treaties at war | Propose, Cancel |
| `incoming`, unchanged | The counterpart's mounted proposal | Accept, Reject, Cancel |
| `incoming`, changed | An edited counterpart proposal | Counter, Reset, Cancel |
| `own`, unchanged | The player's mounted proposal | Retract, Cancel |
| `own`, changed | An edited own proposal | Counter, Reset, Cancel |

Only an active open proposal card opens the screen. Settled, rejected, accepted, enacted, and superseded cards remain readable in the transcript but are not clickable. There is no View mode.

The implementation must:

- use human-to-human structural legality for native availability, constructors, and amount changes;
- retain the native deal-value bar as advisory information;
- make the five canonical promises a normal editor category;
- preserve every mounted draft when another caller reuses the global scratch deal;
- act through the effective seat in normal and human-strategist games, while keeping the mock seat-agnostic; and
- leave the native VP trade screen unchanged when the Vox screen is not open.

## Existing contracts and boundaries

`VoxDeorumDealUtils.lua` remains the DealPayload v1 helper. Its normalize, validation, duration, fingerprint, and text-sanitization helpers are the single Lua representation of ordinary items and promises.

`VoxDeorumOpenDealScreen` accepts `{ counterpartID, mode, deal?, proposalMessageID? }`. `mode` is `author`, `incoming`, or `own`. Incoming and own requests require a schema-valid `deal` and an open proposal ID. The mount validates that the counterpart is a living major civilization, binds `actorID = VoxDeorumSeat.EffectiveSeat()`, normalizes the deal, removes `rationale`, and rejects malformed requests before showing the context. It then calls `VoxDeorumOpenDeal(actorID, counterpartID)` while the TradeLogic context is hidden and requires a true result before calling `ContextPtr:SetHide(false)`. Showing the context first is invalid because TradeLogic computes its third-party trade controls during the show handler from the bound native participants.

The screen exposes `VoxDeorumDealUI.driver.onAction(action)` and `VoxDeorumDealUI.resolve(result)`, and listens for `LuaEvents.VoxDeorumDealActionResolved(result)`. It enters a visible pending state before calling the driver. A successful result closes the screen. An error restores the same mounted editor, including its items, promises, and original public message. If the driver does not resolve within 10 seconds, the screen restores that editor with a timeout error. Escape is consumed while an action is pending so the screen cannot close around an unresolved request.

The stage-7.02 mock driver has five FireTuner scenarios: `author`, `incoming`, `own`, `success`, and `error`. The `success` and `error` scenarios mount the same populated incoming proposal used for UI testing; their private `mockResult` field only selects the delayed driver outcome after an action. Remove the View scenario and its hidden panel trigger. Stage 7.04 replaces the mock include only.

The panel reducer and the stage-7 specifications must use the same three-mode contract. They keep historical cards visible and disable their open callbacks. The action driver keeps the canonical action vocabulary: propose, counter, accept, and reject. Local Retract maps to reject in stage 7.04.

## Screen behavior

### Mounting a proposal

All modes use the normal native editor. Author starts with an empty promise list and blank optional outgoing message. At war, `VoxDeorumOpenDeal` seeds paired peace treaties, which remain part of the author draft. Incoming and own copy the original promises, best-effort project every normalized original ordinary term into `g_Deal`, decode the resulting visible draft, and retain the original public message in the speech bubble.

Best-effort projection never clears successfully mounted terms when one constructor refuses an original term. It records each unavailable original item with its reason and probes `AreAllTradeItemsValid(true)` for an additional combination-level reason. Initial reasons appear in the status line and tooltip. A native update dismisses the tooltip only when the decoded scratch signature differs from the expected signature, so the show-time redraw leaves it visible and the first real edit closes it permanently for the mount. An unavailable promise row is red. Aggregate native validation cannot identify one ordinary culprit, so every visible ordinary term and its amount or duration controls are red while the combination is illegal. Accept is disabled while any original item is unprojected, the mounted combination is unavailable, or an original promise is unavailable. Reject, Retract, and Cancel remain available.

The mount records a normalized item-and-promise semantic fingerprint. Editing either native ordinary items or wrapper promises changes the footer to Counter, Reset, and Cancel. Recreating the original normalized state returns to the unchanged footer. Reset is local only: it reprojects the original items, restores the original promises, clears the outgoing message and status, collapses the promise categories, clears Coop War target selection, and captures a new baseline fingerprint. Cancel always closes without a driver action. There is no review surface, counter sub-mode, or Back action.

Every mount shows the normal native trade rows, the original public message, the native advisory value bar, and the wrapper-owned promise category. Author and changed counter drafts also show a one-line optional message field between the deal tables and footer, with its prompt inside the empty field. Client-authored messages remove `rationale`, trim whitespace, and strip the named-pipe delimiter before serialization.

### Editor actions

Propose and Counter first verify that the effective seat has not changed. They decode the current ordinary draft, strictly validate ordinary items and promises, require at least one ordinary item or promise, sanitize the message, and build the DealPayload v1 payload. Counter is available only for a non-author changed draft and sends the edited payload with `expectedProposalID` set to the mounted proposal ID.

Accept is available only for an unchanged incoming draft. It strictly revalidates the original items while retaining the scratch deal, revalidates original promises, and sends the mounted proposal ID only. Reject and Retract carry the mounted proposal ID. Retract remains a local driver action that maps to reject in stage 7.04. Reset and Cancel never reach the driver.

Pending state uses `VoxPendingCover` to disable the editor and leaves its draft mounted. A failed action restores that exact editor. The screen never calls `Deal:Enact()` or writes a transcript row.

## Ordinary-item validation and scratch ownership

Projection has strict and best-effort paths. Strict evaluation is transactional for final submission. Best-effort projection mounts incoming and own proposals in the native editor even when an original term has become unavailable, and separately restores an edited draft after failed submission validation.

`evaluateItems(items, retainScratch)` performs the following work:

1. Validate and normalize the item array for the bound actor and counterpart.
2. Clear `g_Deal`, then set its from and to participants before any constructor call.
3. Add every normalized item through the existing direct `Add*` mapping with the human-to-human argument enabled. Record the scratch item count before and after each add so a silently refused constructor identifies the affected item.
4. Decode the resulting scratch deal and compare its composite signature with the intended projection. The signature contains `GetFromPlayer()`, `GetToPlayer()`, and `VoxDeorumDealUtils.ItemFingerprint(items)`, so a changed participant pair is detected even for an empty draft.
5. Call `g_Deal:AreAllTradeItemsValid(true)`. A false result makes the ordinary-item set unavailable even if each constructor succeeded. If no single item can be identified, mark the ordinary terms unavailable with one combination-level reason.
6. Clear the scratch deal on every error or failed validation. Retain it only when `retainScratch` is true and the complete evaluation succeeded.

The best-effort projection primitive uses the same direct `Add*` mapping but does not clear the scratch after a failed term. It returns a fresh failure list, decodes every successfully mounted item, records the expected scratch signature, and probes aggregate native validation. Baseline projection replaces only immutable mounted-proposal failures and clears transient draft failures. Draft restoration replaces only failures from the current edited draft. Reset recomputes the baseline list, while clobber fallback replaces the draft list. Rendering combines the two current lists without accumulating prior attempts.

Add a guarded `Deal:AreAllTradeItemsValid([bTreatAsHumanToHuman])` Lua binding in `CvLuaDeal`. It calls `CvDeal::AreAllTradeItemsValid` and defaults the optional flag to false. Register it under the same `MOD_ACTIVE_DIPLOMACY` guard as the native final-validation capability. The wrapper always passes true. This preserves the DLL's finalizing checks without duplicating its per-item argument layout in Lua.

In every mounted mode, the wrapper decodes the scratch after TradeLogic button-update hooks and stores the composite signature as the expected signature. A throttled update check compares the live signature with the expected signature. When `inspect-deal` or another caller has clobbered the shared scratch, the wrapper first tries strict reconstruction from `draftItems`, then falls back to best-effort draft restoration so the visible editor remains usable and exposes any newly unavailable terms. Mounting and rebuild guards prevent wrapper redraws from being treated as clobbers.

## Promise validation and editing

Promises remain wrapper-owned. `evaluatePromises(promises, actorID, counterpartID)` is used for mounted baseline gating, promise-pocket enablement, Accept, Propose, and Counter. It returns an availability result and a reason for each failed logical promise.

The check requires a known promise type, a canonical duration, and two distinct valid deal endpoints. The counterpart must be a living major civilization. The actor must be the current effective seat, which is a normal major seat or a pinned strategist seat for supported live deal flows. A pure observer whose concrete slot falls outside native `CvDeal` participant limits does not enter this screen for a live deal. The promiser and recipient must be those two endpoints in one of the two valid directions. Duplicate logical commitments are invalid. A normalized Coop War twin pair is one commitment for duplicate checks and one visible commitment in the editor.

Promise-specific checks are:

- `MILITARY`, `EXPANSION`, and `BORDER` are unavailable while the appropriate `GetNumTurns*Promise` query reports an existing commitment for that direction.
- `NO_DIGGING` may be proposed again when it is already active, because enactment is idempotent. A duplicate `NO_DIGGING` entry within one payload is still invalid.
- `COOP_WAR` requires a living major target distinct from both principals, mutual contact with the target, `IsValidCoopWarTarget(target, false)` in both directions, and neither direction in `COOP_WAR_STATE_PREPARING`.
- A missing or throwing game API makes the affected promise unavailable. It does not assume legality.

The copied trade-screen XML adds a collapsed Promises category at the end of both native pocket stacks. Expanding it shows the five promise kinds. Coop War expands an inline sibling target stack below the category. The native table stacks contain a hidden Promises group that becomes visible when it has rows. Directional promises appear on the promiser's table. A normalized Coop War commitment appears once on each table, matching native symmetric items. Rows show the label, target when applicable, and duration, and click to remove the commitment, including both Coop War twins. The editor disables unavailable choices with their reasons. Adding and removing promises updates `draftPromises`, normalizes Coop War twins, and refreshes the shared trade-screen display cycle.

## Native VP and DLL seams

The Vox context includes `civ5-dll/(3a) VP - EUI Compatibility Files/LUA/TradeLogic.lua` directly. It has no facade, proxy, or copied `TradeLogic.lua` under `civ5-mod`. Every change to a vendored VP Lua, XML, or DLL file has a `Vox Deorum:` marker and defaults to native behavior when the Vox state is unset.

Add a parameterized `VoxDeorumOpenDeal(actorID, counterpartID)` entry to TradeLogic. It validates both native participant IDs before mutation, requires the TradeLogic context to remain hidden, assigns the effective seat to native `g_iUs`, enables the Vox human-to-human flag, initializes the native trade context, and refreshes it. TradeLogic display classification uses `g_iUs` while the Vox flag is active. The wrapper owns visibility, input, and driver actions. Its post-include setup removes the engine-wide trade-table clear callback, replaces the Propose and Cancel callbacks, installs the Vox input handler, and chains the native show-hide handler.

The native hide path clears the active human-to-human flag and records a one-shot resume token when a mounted Vox editor is merely covered by another popup. Repeated hide notifications preserve that token. On re-show, the wrapper synchronously reprojects its draft if the scratch signature changed, then calls `VoxDeorumResumeHumanToHumanEditor()`. The hook validates the visible context, both live major participants, and the restored scratch deal endpoints before restoring the flag. A successful resume redraws the native controls and wrapper rows so legality, red invalid-term coloring, edit events, and promise controls continue working after popup occlusion.

Pass the stored human-to-human flag to every TradeLogic `IsPossibleToTradeItem`, `GetReasonsItemUntradeable`, `Add*`, `ChangeGoldTrade`, `ChangeGoldPerTurnTrade`, and `ChangeResourceTrade` call. Preserve native AI valuation calls unchanged. Emit the existing vox-gated reset, clear-table, display, and update LuaEvents only while the Vox state is active. Before synchronously emitting `VoxDeorumTradeLogicUpdateButtons`, TradeLogic disables the native Propose and Cancel controls. The wrapper owns that update event: it replaces the callbacks, then re-enables and configures only the controls valid for the mounted state. If its listener is absent or misses a refresh, the native callbacks remain inert.

Extend the three DLL `Change*` methods and their Lua bindings with an optional trailing human-to-human argument, defaulting to false. Thread it to their native legality checks while preserving each binding's boolean return.

Keep `g_bPVPTrade` and `g_bTradeReview` false in Vox mode. Change the Declaration of Friendship visibility gate to allow `g_bPVPTrade or g_bVDHumanToHuman`, and retain the human-to-human argument on both friendship constructors. This makes the canonical term authorable without changing native player-versus-player behavior.

Copy `civ5-dll/(1) Community Patch/Core Files/Overrides/DiploTrade.xml` to `civ5-mod/UI/VoxDeorumDealScreen.xml` under its unique context name. Keep every control and template TradeLogic needs, add the wrapper-owned message, status, third action button, native-stack promise category and table rows, and mark every divergence from the copied source. Assert that the EUI `GenerationalInstanceManager` is available after including TradeLogic.

The native value bar remains visible in every mounted editor. It is advisory only: political valuation, including a native `Impossible` label, never blocks a structurally legal proposal or counter.

## Packaging and verification

The modified (3a) TradeLogic file ships through `scripts/installer.iss`, not through `civ5-mod/deploy.bat`. During development, copy that file to the game's matching VP EUI mod folder. DLL changes use the existing DLL build. The mod XML, Lua, text, mock, and modinfo changes use the normal `civ5-mod/update_md5.py` and deploy flow.

Verify the following before stage 7.04:

1. The modinfo entries name existing deal-screen files, the MD5 update is clean on a second run, and no `TradeLogic.lua` exists under `civ5-mod`.
2. Every vendored-file divergence has a `Vox Deorum:` marker. A diff of the screen XML against its source identifies only the marked Vox additions.
3. A normal VP AI trade screen is unchanged when Vox is closed: pockets, tooltips, gold, GPT, resources, cities, third-party war and peace, propose, accept, refuse, AI demands, and ESC all behave normally. No Vox TradeLogic event fires there, and the Vox context is hidden at game start.
4. Historical and settled cards remain readable but inert. An active incoming or own card mounts its ordinary terms in the native editor and its promises in the native category. Current original-term unavailability is surfaced with a reason, disables Accept, and leaves Reject, Retract, and Cancel available. Confirm illegal visible terms are red and the initial validation tooltip closes on the first edit without returning during that mount.
5. Edit an incoming and own mount. Confirm each edit changes the footer to Counter, Reset, and Cancel. Enter a message and produce a visible status, then confirm Reset clears both, collapses expanded promise categories, restores the original fingerprint and unchanged footer, and prevents the stale message from returning after another edit. Confirm Counter carries the edited draft with the mounted expected proposal ID.
6. Round-trip every ordinary item family through strict and best-effort projection and scratch decoding. Test constructor refusal, composite-signature mismatch, aggregate final-validation failure, and clobber recovery. Confirm best-effort projection preserves successful terms and that an empty draft detects participant changes.
7. Test all promise failures: invalid principals, direction, type, or duration; duplicate commitments; existing Military, Expansion, and Border promises; duplicate No Digging; invalid, unmet, or already-preparing Coop War targets; and missing promise APIs. Confirm a pre-existing No Digging alone remains legal.
8. Test every promise in the native category, including category expansion, inline Coop War target selection, one visible Coop War commitment on each table, target filtering, and removal. Confirm category expansion survives native display refresh and resets on reopening the screen. Confirm promises are rechecked before every authored submission.
9. Test Declaration of Friendship and human-to-human gold, GPT, and resource amount edits in both directions. Invalid amounts retain the prior native value.
10. Test author, incoming, and own states with normal play and a pinned human strategist. Run the unchanged normal-seat mock in a pure-observer session only to confirm presentation; it is not proof of live deal support. Confirm the effective seat supplies participants, legality, value, presentation columns, and serialized actor for supported seats. Confirm mock success closes after the delayed result, mock error preserves the mounted editor, and neither produces bridge traffic or native enactment.
11. Confirm the mount calls `VoxDeorumOpenDeal` before showing the TradeLogic context. A call made while the context is already visible returns false without changing the native trade state. On a first-ever correctly ordered open, third-party war and peace controls use the mounted participants without a Lua error. Confirm author mode begins with no ordinary items at peace and with required paired peace treaties at war.
12. Remove the wrapper's update listener, then force a TradeLogic refresh and confirm stock Propose and Cancel remain disabled. Restore the listener and confirm it synchronously reconfigures the footer and invokes only wrapper callbacks for each mounted state.
13. Cover a mounted deal screen with another popup, then return to it. Confirm human-to-human legality, invalid-term coloring, native edit decoding, clobber recovery, and promise rows and pockets remain active after re-show.

## Out of scope

- Runtime bridge and server-event wiring
- Transcript writes, proposal reduction, and deal enactment
- Server-side stale-proposal, thread-lock, closed-turn, and authoritative legality checks
- Per-item valuation changes or `CvDealAI` changes
- New automated test infrastructure for `civ5-mod`
