# Newspaper editorial decisions

The editor chooses which developments to print, how to tell them, and how to present the issue. It uses authored templates and the receiving player's [visible facts](triggers/facts.md). To add coverage, write a [trigger](triggers/overview.md) and a template that names it, then [compare fresh replays](replay.md#iterate-on-a-rule-or-overlay).

## Catalogue and eligibility

The stock catalogue is in `vox-agents/newspaper/`. To override a rule or story, mirror the relevant files or folders and keep its ID.

| File | Controls |
| --- | --- |
| `defaults.json` | Frequency, story limits and scoring, design selection, style repetition, and feedback coefficients |
| `constants.json` | Named distances, spans, sizes, type lists and shortcuts, plus printable terms used by prose and mastheads. See [constants and shortcuts](triggers/constants.md). |
| `triggers/*.json` | Trigger rules: subject, `when`, `values`, importance, repeat, grouping and tags. See the [trigger overview](triggers/overview.md). |
| `templates/*.json` | Authored variants, typed links and short pieces, grouped by topic like triggers |
| `civic-terms.json` | Government, people, and leader terms by policy and civilization |
| `styles/` | Style tag IDs, optional writing guidance, and rules that adjust variant weights |
| `pages.json` | Front page, section order, topic tags, and eligibility |
| `designs/*.json` | Browser labels, renderer families, tokens, assets, layouts and article counts, eligibility, and fallback mastheads |
| `mastheads/*.json` | Titles, mottoes, and section labels selected using the chosen design and visible game facts |

