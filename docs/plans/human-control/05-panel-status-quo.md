# Stage 5 — In-game panel v1: keep-status-quo only ✅ DONE

> Part of the human-control plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: implemented.** A minimal in-game decision panel ports the approved mockup's status-quo path into the game. What was built:
> - [`civ5-mod/UI/VoxDeorumHumanPanel.xml`](../../../civ5-mod/UI/VoxDeorumHumanPanel.xml) — a **corner widget** (a bottom-right `TriggerButton` in the native action slot above the minimap, plus an `AutoplayChip`) and a **hidable dialog** modeled on Community Patch's `EventChoicePopup.xml` (`BGBlock_ClearTopBar` backdrop + `Grid9DetailFive140` grid, side treatments, `MenuTitleCaption` title). The dialog carries a status line, a single rationale `EditBox` (mirroring `SaveMenu`'s `NameBox`), a **Hide** button in the title bar, **Keep Status Quo** + **Submit** buttons, and a hidden submission-accepted overlay. The dim backdrop and grid are toggled together (not wrapped in a sized container) so each still anchors to the screen.
> - [`civ5-mod/UI/VoxDeorumHumanPanel.lua`](../../../civ5-mod/UI/VoxDeorumHumanPanel.lua) — dormant on load (`ContextPtr:SetHide(true)`); on `LuaEvents.VoxDeorumHumanDecision(playerID, turn, optionsJson)` it shows **only the trigger button** (ignoring `optionsJson` — no categories yet), **not** the dialog. Clicking the trigger opens the dialog and marks the start of the human's deliberation (the later-plans decision timer — spec §4; the strategist-side wiring lands with those plans). The dialog is hidable (Hide button or Escape) without discarding the typed rationale, and the trigger reopens it. Keep Status Quo fires `Game.BroadcastEvent("HumanDecision", { PlayerID, Turn, StatusQuo = true, Rationale })`, shows the accepted overlay, then after ~2.5 s (a `SetUpdate` frame timer) retires the dialog and trigger for the `AutoplayChip` reporting the last decision (accepted → auto-playing). A rationale is required before submitting; Escape hides the open dialog (or is swallowed mid-submission) but is left alone when the dialog is already hidden so it behaves normally while the human inspects the paused world.
> - [`civ5-mod/Text/VoxDeorum_Text.xml`](../../../civ5-mod/Text/VoxDeorum_Text.xml) — plain-language `TXT_KEY_VD_HUMAN_*` keys (no identifiers).
> - [`civ5-mod/VoxDeorum.modinfo`](../../../civ5-mod/VoxDeorum.modinfo) — both files registered (`UI/VoxDeorumHumanPanel.lua` `import="1"`, `UI/VoxDeorumHumanPanel.xml` `import="0"`, matching the working Squads UI-addin convention) plus an `InGameUIAddin` `EntryPoint` on the XML; `update_md5.py` re-run. The addin always loads but stays dormant until the LuaEvent — no mod-side mode flag.
>
> **Deviations from the original work items:**
> - **Lua co-located with its XML in `UI/`** rather than `Lua/`. Every UI `.lua`/`.xml` pair in the reference mods (Squads, EUI, Community Patch) is co-located in one folder; co-locating de-risks the engine's context→Lua auto-bind, which is the crux of this stage and can't be tested outside the game. Stages 6–7 should put any new panel UI files in `UI/` for the same reason.
> - **Submit button is present but disabled** in stage 5 (there are no option categories to stage yet), with a tooltip pointing to Keep Status Quo. It activates in stage 6 when categories exist — this matches the approved mockup's "Submit enabled once ≥1 change is staged" rule. (User-approved.)
> - **Rationale is a single-line `EditBox`** (Civ 5's `EditBox` is single-line) rather than the mockup's two-row textarea — acceptable for v1; revisit if multiline input is wanted.
> - **The trigger button is our own corner widget, not a fork of the native "PLEASE WAIT" button.** The mockup's "same slot Civ uses for Choose Production" is realized by our own `TriggerButton` positioned in the bottom-right action slot. The native end-turn button is `Controls.EndTurnButton` inside Community Patch's `ActionInfoPanel` context — a separate UI context an addin cannot reach, already overridden by Vox Populi — so genuinely *replacing* it would mean re-forking that upstream file (the cost stage 6 rejected for the native screens). The corner-widget offsets that lift it above the minimap are eyeballed and may need in-game tuning. (User-approved fallback.)
> - **The trigger click is the deliberation-start anchor (spec §4 refinement).** The dialog no longer pops open on the decision; the human clicks the trigger to engage, and *that* click is where the decision timer should start (rather than the moment the decision is merely surfaced). The Lua marks this point (`m_deliberationStarted`) but the strategist-side telemetry wiring — emitting a "decision opened" signal the session records — is deferred to the later plans, per the user's note. Until then `present-decision`-to-submit wall-clock (stage 3) still stands; reconcile spec §4 and the README "Deliberation-time telemetry slot" open item when that wiring lands.

## Objective

Prove the real end-to-end pipeline through the actual game UI with the smallest possible panel — just "Keep Status Quo", the rationale field, and Submit. This replaces the `lua-executor` simulation from stages 2–3 with a genuine panel submission.

## Work items

1. **`civ5-mod/UI/VoxDeorumHumanPanel.xml` + `civ5-mod/Lua/VoxDeorumHumanPanel.lua`** (new) — a minimal panel following the approved mockup and the Community Patch `EventChoicePopup` conventions (`ContextPtr`/`Controls`/`InstanceManager`). The panel is dormant until it receives `LuaEvents.VoxDeorumHumanDecision(playerID, turn, optionsJson)`; on Submit it fires `Game.BroadcastEvent("HumanDecision", { PlayerID, Turn, StatusQuo = true, Rationale })` and shows the submission-accepted state.
2. **`civ5-mod/VoxDeorum.modinfo`** — register the new Lua and XML files and add an `InGameUIAddin` entry point, mirroring the existing `VoxDeorumTest` entry; run `civ5-mod/update_md5.py` to regenerate the per-file md5 entries. The addin always loads but stays dormant until the LuaEvent arrives — **no mod-side mode flag**; all human-only behaviors are launcher-side from stage 1.
3. **`civ5-mod/Text/VoxDeorum_Text.xml`** — plain-language localization keys (no identifiers — spec §2).

## Reuse

Community Patch `EventChoicePopup` UI patterns; the LuaEvent-listener + `Game.BroadcastEvent` idiom already demonstrated in `civ5-mod/Lua/VoxDeorumTest.lua`.

## Verify

Run a human-control session. On a decision turn the panel appears with the pending-decision state; clicking Keep Status Quo + Submit fires `keep-status-quo` with the typed rationale (visible in the replay log), the game resumes and advances. The status line correctly reflects waiting/pending/accepted.

## Done when

A human can play a session start to finish making only keep-status-quo decisions through the real panel, with every decision recorded like an LLM decision.
