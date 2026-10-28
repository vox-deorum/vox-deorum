# 7. Read exploration range vectors by reference

## Goal and current behavior

Remove vector copies from `CvEconomicAI::InitiateExplorePlot` while preserving every exploration score. Success means identical land, coast and ocean values, with no caller-owned range vector allocation or copy in this function.

[CvEconomicAI.cpp](../../civ5-dll/CvGameCoreDLL_Expansion2/CvEconomicAI.cpp) currently declares a vector before its radius loop and assigns `GetPlotsAtRangeX(pPlot, iRange, true, true)` to it for radii one through three. [CvMap.cpp](../../civ5-dll/CvGameCoreDLL_Expansion2/CvMap.cpp) already returns `const vector<CvPlot*>&`. Radius one uses `m_vPlotsShared`; larger radii use cached line-of-sight vectors. Null entries are legal, including the empty-cache sentinel.

The archived October 24 combat profile contained 36 vector-assignment samples and seven destruction samples associated with this opportunity, 43 of 2,830 game-thread samples, approximately 1.5%. This describes an older DLL and workload. Current code confirms the copies still exist; their present runtime share is unmeasured.

## Minimal implementation

1. Remove the vector declared outside `InitiateExplorePlot`'s loop. Inside each iteration bind `const std::vector<CvPlot*>& pPlotsToCheck` directly to the existing query.
2. Keep the iterator type, radius order, query arguments, null checks, visibility predicates and `ChangeValue` calls unchanged. Add a short `// Vox Deorum:` comment explaining the reference's iteration-local lifetime.
3. Audit the loop's callees before landing. `isAdjacentRevealed`, `GetPlotExploreMultiplier` and score updates must not issue another range-cache query or invalidate the returned vector. The inspected loop contains no direct nested query. Never retain the radius-one reference across another `GetPlotsAtRangeX` call.
4. Keep VC2008 C++03 syntax. No API, save layout or manifest signature change is needed. Regenerate extracted sources through the normal build; the maintained selection is [recon/exploration.json](../../../vox-deorum-rl/simulator/extract/manifest/recon/exploration.json). Follow the [extractor convention](../../../vox-deorum-rl/docs/development/extractor.md).

For example, assume the three returned rings contain 6, 9 and 14 pointers. The current loop copies 29 pointers per initiation even though it only reads them. The replacement visits those same 29 entries directly. A null entry remains skipped, and a hill hidden by line of sight remains absent. This example counts operations; it predicts no measured speedup.

## Estimate, risks and verification

Expected effort is 0.25 to 0.75 engineer-day, including source audit and parity checks. If half of the historical 1.5% sample envelope were removable caller copying, an equivalent workload would save roughly 0.75% overall before overhead. That is a sensitivity example, not a forecast or a confidence bound. Query cache filling and radius-one scratch assignment remain.

Use the [shared verification workflow](README.md). During implementation run `python build_vp_clang_sdk.py --config release` from `civ5-dll/`, then the shared native extraction/build and interleaved timing checks. Compare all three exploration sets before and after revealing a plot, with cold and warm range caches. Include wrapped edges, null neighbors, blocked line of sight and embarked scouting. Check that the comparison probe copies any borrowed results before another query overwrites scratch.

Out of scope: changing map cache ownership, other vector copies, range computation, exploration scoring, persistent references or new cache invalidation machinery.
