# Target-aware batch path searches

**Status:** Deprioritized for nonempty early stopping. The empty-list guard is a low-payoff drive-by.

For DLL developers: a **batch path search** finds paths from one origin to several requested plots. This plan changes when that search stops in `civ5-dll/CvGameCoreDLL_Expansion2/CvAStar.cpp`, with exact path compatibility as a prerequisite.

## Goal and success criteria

Reduce work in `CvPathFinder::GetMultiplePaths` when every requested target is settled before the bounded search region is exhausted, and skip the search for an empty target list.

The early-stop case is rare in current callers. Trade and canal destinations are built from every city in the game, including the origin's own city, so those lists are never empty and almost always contain an inland or unreachable city that keeps the batch from settling early. Only `GetArmyPathsFromCity` can pass an empty list, when the player has no revealed foreign city. The design below therefore stays parked, and the empty-list guard is worth taking only as a small drive-by.

For enabled modes, preserve the returned map keys and every `SPath` field, including the exact plot sequence, cost, normalized distance, turns, configuration, and generation slice. Unsupported requests retain the existing flood behavior. Measure improvements in expanded nodes and elapsed DLL time separately.

## Current state

- [CvAStar.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStar.cpp): `GetMultiplePaths` configures the finder, copies and sorts destination pointers, then calls `FindPathWithCurrentConfiguration(start, -1, -1)`. It scans `m_closedNodes` for requested plots only after the complete bounded flood. Empty lists still trigger that flood.
- [CvAStar.h](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStar.h): the batch method belongs to `CvPathFinder`, also the base for unit movement. The API itself does not promise that all path modes have ordinary shortest-path semantics.
- `CvStepFinder::NodeAddedToPath` computes a heuristic only for a valid destination. Batch searches therefore use `h = 0`, even where `Configure` installs `StepHeuristic`.
- `GetBest` pops the minimum heap node and puts it in `m_closedNodes`. `LinkChild` rejects negative edge costs, checks turn and normalized-distance limits, rejects equal-cost updates, and can propagate improvements through closed nodes with `UpdateDownstreamNodes`.
- [CvAStarNode.h](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStarNode.h): `PrNodeIsBetter` orders by total cost, heuristic, Y, X, then the stop-node flag `m_bIsStopNode`. Existing heap and neighbor ordering determine which equal-cost predecessor wins.
- `GetMultiplePaths` additionally filters turns, minimum remaining moves, and `CanEndTurnAtNode` before constructing paths. `CvStepFinder` always permits ending at a node and assigns zero remaining moves.

Current callers are:

| Caller | Mode and constraints | Observable result |
| --- | --- | --- |
| [CvGameTrade::UpdateTradePathCache](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvTradeClasses.cpp) | Trade land/water, trade-range normalized-distance bound, unlimited turns | Cached paths used by trade and military selection |
| [CvMilitaryAI::GetArmyPathsFromCity](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvMilitaryAI.cpp) | Army land/water, unlimited turns, normalized-distance bound, ignore passage/enemies | Potential target paths |
| [CvBuilderTaskingAI::UpdateCanalPlots](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvBuilderTaskingAI.cpp) | Trade water with `MOVEFLAG_PRETEND_CANALS`, unlimited turns | Exact plots selected for canal interest |

Army destinations apply a team and alliance skip plus an adjacent-revealed filter. The same list feeds the water batch, which therefore receives inland targets too.

Trade land discounts still leave positive costs: the largest road discount is 70 plus at most 20 out of 120. Water costs start at `PATH_BASE_COST` and add penalties. Army costs use positive terrain scales. These callbacks depend on adjacent plots, player state, flags, or cached player capabilities, and remain fixed within a locked search.

`ArmyCheckTerritory` contains destination-dependent logic guarded by `HasValidDestination()`. Keeping `(-1, -1)` preserves its batch behavior. `ArmyStepValidMixed` has a start-coordinate restriction; keep that mode outside the initial allowlist. Generic same-area validity uses `IsPathDest` for city/landmass transitions. Unit callbacks have additional destination and movement-state behavior and are excluded.

## Approach and alternatives

