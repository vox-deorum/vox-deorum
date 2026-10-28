# 7. Read exploration range vectors by reference

## Goal and current behavior

Remove vector copies from `CvEconomicAI::InitiateExplorePlot` while preserving every exploration score. Success means identical land, coast and ocean values, with no caller-owned range vector allocation or copy in this function.

[CvEconomicAI.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvEconomicAI.cpp) currently declares a vector before its radius loop and assigns `GetPlotsAtRangeX(pPlot, iRange, true, true)` to it for radii one through three. [CvMap.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvMap.cpp) already returns `const vector<CvPlot*>&`. Radius one uses `m_vPlotsShared`; larger radii use cached line-of-sight vectors. Null entries are legal, including the empty-cache sentinel.

The archived October 24 combat profile attributes 36 vector-assignment samples and seven destruction samples to inline frames under `InitiateExplorePlot`: 43 of 2,830 main-thread samples, approximately 1.52%. The [evidence baseline](../../../../vox-deorum-rl/plans/optimizations/evidence.md) records the attribution method. This is the historical affected-cost envelope for this caller's copy/destruction work; present savings still require measurement.

## Minimal implementation

1. Remove the vector declared outside `InitiateExplorePlot`'s loop. Inside each iteration bind `const std::vector<CvPlot*>& pPlotsToCheck` directly to the existing query.
2. Keep the iterator type, radius order, query arguments, null checks, visibility predicates and `ChangeValue` calls unchanged. Add a short `// Vox Deorum:` comment explaining the reference's iteration-local lifetime.
3. Audit the loop's callees before landing. `isAdjacentRevealed`, `GetPlotExploreMultiplier` and score updates must not issue another range-cache query or invalidate the returned vector. The inspected loop contains no direct nested query. Never retain the radius-one reference across another `GetPlotsAtRangeX` call.
4. Keep VC2008 C++03 syntax. No API, save layout or manifest signature change is needed. Regenerate extracted sources through the normal build; the maintained selection is [recon/exploration.json](../../../../vox-deorum-rl/simulator/extract/manifest/recon/exploration.json). Follow the [extractor convention](../../../../vox-deorum-rl/docs/development/extractor.md).

For example, assume the three returned rings contain 6, 9 and 14 pointers. The current loop copies 29 pointers per initiation even though it only reads them. The replacement visits those same 29 entries directly. A null entry remains skipped, and a hill hidden by line of sight remains absent. This example counts operations; it predicts no measured speedup.

## Estimate, risks and verification

Expected effort is 0.25 to 0.75 engineer-day, including source audit and parity checks. Removing an assumed 50% of the historically attributed copy/destruction time would reduce that workload by about `1.52% * 0.5 = 0.76%`. This is a sensitivity estimate, with no measured removable fraction or current speedup. Query cache filling and radius-one scratch assignment remain. The maintained simulator exploration rebuild invokes initiation for revealed plots, so the change can benefit current native workloads as well as DLL gameplay. Measure both warm/cold allocation counts and elapsed time before assigning a present percentage.

Use the [shared verification workflow](README.md). During implementation run `python build_vp_clang_sdk.py --config release` from `civ5-dll/`, then the shared native extraction/build and interleaved timing checks. Compare all three exploration sets before and after revealing a plot, with cold and warm range caches. Include wrapped edges, null neighbors, blocked line of sight and embarked scouting. Check that the comparison probe copies any borrowed results before another query overwrites scratch.

Out of scope: changing map cache ownership, other vector copies, range computation, exploration scoring, persistent references or new cache invalidation machinery.