The loader reads grouped files in filename order. Entries and authored variants merge by ID; arrays of values such as tags, conditions, or paragraphs replace the inherited array. Defaults and constants merge as objects. [Style rules](#variant-styles) have their own merge behavior. Replay validates the effective catalogue and saves it for resume.

## Authoring choices

Templates, variants, pages, designs, layouts, and masthead rules can use `when` to read the permitted facts. See [expression bindings](triggers/overview.md#expressions-and-authored-choices) for what each can read.

- Without `when`, the choice passes its condition. A false result, error, or [hidden fact](triggers/facts.md#hidden-and-missing-facts) rules it out.
- For choices with a `weight`, start with its `base` and add the amount from each true adjustment. False conditions and unavailable facts contribute nothing. If an adjustment is interrupted or skipped because of the execution budget, the choice is left out.
- A final weight must be positive. Template weight adds to the story's score; variant, design, layout, and masthead weights affect their draws. Sections use their conditions and topic tags.

A template names one or more rules in `triggers`. They must all fire for the same subject with overlapping evidence periods. For example, two city rules must match the same city. Grouped rules can combine with other grouped rules of the same subject kind and key. The editor uses the overlapping period, the highest importance and the combined tags.

| Template field | Meaning |
| --- | --- |
| `id` | Stable identity used by overlays and decisions |
| `triggers` | Trigger IDs that must all match the same subject |
| `tags` | Topic and scope labels for pages, variety and feedback |
| `mode` | `authored` (default) or `llmOnly`; the heuristic editor skips `llmOnly` templates |
| `short` | Lets the editor reserve the last slot for a brief |
| `weight` | Base weight and conditional adjustments |
| `variants` | Authored prose choices with an ID, text, links, eligibility, weight, and style tags |
| `names` | Optional list of placeholders that display names, such as `["cityName", "player.leader"]` |
| `merge` | Optional rules and prose for combining selected stories |

`id`, `triggers`, `tags`, `weight` and `variants` are required. Each variant requires `id`, `headline`, `body` and `weight`; `subheadline`, `byline`, `when` and `links` are optional. The reader draws the subheadline under the headline and the byline below it, so an opinion piece or a signed report can carry both.

The [news writing rules](writing.md) show how to turn visible game facts into entertaining stories, imagine what the news means to people in the world, and write in the chosen voice, stance, and genre.

### Combining stories

A template with `merge` can use its trigger match to combine stories already chosen for the issue, even when its own article was not selected. `merge.match` reads the combining template's facts as `lead` and tests each other selected story as `member`. Match the exact subjects or template IDs you intend to cover. Set `merge.min` to the number of other stories required. When merges compete for a story, the higher `merge.priority` goes first.

Merged prose uses `merge.variants`. Its conditions and `merge.values` expressions can read `merge.members` and `merge.count`. A scalar value named `attackers` can be printed as `{{merge.values.attackers}}`. Keep ordinary `variants` for a story that can also stand alone, or use an empty list for a template that only combines stories. An overlay can set `merge` to `null` to keep the ordinary choices only.

A merge replaces its matching stories when the combined copy is eligible and enough articles remain to fill a front page. It keeps the evidence and urgency of the reports and replaces the combining template's standalone story if selected. See [war coverage](triggers/war-and-peace.md#combining-declaration-reports) for the stock example.

### Variant styles

Each variant can carry one style tag of each kind: voice, stance and genre. Set all three together and register each ID in `voice.json`, `stance.json` or `genre.json` under `styles/`. An untagged variant uses `general`, `neutral` and `report`. Style tags describe the prose and do not change the template's topic tags, page placement or layout.

Voice sets how the piece sounds, stance sets the position it takes, and genre sets its form. A peace treaty can be covered in a report or a letter. A neutral account explains the terms; a pro-government account makes the case for signing. See `styles/genre.json` and `styles/stance.json` for drafting guidance.

Put a rule that matches only one kind of style tag in `voice-rules.json`, `stance-rules.json` or `genre-rules.json` under `styles/`. Put a rule that matches two or more kinds in `mixed-rules.json`. The loader reads the four files in that order, with overlay rules after stock rules. Give every added rule a new ID. Reusing a stock rule ID is a validation error.

Every style rule has an `id`, a `match`, a `when` expression, and a positive `multiplier`. A variant must match an allowed style tag for every kind named in `match`. For example, a mixed rule can double the weight of letters with a `pro-government` or `government-critical` stance when `self.happinessPercentage > 50`. Use the variant's own `when` for evidence required by its wording.

A style rule's `when` can also read facts about the selected story:

| Story fact | Meaning |
| --- | --- |
| `story.importance` | The candidate's importance on the same scale as trigger importance |
| `story.urgent` | Whether the candidate is marked urgent |
| `story.short` | Whether the candidate is a short filler story |
| `story.tags` | The candidate's topic and scope tags |

For example, `story.tags.includes('military')` applies a preference only to stories tagged military. Guard subject-specific facts in shared rules. For example, check `subject.kind === 'city'` before reading `city.happinessDelta`. The editor applies rules after choosing stories. A false condition, an error, or unavailable evidence leaves the weight unchanged. For displayed stories, facts read by applied preferences join the decision audit without becoming evidence for the article's claims.

The editor draws a variant for each placed article in ranked order. Each earlier choice with the same style tag multiplies the weight by that kind's factor in `defaults.styleRepeat`. The stock factors are voice 1.25, stance 1 and genre 0.8. This favors a repeated voice, leaves stance unchanged, and slightly discourages a repeated genre.

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
| `{{player.leader}}`, `{{city.owner.leader}}` | The visible leader of a player subject or a referenced player |
| `{{lost}}` | A scalar rule value from the ungrouped development |
| `{{key}}`, `{{count}}` | A grouped development's non-null scalar key and member count |
| `{{terms.civilization}}`, `{{terms.civilizationAdjective}}` | The reader's civilization name and its English adjective, such as Rome and Roman |
| `{{terms.leader}}` | The reader's leader name |
| `{{terms.<name>}}` | A printable [term](triggers/constants.md#terms) defined by the catalogue, such as the receiver's capital |

Use qualified names such as `{{city.owner.name}}` and `{{subject.id}}` for recorded identities. Require facts essential to the story in the trigger. Missing optional facts, such as a leader's name in a supporting detail, leave their placeholders unresolved; another variant can print without them. An empty link label or invalid link destination also makes a variant unprintable. The editor evaluates terms once per check and each variant cites the rows behind the terms it prints.

List name placeholders in the template's `names` array without braces. For example, add `terms.leader` to the array when the body uses `{{terms.leader}}`. The reader underlines the resolved name with the `vd-name` CSS class, and any declared link stays clickable.

The adjective comes from the recorded English short name. For a modded or localized name outside the built-in list, override the term in your catalogue or offer a variant without it.

For a single group, prose can print `{{key}}` and `{{count}}`. Expressions can read each member, for example `group.matches[0].city.name` and `group.matches[0].values`. If two rules grouped cities by the same religion, they may have counted different cities. Name the rule in the placeholder, such as `{{triggerValues.conversions.count}}`, or read its members with `triggerValues.conversions.matches`. When two ungrouped rules supply the same value name, qualify it the same way. An ambiguous bare placeholder leaves that variant out.

### Civic vocabulary

Print `{{terms.civic.government}}`, `{{terms.civic.people}}`, `{{terms.civic.leaderTitle}}`, or `{{terms.civic.leaderAddress}}` for the reader's civilization. Qualify the term to write about a visible player or direct reference, such as `{{player.civic.leaderTitle}}`, `{{city.owner.civic.people}}`, or `{{event.player.civic.government}}`. Ordinary references use the reporting cutoff; explicitly dated references use their own date. A visible civilization without policy data can use defaults. An unresolved foreign reference stays unavailable.

The active ideology takes precedence. Otherwise the highest branch tier wins: tier 3 (Industry, Imperialism, Rationalism), tier 2 (Fealty, Statecraft, Artistry), then tier 1 (Tradition, Progress, Authority). Within the winning tier, the most recorded policies win. Break ties alphabetically; if any count is missing in that tier, use alphabetical order alone. The stock branches can outlast their starting eras.

An overlay's `civic-terms.json` can change one word without copying any prose:

| Field | What to change |
| --- | --- |
| `defaults` | Neutral terms. Add a new slot here before overriding it in a profile. |
| `branches`, `ideologies` | Profiles keyed by recorded name, each with a `terms` map. Branches need a positive integer `tier`. An optional `eras` list restricts a profile to those recorded era names. |
| `civilizations` | Key by exact recorded civilization name. Its `terms` apply generally, and its `branches` and `ideologies` maps can refine individual winning profiles. For example, set `civilizations.Rome.branches.Progress.government` to “senate.” |

Terms layer from defaults to the winning profile, then to civilization terms and finally the civilization's overrides for the winner. Use `null` to disable an inherited branch, ideology, or civilization entry. These words describe how the paper speaks; they do not establish that the civilization has a particular office or constitution. See the [writing guide](writing.md#use-concrete-names-when-available) for articles, plural wording, and forms of address.

### Pages and designs

The editor picks a [design and front layout](designs.md#which-design-runs) it can fill, then places exactly the number of articles specified by the layout. An urgent article leads a breaking front. If no eligible front can be filled, the editor skips the issue and keeps the reporting window open.

Sections try to fill in the order set by `pages.json`, using only unplaced articles that match their topic tags. A section that cannot fill an eligible layout is omitted and leaves its articles available to later sections. For example, a five-article front can leave three articles for the international tab, but the tab opens only if all three match and an eligible layout takes three. Every published article appears on one tab.

### Masthead rules

The editor picks a visual design, then looks for a title, motto, and section labels that fit the receiver. For example, Rome's *Workers' Herald* under Order can call its `abroad` page *Solidarity Abroad*, while its *Free Press* under Freedom can call the same page *The World at Large*. The page keeps the same ID and story criteria.

The stock rules in `mastheads/` are grouped by civilization, era, policy, ideology, and combinations of these facts. Civilization titles draw on local records and publications. *The Khipu of Tawantinsuyu* pairs the Inca masthead with the cord register design, while *Correio Braziliense* takes its name from an early Brazilian paper. Stock rules without an ideology theme are eligible only when the record shows no ideology. Era rules apply to selected designs so other formats can keep their own titles.

Give each rule an `id`, `title`, and `weight`. Use `when` to check visible facts such as `self.name`, `self.era`, or `self.hasPolicy('Five-Year Plan')`. Limit a title to the design it suits with `designs` so rotation can bring a different masthead. For example, Order can use *The Workers' Herald* on a broadsheet and *The Workers' Wire* on the feed. Omit `designs` if a custom rule should apply everywhere, or supply a new list to replace a stock rule's scope. Add a `motto` and a `pageLabels` map keyed by page IDs as needed.

Rule IDs must be unique within each `mastheads/` folder. Local rules override stock rules by ID, and local folder entries apply after any older flat `masthead-rules.json` overlay. Set `when` to the string `"false"` to disable a stock rule.

The title, motto, and labels can use [terms](triggers/constants.md#terms) such as `{{terms.civilization}}` and `{{terms.civilizationAdjective}}`. An unprintable title or authored motto removes the rule from consideration. The weighted choice stays stable for the same campaign, receiver, and design while the eligible rules and weights stay the same. A winning rule without a motto leaves it out. Each displayed page uses the rule's printable label, then its design label, then the page default.

With no winning rule, the design supplies the title and motto. For `civilizationTitles`, the editor tries the exact recorded name, then `"*"`, then `title`, skipping any civilization title with unresolved terms. An overlay can set `civilizationTitles` to `null` to use only the base title. An unresolved placeholder in the final design title or motto makes the design ineligible, and an empty resolved base title uses `defaults.publicationTitle`.

The issue saves the chosen title, motto, and labels. Editor credits use that title, and article bylines stay with their stories. The decision records the winning rule and its evidence. To preview rules, generate an issue in [Recorded replay](replay.md); static Mockups show the design fallbacks.

## Developments, selection, and continuity

The [trigger audit](triggers/overview.md#how-a-check-evaluates-triggers) shows which developments matched. To pick stories, the editor scores candidates by importance, decayed series history, novelty, variety, template weight, and reader feedback. A series follows one rule and subject and can appear in only one item per issue. A story supported by multiple rules contributes once to each of its series. Skips advance the schedule and decay series importance while leaving the reporting window open.

The stock editor ranks up to ten stories. A combined article takes one slot, so five declarations can run as one headline when enough other articles remain to fill the front. Stories that find no place are left out of the issue and its history. Publishing still advances the reporting window and records fired trigger repeats, even for those stories.

The audit saves the seed, catalogue, scores, presentation, sources, feedback, and trigger results. Stock design and layout draws are independent of each other and of prose. `designSelection` explains the prior design, how many issues it ran (up to six), and the candidate weights used for the draw. `selectedVariants` and `selectedStyles` record each displayed article's wording and style by item ID. Replay reopens the stored issue without running the editor again.

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

Under `vox-agents/src/newspaper/editorial/`, `check.ts` takes the permitted facts, infers the diplomacy, evaluates rules, selects stories, and assembles the issue. `config/load.ts` loads and compiles the catalogue. The `selection/` and `presentation/` folders own decisions about stories and appearance. `vox-agents/src/newspaper/contracts/publication.ts` defines publication state (schema 6).

[Replay](replay.md#source-storage-and-api) commits issues and skips, including their decisions and audits. A query or validation error leaves the previous checkpoint available for retry. Use the [catalogue verification commands](triggers/overview.md#verify-changes) after changing rules or editorial code.
