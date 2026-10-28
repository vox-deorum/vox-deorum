# VP optimization plans

These drafts cover pathfinding and native rollout opportunities in the current VD checkout of VP. Plans 1–6 cover the pathfinding review; plans 7–14 cover the October 27 native rollout review. No production changes or new runtime benchmarks accompany these plans. Simulator-owned work has separate [VD RL optimization plans](../../../../vox-deorum-rl/plans/optimizations/README.md).

## Savings

All figures below are analytical operation counts, hypothetical time reductions, or archived affected-cost envelopes. No proposed change has a measured current speedup. Fallback and overhead can make gains zero or negative. Plans 1/3 share canal searches, plans 5/6 share arrival queries, and plans 8/9 remove work inside searches other plans can eliminate. Measure combinations rather than adding their percentages.

Runtime scope limits rollout evidence. Plans 1, 4 and 13 have no direct current simulator saving: builder planning is omitted, city connections are captured, and the military methods are not selected. Plan 2 uses captured worker/directive pairings; plan 3's simulator step finder excludes trade families; plan 5's scalar work applies while squads are disabled and locking is stubbed. DLL comparisons cover those missing behaviors. Recorded-state reconstruction does not measure path materialization, and simulator city-distance timing does not measure DLL city connections.

| Plan | Removable work or conditional local saving | Whole-workload evidence and runtime scope |
| --- | --- | --- |
| [1. Canal planning refresh](1-canal-planning-refresh.md) | Stable cadence removes about 83% of origin searches. Snapshots and forced refreshes reduce or erase the saving. | Canal planning's turn-time share is unmeasured. No direct current simulator saving. |
| [2. Lazy worker reachability](2-lazy-worker-reachability.md) | Maps fall from gathered workers `W` to queried workers `Q` plus rebuilds `R`. Querying 8 of 20 workers with no rebuilds removes 60% of searches. | A first viable directive can still query nearly every worker. Captured scoring cannot establish DLL query ratios or assignment quality. |
| [3. Target-aware batch search](3-target-aware-batch-search.md) | Empty batches remove an entire flood. Successful analytical examples remove 88% to 92% of pops. Unreachable targets retain the flood plus bookkeeping. | Completion frequency and workload share are unmeasured. Simulator trade/canal modes are excluded. |
| [4. City connection search](4-city-connection-search.md) | Stage A removes heap work but retains initialization, callbacks and sorting. A compatible Stage B example replaces 190 pair searches with 19 trees, 90% fewer invocations. | Dense floods can benefit; sparse networks and full trees can regress. No direct current simulator saving. |
| [5. Lightweight path queries](5-lightweight-path-queries.md) | Scalar results avoid path storage/reversal. Squad reuse removes one of 11 searches in the example, about 9% of that portion. | Assuming materialization takes 5% of batch time and falls 80% gives 4% less batch time. Simulator scalar work applies; squads are disabled. |
| [6. Approximate candidate ranking](6-approximate-candidate-ranking.md) | Examples remove 60% to 80% of garrison arrival calls and 60% to 87% of recruitment calls before fallback. | Actual searches saved, bypasses, ties and decision regret need measurement. Some calls already reject cheaply; full fallback saves none. |
| [7. Exploration range copies](7-exploration-range-copies.md) | Removes three vector assignments and caller-owned storage per initiation. | Historical copy/destruction envelope: 43/2,830 samples, 1.52%. Removing an assumed 50% gives 0.76% less historical workload time. Applies to both runtimes. |
| [8. Path extra children](8-path-extra-children.md) | Disabled callbacks skip plot and owner/unit resolution. | Entire callback: 0.53% historically. Assuming 80% is removable lookup time gives 0.42% less historical workload time. Applies to both runtimes. |
| [9. Neutral unit query](9-neutral-unit-query.md) | Removes one query per newly cached flag-enabled node; invisible queries only save a visibility check. | Entire updater: 4.49% historically. Assuming redundant queries take 10% gives 0.45% less historical workload time. Applies to both runtimes. |
| [10. Exploration set reuse](10-exploration-set-reuse.md) | Avoids zero to four merged-set constructions per attempt, up to 80% of that work. | Only one archived merge sample. Assuming construction takes 0.5% of selection time and falls 80% gives 0.4% less selection time. Applies to both runtimes. |
| [11. Carrier cargo counts](11-carrier-cargo-counts.md) | Four eligible scores reduce roster visits from 320 to 80 plus map work, a 75% scan reduction. Short passes can regress. | No isolated cost share. If scans take 1% of final-validation time and fall 75%, validation saves 0.75% before overhead. Bundled simulator finalization applies. |
| [12. Air-state equality](12-air-state-equality.md) | Singleton pairs avoid two backing allocations. Empty pairs already allocate none; multi-entry pairs pay an extra scan. | No isolated timing. Assuming the helper takes 2% of search time and falls 50% gives 1% less search time. Applies to both runtimes. |
| [13. Army target lists](13-army-target-lists.md) | With 12 muster cities, 24 collection passes become one, about 96% fewer. All path batches and private destination copies remain. | Assuming collection takes 2% of update time gives about 1.9% less update time. No direct current simulator saving. |
| [14. Explorer reach reuse](14-explorer-reach-reuse.md) | Perfect continuation saves about 38% of expansions in the example. Intervening finder use invalidates borrowed state; exact reuse remains research. | Entire caller reach work: 92/2,830 samples, 3.25%. Removing an assumed 30% gives 0.98% less historical workload time; only eligible repeated work is removable. |

