# 11. Build carrier cargo counts once per stable scoring pass

**Status:** Implemented for final scoring, without performance measurement as requested.

## Scope

`addFinishMovesIfAcceptable` now shares a local, lazy `SCargoCountSnapshot` across its `EM_FINAL` scoring loop. The first eligible sea-unit score counts tracked aircraft across available, not-quite-finished and finished units. Later ship scores reuse the table. Passes that never reach the cargo penalty do not scan the rosters.

The three lists remain unchanged throughout this loop. The snapshot expires when the call returns, before any later scoring pass or branch mutation can reuse it. There is no cache on a position or its parent.

The aircraft-loss penalty still requires positive danger, sea units, full scoring and `VOX_TACTICAL_AIR_SEARCH`. Air search is off in default VP and enabled for VDRL. Initial scoring and individual simulator command/row scoring retain direct counting.

## Implementation

[CvTacticalAirSearch.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvTacticalAirSearch.cpp) owns `getTrackedCargoCounts` and the optional snapshot path in `countCargoAircraft`. Both counting paths add the current `gUntrackedCargo` lookup separately, and `bTrackedOnly` still excludes it. Root recording before and after participant capping is unchanged.

[CvTacticalAI.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvTacticalAI.cpp) passes the optional snapshot through the move scorers into `ScoreCombatUnitTurnEnd`. Only final-pass validation supplies a snapshot; `ScoreCombatUnitTurnEnd` takes it without a default, and its other caller passes none. [CvTacticalAI.h](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvTacticalAI.h) declares the type and helper with C++03-compatible storage, plus `getTrackedUnitLists`, which names the three unit lists every cargo walk reads.

The simulator's maintained [state.json](../../../../vox-deorum-rl/simulator/extract/manifest/tactical/state.json) selects the new type and helper and declares `ScorePlotForMove` and `ScoreCombatUnitTurnEnd`, each with the snapshot default, so tests call the turn-end scorer without declaring it themselves. [scoring.json](../../../../vox-deorum-rl/simulator/extract/manifest/tactical/scoring.json) updates the existing scorer linkage transform. The existing whole-function selection in [search.json](../../../../vox-deorum-rl/simulator/extract/manifest/tactical/search.json) includes final-pass reuse automatically. Generated files are rebuilt through the [extractor](../../../../vox-deorum-rl/docs/development/extractor.md).

## Verification

The native cargo-count regression compares direct and snapshot counts across all three unit lists, other carriers, empty carriers, and untracked cargo, which stays a live lookup even with a snapshot. It also checks a fresh pass after the plan spends an aircraft. Existing air-search tests cover predicted aircraft deaths and cargo lost with a sunk carrier.

Build checks use `python build_vp_clang_sdk.py --config release` and the simulator's native extraction/build workflow. No profiling counters, timings or measured speedup claims are part of this change.

For `S` eligible ship scores and `N` roster rows, direct counting visits `S * N` rows; the snapshot visits `N` rows plus map construction and lookups. Actual runtime savings are unmeasured.
