# Unit AI: Command Recruitment

The [command loop](overview.md) estimates available forces before checking paths or issuing orders. This page defines the **local set** of nearby units, strength tallies and the incoming selection used by [reinforcement priorities](reinforcement.md). Fight checks and execution recruit the units that can act now, as described under [readiness and execution](execution.md).

The implementation is in `civ5-dll/CvGameCoreDLL_Expansion2/CvTacticalOperationalLoop.cpp`, primarily `GatherLocalSet`, `GatherReinforceCandidates` and `SelectReinforcement`.

## Battlefield estimate

`EstimateBattlefield` gathers the local set and tallies local and enemy strength once per battlefield, computes the theater and stake, and emits both offers from the same values:

1. **Scan.** Gather the battlefield's local set and both strength tallies.
2. **Fight.** `EstimateFight` computes the stake and the fight priority. At an enemy city it simulates the local attackers; at our city it uses the loop's copy of native city danger (`GetCityDangerByThreat`) at the [enemy roll](value.md#damage-rolls).
3. **Reinforce.** `EstimateReinforce` selects from the units beyond the local set and scores the share of the fight priority their help swings.

Step 2 still runs after the fight has executed, because an open Reinforce needs its baseline. Step 3 is skipped when the Reinforce offer is executed or retired, and it skips the roster when a [reinforcement gate](reinforcement.md#reinforce-priority) closes the offer.

Each estimate pass handles city battlefields first, then unit battlefields. A city battlefield whose fight and Reinforce offers are both closed still refreshes its theater, because unit fights in its zone read it; there is no stake to compute.

The **local set** holds our units near enough to count in estimates at the center. Its strength filter includes units that have already acted; its damage filter keeps available attackers. It uses plain plot distance and needs no pathfinding:

- Land and sea combat units within their **strike reach**: base moves, at least 1, plus range for a ranged unit. Melee units must be in the battlefield's **domains**; ranged units of either domain qualify.
- Aircraft whose range reaches the center from their base.

Strike reach uses `max(1, base moves) + ranged attack range`; a melee unit adds no range. Native **striking distance**, used for offensive recruitment and enemy-target wake checks, is the broader `base moves × 4` scan.

The domains follow the center. A city takes land units, and sea units too when it is coastal. A unit target takes the domain of its plot. Domains limit melee units and the strength filter. A ranged unit can shoot across domains, as native recruitment allows, so a land archer within reach of an enemy ship joins the damage filter without counting toward `L`. A melee land unit beside a water target and a melee ship near an inland target stay out of the local set. Reinforce candidates use the same domains.

Two filters read the local set:

| Filter | Keeps | Feeds |
| --- | --- | --- |
| **Strength filter** | Land and sea units in the battlefield's domains, including spent units and army members. Aircraft and ranged units of the other domain are left out. | `L` (local friendly strength) in the [own-city](value.md#own-city-stake) and [Reinforce](#strength-tallies) tallies. |
| **Damage filter** | Units on the tactical roster that can still attack, including aircraft and ranged units of either domain, and that pass the recruitment filters of `FindUnitsWithinStrikingDistance` needing no pathfinding: usable by the tactical AI now, not covering a civilian and not a fighter kept for interception. Embarked units are left out. At a city, `CanStrikeCity` also drops units barred from capturing and ranged units whose expected damage misses native's minimum. Readiness can therefore recruit every unit the estimate counts. | [Local damage](value.md#city-allowance-and-fall-share) at an enemy city and its local capturer test, and [local damage on a unit](value.md#destroyed-value) target. |

A land or sea unit in those domains beyond its strike reach can qualify as incoming under the [candidate filters](#candidates-and-selection). The local and incoming sets do not overlap. Units failing eligibility or distance filters can belong to neither. [City defense](execution.md#city-defense) recruits its defenders by the same strike reach.

**Strike reach example.** Assume the units pass their other recruitment filters. An archer with 2 moves and range 2 stands 4 plots from an enemy city. It is local, and its shot counts toward local damage. A swordsman with 2 moves stands 3 plots away. It is incoming, and only Reinforce can count it. If the target is instead an enemy ship 4 plots away, the archer still deals local damage, but it adds nothing to `L` and cannot be a Reinforce candidate there. The same archer 4 plots from our own city is a defender in that city's fight; at 5 plots it is a Reinforce candidate.

## Strength tallies

**Strength** starts with native combat strength, which native methods already return at 100 times the displayed scale. The loop then multiplies it by remaining health share, on top of native's existing damage modifier. This applies both reductions to wounded units. Pressure and the parity gate use ratios, so the examples can use convenient strengths such as 100 and 50.

| Source | Native estimate |
| --- | --- |
| Unit | `UnitStrength`: maximum attack strength, or ranged strength for a ranged unit, from the quick estimate without adjacency. |
| Enemy unit against our city | `UnitStrengthAgainstCity`: quick attack or ranged strength against the city plot, keeping city and terrain modifiers. |
| City | `CityStrength`: the city's strength value, which already counts its garrison. |

| Tally | Rule |
| --- | --- |
| `L` (local friendly strength) | `LocalStrength`: the [strength filter](#battlefield-estimate) of the local set, which holds our combat units in the destination's domains within strike reach, including spent units and army members. At our city, `LocalCityStrength` adds the city's own strength. |
| `T` (enemy strength) at our city | The tally recorded by the own-city estimate: the city's approach list (hostiles assigned to this city) plus visible units that native danger identifies as able to attack the city plot, each counted once. Counted units are recorded for retirement. |
| `T` (enemy strength) at an enemy center | `EnemyCenterStrength` counts visible hostile non-air combat units within 4 plots in the destination's domains (land or sea), plus hostile cities within 4 plots. City strength is multiplied by remaining health share, counting at least 1 HP. A counted city's strength already includes its garrison, which is excluded from the unit tally. Counted units and cities are recorded for retirement. |

## City approach lists

`BuildThreats` rebuilds **approach lists** (hostile units assigned to the city they are approaching) after every command. Each visible hostile land or sea combat unit is assigned to our nearest city by path steps, using `GetClosestCityByPathLength`. It qualifies when the path is at most twice its base moves plus its range, or plus 1 for melee. Hidden units, such as undetected submarines, are excluded.

The native city-path cache routes around impassable plots and may embark, but ignores movement costs and intervening units. It can therefore exclude a knight 2 plots away behind mountains while including a spearman whose actual journey takes longer. Only major civilizations have this cache; city-states use plain plot distance to their nearest city. A unit that can directly attack a city also counts for that city, even when assigned to a nearer one.

## City defense recruits

`GatherCityEndangered` reads the turn's [endangered-unit list](value.md#exposure); `GatherCityDefenders` adds other eligible defenders. The full [city-defense recruitment table](execution.md#city-defense) defines both groups, including garrisons, aircraft and carriers. Endangered recruits contribute [defensive exposure](value.md#own-city-stake) even when the city itself faces no damage.

## Candidates and selection

`GatherReinforceCandidates` reads the tactical roster and keeps combat units the tactical AI can use now, outside armies and in the destination's domains (land or sea). Generals, admirals and civilian sappers fail the combat test. Candidates must be outside the [local set](#battlefield-estimate), beyond their strike reach by plain plot distance, but within `GetRecruitRange()` (native recruitment range).

A **held garrison** (a garrison left unprocessed by the high-priority pass) qualifies only within 4 plots by plain distance, using `TACTICAL_COMBAT_MAX_TARGET_DISTANCE` (maximum target distance for search). It joins search but takes no path move, so readiness must confirm that the search can reach it. A unit rejected by this offer's reach check remains excluded from this offer for the rest of the turn. Other battlefields can still select it.

The remaining candidate filters follow native behavior:

- Exclude carriers.
- At an enemy city, keep only units that pass `CanStrikeCity`: it excludes units barred from capturing and requires a ranged unit to meet native's minimum expected damage against the city. Our own cities have no such filter.
- Exclude siege units entering an enemy-dominated zone at an enemy center. Our own cities have no dominance gate.
- Exclude units that should heal given the destination's territory.
- Preserve donor-zone safety, which keeps units in zones that need them.

Travel time is a distance estimate used to discount incoming help:

| Quantity | Calculation | Example: 2 base moves |
| --- | --- | --- |
| Travel turns | `ceil(plot distance / max(1, base moves))`, at least 1. | Distance 4 gives 2 turns; distance 5 gives 3. |
| Join turns `j` | `max(1, travel turns − 1)`. | Travel 2 gives join 1; travel 3 gives join 2. |
| Discounted help | Unit strength divided by `j`. | Strength 100 gives help 100 at join 1, or 50 at join 2. |

`IsCapturer` identifies a land melee combat unit outside armies that may capture, whether or not it can act now.

`SelectReinforcement` computes the additional strength needed: `need = max(0, r × T − L)`. Here `r` is the desired friendly/enemy strength ratio, default 1; `T` is enemy strength and `L` is local friendly strength. It sorts candidates by join turns, then travel turns, then unit ID, and selects until their **full strength** meets need. The score uses **discounted help** instead. There is no two-unit minimum.

At an enemy city, selection then adds the **role unit**: if neither a local nor a selected unit can capture, the nearest remaining capturer joins as the extra unit needed for capture. Its discounted strength counts in help like any other selected unit. If no capturer is available, the selection records a missing capture role.

Compared with native `CvTacticalAI::PlotReinforcementMoves`, selection is per battlefield, combining land and sea units at a coastal city. The capture role replaces native's melee-only mode. Units covering civilians are excluded without native's skip and processing side effect. Other differences follow the selection and readiness rules above.
