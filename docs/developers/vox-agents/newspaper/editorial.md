# Newspaper editorial decisions

The editor chooses which developments to print, how to tell them, and how to present the issue. It uses authored templates and the receiving player's [visible facts](triggers/facts.md). To add coverage, write a [trigger](triggers/overview.md) and a template that names it, then [compare fresh replays](replay.md#iterate-on-a-rule-or-overlay).

## Catalogue and eligibility

The stock catalogue is in `vox-agents/newspaper/`. To override a rule or story, mirror the relevant files or folders and keep its ID.

| File | Controls |
| --- | --- |
| `defaults.json` | Frequency, story limits and scoring, design selection, style repetition, and feedback coefficients |
| `constants.json` | Shared thresholds, lists, tiers, stakes, shortcuts, and printable terms. See the [constants reference](triggers/constants.md). |
| `triggers/*.json` | Rules for what qualifies as news and how it scores. See [trigger entries](triggers/overview.md#trigger-entries). |
| `templates/*.json` | Authored variants, typed links and short pieces, grouped by topic like triggers |
| `root-templates.json` | Named link lists shared by story templates |
| `civic-terms.json` | Government, people, and leader terms by policy and civilization |
| `styles/` | Style tag IDs, optional writing guidance, and rules that adjust variant weights |
| `pages.json` | Front page, section order, topic tags, and eligibility |
| `designs/*.json` | Browser labels, renderer families, tokens, assets, layouts and article counts, eligibility, and fallback mastheads |
| `mastheads/*.json` | Titles, mottoes, and section labels selected using the chosen design and visible game facts |

The loader reads grouped files in filename order. A stock template file can have a companion such as `war-variants.json` for extra variants of templates in `war.json`. Each companion entry names the template by `id` and lists its additional `variants`. Its variant IDs must differ from all regular and merge IDs in that template. To favor regional wording, tune the extra variants' `when` and `weight` in that file or override just those variants in your local `templates/war-variants.json`.

When applying an override, entries and authored variants merge by ID; arrays of values such as tags, conditions, or paragraphs replace the inherited array. Defaults and constants merge as objects. [Style rules](#variant-styles) have their own merge behavior. Replay validates the effective catalogue and saves it for resume.

## Authoring choices

Templates, variants, pages, designs, layouts, and masthead rules can use `when` to read the permitted facts. See [expression bindings](triggers/overview.md#expressions-and-authored-choices) for what each can read.

- Without `when`, the choice passes its condition. A false result, error, or [hidden fact](triggers/facts.md#hidden-and-missing-facts) rules it out.
- For choices with a `weight`, start with its `base` and add the amount from each true adjustment. False conditions and unavailable facts contribute nothing. If an adjustment is interrupted or skipped because of the execution budget, the choice is left out.
- A final weight must be positive. Template weight adds to the story's score; variant, design, layout, and masthead weights affect their draws. Sections use their conditions and topic tags.

A template names one or more rules in `triggers`. All must fire for the same subject with overlapping evidence periods. For grouped rules, the subject kind and group key must match. The candidate uses the overlapping period, combined tags, and the score and tier of the highest scoring development. It's urgent if any development is urgent.

| Template field | Meaning |
| --- | --- |
| `id` | Stable identity used by overlays and decisions |
| `triggers` | Trigger IDs that must all match the same subject |
| `triggerSummary` | Optional plain-language eligibility summary for the Writing Desk tooltip and the writer's brief. By default, both use the named triggers' summaries. |
| `tags` | Topic and scope labels for pages, variety and feedback |
| `mode` | `authored` (default) or `llmOnly`; the heuristic editor skips `llmOnly` templates |
| `short` | Lets the editor reserve the last slot for a brief |
| `weight` | Base weight and conditional adjustments |
| `variants` | Authored prose choices with an ID, text, links, eligibility, weight, and style tags |
| `names` | Optional list of placeholders that display names, such as `["city", "player.leader"]` |
| `extends`, `links` | Optional root template ID and link list to share with variants |
| `merge` | Optional rules and prose for combining selected stories |

`id`, `triggers`, `tags`, `weight` and `variants` are required. Each variant requires `id`, `headline`, `body` and `weight`; `subheadline`, `byline`, `when` and `links` are optional. The subheadline and byline appear before the article body. The optional `settled` mark records review in the Writing Desk and has no effect on story selection.

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
| `story.tier` | The tier name from the highest scoring contribution to the story |
| `story.importance` | The candidate's [tier score after adjustments](triggers/overview.md#tiers-adjustments-and-stakes), before selection bonuses. Use this when the score matters more to the style than the tier name. |
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
| `{{city}}`, `{{cityId}}`, `{{owner}}` | The city name and ID for a city subject or an event's city, and the owner name for a city subject |
| `{{subject.name}}`, `{{subject.id}}` | The visible subject's name and ID |
| `{{period.from}}`, `{{period.to}}` | The matched rules' shared window: exclusive lower bound and inclusive cutoff, each printed as `Turn X` |
| `{{city.owner.name}}` | A namespaced reference, here the owner of a city subject |
| `{{player.leader}}`, `{{city.owner.leader}}` | The visible leader of a player subject or a referenced player |
| `{{lost}}` | A scalar rule value from the ungrouped development |
| `{{originCity}}`, `{{originCiv}}`, `{{destinationCity}}`, `{{destinationCiv}}` | The departure and arrival cities and their owners in trade route completion and plunder stories. The order follows the route, regardless of who reads the issue. |
| `{{key}}`, `{{count}}` | A grouped development's non-null scalar key and member count |
| `{{terms.civilization}}`, `{{terms.civilizationAdjective}}` | The reader's civilization name and its English adjective, such as Rome and Roman |
| `{{terms.leader}}` | The reader's leader name |
| `{{terms.<name>}}` | A printable [term](triggers/constants.md#terms) defined by the catalogue, such as the receiver's capital |

Use qualified names such as `{{city.owner.name}}` and `{{subject.id}}` for recorded identities. Require the facts that define the story in the trigger's `when`, and skip the story when any of them is unknown. For example, a Congress motion or vote result requires a named proposer. Apply the same filter before choosing or counting items in a roundup. Don't write a fallback variant for the missing fact or repeat its presence check in each variant.

Variants can differ in supporting details. If an optional detail is missing, its placeholder remains unresolved and that variant cannot print. The editor evaluates terms once per check and each variant cites the rows behind the terms it prints.

List name placeholders in the template's `names` array without braces. For example, add `terms.leader` to the array when the body uses `{{terms.leader}}`. The reader underlines the resolved name with the `vd-name` CSS class, and any declared link stays clickable.

The adjective comes from the recorded English short name. For modded or localized names outside the built-in list, use the civilization name or supply the adjective in your catalogue.

For a single group, prose can print `{{key}}` and `{{count}}`. Expressions can read each member, for example `group.matches[0].city.name` and `group.matches[0].values`. If two rules grouped cities by the same religion, they may have counted different cities. Name the rule in the placeholder, such as `{{triggerValues.conversions.count}}`, or read its members with `triggerValues.conversions.matches`. When two ungrouped rules supply the same value name, qualify it the same way. An ambiguous bare placeholder leaves that variant out.

### Sharing links

Give a story template `"extends": "city"` to use the stock city link. It links `{{city}}` to the city identified by `{{cityId}}`. Ordinarily, leave `links` off variants so they inherit the template's list. This also works for merge variants and variants in a companion file.

Add a `links` list to a story template to set its own default, or to a variant to replace that default for one piece of copy. Each list replaces the whole parent list. Use `[]` to disable links at that level. In an overlay, omitting a field keeps its stock setting; set `links` to `null` to drop a stock list and inherit again, or set `extends` to `null` to clear the stock root reference.

Define shared roots in `root-templates.json` as entries with an `id` and a `links` list. Give each root a unique ID within the file. A local root with the same ID as a stock root replaces it. Roots only supply links; they do not publish stories or extend other roots.

Each link names a prose placeholder, display label, and typed destination. Every effective link must have a printable label and a valid destination for its variant to print. The Writing Desk uses the same lists to check copy, and saved replays include the resolved lists.

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

Every front page needs four briefs. A lead adds a fifth story. Urgent news always leads a breaking front. Otherwise, the editor gives the lead to a story whose importance is at least 15 points above the runner-up, before ranking bonuses or votes. The editor checks the story count after combining related reports and keeps the reporting window open if it cannot fill the front. The [visual design](designs.md#which-design-runs) determines how the chosen stories look.

Inside tabs use the same importance rule with two briefs and an optional third story as the lead. The editor tries tabs in the order set by `pages.json`, using unplaced stories that match their topic tags. If a tab cannot fill its pair of briefs, it leaves its stories available to later tabs. Every published article appears on one tab.

### Masthead rules

The editor picks a visual design, then looks for a title, motto, and section labels that fit the receiver. For example, Rome's *Workers' Herald* under Order can call its `abroad` page *Solidarity Abroad*, while its *Free Press* under Freedom can call the same page *The World at Large*. The page keeps the same ID and story criteria.

The stock rules in `mastheads/` are grouped by civilization, era, policy, ideology, and combinations of these facts. Civilization titles draw on local records and publications. *The Khipu of Tawantinsuyu* pairs the Inca masthead with the cord register design, while *Correio Braziliense* takes its name from an early Brazilian paper. Stock rules without an ideology theme are eligible only when the record shows no ideology. Era rules apply to selected designs so other formats can keep their own titles.

Give each rule an `id`, `title`, and `weight`. Use `when` to check visible facts such as `self.name`, `self.era`, or `self.hasPolicy('Five-Year Plan')`. Limit a title to the design it suits with `designs` so rotation can bring a different masthead. For example, Order can use *The Workers' Herald* on a broadsheet and *The Workers' Wire* on the feed. Omit `designs` if a custom rule should apply everywhere, or supply a new list to replace a stock rule's scope. Add a `motto` and a `pageLabels` map keyed by page IDs as needed.

Rule IDs must be unique within each `mastheads/` folder. Local rules override stock rules by ID, and local folder entries apply after any older flat `masthead-rules.json` overlay. Set `when` to the string `"false"` to disable a stock rule.

The title, motto, and labels can use [terms](triggers/constants.md#terms) such as `{{terms.civilization}}` and `{{terms.civilizationAdjective}}`. An unprintable title or authored motto removes the rule from consideration. The weighted choice stays stable for the same campaign, receiver, and design while the eligible rules and weights stay the same. A winning rule without a motto leaves it out. Each displayed page uses the rule's printable label, then its design label, then the page default.

With no winning rule, the design supplies the title and motto. For `civilizationTitles`, the editor tries the exact recorded name, then `"*"`, then `title`, skipping any civilization title with unresolved terms. An overlay can set `civilizationTitles` to `null` to use only the base title. An unresolved placeholder in the final design title or motto makes the design ineligible, and an empty resolved base title uses `defaults.publicationTitle`.

The issue saves the chosen title, motto, and labels. The motto appears below the stories on each section page. The CLI audit records the winning rule and its evidence. To preview rules, generate an issue in [Recorded replay](replay.md); static Mockups show the design fallbacks.

## Developments, selection, and continuity

The [trigger audit](triggers/overview.md#how-a-check-evaluates-triggers) shows which developments matched and how they scored. To rank candidates, the editor adds these amounts:

| Part | Stock calculation |
| --- | --- |
| Importance and template weight | The adjusted tier score plus the template's resolved weight |
| Series history | 15% of the strongest series score. Scores accumulate printed importance and decay by a factor of 0.94 per recorded turn. |
| Novelty | +6 when none of the story's series has printed |
| Variety | +8 when the story adds a tag the editor has yet to select for this issue |
| Votes | The [feedback adjustment](#votes-and-preferences), capped at ±25 |

Urgent stories rank first. Within the same urgency, the last slot favors an eligible brief if none has been picked. Stories without urgency need a positive score. Each development, series (rule and subject), and applicable war or peace incident can support only one ranked story per issue.

The stock editor ranks up to ten stories. A combined article takes one slot. Publication closes the reporting window and spends [repeat memory](triggers/overview.md#repeats) for the series carried by printed articles, including those combined into one. A skip advances the schedule and keeps the reporting window open. Series scores decay on both outcomes.

The full check audit includes the seed, catalogue, scores, presentation, sources, feedback, and trigger results. Replay keeps the catalogue and latest checkpoint for resume, and editions keep their article evidence so they can reopen without running the editor. Use the [CLI audit](replay.md#generate-examples-from-the-command-line) for the full editorial decision and trigger trace. Stock design and layout draws are independent of each other and of prose. `selectedVariants` and `selectedStyles` identify each displayed article's wording and style.

## Votes and preferences

Each unique item has one current vote: -1, 0, or +1. Assigning the same vote again has no additional effect. Replacing or clearing it removes its previous contribution at the next check. Votes do not change past issues, and article importance does not multiply votes.

| Adjustment | Computation |
| --- | --- |
| Series | Sum current votes on all unique items carrying the key, then multiply by the series coefficient. These votes do not expire. |
| Tag window | Most recent configured number of unique published items, including unrated items; built-in size is 50. |
| Distinctiveness | For N window items and df items carrying a tag: `1 + ln((N + 1) / (df + 1))`. |
| Tag bonus | Sum each carrying item's vote divided by its number of distinct tags, then multiply by distinctiveness and the tag coefficient. |
| Candidate adjustment | Add its series adjustments to the mean bonus for its distinct tags, then apply the configured bound. |

The check's decision record includes the corpus, votes, tag counts, coefficients, and resolved adjustments used for that check. This preserves an explanation even after votes change.

Preferences default to five Standard turns and LLM editing off in `defaults.json`; saved receiver settings take precedence. Frequency changes are scheduled from the last completed check. The editor uses authored stories even when LLM editing is requested and records that fallback in the check's decision record. See [offline evaluation](evaluation.md) for the planned model comparison.

## Ownership and inputs

Under `vox-agents/src/newspaper/editorial/`, `check.ts` runs a check from visible facts to a printed issue or skip. `config/load.ts` loads the catalogue, and `selection/` and `presentation/` handle stories and layout. Publication state is defined in `vox-agents/src/newspaper/contracts/publication.ts`.

[Replay](replay.md#source-storage-and-api) saves published editions with their article evidence and the latest checkpoint. A query or validation error leaves the previous checkpoint available for retry. Use the [catalogue verification commands](triggers/overview.md#verify-changes) after changing rules or editorial code.
