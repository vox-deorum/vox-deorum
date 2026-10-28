# Build worker reachability maps on demand

For DLL developers changing worker assignment. A **reachability map** records the plots a worker can reach within the configured horizon and its arrival movement state.

## Goal and success criteria

Avoid seven-turn reachability searches for workers whose movement estimates are never used by directive scoring.

- Preserve the seven-turn horizon, existing movement flags, weight formula, candidate order, and stable tie handling.
- Build a map only after a worker/directive pair survives the current eligibility and score-bound filters.
- Avoid a search when the directive is already on the worker's current plot.
- Reuse both populated and empty results within the invocation, rebuilding a worker's entry if its own movement state changes.
- Measure fewer searches and lower total `ExecuteWorkerMoves` time on representative AI and human turns.

Moving searches across unit missions changes which world state they observe. The plan treats that as an explicit correctness and performance decision. It cannot promise identical assignments merely because the pathfinder arguments are unchanged.

## Current state

Relevant sources:

- [CvHomelandAI.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvHomelandAI.cpp): `ExecuteWorkerMoves`, `GetWeightedDirectives`, `GetBuilderNumTurnsAway`, and `ExecuteMoveToTarget`.
- [CvHomelandAI.h](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvHomelandAI.h): scoring and movement helper declarations.
- [CvBuilderTaskingAI.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvBuilderTaskingAI.cpp): `ExecuteWorkerMove` and `CanUnitPerformDirective`.
- [CvAStar.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStar.cpp): `CvPathFinder::GetPlotsInReach`, `CvTwoLayerPathFinder::Configure`, `PathValid`, and `PathEndTurnCost`.
- [CvPlayer.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvPlayer.cpp): `GetPlotDanger` and its player danger-cache update.

`ExecuteWorkerMoves` gathers automated/AI workers and immediately builds a `map<CvUnit*, ReachablePlots>` with `BUILDER_MAX_TURNS = 7`. A human-player pass also includes eligible nonautomated workers and several great-person types for recommendations. Each map uses `MOVEFLAG_AI_ABORT_IN_DANGER | MOVEFLAG_VISIBLE_ONLY`.

Only afterward does the function execute already assigned directives and move workers toward allocated regions. Workers processed there do not participate in subsequent weighted selection, but their maps have already been built.

`GetWeightedDirectives` filters worked plots, missing builds, directive upper bounds, inferior same-plot alternatives, processed workers, regions, build capability, danger, build time, and worker-specific score bounds before calling `GetBuilderNumTurnsAway`. Many worker maps can therefore remain unused.

`GetBuilderNumTurnsAway` already returns zero for a directive on the worker's current plot. Otherwise it looks up the target in the worker's map and returns path length plus one when arrival leaves zero moves, or `INT_MAX` for absence.

Weighted scoring runs again after assignments and planned-state updates. Today all those passes reuse the original eager maps. Those maps can be stale: worker movement changes visibility and stacking; completed builds can change roads, features, or passability. A failed `ExecuteWorkerMove` can also leave the worker moved with fewer moves after an aborted mission. A cache keyed only by that worker's position cannot detect changes caused by other workers.

The path query has a player-level side effect: `GetPlotsInReach` calls `Configure`, which requests `GetPlotDanger` for the origin and can trigger `UpdateDanger`. Delaying or omitting queries changes when that shared danger cache is warmed, potentially affecting danger filters and mission checks for other workers.

`ExecuteWorkerMove` can return true after movement uses all remaining moves even when the directive plot has not been reached. This normal partial travel marks the worker processed for this invocation. A true return therefore does not prove that construction started or that useful work completed.

## Approach and alternatives

Replace eager construction with a **worker reachability cache**, a local mutable map keyed by unit ID that belongs to one `ExecuteWorkerMoves` call. Scoring inserts only on the first actual distance query for that worker. Each entry stores the worker's origin plot, remaining moves, and embarkation state alongside its result.

Begin with an empty cache after the assigned-directive and region-movement stages. Reuse entries across weighted-scoring passes. Before using an entry, compare the worker's current plot, moves, and embarkation state; rebuild only that entry when they differ. This handles workers that move during an aborted mission and remain eligible. Processed workers are filtered before lookup, so successfully assigned workers generally need no rebuild.

Keep the current planning policy of reusing movement estimates across other workers' missions. Do not clear every entry because another worker moved. The current eager implementation already tolerates stale visibility, stacking, and terrain estimates during repeated scoring. Mission execution still uses the normal movement/build machinery to check the actual route and can fail or stop when the world differs.

The result has three distinct properties:

- Lazy construction in an unchanged world preserves distance-query behavior, including empty maps and the current-plot shortcut.
- Each worker's first query now observes the world at that query, often after preliminary missions. Different workers can therefore have different observation times. This is an explicit policy approximation and can change assignments.
- Per-worker movement-state checks remove one stale-origin case from current behavior, while changes caused by other workers can remain stale until the next invocation.

