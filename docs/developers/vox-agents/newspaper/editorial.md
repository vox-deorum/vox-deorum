# Newspaper editorial decisions

The heuristic editor turns permitted historical evidence into authored issues without an LLM. It saves a skipped check and its audit when too few stories are ready or no design is eligible. The editor keeps series memory, chooses compatible stories, and applies current reader votes to later coverage. [Replay](replay.md) owns offline persistence and the read, vote, continue, and resume workflow. The [renderer](renderer.md) displays the immutable issue and its saved presentation.

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

`check.ts` runs the editor on an evidence window, the built fact model, game speed, publication state, receiver identity, and effective configuration. Its result includes the audit for every enabled rule, even when it skips publication. The caller commits completed results. Configuration and validation errors preserve the original checkpoint for a retry. `config/load.ts` reads catalogue files; the editor itself works on the evidence it receives.

MCP owns evidence schemas and reporting policy. Rules use the projected observations and their original source references. Recorded identity metadata resolves city owners and team IDs; it must not supply hidden measurements or reveal unmet civilizations. A player ID is not assumed to equal its team ID.

`contracts/publication.ts` defines editorial state for series, preferences, published-item evidence, current votes, diplomacy pair history, and rule repeat memory. The replay session scopes it to a campaign, branch, and receiver. State uses schema 6; regenerate runs with older state. This version is separate from IssueDocument schema 2 and the replay database's SQLite `user_version` 5. Replay stores decisions beside checks and immutable issues, including the trigger audit, repeat outcomes, and the evidence behind inferred war and peace incidents.

## Catalogue and eligibility

The built-in catalogue lives under `vox-agents/newspaper/`. Trigger files group rules by topic, such as war, trade, or religion. Templates have their own files and refer to triggers by ID. Each design has its own file. An overlay adds or tunes entries without replacing the stock catalogue.

| File | Controls |
| --- | --- |
| `defaults.json` | Frequency, selection limits, decay, novelty, variety, stickiness, style repeat factors, and feedback coefficients |
| `constants.json` | Named distances, spans, sizes, type lists and shortcuts, plus printable terms used by prose and mastheads. See [constants and shortcuts](triggers/constants.md). |
| `triggers/*.json` | Trigger rules: subject, `when`, `values`, importance, repeat, grouping and tags. See the [trigger overview](triggers/overview.md). |
| `templates/*.json` | Authored variants, typed links and short pieces, grouped by topic like triggers |
| `styles/` | Style tag IDs, optional writing guidance, and rules that adjust variant weights |
| `pages.json` | Front page, section membership, and section minimums |
| `designs/*.json` | Renderer families, tokens, assets, layouts, eligibility, and fallback titles, mottoes, and section labels |
| `masthead-rules.json` | Titles, mottoes, and section labels selected using the chosen design and visible game facts |

An optional configured directory mirrors this structure and can supply only the files being changed. Section files load in filename order. Defaults and constants merge as objects; entries and authored variants merge by ID across files. Arrays without IDs, such as paragraphs, tags and `when` lists, replace the existing arrays. Effective configuration is validated before the run starts and saved for resume.

## Authoring choices

Templates, variants, pages, designs, layouts, and masthead rules can have a JavaScript expression string in `when`. These choices take a `weight`, such as `{"base": 2, "adjustments": [{"when": "turn > 100", "add": 1}]}`. Pages use eligibility and their section minimum instead.

