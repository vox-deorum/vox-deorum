# Unit AI: Shared Concepts

This is the vocabulary guide for contributors working on the unit AI in the **Vox Populi 5.2.7** baseline. It defines terms used across the other guides, so they can focus on the decisions they own. The implementation is in `civ5-dll/CvGameCoreDLL_Expansion2`, primarily `CvFlavorManager.cpp`, `CvEconomicAI.cpp`, `CvMilitaryAI.cpp`, `CvDiplomacyAI.cpp`, `CvPlayer.cpp`, `CvUnit.cpp`, `CvDangerPlots.cpp`, and `CvTacticalAnalysisMap.cpp`.

Use this page to understand a shared input before following it into production, a persistent operation, or the operation lifecycle.

## Flavors

**Flavors** are numeric preferences. City production combines effective city flavors with a unit type's XML flavor affinities, then applies the current decision's rules. Other AI systems read personality flavors directly.

| Mode | City flavor values | Direct personality reads |
| --- | --- | --- |
| Vox Deorum custom flavors active | `CvFlavorManager::SetCustomFlavors` adds signed custom adjustments to city flavor recipients. City AI and specialization adjustments remain additive. | Returns custom values. `CvGrandStrategyAI::GetPersonalityAndGrandStrategy` omits the active grand-strategy modifier. |
| Normal Vox Populi | Leader personality, active Economic and Military AI state, city state, and production specialization contribute to the city vector. Only state definitions with city-flavor rows change it. | Uses the normal Vox Populi personality and grand-strategy path. |