The same timing change applies to danger-cache warming. Include that shared side effect in diagnostic comparisons. Preserve an explicit `GetPlotDanger` warmup at the old collection point only if evidence shows that it is needed for acceptable behavior, and measure its remaining cost. Do not introduce global danger invalidation as part of this cache change.

The cache estimates directive travel time; it does not prove that a later mission can complete. Preserve the normal execution checks and failure handling. Do not claim full world-state validity or strict legacy assignment parity.

Alternatives:

- Fresh maps after every mission: more current estimates, but can expand from `W` searches to `W(W+1)/2` when one worker acts between each rescoring. Reject as the default optimization.
- Eager maps only for workers remaining after preliminary stages: a smaller first stage with a common post-preliminary snapshot. It skips processed workers but misses savings from later filters and same-plot shortcuts.
- Global navigation revisions: permits narrower invalidation when all dependencies are tracked, but expands this localized change substantially.
- Selective eager maps at the original snapshot point: use a read-only prepass to conservatively include every worker that can become relevant during later rescoring, before any mission. Exact legacy behavior also requires retaining its stale-origin estimates. This preserves original observation timing but adds duplicate scoring work; current eligibility alone is insufficient to establish the needed set.
- `GetMultiplePaths` for selected targets: may reduce search scope, but changes the query strategy and needs separate profiling. Defer it.

## Ordered implementation steps

1. **Define the local cache contract.**
   Define a private `WorkerReachabilityEntry` with `int startPlotIndex`, `int movesLeft`, `bool embarked`, and `ReachablePlots plots`. Use `typedef std::map<int, WorkerReachabilityEntry> WorkerReachabilityCache`. The cache key is the player's unit ID, and key presence means computed, including an empty result. Do not store pointers or entries across invocations, turns, saves, or player changes.

2. **Add one lazy accessor.**
   Add `const ReachablePlots& GetWorkerReachablePlots(CvUnit* pUnit, WorkerReachabilityCache& cache) const` to `CvHomelandAI`. On a miss or movement-state mismatch, construct the same `SPathFinderUserData` with the existing flags and seven-turn horizon, store the state and returned map, and return the stored map by reference. Otherwise reuse it. Use supported C++ syntax and give the helper a purpose comment.

3. **Thread mutable cache references through scoring.**
   Change `GetBuilderNumTurnsAway` and `GetWeightedDirectives` to accept `WorkerReachabilityCache&` instead of the const pointer-keyed map. Keep those member functions `const`: only the caller-owned temporary cache is mutated. Keep the current-plot zero-distance return before calling the accessor. Preserve unreachable and zero-moves-arrival behavior.

4. **Remove eager construction from worker collection.**
   Retain the current worker membership, order, human recommendation coverage, and duplicate avoidance. Delete only the two eager path searches and associated local path-data construction. Create the empty cache after preliminary assigned-directive and region processing, immediately before first weighted scoring.

5. **Keep existing filters ahead of lookup.**
   Leave the lazy call at the existing movement-time calculation point after capability, danger, build-time, and score-bound checks. Do not add new pruning, change `IsBestDirectiveForPlot`, alter score comparisons, or fix unrelated ignored-directive behavior in this change.

6. **Check a worker's movement state on every lookup.**
   Compare `plot()->GetPlotIndex()`, `getMoves()`, and `isEmbarked()` before returning a stored result. An aborted mission can return false after moving; that worker's next query must rebuild. Do not clear other workers' entries after missions. Document that visibility, stacking, route, and feature changes caused by other workers remain an accepted estimate approximation. Recommendation-only assignments and hypothetical planned builds retain entries.

7. **Keep scoring references short-lived.**
   Do not retain a `ReachablePlots` reference, iterator, or `CvUnit*` lookup result across mission execution or entry replacement. Resolve worker IDs using the existing live-unit lookup. No cached map is reused for a consumed great person. Preserve stable sorting and worker traversal order. Keep actual mission path checks and failed-mission handling unchanged.

8. **Instrument and apply a performance acceptance gate.**
   Count candidate workers, maps constructed, movement-state rebuilds, empty maps, cache hits, current-plot shortcuts, mission failures, and elapsed path/scoring time. Record whether movement reached its target, started a build, or consumed moves while still traveling; do not interpret a true mission return as completed work. Compare danger-filter decisions and danger-cache updates at collection, scoring, and execution points. Use fresh maps diagnostically to explain differences without replacing the production reuse policy. Compare multi-turn progress against the current eager implementation and investigate time regressions. Use existing DLL logging/profiling and `// Vox Deorum:` modification markers.

## Concrete examples and estimates

These examples are analytic illustrations, not measured savings.

