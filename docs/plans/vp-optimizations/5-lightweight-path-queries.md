# Lightweight path results and evaluation reuse

## Goal and success criteria

Answer existence, length, and unit arrival queries without constructing a route that the caller discards. Reuse evaluated destinations within one squad reroute calculation, including failed searches.

- Existing public return values, movement flags, bounds, selected destinations, and route execution behavior remain identical.
- Existence and arrival queries allocate no `SPath::vPlots` storage. Plot-count queries walk the selected parent chain without storing or reversing it.
- A squad arrival evaluation searches each requested destination at most once within that evaluation.
- Measure allocations, reconstructed nodes, search counts, and CPU time separately. A scalar query still performs the same A* search.

## Current state

Source links are relative to this plan directory:

- [CvAStar.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStar.cpp): `CvPathFinder::DoesPathExist`, `GetPathLengthInPlots`, and `GetPathLengthInTurns` call `GetPath`, construct `SPath`, and discard its plot vector.
- In the same file, `GetPath` holds the game-core lock around `Configure`, `FindPathWithCurrentConfiguration`, and `GetCurrentPath`. `GetCurrentPath` copies configuration, walks parents, appends `SPathNode` values, and reverses the vector.
- [CvAStar.h](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStar.h): `TurnCountMode` distinguishes game-core, UI, and debug node conventions. Public length wrappers use the default game-core route.
- [CvAStarNode.h](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStarNode.h): `SPath::iTotalTurns` includes an extra turn when terminal moves are zero. `SPathNode` stores narrowed `short` turns and moves. `SPathFinderUserData::operator==` deliberately ignores several bounds and other fields.
- [CvUnit.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvUnit.cpp): both `TurnsToReachTarget` overloads eventually call `ComputePath(..., false)`. They do not populate the execution route cache.
- `TurnsToReachTarget` already handles null targets, a normalized minimum turn bound of one, a route-aware range check, approximate target rings, and the current-plot shortcut. Preserve these checks and their order.
- `ComputePath` constructs a full path even when `bCacheResult` is false. Its return uses the last node's game-core turns, adding one only for `MOVEFLAG_TURN_END_IS_NEXT_TURN` with no moves remaining.
- `ComputePath` can redirect `MOVEFLAG_CONTINUE_TO_CLOSEST_PLOT` through the previous route. With squads, it searches the original destination, scores alternate ring plots by full-path cost, then searches the chosen alternative again.
- `GeneratePath` caches the latest successful execution route. `ComputePath(..., true)` clears the old cache and records origin, destination, flags, and turn slice only on success. Despite a nearby comment, failed paths are not retained as reusable results.
- Concrete scalar consumers include `CityStrategyAIHelpers::IsTestCityStrategy_PocketCity`, `CvAIOperation::GetStepDistanceBetweenPlots`, `CvHomelandAI::GetBestUnitToReachTarget`, and `CvAIOperation::GrabUnitsFromTheReserves`. They need no route from these particular queries.

## Approach and alternatives

Add a small result API over the existing search. Keep the same search algorithm, callback initialization/uninitialization, locking, and success rules. Existing wrappers delegate to it without changing their signatures.

Use one per-call evaluation cache only in the scalar squad reroute branch of `ComputePath`. The current winning alternative is demonstrably queried during ranking and again when returning the answer. This gives the cache an immediate consumer. Ordinary scalar unit queries need no memo table.

An all-turn unit memo would require invalidation for movement, occupancy, diplomacy, routes, danger, visibility, embarkation, and squad state. Its complexity is unnecessary here. A reusable execution route also costs more storage and has different ownership and validity rules.

A multi-target search can reduce A* work for some callers, but it changes search shape and belongs in a separate plan. This change removes result materialization and one local duplicate search.

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

Preserve one destination-resolution and squad-selection control flow. In full-route mode, keep the existing cache replacement and `m_kLastPath` copying, including the final full-route search of a selected squad alternate. That search replaces the last ring candidate's path with the winner's path before publication. In scalar mode, avoid `SPath` construction and leave all unit execution-cache members unchanged.

Keep these distinct quantities explicit:

- Squad alternate eligibility uses `iTotalTurns`, including the existing `> 2` restriction near the target.
- Squad ranking uses `iTotalCost`, with existing stable order and ring stopping rules.
- The returned unit arrival count uses `terminal.turns`, with the existing flag-dependent increment for zero `terminal.moves`.

Snapshot the resolved previous-route endpoint before evaluation when `MOVEFLAG_CONTINUE_TO_CLOSEST_PLOT` applies. Keep the original requested target, squad destination, chosen requested alternate, and actual approximate endpoint distinct.

### 5. Reuse only the local squad evaluations

Guard all local memo construction, lookup, insertion, and final-result reuse with `if (!bCacheResult)`, and activate it only for squad rerouting. Create a local vector of `{ requestedDestinationIndex, result }`. The scalar evaluator first checks this vector and inserts every answer, including `bFound == false`. Full-route mode never consults this memo.

Within this call, unit identity, origin, current moves, embarkation, promotions, squad membership/destination, prior route, flags, player/enemy context, ZOC exclusions, and every search bound remain fixed. Destination is therefore the only varying key field. Document this invariant beside the vector. Hold the game-core lock across this complete scalar squad evaluation, acquiring and releasing it only if the caller did not already hold it, so another game-core entry cannot mutate the state between lookups.

