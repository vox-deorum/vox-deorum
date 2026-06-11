# Stage 6 — In-game panel v2: one real option category (prefer hijacking native UI)

> Part of the human-control plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

Make one real choice end to end. **First explore whether Civ's native in-game research (tech tree) and social policy screens can be reused — "hijacked" — for the NEXT research/policy choice** rather than re-rendering option lists ourselves. The native screens already know the real game IDs, descriptive text, prerequisites, and costs, and are far more familiar to a participant who knows Civilization V.

## Approach / spike — verified starting facts

Three things are already verified in the code, so the spike starts from them instead of re-discovering:

- **Under autoplay the active player IS the observer slot.** `Game.SetAIAutoPlay` activation calls `setActivePlayer(iObserver, ...)` (`CvGame.cpp`); the observer-UI override mirrors visibility and notifications but does not change `Game.GetActivePlayer()`.
- **The native screens key off the active player.** `TechTree.lua` (`g_activePlayerID = Game.GetActivePlayer()`) and `SocialPolicyPopup.lua` (`Players[Game.GetActivePlayer()]`) would render the *observer's* empty research/policy state, not the human civ's. Launches load Vox Populi + EUI, so the EUI variants (`civ5-dll/UI_bc1/...`) are the ones in effect.
- **Selections commit as direct game actions.** The screens commit via `Network.SendResearch` / `Network.SendUpdatePolicies` on the active player; there is no LuaEvent hook to capture a choice in passing.

So a hijack cannot be "open the screen and listen" — it means **forking the native screen Lua into `civ5-mod`** as a chooser: player references re-pointed at the human's playerID, the `Network.Send*` commit replaced by a LuaEvent back to the panel, which folds the picked ID into the `HumanDecision` payload feeding `set-research` / `set-policy`. The spike weighs that fork — size and upstream-maintenance cost of the EUI screens, and whether they render correctly for a non-active player — against the fallback.

- **Fallback** if the fork proves impractical: render a single-select list for Next Research in the panel from the `present-decision` payload. (Either way, no display-name stripping is needed in the human-strategist mapping: `set-policy` strips parenthetical suffixes like `" (New Branch)"` / `" (Policy)"` server-side.)

## Work items

- `civ5-mod/Lua/VoxDeorumHumanPanel.lua` / `.xml` — trigger and observe the native screen, or render the one category per the fallback.
- `vox-agents/src/strategist/agents/human-strategist.ts` — map the newly submitted field onto its action tool.
- Localization additions.
- **Document the spike outcome in this folder** — the native-vs-custom answer shapes stage 7.

## Verify

On a decision turn the human picks a research target (via the native screen if viable); `set-research` fires with the human's rationale; the replay message appears; the game resumes.

## Done when

One real option category works end to end through the panel, and the native-hijack question is answered and written down.
