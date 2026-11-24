# Newspaper trigger overview

A trigger spots a development in a game recording, such as one of our cities shrinking after training settlers. The rule tests facts visible to the receiving player. A [story template](../editorial.md#authoring-choices) turns a match into copy that can compete for space in an issue.

## Add a trigger

1. Describe the development in one sentence and pick its [subject](#subjects). A city-state switching allies is an `event`; a capital outgrown by another of our cities is a `world` comparison.
2. Find the [facts](facts.md) and [constants](constants.md) the rule needs. Choose a [tier](#tiers-adjustments-and-stakes) for the story and any adjustments that help it rank.
3. Add the rule to a topical file under `vox-agents/newspaper/triggers/`. Start `when` with conditions that rule out many subjects. Require facts essential to the story there, such as both leaders' names in a report that needs them.
4. Add a template under `vox-agents/newspaper/templates/`. Name the rule's ID in `triggers` and give the template and at least one eligible variant positive weight. To tune existing coverage, start with the [settler overlay](examples.md#a-city-shrinks-after-sending-settlers).
5. Start a fresh [replay](../replay.md#iterate-on-a-rule-or-overlay). Read the issue and audit together to see what matched, what was eligible, and what printed.

## A first example

The stock `settler-departure` rule checks our cities for a population drop after training settlers within `recent` (five Standard turns). It also requires positive food income. The rule stores the population lost in `values.lost` so the template can print `{{lost}}` and the score can rise with the size of the loss. The [worked overlay](examples.md#a-city-shrinks-after-sending-settlers) shows how to tune both scoring and wording.

## Trigger entries

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | Yes | Stable name the template references. Keep it when moving or tuning the rule. |
| `summary` | No | A brief description of when the rule fires. The Writing Desk shows it in the template tooltip and the writer's brief. |
| `subject` | Yes | What the rule runs on. |
| `event` | For event rules | One event type or a list of types. |
| `window` | No | Lookback for `before`, `history`, `events`, and facts such as `city.trained`. A named span or number of Standard turns. Defaults to the open reporting period, which advances when an issue publishes. |
| `when` | Yes | One JavaScript expression or a list whose entries must all pass. |
| `values` | No | Named expressions. Non-null scalar results can become placeholders in an ungrouped story. |
| `tier` | Yes | A [tier name](#tiers-adjustments-and-stakes) or an expression that returns one. |
| `adjust` | No | One expression or a list of expressions that add or subtract points from the tier base. |
| `urgent` | No | Expression that can qualify the development for breaking front page coverage. |
| `group` | No | [Combines](#grouping) matches by key. |
| `repeat` | No | [Controls](#repeats) when a subject can fire again. |
| `chance` | No | [Probability](#chance) from 0 to 1 that a qualifying subject or group produces a development. |
| `tags` | No | Labels used in editorial selection, pages and feedback. |
| `enabled` | No | Set to `false` to disable the rule. |

### Subjects

| Subject and expression name | The rule runs once for |
| --- | --- |
| `city` | Each visible city at the cutoff |
| `player` | Each known player, including the receiver and city-states |
| `pair` | Each pair of known players with a recorded relationship |
| `event` | Each permitted event of the listed types in the reporting period |
| `incident` | Each inferred [war or peace incident](war-and-peace.md) in the reporting period |
| `world` | The whole check; use globals such as `cities` and `players` |

An event or incident remains a subject if it is inside the reporting period even when the rule has a shorter `window`. See the [facts reference](facts.md) for the available globals and helpers.

## How a check evaluates triggers

Each enabled rule tests its subjects against the same fact model. A `when` list runs in order and stops at the first false result, [hidden or missing fact](facts.md#hidden-and-missing-facts), or error. Conditions use JavaScript truthiness: for example, a readable nonempty `city.majorityReligion` passes.

After `when` passes, the editor checks repeat eligibility. Ungrouped rules apply `chance` before evaluating `values` and scoring the match. Grouped rules evaluate `values`, form groups, then apply `chance` and score each surviving group. The audit includes results, errors, and evidence even if the check publishes nothing.

## Expressions and authored choices

All expressions can read the check's [globals](facts.md#globals). Other names depend on where the expression runs:

| Place | Additional bindings |
| --- | --- |
| Trigger `when` | The subject, such as `city` or `pair` |
| Trigger `values`, `group.by`, and ungrouped `tier`, `adjust`, and `urgent` | The subject and any earlier values |
| Grouped `tier`, `adjust`, and `urgent` | The [group bindings](#grouping) |
| Template and variant conditions and weight adjustments | The subject's visible facts, unambiguous value names, `values`, `triggerValues`, `subject`, `period`, and `group`, `key` and `count` for a single group |
| Template `merge.match` | `lead` and `member`: the combining template's facts and a selected story's facts, with `member.templateIds` identifying its templates |
| Merge values and variants | The combining template's bindings, plus `merge.members` and `merge.count`; variants also get the computed `merge.values` |
| Style preferences | The variant bindings and `story`, with `tier`, `importance`, `urgent`, `short`, and `tags` |
| Page, design, layout, and masthead conditions and weight adjustments | No candidate bindings |

See [authoring choices](../editorial.md#authoring-choices) for how these expressions control eligibility and weight.

The QuickJS runner validates expressions, including shortcuts and stakes, when the catalogue loads. It has no filesystem, network, clock, or random source. It skips an expression that exceeds its budget for the rest of the check. After eight distinct expressions overrun, it skips remaining evaluations.

## Tiers, adjustments, and stakes

Choose a tier for what happened. Use shared stakes to account for why it matters to the reader. Add a custom adjustment only when a separate fact should change the ranking.

| Tier | Stock base | Stock example |
| --- | --- | --- |
| `crisis` | 90 | We become a vassal |
| `major` | 75 | We enter a new era |
| `notable` | 60 | We gain a city-state ally |
| `routine` | 45 | A city completes a defense |
| `filler` | 30 | A city completes an ordinary building |

A tier expression can distinguish stories of different kinds, for example `ours ? 'major' : 'notable'`. Use `adjust` for differences of degree. Each entry must return a finite number. A hidden fact or error contributes zero for that entry and is recorded in the audit; other entries can still count. A tier that cannot be resolved prevents the development from firing. The audit shows the tier, its base, each adjustment, and the final importance, clamped to 0 through 100.

[Stakes](constants.md#stakes) are shared adjustments that a rule applies by name. They apply only where a rule uses them:

| To weigh | What to use |
| --- | --- |
| A civilization's relationship to the reader | For a foreign wonder, use `city.owner.stake.relation`: a friend within seven tiles can add 14 points, while a distant neutral civilization can subtract 8. For news about two civilizations, use `pair.stake.relation`. |
| The city itself | Use `city.stake.place`. A foreign city six tiles from our nearest city gets +5; one 100 tiles away gets −8. Use visible `city.isCapital` or `city.population` to add a separate bonus for a foreign capital or a large foreign city. |
| An offensive near a city | Use [tactical observations](facts.md#tactical-observations) to detect a shift in posture. [Rank the offensive by the city's location](examples.md#a-nearby-offensive-outranks-a-distant-one). |

City location and the owner's relationship can count separately. Check whether you want proximity in both, since the relationship stake also considers distance. Adjustments help eligible stories compete alongside [novelty, variety, and votes](../editorial.md#developments-selection-and-continuity). Visibility and matching still follow the rule's facts and conditions.

## Repeats

| Policy | When a stateful rule can fire again on the same subject |
| --- | --- |
| `rearm` (default) | After an intervening check where `when` was false. A hidden fact or evaluation error does not rearm it. |
| `once` | Never, once a story for that rule and subject has printed. |
| A span such as `medium` | After this many [Standard turns](constants.md#spans) have elapsed since publication, even if the condition stayed true. |

A stateful match spends its repeat only when it contributes to a printed story. A match left out can compete again if it still qualifies. A false condition can rearm an existing match even on a skipped check. Publication closes the reporting window; a skip keeps it open. Event and incident rules use the reporting period and fingerprints to avoid repeating printed developments.

## Publication memory

The `press` and `printed` globals describe already published issues. Rules, templates and presentation expressions can read them.

| Name | Value |
| --- | --- |
| `press.issues` | Number of published issues |
| `press.lastIssueTurn` | Latest issue turn, or `null` |
| `printed(ruleId)` | Latest publication `turn` and article `count` for the rule, or `null` |
| `printed(ruleId, subject)` | The same lookup for one city, player or pair |

Grouped articles count toward the rule total and belong to the group key. An individual member gets no credit. Older articles without rule IDs contribute to issue history but have no attribution in `printed`. See the [peace follow-up](examples.md#a-retraction-after-a-printed-peace) for a subject lookup.

## Chance

A qualifying subject or group passes when its seeded draw is below `chance`. The seed combines campaign, receiver, check turn, rule ID and subject or group key. Repeating the same check gives the same result. A failed draw records `chance` in the audit and spends no repeat, so a later eligible check can try again.

## Grouping

To write a pattern rule, match each subject first, then group by what the matches have in common. The stock `neighbors-convert` rule groups neighboring foreign cities by their new majority religion and requires at least three matches. Set `group.by` to the common key and `group.min` to the minimum size (default 2). Rate the group with `count`, `key`, or `matches`, for example by adding more points as the group grows. Each match supplies its subject key and evaluated values.

A template can print `{{count}}` and a non-null `{{key}}` for a single group. When combining groups from multiple rules, use the rule ID, as in `{{triggerValues.conversions.count}}`. See [placeholders](../editorial.md#placeholders-and-facts).

## Where to work

Stock catalogue JSON lives under [`vox-agents/newspaper/`](../../../../../vox-agents/newspaper/). Rule evaluation and audit code live in `vox-agents/src/newspaper/editorial/rules/`, with catalogue validation and loading in `editorial/config/`. See [where facts come from](facts.md) before extending the evidence.

From the repository root or `vox-agents/`, use `npm run --silent newspaper:triggers` to list stock IDs and their authored tiers, and `npm run newspaper:sort-triggers` to sort each stock file by ID. The list shows tier expressions as written; evaluating them takes a replay.

## Tune with an overlay

Mirror the catalogue structure and keep the IDs of rules you want to change. Lists such as `when`, `adjust`, and `tags` replace the inherited lists. Use `enabled: false` to turn off a stock rule. Version 3 uses `tier` and `adjust` in place of the old `importance` field. See [constant overrides](constants.md#change-or-add-a-name) and [catalogue merges](../editorial.md#catalogue-and-eligibility).

Follow the [replay workflow](../replay.md#iterate-on-a-rule-or-overlay) to load an overlay in a fresh run. In browser replay use **Recording > Advanced > Editorial config directory**.

## Probe catalogue behavior

The optional probe catalogue adds synthetic stories, designs and an Opinion page. See [how to load it and what it covers](examples.md#probe-catalogue-examples).

## Verify changes

Compare fresh replays using the same recording, receiver, range and frequency. For engine changes, build MCP first, then run the Vox Agents newspaper tests and type check:

```sh
npm run build -w mcp-server
npm run test:mock -w vox-agents -- tests/mock/newspaper
npm run type-check -w vox-agents
```

Run `npm run test:mock -w mcp-server -- tests/newspaper` for projection changes and `npm run build:newspaper -w vox-agents` for reader changes.
