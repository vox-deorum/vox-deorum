# Stage 7.02: civ5-mod + civ5-dll: interactive deal editor on mock data

> Part of the stage-7 sub-plan ([specs.md](specs.md); index [../07-ingame-panel.md](../07-ingame-panel.md)). This stage builds the game-side screen and its local legality checks. It uses a delayed mock driver only: it does not write transcript rows, call the bridge, or enact a deal. Stage 7.04 replaces the driver with transport.

## Objective

Reuse the VP EUI trade screen for authoring and countering deals. An active proposal is reviewed directly from its normalized `DealPayload`, so its displayed terms never depend on the mutable global scratch deal. The scratch deal is used only to validate and edit ordinary terms.

The screen supports three states:

| State | Content | Actions |
|---|---|---|
| `author` | An empty native editor at peace, or an editor seeded with paired peace treaties at war | Propose, Cancel |
| `incoming` | The counterpart's immutable proposal | Accept, Counter, Reject |
| `own` | The player's immutable proposal | Counter, Retract |

Only an active open proposal card opens the screen. Settled, rejected, accepted, enacted, and superseded cards remain readable in the transcript but are not clickable. There is no View mode.

The implementation must:

- use human-to-human structural legality for native availability, constructors, and amount changes;
- retain the native deal-value bar as advisory information;
- make the five canonical promises a normal editor category;
- preserve independent author and counter drafts when another caller reuses the global scratch deal;
- act through the effective seat in normal and human-strategist games, while keeping the mock seat-agnostic; and
- leave the native VP trade screen unchanged when the Vox screen is not open.

## Existing contracts and boundaries

`VoxDeorumDealUtils.lua` remains the DealPayload v1 helper. Its normalize, validation, duration, fingerprint, and text-sanitization helpers are the single Lua representation of ordinary items and promises.

`VoxDeorumOpenDealScreen` accepts `{ counterpartID, mode, deal?, proposalMessageID? }`. `mode` is `author`, `incoming`, or `own`. Incoming and own requests require a schema-valid `deal` and an open proposal ID. The mount validates that the counterpart is a living major civilization, binds `actorID = VoxDeorumSeat.EffectiveSeat()`, normalizes the deal, removes `rationale`, and rejects malformed requests before showing the context. It then calls `VoxDeorumOpenDeal(actorID, counterpartID)` while the TradeLogic context is hidden and requires a true result before calling `ContextPtr:SetHide(false)`. Showing the context first is invalid because TradeLogic computes its third-party trade controls during the show handler from the bound native participants.

The screen exposes `VoxDeorumDealUI.driver.onAction(action)` and `VoxDeorumDealUI.resolve(result)`, and listens for `LuaEvents.VoxDeorumDealActionResolved(result)`. It enters a visible pending state before calling the driver. A successful result closes the screen. An error returns to the same author editor, counter editor, or proposal review with its reason visible.

The stage-7.02 mock driver has five FireTuner scenarios: `author`, `incoming`, `own`, `success`, and `error`. Remove the View scenario and its hidden panel trigger. Stage 7.04 replaces the mock include only.

The panel reducer and the stage-7 specifications must use the same three-mode contract. They keep historical cards visible and disable their open callbacks. The action driver keeps the canonical action vocabulary: propose, counter, accept, and reject. Local Retract maps to reject in stage 7.04.

## Screen behavior

### Proposal review

Incoming and own proposals display the normalized original payload in wrapper-owned two-column rows, with the original public message. The rows are the source of truth for the review screen. They do not decode, project, or render from `g_Deal`.

Every review mounts an `InteractionBlocker` box over the native deal body and promise controls. The blocker consumes mouse input and is below the footer, so the native controls cannot mutate the scratch deal while the footer actions remain available. It also covers the body while an action is pending. No per-control view-state logic is needed.

Review runs the ordinary-item and promise legality checks immediately. An unavailable ordinary row or promise is visibly styled as unavailable and receives its reason as a tooltip. If any original term is unavailable, Accept and Counter are disabled. Reject and Retract remain enabled. The same checks run again when the player selects Accept or Counter, because the game state can change after the screen opens.

