# Canal, worker reachability, and unit-path changes

Plans 1, 2, 6 and 8 are implemented in maintained DLL sources, with plan 9's neutral-query reuse included alongside plan 8. Their upstream handoffs use four independent branches. Native gameplay acceptance remains open for the behaviors that recordings cannot establish.

## Implementation

| Item | Result | Behavior limit |
| --- | --- | --- |
| 1 | Canal planning runs on one staggered turn in seven, skips disabled passable forts, and clears remembered plots on teardown. | New opportunities can wait up to six turns. |
| 2 | Worker reach maps are built on demand and reused within one invocation, with per-worker position, moves, and embarkation checks. | First observation moves later; changes caused by other workers can leave retained estimates stale. |
| 6 | Original cheap arrival checks run before bounded path probes; possible winners use the original arrival query. Searches stop after a zero-turn best. | Live transport and alternate-route comparisons remain; screening adds work for possible winners. |
| 8 and 9 | Ordinary extra-child callbacks avoid plot/unit lookups; neutral stacking checks reuse the cached visible-neutral predicate. | Enabled transport branches retain their existing behavior. |

Plan 6 uses `min(iMaxTurns, iBestTurns)` for the path search's exclusive turn limit. `CvUnit::GetTurnsToReachTargetEstimate` shares the original cheap checks with `TurnsToReachTarget`, including route estimates, approximate-target rings, turn clamping, and existing special returns. Homeland selection applies this helper at the original caller limit before constructing a bounded query, so distant candidates still avoid pathfinding. The estimate settles an arrival result or reports that a path search is needed.

The best arrival must constrain only the search horizon: tightening the distance estimate can reject a faster route, and subtracting another turn from the exclusive limit can exclude a candidate arriving one turn earlier. Confirmation uses the original arrival query and caller limit to preserve cost-selected routes. Native fixtures cover these boundaries and verify that five distant candidates add no path searches after a reachable candidate is found.

## Controlled checks

The baseline simulator was rebuilt and snapshotted before source changes. All 609 baseline native tests passed. The full simulator build workflow then passed, including extraction, process-level checks, closure, schema layout, and schema/capture deployment. Deployment here means generated capture sources; no gameplay DLL was installed.

The added cache fixture compares retained native reach maps against fresh cache rebuilds, preserves computed empty results, skips same-plot queries, and rebuilds only the changed worker's entry. Cache types, reachability containers, and the shared arrival precheck are extracted from maintained native sources. Transport fixtures check city-airlift movement limits, output clearing on rejection, once-only checks, and admiral port destinations. The distant-candidate fixture compares the pathfinder generation count with the same five units excluded and admitted, preserving the selected unit while adding zero searches. The final suite includes 613 native tests and three unit-selection regressions. Final workflow results and measurements are recorded below.

Release DLL builds pass for all five checkouts:

| Checkout | Log under `temp/upstream-review/` |
| --- | --- |
| Maintained VD | `vp-1-2-6-8/dll-vd-distance-build.log` |
| Canal planning | `canal-planning-refresh-review/dll-release-build.log` |
| Lazy worker reachability | `lazy-worker-reachability-review/dll-confirmed-build.log` |
| Bounded unit selection | `bounded-unit-selection-review/dll-distance-build.log` |
| Path extra children | `path-extra-children-review/dll-final-build.log` |

Two temporary C++03 fixtures compile actual maintained method bodies against controlled inputs:

- Canal planning with two cities over fourteen turns changes from twelve refreshes and twenty-four floods to two refreshes and four floods. Disabled passable forts change from twenty-four floods to zero. Teardown changes from retaining the remembered canal to clearing it.
- Old and changed unit selectors return the same unit in 19,208 controlled cases covering eligibility, ties, unreachable and zero-turn arrivals, later on-target units, and different caller limits. The baseline makes 55,223 arrival queries. The change makes 32,168 arrival queries plus 20,370 screening probes, totaling 52,538 queries. Summed supplied turn limits change from 585,844 to 345,430 across both query types. These are fixture counts with controlled path answers, rather than measured game search work or timing.

The fixtures and logs are local under `temp/upstream-review/vp-1-2-6-8/`. The source checkout started at `bea7a034cb8239dc74d653e258f9446ea5a1c174`. The comparison does not change the save layout or persistent game state.

## Recording comparison

The combined comparison uses the original saved baseline, three fixed recording starts, the three-turn `garrison-post2` template, grading and demonstration capture, the `intent-vp` variant, and one runtime thread. Inputs, raw outputs, work counts, and timings are retained under `vox-deorum-rl/logs/start-timings/vp-1-2-6-8-distance/`.

Both libraries use the same Release Clang/llvm-mingw settings, ThinLTO, native CPU target, and test hooks. Their SHA-256 identities are:

- `vp-1-2-6-8-before.dll`: `46be3aeef7e206630ec7e72ef59a99fcad34f15589053e0db27b35571aa3e19d`.
- `vp-1-2-6-8-distance.dll`: `e694194e66a3116a0c0f21b259f98191689844d31b280c5027379fc842b9a854`.

