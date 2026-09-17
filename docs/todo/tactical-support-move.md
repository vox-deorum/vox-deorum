PS. will need to drop a part in the validation code as well

Issue: support checkpoints depend on search tree shape, not on the plan
Summary
TacticalAIHelpers::AddSupportMoves decides which attacks a support unit (great general, admiral, sapper) is scored against by walking the parent chain of the chosen completed position and treating every position whose last assignment is an attack as a checkpoint. Whether an attack is the last assignment of its position depends on how the search happened to build the tree, not on the plan itself. As a result, identical plans receive different support scores, and in the common case of a single attack followed by finish rows, the attack is never a checkpoint at all.

Where
CvTacticalAI.cpp, TacticalAIHelpers::AddSupportMoves: builds nextAttackPosition from the chain with IsAttackMove(tactPos->getAssignments().back().eAssignmentType).
CvSupportPosition::initFromTacticalPosition and UpdateTacticalPosition: read iLastFromAttackPlotIndex and iLastToAttackPlotIndex from getAssignments().back().
ScorePlotForSupportMove: reads lastTacticalAssignment = GetTacticalPosition()->getAssignments().back() and sets bAttackMove = !bLastPosition || IsAttackMove(lastTacticalAssignment.eAssignmentType), which gates the aura bonus.
Three ways the last assignment stops being the attack
Finish rows. addFinishMovesIfAcceptable appends A_FINISH rows to the completed position. When the attack is the last combat move, the final position ends with a finish row, so the chain contains no attack checkpoint. The support root anchors on the final position with bLastPosition true and bAttackMove false, and the aura bonus is never considered.
Bundling. In depth-first mode, makeNextAssignments stores a non-move assignment together with a following FINISH_TEMP, BLOCKED, or HEAL of another unit in one child ("bundle a following block/finish move to reduce search depth"). The child then ends with the stay-put row. The same two rows created as two children keep the checkpoint. Which happens depends on the expansion phase and candidate ordering at that moment.
Restart markers. A visibility change pushes A_RESTART into the attack's child, masking the attack the same way.

Why it matters
The support scorer's stated intent is to place the general where it gives a bonus to the attack being made. Cases 1 and 2 defeat that intent for structural reasons unrelated to the tactical situation.
Any replay or verification tool that works from the flattened assignment list cannot reproduce the scores without recovering the tree shape, which the assignments do not carry.
Proposed fix
Make the checkpoint test ask whether a position added an attack rather than whether it ends with one, and carry that attack's plots explicitly:

In AddSupportMoves, for each position in the chain, look at the assignments in [parent size, own size) and take the last attack among them as the checkpoint attack. Positions with no attack in that range are not checkpoints, exactly as now.
Give CvSupportPosition the checkpoint attack's from and to plots directly (from initFromTacticalPosition and UpdateTacticalPosition) instead of reading getAssignments().back().
In ScorePlotForSupportMove, use that stored attack for iLastAttackFromPlotIndex, iLastAttackToPlotIndex, the attacker domain, and bAttackMove, rather than the last assignment of the position.
With that, finish rows, bundled stay-put rows, and restart markers no longer hide attacks, and the support scores become a function of the plan.

Behaviour change and risk
This changes AI behaviour: generals and admirals will now claim aura bonuses for attacks that are the final combat move or that were bundled, so support units will be pulled toward attacks more often than today. That is closer to the scorer's intent, but it should be validated in play, since the current behaviour also keeps generals slightly more conservative at turn end. The sapper branch uses the same anchor and is affected the same way.