# Unit AI: Operations Overview

**Operations** connect multi-turn plans to this turn's missions. This overview is the entry point for contributors and routes readers to the page that owns each rule. Military readers start with [military campaign](campaign.md) and [military organization](organization.md); civilian readers start with [civilian operation](civilian.md). Both then read [operation lifecycle](lifecycle.md) and [operation stages](stages.md). The parent [Unit AI overview](../overview.md) places operations among the other responsibilities.

A **military operation** is a persistent `CvAIOperation` that connects campaign decisions across turns to an army's formation and this turn's missions. The persistent record holds the campaign state while the army holds formation membership and the Unit AI issues missions. Homeland AI handles eligible units outside an army.

The relevant code is in `civ5-dll/CvGameCoreDLL_Expansion2`, primarily `CvMilitaryAI.cpp`, `CvAIOperation.cpp`, `CvArmyAI.cpp`, `CvTacticalAI.cpp`, `CvTacticalAnalysisMap.cpp`, `CvHomelandAI.cpp`, and `CvUnit.cpp`.

## Pages

| Page | Responsibility |
| --- | --- |
| [Operation lifecycle](lifecycle.md) | Shared per-turn process, completion and abort, control state, Tactical-to-Homeland handoff, and diagnostics. |
| [Operation stages](stages.md) | Stage sequences for standard military, escorted civilian, nuclear, and carrier-group operations. |
| [Military campaign](campaign.md) | Operation families, targets, muster, retargeting, nuclear attacks, and cleanup. |
| [Military organization](organization.md) | Ownership, recruitment, membership, and release. |
| [Civilian operation](civilian.md) | Civilian persistent operations, Homeland role passes, and missions. |
| [Military tactics](../tactics/overview.md) | Current-turn movement, postures, and combat priorities. |
| [Tactical simulation](../simulation/overview.md) | Coordinated combat planning, scoring, acceptance, and replay. |
| [Pathfinding](../pathfinding.md) | Movement policy, reachable plots, and danger costs. |

## Military operation layers

| Layer | Responsibility | Detailed guide |
| --- | --- | --- |
| **Campaign** | Creates the operation, defines and validates its target, goal, and muster. | [Military campaign](campaign.md) |
| **Organization** | Creates the army, fills formation slots, gathers members, and releases them. | [Military organization](organization.md) |
| **Stages** | Moves the operation through setup, Recruiting, Gathering, Moving, At Target, and terminal states. | [Operation stages](stages.md) |
| **Lifecycle** | Runs the shared per-turn process and owns completion, control state, handoff, and diagnostics. | [Operation lifecycle](lifecycle.md) |
| **Tactics** | Uses current map and operation state to assign movement and combat. | [Military tactics](../tactics/overview.md) |

## Implementation map

| Focus | Main entry points | Guide |
| --- | --- | --- |
| Campaign creation, targets, and completion | `CvDiplomacyAI::DoUpdateWarTargets`, `CvMilitaryAI::UpdateAttackTargets`, `CvMilitaryAI::UpdateOperations`, operation `Init` methods | [Military campaign](campaign.md) |
| Army membership, recruitment, and mustering | `CvAIOperation::SetUpArmy`, `GrabUnitsFromTheReserves`, `CvArmyAI::AddUnit`, `CvArmyAI::RemoveUnit` | [Military organization](organization.md) |
| Stage transitions | `CvAIOperation::DoTurn`, operation `Move`, army state updates | [Operation stages](stages.md) |
| Shared completion, abort, and control state | `CvAIOperation::Kill`, `ShouldAbort`, `CvUnit::doTurn`, `CvHomelandAI::AssignHomelandMoves` | [Operation lifecycle](lifecycle.md) |
| Civilian operation setup and missions | `CvAIOperationCivilian::Init`, `CvTacticalAI::PlotArmyMovesEscort`, `CvHomelandAI::AssignHomelandMoves` | [Civilian operation](civilian.md) |
| Per-turn army and unit missions | `CvTacticalAI::Update`, `ProcessDominanceZones`, `PlotArmyMovesCombat`, `CvHomelandAI::AssignHomelandMoves` | [Military tactics](../tactics/overview.md) and [military tactical simulation](../simulation/overview.md) |

For logs and claim diagnosis, see [operation diagnostics](lifecycle.md#diagnostics).
