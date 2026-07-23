# Stage 7.02: civ5-mod + civ5-dll: interactive deal editor on mock data

> Part of the stage-7 sub-plan ([specs.md](specs.md); index [../07-ingame-panel.md](../07-ingame-panel.md)). This stage builds the game-side screen and its local legality checks. It uses a delayed mock driver only: it does not write transcript rows, call the bridge, or enact a deal. Stage 7.04 replaces the driver with transport.

## Objective

Reuse the VP EUI trade screen for authoring and editing every active deal. Incoming and own proposals mount their normalized `DealPayload` into the native editor, where the scratch deal presents the editable ordinary draft and the wrapper presents editable promises.

The screen supports three modes and seven footer states:

| Mode and draft state | Content | Actions |
|---|---|---|
| `author` | An empty native editor at peace, or an editor seeded with paired peace treaties at war | Propose, Cancel |
| `incoming`, unchanged | The counterpart's mounted proposal | Accept, Reject, Cancel |
| `incoming`, filtered and untouched | The legal remainder of the counterpart's proposal | Counter, Reject, Cancel |
| `incoming`, changed | An edited counterpart proposal | Counter, Reset, Cancel |
| `own`, unchanged | The player's mounted proposal | Retract, Cancel |
| `own`, filtered and untouched | The legal remainder of the player's proposal | Counter, Retract, Cancel |
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

`VoxDeorumOpenDealScreen` accepts `{ counterpartID, mode, deal?, proposalMessageID? }`. `mode` is `author`, `incoming`, or `own`. Incoming and own requests require a schema-valid `deal`, an open proposal ID, and an atomic wire shape with one entry per directional promise or exactly one Coop War entry in each direction. The mount validates that the counterpart is a living major civilization, binds `actorID = VoxDeorumSeat.EffectiveSeat()`, checks the raw promise shape, normalizes the editable deal, removes `rationale`, and rejects malformed requests before showing the context. It then calls `VoxDeorumOpenDeal(actorID, counterpartID)` while the TradeLogic context is hidden and requires a true result before calling `ContextPtr:SetHide(false)`. Showing the context first is invalid because TradeLogic computes its third-party trade controls during the show handler from the bound native participants.

The screen exposes `VoxDeorumDealUI.driver.onAction(action)` and `VoxDeorumDealUI.resolve(result)`, and listens for `LuaEvents.VoxDeorumDealActionResolved(result)`. It enters a visible pending state before calling the driver. A successful result closes the screen. An error restores the same mounted editor, including its items, promises, and original public message. If the driver does not resolve within 10 seconds, the screen restores that editor with a timeout error. Escape is consumed while an action is pending so the screen cannot close around an unresolved request.

The stage-7.02 mock driver has nine FireTuner scenarios: `author`, `incoming`, `own`, `success`, `error`, `unavailable`, `own-unavailable`, `coop-war`, and `coop-war-wire-invalid`. The unavailable variants contain normal terms plus a schema-valid city ID that native projection refuses and a correctly paired Coop War whose target is one of the principals, so normal projection filters both groups. `coop-war` carries the required paired wire entries, while `coop-war-wire-invalid` carries only one direction and must be rejected at mount. Both Coop War scenarios require a third living major and do not open when none exists. Existing presentation scenarios and the valid Coop War case request their mock-only legality bypass; the unavailable variants use normal filtering. The panel exposes only the incoming unavailable button. Stage 7.04 replaces the mock include only.

The panel reducer and the stage-7 specifications must use the same three-mode contract. They keep historical cards visible and disable their open callbacks. The action driver keeps the canonical action vocabulary: propose, counter, accept, and reject. Local Retract maps to reject in stage 7.04.

## Screen behavior

### Mounting a proposal

All modes use the normal native editor. Author starts with an empty promise list and blank optional outgoing message. At war, `VoxDeorumOpenDeal` seeds paired peace treaties, which remain part of the author draft. Incoming and own retain immutable original items and promises, use group-aware projection to place only legal commitments into `g_Deal`, and retain the original public message in the speech bubble.

