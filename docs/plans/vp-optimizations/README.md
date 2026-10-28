# VP optimization plans

These items cover pathfinding and native rollout opportunities in the current VD checkout of VP. Plans 1–6 come from the pathfinding review and plans 7–14 from the October 27 native rollout review. Their source claims were rechecked on October 28. Items 7 and 10 are implemented as one exploration change, with a [combined measurement and validation report](7-10-exploration-results.md). Item 11 is implemented for final scoring, and item 12 has direct empty and singleton air-state comparisons. The other items remain plans. The [three-recording Puma baseline](puma-full-rollout-baseline.md) completed on eight CPUs in 28 min 48.86 s and fixes the full rollout workload for later comparisons. Simulator-owned work has separate [VD RL optimization plans](../../../../vox-deorum-rl/plans/optimizations/README.md).

## Priorities

Each plan carries a **Status** line with its tier. The tiers mean:

- **Implemented:** the documented scope is built; remaining opportunities are described in the item.
- **Do now:** small, exact or nearly exact, and backed by source facts or profile evidence.
- **Next:** contained changes whose payoff is plausible but unmeasured.
- **Low payoff:** exact changes that remove little work. Do them as drive-bys alongside related edits.
- **Measure first:** possibly significant, but too complex to build before a profile shows the cost.
- **Deprioritized:** the removable work is negligible, or the plan is research.

| Plan | Tier | Why |
| --- | --- | --- |
| [1. Canal planning refresh](1-canal-planning-refresh.md) | Do now | The guard refreshes six turns in seven against its own "not needed every turn" intent. Each refresh is one water flood per owned city. Community Patch games without passable forts search for nothing. |
| [7. Exploration range copies](7-exploration-range-copies.md) | Implemented | Both exploration scoring loops borrow range vectors. Combined with item 10, no whole-rollout gain was demonstrated. DLL incremental-reveal gameplay checks remain. |
| [8. Path extra children](8-path-extra-children.md) | Do now | One plot lookup and one hashed unit lookup per expanded node, skipped when all capability flags are false. Exact. |
| [2. Lazy worker reachability](2-lazy-worker-reachability.md) | Next | Every worker gets a seven-turn reach flood before the assigned and region stages remove many of them. The source already carries a comment suggesting this postponement. |
| [6. Bounded unit selection](6-approximate-candidate-ranking.md) | Next | `GetBestUnitToReachTarget` never bounds later searches by its best result. An exact bound helps garrison, sentry, and 42-turn engineer searches. The approximate recruitment shortlist is parked. |
| [10. Exploration set reuse](10-exploration-set-reuse.md) | Implemented | One snapshot per unchanged selection attempt and a domain emptiness check without merging. Combined results are linked above. |
| [12. Air-state equality](12-air-state-equality.md) | Implemented | Empty and singleton records compare directly; multiple entries retain exact sorted comparison. No performance measurement or timing was requested. |
| [5. Lightweight path queries](5-lightweight-path-queries.md) | Low payoff | Path materialization is small next to the search. The squad memo was removed because squads are off by default. |
| [9. Neutral unit query](9-neutral-unit-query.md) | Deprioritized | The duplicate query runs only for civilian moves with the do-not-stack flag. Fine as a one-line drive-by with plan 8. |
| [3. Target-aware batch search](3-target-aware-batch-search.md) | Deprioritized | Trade and canal lists include every city and are never empty, and unreachable targets keep nonempty batches from stopping early. Only the empty-list guard for military calls is worth a drive-by. |
| [4. City connection search](4-city-connection-search.md) | Measure first | Runs every turn with O(n²) pair searches, but the FIFO stage removes only heap overhead and the tree stage is research. |
| [11. Carrier cargo counts](11-carrier-cargo-counts.md) | Implemented | Final scoring lazily counts tracked cargo once per pass. Applies only with air search (VDRL); runtime savings are unmeasured. |
| [13. Army target lists](13-army-target-lists.md) | Deprioritized | The repeated collection is a cheap scan next to the two path floods that follow each one. |
| [14. Explorer reach reuse](14-explorer-reach-reuse.md) | Deprioritized | Research. Exact continuation is unproven and intervening finder use breaks it. |

## Suggested order

1. Implement plans 1 and 8, with plan 9 as a drive-by beside plan 8. Items 7 and 10 are implemented together.
2. Implement plan 6's bound. Plan 12 is implemented for air-search workloads with exact equality preserved.
3. Implement plan 2 with its worker-assignment comparisons, since it moves when reach maps observe the world.
4. Profile city connections (plan 4) before designing anything further. Plan 11 is implemented for final scoring. Add plan 5's scalar reads and plan 3's empty-list guard when touching the same code.
5. Leave plans 13 and 14 parked unless new evidence changes their cost.

## Evidence and runtime scope