- A missing `when` makes the choice eligible without a condition. A present condition that is false, fails, or reads a [hidden fact](triggers/facts.md#hidden-and-missing-facts) removes that choice.
- Each true adjustment adds its `add` value. A false condition or unavailable fact contributes nothing. A choice whose adjustment could not finish within the execution budget is left out.
- The final weight must be greater than zero. Weight influences design, layout, variant, and masthead selection; template weight joins the candidate score.

All conditions run in the shared QuickJS sandbox with no filesystem, network, clock or random source. A trigger expression reads its subject, earlier values and the check globals. Template and variant conditions read the visible fact namespace for the subject, such as `city.population`, plus the candidate bindings described below. Page, design, layout, and masthead conditions read the visible facts and check globals without candidate bindings. Trigger, template and presentation expressions can also read the publication memory globals `press` and `printed`; see [publication memory](triggers/overview.md#publication-memory).

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

The [news writing rules](writing.md) show how to turn visible game facts into entertaining stories, imagine what the news means to people in the world, and write in the chosen voice, stance, and genre.

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
| Story topics | `story.tags` | A religion story lifts proverb above ledger. |
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
| `{{terms.civilization}}`, `{{terms.civilizationAdjective}}` | The reader's civilization name and its English adjective, such as Rome and Roman |
| `{{terms.<name>}}` | A printable [term](triggers/constants.md#terms) defined by the catalogue, such as the receiver's capital |

Use qualified names such as `{{city.owner.name}}` and `{{subject.id}}` for recorded identities. An unresolved placeholder, empty link label or invalid link destination makes the variant unprintable. The editor evaluates a term once from the check's global facts, so `{{terms.capital}}` means the same thing in every article. Each variant cites the rows behind the terms it prints.

The adjective comes from the recorded English short name. For a modded or localized name outside the built-in list, override the term in your catalogue or offer a variant without it.

For a single group, prose can print `{{key}}` and `{{count}}`. Expressions can read each member, for example `group.matches[0].city.name` and `group.matches[0].values`. If two rules grouped cities by the same religion, they may have counted different cities. Name the rule in the placeholder, such as `{{triggerValues.conversions.count}}`, or read its members with `triggerValues.conversions.matches`. When two ungrouped rules supply the same value name, qualify it the same way. An ambiguous bare placeholder leaves that variant out.

### Pages and designs

The front page is unconditional. Each design needs one unconditional ordinary layout and one unconditional breaking layout, both with a constant positive weight. Other pages can use `when`; designs and extra layouts can also adjust their weights. Section labels must name configured pages, and fonts and ornaments are validated against registered renderer assets, including assets declared by built-in designs.

Designs match the receiver’s era and, where relevant, their recorded civilization name in English.

| Design | Where it appears |
| --- | --- |
| `oral-accounts` | General option in Ancient, Classical and unknown eras |
| `shang` | Strong in Ancient China, with a smaller chance in Classical |
| `egypt` | Egypt and Nubia in Ancient and Classical, with higher weights in Ancient and for Egypt |
| `clay-chronicle` | Babylon and Assyria only: Ancient (80) and Classical (50) |
| `heian` | Japan from Classical through Renaissance, peaking in Medieval; a smaller chance in Korea and China over the same span |
| `folded-chronicle` | The Maya only: Classical (50), Medieval (80) and Renaissance (35) |
| `port-register` | Renaissance: 60 for England, The Netherlands, Portugal and Venice; 12 elsewhere. Industrial: 40 for those four only |
| `victorian` | General option from Medieval through Atomic, peaking in Industrial |
| `town-book` | General Medieval option |
| `printer-dispatch` | General Renaissance option |
| `secession-review` | Industrial and Modern: 44 for Austria, 16 elsewhere |
| `national-review` | General option in Modern and Atomic |
| `teletext-bulletin` | General option in Atomic and Information (60) |
| `wire` | General option from Modern onward, gaining weight as the game advances; the sole stock design in Future |

When adding a design, start around 50 to 100 for a strong fit, 10 to 25 for a general fallback, and 4 to 8 for an occasional alternative. Compare the combined weights in each overlapping era and keep a general option available for civilizations without a match.

On a fresh draw, each eligible design’s chance is its weight divided by the total. By default, the current design stays if it is eligible and has at least 60% of the strongest eligible weight. A low weight gives a design a chance on a fresh draw without displacing an established design. Published issues keep their chosen presentation and bundled artwork IDs.

### Design assets

A built-in design declares the images and ornaments it ships in `assetDefinitions`. Each entry has a local `id`, `kind` (`image` or `ornament`), `path`, `mediaType`, `width`, `height`, `license`, and `attribution`. The renderer registers the derived ID `<design id>.<local id>`, so the Victorian `harbour` becomes `victorian.harbour`. Presentation values refer to that ID, such as `assets.ornamentAssetId: "victorian.scrollwork"`.

Define assets in built-in `newspaper/designs/*.json` files. Replay overlays can reference their bundled IDs. Asset declarations stay out of the saved catalogue.

To add a local asset:

1. Put the file under `vox-agents/newspaper/public/assets/designs/<design id>/` and keep its path relative, such as `assets/designs/victorian/new-illustration.png`.
2. Add its `assetDefinitions` entry to the matching built-in design file. Derived IDs must be unique, paths must stay under `assets/` without dot segments or URL syntax, and the metadata must be complete.
3. Reference the derived ID in `presentation.assets.ornamentAssetId` for ornaments or `image.assetId` on an illustrated article. An article image needs `altText` and can also carry a printed `caption`.
4. Rebuild the reader with `npm run build:newspaper -w vox-agents` so the browser bundles the design JSON and copies the asset.

### Masthead rules

The editor picks a visual design, then looks for a title, motto, and section labels that fit the receiver. For example, a Roman paper under Order can call its `abroad` page *International Solidarity*, while a paper using the same design under Freedom can call it *Foreign Correspondence*. The page keeps the same ID and story criteria.

In `masthead-rules.json`, give each rule an `id`, `title`, and `weight`. Use `designs` to restrict a rule to specific design IDs and `when` to check facts such as `self.ideology` or `self.hasPolicy('Five-Year Plan')`. Add a `motto` and a `pageLabels` map keyed by page IDs as needed. Local catalogues merge rules by ID. Set `when` to the string `"false"` to disable a stock rule.

The title, motto, and labels can use [terms](triggers/constants.md#terms) such as `{{terms.civilization}}` and `{{terms.civilizationAdjective}}`. An unprintable title or authored motto removes the rule from consideration. The weighted choice stays stable for the same campaign, receiver, and design while the eligible rules and weights stay the same. A winning rule without a motto leaves it out. Each displayed page uses the rule's printable label, then its design label, then the page default.

With no winning rule, the design supplies the title and motto. For `civilizationTitles`, the editor tries the exact recorded name, then `"*"`, then `title`, skipping any civilization title with unresolved terms. An overlay can set `civilizationTitles` to `null` to use only the base title. An unresolved placeholder in the final design title or motto makes the design ineligible, and an empty resolved base title uses `defaults.publicationTitle`.

The issue saves the chosen title, motto, and labels. Editor credits use that title, and article bylines stay with their stories. The decision records the winning rule and its evidence. To preview rules, generate an issue in [Recorded replay](replay.md); static Mockups show the design fallbacks.

### Example: tune the settler story

The stock settler story chooses its tone based on local happiness. The [example overlay](triggers/examples.md#a-city-shrinks-after-sending-settlers) replaces the neutral variant's headline and body while keeping its condition, city link, and the other tones.

## Developments, selection, and continuity

Trigger rules turn facts about cities, players, events, pairs, incidents and the world into developments. A rule must hold for its subject before a template can turn the development into a candidate. The [trigger overview](triggers/overview.md) describes rules and the [examples](triggers/examples.md) show the stock catalogue. [War and peace coverage](triggers/war-and-peace.md) groups likely declaration cascades, distinguishes obligations and city-state involvement, and tracks score progress and settlements.

Importance comes from each trigger's `importance` expression on a scale from 0 to 100. Comparisons can reach before the reporting period, and an unchanged situation produces a new development only when its trigger sets `repeat` to a span and that span has passed. A rule with `chance` drops some passing subjects or groups; the draw is seeded from the check, rule and subject, and a failed draw leaves repeat memory untouched. A skipped check advances the schedule and decays series importance. It records when rules become eligible to fire again, but leaves new matches and diplomacy evidence available for the next check.

Each published article records the rule IDs and subject behind it, so later expressions can read them through `printed`. A grouped article is recorded under its group subject, while the global count still includes it. Articles published before this memory are not attributed. See [publication memory](triggers/overview.md#publication-memory) and [chance](triggers/overview.md#chance).

Selection combines importance, decayed series history, novelty, variety, template weight, and feedback. Importance is dated and decays once per elapsed turn. Each series follows one rule and subject. Selection reserves each series for one item per issue. A template that names several triggers takes the highest importance among them, and its tags and series keys are deduplicated. A multi-series item contributes its final importance once to each series.

By default, an edition requires at least four distinct displayed stories, can contain up to ten, and puts at most five on the front page. These limits come from `defaults.json`. An eligible urgent story leads a breaking front page when selected. At Home collects domestic stories, Beyond Our Borders collects international stories, and Trade and Livelihood collects economy and trade stories. A section appears only when it meets its own minimum and includes a story beyond the front page. A story displayed on two pages counts once toward the edition minimum, with one vote and one history contribution.

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
