# Unit AI: Operational Loop

The **operational loop** replaces the zone-by-zone combat pass of [military tactics](overview.md) with one command loop per player turn. It is behind the `VOX_TACTICAL_OPERATIONAL_LOOP` mod option, which is off by default, and it never runs for barbarians.

The groundwork is built: the turn under the flag, the settings, the flavor and aggression rules every engagement will use, the value and weights files, and the copies of native functions the loop calls. The command loop itself runs no commands yet, so a flagged turn runs no combat or reinforcement searches.

## Code

The code is in `civ5-dll/CvGameCoreDLL_Expansion2`. Native tactical code stays in one piece. The native changes are a branch at the top of `CvTacticalAI::ProcessDominanceZones`, an optional row counter on `TacticalAIHelpers::ExecuteUnitAssignments` that reports how many rows ran before an attempt stopped (callers that pass none are unchanged), and a friend declaration in `CvTacticalAI.h` so the loop can call native members.

| Source | Owns |
| --- | --- |
| `CvTacticalOperationalLoop.cpp` and `.h` | Settings and their accessor, posture and kind rows, the mapped-flavor port, the geographic blend, aggression from RISK, the copies of native functions |
| `CvTacticalOperationalWeights.cpp` and `.h` | The weights tables and `ResolveOperationalWeights`, nothing else |
| `CvTacticalOperationalValue.cpp` and `.h` | Pure value pieces shared with the simulator's grade: unit worth, value at damage, exposure, city value, plot defense and ground weight, the flavor weight curve |
| `CvTacticalSearchShared.h` | `extern` declarations that let the copies reach native's search globals |

The tactical simulator in `vox-deorum-rl` extracts these files from the DLL source instead of keeping its own versions.

## Turn under the flag

The loop's copy of `ProcessDominanceZones` keeps native's order around the zone work:

1. Global high priority: heal, move operation armies, garrisons.
2. Each zone: emergency purchases only. No posture work runs per zone.
3. The command loop (`RunCommandLoop`), which builds no battlefields yet.
4. Deferred garrison holds, then the global middle and low passes, then the review of unassigned units.

The regular zone reinforcement pass does not run. Units no pass takes go to Homeland AI as usual.

## Settings

`GetOperationalSettings` returns one settings struct per player. In the game it always holds the defaults below; the simulator can override any of them per player.

