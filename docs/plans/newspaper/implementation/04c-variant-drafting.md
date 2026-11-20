# Plan 4c: drafting variants

**Status: draft.** Use the tag catalogue from [Plan 4a](04a-styles.md), the owner's writing guidance, and the story types from [Plan 4b](04b-story-mining.md) to draft and check authored variants.

## Goal and success criteria

Every stock template can be told in the voices the newspaper uses, and the stories that matter most also have stance and genre variety.

Done means:

- A drafting command writes candidate variants for chosen template and style combinations into a catalogue overlay.
- Automatic checks reject drafts that would not load, would not print, or claim more than the template's values support.
- The owner accepted a reading sample for each voice, and the accepted variants are merged into `vox-agents/newspaper/templates/`.
- A coverage table shows which combinations each template has.

## Current state

| Area | Today | Source |
| --- | --- | --- |
| Catalogue | 15 templates and 25 variants, plus the stubs Plan 4b adds. | `newspaper/templates/` |
| Placeholders | `{{name}}` values from rule values, identity fields, `terms.*`, the subject, the period and the group. A variant with an unresolved placeholder is not printed. | `substitute` and `printable` in `editorial/selection/templates.ts` |
| Overlays | A directory of catalogue files merges over the stock catalogue by ID. Replay takes it with `--config`. | `editorial/config/load.ts` |
| Reading in context | The replay command renders issues and audits from a recording. | [Replay guide](../../../developers/vox-agents/newspaper/replay.md) |
| Style tags and guidance | Variants use the tag IDs and optional writing guidance in `newspaper/styles/`. | [Plan 4a](04a-styles.md) |

Paths are relative to `vox-agents/src/newspaper/` for code and `vox-agents/` for the runtime catalogue.

## Approach

Draft per template, one style combination at a time, into an overlay under `.tmp/newspaper-drafts/<run>/templates/`. The overlay format means a draft run can be replayed and read before anything touches the stock catalogue.

Do not fill every combination. With 8 voices, 5 stances and 6 genres, one template has 240 possible cells. Use tiers:

| Tier | Templates | Cells to fill |
| --- | --- | --- |
| Every template | All | A neutral report in each voice. |
| Frequent or important | Chosen by how often the rule fires in replay and by owner interest | Add the stances that fit the story, in the voices used most. |
| Short pieces | Templates marked `short` | Add anecdote and joke where the subject allows. |
| Series with history | Templates whose series usually run several issues | Add an analysis variant. |

Use two or three variants per filled cell where a story repeats often, so the wording does not wear out.

## Steps

1. **Build the brief for each template.** Generate it from the catalogue: the story angle, the trigger rule in words, every placeholder the variant may use with an example value from a real replay audit, the link targets, and length guidance. State plainly what the evidence establishes. For example, the besieged city story knows damage and food, and does not know who the attacker is.
2. **Plan the cells.** Produce the coverage table from the tiers above and have the owner adjust it. This table is the work list.
3. **Draft.** Add a drafting command that, for each cell, sends a writer model the brief, the guidance for that voice, stance and genre, and one or two accepted examples in that voice. It returns variants in the catalogue's JSON shape. Rotate two or three writer models so the catalogue does not take on one model's habits. Variant IDs follow `<voice>-<genre>-<stance>-<n>`.
4. **Check automatically.** Reject or flag each draft on:

   | Check | How |
   | --- | --- |
   | Loads | Parse the overlay through the catalogue schema. |
   | Prints | Render against the brief's example values with `printable`; no unknown placeholders. |
   | Length | Within the genre's range from the style guidance. |
   | Supported claims | A different model compares the prose to the brief's facts and flags invented specifics, such as a named attacker or a number that is not a placeholder. |
   | Near-duplicates | Embed drafts for the same template and drop ones that are too similar. |
   | House rules | No modern terms in early voices, no real-world references the game does not have. The style guidance lists these per voice. |

5. **Review.** Render a reading sheet per voice from the drafts that passed, using the example values. The owner reads a sample, marks accept or reject with a short reason, and the reasons go back into that voice's guidance in `styles/voice.json`. Redraft rejected cells once with the improved guidance.
6. **Read in context.** Replay two or three recordings from different eras with the overlay and read whole issues. Voices may mix. Check whether each fits its article and whether the issue repeats phrasing or relies on unsupported claims.
7. **Merge and document.** Move accepted variants into the stock template files, tagged with their voice, stance and genre. Regenerate the coverage table into the [editorial guide](../../../developers/vox-agents/newspaper/editorial.md) and refresh the trigger examples whose wording changed.

## Risks and open questions

- **Which writer and checker models.** The owner chooses. The checker should differ from the writer.
- **Volume against review time.** Fifteen templates with a neutral report in 8 voices is 120 variants before any stance work. The owner samples per voice instead of reading everything, so the automatic checks carry most of the load.
- **Stubs from Plan 4b arriving late.** The command works per template, so new stubs can be drafted in a later run without redoing earlier ones.
- **Catalogue size.** Template files will grow from 25 variants to several hundred. Split files by template if they become hard to edit.

## Verification

- Mock tests for the brief builder and each automatic check, using controlled drafts: one with an unknown placeholder, one over length, one duplicate pair.
- Run `npm run build -w vox-agents` and `npm run test:mock -w vox-agents -- tests/mock/newspaper` after the merge; the packaged catalogue must load with every style reference resolved.
- The owner's acceptance of the per-voice reading sheets and the in-context replay issues.

## Out of scope

Variants written by a model during play and the comparison between editors belong to [Plan 7](07-llm-editors.md). Tuning thresholds, decay and vote effects is not planned. Translation is later work.
