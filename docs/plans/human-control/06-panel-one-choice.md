# Stage 6 — In-game panel v2: one real option category (in-panel list)

> Part of the human-control plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

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
