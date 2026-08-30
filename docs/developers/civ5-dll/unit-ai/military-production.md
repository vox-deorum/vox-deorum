# Unit AI: Military Production

Military production turns empire force demand and formation gaps into weighted unit candidates for one city. City production then compares those candidates with every other buildable and chooses the queue order. The production page covers the shared [candidate lifecycle, fallback, duration adjustment, and selection](production.md#candidate-lifecycle) and [candidate gates](production.md#candidate-types).

The relevant code is in `civ5-dll/CvGameCoreDLL_Expansion2`, primarily `CvMilitaryAI.cpp`, `CvUnitProductionAI.cpp`, `CvCityStrategyAI.cpp`, `CvCity.cpp`, `CvPlayerAI.cpp`, `CvAIOperation.cpp`, and `CvArmyAI.cpp`.

## Military inputs

| Input | Military use |
| --- | --- |
| Effective city flavors | Base preference for each trainable unit. [Flavor mapping](overview.md#flavors) is shared with all production. |
| Force state | Current and in-production land, naval, and explorer counts; supply; wars; threats; and role balance. |
| Formation gaps | Open operation slots and free required army slots, each with primary and secondary `UnitAI` roles. |
| City feasibility | Construction time, maintenance, resources, deployment space, naval access, city safety, and available upgrades. |

`MILITARYAISTRATEGY_*` names are Vox Populi boolean state flags. They provide military role gates and scoring signals. In Vox Deorum, custom flavors are still the main steering input. They do not replace every state check.

## Candidate sources

| Source | What it adds to the precheck list | Distinct pressure |
| --- | --- | --- |
| Ordinary unit | Each trainable unit with a positive flavor-derived weight | Its flavor-derived weight. |
| Operation request | One recommended concrete unit for the next required operation slot at this city's muster point | A high request weight, offense flavor, the unit's ordinary weight, and the operation skip counter. |
| Army request | One recommended concrete unit for a free required army slot | An army request weight and offense flavor. |

The ordinary source includes military and civilian units. `CheckUnitBuildSanity` applies the matching military or civilian logic. A concrete military unit can appear more than once when an operation or army also requests it.

## Force demand and suitability

For major civilizations, `CvMilitaryAI::SetRecommendedArmyNavySize` starts from the soft supply cap, reserves explorer capacity, then divides the rest between land and naval forces. City and coastal-city counts, protected settlers, exposed cities, attack targets, existing domain overages, and offense, defense, and naval flavors shape the split. Minor civilizations use a simpler land and naval target calculation.

For major civilizations, explorer demand receives a shortage weight. Supply-consuming explorers also have a hard cap at the recommended explorer count. The target first limits explorers to a quarter of the soft supply cap, then lowers the limit when the empire cannot supply that many. The remaining force capacity is reserved for land and naval targets.

`CvUnitProductionAI::CheckUnitBuildSanity` revises a candidate's weight or rejects it. The shared [unit gates](production.md#candidate-types) apply before these military signals.

| Signal | Effect on military candidates |
| --- | --- |
| Force size and supply | Rewards shortages and rejects supply-consuming land, naval, or explorer units once their recommended limit is reached. Units in production count. |
| Role balance | Adjusts weight for need and enough states such as siege, archers, mobile units, aircraft, and naval roles. |
| Threat and mission | Uses war domain, nearby threats, garrison demand, air balance, barbarian pressure, and operation context. |
| Local feasibility | Rejects or penalizes maintenance risk, unavailable strategic resources, no valid deployment space, unsuitable naval access, obsolete choices, and unsafe or underdeveloped cities. |

## Formation requests

Both request sources start with an open formation slot. `CvUnitProductionAI::RecommendUnit` chooses the best trainable match for the primary `UnitAI` role. It tries the secondary role only when no primary match is available, and includes construction time when ranking the concrete unit. Both request weights read offense flavor from `GetPersonalityAndGrandStrategy`; with custom flavors active, that call excludes the active grand-strategy modifier.

| Request | How its slot is chosen | City gate and pressure |
| --- | --- | --- |
| Operation | `CvPlayerAI::PeekAtNextUnitToBuildForOperationSlot` exposes the next required slot. | The city must be the muster city and be able to reach its landmass or ocean. The player-level operation skip counter adds pressure. |
| Army | `CvMilitaryAI::GetUnitTypeForArmy` scans free required slots in every army. | It prefers an army with the fewest open slots, so nearly complete armies take priority. It has no operation-specific skip pressure. |

Normally ordinary, operation, and army candidates all receive `CheckUnitBuildSanity`. The request forms share the unusual muster-city gate: both are checked only while the next operation slot names this city as its muster city. That fits operation requests, but it can leave an army request only in the precheck list when no qualifying operation request exists. If every candidate fails the shared suitability pass, the [all-failed fallback](production.md#candidate-lifecycle) restores the precheck list, including that army request.

An operation production candidate is a preference, not a commitment. `CvCity::CheckForOperationUnits` is the separate route that can purchase a unit or explicitly commit the city to train one for an operation. `CvMilitaryAI::MakeEmergencyPurchases` considers final-unit purchases only when the player is not using the at-war strategy or is winning all wars. For a recruiting operation with exactly one uncommitted required slot, `CvAIOperation::BuyFinalUnit` can purchase a primary-role match and assign it to that slot.

## Implementation trace

1. `CvMilitaryAI::SetRecommendedArmyNavySize` updates land and naval targets, plus the explorer target for major civilizations.
2. `CvCityStrategyAI::ChooseProduction` creates ordinary military entries, then asks `CvCity::GetUnitForOperation` and `CvMilitaryAI::GetUnitTypeForArmy` for request entries.
3. `CvUnitProductionAI::CheckUnitBuildSanity` scores or rejects the entries that pass the request gate.
4. Shared city production applies the [duration adjustment and final selection](production.md#candidate-lifecycle) across units, buildings, projects, and processes.
