# 10. Reuse one merged exploration set per unchanged selection

**Status:** Next. The change is contained and low risk, though the payoff is unmeasured.

## Goal and source behavior

Build a unit's merged exploration set once during one unchanged `ExecuteExplorerMoves` attempt, then share it across target searches at horizons 3, 5, 12 and 23 and the retained-mission check. Success requires identical targets, missions and score lookups with fewer merged-map constructions.

`GetBestExploreTarget` in [CvHomelandAI.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvHomelandAI.cpp) currently calls `CvEconomicAI::GetExplorationPlots(pUnit)` on each invocation. `ExecuteExplorerMoves` also builds a set for its step-three mission check. [CvEconomicAI.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvEconomicAI.cpp) merges land, coast and ocean according to movement capabilities. `GetExplorationPlots(const CvUnit*)` returns a fresh `CvExplorationPlotSet` by value, built by inserting each whole domain map, which allocates one unordered-map node per entry. `CvExplorationPlotSet::append` in [CvEconomicAI.h](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvEconomicAI.h) uses unordered-map insertion, so earlier entries win when keys overlap. It does not sum them.

A separate caller in [CvUnit.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvUnit.cpp), the automate-explore check in `CanAutomate`, calls `GetExplorationPlots(this).empty()`. That builds and discards the entire merged set merely to test whether it is empty.

Per `ExecuteExplorerMoves` attempt the set is built 2 to 5 times: horizon 3 inside `GetBestExploreTarget`, the step-three set that `ExecuteExplorerMoves` always builds, and up to three retries at 5, 12 and 23. The archived October 24 combat profile had only one sample in native map merging. This confirms no substantial measured saving. Its value is a small, contained removal of repeated work, subject to allocation measurements.

## Implementation steps

1. Add a private overload `GetBestExploreTarget(const CvUnit* pUnit, int iMaxTurns, const CvExplorationPlotSet& explorePlots) const`. Keep the existing entry point as a compatibility wrapper for other callers and select the overload explicitly in the homeland loop.
2. Move only merged-set construction out of the scoring body. Leave reach searches, other-explorer coordinates, scoring order, early restrictions and stable sorting unchanged.
3. In `ExecuteExplorerMoves`, construct the snapshot after the Lua hook and exotic-goods mission handling, immediately before the first horizon-three query. Pass it to that query, the step-three retained-target check and later retries. Remove their duplicate constructions.
4. Audit every path between these reads. Paths that execute exploration, capture, pillage, harassment or upgrade-home movement currently return from the attempt; the next call must construct a new snapshot. Confirm failed mission/path attempts do not change exploration values before reuse. If a mutating path can continue, rebuild at that boundary rather than introduce a turn-wide cache.
5. In `CvUnit::CanAutomate`, replace the `GetExplorationPlots(this).empty()` call with a check that does not build the merged set. Test emptiness of each domain set the unit would merge, using the same domain, embark and ocean conditions as `GetExplorationPlots(const CvUnit*)`. A shared helper keeps the two sites consistent if those conditions change.
6. Declare the overload in native `CvHomelandAI.h` and the hand-written simulator `CvHomelandAI` class in [stubs/player.h](../../../../vox-deorum-rl/simulator/include/stubs/player.h). Update the maintained [homeland manifest](../../../../vox-deorum-rl/simulator/extract/manifest/homeland/homeland.json) to select both definitions with distinct exact signatures. A manifest selection cannot add a member to the hand-written class. Keep C++03 and `// Vox Deorum:` purpose comments, then regenerate under the [extractor convention](../../../../vox-deorum-rl/docs/development/extractor.md).

For example, a scout with no valid target at horizons 3 and 5 proceeds through 12 and 23. Including the step-three check, the current attempt builds five merged sets. The proposed attempt builds one. If plot 42 appears in land and coast input with different values, retain the original land-first insertion result in every lookup.

## Estimate, risks and verification

Allow 1 to 2 engineer-days. An attempt with one construction saves none; two constructions become one, saving 50%; five become one, saving 80% of construction work. Reach searches and scoring remain. If construction hypothetically consumes 0.5% of selection time and falls 80%, selection time falls about 0.4% before overhead. The single archived merge sample cannot establish either input. This applies to DLL and maintained simulator selection, with no measured current whole-workload forecast. Measure attempt/retry and allocation counts, including upgrade-home mission fallthrough, before deciding priority.

Use [shared verification](README.md), the DLL release build command `python build_vp_clang_sdk.py --config release`, and native extraction/build checks. Confirm generated `ExecuteExplorerMoves` resolves the three-argument overload. Compare targets and missions at each horizon for land scouts, embarked units, coastal ships and ocean-capable ships. Include overlapping keys, empty sets, healing at the origin, high-value ruins, other explorers' mission targets, rejected long-range non-recon searches, and a mission revealing new terrain followed by another attempt. Confirm each new attempt observes updated scores. Check the automate-explore answer for land units with and without embark ability, and for ocean-capable ships, against the old merged-set emptiness result.

Out of scope: reusing reach frontiers, caching across units/turns, changing first-insert behavior, scoring or search horizons. Frontier reuse is [plan 14](14-explorer-reach-reuse.md).
