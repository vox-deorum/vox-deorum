# Unit AI: Military Tactics

**Military tactics** turns the visible map into this turn's military missions. It moves persistent-operation armies first, assigns local combat and support to **independent units**, then leaves eligible units for Homeland AI. An independent unit is a movable, unprocessed combat-capable unit with no Army ID.

This guide covers Tactical AI's turn order, priorities, and specialized moves. [Operation lifecycle](../operations/lifecycle.md) defines shared claims and the Tactical-to-Homeland handoff. [Campaigns](../operations/campaign.md) define targets, army goals, muster points, and muster cities; [organization](../operations/organization.md) defines formation slots, Army IDs, recruitment, and release; [stages](../operations/stages.md) describes each operation family's state sequence. [Shared concepts](../concepts.md#dominance-zones) defines dominance zones.

The relevant code is in `civ5-dll/CvGameCoreDLL_Expansion2`, primarily `CvTacticalAI.cpp`, `CvTacticalAnalysisMap.cpp`, `CvAIOperation.cpp`, `CvHomelandAI.cpp`, and `CvUnit.cpp`. Start at the [unit AI overview](../overview.md) for the surrounding systems.

| Guide | Responsibility |
| --- | --- |
| [Targets and postures](targets-and-postures.md) | Target collection, local combat policy, and zone order. |
| [Movement](movement.md) | Operation army movement and tactical reinforcement. |
| [Engagements](engagements.md) | When combat searches run, who joins, and garrison and opportunity searches. |
| [Air operations](air.md) | Aircraft ownership, conventional strikes, interception, patrol, and rebasing. |
| [Simulation](../simulation/overview.md) | Coordinated plans, scoring, acceptance, and replay. |
| [Pathfinding](../pathfinding.md) | Reachable plots, movement policy, and danger costs. |

## Tactical turn order

`CvTacticalAI::Update` refreshes visibility, focus areas, and [tactical targets](targets-and-postures.md#tactical-targets); recruits current-turn units; then processes army movement, zone combat, reinforcement, global priorities, and review. Eligible remaining units pass to Homeland AI.

## Independent units and priorities

Routine Tactical recruitment accepts movable, unprocessed combat, ranged, air, and combat-support units with no Army ID. It excludes delayed-death units, explorers, carrier-role ships, and nuclear-role units. Tactical AI does not process human units; Homeland AI handles automated human units.

| Priority | Main work |
| --- | --- |
| Global high | In order: heal frontline units, move operation armies, then [garrison work](engagements.md#garrisons) in threatened cities. |
| Zone combat | Emergency purchase, then posture-directed local work. |
| Reinforcement | Hold deferred garrisons, then [reinforce eligible city zones](movement.md#tactical-reinforcement) with remaining units. |
| Global middle | Air patrol, camps and goody huts, civilian attacks, bastions, safety, healing, pillage, trade plunder, and blockade. |
| Global low | Guard improvements, escort embarked units, and move exposed remaining units. |
| Review | Final safety move, then pass eligible units to Homeland AI. |

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

**Support units** are outside the main simulation. After combat planning succeeds, a second search can interleave Great General, Great Admiral, or siege-tower moves before each attack so the relevant aura is present. See [support placement](../simulation/overview.md#support-placement).

## Implementation trace

`CvTacticalAI::Update` refreshes targets and recruits units. `ProcessDominanceZones` runs army movement, postures, reinforcement, global priorities, and review. Operation `DoTurn` and `Move` record progress and stage transitions; assignment helpers issue unit missions; `CvHomelandAI` claims eligible leftovers. For cross-system logs, see [operation diagnostics](../operations/lifecycle.md#diagnostics).
