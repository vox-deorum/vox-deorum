# 9. Reuse the visible neutral-unit result

## Goal and existing contract

Remove the later neutral-unit query from `UpdateNodeCacheData` by reusing its cached visible result. Success means identical cache fields and path behavior, with one neutral query per newly cached visible node and none per invisible node, including when `MOVEFLAG_DONT_STACK_WITH_NEUTRAL` is set.

In [CvAStar.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStar.cpp), `UpdateNodeCacheData` initializes `bIsVisibleNeutralCombatUnit` to false and fills it inside the visible-plot block using `isNeutralUnit(pUnit->getOwner(), true, true)`. The later stacking override calls the same query when the flag is enabled. In [CvPlot.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvPlot.cpp), `isNeutralUnit` immediately returns false when its visibility argument is true and the owner's team cannot see the plot. Thus the cached field also answers the later query for invisible plots, where both results are false.

The containing function accounts for 4.49% of the archived October 24 combat profile's 2,830 samples. This includes all its terrain, legality, visibility and occupancy work. No measurement isolates the duplicate query; 4.49% must not be reported as available savings.

## Minimal approach

1. Keep the generation guard, visible-plot calculation and first neutral query unchanged.
2. Replace the later `isNeutralUnit(owner, true, true)` call directly with `kToNodeCacheData.bIsVisibleNeutralCombatUnit`, retaining the `MOVEFLAG_DONT_STACK_WITH_NEUTRAL` condition and assignment to `bUnitStackingLimitReached`.
3. Keep the invisible field false. No fallback query or new cached state is needed: the query's visibility contract already establishes the false result.
4. Retain selective-ZOC handling. Its occupancy override suppresses enemy checks, while the visible neutral query currently still executes. Reusing that field must preserve this distinction.
5. Use VC2008 C++03, a `// Vox Deorum:` purpose comment, and the unchanged function signature. Regenerate the [movement/unit-paths.json](../../../../vox-deorum-rl/simulator/extract/manifest/movement/unit-paths.json) selection under the [extractor convention](../../../../vox-deorum-rl/docs/development/extractor.md).

For example, 1,000 newly cached visible nodes under the flag currently make 2,000 neutral queries. They would make 1,000. Another 200 invisible nodes under the flag fall from 200 queries to zero, preserving their false result. With the flag absent, visible nodes still make one query and invisible nodes make none. Verify this truth table, including neutral civilians versus combat units under the unchanged query arguments. Removing an invisible query saves only its early visibility check, not a unit-list scan.

## Estimate and checks

Allow 0.5 to 1 engineer-day. In a hypothetical equivalent workload where the redundant queries represent 10% of `UpdateNodeCacheData` time, removing them would reduce total time by approximately `4.49% * 0.1 = 0.45%`. The 10% is an assumption. Flag-disabled searches save nothing, and invisible calls save only an early visibility check. Measure flag prevalence and query cost in escort/civilian movement in both DLL and extracted simulator paths before predicting a current saving.

Follow [shared verification](README.md). Run `python build_vp_clang_sdk.py --config release` from `civ5-dll/` and the native extraction/build workflow during implementation. Compare all cache fields and selected paths with visibility on/off, flag on/off, no units, neutral combat units, neutral civilians, invisible units, enemies and stacking-limit saturation. Cover selective ZOC, pretend-all-revealed without actual visibility, and repeated queries in one generation. Counters should confirm one eliminated call per newly cached flag-enabled node, visible or invisible.

Out of scope: changing fog-of-war legality, neutral definitions, visibility caching, query arguments, stacking policy or danger calculations.
