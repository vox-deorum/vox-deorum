# Unit AI: Military Campaign

**Military campaign** logic decides when an AI player creates a persistent military operation and maintains its strategic destination until success or abort. An **operation target** is that lasting destination. An **army goal** is the active movement waypoint, normally initialized and retargeted from the target. A **muster point** is the assembly plot selected for the army, often from a **muster city**, the city that supplies the assembly location. [Military organization](military-organization.md) owns recruitment and formation state; [military tactics](military-tactics.md) owns per-turn movement and combat.

The relevant code is in `civ5-dll/CvGameCoreDLL_Expansion2`, primarily `CvMilitaryAI.cpp`, `CvAIOperation.cpp`, `CvArmyAI.cpp`, `CvDiplomacyAI.cpp`, and `CvTacticalAnalysisMap.cpp`.

## Campaign families and triggers

`CvMilitaryAI::UpdateOperations` reviews wars, threatened cities, attack candidates, and available forces before unit movement. Each **operation family** has its own trigger and initial target and muster logic.

```mermaid
flowchart TD
    I[War intent, paths, reserves,<br/>threatened cities, nuclear units, carriers] --> F[Operation family]
    Z[Tactical-zone facts] --> F
    F --> O[Initialize operation]
    O --> T[Target and army goal]
    O --> M[Muster point]
```

| Family | Creation input | Initial target and muster |
| --- | --- | --- |
| City attack | Reachable scored enemy city with a land, naval, or combined approach | Land uses the selected city and muster city. Naval and combined use water plots beside the requested target and muster cities. |
| Pillage enemy | Wartime offensive request with sufficient available units | The best enemy border-zone city by worked luxury and strategic resources is the target. The nearest compatible friendly city supplies muster. |
| Rapid response | Threatened land city, or nearby enemy land force during defense review | At war declaration, the threatened city is the target. Later, the city owning the selected enemy plot supplies the target, and the army seeks a blocking position. |
| City defense | Threatened land city in an enemy-dominated tactical zone | The threatened city is the persistent target and initial destination. |
| Naval superiority | Threatened coastal city with a valid adjacent water plot | Nearby friendly coastal water is muster, and water beside the threatened city is the target. |
| Nuclear attack | Available nuclear unit and successful active-war launch decision | The highest-value eligible enemy city in range is the target. The selected unit's plot is muster. |
| Carrier group | Unassigned carrier that does not need healing | The nearest suitable deployment zone is preferred. Otherwise the carrier holds its current plot or adjacent coastal water when it begins in a city. |

### City attacks

`UpdateAttackTargets` rebuilds enemy-city candidates from land and water paths each Military AI turn. Each path compares land, naval, and combined approaches. The selected approach must be best among the three and score above 30. Candidate ranking includes distance, city value, conquest value, liberation value, and relevant city-state quests.

`CvDiplomacyAI::DoUpdateWarTargets` can request an attack while preparing war through `CIV_APPROACH_WAR`. In an existing war, `CvDiplomacyAI::DoUpdateWarStates` provides the per-enemy `WarStateTypes` value that gates attacks and defensive pullbacks. It evaluates war score, endangered and besieged cities, important-city damage, and tactical dominance. `RequestCityAttack` maps the selected approach to `CITY_ATTACK_LAND`, `CITY_ATTACK_NAVAL`, or `CITY_ATTACK_COMBINED`. Bullying uses the compatible land or naval city-attack operation.

### Specialized family selection

Nuclear evaluation excludes cities likely to fall or originally owned by the attacker, scores units and improvements in the blast radius, and reduces value in a friendly-dominated land or water zone. A carrier deployment zone is movable water beside an enemy zone that has a valid player move plot. Its water zone cannot be enemy-dominated, the adjacent enemy land zone cannot be friendly-dominated, and another carrier operation cannot already target it. Initial carrier selection ranks those zones by city-distance from home without testing a carrier path.

## Tactical-zone inputs

