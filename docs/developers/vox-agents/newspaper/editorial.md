# Newspaper editorial decisions

The heuristic editor turns permitted historical evidence into authored issues without an LLM. A check with no eligible story or design is saved as a skipped check with its audit. The editor keeps series memory, chooses compatible stories, and applies current reader votes to later coverage. [Replay](replay.md) owns offline persistence and the read, vote, continue, and resume workflow. The [renderer](renderer.md) displays the immutable issue and its saved presentation.

## Ownership and inputs

Modules under `vox-agents/src/newspaper/editorial/` are grouped by job:

| Location | Responsibility |
| --- | --- |
| `check.ts` | Check orchestration and the publication or skip decision |
| `facts/` | The visible fact model for cities, players, events, pairs, incidents and the world |
| `diplomacy/` | War and peace inference, incident grouping, and dated pair state and scores |
| `rules/` | Rule evaluation, repeat memory, grouping, and the per-subject audit |
| `config/` | Catalogue schema and validation in `schema.ts`; file loading and overlays in `load.ts`; catalogue compilation in `expressions.ts` through `prepareEditorialExpressions` and `getEditorialExpressions` |
| `selection/` | Template matching, heuristic choice, style preferences, feedback, and series memory |
| `presentation/` | Choice evaluation in `eligibility.ts`, issue assembly in `issue.ts`, and validation in `validation.ts` |
| `shared/` | The QuickJS runner, choice eligibility in `eligibility.ts`, weights, `EditorialContext`, source references, and deterministic serialization |

Add new coverage under `vox-agents/newspaper/triggers/` and its story template under `vox-agents/newspaper/templates/`. Extend `editorial/facts/` when a rule needs a fact the editor does not yet supply.

`check.ts` accepts an evidence window, the built fact model, game speed, publication state, receiver identity, and effective configuration. It returns an issue and updated state, or a skipped check when eligible content or a design is unavailable. Every enabled rule is evaluated and its audit is stored in the decision, including for a skipped check. Configuration and validation errors preserve the original checkpoint and must be resolved before another attempt. The caller commits completed results. `config/load.ts` reads catalogue files; editorial computations do not open databases or call live game services.

MCP owns evidence schemas and reporting policy. Rules use the projected observations and their original source references. Recorded identity metadata resolves city owners and team IDs; it must not supply hidden measurements or reveal unmet civilizations. A player ID is not assumed to equal its team ID.

`contracts/publication.ts` defines editorial state for series, preferences, published-item evidence, current votes, diplomacy pair history, and rule repeat memory. The replay session scopes it to a campaign, branch, and receiver. State uses schema 6; regenerate runs with older state. This version is separate from IssueDocument schema 2 and the replay database's SQLite `user_version` 5. Replay stores decisions beside checks and immutable issues, including the trigger audit, repeat outcomes, and the evidence behind inferred war and peace incidents.

## Catalogue and eligibility

The built-in catalogue lives under `vox-agents/newspaper/`. Rules and matching templates are grouped into `cities.json`, `nation.json`, and `foreign.json` in their respective directories. Each design has its own file. An overlay adds or tunes entries without replacing the stock catalogue.

| File | Controls |
| --- | --- |
| `defaults.json` | Frequency, selection limits, decay, novelty, variety, stickiness, style repeat factors, and feedback coefficients |
| `constants.json` | Named distances, spans, sizes, type lists and shortcuts, plus printable terms used by prose and mastheads. See [constants and shortcuts](triggers/constants.md). |
| `triggers/*.json` | Trigger rules: subject, `when`, `values`, importance, repeat, grouping and tags. See the [trigger overview](triggers/overview.md). |
| `templates/*.json` | Authored variants, typed links and short pieces, grouped by topic like triggers |
| `styles/` | Style tag IDs, optional writing guidance, and rules that adjust variant weights |
| `pages.json` | Front page, section membership, and section minimums |
| `designs/*.json` | Design identities, fixed renderer families, saved tokens/assets, masthead title and motto, layouts, and eligibility |

An optional configured directory mirrors this structure and can supply only the files being changed. Section files load in filename order. Defaults and constants merge as objects; entries and authored variants merge by ID across files. Arrays without IDs, such as paragraphs, tags and `when` lists, replace the existing arrays. Effective configuration is validated before the run starts and saved for resume.

## Authoring choices