Add an optional, call-local target set to the existing search loop. Continue using the existing heap, callbacks, absent destination, and extraction code. Stop after the final requested plot is popped, before expanding its children.

The initial allowlist is exactly `PT_TRADE_LAND`, `PT_TRADE_WATER`, `PT_ARMY_LAND`, and `PT_ARMY_WATER` on `CvStepFinder`, with `iUnitID == 0`, `iMaxTurns == INT_MAX`, `iMinMovesLeft == 0`, no approximate-target flags, and `giKnownCostWeight > 0`. All other requests use the old flood. Include canal flags because the audited water callbacks support them with positive costs.

With positive edge costs, positive known-cost weight, and `h = 0`, a popped node cannot receive a cheaper predecessor later. Retaining the heap order also preserves its existing equal-cost predecessor. A normalized-distance cutoff only removes over-budget edges and does not invalidate this argument.

Finite turn limits are excluded even for step modes. Weighted cost and turn count share one label per plot; a cheaper prefix can consume more turns, so ordinary Dijkstra finalization is insufficient to justify changing bounded-search behavior. Zero-cost callbacks are also outside this first scope because they require a separate tie and parent-finalization audit.

Alternatives:

- Repeated `GetPath` calls multiply search setup and may choose different paths through destination heuristics and validity rules.
- Changing `DestinationReached` to match any target changes callback semantics and stops at the first target.
- A target-distance heuristic adds a new ordering and proof obligation. Retaining `h = 0` is sufficient for the local improvement.
- A persistent target bitset avoids some setup allocation but adds state to reset. Begin with call-local state and profile before expanding it.

## Ordered implementation steps

1. Add the empty-list return at the beginning of `GetMultiplePaths`, before locking, configuration, sorting, or searching. Return an empty result for `!pStartPlot` before target preparation and before accessing any start coordinates. These independent guards require no search-mode allowlist.

2. In `CvAStar.h`, add a small protected data shape such as `BatchPathTargets { std::set<int> remaining; }`. Extend the internal entry point to `FindPathWithCurrentConfiguration(int startX, int startY, int destX, int destY, BatchPathTargets* targets = NULL)`. Existing calls use the default argument. The structure lives on the batch wrapper's stack and is never saved on the finder.

3. Add a documented virtual capability method on `CvPathFinder`, `CanStopBatchSearchAtSettledTargets(const SPathFinderUserData&) const`, returning false by default. Override it on `CvStepFinder` with the exact allowlist and limits above. A future mode must pass its own callback/finalization audit before joining it.

4. For eligible calls, build the target index set from the non-null destinations, removing duplicate indices. Retain the existing destination vector for extraction. Treat destination pointers as valid map plots, as current callers do; do not add a separate invalid-pointer contract. Null entries may be filtered before sorting, yielding no result for them. If no targets remain, return without searching.

5. Pass the stack-owned target state to `FindPathWithCurrentConfiguration` with destination `(-1, -1)`. After a successful `GetBest` and before `CreateChildren`, erase that plot's index. Break when the set becomes empty. This is a batch completion condition, independent of the existing single-target success boolean. Preserve callback initialization/uninitialization and the common debug/statistics epilogue.

6. Leave the normal exhaustion path unchanged when an unreachable or out-of-range target remains. Do not infer unreachability from landmass, city ownership, or ordinary movement rules. Those shortcuts can conflict with canals, foreign cities, and mode-specific allowances.

7. Continue extracting from closed nodes using the existing checks and path reconstruction. Initial implementation may retain the sorted vector lookup and erase behavior. Deduplication applies to completion counting, so duplicate requests cannot prevent termination. Include the start plot as a real target and preserve its one-node path.

8. Assert in debug builds that eligible searches have `giKnownCostWeight > 0`, popped nodes have zero heuristic, and relaxed valid edges have positive costs. Record requested/settled target counts, expansions, tested edges, and completion-versus-exhaustion. These checks should explain contract violations during development rather than silently alter production paths.

9. Verify lifecycle behavior with an immediate subsequent normal search and a subsequent batch. Early termination leaves open nodes, and `Reset` already clears both open and closed lists. Keep that cleanup contract intact and keep all target state local.

