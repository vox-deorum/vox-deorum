# 7. Read exploration range vectors by reference

**Status:** Implemented together with [item 10](10-exploration-set-reuse.md). See the [combined measurement and validation report](7-10-exploration-results.md).

## Change

`CvEconomicAI::InitiateExplorePlot` and `CvEconomicAI::UpdateNearbyExplorePlots` now borrow each range vector returned by `CvMap::GetPlotsAtRangeX`. They previously copied its pointers into caller-owned storage. The radius order, query arguments, null checks, visibility predicates, and exploration score updates stay the same.

The reference is consumed before the next range query. The loop audit found no nested range query or cache invalidation in `isAdjacentRevealed`, `GetPlotExploreMultiplier`, or `ChangeValue`. No persistent reference or map-cache ownership change was added. The implementation retains C++03 compatibility.

## Removed work and measurement scope

Initiation avoids three vector assignments per call. Nearby updates avoid three fresh vector copies per call and can run up to seven times per reveal. The map's own scratch-vector and cache work remain. These are source-level operation counts, not measured allocation counts or speedups.

The archived October 24 profile attributed 43 of 2,830 main-thread samples to vector assignment and destruction under initiation, about 1.52%. That historical share does not predict the current combined gain.

The simulator extracts initiation through `recon/exploration.json` and rebuilds exploration scores lazily. It does not execute the DLL's incremental `UpdateNearbyExplorePlots` path. The combined report records the fixed-recording timing comparison, output parity, release builds, and this remaining gameplay coverage gap.
