# Stage 5 — In-game panel v1: keep-status-quo only ✅ DONE

> Part of the human-control plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: implemented.** A minimal in-game decision panel ports the approved mockup's status-quo path into the game. What was built:
> - [`civ5-mod/UI/VoxDeorumHumanPanel.xml`](../../../civ5-mod/UI/VoxDeorumHumanPanel.xml) — a **corner widget** (a bottom-right `TriggerButton` in the native action slot above the minimap, plus an `AutoplayChip`) and a **hidable dialog** modeled on Community Patch's `EventChoicePopup.xml` (`BGBlock_ClearTopBar` backdrop + `Grid9DetailFive140` grid, side treatments, `MenuTitleCaption` title). The dialog carries a status line, a single rationale `EditBox` (mirroring `SaveMenu`'s `NameBox`), a **Hide** button in the title bar, **Keep Status Quo** + **Submit** buttons, and a hidden submission-accepted overlay. The dim backdrop and grid are toggled together (not wrapped in a sized container) so each still anchors to the screen.
> - [`civ5-mod/UI/VoxDeorumHumanPanel.lua`](../../../civ5-mod/UI/VoxDeorumHumanPanel.lua) — dormant on load (`ContextPtr:SetHide(true)`); on `LuaEvents.VoxDeorumHumanDecision(playerID, turn, optionsJson)` it shows **only the trigger button** (ignoring `optionsJson` — no categories yet), **not** the dialog. Clicking the trigger opens the dialog and marks the start of the human's deliberation (the later-plans decision timer — spec §4; the strategist-side wiring lands with those plans). The dialog is hidable (Hide button or Escape) without discarding the typed rationale, and the trigger reopens it. Keep Status Quo fires `Game.BroadcastEvent("HumanDecision", { PlayerID, Turn, StatusQuo = true, Rationale })`, shows the accepted overlay, then after ~2.5 s (a `SetUpdate` frame timer) retires the dialog and trigger for the `AutoplayChip` reporting the last decision (accepted → auto-playing). A rationale is required before submitting; Escape hides the open dialog (or is swallowed mid-submission) but is left alone when the dialog is already hidden so it behaves normally while the human inspects the paused world.
> - [`civ5-mod/Text/VoxDeorum_Text.xml`](../../../civ5-mod/Text/VoxDeorum_Text.xml) — plain-language `TXT_KEY_VD_HUMAN_*` keys (no identifiers).
> - [`civ5-mod/VoxDeorum.modinfo`](../../../civ5-mod/VoxDeorum.modinfo) — both files registered (`UI/VoxDeorumHumanPanel.lua` `import="1"`, `UI/VoxDeorumHumanPanel.xml` `import="0"`, matching the working Squads UI-addin convention) plus an `InGameUIAddin` `EntryPoint` on the XML; `update_md5.py` re-run. The addin always loads but stays dormant until the LuaEvent — no mod-side mode flag.
>
## Objective

Prove the real end-to-end pipeline through the actual game UI with the smallest possible panel — just "Keep Status Quo", the rationale field, and Submit. This replaces the `lua-executor` simulation from stages 2–3 with a genuine panel submission.

## Work items

1. **`civ5-mod/UI/VoxDeorumHumanPanel.xml` + `civ5-mod/UI/VoxDeorumHumanPanel.lua`** (new) — Lua is co-located with its XML in `UI/` (matching every reference mod: Squads, EUI, Community Patch) to avoid breaking the engine's context→Lua auto-bind; stages 6–7 should follow the same convention. The panel is dormant until it receives `LuaEvents.VoxDeorumHumanDecision(playerID, turn, optionsJson)`, at which point it shows only the **trigger button** (a corner widget in the bottom-right action slot, lifted above the minimap). The trigger button — not a fork of the native end-turn button, which lives in a separate UI context an addin cannot reach — is the UI-approved fallback for the mockup's "Choose-Production slot." Clicking the trigger opens the dialog and stamps `m_deliberationStarted` (the spec §4 deliberation-start anchor; strategist-side telemetry wiring is deferred to the later plans). The dialog is hidable (Hide button or Escape) without discarding the typed rationale; the trigger reopens it. **Submit is present but disabled** in stage 5 — no option categories exist yet; a tooltip directs the human to Keep Status Quo, matching the mockup's "Submit enabled once ≥1 change is staged" rule. It activates in stage 6. Rationale is a single-line `EditBox` (Civ 5 has no multiline widget) and is required before submitting. Keep Status Quo fires `Game.BroadcastEvent("HumanDecision", { PlayerID, Turn, StatusQuo = true, Rationale })`, shows the submission-accepted overlay, then after ~2.5 s retires the dialog and trigger for the `AutoplayChip`.
2. **`civ5-mod/VoxDeorum.modinfo`** — register the new Lua and XML files and add an `InGameUIAddin` entry point, mirroring the existing `VoxDeorumTest` entry; run `civ5-mod/update_md5.py` to regenerate the per-file md5 entries. The addin always loads but stays dormant until the LuaEvent arrives — **no mod-side mode flag**; all human-only behaviors are launcher-side from stage 1.
3. **`civ5-mod/Text/VoxDeorum_Text.xml`** — plain-language localization keys (no identifiers — spec §2).

## Reuse

Community Patch `EventChoicePopup` UI patterns; the LuaEvent-listener + `Game.BroadcastEvent` idiom already demonstrated in `civ5-mod/Lua/VoxDeorumTest.lua`.

## Verify

Run a human-control session. On a decision turn the panel appears with the pending-decision state; clicking Keep Status Quo + Submit fires `keep-status-quo` with the typed rationale (visible in the replay log), the game resumes and advances. The status line correctly reflects waiting/pending/accepted.

## Done when

A human can play a session start to finish making only keep-status-quo decisions through the real panel, with every decision recorded like an LLM decision.