## Suggested order

1. Start with plans 7–9, plan 3's empty-target guard, and plan 5's scalar readers and wrappers. These are contained changes with narrow contracts.
2. Measure plans 1–4 before broader work: canal time and forced refreshes, the worker queried-to-gathered ratio, batch completion rates by caller/domain, and city-connection phase time including sparse networks. Decide nonempty batch stopping and city-pair trees independently from those results.
3. Gate plan 6 on reduced exact-query costs, bypass/fallback rates and decision quality. Retain its exhaustive selector for comparison and fallback. Gate plan 11 on meaningful repeated eligible ship-scoring cost. Treat plans 10, 12 and 13 as contained opportunities whose absolute payoff needs measurement.
4. Keep plan 14 as research. Retain independent floods unless exact continuation and a worthwhile saving are established.

## Shared measurement baseline

Use the same release build settings and representative saved positions for each comparison: an early empire, a peaceful empire with many workers and cities, a contested front, and a late empire with railroads and sea routes. Repeat a fixed workload from each save. Separate load-time cache reconstruction from subsequent updates.

Measure the relevant caller's total elapsed time and search count, expanded nodes, visited plots, path reconstruction work, cache hits and misses, and whole-player-turn elapsed time. Include failed queries and destination-free floods. The detailed slow-search logging in `CvAStar::FindPathWithCurrentConfiguration` is restricted to a subset of targeted unit searches, so it cannot establish the aggregate baseline on its own.

Add only the diagnostic counters needed for the selected plan, behind the existing debugging mechanism, and keep them out of saved game state. Use aggregate records rather than logging every expanded node. Capture result equivalence or decision differences as well as timing. Preserve deterministic ordering and record any intentional change to it.

Numerical examples in plans 1–6 are analytical scenarios. Plans 7–14 also cite the [rollout evidence baseline](../../../../vox-deorum-rl/plans/optimizations/evidence.md), including an October 24 archived profile with 2,830 samples. Its sample shares describe that workload, and an inclusive function share is only an affected-cost envelope. Every proposed saving remains conditional. Replace assumed costs, counts and hit rates with measurements before making a speedup claim. If a subsystem consumes a fraction `f` of total turn time and its time falls by a fraction `r`, the total turn-time reduction is approximately `f * r`, before new overhead. For example, removing half the work from a subsystem that consumes 8% of the turn saves approximately 4% of turn time. Savings from plans that affect the same calls overlap; measure them together rather than adding independent percentages.

Engineering estimates assume one developer familiar with the DLL and a working toolchain. Extended gameplay evaluation and unrelated build repairs can add time. Each plan gives its own scope and uncertainty.

## Implementation conventions

Follow the root `AGENTS.md`. New or changed functions need purpose comments; VP modifications outside `CvConnectionService` use the `// Vox Deorum:` prefix. Keep data structures compatible with the repository's DLL toolchain. Do not stage changes unless requested.

Build and gameplay verification belong to implementation. The plans describe future checks; no build or deployment is required to review these Markdown drafts. The repository's DLL build-and-copy command also deploys the DLL, while the build-only alternative is documented in each plan where needed.

For extracted functions, use the simulator's [interleaved build comparison](../../../../vox-deorum-rl/docs/validation/native-profiling.md) and [shared verification workflow](../../../../vox-deorum-rl/plans/optimizations/README.md) as additional evidence. Keep maintained native code compatible with the DLL and regenerate extracted outputs normally. Runtime declarations and extraction selectors may need updates when a signature changes. Never implement a VP optimization by editing generated simulator code.
