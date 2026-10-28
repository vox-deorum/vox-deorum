# Bound unit selection searches by the best arrival so far

**Status:** Next. An exact branch-and-bound in `GetBestUnitToReachTarget` replaces the earlier approximate shortlist; recruitment shortlisting is parked.

For DLL developers changing homeland unit selection.

## Goal and success criteria

Reduce unit path searches in `CvHomelandAI::GetBestUnitToReachTarget` without changing which unit it returns.

- Every caller receives the same unit as today, apart from the rare cases listed under risks.
- Later candidates search with a turn bound no larger than needed to beat the current best.
- Measure path searches, expanded nodes, and elapsed time per call for garrison, sentry, and engineer selection.

## Current state

[CvHomelandAI.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvHomelandAI.cpp), `GetBestUnitToReachTarget`, walks `m_CurrentMoveUnits` in list order. It skips units with the wrong domain, processed or immobile units, and units below a minimum strength. It returns a unit already on the target immediately. Otherwise it checks `canMoveInto` and calls `TurnsToReachTarget(target, MOVEFLAG_NO_ENEMY_TERRITORY, iMaxTurns)`. It keeps a unit only when its turns are strictly fewer than the best so far, so the earliest unit in list order wins ties. The best turn count is never used to limit later searches.

Callers and their turn bounds:

| Caller | Bound |
| --- | --- |
| `PlotGarrisonMoves`, once per city lacking a garrison | `AI_HOMELAND_MAX_DEFENSIVE_MOVE_TURNS` (4) |
| Sentry moves | 6 and 15 |
| Wonder engineer selection, four sites | 42 |

[CvUnit.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvUnit.cpp), `TurnsToReachTarget`, raises the bound to at least one. For a finite bound it compares plot distance with `moves * turns`, scaled by the team's best route, and returns `INT_MAX` when the target is out of range. It then calls `ComputePath(..., false)`, which passes the bound into the search so that nodes beyond it are pruned. A smaller bound therefore makes both the cheap distance check and the search itself tighter.

Each evaluated unit's result goes into `CvHomelandUnit::SetMovesToTarget`. The only reader is `CvHomelandUnit::operator<`. Both homeland sorts of `m_CurrentMoveUnits` use explicit auxiliary-value comparators, so nothing consumes the stored value.

## Change

1. Keep the candidate order, filters, on-target early return, and strictly-fewer selection unchanged.
2. Before each `TurnsToReachTarget` call, compute the bound as `min(iMaxTurns, iBestTurns - 1)` once a best exists, otherwise `iMaxTurns`.
3. If the best is already zero turns, skip the search for later candidates: none can be strictly better. Still run the earlier filters so that a later unit standing on the target returns as it does today.
4. When a bounded call returns `INT_MAX`, record `INT_MAX` in `SetMovesToTarget`, as the existing unreachable case does.
5. Add a purpose comment and the `// Vox Deorum:` prefix. No signature change, so no caller changes are needed.

Why the choice is unchanged: a unit only replaces the best with strictly fewer turns. A unit that needs `iBestTurns` or more could never be selected, so rejecting it early changes nothing. For a unit that arrives in `t < iBestTurns` turns, the cheapest path under the original bound uses at most `t` turns at every step. That path survives the tighter bound, so the bounded search finds the same arrival.

## Optional second step

Searching nearer candidates first finds a small bound sooner. To keep the original tie rule, process candidates in increasing plot distance but compare by `(turns, original index)`. A candidate with a smaller original index than the current best may tie, so its bound is `iBestTurns`; a candidate with a larger index uses `iBestTurns - 1`. Add this only if counters show many searches remain after step 1.

## Estimates

These are analytic examples, not measurements.

- Garrison with 30 candidates, where the third unit arrives in one turn: the remaining 27 searches run with a bound of one turn instead of four. Most fail the distance check without searching, and the rest search a much smaller region.
- Engineer selection with a 42-turn bound: after the first engineer that can arrive in five turns, later engineers search at most four turns instead of 42. These are the largest floods this change can shrink.
- If the best candidate is last in list order, nothing is saved. The optional distance ordering addresses this.

No measured share of turn time supports a whole-turn estimate. Count searches and expanded nodes per caller before and after.

Estimated effort: half a day to a day for the change and counters, plus one to two days of differential checks on saves.

## Risks

- The distance check in `TurnsToReachTarget` is an existing approximation. Units that can travel farther than `moves * turns` suggests, for example through an airlift, can already be rejected under the original bound. A tighter bound makes that rejection more likely. Count such cases in the differential check.
- Equal-cost alternative paths could, in principle, resolve differently once the bound removes some nodes from the search. The turn count of the selected path should not change, but verify it.
- `SetMovesToTarget` stores `INT_MAX` for units pruned by the bound. Recheck that no reader has appeared before landing.

## Verification

1. Build with `python build_vp_clang_sdk.py --config release` from `civ5-dll/`. When deployment is requested, use `build-and-copy.bat`.
2. Add a temporary debug comparison that runs the original unbounded loop and the bounded loop on the same unchanged state and asserts the same selected unit. Cover garrison, sentry, and engineer callers, ties in turn count, on-target units after a zero-turn best, airlift-capable units, embarkation, and roads and railroads.
3. With the comparison disabled, profile identical saves and report searches, expanded nodes, and time per caller.

## Parked option: recruitment shortlisting

`CvAIOperation::GrabUnitsFromTheReserves` runs one coarse `PT_ARMY_MIXED` flood from the muster point, filters units with `IsUnitSuitableForRecruitment`, and then runs `TurnsToReachTarget` for every survivor, with no cap. An earlier draft proposed evaluating a cheaply ranked shortlist first and widening when slots stay empty. That changes which units are recruited and needs regret measurement, role-compatibility auditing, and nuke-operation and airlift bypasses. Recruitment scores combine power, border bonuses, and arrival turns, so the simple bound above does not apply directly. Revisit this only if profiles show recruitment searches matter after plans 5 and 6.

## Out of scope

Changing unit eligibility, selection rules, movement legality, approximate ranking, or recruitment.
