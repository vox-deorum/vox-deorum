# City connection reachability and path reuse

**Status:** Measure first. The searches run every turn and pair marking scales quadratically, but the stages below need a profile showing they take a meaningful share of turn time.

For DLL developers: **city connection searches** determine which cities connect to the capital and which route plots receive connection yields. This plan changes their traversal in `civ5-dll/CvGameCoreDLL_Expansion2/CvAStar.cpp` and their use in `CvCityConnections.cpp`.

## Goal and success criteria

Reduce `CvCityConnections::UpdateRouteInfo` search overhead while preserving direct connection masks, capital/industrial connection flags, exact connected-plot sets, and resulting plot yields.

Ship constant-cost connectivity floods independently. Treat replacing pair-specific paths with predecessor trees as a second, conditional stage: enable it only where exact marked plots are preserved. A faster result with different connected plots is a gameplay change and requires separate approval.

## Current state

- [CvPlayer.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvPlayer.cpp): turn processing calls `GetCityConnections()->Update()` unconditionally for every player each turn. The dirty flag drives lazy refreshes in the accessors, and building roads does not set it, so `UpdateRouteInfo` runs every turn regardless.
- [CvCityConnections.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvCityConnections.cpp): `UpdateRouteInfo` performs road and railroad reachability searches from each city in `m_plotIdsToConnect`, plus water reachability when buildings and blockade state permit it.
- It first populates `m_connectionState`, supplements missing connections through Lua events, then floods mixed road and mixed industrial connections from the capital. Mixed searches depend on the completed direct-connection table.
- It stores connected cities in reachability iteration order, then calls `GetPath` for every `i < j` pair to mark road-connected plots, so the pair loop is quadratic in connected cities. Each failed no-river road search retries with rivers. Industrial pairs use railroad paths without river fallback.
- `CheckPlotRouteStateChanges` sorts and deduplicates the unions, computes additions/removals, and calls `CvPlot::SetCityConnection`.
- [CvPlot.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvPlot.cpp): `SetCityConnection` updates yields and visible layout when a plot flag changes. Equal-cost alternative paths can therefore affect gameplay.
- [CvAStar.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStar.cpp): `CvStepFinder::Configure` uses a null cost callback for `PT_CITY_CONNECTION_LAND`, `WATER`, and `MIXED`. `udFunc` supplies the constant `PATH_BASE_COST` for every accepted edge, including nonlocal extra children.
- `GetPlotsInReach` uses destination `(-1, -1)`, giving zero heuristic. The general heap loop stores parents and costs even though these connectivity callers use plot membership.
- [CvAStarNode.h](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStarNode.h): heap ties use Y then X. `ReachablePlots::createIndex` builds lookup metadata without changing iteration storage order.

Land validity depends on routes, pillaging, woodland traits, player ownership, peace, and passage rights. Water validity checks revelation, water/coastal passable plots, and diplomacy. Preserve these existing callbacks.

Land extra children can jump along rivers for `ROUTE_ROAD` and `ROUTE_ANY` only. Mixed extra children add harbor/air connections from `m_connectionState`; road and any-route mixed floods also add river jumps, while industrial mixed floods add harbor/air links only. Preserve their exact endpoint validity, feature gates, route restrictions, and directed behavior. Their edge cost is one step regardless of geographical distance. Do not expand a river jump into intermediate plots.

## Approach and alternatives

Measure before implementing either stage. Stage A only removes heap overhead from the constant-cost floods, and Stage B remains research into whether predecessor trees can preserve exact marked plots. Start only when a profile shows that pair marking or the direct floods take a meaningful share of turn time; a wide empire makes that plausible, but the share is unmeasured.

Stage A introduces a dedicated **FIFO reachability helper**, which explores plots in first-in, first-out order, on `CvStepFinder`, called only by the five reachability sites in `UpdateRouteInfo`. It reuses current validity/extra-child callbacks and changes the queue for these constant-cost searches. It does not replace `GetPath` or globally dispatch all step modes through BFS.

Return reachable plots in legacy order `(hop distance, Y, X)`, rather than FIFO discovery order. Require `giKnownCostWeight > 0` for this ordering argument; other weights retain the legacy search. This preserves connected-city vector order and therefore the orientation of existing `i < j` pair searches. A reversed path request can select a different route on a tied or directed graph.

