# Stage 6 — In-game panel v2: one real option category (prefer hijacking native UI)

> Part of the human-control plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

Make one real choice end to end. **First explore whether Civ's native in-game research (tech tree) and social policy screens can be reused — "hijacked" — for the NEXT research/policy choice** rather than re-rendering option lists ourselves. The native screens already know the real game IDs, descriptive text, prerequisites, and costs; reusing them is less work, far more familiar to a participant who knows Civilization V, and sidesteps the `get-options` display-name munging (the `" (Branch)"` / `" (Policy)"` suffix that `set-policy` would otherwise need stripped).

## Approach / spike

- Investigate the native tech-tree and social-policy screens (Community Patch / EUI UI sources): under autoplay, with the human civ AI-controlled, can they be opened for the human civ and a selection captured? The likely shape: the panel offers "Choose Research" / "Choose Policy" buttons that open the native screen; the panel listens for the selection (the `ChooseResearch` / `ChoosePolicy`-type hooks) and folds the picked ID into the `HumanDecision` payload — feeding `set-research` / `set-policy` a real ID.
- **Fallback** if the native hijack proves impractical under autoplay: render a single-select list for Next Research in the panel from the `present-decision` payload, and strip the policy display-name suffix in the human-strategist mapping (mirroring what `null-strategist` does before calling `set-policy`).

## Work items

- `civ5-mod/Lua/VoxDeorumHumanPanel.lua` / `.xml` — trigger and observe the native screen, or render the one category per the fallback.
- `vox-agents/src/strategist/agents/human-strategist.ts` — map the newly submitted field onto its action tool.
- Localization additions.
- **Document the spike outcome in this folder** — the native-vs-custom answer shapes stage 7.

## Verify

On a decision turn the human picks a research target (via the native screen if viable); `set-research` fires with the human's rationale; the replay message appears; the game resumes.

## Done when

One real option category works end to end through the panel, and the native-hijack question is answered and written down.
