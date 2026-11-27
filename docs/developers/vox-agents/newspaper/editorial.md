# Newspaper editorial decisions

The editor turns [trigger matches](triggers/overview.md) into stories for one player. A **development** is a matched rule and subject. A **candidate** is a template's proposed story based on one or more developments. The editor ranks candidates with printable prose, combines related reports, and places the winners on pages.

Start in `vox-agents/newspaper/` to author coverage or `vox-agents/src/newspaper/editorial/check.ts` to trace a check. After adding a trigger and template, [compare fresh replays](replay.md#iterate-on-a-rule-or-overlay).

## Catalogue and eligibility

| Catalogue file | Controls |
| --- | --- |
| `defaults.json` | Frequency, story limits and scoring, style repetition, and feedback |
| `constants.json` | [Shared thresholds, lists, tiers, stakes, shortcuts, and terms](triggers/constants.md) |
| `triggers/*.json` | [Which developments qualify and how they score](triggers/overview.md#trigger-entries) |
| `templates/*.json`, `root-templates.json` | Story variants and shared link lists |
| `civic-terms.json` | Government, people, and leader terms by policy and civilization |
| `styles/` | Style tags, writing guidance, and rules that adjust variant weights |
| `pages.json` | Front page, section order, topic tags, and eligibility |
| `designs/*.json`, `mastheads/*.json` | Visual designs, layouts, titles, mottoes, and section labels |

The loader reads stock groups in filename order. A companion such as `war-variants.json` adds ordinary variants to templates in `war.json`. Name the template by `id` and give each added variant an ID distinct from its regular and merge variants.

To override stock entries, mirror the catalogue structure in an overlay and keep their IDs. Lists of entries with IDs, including variants, merge by ID. Lists such as tags, conditions, and paragraphs replace the inherited list. Defaults and constants merge by field. Grouped overlays take precedence over corresponding flat files. [Style rules](#variant-styles) add new IDs instead. Replay validates and saves the effective catalogue for resume.

## Authoring choices

An optional `when` tests [permitted facts](triggers/overview.md#expressions-and-authored-choices). A false result, expression error, or hidden fact leaves the choice out. Weighted choices use `weight.base` (default 1) plus each true adjustment. False conditions and unavailable facts add nothing. If the check cannot finish an adjustment within its execution budget, it drops the choice. The final weight must be positive. Template weight adds to rank; other weights affect draws. Pages use their conditions and topic tags.

When a template names several rules, they must match the same subject with overlapping evidence periods. Groups must share a subject kind and group key. The candidate keeps the overlap, combined tags, strongest development's tier and score, and urgency from any match.

| Template field | Meaning |
| --- | --- |
| `id`, `triggers`, `tags`, `variants` | Required: stable template ID, matching rule IDs, topic and scope tags, and ordinary prose choices |
| `triggerSummary` | Eligibility summary for the Writing Desk, which falls back to rule summaries or readable IDs |
| `mode` | `authored` (default) or `llmOnly`, which the current editor skips |
| `short` | Lets the editor reserve its last ranking slot for a brief |
| `when`, `weight` | Template eligibility, base weight, and conditional adjustments |
| `names` | Placeholders to style as names |
| `extends`, `links` | Root template ID and typed link list |
| `merge` | Rules and variants for combining selected stories |

Each variant needs an `id`, `headline`, and `body` (one entry per paragraph). It can also set `subheadline`, `byline`, `when`, `weight`, `links`, and [style tags](#variant-styles). The `settled` mark records review in the [Writing Desk](../platform/ui.md#writing-desk) and leaves selection unchanged. Use the [writing rules](writing.md) to draft the copy.

### Combining stories

A template with `merge` can combine selected stories even when its own ordinary article was not selected. `merge.match` tests a selected `member` against the combining candidate, `lead`. Set `merge.min` to the minimum number of other stories; higher `merge.priority` wins when combinations compete.

`merge.variants` and `merge.values` can use `merge.members` and `merge.count`. A scalar value named `attackers` prints as `{{merge.values.attackers}}`. Use an empty ordinary `variants` list for a new merge-only template. To suppress a stock variant in an overlay, set its `when` to the string `"false"`. Set `merge` to `null` in an overlay to disable the combination.

A combination uses one slot, keeps the original evidence and urgency, and replaces the combining template's own article if it was selected. The editor needs eligible combined prose and enough remaining articles to fill the front. See [war coverage](triggers/war-and-peace.md#combining-declaration-reports) for an example.

### Variant styles

Set all three tags together or use the defaults. The tag definitions in `styles/voice.json`, `stance.json`, and `genre.json` also hold drafting guidance. Style affects prose choice; placement uses the candidate's topic tags.

| Kind | What it describes | Default |
| --- | --- | --- |
| Voice | How the piece sounds, such as a crier or the press | `general` |
| Stance | Its point of view, such as neutral or pro-government | `neutral` |
| Genre | Its form, such as a report or letter | `report` |

Each style rule has an `id`, `match`, `when`, and positive `multiplier`. A variant needs an allowed tag for every kind in `match`. Put single-kind rules in `voice-rules.json`, `stance-rules.json`, or `genre-rules.json`, and rules that test multiple kinds in `mixed-rules.json`. Rules are read in that order, with overlays after stock. Overlays can redefine tags; added rules need new IDs.

Rules can read `story.tier`, `story.importance` (adjusted tier score before ranking bonuses), `story.urgent`, `story.short`, and `story.tags`. Guard subject-specific reads. For example, test `subject.kind === 'city'` before `city.happinessDelta`. A false condition, error, or hidden fact leaves the weight unchanged. Applied style evidence goes into the audit. Use the variant's own `when` for facts its copy needs.

The editor draws variants for placed articles in ranked order. Each earlier variant with the same tag applies that kind's factor in `defaults.styleRepeat`: voice 1.25, stance 1, and genre 0.8. This favors a consistent voice and varied genres.

### Placeholders and facts

Prose and links use `{{name}}` placeholders. A placeholder prints its own unit, so copy writes it alone: `on {{observedTurn}}`, not `on turn {{observedTurn}}`. Require the facts that define the story in the trigger's `when`, including before counting items in a roundup. If a supporting detail is missing, a variant that prints it is ineligible. Articles cite the evidence behind facts and terms they print.

| Placeholder | Value |
| --- | --- |
| `{{city}}`, `{{cityId}}` | City name and ID for a city subject or the city linked to an event |
| `{{subject.name}}`, `{{subject.id}}` | Name and ID of the visible subject |
| `{{turn}}` | The current turn, which is the issue's cutoff |
| `{{period.from}}`, `{{period.to}}` | Matched rules' shared window, with an exclusive lower bound and inclusive cutoff. Each prints as `turn X`. |
| `{{city.owner.name}}`, `{{city.owner.leader}}` | Identity of a directly referenced subject. A city owner's name and ID also have the aliases `{{owner}}` and `{{ownerId}}`. |
| `{{lost}}`, `{{originCity}}` | Rule-defined values, for example a population drop or one endpoint in the stock trade routes |
| `{{key}}`, `{{count}}` | A single group's key and member count |
| `{{terms.civilization}}`, `{{terms.civilizationAdjective}}`, `{{terms.leader}}` | Receiver's civilization name, English adjective, and leader. For a modded or localized name, use its recorded name or supply the adjective in the catalogue. |
| `{{terms.<name>}}` | A printable [term](triggers/constants.md#terms) defined by the catalogue |

The Writing Desk lists one canonical name per value: bare trigger values, short reference names such as `owner`, and no IDs, `subject.*` names, or `period.*` names. Before checking copy, the desk rewrites a misspelled name to its listed name when only one row matches. A row matches when the spelling is one of the row's runtime aliases, or when it equals the row's name after ignoring case, punctuation and a trailing `name`. For example, `{{city.name}}` and `{{cityName}}` both become `{{city}}`. The same step drops stray braces around a matched name and a plural suffix on a name that already prints its unit. The desk accepts only listed names after that step. The runtime still accepts the longer aliases and IDs for links and overlays.

Identity placeholders follow one reference from a subject. For example, an event can use `{{event.city.name}}`. To print its city's owner, define a trigger value for that fact. World and group subjects have no automatic name or ID. If a reference such as `city.formerOwner` is missing from the Writing Desk's variable list, expose the name as a trigger value to use it there.

For a single group, print a non-null scalar `{{key}}` or `{{count}}`. A grouped rule's other values print only when every member has the same value; for example, `{{victim}}` prints when all lost units fell to one civilization. Expressions can read `group.matches`. If several rules supply the same value, qualify it: `{{triggerValues.conversions.count}}` names the group from the `conversions` rule. Its members are available in `triggerValues.conversions.matches`. Ambiguous bare values leave the variant out.

List name placeholders without braces in `names`, such as `terms.leader`. The reader underlines them using `vd-name` and keeps declared links clickable.

The editor matches unit patterns against the placeholder name, ignoring case.

| Name pattern | Unit |
| --- | --- |
| `turn`, `period.from`, `period.to`, or a name ending in `Turn` other than `PerTurn` (such as `observedTurn`) | `turn 42`, capitalized as `Turn 42` at the start of a sentence |
| Ends in `percentage` or contains `happiness` or `weariness` | percent |
| Contains `population` | million |
| Contains `points`, `turns`, or `distance` | point, turn, or tile, with a plural as needed |

Use `{{count|power|powers}}` to append a noun to a plain count.

### Sharing links

Set `extends` to `city` to inherit the root link from `{{city}}` to `{{cityId}}`. Root entries in `root-templates.json` have an `id` and `links`; they supply links only. An overlay root with the same ID replaces the entire stock root.

A template inherits its root's links, and ordinary, companion, and merge variants inherit the template's links. A supplied list replaces the inherited list; `[]` disables it. An omitted overlay field keeps the stock setting. Use `links: null` to clear a stock list and inherit again, or `extends: null` to clear the root reference.

Each link needs a prose placeholder, printable display label, and typed destination. The effective links must resolve for the variant to print. The Writing Desk validates against the same lists.

### Civic vocabulary

Use `{{terms.civic.government}}`, `{{terms.civic.people}}`, `{{terms.civic.leaderTitle}}`, and `{{terms.civic.leaderAddress}}` for the receiver. Use qualified terms such as `{{city.owner.civic.people}}` for a visible player. Ordinary references use the cutoff, dated references use their own date, and an unresolved reference leaves its terms unavailable.

The active ideology takes precedence. Otherwise, choose the highest branch tier, then the largest policy count. Break ties alphabetically; use alphabetical order alone if any count in that tier is missing. See `civic-terms.json` for the stock tiers. An optional `eras` list restricts a profile to those recorded eras.

Terms layer from `defaults` to the winning branch or ideology, then civilization terms and the civilization's overrides for the winner. Add new term slots to `defaults`. Key civilization overrides by recorded name. For example, set `civilizations.Rome.branches.Progress.government` to “senate.” Set an inherited branch, ideology, or civilization entry to `null` to disable it. Civic vocabulary reflects the paper's voice; it does not establish an office or constitution.

### Pages and designs

| Page | Briefs required | When it gets a lead |
| --- | --- | --- |
| Front | Four | The first urgent story leads a breaking front. Otherwise, the highest importance must beat the runner-up by at least 15 points before rank bonuses and votes. |
| Section | Two | The same 15-point rule. The section uses unplaced stories with matching topic tags. |

A lead adds one story. The editor checks capacity after combining reports and keeps the reporting period open when the front cannot be filled. Sections run in `pages.json` order. An incomplete section leaves its stories available to later sections. A published article appears on just one page. [Designs](designs.md#which-design-runs) determine how it looks.

### Masthead rules

After choosing a design, the editor looks for a title, motto, and section labels. For example, Rome's *Workers' Herald* under Order and its *Free Press* under Freedom can label the same section differently without changing its ID or stories.

| Rule field | Use |
| --- | --- |
| `id`, `title` | Unique rule ID in the folder and printable title |
| `when`, `weight` | Eligibility and relative weight (base 1 by default). Use the string `"false"` to disable a stock rule. |
| `designs` | Optional list of compatible design IDs. Omit to allow every design. |
| `motto`, `pageLabels` | Optional motto and labels keyed by page ID |

Rules in `mastheads/` override by ID. Titles, mottoes, and labels can use [terms](triggers/constants.md#terms). An unprintable title or authored motto rules out that candidate. The draw stays stable for the same campaign, receiver, and design while eligibility and weights stay the same.

- A winning rule supplies its title and any motto. Labels fall back from a printable rule label to the design label, then the page default.
- Without a winning rule, the design tries a printable exact civilization title, then `"*"`, then its base title. Set `civilizationTitles: null` to clear custom titles. An unresolved placeholder in the final title or motto makes the design ineligible; an empty resolved title uses `defaults.publicationTitle`.

The issue saves these choices. Use **Recorded** replay to see rule results and the CLI audit for the winner and evidence. **Mockups** show design fallbacks.

## Developments, selection, and continuity

The editor ranks up to ten candidates by default. It gives urgent stories priority; within the same urgency the last slot favors a brief if none was selected. Nonurgent stories need a positive rank. A development, continuing series (rule and subject), or war or peace incident can support only one ranked story per issue.

| Rank component | Stock calculation |
| --- | --- |
| Importance and template weight | Adjusted tier score plus resolved template weight |
| Series history | 15% of the highest series score. Published importance adds to the series, which decays by a factor of 0.94 per recorded turn. |
| Novelty | +6 when none of the story's series has printed |
| Variety | +8 when the story adds any tag not yet selected for the issue |
| Votes | [Feedback](#votes-and-preferences), capped at ±25 |

Publication closes the reporting period and spends [repeat memory](triggers/overview.md#repeats) for printed series, including reports covered by a combination. A skip advances the schedule and keeps the reporting period open. Series scores decay on both outcomes.

The [CLI audit](replay.md#generate-examples-from-the-command-line) shows trigger results, candidate ranks, combined reports, placement, and the final `selectedVariants` and `selectedStyles`. Design, layout, and prose draws use separate seeds.

## Votes and preferences

Each unique article has one current vote: -1, 0, or +1. Replacing or clearing it removes its earlier contribution at the next check. Votes leave past issues intact, and article importance does not multiply them.

| Adjustment | Computation |
| --- | --- |
| Series | Sum the votes of items carrying the series, then multiply by the configured series coefficient (10). These votes do not expire. |
| Tag window | Latest configured number of unique items, including unrated items (50 by default). |
| Tag distinctiveness | `1 + ln((N + 1) / (df + 1))`, where N is the number of items in the window and df is the number carrying that tag. |
| Tag bonus | Sum each carrying item's vote divided by its distinct tag count; multiply by distinctiveness and the tag coefficient (3). |
| Candidate adjustment | Add its series adjustments to the mean bonus for its distinct tags, then cap the total (±25). |

The decision records the votes and adjustments used at the cutoff. [Replay preferences](replay.md#stop-resume-or-start-fresh) control future checks. The current editor uses authored rules even when LLM editing is requested, recording the fallback.

## Ownership and inputs

Under `vox-agents/src/newspaper/editorial/`, `config/load.ts` loads the catalogue, `check.ts` runs a check, and `selection/` and `presentation/` handle stories and layout. The publication state lives in `contracts/publication.ts` one level up. See [replay storage](replay.md#source-storage-and-api) and [verification commands](triggers/overview.md#verify-changes).
