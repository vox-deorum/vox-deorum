# Stage 4 — Web UI: redo the deal screen around the in-game trade board

> **✅ Redesign delivered.** The deal screen is now the three-panel in-game trade-board replica described below: categorized inventory panels (`InventoryPanel.vue`) flank a central two-sided offer (`CentralOffer.vue`), promises are folded into that offer, and the board is driven by the enriched `inspect-deal` data layer. Add-a-term is click-with-defaults; amounts/quantities/targets are edited on the central rows, while game-set durations are shown read-only. The board is hosted in a wide modal dialog the inline conversation cards open for review/counter.
> Part of the interactive-diplomacy plan. Shared design and watch-items live in [README.md](README.md); requirements live in [specs.md](specs.md).

## Objective

Replace the current configuring dialog with a layout replica of the core in-game trade board:

**counterpart inventory | deal on the table | your inventory**

The leader scene, portrait, speech area, background, ornamental textures, and other presentation surrounding the board are not part of this work. The Web screen keeps the existing PrimeVue visual language while reproducing the game's panel geometry, information hierarchy, density, and item-selection workflow.

The screen remains driven by `inspect-deal`. It must preserve the existing proposal, counter, accept, reject, retract, transcript, legality, valuation, and latest-request-wins behavior while replacing the visual and editing model.

## Layout and interaction

### Three-panel trade board

- The counterpart's available items occupy a scrollable inventory panel on the left.
- The human's available items occupy a scrollable **Your Items** panel on the right.
- The center is the deal on the table, split into aligned **They give** and **You give** columns.
- The dialog is a wide desktop surface, approximately 1200–1440 pixels, with a fixed minimum width. Narrow viewports may scroll horizontally; the panels do not stack.
- Each panel scrolls independently so a long inventory does not move the action controls or the other side's list.

### Inventory organization

Both inventories follow the in-game screen's category order:

1. Gold and gold per turn
2. Luxury resources
3. Strategic resources
4. Other resources
5. World Congress
6. Embassy, open borders, defensive pact, research agreement, declaration of friendship, maps, and peace
7. Cities
8. Technologies
9. Third-party peace and war
10. Promises

Inventory rows are the primary controls. Clicking a simple row adds the term directly to the deal. Rows that need an amount or quantity open a compact inline editor on the central offer; fixed-duration rows show their game-set turn count read-only. Rows that need a choice of target — third-party terms, targeted promises, and World Congress vote commitments — instead **expand to a list of eligible choices** and add a fully-formed term on click. Singleton rows already present in the deal are visibly selected and cannot be added twice.

### Deal on the table

- The optional one-sentence deal message appears directly above the value balance (the last thing read before proposing).
- Selected terms appear in the center under the side that gives them.
- Quantitative and targeted terms remain editable from their central rows; duration-bearing terms show their fixed turn count read-only.
- A term can be removed directly from the center.
- A structurally impossible term is shown in red with its reason available as a tooltip.
- When an existing proposal has become structurally impossible under current game state, retain it in the offer table, mark it red, and prevent acceptance until it is removed or changed.
- Both-perspective values remain visible as compact secondary information rather than dominating the item label.
- The live value balance appears immediately below the offer table and clearly marks sentinel estimates.
- Promises participate in the same two-sided offer layout instead of living in a detached form below the inventories.

### Message and actions

The action row follows the value balance and current proposal state:

- New deal: **Propose**
- Incoming proposal: **Refuse**, **Counter**, **Accept**
- Outgoing proposal: **Retract**, **Counter**

Refresh state, inspection progress, errors, and the closed-this-turn lock remain visible as subdued board-level status. The inline conversation cards remain unchanged.

## Data required from `inspect-deal`

`inspect-deal` remains the screen's single source of trade inventory, legality, and valuation data. Its response is extended **additively** so the board can use game-facing labels rather than numeric placeholders. This data layer is **delivered**:

- Resources include a localized display name and a category — `luxury`, `strategic`, or `bonus` (from `ResourceClassType`).
- Technologies include a localized display name.
- Third-party peace and war entries include a display name for the target team, resolved from a representative civ on it.
- Inventory candidates include current structural legality and **normalized reason lines** (`legal` + `reasons[]`) instead of structurally impossible candidates being omitted from the range — gold, the single-shot toggles, resources, cities, technologies, and third-party terms each carry their own legality + reasons.
- The response includes the game's default deal, peace-deal, and relationship durations.
- The response includes eligible promise-target metadata — player ID, team ID, display name, and major/minor kind — plus per-target **structural eligibility**:
  - **Coop War** (major targets) carry `coopWarEligible`: both principals pass the game's `IsValidCoopWarTarget` request-phase check *and* no coop war is already `PREPARING` between them against that target. Absent on a DLL build without the new binding (treat as unknown → show anyway).
  - **City-state promises** (minor targets) carry `protectingPlayerIDs`: which of the two principals currently protect the city-state, i.e. the valid recipients of a "stop bullying / don't attack my protected city-state" promise. Omitted when neither protects it.
- Third-party trade entries and promise targets are only surfaced when **both** principals have met the civ — matching the stock screen, so a target's name never leaks a civ one side hasn't discovered.