Use purpose comments on new functions and `// Vox Deorum:` on Community Patch modifications outside `CvConnectionService`. No caller API change or persistent cache is needed.

## Examples, estimates, and effort

The following are analytical examples, not measured results or whole-turn speedup predictions.

| Scenario | Existing work | Expected target-aware work |
| --- | --- | --- |
| Army origin with no revealed foreign city | One bounded land flood and one bounded water flood per origin | Zero expansions |
| Three nearby targets, all settled within 400 of 5,000 reachable nodes | About 5,000 pops plus extraction scan | About 400 pops plus the smaller scan, approximately 92% fewer pops |
| Nine nearby targets and one unreachable city | Entire bounded flood | Entire bounded flood plus target bookkeeping |
| Every requested target is the start plot | Entire bounded flood | One pop and a one-node result |

For a roughly uniform unobstructed hex region, radius 30 contains `1 + 3r(r+1) = 2,791` plots, while radius 10 contains 331. Targets contained in the smaller settled region could remove about 88% of pops. Weighted terrain, range limits, coasts, and unavailable targets change this substantially.

The second and fourth rows are hypothetical shapes rather than caller behavior. In practice, trade and canal batches always carry every city on the map, including the origin city itself, and the army water batch carries the same inland list as the land batch. A single unreachable or inland target keeps such a batch running to exhaustion, so the realistic early-stop rate is low. The empty-list guard applies only to the army caller and saves both domain floods for an origin. Record completion rates separately for every caller and movement mode. The 92% example describes successful-batch node reduction, with no measured whole-turn estimate. Simulator extraction excludes trade modes, so its timings cannot establish trade/canal savings.

Expected engineering effort: 2 to 4 developer days for the guard, local target-state plumbing, callback audit assertions, and a differential probe; another 1 to 2 days for representative save runs and profiling. New generic shortest-path infrastructure is unnecessary.

## Risks and open questions

- Preserve equal-cost plot choices exactly. Canal marking and trade paths consume plot sequences, so matching only cost or reachability is inadequate.
- Unreachable targets can erase the performance benefit. Measure completion frequency before considering target pruning as a separate change.
- Global cost weights currently default to one. The explicit positive known-cost-weight gate preserves cost order; zero heuristic makes the heuristic weight irrelevant for enabled batches.
- The existing narrow turn fields and integer cost arithmetic are inherited constraints. Do not use this optimization to change their overflow behavior or claim correctness beyond supported game sizes.
- Filtering null destinations is an explicit harmless extension for the new preparation step; invalid non-null pointers remain outside the API contract.

## DLL verification

No established C++ unit-test runner is assumed. Add a temporary debug-only comparison probe or debugger-driven harness that executes both the legacy full flood and optimized batch against the same locked game state, with no intervening gameplay changes. Copy results before the second run overwrites finder state.

Compare map keys, complete `SPathNode` sequences, costs, normalized distance, turns, and configuration fields explicitly. `SPathFinderUserData::operator==` omits several fields and cannot serve as the sole comparison. Generated slice must match when probes run within the same slice.

Cover empty, null-start, duplicate, null-filtered, start-only, equal-cost diamond, disconnected, out-of-range, and all-reachable targets; trade road/railroad discounts; coastal and ocean restrictions; enemy-city entry versus transit; existing and pretend canals; and army flags. Confirm finite-turn, unit, approximate, generic, mixed-army, and nonpositive-known-cost-weight requests stay on the legacy path. Run another search after early exit to detect stale nodes or target state.

Build from `civ5-dll/` using `python build_vp_clang_sdk.py --config release` for compile-only verification. When deployment is requested, use `powershell -Command "& .\build-and-copy.bat"` and run representative Civ V saves. Capture per-mode call counts, empty batches, early completion rate, nodes, and elapsed time with probes disabled for timings. Repeat identical saves/settings and compare trade cache paths, target choices, and canal plot sets.

## Out of scope

Unit path semantics, finite-turn multi-label search, destination heuristics, target pruning, trade-range changes, canal scoring, persistent cross-search caching, and changes to military target selection.
