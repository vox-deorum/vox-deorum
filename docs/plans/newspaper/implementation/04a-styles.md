# Plan 4a: Variant tags and editorial preferences

**Status: technical groundwork implemented.** The owner directs the creative tag choices, writing guidance, and tuning. [Plan 4c](04c-variant-drafting.md) uses the catalogue for authored variants. [Plan 7](07-llm-editors.md) validates the same three tag IDs in model proposals.

## Variant tags and rules

Authored variants carry one voice, one stance, and one genre. Set all three together. Untagged legacy variants resolve to `general`, `neutral`, and `report` when selected. Under `newspaper/styles/`, the files `voice.json`, `stance.json`, and `genre.json` register tag IDs and store optional writing guidance. The loader validates variant and rule tags against the effective catalogue.

A rule that matches a single kind of style tag goes in `voice-rules.json`, `stance-rules.json`, or `genre-rules.json`. Rules that match several kinds go in `mixed-rules.json`. A preference applies a positive weight multiplier when the style tags match and its condition holds. For example, a mixed rule can favor a pro-government letter when national or local happiness is high. Missing evidence leaves the preference inactive.

## Heuristic selection

After selecting stories and evaluating page and design eligibility, the editor applies style preferences to the eligible variants for each story. Existing conditions still protect claims that require specific evidence. Each article uses one seeded weighted draw, so several voices can appear in an issue.

Scale each variant's weight by the repeat factor for each kind under `defaults.styleRepeat`: each earlier article in the issue with the same voice, stance or genre tag multiplies the weight by that kind's factor, with stock values voice 1.25, stance 1 and genre 0.8. Count in draw order, including articles later omitted from the pages, and reset each issue. Every eligible variant stays in the draw.

The audit records tags beside variant IDs for displayed articles. Applied preference reads join the decision's evidence. Older saved catalogues keep their original draws and older decisions remain readable.

## Verification

Controlled fixtures check that happiness shifts the odds, missing facts have no effect, factual gates still hold, repeated genres remain possible, and story ranking and design selection stay separate. Replay coverage checks legacy seeds and the displayed article audit. See the [editorial guide](../../../developers/vox-agents/newspaper/editorial.md#variant-styles) for catalogue authoring.
