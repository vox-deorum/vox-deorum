# 7. Read exploration range vectors by reference in initiation and updates

**Status:** Do now. The profile attributes copy and destruction samples to this code, and binding the two range results by reference is a trivial, exact change.

## Goal and current behavior

Remove vector copies from `CvEconomicAI::InitiateExplorePlot` and `CvEconomicAI::UpdateNearbyExplorePlots` while preserving every exploration score. Success means identical land, coast and ocean values, with no caller-owned range vector allocation or copy in either function.

[CvEconomicAI.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvEconomicAI.cpp) declares a vector before `InitiateExplorePlot`'s radius loop and assigns `GetPlotsAtRangeX(pPlot, iRange, true, true)` to it for radii one through three. The first assignment allocates and the next two reuse the capacity. `UpdateNearbyExplorePlots` declares a `const std::vector<CvPlot*>` and initializes it from `GetPlotsAtRangeX(pPlot, iRange, false, true)` inside its radius loop, so every iteration constructs a fresh vector, allocates storage and copies the pointers before the loop body reads them. [CvMap.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvMap.cpp) already returns `const vector<CvPlot*>&`. Radius one uses `m_vPlotsShared`; larger radii use cached line-of-sight vectors. Null entries are legal, including the empty-cache sentinel.

The two functions see very different call volumes per reveal. `AddPlotToExplorePlots` calls `InitiateExplorePlot` once and `UpdateNearbyExplorePlots` up to seven times: once for the revealed plot itself when it is adjacent-revealed, plus once for each unrevealed neighbor that has no other revealed neighbor. Each call covers three radii, so a reveal can construct up to 21 fresh vector copies in `UpdateNearbyExplorePlots`, against three reuse-capacity assignments in `InitiateExplorePlot`. Neither loop body issues a nested `GetPlotsAtRangeX` call. `InitiateExplorePlot` is called only from `AddPlotToExplorePlots`, which runs from `CvPlot::setRevealed` once per newly revealed plot for each major civ on the team.

The archived October 24 combat profile attributes 36 vector-assignment samples and seven destruction samples to inline frames under `InitiateExplorePlot`: 43 of 2,830 main-thread samples, approximately 1.52%. The copies performed by `UpdateNearbyExplorePlots` were not attributed separately, so the figure covers only the initiation caller. The [evidence baseline](../../../../vox-deorum-rl/plans/optimizations/evidence.md) records the attribution method. Present savings still require measurement.

## Minimal implementation

1. In `InitiateExplorePlot`, remove the vector declared outside the loop. In `UpdateNearbyExplorePlots`, remove the by-value declaration inside the loop. In each iteration bind `const std::vector<CvPlot*>& pPlotsToCheck` directly to the existing query result.
2. Keep the iterator type, radius order, query arguments, null checks, visibility predicates and `ChangeValue` calls unchanged in both functions. Add a short `// Vox Deorum:` comment explaining that the reference is valid only until the next range query.
3. Audit both loop bodies before landing. `isAdjacentRevealed`, `GetPlotExploreMultiplier` and score updates must not issue another range-cache query or invalidate the returned vector. The inspected loops contain no direct nested query. Never retain the radius-one reference across another `GetPlotsAtRangeX` call.
4. Keep VC2008 C++03 syntax. No API, save layout or manifest signature change is needed. Regenerate extracted sources through the normal build; the maintained selection is [recon/exploration.json](../../../../vox-deorum-rl/simulator/extract/manifest/recon/exploration.json). Follow the [extractor convention](../../../../vox-deorum-rl/docs/development/extractor.md).

For example, assume the three returned rings contain 6, 9 and 14 pointers. `InitiateExplorePlot` copies 29 pointers per initiation even though it only reads them. `UpdateNearbyExplorePlots` copies the same 29 pointers on every call, up to seven times per reveal, so one reveal can copy 203 pointers there. The replacement visits the entries directly in both functions. A null entry remains skipped, and a hill hidden by line of sight remains absent. This example counts operations; it predicts no measured speedup.

## Estimate, risks and verification

Expected effort is 0.25 to 0.75 engineer-day, including source audit and parity checks. Removing an assumed 50% of the historically attributed copy/destruction time would reduce that workload by about `1.52% * 0.5 = 0.76%` for `InitiateExplorePlot`. No profile figure covers the `UpdateNearbyExplorePlots` copies, so they add an unquantified share on top of that estimate. Query cache filling and radius-one scratch assignment remain. The maintained simulator exploration rebuild invokes initiation for revealed plots, so the change can benefit current native workloads as well as DLL gameplay. Measure warm/cold allocation counts and elapsed time for both functions before assigning a present percentage.

Use the [shared verification workflow](README.md). During implementation run `python build_vp_clang_sdk.py --config release` from `civ5-dll/`, then the shared native extraction/build and interleaved timing checks. Compare all three exploration sets before and after revealing a plot, with cold and warm range caches, and cover both a reveal that triggers the continuation updates and one that does not. Include wrapped edges, null neighbors, blocked line of sight and embarked scouting. Check that the comparison probe copies any borrowed results before another query overwrites scratch.

Out of scope: changing map cache ownership, other vector copies, range computation, exploration scoring, persistent references or new cache invalidation machinery.