Accept sends the mounted proposal ID only. Reject sends the mounted proposal ID only. Retract is a local driver action that carries the mounted proposal ID and later maps to reject. None of these actions serializes a local draft.

### Entering and leaving the editor

Author mode enters the native editor with an empty promise list and a blank optional outgoing message. At peace, it has no ordinary items. When the two teams are at war, `VoxDeorumOpenDeal` automatically seeds the paired native peace treaties. Those terms remain part of the draft and are required for the deal to validate.

Counter first rechecks the immutable proposal. If every ordinary item and promise is legal, `evaluateItems` projects the normalized original ordinary items into the scratch and retains that successful projection. The counter editor takes its ordinary draft from the decoded scratch, its promise draft from the normalized original promises, and starts with a blank outgoing message. It then hides the blocker and exposes the native controls.

Back from a counter editor discards the editor draft, clears the scratch deal, and returns to the immutable proposal review. Cancel from author closes the screen. The screen clears the scratch and local state on close.

Author and counter editors show the normal native trade rows, an optional one-sentence outgoing-message field, the native advisory value bar, and the wrapper-owned promise category. Client-authored messages remove `rationale`, trim whitespace, and strip the named-pipe delimiter before serialization.

### Editor actions

Propose and Send Counter first verify that the effective seat has not changed. They decode the current ordinary draft, run `evaluateItems` and `evaluatePromises`, require at least one ordinary item or promise, sanitize the message, and build the DealPayload v1 payload.

Propose sends a deal action without a proposal ID. Send Counter sends the deal action with `expectedProposalID` set to the mounted proposal ID. The driver action keeps the proposal ID separate from the payload so the stage-7.04 stale-proposal guard can require the exact proposal being countered.

Pending state disables the editor through the blocker and leaves its draft mounted. A failed action restores that exact editor. The screen never calls `Deal:Enact()` or writes a transcript row.

## Ordinary-item validation and scratch ownership

Projection is a transactional operation for ordinary-item validation, counter-editor seeding, editor restoration, and final submission. It is never used to present a proposal.

`evaluateItems(items, retainScratch)` performs the following work:

1. Validate and normalize the item array for the bound actor and counterpart.
2. Clear `g_Deal`, then set its from and to participants before any constructor call.
3. Add every normalized item through the existing direct `Add*` mapping with the human-to-human argument enabled. Record the scratch item count before and after each add so a silently refused constructor identifies the affected item.
4. Decode the resulting scratch deal and compare its composite signature with the intended projection. The signature contains `GetFromPlayer()`, `GetToPlayer()`, and `VoxDeorumDealUtils.ItemFingerprint(items)`, so a changed participant pair is detected even for an empty draft.
5. Call `g_Deal:AreAllTradeItemsValid(true)`. A false result makes the ordinary-item set unavailable even if each constructor succeeded. If no single item can be identified, mark the ordinary terms unavailable with one combination-level reason.
6. Clear the scratch deal on every error or failed validation. Retain it only when `retainScratch` is true and the complete evaluation succeeded.

Add a guarded `Deal:AreAllTradeItemsValid([bTreatAsHumanToHuman])` Lua binding in `CvLuaDeal`. It calls `CvDeal::AreAllTradeItemsValid` and defaults the optional flag to false. Register it under the same `MOD_ACTIVE_DIPLOMACY` guard as the native final-validation capability. The wrapper always passes true. This preserves the DLL's finalizing checks without duplicating its per-item argument layout in Lua.

In editor states only, the wrapper decodes the scratch after TradeLogic display and button-update hooks. It stores the composite signature as the expected signature. A throttled update check compares the live signature with the expected signature. When `inspect-deal` or another caller has clobbered the shared scratch, the wrapper rebuilds it from `draftItems` through `evaluateItems(..., true)`. A rebuild guard prevents its own projection from being treated as a clobber. Proposal review does not monitor or restore the scratch.

