# Unit AI: Civilian Production

Civilian production turns role-owned demand into unit scores for one city. It does not maintain a general civilian quota. Each role keeps its own demand state, and the shared production comparison decides whether its candidate wins. See [flavors](overview.md#flavors) for the effective city preferences and [production](production.md#candidate-lifecycle) for the common comparison.

The relevant code lives in `civ5-dll/CvGameCoreDLL_Expansion2`, chiefly `CvUnitProductionAI.cpp`, `CvCityStrategyAI.cpp`, `CvEconomicAI.cpp`, `CvTradeClasses.cpp`, and `CvMilitaryAI.cpp`.

## Distributed demand

| Role | Demand owner and signal | Production effect |
| --- | --- | --- |
| Settler | Expansion flavor, Economic AI expansion state, city expansion state, and settle-plot quality | Scores viable expansion sites and accumulates pressure after a skipped available settler. |
| Worker | City improvement states and the empire's worker shortfall | Scores a city that needs terrain improvements. |
| Work boat | Safe, reachable unimproved owned resources | Scores only the nearby work still uncovered by boats. |
| Land explorer | Economic AI exploration assessment and Military AI's supply-aware recommendation | Scores a shortfall below the recommendation. |
| Trade unit | Trade AI's land or sea route-origin priority for the city | Scores the matching land or sea trade unit. |
| Messenger | Economic AI diplomatic-need state and valid city-state targets | Scores a useful diplomatic mission. |
| Archaeologist | Economic AI comparison of archaeological sites and available archaeologists | Scores active digs and culture value. |

The roles are independent. A shortage in one role does not establish a shared civilian target or directly suppress another role.

## Shared entry and safety rules

| Rule | Effect |
| --- | --- |
| Candidate entry | A city must be able to train the unit and it must have a positive flavor-derived base weight. [Production's candidate types](production.md#candidate-types) define the shared entry and comparison rules. |
| Puppet city | Rejects every non-purchase unit candidate. |
| Underdeveloped city | A city with fewer than two buildings rejects ordinary units, except while under siege. |
| Siege | Under siege, noncombat candidates are rejected. A combat-capable explorer can remain eligible, while an ordinary noncombat civilian cannot. |
| Weak force | Land and naval shortages raise combat-unit scores in the affected domain, making civilian candidates less competitive. |

These checks constrain production only. The role that owns demand keeps its state and reassesses it at later choices.

## Role scoring

### Settler

- Gates: Reject settlers when the city will grow within one turn, already has a settler on its tile, or uses `AICITYSTRATEGY_ENOUGH_SETTLERS`. Without Vox Deorum custom flavors, `ECONOMICAISTRATEGY_ENOUGH_EXPANSION` is also a gate.
- Scoring: Expansion flavor, early expansion, settle-plot quality, new-continent feeder status, traits, happiness, the capital's settler preference, and the settler skip counter adjust the score. With custom flavors, expansion flavor is a signed additive adjustment and bypasses the `ENOUGH_EXPANSION` gate.
- Boundary: `ECONOMICAISTRATEGY_FOUND_CITY` assigns work to settlers that already exist. It does not request a new settler. Each city choice increments the player-level settler skip counter once when it skips an available settler, and resets it when a settler starts or none is available.

### Worker

- Gates: A non-friendly tactical dominance zone, a worker already on the city tile, or `AICITYSTRATEGY_ENOUGH_TILE_IMPROVERS` rejects the candidate.
- Scoring: The empire compares workers, including those training, with cities needing terrain improvements plus one road-work allowance. `WANT_TILE_IMPROVERS` and `NEED_TILE_IMPROVERS` convert that shortfall into increasing bonuses.
- Boundary: Worker demand remains with the city improvement states and the empire work estimate.

### Work boat

- Gates: A non-friendly naval tactical dominance zone or no outstanding reachable work rejects the candidate.
- Scoring: Safe pathfinding finds owned, unimproved resources that need a work boat, then subtracts nearby work boats and boats already training. The remaining work scales the score with city population and era.
- Boundary: The demand covers only reachable resource improvements, not general naval capacity.

### Land explorer

- Gates: The Military AI recommendation counts explorers against shared unit supply. Once it is met, any further supply-consuming explorer is hard-rejected.
- Scoring: Economic AI estimates exploration need from unknown terrain, recon flavor, war, and travel capability. Military AI records the supply-aware recommendation, and production adds score only for the shortfall below it.
- Boundary: The siege rule rejects noncombat explorers, but a combat-capable explorer can remain eligible. Naval exploration is normally handled by reassigning eligible naval units. Its dedicated production adjustment is inactive in this baseline.

### Trade unit

- Gates: Cities of population four or less do not train trade units.
- Scoring: `CvTradeAI::GetPrioritizedTradeRoutes` records the city's land and sea route-origin priorities. Production applies the matching priority, with a war penalty and trait bonus.
- Boundary: Trade AI owns route opportunity; unit production only weighs the city's next trade-unit candidate.

### Messenger

- Gates: The player must know a valid city-state, the city cannot already host a messenger, and ordinary messenger production requires `ECONOMICAISTRATEGY_NEED_DIPLOMATS` or `ECONOMICAISTRATEGY_NEED_DIPLOMATS_CRITICAL`. The cap counts every `UNITAI_MESSENGER`, including units training.
- Scoring: Diplomatic need multiplies the influence supplied by promotions, with an additional paper-alliance bonus where applicable.
- Boundary: Great Diplomat roles use separate paths from ordinary `UNITAI_MESSENGER` production.

### Archaeologist

- Gates: For major civilizations, `ECONOMICAISTRATEGY_NEED_ARCHAEOLOGISTS` must be active. Minor civilizations bypass this role-specific gate.
- Scoring: For major civilizations, production strongly favors having no archaeologists, pursuing a culture victory, receiving tourism from digs, and gaining artifact yields.
- Boundary: Economic AI owns the major-civilization site-to-archaeologist comparison. Shared production gates still apply to minor civilizations.

## Boundaries

Some civilian units enter play without this production path:

- `CvReligionAI::DoFaithPurchases` selects and buys missionaries, inquisitors, and most religious units.
- Specialist progress, faith rules, free grants, and other direct rules create ordinary Great People.
- Buildings, policies, and trade-route rules can grant units directly.
- Player-level spaceship planning coordinates spaceship-part units.

A unit from one of these paths is an ordinary production candidate only when the city can train it. Its demand signal cannot make a purchase-only or granted unit trainable.

## Implementation trace

Follow the demand from its owner into `CvUnitProductionAI::CheckUnitBuildSanity`, then into the shared comparison in `CvCityStrategyAI::ChooseProduction`:

- `CvEconomicAI` and city strategy state supply settler, worker, explorer, messenger, and archaeologist demand.
- `CvTradeAI` supplies land and sea route-origin priorities.
- `CvMilitaryAI` supplies the explorer recommendation, force shortage context, and the settler skip counter.

For shared selection behavior, see [production](production.md#candidate-lifecycle). The [unit AI overview](overview.md#flavors) describes the effective flavor input and separates production from other acquisition paths.