All 24 runs completed successfully: three starts, two libraries, and four repeats. Every run matches the baseline demonstration token bytes, timing-free output rows, final state digests, grades, and published search statistics. Search and demonstration counts match: the early start has 3 focal searches and 6 examples; the late starts have 68/400 and 41/157 respectively.

Median seconds, with homeland time included in runtime:

| Recording, player, turn | Runtime before | Runtime after | Homeland before | Homeland after |
| --- | ---: | ---: | ---: | ---: |
| `085b577b-p1-t35` | 0.429 | 0.414 | 0.046 | 0.046 |
| `020493d2-p4-t339` | 7.406 | 7.482 | 0.495 | 0.423 |
| `020493d2-p2-t338` | 6.170 | 6.016 | 0.554 | 0.453 |

Homeland medians fell about 15% and 18% in the two late starts. Whole-runtime medians changed by about -3.5%, +1.0%, and -2.5% across the three starts. Repeat ranges overlap, so these runs do not establish a general whole-rollout speedup. For the late player-4 start, runtime ranges were 6.857?7.564 seconds before and 6.871?8.088 after; player-2 ranges were 5.979?6.282 and 5.815?6.899. The batch is measured together. Canal planning and full native worker scoring are outside this simulator workload.

The raw report is `vox-deorum-rl/logs/vp-1-2-6-8-distance-timing.log`; `verified-summary.json` in the run folder records medians, ranges, phase times, work counts, library hashes, and explicit output checks. The final full simulator workflow passes all 613 native tests and its Python, process, closure, compiler-layout, and capture-deployment checks, with log `vox-deorum-rl/logs/vp-1-2-6-8-distance-full-build.log`.

## Coverage limits

The simulator omits canal planning and replays captured worker/directive pairings through a scoring facade. It cannot establish native worker scoring admission rates, human recommendation quality, danger-cache timing, canal construction quality, or full builder-update savings.

Live checks remain for save/reload between canal phases, a second game in one process, multi-turn canal decisions, cold danger caches and newly revealed threats, aborted worker movement, zero-moves partial travel, completed routes/features, choke-point vacancy, and consumed great people. Worker acceptance still needs map/rebuild/hit and mission-outcome counters together with useful progress and elapsed time. Direct enabled/disabled callback counts, avoided lookups, and expanded-node counts were not measured.

Unit selection still needs live garrison, sentry and engineer comparisons covering airlifts, embarkation, roads, railroads and cost-based alternate routes. The original arrival precheck's coarse-distance limitations and unusual zero-range results remain unchanged. Airport/allied-minor and admiral-port path-sequence checks remain, as do direct all-disabled/invalid-node callback fixtures. A passing DLL build verifies compilation, rather than those gameplay outcomes.

## Upstream handoffs

All four branches are based on `upstream/master` at `2bc6d34a16c5d4fb8cfb824170b9940cff88d7be`, with push destination `origin` and no upstream tracking. Each lives in `temp/upstream-review/<slug>-review/civ5-dll/`; the maintained development checkout and its existing workflow state are preserved.

| Branch | Changed native files | Draft |
| --- | --- | --- |
| `pr/canal-planning-refresh` | `CvBuilderTaskingAI.cpp` | `temp/upstream-review/canal-planning-refresh-pr.md` |
| `pr/path-extra-children` | `CvAStar.cpp`, `CvAStar.h` | `temp/upstream-review/path-extra-children-pr.md` |
| `pr/bounded-unit-selection` | `CvHomelandAI.cpp`, `CvUnit.cpp`, `CvUnit.h` | `temp/upstream-review/bounded-unit-selection-pr.md` |
| `pr/lazy-worker-reachability` | `CvHomelandAI.cpp`, `CvHomelandAI.h` | `temp/upstream-review/lazy-worker-reachability-pr.md` |

Separate validation handoffs use the same slugs with `-validation.md`. The patches add no VD attribution or IPC dependencies. Each upstream worktree remains unstaged and uncommitted; nothing was pushed or published. Human staging added during this task in the maintained checkouts was preserved. No staging was performed by the agent.

The upstream extra-child guard includes its existing sealift flag. That branch is absent from the maintained VD line, whose guard has three flags. Verification applies to the complete working tree. Human staging is preserved; the final shared-precheck changes remain unstaged for review.

Refreshed upstream source and all 65 open PR file lists were checked on October 28, 2026. OpenCode reviewed the seven relevant patches and found no equivalent change. The four PRs touching `CvUnit.cpp` or `CvUnit.h` are included in that audit. PRs 12997 and 13428 overlap worker and builder code and may need reconciliation if merged first. OpenCode handled bounded implementation, initialization/overlap audits, tests, and independent review; its model was not reported.

The shared-precheck review found no issue in the extraction, original-limit admission, exclusive bound, or native fixture arithmetic. It flagged the zero-range arrival result retained from the original query. The original selector also accepted that result; changing it would affect gameplay and other arrival-query callers. It is preserved for this optimization. `distance-filter-review.md`, `distance-review-disposition.md`, and `distance-final-audit.json` under `temp/upstream-review/vp-1-2-6-8/` record the finding, decision, and exact precheck/body comparisons. Current DLL toolchains pass despite the homeland header's existing include-order dependency.
