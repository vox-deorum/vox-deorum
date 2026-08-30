# Unit AI: Military Production

This page describes the interface between military demand and city production in the **Vox Populi 5.2.7** baseline. The military layer produces weighted unit candidates for one city. It does not select the city's next order.

The relevant code is in `civ5-dll/CvGameCoreDLL_Expansion2`, primarily `CvMilitaryAI.cpp`, `CvUnitProductionAI.cpp`, `CvCityStrategyAI.cpp`, `CvCity.cpp`, `CvPlayerAI.cpp`, `CvAIOperation.cpp`, and `CvArmyAI.cpp`.

## Inputs

| Input | What it supplies |
| --- | --- |
| Effective city flavors | The primary preference vector. Vox Deorum custom flavors feed this vector directly when active. |
| Trainable units | The unit types this city can build now and their remaining construction time. |
| Force state | Current and in-production land and naval counts, affordable supply, threats, wars, and role balance. |
| Formation gaps | Required primary and secondary unit roles (`UnitAI`) from operations and armies. |
| Feasibility | Maintenance, resources, deployment space, naval access, city safety, and whether a newer unit type is available. |

In this page, a named `MILITARYAISTRATEGY_*` value is a specific Vox Populi boolean state flag. It is not a separate, undefined source of intent. In normal Vox Populi those flags can change city flavors or apply a role gate. In Vox Deorum, custom flavors are the primary steering input.

## Output: weighted military candidates

The output is a list of zero or more candidates. Each candidate contains:

- a concrete unit type;
- a source: ordinary, operation request, or army request;
- the city's remaining turns to construct it;
- a positive weight after military suitability adjustments.

The weight at this boundary has not yet received the shared construction-time discount. `CvCityStrategyAI::ChooseProduction` applies that discount later, when these candidates compete with civilian units, buildings, projects, and processes.

| Source | Possible entries | Initial weight |
| --- | --- | --- |
| Ordinary | One for each trainable military unit with a positive flavor weight | The unit's flavor-derived base weight. |
| Operation request | At most one concrete unit for the next required operation slot assigned to this muster city | A large operation base weight, plus offense flavor, skipped-request pressure, and the unit's base weight. |
| Army request | At most one concrete unit for an open required army slot. The checked-list gate described below can leave it available only to the all-failed fallback. | An army base weight plus offense flavor. |

A candidate rejected by the military suitability pass is absent from the output. The negative `ProductionSkipReason` is diagnostic information for logging, not a weighted candidate. If every buildable fails its suitability pass, the all-failed fallback described in [production](production.md) can restore candidates from the earlier unfiltered list.

## How the output is calculated

### 1. Build the effective flavor vector

Each city's effective flavor vector is built as described in [the overview](overview.md#flavors): Vox Deorum custom flavors override it directly while active, and normal Vox Populi otherwise assembles it from leader personality, active AI states, and production specialization.

The active grand strategy is not part of this city vector. It affects only code that explicitly calls `GetPersonalityAndGrandStrategy`, including force-target calculations and the offense value on operation and army requests. While custom flavors are active, that call returns the custom values without the grand-strategy modifier.

`CvCityStrategyAI::FlavorUpdate` sends the effective vector to `CvUnitProductionAI`. For each flavor, `AddFlavorWeights` compresses the signed city value, multiplies it by the unit's XML affinity for that flavor, and adds the result to the unit's base weight:

`base unit weight = sum of scaled city flavor × unit XML flavor affinity`

This gives every unit type a city-specific starting weight. Flavors decide relative preference; later checks decide whether current conditions make the unit useful and feasible.

### 2. Add ordinary candidates

The ordinary path examines every unit type the city can train. A military unit enters the initial list when its flavor-derived base weight is positive. It is not first reduced to a single recommended role or unit.