Templates, variants, pages, designs and layouts can have a JavaScript expression string in `when`. Templates, variants, designs and layouts also take a `weight`, for example `{"base": 2, "adjustments": [{"when": "turn > 100", "add": 1}]}`. Pages use eligibility and their section minimum.

- A missing `when` makes the choice eligible without a condition. A present condition that is false, fails, or reads a [hidden fact](triggers/facts.md#hidden-and-missing-facts) removes that choice.
- Each true adjustment adds its `add` value. A false condition or unavailable fact contributes nothing. A choice whose adjustment could not finish within the execution budget is left out.
- The final weight must be greater than zero. Weight influences design, layout and variant selection; template weight joins the candidate score.

All conditions run in the shared QuickJS sandbox with no filesystem, network, clock or random source. A trigger expression reads its subject, earlier values and the check globals. Template and variant conditions read the visible fact namespace for the subject, such as `city.population`, plus the candidate bindings described below. Page, design and layout conditions read the visible facts and check globals without candidate bindings. Trigger, template and presentation expressions can also read the publication memory globals `press` and `printed`; see [publication memory](triggers/overview.md#publication-memory).

A template names one or more rules in `triggers`. They must all fire for the same subject with overlapping evidence periods. For example, two city rules must match the same city. Grouped rules can combine with other grouped rules of the same subject kind and key. The editor uses the overlapping period, the highest importance and the combined tags.

| Template field | Meaning |
| --- | --- |
| `id` | Stable identity used by overlays and decisions |
| `triggers` | Trigger IDs that must all match the same subject |
| `tags` | Topic and scope labels for pages, variety and feedback |
| `mode` | `authored` (default) or `llmOnly`; the heuristic editor skips `llmOnly` templates |
| `short` | Marks a short filler story reserved near the item limit |
| `weight` | Base weight and conditional adjustments |
| `variants` | Authored prose choices with an ID, text, links, eligibility, weight, and style tags |

`id`, `triggers`, `tags`, `weight` and `variants` are required. Each variant requires `id`, `headline`, `body` and `weight`; `subheadline`, `byline`, `when` and `links` are optional. The reader draws the subheadline under the headline and the byline below it, so an opinion piece or a signed report can carry both.

### Variant styles

Each variant can carry one style tag of each kind: voice, stance and genre. Set all three together and register each ID in `voice.json`, `stance.json` or `genre.json` under `styles/`. An untagged variant uses `general`, `neutral` and `report`. Style tags describe the prose and do not change the template's topic tags, page placement or layout.

Voice sets how the piece sounds, stance sets the position it takes, and genre sets its form. A peace treaty can be covered in a report or a letter. A neutral account explains the terms; a pro-government account makes the case for signing. See `styles/genre.json` and `styles/stance.json` for drafting guidance.

Put a rule that matches only one kind of style tag in `voice-rules.json`, `stance-rules.json` or `genre-rules.json` under `styles/`. Put a rule that matches two or more kinds in `mixed-rules.json`. The loader reads the four files in that order, with all stock rules before overlay rules. Rule IDs must be unique across the files.

Every style rule has an `id`, a `match`, a `when` expression, and a positive `multiplier`. A variant must match an allowed style tag for every kind named in `match`. For example, a mixed rule can double the weight of letters with a `pro-government` or `government-critical` stance when `self.happinessPercentage > 50`. Use the variant's own `when` for evidence required by its wording.

A style rule's `when` can also read facts about the selected story:

| Story fact | Meaning |
| --- | --- |
| `story.importance` | The candidate's importance on the same scale as trigger importance |
| `story.urgent` | Whether the candidate is marked urgent |
| `story.short` | Whether the candidate is a short filler story |
| `story.tags` | The candidate's topic and scope tags |

For example, `story.tags.includes('military')` applies a preference only to stories tagged military. Guard subject-specific facts in shared rules. For example, check `subject.kind === 'city'` before reading `city.happinessDelta`. The editor applies rules after choosing stories. A false condition, an error, or unavailable evidence leaves the weight unchanged. For displayed stories, facts read by applied preferences join the decision audit without becoming evidence for the article's claims.

The editor makes one weighted draw per article. Each earlier article in the issue whose chosen variant has the same style tag multiplies the weight by that kind's factor in `defaults.styleRepeat`. A factor below 1 discourages repeats, and a factor above 1 encourages them. The stock factors are voice 1.25, stance 1 and genre 0.8, so a repeated genre is slightly discouraged while a repeated voice is favored. Counts follow draw order and include articles later omitted from the pages. Saved catalogues without `styles` keep their original draw behavior.

To add style tags, guidance or rules, include just the files you need under your overlay's `styles/` folder. Style tag definitions merge by ID. If the overlay also has an older flat `styles.json`, the files in `styles/` take precedence over entries with the same ID in that flat file.

#### Stock rule groups

The stock rules are easiest to read by the evidence each group uses. Style rules read lasting conditions of the nation, and single events are covered by [triggers](triggers/overview.md).

| Group | What it reads | Example effect |
| --- | --- | --- |
| Era | `self.era` | A feed loses weight before the Information era. |
| Story | Urgency, shortness, importance and tags | Crier and broadcast gain on urgent news. |
| Policy branches | Recorded policy branches | Fealty lifts devout and traditional. |
| Ideology | `self.ideology` | Order lifts press and pamphlet. |
| Religion | Founded and majority religion | A founded religion lifts devout; a different majority faith lifts traditional. |
| Happiness | Happiness percentage and golden age status | Low happiness lifts government-critical and populist. |
| City unhappiness | Top causes across the receiver's readable `city.unhappiness` breakdowns | Boredom in a third of cities lifts artistic and anecdote. |
| War | War state, score, weariness, vassalage and denouncements from relationships | A winning war lifts hawkish and national; war weariness lifts conciliatory. |
| Treasury | Gold per turn | A deficit lifts government-critical and populist. |
| Standing | Score rank and city count | A small nation lifts local; last place lifts government-critical. |
| World Congress | `game.congress` active resolutions and session timing | An active Global Peace Accords lifts conciliatory and lowers hawkish. |

### Placeholders and facts

Prose and typed link values use `{{name}}` placeholders. Headlines, subheadlines, bylines and bodies all use the same placeholders, and every one of them joins the printable text and its source rows. The editor supplies these from the same visible subject that rules can read:

| Placeholder | Value |
| --- | --- |
| `{{city}}`, `{{cityId}}`, `{{owner}}` | Short aliases for the subject name, subject ID, and a named reference field on the subject, such as a city owner |
| `{{subject.name}}`, `{{subject.id}}` | The visible subject's name and ID |
| `{{period.from}}`, `{{period.to}}` | The matched rules' shared window: exclusive lower bound and inclusive cutoff turn |
| `{{city.owner.name}}` | A namespaced reference, here the owner of a city subject |
| `{{lost}}` | A scalar rule value from the ungrouped development |
| `{{key}}`, `{{count}}` | A grouped development's non-null scalar key and member count |
| `{{terms.<name>}}` | A printable [term](triggers/constants.md#terms) defined by the catalogue, such as the receiver's capital |

Use qualified names such as `{{city.owner.name}}` and `{{subject.id}}` for recorded identities. An unresolved placeholder, empty link label or invalid link destination makes the variant unprintable. The editor evaluates a term once from the check's global facts, so `{{terms.capital}}` means the same thing in every article. Each variant cites the rows behind the terms it prints.

For a single group, prose can print `{{key}}` and `{{count}}`. Expressions can read each member, for example `group.matches[0].city.name` and `group.matches[0].values`. If two rules grouped cities by the same religion, they may have counted different cities. Name the rule in the placeholder, such as `{{triggerValues.conversions.count}}`, or read its members with `triggerValues.conversions.matches`. When two ungrouped rules supply the same value name, qualify it the same way. An ambiguous bare placeholder leaves that variant out.

### Pages and designs

The front page is unconditional. Each design needs one unconditional ordinary layout and one unconditional breaking layout, both with a constant positive weight. Other pages can use `when`; designs and extra layouts can also adjust their weights. Section labels must name configured pages, and fonts and ornaments are validated against renderer assets.

The stock designs choose by `self.era`. `victorian` runs from the Classical through Future eras, `modern` from Modern through Future, and `oral-accounts` is the fallback for Ancient or unknown eras. Published presentation snapshots keep old issues independent of later catalogue changes.

### Masthead and terms

A design's `title` and optional `motto` may print [terms](triggers/constants.md#terms), the named printable expressions a catalogue defines under `constants.terms`. `presentIssue` substitutes the resolved terms into both and uses `defaults.publicationTitle` only when the resolved title is empty. `chooseDesign` rejects a design whose title or motto still holds an unresolved placeholder before it weights designs, so an ineligible design is never chosen, including when it was the previous issue's design. Layout availability is checked only for designs that pass.

| Masthead field | Behavior |
| --- | --- |
| `title` | Resolved title stored in `publication.title`; also named in each item's "From the editors of ..." source note |
| `motto` | Optional resolved line stored in `publication.motto`; the reader draws it under the title |
| Evidence | The rows read by printed terms join the decision's evidence; article sources stay with their own article |

The resolved values are part of the stored issue, so a later change to a term or design does not rewrite an older masthead. A publication without `motto` renders as before.

### Example: tune the settler story

The stock settler story chooses its tone based on local happiness. The [example overlay](triggers/examples.md#a-city-shrinks-after-sending-settlers) replaces the neutral variant's headline and body while keeping its condition, city link, and the other tones.

## Developments, selection, and continuity

Trigger rules turn facts about cities, players, events, pairs, incidents and the world into developments. A rule must hold for its subject before a template can turn the development into a candidate. The [trigger overview](triggers/overview.md) describes rules and the [examples](triggers/examples.md) show the stock catalogue. [War and peace coverage](triggers/war-and-peace.md) groups likely declaration cascades, distinguishes obligations and city-state involvement, and tracks score progress and settlements.

Importance comes from each trigger's `importance` expression on a scale from 0 to 100. Comparisons can reach before the reporting period, and an unchanged situation produces a new development only when its trigger sets `repeat` to a span and that span has passed. A rule with `chance` drops some passing subjects or groups; the draw is seeded from the check, rule and subject, and its failure records the audit outcome `chance` without writing repeat memory. Repeat memory is saved with publication state. A skipped check advances the reporting boundary, diplomacy observations, rule repeat state, and series memory, then discards that check's candidates.

Each published article records the rule IDs and subject behind it, so later expressions can read them through `printed`. A grouped article is recorded under its group subject, while the global count still includes it. Articles published before this memory are not attributed. See [publication memory](triggers/overview.md#publication-memory) and [chance](triggers/overview.md#chance).

Selection combines importance, decayed series history, novelty, variety, template weight, and feedback. Importance is dated and decays once per elapsed turn. Each series follows one rule and subject. Selection reserves each series for one item per issue. A template that names several triggers takes the highest importance among them, and its tags and series keys are deduplicated. A multi-series item contributes its final importance once to each series.

If selection includes an eligible urgent story, one urgent story leads a breaking front page. A rule decides urgency from incident facts. The built-in At Home page collects domestic stories, Beyond Our Borders collects international stories, and Trade and Livelihood uses economy and trade tags. A section appears only when it meets its configured minimum and includes a story beyond the front page. Page membership refers to canonical items, so a story repeated on the front and economy pages has one vote and one history contribution. Validation checks threat placement, subject variety where available, section minimums, and series uniqueness before publication.

Authored placeholders become structured text and typed links. Prose and presentation use separate seeded random streams; page and layout tuning should not change wording. Decisions retain the seed, configuration identity and snapshot, candidate scores, selected variants and layouts, evidence, feedback, and the trigger audit. The `selectedStyles` map records tags for each displayed article under the same item ID as `selectedVariants`. Reopening an issue reads stored content without running selection again.

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

Preferences store publication frequency in Standard-equivalent turns and whether LLM use is enabled. Built-in defaults are five turns and LLM disabled. Configured defaults override built-ins; saved receiver choices take precedence. Game speed resolves frequency to an integer interval of at least one turn. Changing frequency schedules from the last completed check. Plans [4b](../../../plans/newspaper/implementation/04b-story-mining.md) and [4c](../../../plans/newspaper/implementation/04c-variant-drafting.md) add story types and authored variants. [Plan 7](../../../plans/newspaper/implementation/07-llm-editors.md) makes the LLM preference effective and compares editors.

## Verification and remaining acceptance

Focused tests live under `vox-agents/tests/mock/newspaper/`, mirroring editorial, replay, and renderer ownership. They exercise hidden facts, multi-trigger matching, group bindings, series conflicts and decay, urgent priority, page duplication, deterministic choices, vote replacement, transaction rollback, and resume. Run `npm run test:mock -w vox-agents -- tests/mock/newspaper`, `npm run type-check -w vox-agents`, and `npm run build:newspaper -w vox-agents`; integration uses root build and test commands.

The stock catalogue's mechanics are accepted. Tuning of thresholds, decay, content minimums, and vote strength against recordings is not currently planned.
