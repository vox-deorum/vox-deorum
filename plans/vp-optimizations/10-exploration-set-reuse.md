# 10. Reuse one merged exploration set per unchanged selection

## Goal and source behavior

Build a unit's merged exploration set once during one unchanged `ExecuteExplorerMoves` attempt, then share it across target searches at horizons 3, 5, 12 and 23 and the retained-mission check. Success requires identical targets, missions and score lookups with fewer merged-map constructions.

`GetBestExploreTarget` in [CvHomelandAI.cpp](../../civ5-dll/CvGameCoreDLL_Expansion2/CvHomelandAI.cpp) currently calls `CvEconomicAI::GetExplorationPlots(pUnit)` on each invocation. `ExecuteExplorerMoves` also builds a set for its step-three mission check. [CvEconomicAI.cpp](../../civ5-dll/CvGameCoreDLL_Expansion2/CvEconomicAI.cpp) merges land, coast and ocean according to movement capabilities. `CvExplorationPlotSet::append` in [CvEconomicAI.h](../../civ5-dll/CvGameCoreDLL_Expansion2/CvEconomicAI.h) uses unordered-map insertion, so earlier entries win when keys overlap. It does not sum them.

The archived October 24 combat profile had only one sample in native map merging. This confirms no substantial measured saving. Its value is a small, contained removal of repeated work, subject to allocation measurements.

## Implementation steps

1. Add a private overload `GetBestExploreTarget(const CvUnit* pUnit, int iMaxTurns, const CvExplorationPlotSet& explorePlots) const`. Keep the existing entry point as a compatibility wrapper for other callers and select the overload explicitly in the homeland loop.
2. Move only merged-set construction out of the scoring body. Leave reach searches, other-explorer coordinates, scoring order, early restrictions and stable sorting unchanged.
3. In `ExecuteExplorerMoves`, construct the snapshot after the Lua hook and exotic-goods mission handling, immediately before the first horizon-three query. Pass it to that query, the step-three retained-target check and later retries. Remove their duplicate constructions.
4. Audit every path between these reads. Paths that execute exploration, capture, pillage, harassment or upgrade-home movement currently return from the attempt; the next call must construct a new snapshot. Confirm failed mission/path attempts do not change exploration values before reuse. If a mutating path can continue, rebuild at that boundary rather than introduce a turn-wide cache.
5. Keep C++03 syntax and `// Vox Deorum:` comments. Update the maintained [homeland manifest](../../../vox-deorum-rl/simulator/extract/manifest/homeland/homeland.json) to select both overloads unambiguously and expose required declarations, then regenerate under the [extractor convention](../../../vox-deorum-rl/docs/development/extractor.md).

For example, a scout with no valid target at horizons 3 and 5 proceeds through 12 and 23. Including the retained-mission check, the current attempt can build five merged sets. The proposed attempt builds one. If plot 42 appears in land and coast input with different values, retain the original land-first insertion result in every lookup.

## Estimate, risks and verification

Allow 1 to 2 engineer-days. With five builds, four builds disappear, an 80% reduction in this construction work. If construction hypothetically consumes 0.5% of selection time, that saves about 0.4% of selection time before overhead. There is no measured current construction fraction or whole-turn forecast.

Use [shared verification](README.md), the DLL release build command `python build_vp_clang_sdk.py --config release`, and native extraction/build checks. Compare targets and missions at each horizon for land scouts, embarked units, coastal ships and ocean-capable ships. Include overlapping keys, empty sets, healing at the origin, high-value ruins, other explorers' mission targets, rejected long-range non-recon searches, and a mission revealing new terrain followed by another attempt. Confirm each new attempt observes updated scores.

Out of scope: reusing reach frontiers, caching across units/turns, changing first-insert behavior, scoring or search horizons. Frontier reuse is [plan 14](14-explorer-reach-reuse.md).
