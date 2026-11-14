# Deal screen

The deal screen is where a player builds, reviews, or answers one trade proposal. It wraps the native Vox Populi and EUI trade editor rather than reimplementing it, and adds the pieces the native screen has no concept of: promise terms, an attached message, projection of terms the live game will not accept, and the propose / counter / accept / reject vocabulary the conversation uses.

It owns proposal state, promise controls, validation feedback, and action dispatch. It does **not** enact deals or write transcript rows: it announces an intent and waits for the durable rows that come back.

This page is for anyone working on that wrapper: when it mounts, what state it keeps, and what to touch when you add to it. For the full round trip across the stack, see [diplomacy.md](../diplomacy.md).

## When the player sees it

Always from the [diplomacy panel](diplomacy-panel.md), in one of three modes:

| Mode | Opened by | Footer offers |
| --- | --- | --- |
| `author` | The panel's Propose Deal button. Starts from an empty table. | Propose, Cancel |
| `incoming` | Clicking an open proposal card the counterpart authored. | Accept, Cancel, Reject (Counter and Reset once edited) |
| `own` | Clicking an open proposal card the player authored. | Retract, Cancel (Counter and Reset once edited) |

The screen mounts as a popup at `PopupPriority.LeaderTrade`, the same trick the native trade screen uses to render above the leaderhead scene, and it demotes the conversation panel beneath itself while it is up. Closing restores the panel.

## Files

| File | Role |
| --- | --- |
| `UI/Deals/VoxDeorumDealScreen.lua` | The wrapper: mount, projection, promise controls, footer, and the `VoxDeorumDealUI` driver surface. |
| `UI/Deals/VoxDeorumDealScreen.xml` | The copied native trade context plus the wrapper's own controls. |
| `UI/Deals/VoxDeorumDealTransport.lua` | The live driver: broadcasts the action and resolves it from durable rows. |
| `UI/Deals/VoxDeorumDealScreenMock.lua` | The offline sandbox driver and its scripted scenarios. |
| `UI/Shared/VoxDeorumDealUtils.lua` | Shared payload helpers, described below. |

The wrapper leans on hooks added to the EUI compatibility mod's `TradeLogic.lua`, which lives in the `civ5-dll` submodule under `(3a) VP - EUI Compatibility Files/LUA/`. `VoxDeorumOpenDeal` binds the editor to a human-to-human pair, and `VoxDeorumResumeHumanToHumanEditor` re-establishes it after a popup-stack cycle. Four `LuaEvents.VoxDeorumTradeLogic*` events tell the wrapper when the native screen has rebuilt its pockets, its table, or its buttons, so it can restore its own rows. This is one concrete reason the mod declares an EUI dependency.

## The data model

**Proposal state.** A mount request carries `counterpartID`, `mode`, and for `incoming` and `own` a `DealPayload v1` deal plus the `proposalMessageID` it answers. `mount` validates the payload shape and the promise wire shape before touching anything, then keeps two copies: `baselineItems` and `baselinePromises` are the proposal as received, `draftItems` and `draftPromises` are what is on the table now. Two fingerprints decide what the footer offers: `filteredFingerprint` records the draft as it stood after projection, and comparing it against the live semantic fingerprint answers "has the player changed this?". A third, `expectedSignature`, watches the shared native scratch deal: when another context clobbers it, the wrapper notices and reprojects.

**Projection.** Incoming terms are not trusted to be legal. `projectItems` groups equivalent terms, adds each group to the scratch deal, and keeps it only if the native editor retained it in full, so a bilateral commitment can never be left showing one half. Anything dropped produces a human-readable reason and sets `counterRequired`, which turns Accept into Counter. `probeCombination` then asks the native `AreAllTradeItemsValid` whether the surviving set is legal together, which is a separate question from whether any single term was removed.

**Promise controls.** Five promise kinds (Military, Expansion, Border, No Digging, Cooperative War) render into wrapper-owned stacks nested inside the native pockets and table, styled like the native trade rows. `evaluatePromises` re-checks every promise on every refresh against live state: whether an equivalent promise is already active, whether both principals may legally prepare a war against a chosen third party, whether durations match the game's own constants, and whether the same logical commitment appears twice. Cooperative War opens an inline target chooser, and target legality is cached once per refresh because it is evaluated for every major civ on both sides.

**Validation feedback.** One status frame carries everything, in priority order: an action or pending message first, an aggregate combination failure second, and the informational "terms were removed" notice last, with the per-term reasons in its tooltip. The notice clears as soon as the player edits the draft.

**Action dispatch.** The footer maps to one canonical vocabulary: `propose`, `counter`, `accept`, `reject`, `retract`, plus the local-only `reset` and `cancel`. `dispatch` re-validates the seat, re-runs the appropriate projection, builds a packet, enters a pending state, and hands the packet to the installed driver. While the action is pending, an invisible cover blocks every control, the status animates, and a timeout fires after a few seconds. `resolve` then closes the screen on success and restores the mounted editor on failure, leaving the player's work intact.

Like the diplomacy panel, both contexts install a named driver (`real` or `mock`), and `LuaEvents.VoxDeorumUseMockDrivers` switches between them. Every switch closes a mounted editor, so a live pending action can never be resolved by the sandbox.

## The transport

`UI/Deals/VoxDeorumDealTransport.lua` is small because it owns only one direction of the wire.

**Outbound**, it broadcasts a single game event, `DiplomacyDealAction`, carrying the seat, counterpart, turn, action, and for a proposal or counter the serialized deal. Retract is a local intent only: the wire vocabulary has no retract, so it maps to `reject`. Every action but propose must name the proposal it answers, or the event is refused at the archive boundary. Before serializing, each human-side endpoint in the deal is rewritten onto the effective seat, while third-party fields such as a cooperative-war target are left alone.

