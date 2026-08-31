# Unit AI: Military Production

**Force demand** is the empire's need for land, naval, and explorer strength. **Formation gaps** are unfilled required army or operation slots. **Military production** turns both into weighted unit candidates for one city. The [shared candidate lifecycle](production.md#candidate-lifecycle) then compares them with all other buildables, and the [shared candidate gates](production.md#shared-candidate-gates) apply before unit suitability.

The relevant code is in `civ5-dll/CvGameCoreDLL_Expansion2`, primarily `CvMilitaryAI.cpp`, `CvUnitProductionAI.cpp`, `CvCityStrategyAI.cpp`, `CvCity.cpp`, `CvPlayerAI.cpp`, `CvAIOperation.cpp`, and `CvArmyAI.cpp`.

## Demand and candidate sources

`CvMilitaryAI::SetRecommendedArmyNavySize` calculates force demand. For major civilizations, it starts with the soft supply cap, reserves explorer capacity, and divides remaining capacity between land and naval targets. City and coastal-city counts, protected settlers, exposed cities, attack targets, domain overages, and offense, defense, and naval flavors shape that division. Minor civilizations use a simpler land and naval calculation.

Major-civilization explorer demand has a shortage weight and a hard supply-aware limit. The target begins at the lower of one quarter of the soft supply cap and Economic AI's explorer need, then lowers when supply cannot support it. The remaining capacity supports land and naval targets.

| Candidate source | Definition | Weight inputs |
| --- | --- | --- |
| Ordinary unit | A trainable unit with a positive flavor-derived base weight. | Its flavor-derived weight. |
| **Operation request** | A concrete unit recommended for the next required slot of an active operation. | Operation base value, offense flavor, operation skip counter, and ordinary unit weight. |
| **Army request** | A concrete unit recommended for a free required slot in any army. | Army base value and offense flavor. |

`CvUnitProductionAI::RecommendUnit` selects the best trainable match for one `UnitAI` role and includes construction time. `CvCity::GetUnitForOperation` and `CvMilitaryAI::GetUnitTypeForArmy` call it for a slot's primary role, then its secondary role when necessary. A concrete unit can appear as an ordinary candidate and as one or both request candidates.

## Hard gates

The shared [candidate gates](production.md#shared-candidate-gates) cover trainability, puppets, developing cities, siege, and the request muster-city gate. Military suitability adds these hard gates:

| Gate | Result |
| --- | --- |
| Recommended-force limit | Supply-consuming land, naval, and explorer units stop entering normal selection once their respective recommendation is met. Units training count toward the limit. |
| Strategic resource | A unit requiring an unavailable resource is rejected. |
| Deployment and access | A candidate needs valid deployment space and suitable naval access where required. |
| City development and maintenance | Underdeveloped cities and maintenance risk can reject the candidate. |
| Obsolescence | Obsolete choices can be rejected. |

## Score effects

`CvUnitProductionAI::CheckUnitBuildSanity` applies these effects after a candidate reaches suitability. `MILITARYAISTRATEGY_*` names are Vox Populi state flags that provide role gates and score signals. Vox Deorum custom flavors remain the main steering input and the state flags continue to supply their role-specific effects.

| Effect | Military signal |
| --- | --- |
| Force shortage | Rewards shortages in land, naval, and explorer strength. |
| Role balance | Adjusts weight for need and enough states such as siege, archers, mobile units, aircraft, and naval roles. |
| Threat and mission | Uses war domain, city threat, garrison demand, air balance, barbarian pressure, and operation context. City threat favors combat candidates and penalizes noncombat candidates during war. |
| City feasibility | Adjusts for construction time, maintenance, resources, deployment space, naval access, and available upgrades. |

Both request weights read offense flavor through `GetPersonalityAndGrandStrategy`. With Vox Deorum custom flavors active, that call omits the active grand-strategy modifier.

## Formation requests and the muster-city gate

A **muster city** is the city named as the assembly point for an operation's next required slot. An operation request uses that slot, requires its muster city, and must be able to reach the operation muster plot's landmass or ocean. The operation skip counter adds pressure each time the candidate reaches precheck and resets when that candidate is selected.

An army request scans free required slots across armies and prefers the army with the fewest open slots. It has no operation-specific skip pressure.

### Shared muster-city gate

Both request candidates use the same muster-city gate: they reach `CheckUnitBuildSanity` only when the next operation slot names the current city as its muster city. The gate lets operation candidates follow their assembly point. It also affects army candidates, even though their slots may belong to a different army. When no qualifying operation request exists, an army request can remain in `PRE` without reaching suitability. If all candidates fail suitability, the [all-failed fallback](production.md#candidate-lifecycle) restores that army request with the precheck list.

## Weighted request and commitment paths

An operation-request candidate is a weighted entry in ordinary city production. It can lose to another candidate after shared selection.

**Operation commitment** uses `CvCity::CheckForOperationUnits`. It can direct a city to train the unit or purchase it for an operation. **Final-slot purchase** is a separate military path: `CvMilitaryAI::MakeEmergencyPurchases` considers it when the player is not using the at-war strategy or is winning every war. For a recruiting operation with one uncommitted required slot, `CvAIOperation::BuyFinalUnit` can purchase a primary-role match and assign it to that slot.

[Military organization](military-organization.md#recruitment-and-stages) explains how reserve recruitment, commitments, and direct purchases become formation membership.

## Implementation trace

1. `CvMilitaryAI::SetRecommendedArmyNavySize` updates force and explorer recommendations.
2. `CvCityStrategyAI::ChooseProduction` creates ordinary candidates and asks `CvCity::GetUnitForOperation` and `CvMilitaryAI::GetUnitTypeForArmy` for request candidates.
3. `CvUnitProductionAI::CheckUnitBuildSanity` scores or rejects candidates that pass the shared gates.
4. The shared lifecycle applies duration adjustment and selection across units, buildings, projects, and processes.