Do not use `SPathFinderUserData::operator==` as a cache key. If the helper is later allowed to change flags, origin, start moves, or bounds, split the cache scope or include those full values explicitly. A failure under a short bound must never answer a longer-bound query.

Only inside `if (!bCacheResult)`, the final lookup of the selected alternate uses its requested destination key and returns its stored scalar result. Existing initial failure/ring retries can reuse negative results where their requested endpoints match. When `bCacheResult` is true, preserve the final winning-destination search and cache the resulting full route, even when that destination was already evaluated during ranking.

Construct and destroy the vector within `ComputePath`; retain it only when squad rerouting actually runs. There are no missions, unit movement, or map mutation between these lookups. Search scratch state and diagnostic search counts can change, but no execution route is published.

Use code compatible with the DLL's supported compilers. Give added functions purpose comments and mark modifications with `// Vox Deorum:`.

## Examples and unmeasured estimates

All figures below are analytic examples, not benchmark results.

- For 2,000 scalar queries with 18 reconstructed nodes each, the existing code emits 36,000 `SPathNode` elements and reverses 2,000 vectors. The new scalar arrival/existence paths emit zero elements. Plot-count queries still traverse those nodes.
- If reconstruction accounts for 5% of a batch's time and scalar extraction removes 80% of that portion, the batch improves by about 4%. This does not imply a 4% whole-turn improvement.
- If a squad reroute evaluates 10 alternatives and then re-searches its winner, memo reuse removes one of those 11 searches, about 9% for that portion. The initial squad search is additional work. When no reroute runs, the memo saves no searches.
- A first failure to the original target can also avoid a matching retry, but only with identical scope and bounds. Do not assume repeated failures occur often.
- A tiny vector costs one result per evaluated destination and disappears on return. Measure whether allocation overhead outweighs reuse in small rings; reserve modest ring capacity if justified.

Estimated effort: 2 to 4 engineer-days for result extraction and wrappers, 2 to 3 for unit/squad integration and regression checking, plus 1 to 2 for in-game comparisons. Expected payoff is modest unless profiling shows reconstruction or squad reroutes are frequent.

## Risks and open questions

- `GetCurrentPath` has defensive parent-chain behavior. Scalar success and counts must preserve it, including stop nodes and a self-parent terminal.
- The two arrival conventions differ exactly at exhausted movement. An off-by-one error affects recruitment, garrisons, and civilian timing.
- Bounds and route-aware rejection in `TurnsToReachTarget` have existing edge behavior. This plan preserves it; fixes need separate review.
- Skipping a redundant search changes the singleton finder's last scratch result. Audit direct consumers of `GetCurrentPath` and finder scratch state before relying on memo hits. The returned scalar result must be self-contained.
- Negative reuse is safe only inside the fixed, non-mutating evaluation. The local table must never become a turn-wide or static cache by convenience.
- Exact speedup and squad-reroute prevalence remain unknown until counters are collected.

## Verification

1. Build the DLL with `python build_vp_clang_sdk.py --config release` from `civ5-dll/`. Follow [DEVELOPMENT.md](../../../civ5-dll/DEVELOPMENT.md) and the supported MSVC build before upstream submission; check both compilers for new warnings.
2. Use a temporary debug comparison mode to run old full-route and new scalar queries consecutively in a locked, unchanged game state. Compare found status, plot count where requested, total cost/turns, terminal coordinates/moves, and `ComputePath(false)` return values.
3. Cover start equals destination, null plot wrappers, unreachable islands, invalid destinations, stop nodes, zero movement at arrival, current moves partly spent, roads/railroads, embark/disembark, danger/ZOC/stacking flags, approximate rings, and finite versus unlimited bounds. Include a debug-triggered `m_iDestHitCount > 2` fallback-node case and compare scalar status/count/terminal values with full reconstruction.
4. Exercise squads with a blocked target, a valid original target, a selected alternate, no valid alternate, a squad destination different from the mission target, and a previous cached route used by `CONTINUE_TO_CLOSEST_PLOT`.
5. Assert that scalar calls leave all execution-cache fields and path nodes unchanged. Run `GeneratePath` for a squad with `CONTINUE_TO_CLOSEST_PLOT` where the selected alternate differs from the last tested ring candidate; verify the published route and first-turn endpoint belong to the selected winner. Then verify civilian route safety and mission continuation still receive full routes.
6. Record scalar query counts, reconstructed nodes, local positive/negative hits, A* calls, and time on identical saves. Compare several crowded mid/late-game AI turns with squads enabled and disabled. Turn summaries can use existing DLL logging; avoid per-node release logging.

There is no identified standalone C++ unit-test harness for these paths. npm tests do not validate DLL path semantics. For in-game deployment, use the repository's `powershell -Command "& .\build-and-copy.bat"` from `civ5-dll/`; this builds and copies the DLL. Run comparison instrumentation separately from release timing.

## Out of scope

Global invalidation, persistent or serialized query caches, changing failed execution-route caching, new movement heuristics, altered legality or squad policy, approximate ranking, graph reversal, and replacing route-producing callers with scalar answers. Keep `GetMultiplePaths`' separately assigned turn metadata unchanged.
