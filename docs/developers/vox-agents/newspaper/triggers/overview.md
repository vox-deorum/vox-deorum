# Newspaper trigger overview

A trigger spots a development in a game recording, such as one of our cities shrinking after training settlers. The rule tests facts visible to the receiving player. A [story template](../editorial.md#authoring-choices) turns a match into copy that can compete for space in an issue.

## Add a trigger

1. Describe the development in one sentence and pick its [subject](#subjects). A city-state switching allies is an `event`; a capital outgrown by another of our cities is a `world` comparison.
2. Find the [facts](facts.md) and [thresholds](constants.md) the rule needs. If a fact is missing, see [how to add it](facts.md#add-a-fact).
3. Add an entry to a topical JSON file under `vox-agents/newspaper/triggers/`. Put cheap conditions that rule out many subjects early in `when`.
4. Add a template under `vox-agents/newspaper/templates/`. Name the rule's ID in `triggers` and give the template and at least one eligible variant positive weight. To tune existing coverage, start with the [settler overlay](examples.md#a-city-shrinks-after-sending-settlers).
5. Start a fresh [replay](../replay.md#iterate-on-a-rule-or-overlay). Read the issue and audit together to see what matched, what was eligible, and what printed.

## A first example

The stock `settler-departure` rule checks one city at a time. Its `recent` window looks back five Standard turns.

| Field | What the rule does |
| --- | --- |
| `when` | Requires an own city, lower population than `city.before.population`, a settler unit in `city.trained`, and positive food income. |
| `values.lost` | Subtracts current population from the earlier population. The template can print `{{lost}}`. |
| `importance` | Scores the development as `30 + 10 * lost`: a drop from 8 to 6 gives 50. |

The same template can tell the story in several ways. The [worked overlay](examples.md#a-city-shrinks-after-sending-settlers) edits the neutral report and keeps its existing condition and city link.

## Trigger entries

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | Yes | Stable name the template references. Keep it when moving or tuning the rule. |
| `subject` | Yes | What the rule runs on. |
| `event` | For event rules | One event type or a list of types. |
| `window` | No | Lookback for `before`, `history`, `events`, and facts such as `city.trained`. A named span or number of Standard turns. Defaults to the open reporting period, which advances when an issue publishes. |
| `when` | Yes | One JavaScript expression or a list whose entries must all pass. |
| `values` | No | Named expressions. Non-null scalar results can become placeholders in an ungrouped story. |
| `importance` | No | A number or expression; [defaults to 50](#importance). |
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

On a passing subject, the editor checks repeat eligibility. For an ungrouped rule, it applies `chance` before evaluating `values`, `importance` and `urgent`. For a grouped rule, it evaluates `values`, forms qualifying groups, then applies `chance` and rates each surviving group. The audit records where each subject or group stopped, expression results and errors, and the evidence behind them. A check that skips publication still records the audit.

## Expressions and authored choices

All expressions can read the check's [globals](facts.md#globals). Other names depend on where the expression runs:

| Place | Additional bindings |
| --- | --- |
| Trigger `when` | The subject, such as `city` or `pair` |
| Trigger `values`, `group.by`, and ungrouped `importance` and `urgent` | The subject and any earlier values |
| Grouped `importance` and `urgent` | The [group bindings](#grouping) |
| Template and variant conditions and weight adjustments | The subject's visible facts, unambiguous value names, `values`, `triggerValues`, `subject`, `period`, and `group`, `key` and `count` for a single group |
| Template `merge.match` | `lead` and `member`: the combining template's facts and a selected story's facts, with `member.templateIds` identifying its templates |
| Merge values and variants | The combining template's bindings, plus `merge.members` and `merge.count`; variants also get the computed `merge.values` |
| Style preferences | The variant bindings and `story`, with `importance`, `urgent`, `short` and `tags` |
| Page, design, layout, and masthead conditions and weight adjustments | No candidate bindings |

See [authoring choices](../editorial.md#authoring-choices) for how these expressions control eligibility and weight.

The shared QuickJS runner validates expressions and shortcuts when the catalogue loads. It has no filesystem, network, clock or random source. If an expression overruns its budget, the runner keeps completed results and skips that expression for the rest of the check. After eight distinct expressions overrun, it skips remaining evaluations.

## Importance

Importance is clamped to 0 through 100 and defaults to 50. A larger score helps a story compete, alongside [novelty, variety and votes](../editorial.md#developments-selection-and-continuity).

## Repeats

| Policy | When a stateful rule can fire again on the same subject |
| --- | --- |
| `rearm` (default) | After an intervening check where `when` was false. A hidden fact or evaluation error does not rearm it. |
| `once` | Never, once the match has been recorded in repeat memory. |
| A span such as `medium` | Once this many [Standard turns](constants.md#spans) have elapsed, even if the condition stayed true. |

When an issue publishes, the editor remembers every fired stateful rule, including developments that did not print. A skipped check can rearm an existing match but does not remember new ones. Event and incident rules do not spend repeats; their subjects come from the reporting period, and a fingerprint keeps the same development from printing twice.

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

Set `group.by` to an expression such as `city.majorityReligion`. Equal keys merge, and each group needs at least `group.min` matches (default 2). The group's rating expressions read the globals and `count`, `key` and `matches`. Each match holds its subject key and evaluated values.

A template can print `{{count}}` and a non-null `{{key}}` for a single group. When combining groups from multiple rules, use the rule ID, as in `{{triggerValues.conversions.count}}`. See [placeholders](../editorial.md#placeholders-and-facts).

## Where to work

Stock catalogue JSON lives under [`vox-agents/newspaper/`](../../../../../vox-agents/newspaper/). Rule evaluation and audit code live in `vox-agents/src/newspaper/editorial/rules/`, with catalogue validation and loading in `editorial/config/`. See [where facts come from](facts.md) before extending the evidence.

From the repository root or `vox-agents/`, use `npm run --silent newspaper:triggers` to list stock IDs and `npm run newspaper:sort-triggers` to sort each stock file by ID. Neither command needs a build or a recording.

## Tune with an overlay

Mirror the catalogue structure in a separate directory and supply the fields you want to change. Trigger entries merge by ID across files; lists such as `when` and `tags` replace the inherited lists. Use the same rule ID and `enabled: false` to switch a stock rule off. See [constant overrides](constants.md#change-or-add-a-name) and [catalogue merges](../editorial.md#catalogue-and-eligibility).

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
