# Plan 4a: Variant tags and editorial preferences

**Status: technical groundwork implemented.** The owner directs the creative tag choices, writing guidance, and tuning. [Plan 4c](04c-variant-drafting.md) uses the catalogue for authored variants. [Plan 7](07-llm-editors.md) validates the same three tag IDs in model proposals.

## Variant tags and rules

Authored variants carry one voice, one stance, and one genre. Set all three together. Untagged legacy variants resolve to `general`, `neutral`, and `report` when selected. Under `newspaper/styles/`, the files `voice.json`, `stance.json`, and `genre.json` register tag IDs and store optional writing guidance. The loader validates variant and rule tags against the effective catalogue.

A preference in `styles/rules.json` matches all the tags it names and applies a positive weight multiplier when its condition holds. For example, high national happiness or positive net happiness in the story's home city can favor a pro-government letter. The rule leaves a pro-government report at its original weight. Missing evidence leaves the preference inactive.

## Heuristic selection

After selecting stories and evaluating page and design eligibility, the editor applies style preferences to the eligible variants for each story. Existing conditions still protect claims that require specific evidence. Each article uses one seeded weighted draw, so several voices can appear in an issue.

Scale each variant's weight by `1 / (1 + 0.25 × prior draws of its genre)`. Count in draw order, including articles later omitted from the pages, and reset each issue. Every eligible variant stays in the draw.

The audit records tags beside variant IDs for displayed articles. Applied preference reads join the decision's evidence. Older saved catalogues keep their original draws and older decisions remain readable.

## Verification

Controlled fixtures check that happiness shifts the odds, missing facts have no effect, factual gates still hold, repeated genres remain possible, and story ranking and design selection stay separate. Replay coverage checks legacy seeds and the displayed article audit. See the [editorial guide](../../../developers/vox-agents/newspaper/editorial.md#variant-styles) for catalogue authoring.