Stage B evaluates per-origin no-river road/railroad predecessor trees. A single tree gives shortest paths to many targets, but the current pair searches use destination-oriented `StepHeuristic` and heuristic tie-breaking. Identical shortest distance does not imply identical plot sequence. River jumps also make geographical distance an inadmissible heuristic, so replacing legacy river searches can change even their returned costs.

Consequently, Stage A is the smaller candidate and Stage B may ship only for a proven compatible subset, with legacy pair searches for ambiguous targets. If a useful compatible subset cannot be identified cheaply, leave all pair searches unchanged and report the measured Stage A benefit.

Alternatives:

- Globally replace the heap with BFS: exposes unrelated consumers to ordering changes and does not preserve pair-specific A* choices.
- Reuse capital predecessor paths alone: fails to mark the union of paths between all connected city pairs.
- Mark all roads in a connected component: changes the plot/yield contract.
- Use Plan 3's `GetMultiplePaths` directly for all pairs: yields one destination-free tree, still with different tie semantics from individual `GetPath` calls.
- Cache across updates: needs invalidation for diplomacy, traits, buildings, Lua connections, pillaging, and map changes. Local reuse avoids those dependencies.

## Ordered implementation steps

1. Capture baseline counters inside `UpdateRouteInfo`: reachability calls by route/mode, pair calls, failed no-river pairs and river retries, expanded nodes, tested ordinary/extra edges, reconstruction work, and elapsed time. Keep timing probes out of final comparative timing runs where possible.

2. Add public `ReachablePlots CvStepFinder::GetCityConnectionPlots(const CvPlot* start, const SPathFinderUserData& data)` in [CvAStar.h](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStar.h). Return an empty result for a null start before accessing its coordinates. It accepts only the three city-connection modes with `iUnitID == 0`, unlimited turns and normalized distance, zero minimum moves, no movement flags, and `giKnownCostWeight > 0`. Unsupported requests delegate to `GetPlotsInReach`; existing call sites satisfy these limits.

3. Implement the helper with the existing conditional game-core lock, `Configure`, initialization/start validation, `Reset`, generation advancement, and explicit start/destination coordinates (`-1, -1` for destination). No city-connection mode currently has initialize/uninitialize callbacks. Assert that assumption, a null cost callback, and positive known-cost weight so future configuration changes require review rather than silently bypassing lifecycle logic.

4. Use local `vector<int> depth(numPlots, -1)` and `vector<CvAStarNode*> queue` with a monotonically increasing head. Discover the start at depth zero. On each pop, enumerate the existing six precomputed neighbors, then the configured extra children; validate each edge with the existing callback and enqueue unseen valid endpoints. Preserve wrapping and directed edges. Depth is the number of accepted edges, including jumps.

5. Use current finder nodes for callback coordinates and normal parent metadata. Initialize each discovered node's parent, depth, zero moves, zero heuristic, and constant cumulative cost. Track every touched node once in `m_closedNodes` so the next generic `Reset` clears all touched state; do not put FIFO nodes in `m_openNodes` or invoke heap maintenance. Mark visited through the local depth array, not stale node cost fields. City callbacks are independent of predecessor history except the ordinary initial-parent case; retain the start's unconditional admission.

6. Produce `SMovePlot` fields using the same depth, zero remaining moves, and normalized-distance formula as `GetPlotsInReach`. Sort only returned storage by `(depth, Y, X)`, then call `createIndex`. Existing constant-cost heap floods pop in that order because the heuristic is zero and the known-cost weight is positive. BFS predecessor differences remain private to this membership helper. Add purpose comments and the `// Vox Deorum:` prefix for modified Community Patch code.

7. Replace the road, railroad, water, capital-road mixed, and capital-railroad mixed `GetPlotsInReach` calls inside `UpdateRouteInfo`. Preserve call ordering, blockade/building tests, Lua events, industrial-era gating, and the point when `m_connectionState` becomes available. Keep all pair `GetPath` loops unchanged. Verify this Stage A before proceeding.