## Promise validation and editing

Promises remain wrapper-owned. `evaluatePromises(promises, actorID, counterpartID)` is used for proposal review, Accept, Counter entry, promise-pocket enablement, Propose, and Send Counter. It returns an availability result and a reason for each failed logical promise.

The check requires a known promise type, a canonical duration, and two distinct valid deal endpoints. The counterpart must be a living major civilization. The actor must be the current effective seat, which is a normal major seat or a pinned strategist seat for supported live deal flows. A pure observer whose concrete slot falls outside native `CvDeal` participant limits does not enter this screen for a live deal. The promiser and recipient must be those two endpoints in one of the two valid directions. Duplicate logical commitments are invalid. A normalized Coop War twin pair is one commitment for duplicate checks and one visible commitment in the editor.

Promise-specific checks are:

- `MILITARY`, `EXPANSION`, and `BORDER` are unavailable while the appropriate `GetNumTurns*Promise` query reports an existing commitment for that direction.
- `NO_DIGGING` may be proposed again when it is already active, because enactment is idempotent. A duplicate `NO_DIGGING` entry within one payload is still invalid.
- `COOP_WAR` requires a living major target distinct from both principals, mutual contact with the target, `IsValidCoopWarTarget(target, false)` in both directions, and neither direction in `COOP_WAR_STATE_PREPARING`.
- A missing or throwing game API makes the affected promise unavailable. It does not assume legality.

The copied trade-screen XML adds the promise pocket button, kind chooser, Coop War target chooser, and table rows to each side. Promise rows show the label, target when applicable, and duration. The editor disables unavailable choices with their reasons. Adding and removing promises updates `draftPromises`, normalizes Coop War twins, and refreshes the shared trade-screen display cycle. Review uses its immutable two-column rows rather than this editor category.

## Native VP and DLL seams

The Vox context includes `civ5-dll/(3a) VP - EUI Compatibility Files/LUA/TradeLogic.lua` directly. It has no facade, proxy, or copied `TradeLogic.lua` under `civ5-mod`. Every change to a vendored VP Lua, XML, or DLL file has a `Vox Deorum:` marker and defaults to native behavior when the Vox state is unset.

Add a parameterized `VoxDeorumOpenDeal(actorID, counterpartID)` entry to TradeLogic. It validates both native participant IDs before mutation, requires the TradeLogic context to remain hidden, assigns the effective seat to native `g_iUs`, enables the Vox human-to-human flag, initializes the native trade context, and refreshes it. TradeLogic display classification uses `g_iUs` while the Vox flag is active. The wrapper owns visibility, input, and driver actions. Its post-include setup removes the engine-wide trade-table clear callback, replaces the Propose and Cancel callbacks, installs the Vox input handler, and chains the native show-hide handler.

Pass the stored human-to-human flag to every TradeLogic `IsPossibleToTradeItem`, `GetReasonsItemUntradeable`, `Add*`, `ChangeGoldTrade`, `ChangeGoldPerTurnTrade`, and `ChangeResourceTrade` call. Preserve native AI valuation calls unchanged. Emit the existing vox-gated reset, clear-table, display, and update LuaEvents only while the Vox state is active. Before synchronously emitting `VoxDeorumTradeLogicUpdateButtons`, TradeLogic disables the native Propose and Cancel controls. The wrapper owns that update event: it replaces the callbacks, then re-enables and configures only the controls valid for the mounted state. If its listener is absent or misses a refresh, the native callbacks remain inert.

Extend the three DLL `Change*` methods and their Lua bindings with an optional trailing human-to-human argument, defaulting to false. Thread it to their native legality checks while preserving each binding's boolean return.

Keep `g_bPVPTrade` and `g_bTradeReview` false in Vox mode. Change the Declaration of Friendship visibility gate to allow `g_bPVPTrade or g_bVDHumanToHuman`, and retain the human-to-human argument on both friendship constructors. This makes the canonical term authorable without changing native player-versus-player behavior.

