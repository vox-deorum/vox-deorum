# Unit AI: Shared Concepts

This page defines the vocabulary that the unit AI guides share: flavors, strategy flags, UnitAI roles, supply, war states, the danger map, and dominance zones. Each concept is defined here once; the other guides link back instead of redefining it. The code lives in `civ5-dll/CvGameCoreDLL_Expansion2`, primarily `CvFlavorManager.cpp`, `CvEconomicAI.cpp`, `CvMilitaryAI.cpp`, `CvDiplomacyAI.cpp`, `CvPlayer.cpp`, `CvUnit.cpp`, `CvDangerPlots.cpp`, and `CvTacticalAnalysisMap.cpp`, in the **Vox Populi 5.2.7** baseline.

## Flavors

**Flavors** are numeric preference values. Player-level readers consume personality flavors directly, while `CvUnitProductionAI` combines a city's effective flavor values with each unit type's XML flavor affinities to form base weights. Current-state rules then revise or reject candidates.

| Mode | City flavor values | Direct personality reads |
| --- | --- | --- |
| Vox Deorum custom flavors active | `CvFlavorManager::SetCustomFlavors` maps supplied values to signed adjustments and adds them to city flavor recipients. City AI and specialization adjustments remain additive. | Direct reads return custom values. `CvGrandStrategyAI::GetPersonalityAndGrandStrategy` omits the active grand-strategy modifier. |
| Normal Vox Populi | Randomized leader personality, active Economic and Military AI state adjustments, city state adjustments, and production specialization contribute to the city vector. Only state definitions with city-flavor rows change it. | Personality and grand-strategy reads follow the normal Vox Populi path. |

Custom flavors arrive on a 0–100 scale where 50 is neutral. `SetCustomFlavors` maps each value through an exponential curve to a signed adjustment — gentle near the middle, steep at the extremes — and applies it to both the active personality flavors and the city flavor recipients. Direct personality reads rescale the raw 0–100 value instead: `GetPersonalityIndividualFlavor` maps it to the personality range, and `GetPersonalityFlavorForDiplomacy` maps it to 1–10.

