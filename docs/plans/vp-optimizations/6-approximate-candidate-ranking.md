# Bound unit selection searches by the best arrival so far

**Status:** Implemented with corrections to the proposed turn bound and distance precheck. Native boundary, road-route, and distant-candidate regressions pass. Combined timing and remaining live checks are recorded in the [batch validation](1-2-6-8-results.md).

## Implementation

`CvHomelandAI::GetBestUnitToReachTarget` keeps candidate order, domain/processed/mobility/strength filters, destination legality, on-target early return, and strictly-fewer selection. The first reachable candidate uses the original query. Once a finite best exists, later candidates first pass the original cheap arrival checks at `iMaxTurns`. A direct path search then uses `min(iMaxTurns, iBestTurns)` to screen candidates that need pathfinding. Possible winners are confirmed through the original `TurnsToReachTarget` call and caller limit.

The pathfinder's limit is exclusive: `CvAStar::LinkChild` rejects a next-turn transition when its zero-based turn reaches `iMaxTurns`. `ComputePath` returns that zero-based arrival turn. The originally proposed `iBestTurns - 1` would therefore reject a candidate arriving exactly one turn sooner. Using `iBestTurns` admits that candidate.

`CvUnit::GetTurnsToReachTargetEstimate` owns the original cheap checks, including turn clamping, approximate-target rings, route adjustments, and existing special returns. Both the arrival query and homeland selection use this helper. It settles a result without searching or reports that pathfinding is needed. Distant candidates rejected at the caller's original limit never enter the bounded search.

Tightening the distance estimate to the current best would reject some faster routes. Direct `GetPath` screening tightens only the search horizon, and confirmation preserves the original cost-selected route. Native fixtures cover the exclusive boundary, roads faster than the team's distance estimate allows, and five distant candidates that add no searches after a reachable candidate is found.

When the best is zero, later path searches are skipped and their stored distance becomes `INT_MAX`. Earlier filters and the on-target return still run, preserving the existing preference for a later unit already at the target. `SetMovesToTarget` has no selection consumer beyond the unused default comparison; homeland sorts use explicit auxiliary-value comparators.

## Scope and risks

The affected callers are garrison selection with a four-turn limit, sentries with six- and fifteen-turn limits, and wonder engineer selection with forty-two turns. No distance ordering or recruitment shortlist was added.

Path cost includes terrain and danger preferences. Confirming possible winners retains the original query's arrival result, including its existing coarse-distance rejection of some transport or faster-route journeys. The shared helper also preserves the original special results for a nonpositive movement estimate. Recording parity does not establish identical choices in every world state. Live comparisons must include airlifts, embarkation, roads, railroads, ties, and all caller families. Screening adds a query for possible winners, so fewer supplied turn limits alone do not establish a speedup.

A controlled C++03 comparison compiles both actual selector bodies and checks eligibility, ties, zero-turn results, and later on-target units against controlled arrival results. It validates selector control flow and counts both screening and confirmation queries; it does not model real pathfinding costs. Whole-rollout measurements and their output comparisons are recorded in the batch validation, without attributing a separate speedup to this item.

Recruitment shortlisting remains parked. Its power, border, role, nuke, and airlift rules need separate design and regret measurement.