Copy `civ5-dll/(1) Community Patch/Core Files/Overrides/DiploTrade.xml` to `civ5-mod/UI/VoxDeorumDealScreen.xml` under its unique context name. Keep every control and template TradeLogic needs, add the wrapper-owned message, status, third action button, interaction blocker, proposal-review rows, and promise controls, and mark every divergence from the copied source. Assert that the EUI `GenerationalInstanceManager` is available after including TradeLogic.

The native value bar remains visible in author and counter editors. It is advisory only: political valuation, including a native `Impossible` label, never blocks a structurally legal proposal or counter.

## Packaging and verification

The modified (3a) TradeLogic file ships through `scripts/installer.iss`, not through `civ5-mod/deploy.bat`. During development, copy that file to the game's matching VP EUI mod folder. DLL changes use the existing DLL build. The mod XML, Lua, text, mock, and modinfo changes use the normal `civ5-mod/update_md5.py` and deploy flow.

Verify the following before stage 7.04:

1. The modinfo entries name existing deal-screen files, the MD5 update is clean on a second run, and no `TradeLogic.lua` exists under `civ5-mod`.
2. Every vendored-file divergence has a `Vox Deorum:` marker. A diff of the screen XML against its source identifies only the marked Vox additions.
3. A normal VP AI trade screen is unchanged when Vox is closed: pockets, tooltips, gold, GPT, resources, cities, third-party war and peace, propose, accept, refuse, AI demands, and ESC all behave normally. No Vox TradeLogic event fires there, and the Vox context is hidden at game start.
4. Historical and settled cards remain readable but inert. An active incoming or own card opens immutable payload rows. Current illegality marks the affected ordinary term or promise unavailable, disables Accept and Counter, and leaves Reject or Retract available.
5. A state change after review opens is caught by the Accept and Counter recheck. A legal Counter seeds an editor with the exact proposal, Back returns to review, and Send Counter carries the mounted expected proposal ID.
6. Round-trip every ordinary item family through projection and scratch decoding. Test constructor refusal, composite-signature mismatch, aggregate final-validation failure, and clobber recovery. Confirm failed projection always clears the scratch and that an empty draft detects participant changes.
7. Test all promise failures: invalid principals, direction, type, or duration; duplicate commitments; existing Military, Expansion, and Border promises; duplicate No Digging; invalid, unmet, or already-preparing Coop War targets; and missing promise APIs. Confirm a pre-existing No Digging alone remains legal.
8. Test every promise in the editor, including one visible Coop War commitment with normalized twins, target filtering, and removal. Confirm promises are rechecked before every authored submission.
9. Test Declaration of Friendship and human-to-human gold, GPT, and resource amount edits in both directions. Invalid amounts retain the prior native value.
10. Test author, incoming, and own states with normal play and a pinned human strategist. Run the unchanged normal-seat mock in a pure-observer session only to confirm presentation; it is not proof of live deal support. Confirm the effective seat supplies participants, legality, value, presentation columns, and serialized actor for supported seats. Confirm mock success and error preserve the correct review or editor state, and that no bridge traffic or native enactment occurs.
11. Confirm the mount calls `VoxDeorumOpenDeal` before showing the TradeLogic context. A call made while the context is already visible returns false without changing the native trade state. On a first-ever correctly ordered open, third-party war and peace controls use the mounted participants without a Lua error. Confirm author mode begins with no ordinary items at peace and with required paired peace treaties at war.
12. Remove the wrapper's update listener, then force a TradeLogic refresh and confirm stock Propose and Cancel remain disabled. Restore the listener and confirm it synchronously reconfigures the footer and invokes only wrapper callbacks for each mounted state.

## Out of scope

- Runtime bridge and server-event wiring
- Transcript writes, proposal reduction, and deal enactment
- Server-side stale-proposal, thread-lock, closed-turn, and authoritative legality checks
- Per-item valuation changes or `CvDealAI` changes
- New automated test infrastructure for `civ5-mod`
