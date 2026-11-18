# Newspaper editorial decisions

The heuristic editor turns permitted historical evidence into authored issues without an LLM. Step 7 evaluates trigger rules and every authored choice with JavaScript in QuickJS. The stock catalogue ships two city rules and no story templates, so a stock check finishes as a skipped check with a recorded audit rather than an issue. The editor keeps series memory, chooses compatible stories, and applies current reader votes to later coverage. [Replay](replay.md) owns offline persistence and the read, vote, continue, and resume workflow. The [renderer](renderer.md) displays the immutable issue and its saved presentation.

## Ownership and inputs

Modules under `vox-agents/src/newspaper/editorial/` are grouped by job:

| Location | Responsibility |
| --- | --- |
| `check.ts` | Check orchestration and the publication or skip decision |
| `facts/` | The visible fact model for cities, players, events, pairs, incidents and the world |
| `diplomacy/` | War and peace inference, incident grouping, and dated pair state and scores |
| `rules/` | Rule evaluation, repeat memory, grouping, and the per-subject audit |
| `config/` | Catalogue schema and validation in `schema.ts`; file loading and overlays in `load.ts`; catalogue compilation in `expressions.ts` through `prepareEditorialExpressions` and `getEditorialExpressions` |
| `selection/` | Template matching in `templates.ts`, heuristic choice in `heuristic.ts`, feedback in `feedback.ts`, and series memory in `series.ts` |
| `presentation/` | Choice evaluation in `eligibility.ts`, issue assembly in `issue.ts`, and validation in `validation.ts` |
| `shared/` | The QuickJS runner, choice eligibility in `eligibility.ts`, weights, `EditorialContext`, source references, and deterministic serialization |

Add new coverage under `vox-agents/newspaper/triggers/` and any publishable story templates under `vox-agents/newspaper/templates/`. Extend `editorial/facts/` when a rule needs a fact the editor does not yet supply.

`check.ts` accepts an evidence window, the built fact model, game speed, publication state, receiver identity, and effective configuration. It returns an issue and updated state, or a skipped check when eligible content or a design is unavailable. Every enabled rule is evaluated and its audit is stored in the decision, including for a skipped check. Configuration and validation errors preserve the original checkpoint and must be resolved before another attempt. The caller commits completed results. `config/load.ts` reads catalogue files; editorial computations do not open databases or call live game services.

MCP owns evidence schemas and reporting policy. Rules use the projected observations and their original source references. Recorded identity metadata resolves city owners and team IDs; it must not supply hidden measurements or reveal unmet civilizations. A player ID is not assumed to equal its team ID.

`contracts/publication.ts` defines editorial state for series, preferences, published-item evidence, current votes, diplomacy pair history, and rule repeat memory. The replay session scopes it to a campaign, branch, and receiver. State uses schema 6; regenerate runs with older state. This version is separate from IssueDocument schema 2 and the replay database's SQLite `user_version` 5. Decisions have their own schema and are stored beside checks and immutable issues, including the trigger audit, repeat outcomes, and the evidence behind inferred war and peace incidents. [Plan 5](../../../plans/newspaper/implementation/05-live-integration.md) will store live editorial state in MCP.

## Catalogue and eligibility

The built-in catalogue lives under `vox-agents/newspaper/`. Triggers are grouped into topic files, such as `cities`; each entry belongs to one file and retains all its tags. Designs have one file per identity. Each section file contains an array, with all JSON fully expanded using two-space indentation for editing. The stock catalogue ships two rules in `triggers/cities.json` and no story templates. The built-in `templates/` directory may be absent. Add templates in an overlay to publish stories.

