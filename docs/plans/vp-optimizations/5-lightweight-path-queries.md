# Lightweight path results without route materialization

**Status:** Low payoff. The change is exact, but route materialization is small next to the A* search it follows.

## Goal and success criteria

Answer existence, length, and unit arrival queries without constructing a route that the caller discards.

- Existing public return values, movement flags, bounds, selected destinations, and route execution behavior remain identical.
- Existence and arrival queries allocate no `SPath::vPlots` storage. Plot-count queries walk the selected parent chain without storing or reversing it.
- Measure allocations, reconstructed nodes, search counts, and CPU time separately. A scalar query still performs the same A* search.

## Current state

Source links are relative to this plan directory:

- [CvAStar.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStar.cpp): `CvPathFinder::DoesPathExist`, `GetPathLengthInPlots`, and `GetPathLengthInTurns` call `GetPath`, construct `SPath`, and discard its plot vector. `DoesPathExist` and `GetPathLengthInPlots` have few loop callers, and `GetPathLengthInTurns` has none outside this file, so the wrappers themselves are a small part of the benefit.
- In the same file, `GetPath` holds the game-core lock around `Configure`, `FindPathWithCurrentConfiguration`, and `GetCurrentPath`. `GetCurrentPath` copies configuration, walks parents, appends `SPathNode` values, and reverses the vector. It does not reserve that vector, so its storage grows geometrically as nodes are appended.
- [CvAStar.h](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStar.h): `TurnCountMode` distinguishes game-core, UI, and debug node conventions. Public length wrappers use the default game-core route.
- [CvAStarNode.h](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStarNode.h): `SPath::iTotalTurns` includes an extra turn when terminal moves are zero. `SPathNode` stores narrowed `short` turns and moves. `SPathFinderUserData::operator==` deliberately ignores several bounds and other fields.
- [CvUnit.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvUnit.cpp): both `TurnsToReachTarget` overloads eventually call `ComputePath(..., false)`. They do not populate the execution route cache. These calls, in garrison selection, recruitment, army AI and tactical AI, are the hot callers, so the uncached unit evaluation in step 4 carries most of the benefit.
- `TurnsToReachTarget` already handles null targets, a normalized minimum turn bound of one, a route-aware range check, approximate target rings, and the current-plot shortcut. Preserve these checks and their order.
- `ComputePath` constructs a full path even when `bCacheResult` is false. Its return uses the last node's game-core turns, adding one only for `MOVEFLAG_TURN_END_IS_NEXT_TURN` with no moves remaining.
- `ComputePath` can redirect `MOVEFLAG_CONTINUE_TO_CLOSEST_PLOT` through the previous route. With squads, it searches the original destination, scores alternate ring plots by full-path cost, then searches the chosen alternative again.
- `GeneratePath` caches the latest successful execution route. `ComputePath(..., true)` clears the old cache and records origin, destination, flags, and turn slice only on success. Despite a nearby comment, failed paths are not retained as reusable results.
- Concrete scalar consumers include `CityStrategyAIHelpers::IsTestCityStrategy_PocketCity`, `CvAIOperation::GetStepDistanceBetweenPlots`, `CvHomelandAI::GetBestUnitToReachTarget`, and `CvAIOperation::GrabUnitsFromTheReserves`. They need no route from these particular queries.

## Approach and alternatives

Add a small result API over the existing search. Keep the same search algorithm, callback initialization/uninitialization, locking, and success rules. Existing wrappers delegate to it without changing their signatures.

Read each result directly from the selected node instead of caching evaluations. A per-call or turn-wide memo would require invalidation for movement, occupancy, diplomacy, routes, danger, visibility, embarkation, and squad state, and no scalar consumer here repeats the same question inside one calculation. A reusable execution route would cost more storage and carry different ownership and validity rules. Neither is worth carrying for this change.

A multi-target search can reduce A* work for some callers, but it changes search shape and belongs in a separate plan. This change removes result materialization only.

## Ordered implementation

### 1. Add an explicit result contract

In `CvAStarNode.h`, add `SPathQueryResult` with:

| Field | Meaning |
| --- | --- |
| `bool bFound` | Successful search with a non-null selected node that is not its own parent |
| `SPathNode terminal` | Actual selected endpoint, game-core turns, moves, and stop-node status |
| `int iTotalCost` | Same known cost as `SPath::iTotalCost` |
| `int iTotalTurns` | Same raw-node calculation as `SPath::iTotalTurns` |
| `int iPlotCount` | Count requested by the caller, otherwise `-1` |

Default failure fields to invalid values. A result owns values and never exposes `CvAStarNode*`. The actual endpoint may differ from the requested destination under approximate movement flags.

Keep `terminal` as `SPathNode` so `ComputePath` preserves the existing narrowed-node return convention. Do not silently replace its return with `iTotalTurns`.

### 2. Extract result reading inside the locked search

In `CvAStar.h/.cpp`, add:

- `CvAStar::GetCurrentPathResult(bool bCountPlots) const`.
- Coordinate and plot overloads of `CvPathFinder::GetPathResult(..., const SPathFinderUserData& data, bool bCountPlots = false)`.

`GetPathResult` mirrors the existing `GetPath` lock/configure/search sequence. Read the result before releasing the lock, and do not inspect a stale `m_pBest` when configure or search fails.

For existence, define `bFound = successfulSearch && m_pBest != NULL && m_pBest->m_pParent != m_pBest`. This is an O(1) selected-node check, with no parent-chain walk. The normal start node has a null parent, so start equals destination remains a found one-node path. Read cost and terminal turns directly when found. For requested plot counts, walk parents with the same self-parent and increasing-turn failsafes as `GetCurrentPath`.