A **dominance zone** is a per-turn tactical region with territory and local strength data. Its **posture** chooses local combat behavior. Campaign logic reads zone facts only where family selection needs local threat, borders, target value, or deployment context. [Military tactics](military-tactics.md#dominance-zones) defines both concepts and their calculations.

| Zone fact | Campaign use |
| --- | --- |
| Enemy dominance at a threatened city | Requests city defense and can request naval superiority for a threatened coast. |
| Enemy-zone border | Limits pillage candidates to enemy cities whose land zone borders an attacker zone. |
| Friendly dominance | Reduces nuclear target value. |
| Neighboring enemy and water zones | Defines carrier deployment areas. |
| Local conditions, focus areas, and revealed foreign territory | Contribute to threatened-city ranking. |

`FLAVOR_USE_NUKE` directly changes the chance of an eligible nuclear request. `FLAVOR_NAVAL`, `FLAVOR_DEFENSE`, and `FLAVOR_OFFENSE` shape recommended force allocation. `FLAVOR_OFFENSE` also changes Tactical AI loss tolerance during combat simulation. Family selection and city-target scoring remain family-specific.

## Persistent target lifecycle

Initialization stores the target and muster point, then sets the army goal. Recruiting and gathering direct the army to the muster point. Moving directs it to its goal.

```mermaid
stateDiagram-v2
    [*] --> Recruiting
    Recruiting --> Gathering: enough formation strength
    Gathering --> Moving: within muster tolerance
    Moving --> SuccessfulFinish: deployment range reached
    Recruiting --> Aborted
    Gathering --> Aborted
    Moving --> Aborted
    Moving --> Moving: carrier retargets
    state "Successful finish, later cleanup releases members and marks deployment" as SuccessfulFinish
    state "Aborted, cleanup releases members" as Aborted
```

The diagram shows the standard lifecycle. An operation with no required open slots can begin moving immediately. Nuclear attacks complete from recruiting after firing, and carrier groups continue moving as their target changes.

Ordinary military operations complete when their center of mass reaches deployment range and their furthest member is within twice that range. While at peace, discovery by more than two enemy-visible members also completes the operation. Cleanup releases their units. Carrier groups continue indefinitely and remain active when they reach a deployment area so their target can change.

### Non-carrier retargeting

Target validation runs during operation checks, including before and after army movement. A replacement updates the target and army goal while preserving the muster point.

| Family | Validation and replacement |
| --- | --- |
| City attack | Keeps its city while unowned or owned by the intended enemy. Ownership loss aborts it. |
| City defense | Keeps its city while friendly. Ownership loss aborts it. |
| Nuclear attack | Keeps its city while enemy-owned. Ownership loss aborts it. |
| Pillage | Replaces the target with the best valid border-city resource target, or aborts when none exists. |
| Naval superiority | Uses the shortest valid water path among the three highest-ranked threatened coastal cities, or aborts when none exists. |
| Rapid response | Finds the strongest visible enemy land cluster near the homeland. It replaces a target more than five plots away and keeps the current target within five plots. |

Pillage and naval-superiority families accept a valid replacement immediately. Their retargeting has no score margin over the current target.

### Carrier retargeting

Carrier groups reconsider the target after reaching the moving stage. They rank suitable zones on the carrier's landmass by plot distance from its current position. When no zone is available there, they target friendly coastal water or abort when no fallback water exists. A carrier projected to die next turn aborts the operation, as does loss of the carrier's required slot.

## Abandonment and cleanup

An operation aborts for invalid targets, specified strategic cancellations, army-strength loss, lost path, or timeout. The timeout is more than 42 turns, except for carrier groups, which continue indefinitely.

| Event | Result |
| --- | --- |
| Member leaves during recruiting | Reopens its formation slot for recruitment or production. |
| Member leaves during gathering, moving, or at target | Aborts when filled slots fall below half the formation's original required slots, using integer division. A formation with two required slots aborts as soon as fewer than two remain. |
| Offensive maintenance | Removes badly hurt members and members whose newest checkpoint ETA fails to improve over the oldest value in a three-sample window. Resulting losses use the same strength check. |
| No step path | `CvTacticalAI::PlotArmyMovesCombat` sets `AI_ABORT_LOST_PATH` when `ComputeTargetPlotForThisTurn` yields no step path. |
| Blocked center of mass | `CvAIOperation::Move` writes a diagnostic warning when the center of mass fails to progress with sufficient variance. It does not itself abort the operation. |
| Strategic review | `UpdateOperations` cancels for forced peace, an unattacked opponent, a disappearing threatened-city list for a domain, or a war-state defensive pullback. |

A city-defense operation remains attached to its city after that city's tactical zone ceases to be enemy-dominated. It ends through target loss, member loss, timeout, or an applicable strategic rule.

## Implementation trace

1. `CvMilitaryAI::DoTurn` refreshes military counts, strategies, and war type, then runs `UpdateAttackTargets` and `UpdateOperations` before unit movement.
2. `CvDiplomacyAI::DoUpdateWarTargets` and `DoUpdateWarStates` provide war intent and per-enemy state.
3. `CvPlayer::UpdateCityThreatCriteria` ranks city threats from tactical dominance, borders, focus areas, and nearby enemies.
4. Family `Init` methods store target and muster data. Each family's `VerifyOrAdjustTarget` validates or replaces its target during operation checks.

For formation recruitment and membership, see [military organization](military-organization.md). For movement, local combat, and the Homeland handoff, see [military tactics](military-tactics.md).