8. For Stage B exploration, add `ConnectionTree CvStepFinder::GetCityConnectionTree(const CvPlot* start, const SPathFinderUserData& data)` with `ConnectionTree { vector<int> distance; vector<int> parent; vector<unsigned char> shortestPathCount; }`. Return empty arrays for a null start before reading coordinates. It accepts unlimited, no-river `PT_CITY_CONNECTION_LAND` requests under the same limits as Stage A, additionally requiring both `giKnownCostWeight == 1` and `giHeuristicCostWeight == 1`. Unsupported requests retain legacy pair searches. Build one call-local tree per origin and route. Distances use `-1` for unreachable plots and parents use plot indices with `-1` at the start. Counts represent shortest paths: initialize the start to one; on the first shortest discovery of V from U assign `count[V] = count[U]`; on each later equal-depth incoming edge assign `count[V] = min(2, count[V] + count[U])`. Thus zero means unreachable, one means unique, and two means multiple. Ambiguity propagates through suffixes, so two equal diamond prefixes followed by a single shared suffix require `GetPath` for the suffix target. Retain `GetPath` whenever the target count is not one, except the unreachable river fallback in step 10. Do not retain trees beyond this update.

9. Restrict tree reuse initially to targets whose unique route uses only adjacent land edges and whose no-river graph makes `StepHeuristic` consistent at the positive uniform `PATH_BASE_COST`. Both weights must remain at their default value of one. The legacy `m_iDestHitCount > 2` shortcut cannot fire in this subset: every predecessor adjacent to the goal has heuristic exactly one edge cost, so the first predecessor popped that can relax the goal gives its optimal cost. Later equal-cost relaxations are rejected by `LinkChild`, leaving the goal-touch count at one. There are no extra-child edges with rivers disabled. Use the actual original origin and destination order, then reconstruct and mark that unique path directly. This uniqueness and normal-termination argument is the compatibility basis; a finite collection of matching saves alone is insufficient proof for tied routes. Preserve original `GetPath` for ambiguous routes or nondefault weights.

10. When the no-river tree reports a target unreachable, retain the legacy river-enabled `GetPath` fallback for road pairs, including its current jump selection and plotting behavior. Railroad pairs never acquire a river fallback. Do not synthesize markers for intermediate river plots absent from the returned path.

11. Compare hybrid output to the legacy pair loops, including both complete marked-plot unions and per-pair sequences during development. Measure whether BFS tree construction and path-count tracking are worthwhile after ambiguous pairs fall back. If not, ship Stage A alone and omit unused Stage B scaffolding.

## Examples, estimates, and effort

These estimates are analytical and unmeasured. They describe search work, not guaranteed wall-clock or whole-turn improvements.

For 20 start cities, at most 60 direct floods occur if all permit water, plus up to two capital mixed floods. Actual counts depend on blockades, buildings, and industrial era. On a graph with 3,000 reachable plots, one flood examines roughly 18,000 adjacent edges plus extra edges. FIFO removes heap operations from those visits; callback and river-list costs remain.

A rough comparison is `O((V + E) log V)` heap work versus `O(N + V + E)` FIFO work before output ordering, where `N` is the full map size and `V` is the number of reached plots. The local depth array initializes all `N` entries on every call and uses about `4N` bytes; the queue and output add `O(V)` memory. Sorting all output plots still costs `O(V log V)`, with simpler integer comparisons and fewer heap bookkeeping operations. Report this honestly: preserving order prevents claiming a purely linear end-to-end helper. If sorting dominates, bucket by depth and sort only same-depth frontiers by Y/X as a later local improvement.

For example, a railroad search that reaches only its start on a 20,000-plot map still initializes 20,000 depth entries, about 80 KB, while the existing heap search processes one node. Repeating this for 20 origins writes about 1.6 MB before useful traversal. Include these sparse-network calls in timings. If map-wide initialization dominates measured cost, consider a reusable generation array or touched-list reset as a follow-up; neither is mandatory infrastructure for the first implementation.

| Pair stage, 20 road and 20 industrial connected cities | Searches before | Potential searches after |
| --- | --- | --- |
| All pairs, no river retries | 190 road + 190 railroad | Up to 19 trees per route, plus tied-pair fallbacks |
| 30% of road pairs need rivers | 380 initial pair searches + about 57 retries | Tree work, ambiguous-pair calls, and the same necessary river retries |
| Most shortest routes tie | 380 pair searches | Possibly 380 pair searches plus tree overhead; Stage B should remain disabled |

