# Unit AI: Tactical Targets and Postures

Tactical AI collects plots worth acting on and chooses a **posture**, the local strategy for each [dominance zone](../concepts.md#dominance-zones). This guide follows target collection, posture selection, and zone ordering in `CvTacticalAI.cpp` and `CvTacticalAnalysisMap.cpp`, under `civ5-dll/CvGameCoreDLL_Expansion2`. See the [tactics overview](overview.md) for turn order.

## Tactical targets

A **tactical target** is a plot worth acting on this turn. `FindTacticalTargets` rebuilds the list once per turn, before units are recruited, by scanning every plot the player has revealed. Each target records its type, its dominance zone, and a **target score** that sets its place in the list. Zone passes act on the targets near one zone, and global passes sweep one type across the whole map.

| Target | When it is listed | Target score |
| --- | --- | --- |
| Enemy city | A city of a team we are at war with. | 100, or 20 for barbarians |
| Enemy combat unit | The enemy defender on a plot without a city, visible now or remembered from last turn. Minor civs list barbarians only next to their territory. | 50, adjusted below |
| Enemy civilian | An unprotected enemy civilian, classed as high or low priority. | 25 |
| Barbarian camp, goody hut | A revealed, unowned camp (major civs and barbarians), or a revealed goody hut (not minor civs). | 100 if visible, otherwise 50, minus the path distance to our nearest city |
| Citadel, improvement, resource | An unpillaged improvement on a plot of a team we are at war with, or a city-connection route there outside enemy-dominated zones. | 5 to 100 by kind |
| Trade unit | A visible enemy trade unit. | 35 |
| Blockade point | Enemy water within three plots of an enemy city, where no enemy can attack. Only the best ten are kept, plus any on improved plots. | Blockade score |
| Friendly city | One of our cities with a positive land or sea border score. | Border score |
| Bastion, improvement to defend | Strong or choke-point land on our border, and strategic resource improvements of our border cities. | Terrain defense (tripled at a choke point), or 1 |

The list is then ordered:

1. Each enemy unit target gains 1 for every friendly combat unit within three plots in its domain, and 5 minus its distance to our nearest city when that is positive.
2. All targets are sorted by target score, highest first. Equal scores keep map scan order, which follows plot index.
3. Walking the sorted list, an enemy unit target is dropped when an enemy unit target already kept in the same domain, with an equal or higher score, lies within two plots. Targets within three plots of one of our cities are never dropped. A search around the kept target already covers its neighbors.

Enemy unit targets score only a little above 50, so map order often decides which of them comes first. The score does not consider a target's health, its value, or the damage our units could deal to it.

### Zone targets

Before a zone's posture routine runs, `ExtractTargetsForZone` keeps the targets valid for the zone's domain that lie in the zone or within five plots of its center, in list order. A target near a zone border can therefore belong to several zones. Global passes extract every target.

Posture routines walk this list one target type at a time, so enemy units and cities never compete in one order: the posture decides which type goes first. Each attempt records an aggression level on the target, whether or not an attack happens, and the walk skips a target already tried at the requested level or higher. A unit attempt records the level it searched at, so a unit target shared by two zones is retried only at a higher level. A city attempt always records High, even when its search runs at Medium, so each city is tried once per turn.

## Postures and local combat

Tactical AI refreshes a **posture**, a current-turn strategy for each dominance zone, then processes zones in [zone order](#zone-order). Territory, overall and ranged dominance, melee balance, and city danger choose the posture; water zones use naval strengths. After extracting the [zone's targets](#zone-targets), `ProcessDominanceZones` dispatches the posture routine that selects the local work and aggression passed to the [tactical simulation](../simulation/overview.md#entry-points-and-aggression).

| Territory | Dominance and local condition | Posture |
| --- | --- | --- |
| Wilderness | Any | Exploit flanks |
| Enemy | City in danger of falling | Surgical city strike |
| Enemy | Enemy dominant, or ranged-heavy force facing much stronger enemy melee | Withdraw |
| Enemy | Friendly dominant | Steamroll |
| Enemy | Even, friendly ranged dominant, enemy melee stronger | Attrition |
| Enemy | Even, friendly ranged dominant, enemy melee no stronger | Steamroll |
| Enemy | Even, without friendly ranged dominance | Exploit flanks |
| Enemy | Other, such as no units visible | Attrition |
| Neutral | Enemy dominant with friendly ranged dominance | Attrition or exploit flanks according to enemy melee strength |
| Neutral | Enemy dominant without friendly ranged dominance | Withdraw |
| Neutral | Other | Attrition with friendly ranged dominance, otherwise exploit flanks |
| Friendly | Enemy dominant | Hedgehog |
| Friendly | Other | Counterattack |

| Zone posture | C++ routine | Behavior | Simulation and aggression |
| --- | --- | --- | --- |
| None | No routine | Do no posture-specific work. | None |
| Withdraw | `PlotWithdrawMoves` → `ExecuteWithdrawMoves` | Retreat the zone's units toward a safer city zone, as described in [tactical withdrawal](movement.md#tactical-withdrawal). | No posture attack and no search; the ranged opportunity shot after a withdrawal uses Low when simulated. |
| Hedgehog | `PlotHedgehogMoves` | Attack enemy units, then call `PlotReinforcementMoves` for early reinforcement before attacks in other zones. | Low |
| Attrition | `PlotAttritionAttacks` | Attack enemy unit targets in target order. No city capture. | Low |
| Exploit flanks | `PlotExploitFlanksMoves` | Search around each enemy unit target, then try city capture with the units still available. | Unit attacks: Medium. City capture: melee-count rule. |
| Counterattack | `PlotCounterattackMoves` | Attack enemy unit targets in target order. | Medium |
| Surgical city strike | `PlotSurgicalCityStrikeMoves` | Try city capture first, then search around each enemy unit target with the units still available. | City capture: melee-count rule. Unit attacks: Medium. |
| Steamroll | `PlotSteamrollMoves` | Search around each enemy unit target, then try city capture with the units still available. | Unit attacks: High. City capture: melee-count rule. |

Each step is a separate search around its own target plot, taken in [target order](#zone-targets). Units that remain movable and unprocessed can join later steps, including after partial use. A unit target can also be settled by city fire alone before any search runs. The search can attack any enemy in its area, cities included, so the order decides which target gets first claim on units, not which damage is valued. The city-capture rule is independent of posture: `ExecuteCaptureCityMoves` uses Medium with up to two non-ranged recruits and High with more. Civilian support units, such as Great Generals on field command, count toward that number.

Nearby army members affect the friendly strength used to calculate a zone's posture, and the zone attack and city capture paths never recruit them. Reinforcement positioning, including Hedgehog's early call, does not check Army IDs, so it can move an army member that operation movement left unprocessed. Otherwise the operation's goal controls army movement, and zone dominance affects an army only through the [army contact](engagements.md#army-contact) veto.

Neighboring zones can refine the posture of a zone with a city after it is chosen:

- A naval Steamroll zone becomes Exploit flanks when a neighboring land zone is enemy-dominated and has more ranged strength than our ships.
- A zone outside friendly territory becomes Withdraw when a neighbor in the same domain is our territory, is enemy-dominated, and has no city in danger of falling.

### Zone order

Zones run from highest to lowest **zone value**, computed by `PrioritizeZones` in `CvTacticalAnalysisMap.cpp` as a base value times a multiplier.

First find the largest city economic value across all dominance zones, using at least 1. Each zone starts with a base of 1. When it has a city with access to the zone's area, apply these city adjustments in order:

1. Add `floor(sqrt(max(0, 100 * city economic value / largest city value)))`. The ratio uses floating-point division; negative economic value adds zero.
2. Multiply by 3 when the city is in a focus area.
3. Multiply by 2 when the city is visible. For a visible damaged city, also apply the damage factor below.
4. Multiply by 2 once when the city is an operation target or a [preferred attack target](../operations/campaign.md#attack-targets).
5. Reset the base to 1 for a city-state whose ally we are at war with.

The **damage share** is the city's damage divided by its maximum HP. The exact damage factor includes an extra point before division: if `damage > floor(maxHP / 10)`, multiply by `floor((damage + 1) * 10 / maxHP)`. Both divisions here use integer arithmetic, so retain the addition and rounding order when reproducing the score.

After the city adjustments, multiply every land zone's base by 3, including a base reset to 1. Then choose the dominance multiplier:

| Dominance | Our territory | Enemy territory | Other territory |
| --- | --- | --- | --- |
| Enemy | 8 | 1 | 1 |
| Even, with more than one enemy unit | 4 | 4 | 1 |
| Friendly | 1 | 8 | 1 |
| Other | 1 | 1 | 1 |

For a major civilization, multiply that multiplier by 4 in enemy territory while [winning all wars](../concepts.md#war-states), or in our territory while losing all wars. The final zone value is the adjusted base times this multiplier.

For example, consider a visible land city with economic value 25, a largest zone-city value of 100, and 100 damage out of 200 HP. It has area access and no focus, target, or city-state adjustment:

| Stage | Running value |
| --- | --- |
| Economic value | `1 + floor(sqrt(25)) = 6` |
| Visible city | `6 * 2 = 12` |
| Damage factor | `floor(101 * 10 / 200) = 5`, so `12 * 5 = 60` |
| Land zone | `60 * 3 = 180` |
| Enemy dominance in our territory, with neutral aggregate war state | `180 * 8 = 1,440` |