Projection retains only fully accepted logical groups. Paired Defensive Pact, Research Agreement, Peace Treaty, and Declaration of Friendship directions are atomic, as are promise commitments and Coop War twins. When any group is unavailable, it is omitted from the mounted draft and the concise removal notice has deduplicated reasons in its initial tooltip. Both incoming and own proposals enter Counter state while preserving Reject or Retract until the first manual edit. The first native edit, promise edit, or outgoing message dismisses the notice and exposes Reset. Aggregate native validation is different: it retains every legal-looking term with normal colors, shows the generic combination reason, and disables Accept or Counter.

The mount records the immutable proposal and a filtered-baseline semantic fingerprint. Automatic filtering requires Counter even without a manual edit. Editing native ordinary items, wrapper promises, or the outgoing message keeps Counter active and changes the footer to Counter, Reset, and Cancel. Reset is local only: it reprojects and refilters the immutable proposal, restores the legal promises, clears the outgoing message and transient status, collapses the promise categories, clears Coop War target selection, and captures a fresh filtered baseline. If nothing is now removed, Reset restores the normal Accept or Retract footer. Cancel always closes without a driver action.

Every mount shows the normal native trade rows, the original public message, the native advisory value bar, and the wrapper-owned promise category. Author and all counter drafts also show a one-line optional message field between the deal tables and footer, with its prompt inside the empty field. Client-authored messages remove `rationale`, trim whitespace, and strip the named-pipe delimiter before serialization.

### Editor actions

Every submission first verifies that the effective seat has not changed. Accept and Counter run group-aware projection again. Newly unavailable groups replace the visible draft, require Counter, show the removal notice, and cancel that click for review. Aggregate-only failure retains the draft and disables the action. Propose keeps its existing strict validation. Successful authored actions require at least one term or promise, sanitize the message, and build the DealPayload v1 payload. Counter sends the filtered or edited payload with `expectedProposalID` set to the mounted proposal ID.

Accept is available only for an unchanged, unfiltered incoming draft. Its pre-submit projection detects drift before sending, and moves the screen to Counter when groups were removed. Reject and Retract carry the mounted proposal ID. Retract remains a local driver action that maps to reject in stage 7.04. Reset and Cancel never reach the driver.

Pending state uses `VoxPendingCover` to disable the editor and leaves its draft mounted. A failed action restores that exact editor. The screen never calls `Deal:Enact()` or writes a transcript row.

## Ordinary-item validation and scratch ownership

`projectItems` validates and normalizes the ordinary terms, groups bilateral commitments, and starts from an empty scratch deal with the mounted participants. It adds one logical group at a time through the direct native constructors, then compares the decoded scratch fingerprint with the complete expected fingerprint. A refused or partially accepted group is omitted, and the scratch deal is rebuilt from the groups already accepted.

The mount boundary rejects duplicate wire commitments and requires exactly one Coop War entry in each direction. `projectProposal` applies the same atomic grouping to normalized editor promises and removes unavailable commitments as a group. It returns the legal visible items and promises, deduplicated removal reasons, and a separate aggregate-combination reason. Reset reprojects the immutable proposal. Scratch-clobber recovery and pre-submit checks reproject the current visible draft through the same path. Rendering never accumulates stale removal reasons.

Add a guarded `Deal:AreAllTradeItemsValid([bTreatAsHumanToHuman])` Lua binding in `CvLuaDeal`. It calls `CvDeal::AreAllTradeItemsValid` and defaults the optional flag to false. Register it under the same `MOD_ACTIVE_DIPLOMACY` guard as the native final-validation capability. The wrapper always passes true. This preserves the DLL's finalizing checks without duplicating its per-item argument layout in Lua.

In every mounted mode, the wrapper decodes the scratch after TradeLogic button-update hooks and stores the composite signature as the expected signature. A throttled update check compares the live signature with the expected signature. When `inspect-deal` or another caller has clobbered the shared scratch, the wrapper reprojects the current draft and redraws its legal remainder. Any newly removed groups require review in Counter state. Mounting and rebuild guards prevent wrapper redraws from being treated as clobbers.