| File | Controls |
| --- | --- |
| `defaults.json` | Frequency, selection limits, decay, novelty, variety, stickiness, and feedback coefficients |
| `constants.json` | Named distances, spans, sizes, type lists and shortcuts used by every expression. See [constants and shortcuts](triggers/constants.md). |
| `triggers/*.json` | Trigger rules: subject, `when`, `values`, importance, repeat, grouping and tags. See the [trigger overview](triggers/overview.md). |
| `templates/*.json` | Authored variants, typed links and short pieces; optional; no built-in directory is required |
| `pages.json` | Front page, section membership, and section minimums |
| `designs/*.json` | Design identities, fixed renderer families, saved tokens/assets, layouts, and eligibility |

An optional configured directory mirrors this structure and can supply only the files being changed. Section files load in filename order. Defaults and constants merge as objects; entries and authored variants merge by ID across files. Arrays without IDs, such as paragraphs, tags and `when` lists, replace the existing arrays. Effective configuration is validated before the run starts and saved for resume.

## Authoring choices

Templates, variants, pages, designs and layouts can have a JavaScript expression string in `when`. Templates, variants, designs and layouts also take a `weight`, for example `{"base": 2, "adjustments": [{"when": "turn > 100", "add": 1}]}`. Pages use eligibility and their section minimum.

