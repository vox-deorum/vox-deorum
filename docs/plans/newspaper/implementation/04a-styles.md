# Plan 4a: narrative and design styles

**Status: draft.** First of three streams that give the newspaper its substance. This stream decides how stories can sound and look. [Plan 4b](04b-story-mining.md) finds what stories to tell and runs independently. [Plan 4c](04c-variant-drafting.md) needs both to write the variants.

## Goal and success criteria

Produce a style catalogue with four axes, each with weights that respond to the receiving civilization and the story. The heuristic editor uses the weights to choose among authored variants, and [Plan 7](07-llm-editors.md) passes the same guidance to the model.

| Axis | Answers | Example values | Weighted by |
| --- | --- | --- | --- |
| **Voice** | Who is speaking, in which medium? | Oral account, court chronicle, merchant gazette, broadsheet, wire bulletin, feed post | Civilization and technology |
| **Stance** | Whose side does this piece take? | Pro-government, anti-government, pro-foreign government, anti-foreign government, neutral | Home conditions and the relationship with the story's subject |
| **Genre** | What kind of piece is it? | Report, analysis, opinion, anecdote, joke, letter, obituary, notice | Story size, history available, voice |
| **Design** | How does the issue look? | The three stock designs plus candidates | Civilization and technology, as today |

Done means:

- The owner accepted a sample sheet that shows the same few stories across voices, stances and genres.
- The catalogue loads from `vox-agents/newspaper/`, every variant resolves to a voice, stance and genre, and the decision audit records them.
- A replay shows the mix shifting with the facts. For example, an unhappy empire prints more anti-government pieces than a content one on the same story.

## Current state

| Area | Today | Source |
| --- | --- | --- |
| Variant fields | `id`, `headline`, `subheadline`, `byline`, `body`, `links`, `when`, `weight`. No style field of any kind. | `editorial/config/schema.ts` |
| Stance | Hand-written per template. The wartime Golden Age story has critical, straight and supportive variants gated on `self.happinessPercentage`. | `newspaper/templates/nation.json` |
| Voice | Only through the design's era gate. All 25 stock variants read as general news. | `newspaper/designs/` |
| Genre | Opinion, obituary and satire exist only as probes, which do not ship. | `newspaper/probes/` |
| Designs | `oral-accounts`, `victorian`, `modern`, chosen per issue by `when` and `weight` with stickiness. | `editorial/presentation/issue.ts` |
| Civilization facts | `self.name`, `self.leader`, `self.era`, `self.ideology`, policy branches, religion. | `editorial/facts/player.ts` |
| Relationship facts | `relation(other)` gives war, friendship, pacts, vassalage and the recorded direction of denouncements and open borders. | `editorial/facts/guest.ts` |

