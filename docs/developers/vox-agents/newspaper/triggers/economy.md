# Domestic economy triggers

Domestic economy stories report budget transitions, income changes, and happiness shifts for the receiver. This page is for developers tuning or adding that coverage. Read the [trigger overview](overview.md) for shared controls, units, evidence rules, and repeat behavior. The catalogue is `vox-agents/newspaper/triggers/economy.json`; authored variants are in `vox-agents/newspaper/templates/economy.json`. Detection lives in `vox-agents/src/newspaper/editorial/national-developments.ts`, with shared measurements and persistence in `development-facts.ts`.

## Conditions and defaults

| Trigger ID and detector | Condition and default controls | Magnitude; scale |
| --- | --- | --- |
| `budget-deficit`, `economyBudget` | `stage: deficit`: `GoldPerTurn` becomes negative and persists; `persistence: 2`, `maxGap: 5`, `window: 15`. | Absolute current income; 20 |
| `budget-recovery`, `economyBudget` | `stage: recovery`: previously negative `GoldPerTurn` becomes nonnegative and persists with the same controls. | Absolute current income, or 1 at zero; 20 |
| `treasury-reserve`, `economyBudget` | `stage: reserve`: a deficit leaves less than `reserve: 5` Standard turns of treasury, after a nonnegative budget or previously adequate reserve. Also reports positive treasury becoming nonpositive while the deficit continues; `window: 15`. | 1; 1 |
| `income-shift`, `economyIncome` | `GoldPerTurn` rises or falls by at least `absolute: 10` and `relative: 0.25` of the absolute baseline; `window: 10`. | Absolute income change; 40 |
| `happiness-shift`, `happiness` | `HappinessPercentage` moves by `absolute: 10` percentage points or crosses a `milestones: [35, 50]` boundary in either direction; `window: 10`. These are configurable VP defaults and may differ in mod variants. | Absolute percentage-point change; 20 |

## Evidence and repeats

- Budget transitions use observed history, with an earlier opposite state and qualifying observations spanning `persistence` without excessive gaps. The first qualifying observation must become old enough during the current reporting interval. A continuing unchanged deficit therefore does not become another transition report on every check.
- Treasury reserve duration uses the same gold ratio as food reserve duration, but its configured boundary is in Standard turns. The recorded game speed supplies the multiplier.
- Gold, gold per turn, and happiness permit signed measurements. Missing observations remain unknown rather than becoming zero.

## Placeholders

| Family | Useful factual placeholders |
| --- | --- |
| Budget transitions | `income`, `stage`. Treasury: `gold`, `income`, `reserveTurns`. |
| Income shift | `output`, `previousOutput`, `change`, `direction`. |
| Happiness | `happiness`, `previousHappiness`, `direction`, `stage`. |