**Inbound**, it registers nothing with the DLL. It is a separate Lua context from the panel, so it cannot read the panel's globals, but `LuaEvents` do cross contexts and the panel's transport re-fires every push it receives. The deal transport listens to those and resolves the pending action from the durable transcript rows. A proposal or counter is settled by a row of the matching type, from the right author, newer than the whole transcript was when the action was sent. An accept needs both a `deal-accept` and a `deal-enacted` row. A reject or retract is settled by a `deal-reject` row, including the backend's idempotent re-push of an existing one. A reported error status fails the pending action instead.

It also announces `VoxDeorumDealActionDispatched` so the panel's transport arms the same acknowledgement timers a chat message would, since a deal action runs a turn on the same conversation thread.

The screen pumps `Game.ProcessConnectionMessages` at the top of every frame for the same reason the panel does: the game core stops ticking under the leaderhead scene, and the panel that would otherwise pump is queued below this popup and stops updating. Without the pump the rows that resolve the action never arrive. See [connection.md](../civ5-dll/connection.md).

## The XML side

`VoxDeorumDealScreen.xml` is a copy of the VP trade context under a unique context name, with the wrapper's controls layered in:

- Three instances: `VoxPromisePocketEntry` (a choosable promise), `VoxPromiseTableEntry` (a promise on the table, with its duration), and `VoxPromiseTargetEntry` (a cooperative-war target).
- Four promise stacks nested in the native pocket and table panels, one pair per side, plus the two cooperative-war target stacks.
- `VoxFooterStack` and `VoxThirdAction`, the third footer button that carries Reject, Retract, or Reset.
- `VoxMessageFrame` with `VoxMessageInput` and its placeholder, the one-line message attached to a proposal.
- `VoxStatusFrame` and `VoxStatusText`, the single status line.
- `VoxPendingCover`, a transparent full-screen box that swallows input while an action is pending.

Adding a control means touching both files: declare it in the XML with an `ID`, then render it from the Lua's `refresh` path and recalculate the stack it sits in (`recalcPocket`, `recalcTable`, or the footer stack), since the native panels size themselves from their children. User-facing strings go in `Text/VoxDeorum_Text.xml` under a `TXT_KEY_VD_DEAL_*` key, with a tooltip key alongside it, because the rows themselves are terse by design.

Adding a new **deal term** is a larger job that reaches past the XML: the canonical field list and the known-type tables in `VoxDeorumDealUtils`, the wire validator there, `decodeItem` and `addItem` in the screen, a display name in `itemNameKeys`, and a label in the diplomacy panel's own `itemLabel` so the term also reads correctly on a proposal card.

## Shared helpers

`UI/Shared/VoxDeorumDealUtils.lua` is the module both screens and both transports depend on. It defines the client side of `DealPayload v1` and keeps every consumer honest about it:

- **Validation.** `ValidatePayload` checks the wire shape of a whole payload before anything reaches a game binding: known item and promise types, integer fields, and both endpoints belonging to the mounted pair.
- **Normalization.** `NormalizeItems` and `NormalizePromises` keep only canonical fields, stamp the fixed live duration for each type from the game's own constants, add the missing twin for bilateral terms such as a defensive pact or a cooperative war, and sort by every discriminator. Two payloads that mean the same thing normalize identically.
- **Fingerprints.** `ItemFingerprint` and `SemanticFingerprint` turn a normalized draft into a stable string, which is how the screen detects edits and scratch-deal clobbering.
- **Legality.** `IsLegalCoopWarTarget` runs every native gate for a cooperative war (contact, validity for both principals, and neither already preparing) and reports the reason, so the screen can explain a disabled row.
- **Guarded bindings.** `TryCall` invokes a method on an engine object without assuming it exists, which is what lets the whole module degrade cleanly rather than erroring on an older DLL.
- **Text safety.** `StripDelimiter` removes the named-pipe delimiter so authored text cannot corrupt the wire, and `FoldUnrenderablePunctuation` rewrites punctuation the Civ 5 font atlases cannot draw (dashes, curly quotes, ellipses, fullwidth IME characters) into ASCII counterparts, since the game draws nothing at all for a missing glyph.

## The mock driver

`UI/Deals/VoxDeorumDealScreenMock.lua` is the offline sandbox, dormant until the mock drivers are selected. It replaces the transport with a delayed result, so an action completes or fails on a timer without any bridge traffic or native enactment.

Scenarios open through `LuaEvents.VoxDeorumOpenDealScreenMock`, through the diplomacy panel's hidden mock buttons, or directly from FireTuner with `VoxDeorumDealMock.Open`. There are six: `author`, `incoming`, `own`, `error`, `unavailable`, and `coop-war`.

The interesting part is that the scenarios are built against the live game rather than hardcoded. For each candidate term the mock asks the native editor whether the item is possible, adds it to a cumulative scratch deal, and immediately revalidates the whole deal, rebuilding from the already accepted terms when a candidate fails. Promises are chosen only when their guarded live getter reports no active commitment, falling back to the structurally legal No Digging. The result is a scenario that is legal in the current game, whatever game that is.

Two scenarios are deliberately different. `error` returns a delayed failure and leaves the mounted editor available, exercising the recovery path. `unavailable` includes ordinary and promise terms that projection is guaranteed to remove, so the removal notice and the forced Counter state can be seen. `coop-war` picks the first fully legal third major target and simply does not open when no eligible civilization exists.
