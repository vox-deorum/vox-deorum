# Unit AI: Command Settings and Reference

Use this reference to tune or inspect the [command loop](overview.md). It lists recorded fields, configuration defaults and the source files that own them. [Value and priorities](value.md) explains how the numbers combine; [execution](execution.md#flavors-and-aggression) explains the search preference blend. HP means hit points.

## Settings

`GetOperationalSettings` fills a settings struct for the player from game defines and constant tables. The DLL runs those defaults. The simulator can replace settings per player. Table changes require editing their source and rebuilding; the row tables have compile-time size checks.

| Setting | Default | Source |
| --- | --- | --- |
| `VOX_TACTICAL_OPERATIONAL_LOOP` | 0 | `NewCustomModOptions.xml` |
| Command cap, `iMaxCommands` | 64 | `VOX_OPERATIONAL_MAX_COMMANDS` |
| Medium, High, Braveheart aggression RISK (score choosing search aggression) thresholds | 40, 60, 90 | `VOX_OPERATIONAL_AGGRESSION_MEDIUM_RISK`, `VOX_OPERATIONAL_AGGRESSION_HIGH_RISK`, `VOX_OPERATIONAL_AGGRESSION_BRAVEHEART_RISK` |
| Posture and kind offsets | Tables below | `CvTacticalOperationalLoop.cpp` |
| Priority weights, slopes and constants | [Weights file](#weights-file) | `CvTacticalOperationalWeights.cpp` |

The game defines are in `(1) Community Patch/Database Changes/Defines/CoreDefineChanges.sql`. The mod option is in `(1) Community Patch/Database Changes/NewCustomModOptions.xml`, both under `civ5-dll/`.

## Posture rows and kind rows

**Posture rows** (offsets for a zone's tactical stance) are applied before the geographic average. **Kind rows** (offsets for the active command type) are added afterward. All entries are flavor points. RISK accepts danger, OCCUPATION favors capturing cities, ATTRITION favors damaging enemies, HOLD_CITY favors city defense, and HOLD_GROUND favors territorial control.

| Posture | RISK | OCCUPATION | ATTRITION | HOLD_CITY | HOLD_GROUND |
| --- | --- | --- | --- | --- | --- |
| None | 0 | 0 | 0 | 0 | 0 |
| Withdraw | −30 | −20 | 0 | +10 | −10 |
| Attrition | −20 | 0 | +20 | 0 | 0 |
| Exploit flanks | −10 | 0 | +10 | 0 | 0 |
| Steamroll | +10 | +5 | +15 | −10 | −10 |
| Surgical city strike | 0 | +15 | −5 | −10 | −10 |
| Hedgehog | −15 | −15 | +10 | +20 | 0 |
| Counterattack | −10 | −10 | +15 | 0 | +20 |

| Active command kind | RISK | OCCUPATION | ATTRITION | HOLD_CITY | HOLD_GROUND |
| --- | --- | --- | --- | --- | --- |
| Unit fight | 0 | 0 | 0 | 0 | 0 |
| City fight | +10 | +15 | −25 | −5 | −5 |
| Reinforce | −15 | −10 | −10 | +10 | +20 |
| Own-city fight | 0 | 0 | 0 | 0 | 0 |

The own-city kind row adds no offset. Posture rows follow native values except that Hedgehog uses −15 for RISK (willingness to accept danger), compared with native's −10. Enemy-city and reinforcement kind rows are derived from native's CityAssault and Reinforce rows by subtracting the mean of their posture rows and rounding to multiples of 5. Withdraw zones contribute their posture offsets to fights and reinforcement; the loop has no separate withdrawal command.

## Weights file

`CvTacticalOperationalWeights.h` and `.cpp` hold the tunable numbers. Names in the tables are also the names for simulator overrides. `ResolveOperationalWeights` turns base weights and mapped flavors into the turn's weights through `FlavorWeight` in the value file.

| Setting | Default | Scaling or use |
| --- | --- | --- |
| `weight.attrition` | 1 | Increases with ATTRITION (damaging enemy forces); scales target and garrison destroyed value. |
| `weight.occupation` | 1 | Increases with OCCUPATION (capturing cities); scales the city allowance at an enemy city. |
| `weight.holdCity` | 1 | Increases with HOLD_CITY (defending cities); scales the city allowance at our city and city relief in unit fights. |
| `weight.holdGround` | 0.05 | Increases with HOLD_GROUND (controlling territory); scales unit-target ground and turns its plot weight into typical units. |
| `weight.risk` | 1 | Decreases with RISK (willingness to accept danger); scales exposure. |
| `slope.RISK`, `slope.OCCUPATION`, `slope.ATTRITION`, `slope.HOLD_CITY`, `slope.HOLD_GROUND` | 1 each | Exponent slope for each flavor's weight. |
| `floor.theater` | 0.2 | Theater in a zone without a contested city; the rest up to 1 is what a contested city can add. |
| `theater.steepness` | 2 | Exponent on both strengths in theater pressure. |
| `city.units` | 3 | Size of a city fight in typical units; this is `C` (city allowance). |
| `readiness.maxFailures` | 3 | Truncated to an integer and floored at 1 for the failure limit. |
| `reinforce.strengthRatio` | 1 | `r` (desired strength ratio): with `T` (enemy strength) and `L` (local friendly strength), need is `max(0, rT − L)`, and selection stops once full strength covers it. The score itself does not read `r`; the enemy-center parity gate uses a fixed ratio of 1. |

Enemy-fight stakes use attrition, occupation, hold-ground and risk weights; own-city stakes use hold-city and risk. Reinforcement uses the strength ratio, and the simulator's settings template rejects values of 0 or below. Simulator overrides must use the supported table names.

The weight curve uses base (the configured weight at neutral preference), slope (sensitivity to preference) and flavor (the mapped preference from 0 to 100): `base × 2^(slope × (flavor − 50) / 50)`. For RISK (willingness to accept danger), replace `flavor − 50` with `50 − flavor`. A preference of 50 returns the base exactly. With the default slope, a 50-point increase doubles an ordinary weight and halves the risk weight. Multiplying all stake weights by the same positive factor preserves ordering.

The value parameters are separate constants in `CvTacticalOperationalValue.h`:

| Parameter | Default |
| --- | --- |
| `unitKillShare` (`q`, share of unit worth retained until death) | 0.6 |
| `gradeSeniorityPerLevel` (worth premium per level above the first) | 0.1 |
| `gradeUpgradeDiscount` (share of a ready upgrade's worth gain) | 0.5 |
| `groundResourceWeight` (strategic or luxury resource weight) | 1 |
| `groundOceanWeight` (ocean weight adjustment) | −0.25 |
| `groundShallowWaterWeight` (coast and lake weight adjustment) | −0.2 |
| `groundImprovementWeight` (ordinary improvement's work value) | 0.1 |
| `groundGreatPersonImprovementWeight` (great person improvement's work value) | 0.25 |
| `groundBonusResourceWeight` (bonus resource's work value) | 0.15 |
| `groundBlockadeShare` (plot stake lost or credited through blockade) | 0.5 |
| `groundCreditShare` (share of excess weight credited for hostile land) | 0.5 |
| `groundCreditFloor` (weight threshold for crediting hostile land) | 1 |

These parameters affect both the shared value functions and the simulator's grade. `unitKillShare` sets both the living value of our units and the destroyed value of enemy units, so damage to either side is valued the same way.

## Records

`RunCommandLoop` can fill an `SOperationalTurnRecord` (the turn's ordered commands and readiness checks). When no record is supplied and both game logging and AI logging are enabled, it writes tactical messages for checks, executed commands and a command-cap stop. Check messages name the result. Command messages identify the command, battlefield and plot, whether search ran, and separate counts of retired fight and reinforcement offers.

Captured search requests carry a **purpose** (a label describing the command and territory). City requests use `CityAttack` (enemy-city fight), `CityDefense` (own-city fight) or `Reinforce` (reinforcement). Unit battles use `BattleFriendly` (our team's zone), `BattleNeutral` (unowned territory or a zone outside our team whose owner is not at war with us) or `BattleEnemy` (enemy territory). Retries retain the purpose. Search preferences still come from the geographic blend and command-kind offset.

| Turn field | Content |
| --- | --- |
| `commands` | Executed command records, in order. |
| `checks` | Every readiness check: `iBattlefield`, `eResult` and `bReinforce`, which marks a Reinforce check, including passed checks and the first failed condition. |
| `vSkipped` | Battlefield IDs skipped at the readiness failure limit. |
| `bCommandCap` | True when the cap stops selection while a ready offer remains. |

Each `SOperationalCommandRecord` contains:

| Field | Content |
| --- | --- |
| `iCommand` | Zero-based command position in this turn. |
| `iBattlefield`, `iPlotIndex` | Battlefield ID and target plot at execution. |
| `eKind`, `eOwner` | Unit-fight, city-fight, Reinforce or own-city-fight kind, and the target's owner, which is us for our city. |
| `fEstimate` | The command's single priority field: the estimate it ran at, after any reach checks. Readiness supplies a pass/fail result. |
| `iFailuresBefore` | Cumulative readiness failures before execution. A Reinforce keeps 0 here because it never counts failures. |
| `bSearchRan` | Execution called the engagement search with a nonempty group. |
| `vRetired` | IDs of fights this command retired. |
| `vEndangered` | Endangered recruit IDs paired with a boolean: true for placed, false for free. |
| `vSelected` | Reinforce: the checked selection by unit ID. |
| `bMoved` | Reinforce: a selected unit changed plot or died. |
| `vRetiredReinforce` | Battlefield IDs whose Reinforce this command retired. |

Supporting structures hold the values used during execution:

| Structure | Content |
| --- | --- |
| `SOperationalStake` (fight score components) | Weighted and scaled destruction, ground, city relief, exposure, city-progress and garrison terms, plus their sum, and the damage share, relief share and fall share behind them. |
| `SOperationalReinforce` (reinforcement selection and score) | Strength tallies, selected units, help, gain, arrival ratio, odds, base and projected shares at an enemy city, counted enemies, rejections and check flag. |
| Own-city battlefield | Last `L` (local friendly strength), `T` (enemy strength) and whether an endangered recruit was present. |
| `SOperationalTurn` (working turn state) | Mapped preferences, resolved weights, fixed scales, threat maps, endangered units, approach lists and battlefields. |
| `SOperationalEngagementReport` (search execution report) | Zone plot counts, representative zone (the zone contributing the most search plots), final preferences, aggression RISK (the score choosing search aggression), resolved aggression level and overall success. |
| Search attempt | Planned action rows, rows counted as run and completion status. `ExecuteFight` derives dispositions (whether endangered recruits were placed or left free) from these reports. |

## Code

The source is in `civ5-dll/CvGameCoreDLL_Expansion2`.

| Source | Owns |
| --- | --- |
| `CvTacticalOperationalLoop.h` and `.cpp` | Turn integration and scales; settings, mapped flavors and posture and kind offsets; battlefields, threats, offer scoring and selection; readiness, execution, geographic preference blending, aggression and records. |
| `CvTacticalOperationalWeights.h` and `.cpp` | Named weight and constant tables and `ResolveOperationalWeights`. |
| `CvTacticalOperationalValue.h` and `.cpp` | Shared unit, city, exposure and ground values, reference scales, upgrade premium and flavor weight curve. |
| `CvTacticalSearchShared.h` | Declarations exposing the native search globals used by the copies. |

`EstimateBattlefield` calls `GatherLocalSet`, which applies `StrikeReach` and `CanStrikeCity` and fills an `SOperationalLocalSet` with both filters, then calls `EstimateFight` and `EstimateReinforce` for one battlefield. At an enemy city, `StartCityDamage` and `SimulateCityAttack` run the local damage simulation in an `SOperationalCityDamage`, `ExpectedCityHeal` supplies the heal, and the pure functions `AttackFallShare` and `GarrisonShare` turn the totals into shares. `LocalStrength` and `LocalCityStrength` read the strength filter. The command loop's select step ranks ready offers through the pure functions `OfferRank` and `OfferOutranks`.

The Reinforce code sits in the same loop files. `EstimateReinforce` scores an offer, `GatherReinforceCandidates` applies the filters, `SelectReinforcement` fills the selection, `ProjectCityShares` projects the shares at an enemy city and runs the damage extension, `ScoreReinforcement` computes gain, arrival ratio and odds for a selection, `CheckReinforce` runs the reach checks, `ExecuteReinforce` marches the group and `RetiresReinforce` applies the overlap rule. `TravelTurns`, `EnemyCenterStrength`, `IsCapturer`, `CanMarch` and `MarchFlags` are helpers. `SOperationalCandidate` and `SOperationalReinforce` hold a candidate and a battlefield's Reinforce.

Native integration consists of the branch at the top of `CvTacticalAI::ProcessDominanceZones`, the target snapshot in `FindTacticalTargets` and its cleanup, the optional executed-row counter in `TacticalAIHelpers::ExecuteUnitAssignments`, the optional garrison-damage output of `CvTacticalAI::ComputeTotalExpectedDamage` (the garrison damage of every counted attack, kept across a garrison's death), friend access in `CvTacticalAI.h` and `CvDangerPlots.h`, and the non-const `CvPlayer::GetDangerPlots` accessor.

The tactical simulator extracts the loop, weights and value source from the DLL. Three host-specific members have DLL definitions here and separate simulator definitions: `GroundPlotWeight`, `BeginCommand` and `EndCommand`. The simulator also defines its own `SearchAndExecute`, which routes the engagement to its provider with the given flavors, aggression and target distance flag. The DLL reads revealed resource types for `GroundPlotWeight`. The command boundary members are empty in the DLL; the header defines them as the simulator's per-command work boundaries in the battlefield's zone.

## Copies of native functions

Each copy's source comment names its native original so a Vox Populi update can be compared against it. Copies need explicit upkeep when upstream behavior changes.

| Copy | Native original | Change |
| --- | --- | --- |
| `ProcessDominanceZones` | `CvTacticalAI::ProcessDominanceZones` | The [turn integration order](overview.md#turn-integration). |
| `ExecuteEngagement` and `SearchAndExecute` | `TacticalAIHelpers::FindAndExecuteBestUnitAssignments` | Gather geometry, blend flavors and derive aggression before calling native `FindBestUnitAssignments`. Pass the caller's target distance flag. Keep flavors across up to four attempts and report rows counted as run. |
| `GatherSearchPlotZones` | Plot gathering in `FindBestUnitAssignments` | Count geometry by zone, leaving out remote air bases and zone IDs 0 and −1. Take the caller's target distance flag. |
| `ExecuteFight` | `ExecuteDestroyEnemyUnits`, `ExecuteAttackWithUnits`, and the capture follow-up of `ExecuteCaptureCityMoves` | Add endangered recruits, exclude held garrisons from spotting and use the loop's engagement flavors. City fights use the shared offensive readiness rules. Own-city fights branch to `ExecuteCityDefense` after the move label. |
| `RetiresFight` | Suppression geometry in `SortTargetListAndDropUselessTargets` | Apply distance and zone compatibility after execution, with exposure and near-city exemptions. |
| `ExpectedCityHeal` | City heal in `CvCity::doTurn` | Estimate the heal without applying it, assume the city took damage this turn (no tripling), and ignore whether it is currently damaged. |
| `SimulateCityAttack` | City case of `CvTacticalAI::ComputeTotalExpectedDamage`, for one attacker | Use the quick estimate, keep the counted totals in the loop's simulation, count hits on a replacement garrison as city damage only, and skip native's expected-damage bookkeeping on the move list. A suicidal attack changes no garrison state, and a defender predicted to die is not met again. |
| `GetDangerByThreat` | Unit overload of `CvDangerPlotContents::GetDanger` | Preserve the danger total and list each enemy unit's and city's damage contribution. |
| `GatherReinforceCandidates` | Candidate filters in `CvTacticalAI::PlotReinforcementMoves` | The [candidate and selection rules](recruitment.md#candidates-and-selection), with the [enemy-center gates](reinforcement.md#reinforce-priority). |
| `CanMarch` and `MarchFlags` | Far-out path flags and danger limit in `CvTacticalAI::PositionUnitsAroundTarget` | Safe embark for land units in place of native's two no-embark rules; first-stop danger at half remaining HP for attacking non-siege units, otherwise 0. |
| `SearchReachPlots` | One domain of `TacticalAIHelpers::UpdatePlotDistanceToTarget` | The flood stops at 4 steps. |
| `PositionUnitsAroundTarget` | `CvTacticalAI::PositionUnitsAroundTarget` | Called by `ExecuteReinforce`. Run the search through `ExecuteEngagement` after the spotter move, exclude held garrisons from spotting and path moves, and send path moves through `CanMarch` and `MarchFlags`. |
