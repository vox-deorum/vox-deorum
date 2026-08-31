# Unit AI: Military Campaign

**Military campaign** logic decides when an AI player creates and maintains a persistent military operation. This page is the authority for its destination state:

| Term | Meaning |
| --- | --- |
| **Operation target** | The lasting campaign destination, usually a city plot or adjacent coastal water. |
| **Army goal** | The active movement waypoint. Initialization and retargeting normally set it from the target, though a family can use a deployment plot. |
| **Muster point** | The plot where the army assembles before moving to its goal. |
| **Muster city** | The associated city that supplies the muster point when the family uses a city source. |

The target and muster point are separate persistent values. Retargeting replaces the target and usually the army goal; it does not relocate the muster point. [Military organization](military-organization.md) owns formation slots, recruitment, stages, and release. [Military tactics](military-tactics.md) owns per-turn movement and combat.

The relevant code is in `civ5-dll/CvGameCoreDLL_Expansion2`, primarily `CvMilitaryAI.cpp`, `CvAIOperation.cpp`, `CvArmyAI.cpp`, `CvDiplomacyAI.cpp`, and `CvTacticalAnalysisMap.cpp`.

## Campaign families

`CvMilitaryAI::UpdateOperations` reviews wars, threatened cities, attack candidates, and available forces before unit movement. Each operation family supplies its own creation test and initial destination.

| Family | Creation input | Initial target and muster |
| --- | --- | --- |
| City attack | Reachable, scored enemy city with a land, naval, or combined approach. | The chosen path sets the city target and muster city. Naval and combined approaches use adjacent water plots. |
| Pillage enemy | Wartime offensive request with sufficient forces. | Best border-zone enemy city by worked luxury and strategic resources; compatible nearby friendly city for muster. |
| Rapid response | Threatened land city or a nearby enemy land force during defense review. | Threatened city at war declaration, otherwise the selected enemy plot; the army seeks a blocking position. |
| City defense | Threatened land city in an enemy-dominated tactical zone. | The threatened city is target and initial destination. |
| Naval superiority | Threatened coastal city with an adjacent reachable water plot. | Friendly coastal water for muster and water beside the threatened city for target. |
| Nuclear attack | Available nuclear unit and a successful launch decision. | Best eligible enemy city in range; the selected unit's plot is muster. |
| Carrier group | Unassigned carrier that does not need healing. | Suitable deployment zone, or its current plot or adjacent coastal water when it begins in a city. |

### City attacks and muster

`CvMilitaryAI::UpdateAttackTargets` rebuilds land and water paths to enemy cities each Military AI turn. It compares land, naval, and combined approaches. The best approach must score above 30. Its ranking includes distance, city and conquest value, liberation value, and relevant city-state quests. Diplomacy can request an attack while preparing for war, while war state gates attacks and defensive pullbacks during a war.

City attacks choose the muster city with the target. `GetArmyPathsFromCity` tests every own city as a path origin and `ScoreAttackTarget` chooses the best viable path. The muster city is therefore the best launching point for that target, not necessarily the nearest city.

Other families use the closest compatible friendly coastal city for naval work, the closest own city within target range for land work without a precomputed path, the target plot for rapid response, or the selected nuclear unit's plot. A naval city attack against a non-coastal target substitutes a compatible own-and-enemy coastal city pair. During recruitment and gathering, the muster point can move to the army's center of mass so late members head toward the assembled army. Only the city that owns the muster plot can accept the operation's production request. See [formation requests and commitments](military-production.md#formation-requests-and-commitments).

## Nuclear campaigns

Nuclear weapons use a specialized stockpile and launch decision. The `MILITARYAISTRATEGY_NEED_NUKE` [strategy flag](concepts.md#strategy-flags) keeps nuclear production attractive while stock is below the player's nuclear flavor target, except in no-nukes games. The Nuclear Gandhi override keeps the strategy active.

`CvMilitaryAI::DoNuke` considers war enemies. It can launch immediately when the AI is losing badly, and major civilizations can respond to a nuclear exchange. Otherwise a diplomacy flavor-based roll is available only when the enemy is threatening enough, relations are hostile, or victory pressure is high. City-states use only the losing-badly path.

A nuclear attack pairs owned nuclear units with enemy cities in range. It avoids cities about to fall and cities originally owned by the attacker, rewards enemy military and economic value, penalizes friendly and neutral collateral damage, and avoids repeat fallout. The best positive target becomes the operation target. The operation fires directly from recruiting: it clears movable friendly units from the blast radius, issues the nuclear mission, and completes. Nuclear units bypass Tactical recruitment and the [tactical simulation](military-tactical-simulation.md).

## Target lifecycle

Initialization stores the target and muster point, then sets the army goal. The army recruits and gathers at the muster point before moving toward its goal. [Military organization stages](military-organization.md#stages-and-recruitment) defines the common Recruiting, Gathering, and Moving stages, formation readiness, and member release.

Ordinary operations finish when their center of mass reaches deployment range and their furthest member is within twice that range. While at peace, discovery by more than two enemy-visible members also completes the operation. Carrier groups remain active at a deployment area so they can receive another target. Nuclear attacks complete when they fire.

### Retargeting

Target validation runs during operation checks, including before and after army movement. A valid replacement updates the target and army goal while preserving the muster point.

| Family | Validation and replacement |
| --- | --- |
| City attack | Keeps the city while it is unowned or belongs to the intended enemy; otherwise aborts. |
| City defense | Keeps the city while friendly; otherwise aborts. |
| Nuclear attack | Keeps the city while enemy-owned; otherwise aborts. |
| Pillage | Replaces the target with the best valid border-city resource target, or aborts. |
| Naval superiority | Uses the shortest valid water path among the three highest-ranked threatened coastal cities, or aborts. |
| Rapid response | Replaces a target more than five plots from the strongest visible enemy land cluster near the homeland. |
| Carrier group | Ranks suitable zones on the carrier's landmass, then falls back to friendly coastal water or aborts. |

Pillage and naval-superiority operations accept any valid replacement immediately. A carrier also aborts when it is projected to die next turn or loses its required formation slot.

## Abort and cleanup

An operation can abort for an invalid target, strategic cancellation, army-strength loss, a lost path, or timeout. The normal timeout is more than 42 turns; carrier groups continue indefinitely.

| Event | Result |
| --- | --- |
| Member leaves during recruiting | Reopens its formation slot for recruitment or production. |
| Member leaves after recruiting | Aborts when filled formation slots fall below half the formation's original required formation slots. |
| No step path | Combat army movement records `AI_ABORT_LOST_PATH`. |
| Strategic review | Cancels for forced peace, an unattacked opponent, a vanished threatened-city list for a domain, or a defensive war-state pullback. |

Cleanup releases members. A successful deployment also marks them for temporary reserve exclusion. A city-defense operation remains attached to its city after the tactical zone is no longer enemy-dominated; target loss, member loss, timeout, or a strategic rule ends it.

## Diagnostics

`CvMilitaryAI::DoTurn` refreshes military state and runs `UpdateAttackTargets` and `UpdateOperations` before unit movement. `CvDiplomacyAI` supplies war intent and state, and `CvPlayer::UpdateCityThreatCriteria` ranks city threats. Use `OperationalAILog.csv` with the shared [operation diagnostics](operation.md#diagnostics) to follow a target, retarget, abort, and cleanup.
