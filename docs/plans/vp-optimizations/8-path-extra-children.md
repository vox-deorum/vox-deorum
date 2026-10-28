# 8. Skip extra-child lookups for ordinary path nodes

## Goal and evidence

Return an empty extra-child result before resolving a plot or unit when the node has none of the cached airlift or admiral-port capabilities. Success means the same ordered extra children and path results, with those lookups eliminated for the ordinary case.

`UnitPathGetExtraChildren` in [CvAStar.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStar.cpp) clears `out`, resolves the plot, resolves the owner's unit, and only then tests `bCanAirliftFromPlotCity`, `bCanAirliftFromPlotImprovement` and `bCanChangePortFromPlot`. Its existing control flow emits no children when all three are false. `UpdateNodeCacheData` populates these fields; path initialization and neighbor processing must have established their current generation before the callback executes.

The callback accounted for 0.53% of the archived October 24 profile's 2,830 game-thread samples. That whole-function share includes enabled-capability work and is an old workload envelope. The avoided lookup fraction and current callback frequency have not been measured.

## Chosen change

1. Audit the ordinary and two-layer finder call sites, including start and synthetic stop nodes, to confirm that their capability fields are initialized before extra-child enumeration. If any supported caller cannot provide this invariant, repair initialization or retain its old path.
2. Immediately after `out.clear()`, return zero when all three cached booleans are false. Use explicit boolean tests compatible with VC2008 C++03 and mark the change with `// Vox Deorum:`.
3. Leave the plot/unit null handling and every enabled branch in their current order. In particular preserve airlift precedence over port changes, the full-moves-or-zero rule, the once-per-search city checks, minor-ally iteration and child insertion order. Improvement airlift remains its existing unfinished branch.
4. Regenerate the native extraction. Review [movement/unit-paths.json](../../../../vox-deorum-rl/simulator/extract/manifest/movement/unit-paths.json) and [movement/pathfinder.json](../../../../vox-deorum-rl/simulator/extract/manifest/movement/pathfinder.json) for affected selections. No signature or facade change is expected; use the [extractor convention](../../../../vox-deorum-rl/docs/development/extractor.md).

For a concrete example, a search visits 10,000 ordinary tiles and 20 airport-origin nodes. Assuming the ordinary nodes have all three flags false, the guard skips 10,000 plot and unit resolutions. The 20 enabled nodes execute the existing checks and return exactly the same children. Passing a previously populated output vector must still yield an empty vector for a disabled node, so the clear stays first.

## Estimate and verification

Allow 0.5 to 1 engineer-day for initialization audit, implementation and comparison. If 80% of the historical callback time were disabled-node lookups, its historical-workload overall reduction would be about `0.53% * 0.8 = 0.42%`. The 80% is hypothetical; the measured callback envelope supplies no present speedup claim.

Follow [shared verification](README.md), including `python build_vp_clang_sdk.py --config release` from `civ5-dll/` and the native extraction/build checks. Compare old/new callback outputs and final path sequences on ordinary land/sea paths, airports owned by the player and allied minors, insufficient and zero moves, invalid plot/unit lookups, and admiral port changes. Exercise repeated searches to detect stale generation flags. Record disabled versus enabled callback counts separately from timing.

Out of scope: new transport links, airlift legality changes, removing enabled-path lookups, changing once-only flags, or altering path budgets.