Custom values expire ten turns after they are set unless replaced; `CvFlavorManager::CheckCustomFlavorExpiration` checks each turn. Their Lua entry point, `CvLuaPlayer::lSetCustomFlavors`, also rewrites selected Economic and Military AI [strategy flags](#strategy-flags) from custom-flavor thresholds. Those flags can alter role gates and bonuses, and the rewrite does not apply their normal XML flavor adjustments.

Per-decision flavor effects belong to the page that owns the decision: production base weights in [production](production.md#candidate-sources-and-base-weights), force sizing in [military production](military-production.md), explorer and settler demand in [civilian production](civilian-production.md), and combat risk tolerance in [tactical simulation](military-tactical-simulation.md).

## Strategy flags

A **strategy flag** is a named, boolean AI state: an `AIEconomicStrategies`, `AIMilitaryStrategies`, or `AICityStrategies` row such as `ENOUGH_EXPANSION`, `LOSING_MONEY`, or `AT_WAR`. The XML row supplies metadata — weight thresholds, first eligible turn, minimum turns active, re-check cadence, tech prerequisite and obsoletion, and flavor payloads — while the trigger predicate itself is hardcoded in `CvEconomicAI.cpp`, `CvMilitaryAI.cpp`, or `CvCityStrategyAI.cpp` and dispatched by the row's type name.

Adoption and ending run on different cadences. An inactive strategy tests its trigger every turn once allowed. An active strategy tests for ending only every `CheckTriggerTurnCount` turns after adoption, and never before `MinimumNumTurnsExecuted` turns have passed, so strategies resist flickering. Personality shifts the trigger thresholds through each row's `PersonalityFlavorThresholdMod` entries.

Adoption does two things:

- Broadcasts the row's flavor payload onto the active player and city flavors. The delta is stateless — ending the strategy applies the negation — so adopt and end must always pair.
- Flips the boolean that other code reads directly as a gate or bonus.

Vox Deorum adds one rule: a strategy disabled through the Lua API cannot re-adopt for ten turns.

## UnitAI roles

A **UnitAI role** (`UnitAITypes`) describes the job a unit performs for the AI: attack, defense, exploration, settling, and so on. Each unit type declares one **default role** in its XML definition plus an **eligible set** of roles it may be recruited as — what the unit *is* versus what it *may serve as*. The live role is per unit and set at creation; `CvPlayer::initUnit` substitutes the XML default when the creator names no role.

The role is the bridge from production to operation — most recruitment reads it:

| Reader | Use of the role |
| --- | --- |
| Army recruitment | Matches a formation slot's roles against the unit's current role or its type's eligible set. [Military organization](military-organization.md) owns the matching rules. |
| Tactical recruitment | `CvUnit::canUseForTacticalAI` rejects land and naval explorer roles (Homeland handles them) and carrier and nuclear roles (reserved for operations). |
| Homeland role passes | Each civilian pass recruits units by live role. [Civilian operation](civilian-operation.md) lists the passes. |
| Demand and force sizing | Counts units by role, such as explorers and settlers in [military production](military-production.md) force targets. |

Roles change during a unit's life:

- `CvEconomicAI::DoReconState` promotes eligible units to the explorer role and demotes surplus explorers. The target is roughly one explorer per `54 − FLAVOR_RECON` frontier plots between known and unknown territory, halved at war, and abandoned entirely when [losing every war](#war-states). Native explorer types are preferred; a small hysteresis prevents role flapping.
- A unit that can found a city may be flipped to the settler role for opportunistic settlement (`CvHomelandAI::ExecuteOpportunisticSettlementMoves`).
- Leaving an army restores the XML *default* role, not the role the unit held before joining.
- An [upgrade](upgrade.md) replaces the unit, so the replacement starts with its own type's default role.

## Supply

The **hard supply cap** (`CvPlayer::GetNumUnitsSupplied`) is the number of military units a player supports without penalty. It sums per-source contributions, each eroded as the game advances:

- A handicap and start-era base, reduced per era.
- A per-city amount from traits, buildings, and handicap, reduced with tech progress; puppets contribute less.
- A per-population percentage, also tech-reduced.
- Supply from expended Great People.

The total is then divided down by about five percent per city, scaled by handicap bonuses, and reduced by war weariness. A unit counts against the cap when its type is flagged as military support; units with a no-supply promotion or XML flag and contract units are supply-free.

Exceeding the hard cap costs five percent of production and food per excess unit, capped at 70 percent. Training locks follow: any city refuses to train a supply-consuming combat unit at fourteen or more units over, and AI production rejects such candidates as soon as demand reaches the cap (`CvUnitProductionAI::CheckUnitBuildSanity`).

The **soft supply cap** (`CvEconomicAI::GetSoftSupplyCap`) is affordability rather than legality: the largest army — never above the hard cap, at least two units per city — whose maintenance still leaves a minimum gold per turn. The minimum is 2 in the Ancient era, 5 through the Medieval era, and 10 afterward; at war it drops to 1, and when losing every war it drops to −5 while the hard cap is treated as three units higher, letting a desperate player run a deficit.

`CvMilitaryAI::SetRecommendedArmyNavySize` turns the soft cap into force targets. It carves out explorers first (at most a quarter of the cap), then splits the rest between land and naval by weights: defensive weight per city, settler, and exposed city scaled by `FLAVOR_DEFENSE`, offensive weight per attack target scaled by Boldness and `FLAVOR_OFFENSE`, and a naval share proportional to coastal cities and `FLAVOR_NAVAL`. [Military production](military-production.md) consumes the resulting targets.

`CvMilitaryAI::UpdateDefenseState` grades the actual force against the targets. The land state is critical below the land target, neutral up to five-fourths of it, and enough beyond. The naval state is critical at half the naval target or less, needed up to the target, neutral to five-fourths, and enough beyond. Any city under siege forces the matching state to critical.

## War states

A **war state** (`WarStateTypes`) is the AI's per-enemy assessment of how a war is going, updated every turn by `CvDiplomacyAI::DoUpdateWarStates`.

| Severity (worst first) | State |
| --- | --- |
| 1 | Nearly defeated |
| 2 | Defensive |
| 3 | Troubled |
| 4 | Stalemate |
| 5 | Calm |
| 6 | Offensive |
| 7 | Nearly won |

Calm sits above stalemate: a quiet war ranks better than a contested one. The update scores both sides' cities in danger — each endangered city counts more when its zone is enemy-dominated or it is under siege, much more when it is in danger of falling, and the score multiplies threefold for a capital and twofold for a wonder or holy city — then cascades. One-sided serious danger decides the state outright; failing that, a war score at or beyond ±75 forces offensive or defensive; otherwise the danger ratio against personality-adjusted war-score thresholds picks the state. An offensive or defensive result intensifies to nearly won or nearly defeated at double the threshold. Calm requires a moderate war score, no serious danger, and no city captured by either side for ten turns.

`GetStateAllWars` aggregates the wars against major civilizations into winning, neutral, or losing:

| Per-war state | Contribution |
| --- | --- |
| Nearly won | +4 |
| Offensive | +2, or +4 when the enemy is in serious danger |
| Calm or stalemate | 0 |
| Troubled | −1, or −2 when the player is in serious danger |
| Defensive | −2, or −4 when the player is in serious danger |

A total above +2 means winning; below −2 means losing. Two latches force losing regardless of the total: being nearly defeated in any war, or being defensive in any war while the capital is lost or has taken a quarter of its hit points in damage.

The aggregate is the "winning or losing every war" signal other systems read: explorer demand collapses ([roles](#unitai-roles)), military disband and influence gifting are suspended ([cleanup](cleanup.md)), the [soft supply cap](#supply) gains its emergency allowance, and tactical zone priorities shift ([military tactics](military-tactics.md)).

## Danger

The **danger map** (`CvDangerPlots`, one per player) records *who could hit each plot*, not a damage number: per plot, the enemy units that could attack it, the cities that could bombard it, the units that could capture a civilian there, a fog-danger count, and adjacent-citadel damage. Damage is computed lazily for the unit that asks, through `CvPlayer::GetPlotDanger` and `CvUnit::GetDanger`, so the same plot can be safe for a tank and lethal for a worker.

The map is built by simulating every known hostile unit's reachable plots and ranged coverage, adding city bombard ranges, and adding uncertainty: invisible plots near enemy units, enemy cities, or known barbarian camps might hide attackers, so nearby plots gain fog danger. Citadel-adjacent damage counts double because it applies with certainty. An enemy unit that vanishes into fog is still counted for one turn at its last known position.

The map refreshes once per turn in `CvPlayer::doTurnPostDiplomacy` and is marked dirty by war-state changes; a dirty map rebuilds lazily on the next query. The per-unit query has role-aware behavior: air units take only interception damage, a civilian reports maximum danger whenever an enemy could reach or capture it, and a garrisoned combat unit shares its city's damage rather than being targeted directly. Variants exist for a city with a hypothetical garrison and for a unit-agnostic plot estimate. An optional two-pass mode (`MOD_COMBATAI_TWO_PASS_DANGER`, off by default) re-runs the build ignoring zone of control from friendly units projected to die.

Danger steers civilian safety, Homeland positioning, and — through path costs — nearly every AI move; [tactical simulation](military-tactical-simulation.md) explains how danger enters pathfinding.

## Dominance zones

A **dominance zone** is a tactical-map region that combines territory, nearby military strength, and a current combat assessment (`CvTacticalAnalysisMap.cpp`). Each player builds the map from its own perspective, lazily and at most once per game turn when Tactical AI needs it.

Every revealed plot within five plots of its nearest city joins that city's land or water zone. Cityless plots form **wilderness zones**, grouped by connected land or water areas. Zone construction also merges across small lakes and islands: neighboring plots join when they share an area or either connected area has fewer than four tiles. All unrevealed plots share one unknown zone.

| Zone | Territory |
| --- | --- |
| City zone owned by the player's team | Friendly |
| City zone whose team is at war with the player | Enemy |
| Other city zone | Neutral |
| Wilderness zone | Neutral |
| Unknown zone | None |

Zones accumulate melee, ranged, naval, and naval-ranged strength. The unit owner's diplomatic side determines its contribution.

| Unit owner | Zone side |
| --- | --- |
| Team at war with the map's player | Enemy |
| Map player's team | Friendly |
| City-state ally on that city-state's map | Friendly |
| Major civilization at war with exactly the same players | Friendly |
| Other player | Neutral, tracked separately from dominance |
| Barbarian | Ignored |

Army members contribute like other combat units. Civilians do not contribute, and the zone city adds its strength to its side's ranged total. A unit counts toward a city zone when it stands in the zone or within a recruitment range of the city that grows with the game era; a wilderness zone counts only units standing inside it.

```text
city contribution = city strength value × remaining hit points / maximum hit points

unit contribution = base attack or ranged strength × (100 + modifiers) / 100
  modifiers, additive:
    −50  embarked, not visible, or wrong domain for the zone
    +50  range or base moves above 2
    +50  within three plots of the zone city
   +100  standing in an owned citadel

overall strength = melee × 4/3 + ranged + naval + naval ranged
```

The unseen-unit modifier keeps a known but currently unseen enemy at half strength. The dominance margin, `AI_TACTICAL_MAP_DOMINANCE_PERCENTAGE`, is 70 in the game database.

```text
friendly dominant when enemy strength is zero and at least one friendly unit exists
friendly dominant when round(100 × friendly / max(1, enemy)) > 100 + margin + (30 in enemy territory)
enemy dominant when round(100 × enemy / max(1, friendly)) > 100 + margin
even otherwise
```

No strength on either side yields no units visible. One enemy unit against at most one friendly unit yields even. The additional 30 in enemy territory accounts for unseen defenders. The friendly test clamps the margin to at least 10 and the enemy test clamps it to at most 90.

Dominance zones exist so that Tactical AI can pick a per-zone **posture** and order local combat; [military tactics](military-tactics.md#postures-and-local-combat) explains posture selection and zone processing.
