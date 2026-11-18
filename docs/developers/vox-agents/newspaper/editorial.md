# Newspaper editorial decisions

The heuristic editor turns permitted historical evidence into authored issues without an LLM. Stage 5 evaluates trigger rules and stores their audit. The stock catalogue ships two rules and no templates, so a stock check finishes as a skipped check with a recorded audit rather than an issue. The editor keeps series memory, chooses compatible story combinations, and applies current reader votes to later coverage. [Replay](replay.md) owns offline persistence and the read, vote, continue, and resume workflow. The [renderer](renderer.md) displays the immutable issue and its saved presentation.

## Ownership and inputs

Modules under `vox-agents/src/newspaper/editorial/` are grouped by job:

| Location | Responsibility |
| --- | --- |
| `check.ts` | Check orchestration and the publication or skip decision |
| `rules/` | Rule evaluation, repeat memory, grouping, and the per-subject audit |
| `config/` | Configuration schema, types, and validation in `schema.ts`; catalogue file loading and overlays in `load.ts`; expression preparation in `expressions.ts` |
| `diplomacy/` | War, peace and pair score history in `war-peace.ts`, relationship facts in `diplomacy-facts.ts`, and incident inference in `diplomacy-incidents.ts`; stage 6 exposes its facts to rules |
| `selection/` | Authored matching in `templates.ts`, heuristic choice in `heuristic.ts`, feedback in `feedback.ts`, and series memory in `series.ts` |
| `presentation/` | Issue assembly in `issue.ts` and validation in `validation.ts` |
| `shared/` | The expression runner used by rules; conditions and weights for templates, pages and designs until stage 7; `context.ts` owns `EditorialContext` and `evidenceConditionContext`; `sources.ts` deduplicates table and ID source references in first-seen order; `determinism.ts` owns stable serialization, configuration hashing, and seeded streams |

The legacy detector dispatch and its measurements are retired; new coverage belongs in `rules/`.

`check.ts` accepts an evidence window, the built fact model, game speed, publication state, receiver identity, and effective configuration. It returns an issue and updated state, or a skipped check when eligible content or a design is unavailable. Every enabled rule is evaluated and its audit is stored in the decision, including for a skipped check. Configuration and validation errors preserve the original checkpoint and must be resolved before another attempt. The caller commits completed results. `config/load.ts` reads catalogue files; editorial computations do not open databases or call live game services.

MCP owns evidence schemas and reporting policy. Rules use the projected observations and their original source references. Recorded identity metadata resolves city owners and team IDs; it must not supply hidden measurements or reveal unmet civilizations. A player ID is not assumed to equal its team ID.

`contracts/publication.ts` defines editorial state for series, preferences, published-item evidence, current votes, diplomacy pair history, and rule repeat memory. The replay session scopes it to a campaign, branch, and receiver. State uses schema 4; regenerate runs with older state. This version is separate from IssueDocument schema 2 and the replay database's SQLite `user_version` 3. Decisions have their own schema and are stored beside checks and immutable issues, including the trigger audit, repeat outcomes, and the evidence behind inferred war and peace incidents. [Plan 5](../../../plans/newspaper/implementation/05-live-integration.md) will store live editorial state in MCP.

## Catalogue and eligibility

The built-in catalogue lives under `vox-agents/newspaper/`. Triggers are grouped into topic files, such as `cities`; each entry belongs to one file and retains all its tags. Designs have one file per identity. Each section file contains an array, with all JSON fully expanded using two-space indentation for editing. The stock catalogue ships two rules in `triggers/cities.json` and no story templates. The built-in `templates/` directory may be absent. Add templates in an overlay to publish stories.

Stage 5 evaluates [trigger rules](triggers/overview.md) and stores the audit of every check. Templates, weights, pages and designs still use the finite conditions in `shared/conditions.ts`; stage 7 moves them onto the same expressions and facts. [Plan 6](../../../plans/newspaper/implementation/06-trigger-rules.md) tracks the remaining stages.

| File | Controls |
| --- | --- |
| `defaults.json` | Frequency, selection limits, decay, novelty, variety, stickiness, and feedback coefficients |
| `constants.json` | Named distances, spans, sizes, type lists and shortcuts used by every expression. See [constants and shortcuts](triggers/constants.md). |
| `triggers/*.json` | Trigger rules: subject, `when`, `values`, importance, repeat, grouping and tags. See the [trigger overview](triggers/overview.md). |
| `templates/*.json` | Authored variants, typed links and short pieces; optional; no built-in directory is required |
| `pages.json` | Front page, section membership, and section minimums |
| `designs/*.json` | Design identities, fixed renderer families, saved tokens/assets, layouts, and eligibility |