Stance rules can already read relationship direction from the [player facts](../../../developers/vox-agents/newspaper/triggers/facts.md#player), including denouncements, open borders, war weariness and city-state standing. Add a variant for an angle only when the sample sheet shows it matters.

Paths in this plan are relative to `vox-agents/src/newspaper/` for code and `vox-agents/` for the runtime catalogue.

## Approach

Each axis is a small list of entries in a new `newspaper/styles.json`. An entry has an ID, short writing guidance, and the same `when` and `weight` fields that variants and designs already use. A variant names its voice, stance and genre. Its final weight is its own weight multiplied by the weights of the three entries it names, so a zero on any axis removes it.

| Alternative | Why this plan does not use it |
| --- | --- |
| Named style bundles, such as "loyal court chronicle" | Bundles multiply quickly and cannot share a stance rule across voices. |
| Keep hand-written `when` on every variant | Works for 25 variants. It does not scale to the hundreds Plan 4c will draft, and the rules drift apart. |
| Style chosen by the design | The spec keeps wording and visual design as separate choices. |

Voice is chosen once per issue and kept while it stays eligible, the way designs are, so one issue reads as one publication. Stance and genre are chosen per article through the variant weights.

## Steps

1. **Brainstorm candidates.** Use several LLMs to propose voices for each medium in the spec's technology table and for groups of civilizations, plus stances and genres beyond the starting lists. Add style ideas that Plan 4b's mining surfaces. Keep everything; this step wants range.
2. **Write the sample sheet.** Pick three stock stories with different shapes: the settler departure (local), the nearby capital falling (foreign), and the wartime Golden Age (national). Write each in every candidate voice, and in each stance and genre for two of the voices. Save it under `.tmp/newspaper-styles/` as a page the owner can skim.
3. **Owner prunes.** The owner marks voices, stances and genres to keep, merge or drop. Target a first set small enough to fill: about 6 to 8 voices, the 5 stances, and 5 to 7 genres.
4. **Write the catalogue.** For each kept entry, write the guidance (diction, length, headline habit, how it shows doubt, one accepted example) and its weight rule. Starting rules:

   | Entry | Starting weight rule |
   | --- | --- |
   | Voice | Base weight by era band and named technology milestones, using the era when a name is unknown; a bonus for the named civilizations it was written for. |
   | Anti-government | Low base; rises as `self.happinessPercentage` falls. |
   | Pro-government | Rises with happiness and during a Golden Age. |
   | Anti-foreign government | Applies when the story's subject is another civilization; rises at war with it. |
   | Pro-foreign government | Same subject test; rises with friendship or a defensive pact. |
   | Neutral | Constant base, so a plain version is always eligible. |
   | Analysis | Needs enough earlier coverage of the series. |
   | Joke, anecdote | Only for short templates; lower in an issue with an urgent story. |

5. **Add the schema and selection.** Add the `styles.json` schema and loading to `editorial/config/{schema,load}.ts`. Add optional `voice`, `stance` and `genre` to the variant schema, defaulting to a general voice, `neutral` and `report`, so the 25 stock variants stay valid. Reject unknown IDs at load. Choose the issue's voice beside the design in `editorial/presentation/issue.ts`, then multiply the axis weights into the variant weights. Give stance rules access to the candidate's subject so foreign stances can test the relationship. Record the chosen voice and each article's stance and genre beside `selectedVariants` in `contracts/publication.ts`.
6. **Validate milestones on recordings.** Replay the voice rules against existing recordings, checking named technology milestones with `self.hasTechnology` and era bands where a name is unknown. Add a researched technology list to the recorded player summary only if incomplete recordings change the voice at a milestone.
7. **List design candidates.** Record which further visual designs the kept voices call for, such as bamboo slips or a portrait card feed. Building them belongs to [Plan 1](01-renderer.md) after its size budget is measured.
8. **Tag the stock variants and document.** Tag the existing variants that already carry a stance. Package `styles.json` in `scripts/installer.iss`. Describe the axes and weights in the [editorial guide](../../../developers/vox-agents/newspaper/editorial.md).

## Risks and open questions

- **Combinations to fill.** 8 voices × 5 stances × 6 genres is 240 cells per template. Plan 4c fills chosen cells only, and the neutral report in the general voice is the fallback for everything else.
- **Stance coherence.** Per-article stance could make one issue praise and attack the government. If the samples read that way, add a per-publication leaning that persists across issues and shifts slowly. This is the owner's call after step 3.
- **Old issues.** Stored issues keep their prose. Saved configurations without styles load with the defaults.

## Verification

- Mock tests under `tests/mock/newspaper/`: unknown style IDs fail to load; untagged variants take the defaults; a controlled fact change, such as low versus high happiness, shifts which stance wins; the audit records the choices.
- Run `npm run build -w vox-agents` and `npm run test:mock -w vox-agents -- tests/mock/newspaper`.
- Replay the [stock reading examples](../../../developers/vox-agents/newspaper/replay.md#stock-catalogue-reading-examples) and confirm the Golden Age and settler stories still pick the same stance as before.

## Out of scope

Writing variants in bulk belongs to [Plan 4c](04c-variant-drafting.md). New story types belong to [Plan 4b](04b-story-mining.md). New renderer families belong to [Plan 1](01-renderer.md). Translation is later work.
