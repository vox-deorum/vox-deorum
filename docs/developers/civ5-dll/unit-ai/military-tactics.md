# Unit AI: Military Tactics

**Military tactics** turns the visible map into this turn's military missions. It moves persistent-operation armies first, assigns local combat and support to **independent units**, then leaves eligible units for Homeland AI. An independent unit is a movable, unprocessed combat-capable unit with no Army ID.

This page owns Tactical AI's turn order, postures, priorities, and specialized moves. [Operation lifecycle](operation.md#operation-lifecycle) defines shared claims and Tactical-to-Homeland handoff. [Military campaign](military-campaign.md) defines targets, army goals, muster points, and muster cities; [military organization](military-organization.md) defines formation slots, Army IDs, recruitment, stages, and release. [Shared concepts](concepts.md#dominance-zones) defines dominance zones. Coordinated combat search and pathfinding policy are in [military tactical simulation](military-tactical-simulation.md).

The relevant code is in `civ5-dll/CvGameCoreDLL_Expansion2`, primarily `CvTacticalAI.cpp`, `CvTacticalAnalysisMap.cpp`, `CvAIOperation.cpp`, `CvHomelandAI.cpp`, and `CvUnit.cpp`.

## Tactical turn order

`CvTacticalAI::Update` refreshes visibility, tactical targets, and focus areas; recruits current-turn units; then processes army movement, zone combat, reinforcement, global priorities, and review. Eligible remaining units pass to Homeland AI.

A **tactical target** is a plot worth acting on this turn. Its recorded type and dominance zone let zone passes select local targets while global passes sweep a type across the map.

| Tactical-target type | Examples |
| --- | --- |
| Enemy | City, combat unit, civilian, trade unit, citadel, or blockade point. |
| Opportunity | Barbarian camp, goody hut, improvement, or resource improvement to pillage. |
| Friendly | City, defensive bastion, or improvement to hold or defend. |

## Operation army movement

`PlotOperationalArmyMoves` calls each persistent operation's `DoTurn`. Land, naval, and combined armies use `PlotArmyMovesCombat`; escorted civilian armies use the escort path. Recruiting and gathering armies move around their muster point, while moving armies follow their army goal.

When combat army movement cannot find a step path, it records `AI_ABORT_LOST_PATH`. Nearby enemies can hold an army at its center of mass while healthy members take an opportunity fight with suitable nearby friendly attackers, including members of another army. Contact and formation moves use reachable-plot and danger checks. A hostile local zone can therefore reject an unsafe fight.

## Postures and local combat