The count is the number of reconstructed nodes, including the origin and any stop nodes. It is not hex distance, number of edges, or terminal turn count. A normal start-equals-destination path has one node.

Use a small shared reader where practical to keep full-route and scalar calculations consistent. Do not add a general result-mode framework or change `GetCurrentPath(TC_UI/TC_DEBUG)`.

### 3. Replace materializing wrappers

- `DoesPathExist`: return `bFound` without parent traversal or vector allocation.
- `GetPathLengthInTurns`: return `iTotalTurns`, otherwise `-1`.
- `GetPathLengthInPlots`: request a count and return it, otherwise `-1`.
- Preserve plot-overload null behavior and all existing public signatures.

These changes immediately benefit the existing strategy, operation-distance, Lua, and DLL existence callers. Leave callers that consume path plots, first hops, route safety, or build-route values on `GetPath`.

### 4. Make uncached unit evaluation scalar

In `CvUnit::ComputePath`, route each search through a small private evaluator that can return `SPathQueryResult` and optionally fill an `SPath` when `bCacheResult` is true.

Preserve the existing destination-resolution and squad-selection control flow. In full-route mode, keep the existing cache replacement and `m_kLastPath` copying, including the final full-route search of a selected squad alternate. That search replaces the last ring candidate's path with the winner's path before publication. In scalar mode, avoid `SPath` construction and leave all unit execution-cache members unchanged.

Keep these distinct quantities explicit:

- Squad alternate eligibility uses `iTotalTurns`, including the existing `> 2` restriction near the target.
- Squad ranking uses `iTotalCost`, with existing stable order and ring stopping rules.
- The returned unit arrival count uses `terminal.turns`, with the existing flag-dependent increment for zero `terminal.moves`.

Snapshot the resolved previous-route endpoint before evaluation when `MOVEFLAG_CONTINUE_TO_CLOSEST_PLOT` applies. Keep the original requested target, squad destination, chosen requested alternate, and actual approximate endpoint distinct.

Use code compatible with the DLL's supported compilers. Give added functions purpose comments and mark modifications with `// Vox Deorum:`.

## Examples and unmeasured estimates

All figures below are analytic examples, not benchmark results.

- For 2,000 scalar queries with 18 reconstructed nodes each, the existing code emits 36,000 `SPathNode` elements and reverses 2,000 vectors. The new scalar arrival/existence paths emit zero elements. Plot-count queries still traverse those nodes.
- If reconstruction accounts for 5% of a batch's time and scalar extraction removes 80% of that portion, batch time falls about 4%. Multiply by the batch's measured share of the whole workload for an overall estimate. The rollout evidence's recorded-state reconstruction category does not measure this path reconstruction.

Scalar extraction applies to maintained simulator queries, where locking is stubbed. The search dominates these calls, so expect modest savings; broad or failed searches retain nearly all their cost. Measure elapsed time saved separately from eliminated allocations, whose costs can differ.

Estimated effort: 2 to 4 engineer-days for result extraction and wrappers, 1 to 2 for unit integration and regression checking, plus 1 to 2 for in-game comparisons, including maintained native declarations and selectors where applicable.

## Risks and open questions

- `GetCurrentPath` has defensive parent-chain behavior. Scalar success and counts must preserve it, including stop nodes and a self-parent terminal.
- The two arrival conventions differ exactly at exhausted movement. An off-by-one error affects recruitment, garrisons, and civilian timing.
- Bounds and route-aware rejection in `TurnsToReachTarget` have existing edge behavior. This plan preserves it; fixes need separate review.
- Exact speedup and how often these callers run remain unknown until counters are collected.

## Verification

1. Build the DLL with `python build_vp_clang_sdk.py --config release` from `civ5-dll/`. Follow [DEVELOPMENT.md](../../../civ5-dll/DEVELOPMENT.md) and the supported MSVC build before upstream submission; check both compilers for new warnings.
2. Use a temporary debug comparison mode to run old full-route and new scalar queries consecutively in a locked, unchanged game state. Compare found status, plot count where requested, total cost/turns, terminal coordinates/moves, and `ComputePath(false)` return values.
3. Cover start equals destination, null plot wrappers, unreachable islands, invalid destinations, stop nodes, zero movement at arrival, current moves partly spent, roads/railroads, embark/disembark, danger/ZOC/stacking flags, approximate rings, and finite versus unlimited bounds. Include a debug-triggered `m_iDestHitCount > 2` fallback-node case and compare scalar status/count/terminal values with full reconstruction.
4. Assert that scalar calls leave all execution-cache fields and path nodes unchanged. Verify civilian route safety and mission continuation still receive full routes.
5. Record scalar query counts, reconstructed nodes, A* calls, and time on identical saves. Compare several crowded mid/late-game AI turns. Turn summaries can use existing DLL logging; avoid per-node release logging.

There is no identified standalone C++ unit-test harness for these paths. npm tests do not validate DLL path semantics. For in-game deployment, use the repository's `powershell -Command "& .\build-and-copy.bat"` from `civ5-dll/`; this builds and copies the DLL. Run comparison instrumentation separately from release timing.

## Out of scope

Global invalidation, persistent or serialized query caches, changing failed execution-route caching, new movement heuristics, altered legality or squad policy, approximate ranking, graph reversal, and replacing route-producing callers with scalar answers. Keep `GetMultiplePaths`' separately assigned turn metadata unchanged. Squad reroute memoization is also out of scope: squads are off by default (`SQUADS` is 0 in Community Patch `NewCustomModOptions.xml`, and only the optional Squads for VP package turns them on), so such a memo would have no effect in a default game.
