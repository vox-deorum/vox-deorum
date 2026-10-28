# Build worker reachability maps on demand

**Status:** Implemented. Native cache tests and release DLL builds pass. Live worker-assignment and performance acceptance remains. See the [batch validation](1-2-6-8-results.md).

## Implementation

`CvHomelandAI::ExecuteWorkerMoves` collects the same workers in the same order, including human recommendations and eligible great people. It creates an empty invocation-local `WorkerReachabilityCache` after assigned-directive and region movement, immediately before weighted scoring.

The cache uses player-local unit IDs. Each entry stores origin plot index, remaining moves, embarkation state, and `ReachablePlots`. `GetWorkerReachablePlots` computes a map on the first nonlocal distance query and rebuilds that entry when the worker's own movement state changes. Presence means computed, including an empty result. The seven-turn horizon and danger/visibility flags are unchanged.

`GetBuilderNumTurnsAway` keeps its current-plot shortcut ahead of lookup and preserves unreachable and zero-moves-arrival handling. It and `GetWeightedDirectives` remain const while accepting the caller-owned mutable cache. Existing eligibility and score-bound filters remain before the distance query. Scores, traversal order, stable sorting, region policy, and mission failure handling are unchanged.

## Observation-time policy

A first query can now observe preliminary worker movement or a completed build. That can change assignments. Later changes caused by other workers, including visibility, stacking, routes, and features, do not invalidate an existing estimate. The cache detects the queried worker's own movement, including movement during an aborted mission. Normal missions still check the actual route.

Delaying `Configure` also delays possible player danger-cache warming. No old-point warmup or global invalidation was added without evidence. No cache survives its invocation, so consumed great people and subsequent turns do not retain entries.

## Validation and acceptance

The simulator extracts the native cache types, accessor, and travel-time helper. Its captured-pair scoring facade accepts the same cache contract. Native tests compare retained maps with fresh cache rebuilds at the same snapshot, exercise local shortcuts, reuse empty results, and rebuild after moves, position, or embarkation changes while retaining another worker's entry.

Simulator rollouts replay captured worker/directive pairings. They cannot establish native scoring admission rates, human recommendation quality, danger-cache timing, or full `ExecuteWorkerMoves` savings. Live comparisons still need candidate/map/rebuild/hit counts, danger-filter observations, mission failures, target arrivals, build starts, partial travel, and multi-turn useful progress. Those acceptance gates remain open. A successful mission return alone does not mean work completed.

Persistent caching, global world revisions, score changes, and fresh maps after every other worker's mission remain outside this item.