- A missing `when` makes the choice eligible without a condition. A present condition that is false, fails, or reads a [hidden fact](triggers/facts.md#hidden-and-missing-facts) removes that choice.
- Each true adjustment adds its `add` value. A false condition or unavailable fact contributes nothing. A choice whose adjustment could not finish within the execution budget is left out.
- The final weight must be greater than zero. Weight influences design, layout and variant selection; template weight joins the candidate score.

All conditions run in the shared QuickJS sandbox with no filesystem, network, clock or random source. A trigger expression reads its subject, earlier values and the check globals. Template and variant conditions read the visible fact namespace for the subject, such as `city.population`, plus the candidate bindings described below. Page, design and layout conditions read the visible facts and check globals without candidate bindings.

A template names one or more rules in `triggers`. They must all fire for the same subject with overlapping evidence periods. For example, two city rules must match the same city. Grouped rules can combine with other grouped rules of the same subject kind and key. The editor uses the overlapping period, the highest importance and the combined tags.

| Template field | Meaning |
| --- | --- |
| `id` | Stable identity used by overlays and decisions |
| `triggers` | Trigger IDs that must all match the same subject |
| `tags` | Topic and scope labels for pages, variety and feedback |
| `mode` | `authored` (default) or `llmOnly`; the heuristic editor skips `llmOnly` templates |
| `short` | Marks a short filler story reserved near the item limit |
| `weight` | Base weight and conditional adjustments |
| `variants` | Authored prose choices, each with `id`, `headline`, `body`, optional `links`, optional `when`, and `weight` |

`id`, `triggers`, `tags`, `weight` and `variants` are required. Each variant requires `id`, `headline`, `body` and `weight`; `when` and `links` are optional.

### Placeholders and facts

Prose and typed link values use `{{name}}` placeholders. The editor supplies these from the same visible subject that rules can read:

| Placeholder | Value |
| --- | --- |
| `{{city}}`, `{{cityId}}`, `{{owner}}` | Short aliases for the subject name, subject ID, and a named reference field on the subject, such as a city owner |
| `{{subject.name}}`, `{{subject.id}}` | The visible subject's name and ID |
| `{{period.from}}`, `{{period.to}}` | The matched rules' shared window: exclusive lower bound and inclusive cutoff turn |
| `{{city.owner.name}}` | A namespaced reference, here the owner of a city subject |
| `{{lost}}` | A scalar rule value from the ungrouped development |
| `{{key}}`, `{{count}}` | A grouped development's non-null scalar key and member count |

Use qualified names such as `{{city.owner.name}}` and `{{subject.id}}` for recorded identities. An unresolved placeholder or invalid link destination makes that variant unprintable.

For a single group, prose can print `{{key}}` and `{{count}}`. Expressions can read each member, for example `group.matches[0].city.name` and `group.matches[0].values`. If two rules grouped cities by the same religion, they may have counted different cities. Name the rule in the placeholder, such as `{{triggerValues.conversions.count}}`, or read its members with `triggerValues.conversions.matches`. When two ungrouped rules supply the same value name, qualify it the same way. An ambiguous bare placeholder leaves that variant out.

### Pages and designs

The front page is unconditional. Each design needs one unconditional ordinary layout and one unconditional breaking layout, both with a constant positive weight. Other pages can use `when`; designs and extra layouts can also adjust their weights. Section labels must name configured pages, and fonts and ornaments are validated against renderer assets.

The stock designs choose by `self.era`. `victorian` runs from the Classical through Future eras, `modern` from Modern through Future, and `oral-accounts` is the fallback for Ancient or unknown eras. Published presentation snapshots keep old issues independent of later catalogue changes.

### Example: publish the settler rule

The copyable overlay in the [trigger examples](triggers/examples.md#a-city-shrinks-after-sending-settlers) adds a template for `settler-departure`. It shows the shared choice shape, a variant condition on `lost`, subject aliases, and in-world prose that does not claim a literal headcount.

## Developments, selection, and continuity

Trigger rules turn facts about cities, players, events, pairs, incidents and the world into developments. A rule must hold for its subject before a template can turn the development into a candidate. The [trigger overview](triggers/overview.md) describes rules and the [examples](triggers/examples.md) show complete ones. The stock catalogue ships `neighbor-puppet-annexed` and `settler-departure`; Step 8 adds the remaining 12 examples and their stories. Two of those examples use pair and incident facts and run as overlays now. [War and peace coverage](triggers/war-and-peace.md) groups likely declaration cascades, distinguishes obligations and city-state involvement, and tracks score progress and settlements.

Importance comes from each trigger's `importance` expression on a scale from 0 to 100. Comparisons can reach before the reporting period, and an unchanged situation produces a new development only when its trigger sets `repeat` to a span and that span has passed. Repeat memory is saved with publication state. A skipped check advances the reporting boundary, diplomacy observations, rule repeat state, and series memory, then discards that check's candidates.

Selection combines importance, decayed series history, novelty, variety, template weight, and feedback. Importance is dated and decays once per elapsed turn. Each series follows one rule and subject. Selection reserves each series for one item per issue. A template that names several triggers takes the highest importance among them, and its tags and series keys are deduplicated. A multi-series item contributes its final importance once to each series.

If selection includes an eligible urgent story, one urgent story leads a breaking front page. A rule decides urgency from incident facts. The built-in At Home page collects domestic stories, Beyond Our Borders collects international stories, and Trade and Livelihood uses economy and trade tags. A section appears only when it meets its configured minimum and includes a story beyond the front page. Page membership refers to canonical items, so a story repeated on the front and economy pages has one vote and one history contribution. Validation checks threat placement, subject variety where available, section minimums, and series uniqueness before publication.

Authored placeholders become structured text and typed links. Prose and presentation use separate seeded random streams; page/layout tuning should not change wording. Decisions retain the seed, effective configuration identity and snapshot, candidate scores, selected variants/layouts, evidence references, feedback inputs, the trigger audit, and repeat outcomes. Reopening an issue reads stored content without running selection again.

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

Focused tests live under `vox-agents/tests/mock/newspaper/`, mirroring editorial, replay, and renderer ownership. They exercise hidden facts, multi-trigger matching, group bindings, series conflicts and decay, urgent priority, page duplication, deterministic choices, vote replacement, transaction rollback, and resume. Run `npm run test:mock -w vox-agents -- tests/mock/newspaper`, `npm run type-check -w vox-agents`, and `npm run build:newspaper -w vox-agents`; integration uses root build and test commands.

[Plan 3](../../../plans/newspaper/implementation/03-heuristic-editor.md) retains remaining acceptance gates. Thresholds, decay, content minimums, and vote strength need reading and tuning against recordings. Automated structural checks do not establish that the coverage is interesting or well paced.
