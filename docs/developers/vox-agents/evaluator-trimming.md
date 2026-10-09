# Evaluator trimming

The evaluator strategist answers a whole decision in one evaluation call over one markdown state (see [Evaluators](evaluators.md#evaluator-strategist)). Late in a game that state outgrows the model's input limit, so `buildStrategistEvaluationState` in `src/strategist/agents/evaluator-questions.ts` shortens it with a **trim ladder**: an ordered list of cuts that removes event tiers and report details until the state fits. This page covers the budget, the ladder, what is never trimmed, how to retune it, and what trimming reports.

Paths are relative to `vox-agents/`.

## Why it exists

Late in a game, the state can stay over the limit even with every event dropped. The Players report (opinion lists and city-state relationships), the Cities report, and the Military report are large on their own. So the ladder mixes event tiers with report details, cutting low-value detail from each before the more important event tiers go.

## The budget

The state may use 90 percent of the model's input limit (`evaluatorTrimConfig.budgetShare` in `src/strategist/agents/evaluator-trim-config.ts`, checked against `inputTokenLimit` in `src/utils/models/models.ts`). With TypeSafe's default 30,000-token limit, that is a budget of 27,000 estimated tokens. A model with no input limit set gets the state untrimmed.

The headroom is needed because the token count is a local estimate (`countTokens` in `src/utils/models/token-counter.ts`), and the estimate counts about 14 percent fewer tokens than Jev does: Jev once accepted a state estimated near 28.2k tokens and once rejected another estimated near 28.0k against the same 32k cap.

## How the ladder walks

`trimToFit` in `src/strategist/agents/evaluator-trimming.ts` applies the ladder from `evaluator-trim-config.ts` to the trimmable reports (events, players, cities, military). Each step works on copies, so the cached `GameState` is never changed, and each size check re-renders the whole state, so the parts that are never trimmed still count against the budget.

- Steps run in order and are cumulative: every applied step stays in place for the next check.
- The walk stops at the first step after which the state fits.
- A step that would change nothing (the tier holds no events left, the fields are not present, the opinion lists are already short) is skipped: it is not applied, not reported, and costs no size check.
- If the whole ladder is not enough, the most trimmed state goes out as it is. A provider overflow error then falls into the player loop's existing event window fallback (`withEventWindowFallback`, see [Strategist](strategist.md#event-windows)).

```mermaid
flowchart TD
  A["Estimate the whole state"] --> B{"Over budget?"}
  B -->|no| Z["Send it<br/>(plus the closing note if any step ran)"]
  B -->|yes| C["Next ladder step"]
  C -->|ladder exhausted| Y["Send as is: a provider<br/>overflow falls to the<br/>event window fallback"]
  C --> D{"The step changes anything?"}
  D -->|no| C
  D -->|yes| E["Apply and record the step"] --> A
```

## The ladder

The steps are ordered by how much each cut matters to the evaluator's decisions, least first. City IDs go early because the evaluator answers with no tools. Routine unit production goes before technology and policy progress, while turning points stay protected. The steps, in the order configured in `evaluator-trim-config.ts`:

| # | Id | Removes or compresses |
| --- | --- | --- |
| 1 | `events-noise` | Drops the `noise` event tier (tile changes, unit movement, system events, and every unlisted type) from # Events |
| 2 | `city-ids` | Deletes each city's `ID` |
| 3 | `events-economy` | Drops the `economy` tier (city growth, purchases, worker construction, gifts, and city events) |
| 4 | `events-units` | Drops routine unit training, creation, and investment events |
| 5 | `opinions-top-3` | Compresses major civilizations' weighted opinion lists to their 3 largest factors plus one merged line |
| 6 | `military-unit-stats` | Deletes the military report's `Unit Stats` section |
| 7 | `events-combat` | Drops individual battles, promotions, and barbarian camp events |
| 8 | `military-zone-geometry` | Deletes each tactical zone's `Plots`, `AreaID`, `CenterX`, and `CenterY` |
| 9 | `city-coordinates` | Deletes each city's `X` and `Y` |
| 10 | `city-buildings` | Deletes each city's `ImportantBuildings`, `BuildingCount`, and `GreatWorkCount` |
| 11 | `events-force-changes` | Drops unit upgrades, conversions, losses, and captures |
| 12 | `city-yields` | Deletes stored food and production and per-turn food, production, gold, science, culture, faith, and tourism |
| 13 | `city-state-relationships` | Deletes city-states' relationship entries for other civilizations, keeping our own |
| 14 | `events-progress` | Drops technology, policy, building, era, great person, religion, and city-state progress events |

The event tiers are defined by `eventImportanceTiers` in `src/utils/prompts/event-importance.ts`, shared with the player loop's event window fallback. The ladder drops them in the same order as that fallback does, from the least important up, so both paths agree on what matters.

## Never trimmed

Anything the ladder does not name stays in the state in full:

| Report or section | What always stays |
| --- | --- |
| System prompt, Situation, Your Civilization, Options, Strategies, Victory Progress, turn context | These are not on the ladder at all, so they are always sent whole. |
| Players | Every civilization entry stays, with each city-state's `Quests` and `MajorAlly` and our own city-state relationship. Opinion lists are compressed but never removed. |
| Cities | Every city keeps its name, owner, `Population`, `DefenseStrength`, `Health`, status flags, razing and resistance turns, `MajorityReligion`, `CurrentProduction`, `ProductionTurnsLeft`, `HappinessDelta`, and Wonders. |
| Military | Every tactical zone stays, with its value, dominance, posture, strength comparison, city, units, and neighbors. Only the `Unit Stats` section and the zones' size and position can go. |
| Events | This ladder preserves `turning-points` and `diplomacy`. The outer overflow fallback may drop diplomacy last, but always preserves turning points across the pending window. |

## Opinion compression

The `opinions-top-3` step shortens both opinion lists of every major civilization with one rule (`compressOpinions` in `src/strategist/agents/evaluator-trimming.ts`):

- Factor lines end with a weight, such as `(-30)` or `(+12)`. The 3 lines with the largest weight by absolute value stay, in their original order, and the rest merge into one line carrying their summed weight.
- Lines without a weight are summaries, such as the leader's real approach, and always stay.
- A list with no weights at all is left alone, since it cannot be ranked. Whether weights show depends on game settings, not on which list it is.
- A list that is already short enough is left alone, and if no player has anything left to compress the whole step is skipped.

For example, a weighted list of one unweighted summary line plus factors at `(-51)`, `(-30)`, `(-12)`, `(-8)`, `(-6)`, and `(-4)` comes out as:

- The summary line, kept.
- The three largest factors (`-51`, `-30`, `-12`), kept in their original order.
- One merged line: "3 smaller factors combined (-18)".

## Editing the ladder

`evaluator-trim-config.ts` is data only: each step is an id, a short note for the model, and exactly one action. You can reorder steps, retune what they target, or add new ones without touching `evaluator-trimming.ts`, which applies whatever the config lists.

| Action | Effect |
| --- | --- |
| `events` | Drops one event tier by name. Valid names in removal order are `noise`, `economy`, `units`, `combat`, `force-changes`, `progress`, `diplomacy`, and `turning-points`. Unlisted and malformed event types count as `noise`. |
| `cityFields` | Deletes the listed fields from every city in # Cities. |
| `militaryKeys` | Deletes the listed top-level sections from # Military. |
| `militaryZoneFields` | Deletes the listed fields from every tactical zone in # Military. |
| `cityStateRelationships` | Deletes city-states' relationship entries for other civilizations, keeping ours. |
| `opinions` | Compresses major civilizations' weighted opinion lists to their `keep` largest factors plus one merged line. |

When editing:

- Step ids are kebab-case and appear in the `strategist.trim` telemetry, so prefer retuning a step's contents over renaming its id.
- Step notes are joined into the closing note, so write them as short lowercase phrases that read well after "this state was shortened".
- Adding steps is cheap: a step that matches nothing in the current state is skipped and not reported.
- Keep event steps in the shared tier order, least important first; a test checks this.
- The ladder stops at `progress`, so `turning-points` and `diplomacy` survive every evaluator trim.

## The closing note

When at least one step ran, the state ends with a note so the model knows it is reading a partial picture. The note says the state was shortened to fit the input limit, gives the number of dropped events when there were any, and lists the applied steps' notes. For example: "Note: To fit the input limit, this state was shortened (41 events left out): minor tile and movement events left out; city economy events left out; opinions summarized to their 3 largest factors." `buildStrategistEvaluationState` appends the note after the walk ends; the walk itself is what satisfies the budget.

## Telemetry

- The agent span gets `strategist.trim`: JSON with `steps` (the applied step ids, in order), `droppedEvents`, and `fits` (false when even the whole ladder was not enough). The shape is `StrategistTrim` in `src/types/evaluation.ts`.
- `executeEvaluation` in `src/strategist/agents/evaluator-strategist.ts` sets the attribute before the evaluate call, so a request that still overflows shows what was already cut. The attribute is only set when at least one step ran.
- Error logs: `sanitizeAIError` in `src/utils/logger.ts` redacts the state and question set carried in an evaluation request, alongside the existing message redaction, so a provider overflow error does not write the game state into the logs.

## Tests

| File | Covers |
| --- | --- |
| `tests/mock/strategist/evaluator-trimming.test.ts` | The ladder walk: cumulative steps, skipped no-ops, stopping at the first fit, event steps in tier order, and the opinion compression rules |
| `tests/mock/strategist/evaluator-questions.test.ts` | State building: the budget check, the closing note, and the trim record |
| `tests/mock/utils/event-importance.test.ts` | Event tier grouping and dropping |
| `tests/mock/utils/logger-sanitize.test.ts` | Redaction of the evaluation state and questions in error logs |