Tactical AI refreshes a **posture**, a current-turn strategy for each dominance zone, then processes zones from highest to lowest value. Territory, overall and ranged dominance, melee balance, and city danger choose the posture; water zones use naval strengths. The posture selects the local work and aggression passed to the [tactical simulation](military-tactical-simulation.md#entry-points-and-aggression).

| Territory | Dominance and local condition | Posture |
| --- | --- | --- |
| Wilderness | Any | Exploit flanks |
| Enemy | City in danger of falling | Surgical city strike |
| Enemy | Enemy dominant, or ranged-heavy force facing much stronger enemy melee | Withdraw |
| Enemy | Friendly dominant | Steamroll |
| Enemy | Even, friendly ranged dominant, enemy melee stronger | Attrition |
| Enemy | Even, friendly ranged dominant, enemy melee no stronger | Steamroll |
| Enemy | Other | Attrition or exploit flanks according to ranged dominance |
| Neutral | Enemy dominant with friendly ranged dominance | Attrition or exploit flanks according to enemy melee strength |
| Neutral | Enemy dominant without friendly ranged dominance | Withdraw |
| Neutral | Other | Attrition with friendly ranged dominance, otherwise exploit flanks |
| Friendly | Enemy dominant | Hedgehog |
| Friendly | Other | Counterattack |

| Posture | Zone behavior | Aggression |
| --- | --- | --- |
| Withdraw | Retreat toward the safest neighboring zone; ranged units may take an opportunity shot afterward. | No posture attack; a simulated ranged opportunity uses Low. |
| Hedgehog | Attack units and pull reinforcements before the normal pass. | Low |
| Attrition | Attack units. | Low |
| Exploit flanks | Attack units, then capture an undefended city when available. | Medium |
| Counterattack | Attack units. | Medium |
| Surgical city strike | Capture cities before attacking remaining units. | Medium |
| Steamroll | Attack units, then capture cities. | High |

Nearby army members contribute to the zone strength assessment but do not inherit its posture. Positioning around the operation's current target uses low aggression, while nearby-enemy contact fights use medium. The operation's goal takes precedence over a conflicting zone posture: army members are absent from the independent-unit pool, operation movement runs before zone processing, and operation abort rules do not use zone dominance. Neighboring zones can still refine a posture. Examples include naval steamroll near a stronger enemy land zone and withdrawal outside friendly territory near an enemy-dominated zone in the same domain.

## Independent units and priorities

Routine Tactical recruitment accepts movable, unprocessed combat, ranged, air, and combat-support units with no Army ID. It excludes delayed-death units, explorers, carrier-role ships, and nuclear-role units. Tactical AI does not process human units; Homeland AI handles automated human units.

| Priority | Main work |
| --- | --- |
| Global high | Heal frontline units, move operation armies, urgent garrisons, and sorties. |
| Zone combat | Emergency purchase, then posture-directed local work. |
| Reinforcement | Move suitable independent units toward zones needing strength. |
| Global middle | Air patrol, camps and goody huts, civilian attacks, bastions, safety, healing, pillage, trade plunder, and blockade. |
| Global low | Guard improvements, escort embarked units, and move exposed remaining units. |
| Review | Final safety move, then pass eligible units to Homeland AI. |

Zone value prioritizes city importance and urgency: focus-area cities, damaged visible cities, operation or preferred targets, land zones, and dominance that threatens friendly or enemy territory raise the value. War state can further prioritize friendly territory while losing or enemy territory while winning. A city-state enemy resets city-based factors. Barbarians skip zone processing and use their own ladder.

## Air operations

`CvTacticalAI::ShouldRebase` decides ownership of air units. Tactical AI recruits combat-ready aircraft when the answer is no; Homeland AI handles aircraft that need rebasing. A base is unsuitable when its city is in danger of falling, its carrier is likely to die, or the unit needs to heal while the base is threatened. Aircraft also rebase when they have no suitable target, including all aircraft at peace.

Tactical air units join zone combat. Air sweeps clear interceptors and air strikes fire before ground attacks; an air kill ends the ground attack. Missiles value defender damage and kills but never strike an ungarrisoned city. Bombers and fighters value damage, distance, expected defensive damage, and interception risk. Fighters without another Tactical task patrol home bases.

Homeland AI scores cities and carriers as air bases, excluding unsafe or unsuitable cities. Healing aircraft choose the quietest usable base; combat-ready aircraft choose a strong base with a balanced fighter and bomber mix. A distant base is reached one rebase leg per turn.

## Barbarian priorities

Barbarians skip dominance zones and process one global target list through this priority ladder.

| Priority | Work |
| --- | --- |
| 1 | Camp defense: garrison and hold every camp. |
| 2 | Theft from an adjacent city, or takeover of a weakened city-state. |
| 3 | Unit attacks through the tactical simulation at braveheart aggression, then vulnerable-city capture. |
| 4 | Civilian attacks. |
| 5 | Immediate pillage: improved resources first, then other improvements. |
| 6 | Trade-route plunder, land then sea. |
| 7 | Roaming toward the best target in range. |
| 8 | Safety: a barbarian that reaches this pass did not attack, so it flees. |

A camp defender stays assigned. Ranged defenders fire from camp; melee defenders act only when they can return in the same turn. An empty camp recalls the nearest available land unit within five turns. Roaming range follows the game handicap's land and sea target ranges. Land units can enter an undefended civilian or improvement to pillage but do not linger beside combat targets; sea units do not pillage. Captured civilians return toward a camp.

## Specialized execution

**Amphibious landings** run after city capture for embarked units still near the target. `ExecuteLandingOperation` greedily assigns units to reachable coastal plots, favoring survivable plots close to the target, ranged hills, legal landmass access, positive attacks, and clustered landings. This is not a simulated position search.

**Paradrops** are opportunistic. During immediate pillage, paratroopers in range are tried before ground units against enemy citadels and improved resources. No other pass plans a drop, so drops never enter the tactical simulation.

**Support units** are outside the main simulation. After combat planning succeeds, a second search can interleave Great General, Great Admiral, or siege-tower moves before each attack so the relevant aura is present. See [support placement](military-tactical-simulation.md#support-placement).

## Homeland handoff

Tactical AI retains a unit only while a later pass can use it. Homeland AI receives a movable, unprocessed military unit with no Army ID.

| Homeland pass | Remaining military work |
| --- | --- |
| Conservative heal | Preserve wounded units before routine positioning. |
| Aircraft rebase | Move aircraft to a suitable city or carrier. |
| Safety | Move exposed units from danger after civilian role passes. |
| Upgrade and opportunity attack | Upgrade eligible units or take a safe local attack without leaving an essential garrison. |
| Garrison, heal, sentry, and patrol | Fill city needs and position remaining land and naval units. |
| Final review | Continue a valid mission or move idle units toward friendly cities or water. |

The Army ID condition governs routine Homeland recruitment. The upgrade pass is the exception: it temporarily removes an army member, upgrades it, then restores the replacement to its formation slot. [Military organization](military-organization.md#membership-and-release) documents the membership changes.

## Implementation trace

`CvTacticalAI::Update` refreshes targets and recruits units. `ProcessDominanceZones` runs army movement, postures, reinforcement, global priorities, and review. Operation `DoTurn` and `Move` record progress and stage transitions; assignment helpers issue unit missions; `CvHomelandAI` claims eligible leftovers. For cross-system logs, see [operation diagnostics](operation.md#diagnostics).