| Scenario | Current eager maps | Lazy maps |
| --- | --- | --- |
| 12 workers; 7 finish assigned directives, 2 move regions; only 2 remaining workers survive scoring filters | 12 | 2, absent movement-state changes |
| Human recommendations for 20 workers/eligible great people; only 4 need nonlocal distance queries; no actual missions | 20 | 4, reused across recommendation passes |
| Every surviving pair targets its worker's current plot | One map per gathered worker | 0 |
| A queried worker's map lacks a requested target; queried repeatedly without moving | 1 | 1, because the computed map is cached |
| 10 workers all need maps, with one successful mission between each complete rescoring | 10 total | 10 total; other workers' maps are retained |
| A queried worker aborts a move, changes origin, and is queried again | 1 stale original map | 1 initial map plus 1 rebuild |

Eager map count is gathered workers `W`; lazy count is queried workers `Q` plus movement-state rebuilds `R`, where `0 <= Q <= W`. With no retries, a 20-worker invocation querying 8 workers saves 12 of 20 searches, or 60%. Failed movement can increase `R`, so the bound is not an unconditional one-search-per-worker guarantee.

An unreachable target does not imply an empty map: the start and other reachable plots can still be present. Independently, if the pathfinder returns an empty result, that is a computed cache entry and must not trigger a repeated search.

If map costs average `P`, gross savings are approximately `(W - Q - R) * P`, before cache checks and any retained danger warmup. The first viable directive can still query nearly every remaining worker, so filter count alone does not establish a low `Q`. Preliminary processed workers and recommendation-only cases are the strongest candidates for savings. Measure map time and full worker-update time; no current whole-turn percentage is supported.

The simulator replays captured worker/directive pairings through its `GetWeightedDirectives` facade. Its map-count and timing results cannot establish DLL scoring hit rates, assignment quality or danger-cache timing. Retain DLL save comparisons for those gates.

Estimated effort: 1 to 2 developer days for localized helper/signature changes and instrumentation; 2 to 3 more days for DLL validation, save comparisons, and checking the observation-time approximation. Precise world-state invalidation would require additional investigation outside this estimate.

## Risks and open questions

- First-observation timing can change assignments even when all candidates and weight formulas match. Evaluate recommendation quality, mission failures, and retries against the current world.
- Moving `Configure` also moves possible player danger-cache warming. Compare danger-driven choices and other workers' mission checks; add the old-point warmup only if evidence warrants it.
- Visibility and civilian stacking can change without modifying the queried worker. Its movement-state key is sufficient for detecting its own movement, not for full path validity. This approximation must remain explicit.
- A hypothetical planned build changes scoring state without necessarily changing the actual map. Keep those two states separate when explaining cache freshness.
- Normal mission execution rechecks movement, but an approximate estimate can still choose a less useful directive. Check completed work and wasted movement, not merely crashes or legal moves.
- A successful return with zero moves can represent expected partial travel. Compare target arrival, build starts, and multi-turn progress before labeling it a regression or a completed assignment.
- If strict legacy assignment parity is required, lazy first-observation timing is unsuitable. Reconsider the selective-eager alternative before implementation.
- There is no required save-format migration because all cache state is invocation-local.

## Verification

1. Build the DLL with the existing Windows toolchain. Use a build-only release invocation such as `python build_vp_clang_sdk.py --config release` from `civ5-dll` after checking prerequisites. Use the documented `build-and-copy.bat` deployment workflow when deployment is requested.
2. On an unchanged scoring snapshot, compare lazy queries against eager maps generated at that same snapshot: reachable membership, arrival turns, chosen worker, directive order, and ties must agree. Use temporary diagnostics or a focused native harness if available; no existing DLL unit-test harness has been identified.
3. Exercise assigned directives, wrong-region workers, same-plot builds, no valid directives, empty reach maps, unreachable targets, seven-turn boundaries, exhausted movement, land/sea workers, and human nonautomated/great-person recommendations.
4. Exercise an aborted move that changes position but returns false and confirm that worker's map rebuilds. Also exercise zero-moves partial travel that returns true: record actual target arrival and build start, and compare progress across turns. Exercise a completed road or feature removal, a worker revealing terrain, a civilian vacating a choke point, and a consumed great person. Confirm retained estimates remain invocation-local and actual missions still validate movement. Use fresh diagnostic maps to explain differences rather than asserting parity after world changes.
5. Compare danger-cache update timing, danger-filter exclusions, and later mission decisions before and after preliminary worker moves. Include a cold player danger cache and a turn where preliminary movement reveals threats. If differences warrant retaining old-point warming, verify that variant separately and profile its cost.
6. Profile full `ExecuteWorkerMoves`, path time, map count, and peak cached entries on early, late, coastal, wartime, human, and worker-heavy turns. Include repeated rescoring cases. Accept only a workload-supported net improvement with understood assignment differences.

## Out of scope

Changing pathfinding algorithms, directive formulas, candidate ordering, region allocation, ignored-directive semantics, path horizons, movement flags, persistent caching, broad world-revision plumbing, or copying unrelated scoring inputs by reference.
