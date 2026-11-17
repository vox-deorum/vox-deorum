# City triggers

City stories report changes in the receiver's own cities, such as population, food, recovery, and administration. This page is for developers tuning or adding that coverage. Read the [trigger overview](overview.md) for shared controls, units, placeholders, continuity, and repeat rules. The catalogue is `vox-agents/newspaper/triggers/cities.json`; authored variants are in `vox-agents/newspaper/templates/cities.json`. Detection lives in `vox-agents/src/newspaper/editorial/city-developments.ts`, with shared measurements and continuity in `development-facts.ts`.

All city developments here concern the receiver's cities and require comparable same-owner observations. The `city-recovery` entry ships in `cities.json`, so its coverage is documented here; [recovery](recovery.md) maps the cross-category recovery entries.

## Conditions and defaults

| Trigger ID and detector | Condition and default controls | Magnitude; scale |
| --- | --- | --- |
| `city-population-milestone`, `cityPopulation` | `stage: milestone`: crosses any `milestones: [5, 10, 20]` upward; `window: 15`. | Highest crossed milestone; 20 |
| `city-population-boom`, `cityPopulation` | `stage: boom`: gains at least `absolute: 2` population and `relative: 0.2` of baseline population; `window: 10`. | Population gained; 5 |
| `city-population-decline`, `cityPopulation` | `stage: decline`: population falls; `window: 10`. | Population lost; 3 |
| `city-food-shortage`, `cityFood` | Negative `FoodPerTurn` becomes persistent, or a sustained shortage crosses below `reserve: 3` recorded turns of food. Requires `FoodStored`; `persistence: 2`, `maxGap: 5`, `window: 15`. | Absolute food deficit per turn; 5 |
| `city-recovery`, `cityRecovery` | Population grows from a baseline that is lower than the preceding available observation; `window: 15`. All three observations need continuity. | Population regained since baseline; 4 |
| `city-resistance`, `cityStatus` | `stage: resistance`: `ResistanceTurns` changes from positive to zero. | 1; 1 |
| `city-administration`, `cityStatus` | `stage: administration`: an explicit `IsPuppet` or `IsOccupied` flag changes. | Number of changed flags; 2 |
| `city-razing`, `cityStatus` | `stage: razing`: `RazingTurns` changes from zero to positive. Reports observed active razing, without claiming the city was destroyed. | 1; 1 |

## Evidence and repeats

- Population recovery needs an observed decline into the baseline, followed by growth. The earlier observation, the baseline, and the current city all need continuous ownership and identity.
- Food shortage reports when negative food becomes persistent, or when a sustained shortage crosses below the reserve boundary. A separate low-reserve crossing can report after that sustained shortage. Shared persistence rules keep a continuing shortage from reporting on every check.
- City status requires explicit flags or `ResistanceTurns` and `RazingTurns` changes. Unresolved lifecycle evidence can suppress the comparison, and razing coverage reports active razing without claiming destruction.
- Owner and coordinates must remain comparable between observations. Visible capture and raze records retire stale city rows; see [city continuity](overview.md#evidence-and-continuity).

## Placeholders

| Family | Useful factual placeholders |
| --- | --- |
| City population | `population`, `growth`; population triggers also have `previousPopulation`, and milestones have `milestone`. Recovery retains `recoveryGrowth`, `recoveryFromTurn`, `recoveryToTurn`. |
| City food and status | Food: `food`, `stored`, `reserveTurns`, `stage`. Status: `status`, with `remaining` for resistance and razing. |