Custom values use a 0 to 100 scale, with 50 as neutral. The game converts them to signed adjustments, applies them to the active personality and city recipients, and expires them after ten turns unless they are replaced. `CvLuaPlayer::lSetCustomFlavors` also uses thresholds to rewrite selected Economic and Military AI [strategy flags](#strategy-flags). These flags still affect gates and bonuses, but do not apply their normal XML flavor adjustments. A strategy disabled through Lua cannot be adopted again for ten turns.

Read the owning guide for a decision's specific flavor effect: [production weights](production.md#candidate-sources-and-base-weights), [force sizing](military-production.md), [civilian demand](civilian-production.md), or [Tactical AI risk tolerance](military-tactical-simulation.md).

## Strategy flags

A **strategy flag** is a named Boolean AI state from `AIEconomicStrategies`, `AIMilitaryStrategies`, or `AICityStrategies`, such as `ENOUGH_EXPANSION`, `LOSING_MONEY`, or `AT_WAR`. XML supplies the timing, thresholds, prerequisites, obsoletion, and flavor payload. `CvEconomicAI.cpp`, `CvMilitaryAI.cpp`, and `CvCityStrategyAI.cpp` provide the trigger predicate selected by the row type.

An inactive flag tests every eligible turn. An active flag tests for ending only at its configured cadence and never before its minimum duration, which prevents rapid switching. Personality can modify its thresholds. Starting a flag broadcasts its flavor payload and flips the state read by other code; ending it removes that same payload and clears the state.

## UnitAI roles

A **UnitAI role** (`UnitAITypes`) is the job a unit performs, such as attack, defense, exploration, or settling. A unit type declares a **default role** and an eligible role set. The live role belongs to the individual unit and defaults to the XML value when its creator supplies none.

| Reader | Use of the role |
| --- | --- |
| Army recruitment | Matches a formation slot against the unit's live role or its type's eligible role set. [Military organization](military-organization.md) owns the matching rules. |
| Tactical recruitment | Excludes land and naval explorers, which Homeland handles, and carrier and nuclear roles, which persistent operations reserve. |
| Homeland role passes | Recruits civilian units by live role. [Civilian operation](civilian-operation.md) lists the passes. |
| Demand and force sizing | Counts roles such as explorers and settlers. |

`CvEconomicAI::DoReconState` promotes suitable explorers and demotes surplus ones. Its target scales with the frontier, `FLAVOR_RECON`, and war state. Native explorers are preferred, and hysteresis limits rapid role changes. Homeland can assign a city-founding unit the settler role for opportunistic settlement. Leaving an army restores the XML default role, rather than the role held before recruitment. An [upgrade](upgrade.md) creates a replacement with its target type's default role.

## Supply

The **hard supply cap** (`CvPlayer::GetNumUnitsSupplied`) is the number of military units supported without penalty. It combines handicap and start-era supply, city and population supply, and expended Great People, then adjusts those sources for era, city count, handicap, and war weariness. Military-support units count; no-supply promotions or XML flags and contract units do not.

Excess hard-cap units reduce food and production, capped at 70 percent. AI city production rejects supply-consuming combat units at the cap. A separate general build check blocks them for any player at fourteen or more units over the cap.

The **soft supply cap** (`CvEconomicAI::GetSoftSupplyCap`) is an affordability target. It never exceeds the hard cap and keeps at least two units per city while preserving era-dependent minimum gold per turn. War lowers that minimum. Losing every active war allows a deficit and treats the hard cap as three units higher.

`CvMilitaryAI::SetRecommendedArmyNavySize` reserves part of the soft cap for explorers and divides the rest between land and naval targets using defense, attack-target, coastal-city, and flavor weights. `CvMilitaryAI::UpdateDefenseState` compares the actual forces to those targets. A besieged city forces its matching defense state to critical.

## War states

A **war state** (`WarStateTypes`) is the per-enemy assessment produced each turn by `CvDiplomacyAI::DoUpdateWarStates`.

| Severity, worst first | State |
| --- | --- |
| 1 | Nearly defeated |
| 2 | Defensive |
| 3 | Troubled |
| 4 | Stalemate |
| 5 | Calm |
| 6 | Offensive |
| 7 | Nearly won |

The update weighs danger to each side's cities, including siege, falling cities, capitals, wonders, and holy cities, then uses war score and danger thresholds. Calm is better than stalemate and requires no serious danger or recent city capture.

`GetStateAllWars` combines major-civilization wars into winning, neutral, or losing.

| Per-war state | Contribution |
| --- | --- |
| Nearly won | +4 |
| Offensive | +2, or +4 when the enemy is in serious danger |
| Calm or stalemate | 0 |
| Troubled | -1, or -2 when the player is in serious danger |
| Defensive | -2, or -4 when the player is in serious danger |

A total above +2 is winning; below -2 is losing. Being nearly defeated in any war, or defensive while the capital is lost or heavily damaged, also forces losing. This aggregate controls explorer demand, military disband and influence gifting, the soft-supply emergency allowance, and Tactical AI priorities.

## Danger

The **danger map** (`CvDangerPlots`, one per player) records which enemies could attack a plot, bombard it, capture a civilian there, or threaten it from fog. It is not a fixed damage value. `CvPlayer::GetPlotDanger` and `CvUnit::GetDanger` calculate damage for the unit asking, so the same plot can be safe for a tank and lethal for a worker.

The map simulates known hostile movement and range, city bombardment, nearby hidden threats, and adjacent citadel damage. A unit last seen entering fog remains for one turn. It refreshes in `CvPlayer::doTurnPostDiplomacy`, and a dirty map rebuilds on the next query. Queries account for special cases: air units take interception damage only; any reachable or capturable civilian reports maximum danger; and a garrisoned combat unit shares city damage. The optional `MOD_COMBATAI_TWO_PASS_DANGER` mode is off by default and rebuilds without friendly zone of control from units expected to die.

Danger steers civilian safety, Homeland positioning, and movement costs. [Military tactical simulation](military-tactical-simulation.md) explains its pathfinding use.

## Dominance zones

A **dominance zone** is a Tactical AI region with territory, nearby military strength, and a combat assessment. `CvTacticalAnalysisMap.cpp` builds it lazily, at most once each game turn for each player's view.

Revealed plots near a city join that city's land or water zone. Connected cityless areas form wilderness zones; small islands and lakes can merge nearby areas. Unrevealed plots share one unknown zone.

| Zone | Territory |
| --- | --- |
| City zone owned by the player's team | Friendly |
| City zone whose team is at war with the player | Enemy |
| Other city zone | Neutral |
| Wilderness zone | Neutral |
| Unknown zone | None |

Zones collect melee, ranged, naval, and naval-ranged strength.

| Unit owner | Zone side |
| --- | --- |
| Team at war with the map's player | Enemy |
| Map player's team | Friendly |
| City-state ally on that city-state's map | Friendly |
| Major civilization at war with exactly the same players | Friendly |
| Other player | Neutral, tracked separately from dominance |
| Barbarian | Ignored |

Combat units, army members, and cities contribute strength; civilians do not. Visibility, embarked or wrong-domain status, mobility, proximity to the zone city, and citadels modify that contribution. A side is dominant only with a large enough strength advantage, with extra caution in enemy territory; otherwise the zone is even. A zone with no strength has no visible units.

Tactical AI uses dominance zones to choose a **posture** and order local combat. See [postures and local combat](military-tactics.md#postures-and-local-combat).