| Setting | Default | Source |
| --- | --- | --- |
| Command cap | 64 | Game define `VOX_OPERATIONAL_MAX_COMMANDS` |
| RISK for Medium, High, Braveheart | 40, 60, 90 | Game defines `VOX_OPERATIONAL_AGGRESSION_MEDIUM_RISK`, `_HIGH_RISK`, `_BRAVEHEART_RISK` |
| Posture rows and kind rows | [Tables below](#posture-rows-and-kind-rows) | Const tables in `CvTacticalOperationalLoop.cpp` |
| Base weights, flavor slopes, floors, point constants, retry factor | [Weights file](#weights-file) | Const tables in `CvTacticalOperationalWeights.cpp` |

Changing a table means editing its file and rebuilding. Each table has a size check that fails the build when a row is missing.

## Flavors and aggression

Every engagement the loop runs resolves its five [military flavors](../flavors/overview.md) from the ground it covers, then derives its aggression from RISK.

### Mapped flavors

A player's VP flavors are mapped to the five military flavors through a term table, `OPERATIONAL_VP_TERMS`. Each term reads one VP flavor from one layer, scales it by a weight, and adds it to one slot.

| Layer | What it reads |
| --- | --- |
| Active | The flavor as the flavor manager holds it now |
| Personality | The leader's base value |
| Intent | The grand strategy's contribution |
| Strategy | The active strategies' contribution |

Vox Deorum custom flavors are part of the values read, so strategists steer the mapped flavors. A leader with no `FLAVOR_RISK` of its own reads RISK from `FLAVOR_OFFENSE`, as the [general vector](../flavors/overview.md#the-general-vector) does; a custom RISK counts as the player's own. The same mapped flavors feed both the blend and the [weights](#weights-file).

### Posture rows and kind rows

Posture rows are flavor offsets by zone posture. Kind rows are added after the blend, by what the engagement does. Offsets are in flavor points, in the order RISK / OCCUPATION / ATTRITION / HOLD_CITY / HOLD_GROUND.

| Posture | Row | Native unit-fight row |
| --- | --- | --- |
| None | 0/0/0/0/0 | No fight from this posture |
| Withdraw | -30/-20/0/+10/-10 | No fight from this posture |
| Attrition | -20/0/+20/0/0 | Same |
| Exploit flanks | -10/0/+10/0/0 | Same |
| Steamroll | +10/+5/+15/-10/-10 | Same |
| Surgical city strike | 0/+15/-5/-10/-10 | Same |
| Hedgehog | -15/-15/+10/+20/0 | RISK -10 |
| Counterattack | -10/-10/+15/0/+20 | Same |

| Kind | Row | Derived from |
| --- | --- | --- |
| Unit fight | 0/0/0/0/0 | The posture rows are native's unit-fight rows |
| City fight | +10/+15/-25/-5/-5 | Native CityAssault minus the mean of the three assault postures, rounded to 5 |
| Reinforce | -15/-10/-10/+10/+20 | Native Reinforce minus the mean of the seven reinforcing postures, rounded to 5 |
| Withdraw | -10/-10/0/0/-10 | New |

A unit fight inside one zone therefore gets native's row, except Hedgehog's RISK. City fights and reinforcement match native on average and still vary with posture.

### Geographic blend

`BlendEngagementFlavors` runs for each engagement on the plots its search covers, counted by zone ID. The plot count comes from `GatherSearchPlotZones`, a copy of the search's plot gathering that skips remote air bases and the unrevealed zone.

1. Per zone: the mapped flavors with the civ, operation and zone modifiers (native's `ApplyFlavorModifiers`, without intent defaults), plus the zone's posture row.
2. Average the zone vectors by plot share. With no known zone, the mapped flavors stand alone.
3. Add the kind row, clamp to 0 to 100, and round once.
4. The representative zone is the one with the most plots; ties go to the lower ID.

RISK always counts as set, so danger scoring follows it in every search. Example at neutral mapped flavors: a unit fight over 60% Hedgehog and 40% Steamroll ground gets RISK 50 + 0.6 × (−15) + 0.4 × 10 = 45. As a city fight it gets 55.

### Aggression from RISK

`AggressionFromRisk` maps the blended RISK to the search's aggression level, for fights and marches alike. Native positions units at Low only.

| RISK | Level |
| --- | --- |
| Below 40 | Low |
| 40 to 59 | Medium |
| 60 to 89 | High |
| 90 and above | Braveheart |

At neutral flavors, a Reinforce into a Steamroll zone blends to RISK 45 and searches at Medium; a Reinforce into any other posture stays Low.

## Value file

`CvTacticalOperationalValue` holds the value pieces the loop's priorities and the simulator's grade both use, so they never disagree. The functions work on plain numbers, with thin adapters on `CvUnitEntry`, `CvCity` and `CvPlot`.

| Piece | Rule |
| --- | --- |
| Unit worth | Combat power times production cost, raised by the level premium (`gradeSeniorityPerLevel`, 0.1 per level above 1) |
| Value at damage | A unit keeps the value floor (`unitKillShare`, 0.6) plus its HP share of the rest |
| Exposure | Expected loss from incoming damage: the whole remaining value on a kill, otherwise the lost share above the floor |
| City value | Economic value, or population when that is not positive |
| Ground | Plot defense and ground weight |
| Flavor weight curve | A base weight times 2 to the power of slope × (flavor − 50) / 50, reversed for RISK |

Changing a value parameter changes the grade, so it comes with a grade version bump in the simulator.

## Weights file

`CvTacticalOperationalWeights` holds the loop's tunable numbers, one row per number, each with the name the simulator's templates and records use.

| Table | Rows | Defaults |
| --- | --- | --- |
| `OPERATIONAL_WEIGHT` | `weight.attrition`, `weight.occupation`, `weight.holdCity`, `weight.holdGround`, `weight.risk`, each with the flavor that scales it and its direction (RISK scales down) | 1 |
| `OPERATIONAL_FLAVOR_SLOPE` | `slope.<FLAVOR>` per military flavor | 1 |
| `OPERATIONAL_CONSTANT` | `floor.theater`, `floor.siege`, `point.safeBar`, `point.capitalPremium`, `gate.retryFactor` | 0.2, 0.2, 2/3, 1, 0.8 |

`ResolveOperationalWeights` turns the settings and a player's mapped flavors into the turn's weights through the flavor weight curve. At flavor 50 the curve is exactly 1, so a neutral player gets the base weights. To tune, edit one row's value and rebuild.

## Copies of native functions

Each copy starts as its native original and changes only what the table lists. Its comment names the original, so a Vox Populi merge can diff the two. Copies don't follow upstream changes on their own.

| Copy | Native original | Change |
| --- | --- | --- |
| `ProcessDominanceZones` | `CvTacticalAI::ProcessDominanceZones` | The [turn under the flag](#turn-under-the-flag) |
| `ExecuteEngagement` and `SearchAndExecute` | `TacticalAIHelpers::FindAndExecuteBestUnitAssignments` | Gathers the geometry first, blends flavors with the kind row, and derives aggression from RISK, then calls native `FindBestUnitAssignments` unchanged. Retries keep the engagement's flavors and aggression. Reports each attempt's rows and, through native `ExecuteUnitAssignments`'s row counter, how many ran |
| `GatherSearchPlotZones` | Plot gathering in `FindBestUnitAssignments` | Returns plot counts by zone for the blend |
| `PositionUnitsAroundTarget` | `CvTacticalAI::PositionUnitsAroundTarget` | Takes flavors and aggression in place of Low and the search intent. Spotter and path moves skip held garrisons. Land units embark on path moves only through safe sea plots, in place of native's no-embark rules |
| `WithdrawUnitToward` | The per-unit move of `CvTacticalAI::ExecuteWithdrawMoves` | Moves one unit toward a destination it is given |
| `SortTargetsAndDropUseless` | `CvTacticalAI::SortTargetListAndDropUselessTargets` | Orders by the loop's priorities, and never drops a target flagged as able to attack our units |
| `GetDangerByThreat` | `CvDangerPlotContents::GetDanger` (unit overload) | Same total, and also returns each threat's damage, unit or city |

The copies after `ProcessDominanceZones` have no caller yet; the command loop will use them for fights, Reinforce and Withdraw.