`CvUnitProductionAI::CheckUnitBuildSanity` then revises that base weight. The universal gates described in [production](production.md#candidate-contracts) apply first and can reject military candidates too. The military parts of the adjustment use:

- recommended land and naval sizes, including units already in production;
- current role counts and named need/enough flags, such as `MILITARYAISTRATEGY_NEED_SIEGE` and `MILITARYAISTRATEGY_ENOUGH_SIEGE`, with equivalent pairs for archers, mobile units, aircraft, and most naval roles;
- war domain, nearby threats, garrison need, air balance, and barbarian pressure;
- maintenance, strategic resources, naval access, deployment space, and city training value.

Most signals add or subtract weight. Some reject the candidate, such as reaching the recommended size for a supply-consuming land or naval force, lacking a required resource, or proposing a combat ship in a city without ocean access. A positive result becomes the candidate's output weight.

### 3. Calculate force targets

`CvMilitaryAI::SetRecommendedArmyNavySize` begins with the Economic AI soft supply cap. It reserves Economic AI's explorer need, then divides the remaining capacity between land and naval forces.

The split uses city and coastal-city counts, settlers needing protection, exposed cities, attack targets, and the current offense, defense, and naval flavors. Existing domain overages also shift the result. The offense and defense reads go through `GetPersonalityAndGrandStrategy`, with the custom-flavor behavior described in step 1.

The resulting land and naval values act as both caps and shortage signals. They do not allocate units to particular cities. Explorer production uses the explorer target as a positive shortfall weight, not as a hard cap; [civilian production](civilian-production.md) covers that path.

### 4. Add an operation-request candidate

An operation formation describes each required slot by a primary and secondary `UnitAI` role. It does not name a unit type. `CvPlayerAI::PeekAtNextUnitToBuildForOperationSlot` exposes the next required slot and its muster city.

The request applies to this city only when the city is that muster city and can reach the operation's landmass or ocean. `CvUnitProductionAI::RecommendUnit` then finds the highest-weighted trainable unit matching the primary role, or the secondary role when no primary match exists. This role-specific lookup includes construction time when choosing the concrete unit.

For example, a slot may request `UNITAI_RANGED` with `UNITAI_ATTACK` as its fallback. If the muster city can train several ranged units, `RecommendUnit` chooses the one with the strongest flavor-and-time score. That concrete type enters the candidate list again as an operation request, with the operation base weight, offense flavor, skipped-request pressure, and its ordinary unit weight.

The operation entry is a weighted request, not a reservation. It can lose the shared city comparison, and choosing it through this path does not commit the completed unit to that slot. `CvCity::CheckForOperationUnits` is the separate path that can explicitly commit city production.

### 5. Add an army-request candidate

`CvMilitaryAI::GetUnitTypeForArmy` scans required open slots across the player's armies. For each slot, it asks `RecommendUnit` for a trainable primary or secondary role match. It keeps a unit from the army with the fewest open slots, favoring forces that are closest to completion.

That concrete unit enters the initial list with the army base weight plus offense flavor. As the [candidate contracts](production.md#candidate-contracts) describe, it reaches the checked list only when the next operation slot also names this city as its muster city; otherwise it can win only through the all-failed fallback.

### 6. Produce the accepted list

The suitability pass returns either a positive revised weight or a non-positive skip reason. Positive ordinary, operation, and army entries form the military candidate output. The same concrete unit type can appear more than once with different sources and weights.

The city production layer then discounts every surviving buildable by construction time, sorts the common list, applies current-build inertia, and chooses from the leading band. See [production](production.md) for that interface.

## Feedback and boundaries

Units already being trained count toward land and naval force limits. Repeatedly skipping an operation request raises its later request weight. Completed units become available to organization, which can fill formation slots and change later demand.

Related systems produce different outputs:

- `CvCity::CheckForOperationUnits` can buy an operation unit or commit a city to train one.
- `CvMilitaryAI::MakeEmergencyPurchases` and `CvAIOperation::BuyFinalUnit` can buy the last missing formation unit.
- Tactical and Homeland AI use completed units, but do not produce city-build candidates.
- Army and operation state owns durable formation assignments. Military production only reads their open roles.

## Reading the implementation

Trace flavor weights through `CvCityStrategyAI::FlavorUpdate` and `CvUnitProductionAI::AddFlavorWeights`. Trace ordinary candidates through `CvCityStrategyAI::ChooseProduction` and `CvUnitProductionAI::CheckUnitBuildSanity`. Trace requested candidates through `CvCity::GetUnitForOperation`, `CvMilitaryAI::GetUnitTypeForArmy`, and `CvUnitProductionAI::RecommendUnit`.
