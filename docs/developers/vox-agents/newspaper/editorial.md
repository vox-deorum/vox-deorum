# Newspaper editorial decisions

The editor chooses which developments to print, how to tell them, and how to present the issue. It uses authored templates and the receiving player's [visible facts](triggers/facts.md). To add coverage, write a [trigger](triggers/overview.md) and a template that names it, then [compare fresh replays](replay.md#iterate-on-a-rule-or-overlay).

## Catalogue and eligibility

The stock catalogue is in `vox-agents/newspaper/`. To override a rule or story, mirror the relevant files or folders and keep its ID.

| File | Controls |
| --- | --- |
| `defaults.json` | Frequency, selection limits, decay, novelty, variety, stickiness, style repeat factors, and feedback coefficients |
| `constants.json` | Named distances, spans, sizes, type lists and shortcuts, plus printable terms used by prose and mastheads. See [constants and shortcuts](triggers/constants.md). |
| `triggers/*.json` | Trigger rules: subject, `when`, `values`, importance, repeat, grouping and tags. See the [trigger overview](triggers/overview.md). |
| `templates/*.json` | Authored variants, typed links and short pieces, grouped by topic like triggers |
| `styles/` | Style tag IDs, optional writing guidance, and rules that adjust variant weights |
| `pages.json` | Front page, section membership, and section minimums |
| `designs/*.json` | Renderer families, tokens, assets, layouts, eligibility, and fallback titles, mottoes, and section labels |
| `mastheads/*.json` | Titles, mottoes, and section labels selected using the chosen design and visible game facts |

The loader reads grouped files in filename order. Entries and authored variants merge by ID; arrays of values such as tags, conditions, or paragraphs replace the inherited array. Defaults and constants merge as objects. Replay validates the effective catalogue and saves it for resume.

## Authoring choices

Templates, variants, pages, designs, layouts, and masthead rules can use `when` to read the permitted facts. See [expression bindings](triggers/overview.md#expressions-and-authored-choices) for what each can read.

- Without `when`, the choice passes its condition. A false result, error, or [hidden fact](triggers/facts.md#hidden-and-missing-facts) rules it out.
- For choices with a `weight`, start with its `base` and add the amount from each true adjustment. False conditions and unavailable facts contribute nothing. If an adjustment is interrupted or skipped because of the execution budget, the choice is left out.
- A final weight must be positive. Template weight adds to the story's score; variant, design, layout, and masthead weights affect their draws. Pages use their conditions and section minimums.

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

The files under `styles/` show how era, story tags, policy, religion, happiness, and other national facts shape the stock paper. For example, war weariness can raise the weight of conciliatory variants. Use the [writing guide](writing.md) for examples of each dimension.

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

The front page is always eligible. Other sections can have conditions and must meet their minimums, with at least one story that does not appear on the front page. The stock sections collect domestic, international, and economic coverage by topic tag.

Each design needs an unconditional ordinary layout and an unconditional breaking layout with positive constant weights. See [adding a design](designs.md#add-or-change-a-design) for the selection rules and asset setup.

### Masthead rules

The editor picks a visual design, then looks for a title, motto, and section labels that fit the receiver. For example, a Roman paper under Order can call its `abroad` page *International Solidarity*, while a paper using the same design under Freedom can call it *Foreign Correspondence*. The page keeps the same ID and story criteria.

Give each rule under `mastheads/` an `id`, `title`, and `weight`. See `mastheads/ideology.json` for the stock rules. Use `designs` to restrict a rule to specific designs and `when` to check facts such as `self.ideology` or `self.hasPolicy('Five-Year Plan')`. Add a `motto` and a `pageLabels` map keyed by page IDs as needed.

Rule IDs must be unique within each `mastheads/` folder. Local rules override stock rules by ID, and local folder entries apply after any older flat `masthead-rules.json` overlay. Set `when` to the string `"false"` to disable a stock rule.

The title, motto, and labels can use [terms](triggers/constants.md#terms) such as `{{terms.civilization}}` and `{{terms.civilizationAdjective}}`. An unprintable title or authored motto removes the rule from consideration. The weighted choice stays stable for the same campaign, receiver, and design while the eligible rules and weights stay the same. A winning rule without a motto leaves it out. Each displayed page uses the rule's printable label, then its design label, then the page default.

With no winning rule, the design supplies the title and motto. For `civilizationTitles`, the editor tries the exact recorded name, then `"*"`, then `title`, skipping any civilization title with unresolved terms. An overlay can set `civilizationTitles` to `null` to use only the base title. An unresolved placeholder in the final design title or motto makes the design ineligible, and an empty resolved base title uses `defaults.publicationTitle`.

The issue saves the chosen title, motto, and labels. Editor credits use that title, and article bylines stay with their stories. The decision records the winning rule and its evidence. To preview rules, generate an issue in [Recorded replay](replay.md); static Mockups show the design fallbacks.

## Developments, selection, and continuity

The [trigger audit](triggers/overview.md#how-a-check-evaluates-triggers) shows which developments matched. To pick stories, the editor scores candidates by importance, decayed series history, novelty, variety, template weight, and reader feedback. A series follows one rule and subject and can appear in only one item per issue. A story supported by multiple rules contributes once to each of its series. Skips advance the schedule and decay series importance while leaving the reporting window open.

The stock paper needs four distinct stories, allows up to ten, and puts at most five on the front page. A selected urgent story leads a breaking front page. An article appearing on two pages still counts as one item with one vote.

Prose and presentation draws use separate seeded streams. The audit saves the seed, catalogue, scores, chosen designs and layouts, sources, feedback, and trigger results. `selectedVariants` and `selectedStyles` record each displayed article's wording and style choices by item ID. Replay reopens the stored issue without running the editor again.

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

Preferences default to five Standard turns and LLM editing off in `defaults.json`; saved receiver settings take precedence. Frequency changes are scheduled from the last completed check. The editor uses authored stories even when LLM editing is requested and records that fallback in the decision. See [offline evaluation](evaluation.md) for the planned model comparison.

## Ownership and inputs

Under `vox-agents/src/newspaper/editorial/`, `check.ts` takes the permitted facts, infers the diplomacy, evaluates rules, selects stories, and assembles the issue. `config/load.ts` loads and compiles the catalogue. The `selection/` and `presentation/` folders own decisions about stories and appearance. `contracts/publication.ts` defines publication state (schema 6).

[Replay](replay.md#source-storage-and-api) commits issues and skips, including their decisions and audits. A query or validation error leaves the previous checkpoint available for retry. Use the [catalogue verification commands](triggers/overview.md#verify-changes) after changing rules or editorial code.
