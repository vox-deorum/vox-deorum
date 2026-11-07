# Unit AI: Tactical Movement

Tactical AI moves operation armies and redistributes available units around city zones. Both paths use `PositionUnitsAroundTarget` in `civ5-dll/CvGameCoreDLL_Expansion2/CvTacticalAI.cpp`. See the [tactics overview](overview.md) for their place in the turn and [operation stages](../operations/stages.md) for persistent army progress.

## Operation army movement

`PlotOperationalArmyMoves` calls each persistent operation's `DoTurn` during the global high-priority pass of `ProcessDominanceZones`, after frontline healing and before garrison work and the per-zone posture loop. Land, naval, and combined armies use `PlotArmyMovesCombat`; escorted civilian armies use the escort path. Recruiting and gathering armies move around their muster point, while moving armies follow their army goal.

Operation state and the current turn target control army behavior; [zone posture](targets-and-postures.md#postures-and-local-combat) controls independent-unit behavior. The table below records the routine, behavior, and simulation aggression for army movement. `PositionUnitsAroundTarget` is also used by non-army positioning passes.

| Army phase or condition | C++ routine | Behavior | Simulation and aggression |
| --- | --- | --- | --- |
| No reachable step path | `PlotArmyMovesCombat` | Record `AI_ABORT_LOST_PATH` for the operation. | None |
| Enemy units can attack the army | `CheckForEnemiesNearArmy`, called by `PlotArmyMovesCombat` | Fight with the army and nearby friendly attackers, as described in [army contact](engagements.md#army-contact). A fight holds the army at its center of mass this turn; a vetoed fight lets the operation continue. | Medium |
| Gather, advance, or hold formation | `ExecuteGatherMoves` → `PositionUnitsAroundTarget` | Move formation members toward the muster point, operation target, or current turn target, subject to reachable-plot and danger checks. | Initial simulation: Low. Subsequent positioning does not simulate. |
| Unprocessed army member still in danger | `PositionUnitsAroundTarget` | Try to move the member to a safe healing plot or, failing that, the safest reachable plot. Finish its turn. | No new combat simulation |
| Pre-move army maintenance | `CvArmyAI::UpdateCheckpointTurnsAndRemoveBadUnits` | Release members that are unfit to continue before moving the army. | None |
| Escort replacement | `SwitchEscort` | Temporarily swap a blocked escort for a suitable nearby defender. | None |

`CvArmyAI::RemoveUnit` can return a surviving, movable member to the current-turn independent-unit pool. It receives posture work only if its zone has not already been processed. [Military organization](../operations/organization.md#membership-and-release) lists the removal triggers and operation effects.

## Tactical reinforcement

`PlotReinforcementMoves` redistributes available units around a zone's city. `ProcessDominanceZones` calls it for every zone after all posture attacks and deferred garrison work, before global middle-priority moves. Hedgehog also calls it immediately after its own attacks, so it can claim units before later zones fight and before deferred garrisons are held. That zone is considered again in the regular reinforcement pass. Coastal cities have separate land and water zone calls.

The destination must have a city and must not be withdrawing. A city belonging to another team needs enemies in its zone. A zone already dominant in both overall and ranged strength is skipped unless it lacks melee strength, in which case ranged recruits are excluded. An enemy-dominated zone also needs a neighboring zone owned by the player.

Recruitment scans plots using the city's mixed-army pathfinder and `GetRecruitRange` limit, including units already in the destination zone. This scan permits unrevealed plots and foreign territory; individual movement paths are checked later. Recruits must pass the normal Tactical eligibility checks and match the zone's land or sea domain. It generally leaves units in other contested zones, with exceptions for withdrawing zones, embarked units, and land units in cities that are not in danger of falling. It also excludes units needing healing, Great Generals and Admirals, civilian sappers, siege units entering enemy-dominated zones, and units with attack targets more than four plots from the destination city. A unit covering a friendly civilian stays and is processed. Reinforcement proceeds only when the zone's existing units plus incoming recruits total at least two.

This plot scan has no Army ID exclusion. An eligible army member left unprocessed by operation movement can participate. Tactical reinforcement preserves formation membership; [army reserve recruitment](../operations/organization.md#recruitment) fills formation slots at setup and during Recruiting. Ordinary operations stop reserve scans on entering Gathering; later losses can leave slots open or cause an abort, while direct assignment paths have their own rules.

`PositionUnitsAroundTarget` executes the reinforcement:

1. Try to reveal the destination with a spotter, then run coordinated search at Low aggression with the Reinforce intent. Nearby combat can therefore occur during reinforcement.
2. Move remaining distant units toward the city, aiming within two plots, with ordinary combat units before siege and civilian support. Approach moves check paths, embarkation safety, and danger at the first-turn path endpoint. Attack-capable units other than city-bombard units tolerate danger up to half their current hit points; other units require zero danger. Units sent through the approach move are marked processed.
3. Leave nearby unprocessed independent units available for later work after a successful search. Remaining army members receive safety handling and finish their turn.

Army gathering and movement use this same positioning routine with the Gather intent. [Army contact](engagements.md#army-contact) can first borrow nearby attackers for a fight without adding them to the army. These routines compete with other passes for available units and can search enemies already considered elsewhere that turn.