## Promise validation and editing

Promises remain wrapper-owned. `evaluatePromises` is used by group-aware projection, promise-pocket enablement, mounted refreshes, Accept, Propose, and Counter. Projection returns the legal commitments and deduplicated reasons for dropped logical groups.

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

The native hide path clears the active human-to-human flag and records a one-shot resume token when a mounted Vox editor is merely covered by another popup. Repeated hide notifications preserve that token. On re-show, the wrapper synchronously reprojects its draft if the scratch signature changed, then calls `VoxDeorumResumeHumanToHumanEditor()`. The hook validates the visible context, both live major participants, and the restored scratch deal endpoints before restoring the flag. A successful resume redraws the native controls and wrapper rows so legality, filtering, edit events, and promise controls continue working after popup occlusion.

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
4. Historical and settled cards remain readable but inert. A valid incoming or own proposal keeps its normal Accept or Retract footer. An unavailable ordinary or promise group is omitted, the short removal notice appears, and the legal remainder starts in Counter state with Reject or Retract still available. Confirm the native table uses normal colors.
5. Edit an incoming and own filtered mount. Confirm the third action changes from Reject or Retract to Reset after a native, promise, or message edit. Confirm Reset clears the outgoing message, refilters the immutable proposal, collapses expanded promise categories, and restores the filtered footer. Confirm Counter carries only visible legal content with the mounted expected proposal ID.
6. Round-trip every ordinary item family through group-aware projection and scratch decoding. Test constructor refusal, a partially accepted symmetric pair, aggregate final-validation failure, and clobber recovery. Confirm aggregate-only failure retains every term, uses normal colors, and disables Accept or Counter without forcing Counter state.
7. Test all promise failures: invalid principals, direction, type, or duration; duplicate commitments; existing Military, Expansion, and Border promises; duplicate No Digging; invalid, unmet, or already-preparing Coop War targets; and missing promise APIs. Confirm invalid groups disappear, both Coop War twins are atomic, and a pre-existing No Digging alone remains legal.
8. Test every promise in the native category, including category expansion, inline Coop War target selection, one visible Coop War commitment on each table, target filtering, and removal. Confirm category expansion survives native display refresh and resets on reopening the screen. Confirm promises are rechecked and filtered before Counter or Accept.
9. Test Declaration of Friendship and human-to-human gold, GPT, and resource amount edits in both directions. Invalid amounts retain the prior native value.
10. Test author, incoming, and own states with normal play and a pinned human strategist. Run the unchanged normal-seat mock in a pure-observer session only to confirm presentation; it is not proof of live deal support. Confirm the effective seat supplies participants, legality, value, presentation columns, and serialized actor for supported seats. Confirm mock success closes after the delayed result, mock error preserves the mounted editor, and neither produces bridge traffic or native enactment.
11. Confirm the mount calls `VoxDeorumOpenDeal` before showing the TradeLogic context. A call made while the context is already visible returns false without changing the native trade state. On a first-ever correctly ordered open, third-party war and peace controls use the mounted participants without a Lua error. Confirm author mode begins with no ordinary items at peace and with required paired peace treaties at war.
12. Remove the wrapper's update listener, then force a TradeLogic refresh and confirm stock Propose and Cancel remain disabled. Restore the listener and confirm it synchronously reconfigures the footer and invokes only wrapper callbacks for each mounted state.
13. Cover a mounted deal screen with another popup, then return to it. Confirm human-to-human legality, group filtering, native edit decoding, clobber recovery, and promise rows and pockets remain active after re-show.

## Out of scope

- Runtime bridge and server-event wiring
- Transcript writes, proposal reduction, and deal enactment
- Server-side stale-proposal, thread-lock, closed-turn, and authoritative legality checks
- Per-item valuation changes or `CvDealAI` changes
- New automated test infrastructure for `civ5-mod`
