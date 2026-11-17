# Newspaper editorial decisions

The heuristic editor turns permitted historical evidence into authored issues without an LLM. It keeps series memory, chooses compatible story combinations, and applies current reader votes to later coverage. [Replay](replay.md) owns offline persistence and the read, vote, continue, and resume workflow. The [renderer](renderer.md) displays the immutable issue and its saved presentation.

## Ownership and inputs

Modules under `vox-agents/src/newspaper/editorial/` are grouped by job:

| Location | Responsibility |
| --- | --- |
| `check.ts` | Check orchestration and the publication or skip decision |
| `triggers.ts` | Detector dispatch and bounded importance |
| `config/` | Configuration schema, types, and validation in `schema.ts`; catalogue file loading and overlays in `load.ts` |
| `developments/` | Non-war dispatch in `detect.ts`; city, national, and event measurement in `cities.ts`, `national.ts`, and `events.ts`; shared facts in `development-facts.ts` |
| `diplomacy/` | War and peace in `war-peace.ts`, score progress in `war-progress.ts`, relationship facts in `diplomacy-facts.ts`, and incident inference in `diplomacy-incidents.ts` |
| `selection/` | Authored matching in `templates.ts`, heuristic choice in `heuristic.ts`, feedback in `feedback.ts`, and series memory in `series.ts` |
| `presentation/` | Issue assembly in `issue.ts` and validation in `validation.ts` |
| `shared/` | Conditions and weights; `context.ts` owns `EditorialContext` and `evidenceConditionContext`; `sources.ts` deduplicates table and ID source references in first-seen order; `determinism.ts` owns stable serialization, configuration hashing, and seeded streams |

`check.ts` accepts an evidence window, publication state, receiver identity, and effective configuration. It returns an issue and updated state, or a skipped check when eligible content or a design is unavailable. Configuration and validation errors preserve the original checkpoint and must be resolved before another attempt. The caller commits completed results. `config/load.ts` reads catalogue files; editorial computations do not open databases or call live game services.

MCP owns evidence schemas and reporting policy. Detectors use the projected observations and their original source references. Recorded identity metadata resolves city owners and team IDs; it must not supply hidden measurements or reveal unmet civilizations. A player ID is not assumed to equal its team ID.

`contracts/publication.ts` defines the versioned checkpoint for series state, preferences, published-item evidence records, current votes, and diplomacy pair history. The session scopes it to a campaign, branch, and receiver. Publication-state checkpoints require schema 3; regenerate runs with older checkpoints. This state version is separate from IssueDocument schema 2 and offline replay SQLite `user_version` 2. Decisions use a separate schema and are stored beside completed checks and immutable issues, including the evidence behind inferred war and peace incidents. These offline contracts do not establish the live save representation; the save-capacity proof remains pending in [Plan 5](../../../plans/newspaper/implementation/05-live-integration.md).

## Catalogue and eligibility

The built-in catalogue lives under `vox-agents/newspaper/`. Templates and triggers are grouped into topic files, such as `trade` or `diplomacy`; each entry belongs to one file and retains all its tags. Designs have one file per identity. Each section file contains an array, with all JSON fully expanded using two-space indentation for editing. The [trigger overview](triggers/overview.md) explains shared controls, evidence, overlays, and coverage workflow; its category table links the per-file developments and defaults.

| File | Controls |
| --- | --- |
| `defaults.json` | Frequency, selection limits, decay, novelty, variety, stickiness, and feedback coefficients |
| `triggers/*.json` | Supported detector selection, measured thresholds, importance scales, and tags |
| `templates/*.json` | Authored variants, typed links, short pieces, and explicit composites |
| `pages.json` | Front page, section membership, and section minimums |
| `designs/*.json` | Design identities, fixed renderer families, saved tokens/assets, layouts, and eligibility |

An optional configured directory mirrors this structure and can supply only the files being changed. Section files load in filename order. Defaults merge as objects; entries and authored variants merge by ID across files. Arrays without IDs, such as paragraphs and tags, replace the existing arrays. Flat `templates.json`, `triggers.json`, and `designs.json` overrides remain supported, with grouped overrides applied after them. Effective configuration is validated before the run starts and saved for resume.

Conditions support a finite vocabulary and all/any/not composition. Unknown values remain unknown through negation. For example, missing technology history satisfies neither “Writing researched” nor “Writing not researched.” A choice needs a true condition and a positive final weight. Missing authored placeholders, unavailable variants, and LLM-only templates exclude a candidate before heuristic selection. New detector behavior requires code; prose and tuning belong in the catalogue.

Designs select the supported Victorian or modern renderer family. Each needs an unconditional ordinary and breaking layout with a constant positive weight; additional layouts can use conditions and adjustments. The front page is unconditional. The early account covers Ancient eras and unknown histories, with zero weight once a known later era is recorded. Fonts and ornament references are validated against renderer assets, and section labels must name configured pages. Published presentation snapshots keep old issues independent of later catalogue changes.

## Developments, selection, and continuity

Detectors cover cities, the domestic economy, trade, diplomacy, science, culture, religion, war, and peace. Each development must meet its evidence and materiality rules before a template can turn it into a candidate. The [trigger overview](triggers/overview.md) and its category pages describe those rules. [War and peace coverage](triggers/war-and-peace.md) groups likely declaration cascades, distinguishes obligations and city-state involvement, and tracks score progress and settlements. Both editors aim for useful gameplay interpretation, with proportionate qualification for inferred causes.

Importance comes from measured developments on a configured bounded scale. Comparisons can reach before the reporting period, but unchanged snapshots do not become new developments merely because another check occurs. A skipped check advances the reporting boundary, diplomacy observations, and series memory, then discards that check's candidates.

Selection combines importance, decayed series history, novelty, variety, and feedback. Importance is dated and decays once per elapsed turn. Shared-series conflicts reserve each series for one selected item. Shared incident conflicts also prevent several accounts of one declaration or settlement cascade. Only explicit authored composites with compatible subjects and periods can merge: their importance is the maximum contributing importance, and their tags and series keys are deduplicated. A multi-series item contributes its final importance once to each series.

Domestic participation on a war incident's inferred target side receives priority independently of reader votes and can lead an eligible breaking front page. The built-in At Home page collects domestic stories, Beyond Our Borders collects international stories, and Trade and Livelihood uses economy and trade tags. A section appears only when it meets its configured minimum and includes a story beyond the front page. Page membership refers to canonical items, so a story repeated on the front and economy pages has one vote and one history contribution. Validation checks threat placement, subject variety where available, section minimums, and series uniqueness before publication.

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