An optional configured directory mirrors this structure and can supply only the files being changed. Section files load in filename order. Defaults and constants merge as objects; entries and authored variants merge by ID across files. Arrays without IDs, such as paragraphs, tags and `when` lists, replace the existing arrays. Effective configuration is validated before the run starts and saved for resume.

Trigger rules use JavaScript over the [fact model](triggers/facts.md). Other catalogue choices use structured conditions. Their editorial context includes the receiver's recorded player values, `civilization`, `receiverPlayerId`, `cutoffTurn` and any supplied technology history. Replay does not supply technology history to these conditions.

| Entry | Its condition reads | Example |
| --- | --- | --- |
| Trigger `when` | Its subject and the rule globals | `city.is.neighbor && city.isPuppet` |
| Page conditions; template, design and layout conditions and weight adjustments | Editorial context | `{ "op": "eq", "field": "Era", "value": "Medieval Era" }` |
| Variant conditions and weight adjustments | Editorial context plus the development's `values` | `{ "op": "gte", "field": "lost", "value": 2 }` |

A template lists the trigger IDs it reports in `triggerIds`. With several IDs, all must fire for the same subject with overlapping evidence periods, and the editor combines their `values`. An ungrouped development supplies non-null scalar rule values as placeholders. A grouped development supplies only `count` and a non-null `key`; the per-subject values stay in its structured `matches` list. Subject names, IDs and reporting turns are not injected automatically in stage 5. To use `{{town}}`, for example, add `town: city.name` to an ungrouped trigger's `values` in your overlay.

A choice needs a true condition and a positive final weight. A condition or expression that reads a [hidden fact](triggers/facts.md#hidden-and-missing-facts) makes that choice ineligible, so missing technology history satisfies neither "Writing researched" nor its opposite. Missing authored placeholders, unavailable variants, and LLM-only templates exclude a candidate before heuristic selection. New facts require code; rules, prose and tuning belong in the catalogue.

Designs select the supported Victorian or modern renderer family. Each needs an unconditional ordinary and breaking layout with a constant positive weight; additional layouts can use conditions and adjustments. The front page is unconditional. The early account covers Ancient eras and unknown histories, with zero weight once a known later era is recorded. Fonts and ornament references are validated against renderer assets, and section labels must name configured pages. Published presentation snapshots keep old issues independent of later catalogue changes.

## Developments, selection, and continuity

Trigger rules turn facts about cities, players, events and the world into developments. A rule must hold for its subject before a template can turn the development into a candidate. The [trigger overview](triggers/overview.md) describes rules and the [examples](triggers/examples.md) show complete ones. The stock catalogue ships `neighbor-puppet-annexed` and `settler-departure`; Stage 8 expands the catalogue with the remaining 12 examples and their stories. Two of those examples depend on stage 6 pair and incident facts. [War and peace coverage](triggers/war-and-peace.md) groups likely declaration cascades, distinguishes obligations and city-state involvement, and tracks score progress and settlements. The heuristic editor and the planned LLM editor both aim for useful gameplay interpretation, with proportionate qualification for inferred causes.

Importance comes from each trigger's `importance` expression on a scale from 0 to 100. Comparisons can reach before the reporting period, and an unchanged situation produces a new development only when its trigger sets `repeat` to a span and that span has passed. Repeat memory is saved with publication state. A skipped check advances the reporting boundary, diplomacy observations, rule repeat state, and series memory, then discards that check's candidates.

Selection combines importance, decayed series history, novelty, variety, and feedback. Importance is dated and decays once per elapsed turn. Each series follows one rule and subject. Selection reserves each series for one item per issue. A template that names several triggers takes the highest importance among them, and its tags and series keys are deduplicated. A multi-series item contributes its final importance once to each series.

If selection includes an eligible urgent story, one urgent story leads a breaking front page. Stage 6 will let a rule decide urgency from incident facts. The built-in At Home page collects domestic stories, Beyond Our Borders collects international stories, and Trade and Livelihood uses economy and trade tags. A section appears only when it meets its configured minimum and includes a story beyond the front page. Page membership refers to canonical items, so a story repeated on the front and economy pages has one vote and one history contribution. Validation checks threat placement, subject variety where available, section minimums, and series uniqueness before publication.

Authored placeholders become structured text and typed links. Prose and presentation use separate seeded random streams; page/layout tuning should not change wording. Decisions retain the seed, effective configuration identity and snapshot, candidate scores, merges, selected variants/layouts, evidence references, feedback inputs, the trigger audit, and repeat outcomes. Reopening an issue reads stored content without running selection again.

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
