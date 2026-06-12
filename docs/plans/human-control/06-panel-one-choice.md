# Stage 6 — In-game panel v2: one real option category (in-panel list) ✅ DONE

> Part of the human-control plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: implemented.** Next Research is now a real, end-to-end choice through the in-panel list. What was built:
> - **Options reach the panel as a Lua table, not a JSON string (deviation from the stage-4 mockup's `optionsJson` note).** [`present-decision`](../../../mcp-server/src/tools/actions/present-decision.ts) hands the fetched `OptionsReport` to the [Lua util](../../../mcp-server/src/utils/lua/present-decision.ts) as a structured object; the bridge JSON-serializes it for transport and the DLL's `ConvertJsonToLuaValue` rebuilds it as a native Lua table before `LuaEvents.VoxDeorumHumanDecision(playerID, turn, options)` fires. The panel reads `options.Options.Technologies` / `options.Technology` directly — **no JSON parsing in Lua**. The `presentHumanDecision(playerID, turn, options)` signature and the registered LuaFunction arg were renamed `optionsJson` → `options`; the `sanitize` step is dropped (the bridge's `JSON.stringify` already escapes everything, and ArduinoJson parses it). *Constraint carried into stage 7:* incoming function args are parsed into a `DynamicJsonDocument` ([CvConnectionService.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvConnectionService.cpp)), so the whole report must fit (as a nested structure it carries more node overhead than a single string; the mid-game Flavor report is ~10 KB of content). Stage 7 bumped that buffer 16 KB → 64 KB to close the late-game headroom risk; a deserialize failure still degrades gracefully to the panel's "no options" note rather than crashing.
> - [`civ5-mod/UI/VoxDeorumHumanPanel.xml`](../../../civ5-mod/UI/VoxDeorumHumanPanel.xml) — added a `ResearchInstance` row template (icon `Image`, name `Label`, help `Label`, a `Grid9FrameTurnsHL` selection pulse) and a `ScrollPanel`+`Stack` (`ResearchScroll`/`ResearchStack`), modeled on Community Patch's `EventChoicePopup`. The dialog grew to 560×560 and the rationale field / Keep-Status-Quo / Submit buttons reflowed below the list; a hidden `ResearchEmpty` note covers the no-options case.
> - [`civ5-mod/UI/VoxDeorumHumanPanel.lua`](../../../civ5-mod/UI/VoxDeorumHumanPanel.lua) — on the decision event it reads the options table and builds the list: one row per available technology, **ordered by tech-tree column (`GridX`) then name**, each with the **real tech icon** (`IconHookup`, via a lazily-built display-name→`GameInfo.Technologies` map keyed on `Locale.Lookup(Description)` — the same localized name the report and `set-research` use), the name, and the report's help text (`\n`→`[NEWLINE]`). The player's current forced research gets a "current" tag and its earlier rationale, and is pre-highlighted. Picking a *different* technology stages a change (single-select pulse) and enables **Submit**, which fires `Game.BroadcastEvent("HumanDecision", { PlayerID, Turn, Technology, Rationale }, true)`; **Keep Status Quo** is retained for "no change". Both still require a non-empty rationale (pre-filled from last turn). All stage-5 behaviors (trigger button, hidable dialog, accepted overlay → auto-play chip, Escape handling, `alignToEndTurnButton`) are preserved.
> - [`civ5-mod/Text/VoxDeorum_Text.xml`](../../../civ5-mod/Text/VoxDeorum_Text.xml) — research header/intro/current-tag/earlier-rationale/empty keys, a research auto-play-chip + accepted sub-line, and a refreshed (no longer "later version") Submit tooltip.
> - [`civ5-mod/VoxDeorum.modinfo`](../../../civ5-mod/VoxDeorum.modinfo) — `update_md5.py` re-run (no new files; refreshed md5s for the two panel files and the text file).
> - [`vox-agents/src/strategist/agents/human-strategist.ts`](../../../vox-agents/src/strategist/agents/human-strategist.ts) — **already** maps `submission.Technology` → `set-research` with the shared rationale (built in stage 3); verified, no change needed.

## Objective

Make one real choice end to end: render **Next Research** as a single-select list inside the panel, fed by the `present-decision` payload, and submit it through `HumanDecision` → `set-research`.

## Native-vs-custom: settled in stage 4

The approved mockup ([mockup/](mockup/README.md)) renders **all option categories in the panel**; the native tech-tree/policy-screen hijack this stage originally planned to spike is **dropped**. What the spike pre-work had already verified, recorded here as the rationale:

- **Under autoplay the active player IS the observer slot.** `Game.SetAIAutoPlay` activation calls `setActivePlayer(iObserver, ...)` (`CvGame.cpp`); the observer-UI override mirrors visibility and notifications but does not change `Game.GetActivePlayer()`.
- **The native screens key off the active player.** `TechTree.lua`(`g_activePlayerID = Game.GetActivePlayer()`) and `SocialPolicyPopup.lua`(`Players[Game.GetActivePlayer()]`) would render the *observer's* empty research/policy state, not the human civ's. Launches load Vox Populi + EUI, so the EUI variants (`civ5-dll/UI_bc1/...`) are the ones in effect.
- **Selections commit as direct game actions.** The screens commit via `Network.SendResearch` / `Network.SendUpdatePolicies` on the active player; there is no LuaEvent hook to capture a choice in passing.

## Work items

- `civ5-mod/Lua/VoxDeorumHumanPanel.lua` / `.xml` — render the Next Research single-select list per the mockup (option rows with icon, name, help text from the `OptionsReport`, and a tag on the current selection), and fold the picked option into the `HumanDecision` payload.
- `vox-agents/src/strategist/agents/human-strategist.ts` — map the newly submitted field onto its action tool.
- Localization additions.

## Verify

On a decision turn the human picks a research target from the in-panel list; `set-research` fires
with the human's rationale; the replay message appears; the game resumes.

## Done when

One real option category works end to end through the panel, matching the approved mockup.
