# Human-Control Decision Panel — Approved Mockup (Stage 4)

Open [index.html](index.html) directly in a browser — no server, no build step. The fake map,
minimap, and the blue "mockup controls" box are scaffolding; **the design under review is the
trigger button above the minimap and the dialog it opens.** A decision "arrives" shortly after
load; use the mockup controls to replay the cycle.

## The approved design

**Interaction model — Civ-native action prompt.** When the strategist calls `present-decision`,
a pulsing **"⚖ Strategic Decision" button appears above the minimap** — the same slot Civ uses for
"Choose Production" / "Activate next unit" — and the dialog opens. The game is paused throughout
(the existing pause machinery; no timeout). **Hide** (or Esc, or clicking the map) closes the
dialog to inspect the world without losing staged edits; the button stays until the decision is
submitted, then disappears and a small "auto-playing" chip takes its place. Session state stays
legible from this corner widget alone (spec §6): the button shows the turn and that the game is
paused waiting on you, the chip shows auto-play plus the last decision, and the dialog's accepted
overlay confirms submission.

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
  covers the whole turn — spec §2), **Keep Status Quo**, and **Submit** (enabled once ≥1 change is
  staged and a rationale is typed; Keep Status Quo also requires a rationale).

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

- **In:** `LuaEvents.VoxDeorumHumanDecision(playerID, turn, optionsJson)` where `optionsJson` is
  the Flavor-mode `OptionsReport` from `get-options`, fetched server-side by `present-decision`.
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
