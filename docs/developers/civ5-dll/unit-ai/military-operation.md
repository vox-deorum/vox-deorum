# Unit AI: Military Operation

A **military operation** is a persistent `CvAIOperation` that connects campaign decisions across turns to an army's formation and this turn's missions. This is the entry point for contributors. The linked pages below own the detailed rules.

| Layer | Responsibility | Detailed guide |
| --- | --- | --- |
| **Campaign** | Creates the operation, defines and validates its target, goal, and muster. | [Military campaign](military-campaign.md) |
| **Organization** | Creates the army, fills formation slots, gathers members, and releases them. | [Military organization](military-organization.md) |
| **Tactics** | Uses current map and operation state to assign movement and combat. | [Military tactics](military-tactics.md) |

The persistent record holds the campaign state while the army holds formation membership and the Unit AI issues missions. The shared [operation lifecycle](operation.md#operation-lifecycle) explains Tactical-to-Homeland handoff. Homeland AI handles eligible units outside an army.

The relevant code is in `civ5-dll/CvGameCoreDLL_Expansion2`, primarily `CvMilitaryAI.cpp`, `CvAIOperation.cpp`, `CvArmyAI.cpp`, `CvTacticalAI.cpp`, `CvTacticalAnalysisMap.cpp`, `CvHomelandAI.cpp`, and `CvUnit.cpp`.

## Implementation map

| Focus | Main entry points | Guide |
| --- | --- | --- |
| Campaign creation, targets, and completion | `CvDiplomacyAI::DoUpdateWarTargets`, `CvMilitaryAI::UpdateAttackTargets`, `CvMilitaryAI::UpdateOperations`, operation `Init` methods | [Military campaign](military-campaign.md) |
| Army membership, recruitment, and mustering | `CvAIOperation::SetUpArmy`, `GrabUnitsFromTheReserves`, `CvArmyAI::AddUnit`, `CvArmyAI::RemoveUnit` | [Military organization](military-organization.md) |
| Per-turn army and unit missions | `CvTacticalAI::Update`, `ProcessDominanceZones`, `PlotArmyMovesCombat`, `CvHomelandAI::AssignHomelandMoves` | [Military tactics](military-tactics.md) and [military tactical simulation](military-tactical-simulation.md) |

For logs and claim diagnosis, see [operation diagnostics](operation.md#diagnostics).