Keep numeric IDs as fallbacks when a localized name cannot be resolved. Structurally impossible inventory rows remain visible, are red, expose their reason, and cannot be added. This is distinct from an advisory `CvDealAI` sentinel value: sentinel valuation remains visible but does not make a structurally legal term unavailable. The UI's loose `Record<string, unknown>` range handling is replaced with explicit TypeScript interfaces — the tool exports `InspectDealResponse`, `NormalizedSideRange`, the per-candidate types, the typed promise-target metadata, and a typed inspected-promise result.

This enrichment does not change `Payload.Deal`, transcript message shapes, or the typed proposal/counter/accept/reject routes.

### One read-only DLL addition (additive, not a gameplay change)

To present Coop War eligibility from the game's own logic rather than reimplementing it in Lua, this stage exposes the existing `CvDiplomacyAI::IsValidCoopWarTarget` as a read-only `Players[id]:IsValidCoopWarTarget(target, bAtWarException)` binding (`CvLuaPlayer.cpp`), mirroring stage 3's read-only `GetTradeItemValue` getter — unconditionally registered (not `MOD_ACTIVE_DIPLOMACY`-gated), no enum/save change, `CvDealAI` untouched. The city-state promise check reuses the already-exposed `IsProtectingMinor`; the already-preparing guard reuses `GetCoopWarAcceptedState` + the `CoopWarStates` enum. `inspect-deal.lua` feature-detects the new binding (a guarded call yields `nil`/omitted eligibility on an older DLL), so the screen degrades gracefully until the rebuilt DLL ships through the normal release flow. This is the *only* DLL change in the stage and it is read-only — stage 6 remains the only **gameplay** DLL change. The `bAtWarException=false` request-phase semantics (and the `PREPARING` guard) keep the eligibility preview aligned with what stage-6 enactment will allow.

## Implementation shape

- Keep `DealScreen.vue` responsible for loading, live inspection, proposal freshness, and writes.
- Extract reusable inventory-panel and central-offer components so the three visual regions do not become another monolith.
- Move category construction, stable item ordering, selected-state detection, and item-index mapping into pure helpers.
- Add a shared deal-screen stylesheet for the board layout and responsive minimum-width policy.
- Update `ChatDetailView.vue` to host the wider, non-stacking board instead of the current maximizable generic-form dialog.
- Preserve `DealMessageCard.vue`, transcript interleaving, and deal reduction unless a small compatibility adjustment is required.
- Continue debounced inspection and apply only the newest response.

World Congress vote commitments are enumerated by `inspect-deal` (see [03-inspect-deal.md](03-inspect-deal.md)) and surfaced as an **expandable "Vote commitment" row** under World Congress — each in-session resolution/choice (enact or repeal) is picked directly, carrying its full term (resolution, choice, the game-computed vote count, enact/repeal) with no separate central editor. The category is hidden when no league is in session. Because the DLL allows only one vote commitment per giver per deal (`CvDeal::IsPossibleToTradeItem`'s `ContainsItemType` guard), once a side has one on the table the other vote targets are shown blocked (with a reason) until it is removed.

## Reuse

Reuse the existing typed deal-action API, `Payload.Deal`, `inspect-deal`, transcript reduction, inline deal cards, value helpers, busy-state sharing, and conversation refresh flow. Reuse PrimeVue controls for inputs, tooltips, status, and actions; do not introduce copied Civilization V artwork or decorative assets.

## Test plan

- Verify `inspect-deal` enrichment, resource categorization, target metadata, default / peace / relationship durations, normalization, and numeric fallbacks.
- Verify promise-target eligibility: Coop War targets reflect `IsValidCoopWarTarget` and exclude already-`PREPARING` wars; city-state promise targets carry the protecting principals; third-party trade entries and promise targets are hidden unless **both** sides have met the civ.
- Verify structurally impossible inventory candidates are returned with reasons rather than filtered out.
- Test pure catalog grouping, category order, selected-state handling, and stable mapping to original deal-item indices.
- Verify the three-panel orientation and the left/right giver semantics.
- Verify adding an item from either inventory places it in the correct center column.
- Verify impossible inventory rows are red and disabled, while structurally legal sentinel-valued rows remain selectable.
- Verify an existing proposal that is no longer structurally legal remains visible in red and cannot be accepted.
- Verify editing/removing gold, gold per turn, resources, toggles, cities, technologies, third-party terms, votes, and promises, with fixed durations displayed read-only.
- Preserve coverage for latest-inspection-wins, active-proposal freshness, closed-state locking, and proposal/counter/accept/reject/retract actions.
- Compare the core board manually with the in-game reference at 1366×768 and 1920×1080.
- Run the root TypeScript test and build suites.

## Done when

The Web dialog reads immediately as the core Civilization V trade screen without recreating the leader scene: two categorized inventories flank a central two-sided offer, the deal message sits above that offer, and its live value balance sits immediately below it. Inventory rows add terms, central rows edit or remove editable fields, fixed durations remain read-only, structurally impossible choices are red and disabled, and stale impossible terms in existing proposals remain visible in red. All existing structured deal actions and transcript behavior continue to work, while resource, technology, third-party, and promise-target choices use meaningful game-facing names.