On a tree-shaped road network, shortest paths are unique and the hybrid can replace most pair searches. On a city grid, equal-length alternatives are common. For 19 useful origins and a 3,000-plot graph, a 9-byte-per-plot logical tree payload is about 27 KB before vector/alignment overhead when processed one origin at a time. A second no-river route tree can reuse the same allocation. Reconstruction remains proportional to emitted path lengths.

Search count alone can mislead: reducing 190 pair searches to 19 trees is 90% fewer search invocations. Yet 19 complete trees of 3,000 plots visit 57,000 plots, matching 190 pair searches that average 300 expansions. If pair searches average only 100 expansions, they visit 19,000 plots and full trees can cost more even with FIFO. Include this crossover, ties, and river fallback in the Stage B go/no-go measurement.

No measured share supports a whole-turn saving for either stage. Current simulator rollouts consume captured connection plots and omit these city-connection searches, giving this plan no direct rollout saving. The simulator's separately measured city-distance work uses `PT_ARMY_MIXED` and is outside this scope.

Expected effort: 3 to 5 developer days for Stage A implementation, ordering/lifecycle comparisons, and saves; 3 to 6 additional days for the conditional tree/uniqueness stage and river/tie verification. Stop after Stage A if profiling shows limited pair-search value or no useful unique-path subset.

## Risks and open questions

- Extra-child enumeration can dominate time, especially repeated river plot lists. FIFO does not remove that cost.
- Preserving reachable membership alone is insufficient: capital result ordering determines pair orientation. Compare ordered results as well as sets.
- `GetCityConnectionPlots` must initialize and clear finder nodes consistently even when returning early for invalid configuration/start. A later unit or ordinary step search must see clean state.
- A river-enabled destination A* can be nonoptimal because geographical distance overestimates jump cost. Preserve this existing behavior in the fallback rather than treating BFS differences as equivalent optimizations.
- Lua-provided connections may be asymmetric. Do not collapse directional connectivity or reorder event invocation.
- A changed marked plot changes yields through `SetCityConnection`. No tied-route tree reuse is authorized by this plan.

## DLL verification

No existing C++ test harness is assumed. Add a debug-only differential entry point or use a debugger-driven probe that copies legacy and FIFO `ReachablePlots` before finder state is reused. Compare ordered plot indices and every movement/distance field explicitly; `SMovePlot::operator==` checks only indices.

For each unchanged world state, compare full `m_connectionState` masks, ordered connected-city vectors, capital and industrial flags, sorted plot unions, `SetCityConnection` additions/removals, and affected plot yields. Avoid invoking Lua events twice as part of the algorithm comparison: capture their completed connection table and run both mixed-search variants against that snapshot, then compare one full normal update separately.

Cover road and railroad branching, tied parallel routes, asymmetric borders/war access, woodland traits, pillaging, land/sea blockades, harbor/industrial harbor and airport links, Lua-added links, road/any-route river jumps and disconnected rivers, wrap maps, disconnected cities, null start, no capital, and pre/post-industrial era. Confirm industrial mixed searches add no river jumps and Stage A leaves all pair paths and their orientation unchanged. Confirm nonpositive known-cost weights fall back in Stage A. For Stage B add unique-path networks, tied grids, a diamond prefix with a shared suffix, no-river failure followed by river success, and exact per-pair path comparisons. Assert default weights and a single goal touch for reused paths; verify inflated heuristic weights and other nondefault weights retain legacy pair searches.

Build from `civ5-dll/` with `python build_vp_clang_sdk.py --config release`. For requested build and deployment, run `powershell -Command "& .\build-and-copy.bat"` and validate representative Civ V saves. Time repeated fixed-state updates with matching map/settings, separate direct floods, capital floods, and pair marking, and report allocations and extra-child counts alongside time. TypeScript workspace tests do not validate these DLL semantics.

## Out of scope

Changing city-connection rules, repairing legacy river path optimality, changing plot yields, selecting a new canonical tied route, global BFS dispatch, persistent component caches, Lua API changes, general unit pathfinding, or removing the pair plot-marking requirement.
