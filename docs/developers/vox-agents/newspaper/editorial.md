# Newspaper editorial decisions

The heuristic editor turns permitted historical evidence into authored issues without an LLM. It keeps series memory, chooses compatible story combinations, and applies current reader votes to later coverage. [Replay](replay.md) owns offline persistence and the read, vote, continue, and resume workflow. The [renderer](renderer.md) displays the immutable issue and its saved presentation.

## Ownership and inputs

Modules under `vox-agents/src/newspaper/editorial/` separate configuration, detection, matching, selection, feedback, presentation, and validation. `check.ts` accepts an evidence window, publication state, receiver identity, and effective configuration. It returns an issue and updated state, or a skipped check when eligible content or a design is unavailable. Configuration and validation errors preserve the original checkpoint and must be resolved before another attempt. The caller commits completed results. The configuration loader reads files; editorial computations do not open databases or call live game services.

MCP owns evidence schemas and reporting policy. Detectors use the projected observations and their original source references. Recorded identity metadata resolves city owners and team IDs; it must not supply hidden measurements or reveal unmet civilizations. A player ID is not assumed to equal its team ID.

`contracts/publication.ts` defines the versioned checkpoint for series state, preferences, published-item evidence records, and current votes. The session scopes it to a campaign, branch, and receiver. Decisions use a separate schema and are stored beside completed checks and immutable issues. A checkpoint must use schema 2; an older checkpoint fails validation, so regenerate that local run. These offline contracts do not establish the live save representation; the save-capacity proof remains pending in [Plan 5](../../../plans/newspaper/implementation/05-live-integration.md).

## Catalogue and eligibility

The built-in catalogue consists of flat JSON files under `vox-agents/newspaper/catalogue/`. An optional configured directory overlays these files. Defaults are merged as objects; entries with IDs are merged by ID. Ordinary arrays, such as authored paragraphs and tags, are replaced. Effective configuration is validated before the run starts and saved for resume.

| File | Controls |
| --- | --- |
| `defaults.json` | Frequency, selection limits, decay, novelty, variety, stickiness, and feedback coefficients |
| `triggers.json` | Supported detector selection, measured thresholds, importance scales, and tags |
| `templates.json` | Authored variants, typed links, short pieces, and explicit composites |
| `pages.json` | Front page, section membership, and section minimums |
| `designs.json` | Design identities, fixed renderer families, saved tokens/assets, layouts, and eligibility |

Conditions support a finite vocabulary and all/any/not composition. Unknown values remain unknown through negation. For example, missing technology history satisfies neither “Writing researched” nor “Writing not researched.” A choice needs a true condition and a positive final weight. Missing authored placeholders, unavailable variants, and LLM-only templates exclude a candidate before heuristic selection. New detector behavior requires code; prose and tuning belong in the catalogue.

Designs select the supported Victorian or modern renderer family. Each needs an unconditional ordinary and breaking layout with a constant positive weight; additional layouts can use conditions and adjustments. The front page is unconditional. The early account covers Ancient eras and unknown histories, with zero weight once a known later era is recorded. Fonts and ornament references are validated against renderer assets, and section labels must name configured pages. Published presentation snapshots keep old issues independent of later catalogue changes.

## Developments, selection, and continuity

The initial detectors cover domestic city growth contrasts, changes in the concentration of own foreign-route gold, known foreign cultural development, and declarations of war against the receiver. Supported deal, peace, and recovery evidence supplies additional short pieces and authored combinations. Missing values and negative sentinels are unavailable observations. City lifecycle uncertainty suppresses comparisons that cannot establish continuity.

Importance comes from measured developments on a configured bounded scale. Comparisons can reach before the reporting period, but unchanged snapshots do not become new developments merely because another check occurs. A skipped check advances the reporting boundary and discards that check's candidates; series memory persists.

Selection combines importance, decayed series history, novelty, variety, and feedback. Importance is dated and decays once per elapsed turn. Shared-series conflicts reserve each series for one selected item. Only explicit authored composites with compatible subjects and periods can merge: their importance is the maximum contributing importance, and their tags and series keys are deduplicated. A multi-series item contributes its final importance once to each series.

An incoming declaration of war receives priority independently of reader votes. Its report leads an eligible breaking front page. Page membership refers to canonical items, so a story repeated on the front and economy pages has one vote and one history contribution. Validation checks threat placement, subject variety where available, section minimums, and series uniqueness before publication.

Authored placeholders become structured text and typed links. Prose and presentation use separate seeded random streams; page/layout tuning should not change wording. Decisions retain the seed, effective configuration identity and snapshot, candidate scores, merges, selected variants/layouts, evidence references, and feedback inputs. Reopening an issue reads stored content without running selection again.

## Votes and preferences

Each unique item has one current vote: -1, 0, or +1. Assigning the same vote again has no additional effect. Replacing or clearing it removes its previous contribution at the next check. Votes do not change past issues or their decisions, and article importance does not multiply votes.

| Adjustment | Computation |
| --- | --- |
| Series | Sum current votes on all unique items carrying the key, then multiply by the series coefficient. These votes do not expire. |
| Tag window | Most recent configured number of unique published items, including unrated items; built-in size is 50. |
| Distinctiveness | For N window items and df items carrying a tag: `1 + ln((N + 1) / (df + 1))`. |
| Tag bonus | Sum each carrying item's vote divided by its number of distinct tags, then multiply by distinctiveness and the tag coefficient. |
| Candidate adjustment | Add its series adjustments to the mean bonus for its distinct tags, then apply the configured bound. |

The decision records the corpus, votes, tag counts, coefficients, and resolved adjustments used for that check. This preserves an explanation even after votes change.

Preferences store publication frequency in Standard-equivalent turns and whether LLM use is enabled. Built-in defaults are five turns and LLM disabled. Configured defaults override built-ins; saved receiver choices take precedence. Game speed resolves frequency to an integer interval of at least one turn. Changing frequency schedules from the last completed check. LLM writing and comparison evaluation remain in [Plan 4](../../../plans/newspaper/implementation/04-offline-evaluation.md).

## Verification and remaining acceptance

Focused tests live under `vox-agents/tests/mock/newspaper/`, mirroring editorial, replay, and renderer ownership. They exercise conditions with missing history, authored matching and merging, series conflicts and decay, urgent priority, page duplication, deterministic choices, vote replacement, transaction rollback, and resume. Run `npm run test:mock -w vox-agents -- tests/mock/newspaper`, `npm run type-check -w vox-agents`, and `npm run build:newspaper -w vox-agents`; integration uses root build and test commands.

[Plan 3](../../../plans/newspaper/implementation/03-heuristic-editor.md) retains remaining acceptance gates. Thresholds, decay, content minimums, and vote strength need reading and tuning against recordings. Automated structural checks do not establish that the coverage is interesting or well paced.
