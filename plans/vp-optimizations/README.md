# VP optimization plans

These drafts cover pathfinding and native rollout opportunities in the current VD checkout of VP. Plans 1–6 cover the pathfinding review; plans 7–14 cover the October 27 native rollout review. No production changes or new runtime benchmarks accompany these plans. Simulator-owned work has separate [VD RL optimization plans](../../../vox-deorum-rl/plans/optimizations/README.md).

| Plan | Main opportunity | Behavior to evaluate |
| --- | --- | --- |
| [1. Canal planning refresh](1-canal-planning-refresh.md) | Reuse canal recommendations between scheduled refreshes. | Recommendation freshness and the score bonus for preserving canals. |
| [2. Lazy worker reachability](2-lazy-worker-reachability.md) | Build a worker's travel estimate only when directive scoring needs it. | The world state observed when an estimate is first calculated. |
| [3. Target-aware batch search](3-target-aware-batch-search.md) | Skip empty requests and stop eligible searches after all targets are settled. | Preserve results and path sequences for the supported modes. |
| [4. City connection search](4-city-connection-search.md) | Specialize connectivity traversal and reduce repeated city-pair searches. | Reachability, traversal order, and the exact plots marked as connected. |
| [5. Lightweight path queries](5-lightweight-path-queries.md) | Return scalar results without allocating a full path; reuse repeated local queries. | Existing turn conventions, failure results, and squad rerouting. |
| [6. Approximate candidate ranking](6-approximate-candidate-ranking.md) | Spend detailed unit searches on promising assignment candidates. | Selected units, travel time, and fallback behavior. |
| [7. Exploration range copies](7-exploration-range-copies.md) | Read cached plot ranges without copying vectors. | Range-buffer lifetime and unchanged exploration scores. |
| [8. Path extra children](8-path-extra-children.md) | Skip plot/unit lookup when no extra movement capability applies. | Cleared outputs and actual airlift/port behavior. |
| [9. Neutral unit query](9-neutral-unit-query.md) | Reuse the visible-plot query already computed. | Preserve the separate invisible-plot query. |
| [10. Exploration set reuse](10-exploration-set-reuse.md) | Reuse merged exploration candidates within an unchanged attempt. | Domain merge precedence and sight-changing missions. |
| [11. Carrier cargo counts](11-carrier-cargo-counts.md) | Avoid repeated aircraft-list scans where measurement justifies caching. | Mutable tactical positions, carrier identity and untracked cargo. |
| [12. Air-state equality](12-air-state-equality.md) | Avoid allocations for common damage-record shapes. | Exact equality, ignored zeros and duplicate entries. |
| [13. Army target lists](13-army-target-lists.md) | Build the same enemy-city target list once per update. | Preserve target order and native reach-query settings. |
| [14. Explorer reach reuse](14-explorer-reach-reuse.md) | Investigate repeated expanding-horizon searches. | Research gate for finite-turn labels and path tie behavior. |

## Suggested order

The new narrow first batch is plans 7–9. Plan 13 is another contained caller-side change; measure its list-building share. Plans 10–12 need explicit lifetime or mutation coverage. Plan 14 remains a feasibility investigation. These changes can be evaluated independently of the broader pathfinding order below.

1. Capture the baseline below, then implement the empty-target guard in plan 3 and the scalar-query portion of plan 5. These have narrow behavioral contracts.
2. Evaluate plans 1 and 2 independently. Their savings depend on how frequently recommendations are consumed and how many workers need new assignments.
3. Implement the eligible multi-target stopping in plan 3, then the independently shippable connectivity work in plan 4. Coordinate changes to the shared search loop.
4. Evaluate plan 6 after exact-query costs have been reduced. Retain the exhaustive selector for comparison and fallback as specified in that plan.
5. Treat the city-pair tree portion of plan 4 as a separate decision if it changes the connected-plot set.

## Shared measurement baseline

Use the same release build settings and representative saved positions for each comparison: an early empire, a peaceful empire with many workers and cities, a contested front, and a late empire with railroads and sea routes. Repeat a fixed workload from each save. Separate load-time cache reconstruction from subsequent updates.

Measure the relevant caller's total elapsed time and search count, expanded nodes, visited plots, path reconstruction work, cache hits and misses, and whole-player-turn elapsed time. Include failed queries and destination-free floods. The detailed slow-search logging in `CvAStar::FindPathWithCurrentConfiguration` is restricted to a subset of targeted unit searches, so it cannot establish the aggregate baseline on its own.

Add only the diagnostic counters needed for the selected plan, behind the existing debugging mechanism, and keep them out of saved game state. Use aggregate records rather than logging every expanded node. Capture result equivalence or decision differences as well as timing. Preserve deterministic ordering and record any intentional change to it.

Numerical examples in plans 1–6 are analytical scenarios. Plans 7–14 also cite the [rollout evidence baseline](../../../vox-deorum-rl/plans/optimizations/evidence.md), including an October 24 archived profile with 2,830 samples. Its sample shares describe that workload, and an inclusive function share is only an affected-cost envelope. Every proposed saving remains conditional. Replace assumed costs, counts and hit rates with measurements before making a speedup claim. If a subsystem consumes a fraction `f` of total turn time and its time falls by a fraction `r`, the total turn-time reduction is approximately `f * r`, before new overhead. For example, removing half the work from a subsystem that consumes 8% of the turn saves approximately 4% of turn time. Savings from plans that affect the same calls must not be added independently.

Engineering estimates assume one developer familiar with the DLL and a working toolchain. Extended gameplay evaluation and unrelated build repairs can add time. Each plan gives its own scope and uncertainty.

## Implementation conventions

Follow the root `AGENTS.md`. New or changed functions need purpose comments; VP modifications outside `CvConnectionService` use the `// Vox Deorum:` prefix. Keep data structures compatible with the repository's DLL toolchain. Do not stage changes unless requested.

Build and gameplay verification belong to implementation. The plans describe future checks; no build or deployment is required to review these Markdown drafts. The repository's DLL build-and-copy command also deploys the DLL, while the build-only alternative is documented in each plan where needed.

For extracted functions, use the simulator's [interleaved build comparison](../../../vox-deorum-rl/docs/validation/native-profiling.md) and [shared verification workflow](../../../vox-deorum-rl/plans/optimizations/README.md) as additional evidence. Keep maintained native code compatible with the DLL and regenerate extracted outputs normally. Runtime declarations and extraction selectors may need updates when a signature changes. Never implement a VP optimization by editing generated simulator code.
