# Human-Control Decision Panel — Approved Mockup (Stage 4)

Open [index.html](index.html) directly in a browser — no server, no build step. The fake map,
minimap, and the blue "mockup controls" box are scaffolding; **the design under review is the
trigger button above the minimap and the dialog it opens.** A decision "arrives" shortly after
load; use the mockup controls to replay the cycle.

## The approved design

**Interaction model — Civ-native action prompt.** When the strategist calls `present-decision`,
a pulsing **single-line "⚖ Strategic Decision" button appears in the native end-turn ("PLEASE WAIT")
slot above the minimap, overriding it**. The dialog does **not** pop open on its own: the human
**clicks the trigger to open it**, and that click is what starts their deliberation timer (so the
clock measures active engagement, not the moment the decision was surfaced — see spec §4). The game
is paused throughout (the existing pause machinery; no timeout). **Hide** (or Esc, or clicking the
map) closes the dialog to inspect the world without losing staged edits; the trigger stays until the
decision is submitted, then disappears and a small "auto-playing" chip takes its place. Session
state stays legible from this corner widget alone (spec §6): the button signals a decision is
pending, the chip shows auto-play plus the last decision, and the dialog's status line (the turn the
game is paused on) and accepted overlay carry the rest.

> **Note (in-game, the trigger lands in the native end-turn slot by copying its geometry).** An
> addin can't reach Community Patch's `ActionInfoPanel` (a separate UI context, already overridden
> by Vox Populi), so the in-game panel renders its own trigger widget and, at decision time, looks
> up the native "PLEASE WAIT" `EndTurnButton` and copies its live size/offset onto the trigger
> (`alignToEndTurnButton`) — overriding that slot without forking the upstream file, with the
> mockup's static geometry as the fallback. See stage 5.

**Dialog — master-detail, Civ-style.**

- Title bar: **"Make Your Decisions"**.
- Leader context row: mirrors the **EUI leader-choose dialog at pre-game** — the human civ's leader
  portrait and name, the leader/civ **trait** (its name and descriptive help below the name), and the
  civ's **unique unit/building/improvement** icons, each with a hover tooltip, to the right. All of it
  is read from the game's text/civ database (the same source that dialog uses), so the in-game panel
  should fit EUI/Civ 5 styling rather than the mockup's own palette; values here are placeholders.
- Left nav: six categories — Grand Strategy, Flavors, Next Research, Next Policy, Persona,
  Relationships — each with a one-line current-value summary and a ● badge when edits are staged.
- Right pane: the selected category's editor, pre-filled from the `OptionsReport`, every option
  carrying the **same descriptive text the LLM prompts receive**.
- Footer: staged-changes chips with per-change undo, the **single rationale** field (one rationale
  covers the whole turn — spec §2; **pre-filled with last turn's rationale** so Keep Status Quo
  isn't blocked on retyping one each turn — the human can edit or replace it), **Keep Status Quo**,
  and **Submit** (enabled once ≥1 change is staged and a rationale is present; Keep Status Quo also
  requires a non-empty rationale).

**Controls.**

- Flavors (0–100): slider with semantic tick labels (0 forbid / 30 enough / 50 balanced /
  70 prioritize / 100 emergency) plus −/+ steppers (step 5) — full-range parity with the LLM's
  action space. Grouped under collapsible subheaders following `flavors.json`'s three blocks:
  Military Doctrine, Military Composition, Economy & Development (panel-only readability — the
  LLM sees a flat list).
- Persona (1–10): same control, step 1, grouped per the `set-persona` schema sections.
- Relationships (−100..+100): per met civ, leader portrait + Public and Private sliders.
- Grand Strategy / Research / Policy: single-select lists with icons and help text; the current
  selection is tagged and shows its previous rationale. The policy list offers only adoptable
  policies — leaving the category unchanged queues nothing and culture keeps accumulating.

**Native-vs-custom split (stage 4 work item 3): all categories are custom-rendered in the panel.**
Research and policy use in-panel single-select lists fed by the `OptionsReport`; the native
tech-tree/policy-screen hijack explored in stage 6's spike is **not** part of the approved design
(stage 6 builds the in-panel list instead).

## What the panel receives and emits

- **In:** `LuaEvents.VoxDeorumHumanDecision(playerID, turn, options)` where `options` is
  the Flavor-mode `OptionsReport` from `get-options`, fetched server-side by `present-decision`.
  (Implemented in stage 6 as a native Lua table — `present-decision` hands the report off as a
  structured object and the DLL converts it from the bridge's JSON to a table, so the panel reads
  `options.Options.Technologies` etc. directly, with no JSON parsing in Lua. The mockup itself uses
  a plain JS object, [sample-options.js](sample-options.js), which mirrors the same shape.)
  [sample-options.js](sample-options.js) carries a realistic mid-game report with the real
  descriptive text (copied from `mcp-server/docs/strategies/*.json` and the `set-persona` field
  descriptions). `MOCKUP_DISPLAY` in the same file holds what the real panel gets from the game
  rather than the report: met-civ leader names, the civ-name → playerID mapping for relationship
  submissions, and icon/portrait art (placeholders here; icon atlases + leader portraits in-game).
- **Out:** `Game.BroadcastEvent("HumanDecision", payload)` matching the registered schema
  (`mcp-server/src/knowledge/schema/events/HumanDecision.ts`): required `PlayerID`/`Rationale`,
  plus only the changed fields — `GrandStrategy`, `Flavors` (deltas), `Technology`, `Policy`
  (display name; `set-policy` strips parenthetical suffixes server-side), `Persona` (deltas),
  `Relationships` (array of `{TargetID, Public, Private}`), or `StatusQuo: true`. Submitting in
  the mockup prints this payload into the "Game.BroadcastEvent log" (bottom-left).

## Fairness notes (spec §3)

The dialog renders only the human civ's own data. Other civs appear solely as met leaders' names/
portraits with the human's *own* stance values toward them — recognition aids, no foreign
reasoning, options, or out-of-fog information.

## Round-trip behavior

After a submission the mockup folds the changes back into its report copy, so triggering the next
decision shows everything pre-filled from the new current state — mirroring the real pipeline,
where `present-decision` re-fetches `get-options` each turn (stage 7's round-trip check).