The [items 7 and 10 report](7-10-exploration-results.md) contains current measurements for that combined change. Figures in the remaining plans are analytical operation counts, hypothetical time reductions, or archived affected-cost envelopes. Overhead can make gains zero or negative. Plans 1 and 3 share canal searches, plans 5 and 6 share arrival queries, and plans 8 and 9 remove work inside searches that other plans can eliminate. Measure combinations rather than adding their percentages.

Runtime scope limits rollout evidence:

- Plans 1, 4 and 13 have no direct current simulator saving. Builder planning is omitted, city connections are captured, and the military methods are not selected.
- Plan 2 uses captured worker/directive pairings, and plan 3's simulator step finder excludes trade families.
- Plan 5's scalar work applies to the simulator, where locking is stubbed.
- Plans 7, 8, 9, 10, 12 and 14 apply to both runtimes. Plans 11 and 12 depend on `VOX_TACTICAL_AIR_SEARCH`, which is off in default VP and on in VDRL.

DLL comparisons cover the behaviors the simulator lacks. Recorded-state reconstruction does not measure path materialization, and simulator city-distance timing does not measure DLL city connections.

## Shared measurement baseline

Use the same release build settings and representative saved positions for each comparison: an early empire, a peaceful empire with many workers and cities, a contested front, and a late empire with railroads and sea routes. Repeat a fixed workload from each save. Separate load-time cache reconstruction from subsequent updates.

Measure the relevant caller's total elapsed time and search count, expanded nodes, visited plots, path reconstruction work, cache hits and misses, and whole-player-turn elapsed time. Include failed queries and destination-free floods. The detailed slow-search logging in `CvAStar::FindPathWithCurrentConfiguration` is restricted to a subset of targeted unit searches, so it cannot establish the aggregate baseline on its own.

Add only the diagnostic counters needed for the selected plan, behind the existing debugging mechanism, and keep them out of saved game state. Use aggregate records rather than logging every expanded node. Capture result equivalence or decision differences as well as timing. Preserve deterministic ordering and record any intentional change to it.

Plans 7–14 cite the [rollout evidence baseline](../../../../vox-deorum-rl/plans/optimizations/evidence.md), including an October 24 archived profile with 2,830 samples. Its sample shares describe that workload, and an inclusive function share is only an affected-cost envelope. Replace assumed costs, counts and hit rates with measurements before making a speedup claim. If a subsystem consumes a fraction `f` of total turn time and its time falls by a fraction `r`, the total turn-time reduction is approximately `f * r`, before new overhead. For example, removing half the work from a subsystem that consumes 8% of the turn saves approximately 4% of turn time.

Engineering estimates assume one developer familiar with the DLL and a working toolchain. Extended gameplay evaluation and unrelated build repairs can add time.

## Implementation conventions

Use this instruction when implementing these plans:

1. Read the selected plans and the applicable `AGENTS.md` files. Follow each plan's scope, dependencies, verification requirements, and grouping instructions, using the suggested order above. Fix issues individually or in the recommended batches. Keep measurement-first and parked work at its documented scope, and check implemented items for remaining work before changing them.
2. Make the fixes in maintained sources under `civ5-dll/`. Do not add `// Vox Deorum:` markers or other VD attribution comments. This task-specific instruction overrides marker requirements in `AGENTS.md` and individual plans. Keep useful purpose comments, deterministic ordering, save compatibility, and compatibility with the DLL toolchain.
3. Test each fix or batch with the simulator in `vox-deorum-rl/`. Before changing code, build and snapshot a matching baseline. Regenerate extracted sources through the normal workflow, updating extraction selectors and runtime declarations when needed. Run the relevant tests from the [test index](../../../../vox-deorum-rl/simulator/tests/index.md), then use the [interleaved build comparison](../../../../vox-deorum-rl/docs/validation/native-profiling.md) and [shared verification workflow](../../../../vox-deorum-rl/plans/optimizations/README.md) on representative recordings. Keep inputs and runtime settings fixed; compare outputs, work counts, and timing. Investigate unexpected differences and report intentional behavior changes separately. Edit maintained sources rather than generated simulator outputs.
4. Build the DLL with `python build_vp_clang_sdk.py --config release` from `civ5-dll/` and complete the selected plans' DLL or gameplay checks. Where the simulator omits the affected behavior, report that coverage gap and verify it through the DLL. Report unavailable checks and measured results accurately; claim performance gains only from measurements. Deploy with `build-and-copy.bat` only when deployment is requested and the script is present.
5. Use the [upstream-pr skill](../../../.agents/skills/upstream-pr/SKILL.md) to prepare one upstream PR per independent fix or agreed batch. Check current upstream code and open PRs for equivalent changes, then prepare the upstream-based branch, selected edits, concise PR draft, and separate validation report. Follow the skill's default handoff with edits unstaged and uncommitted. Commit, push, and open the PR only when explicitly authorized under that workflow. Preserve human edits and staging, and never stage the outer repository's gitlink.
6. Update the selected plans and this index with implementation status, verification results, and remaining limitations. Report each fix or batch's branch, draft path, changed files, simulator and DLL results, and any delegate model or tool used.
