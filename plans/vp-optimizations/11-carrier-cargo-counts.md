# 11. Build carrier cargo counts once per stable scoring pass

## Goal and applicability gate

Reduce repeated roster scans when several ships receive turn-end scores from the same tactical state. Preserve the exact aircraft-loss penalty. First measure whether these scans matter; ship destination enumeration is not the demonstrated multiplier in current source.

`countCargoAircraft` in [CvTacticalAirSearch.cpp](../../civ5-dll/CvGameCoreDLL_Expansion2/CvTacticalAirSearch.cpp) scans available, not-quite-finished and finished units, counting `MS_AIR` rows with the carrier ID. It optionally adds `gUntrackedCargo`, recorded at the root after participant capping. [CvTacticalAI.cpp](../../civ5-dll/CvGameCoreDLL_Expansion2/CvTacticalAI.cpp) calls it from `ScoreCombatUnitTurnEnd` only for positive scaled danger, sea units, air search enabled, and `bOnlyCheckImpossible == false`.

Actual full-score sites include `addInitialAssignments`' two `EM_INITIAL` passes and `addFinishMovesIfAcceptable`'s `EM_FINAL` loop. Ordinary preferred movement uses `EM_INTERMEDIATE`, and `canProbablyEndTurnAfterAssignment` requests only the impossibility check. Neither reaches this cargo penalty. There is no isolated timing or archived sample attribution for cargo counting.

## Minimal measured implementation

1. Count full cargo scans, roster rows visited and eligible sea scores in initial/final passes. Stop if their runtime share is negligible.
2. Start with `addFinishMovesIfAcceptable`. Its scoring loop reads the three unit lists and appends assignment rows; the transfer from not-quite-finished to finished happens after scoring. Use a local `SCargoCountSnapshot` containing `bool bBuilt` and `map<int, int> trackedCounts`. A const position helper `void getTrackedCargoCounts(map<int, int>& out) const` fills it from all three lists on the first eligible request. A missing carrier key means zero.
3. Pass an optional pointer to this local snapshot through `ScorePlotForMove`, `ScorePlotForCombatUnitMove` and `ScoreCombatUnitTurnEnd`, with `NULL` retaining direct counting. Keep existing callers on the direct path. Add `gUntrackedCargo` separately using the existing lookup, preserving `bTrackedOnly` behavior in root cargo recording.
4. Consider initial-pass integration only after auditing `addAssignment(A_INITIAL)` and proving the counted membership/carrier fields stay fixed throughout its chosen scope. Rebuild between scopes if necessary. A parent position can change after children exist, and inherited COW lists do not establish permanent immutability. Do not keep a table across position mutations, child initialization or pool reuse.
5. Use C++03, purpose comments and `// Vox Deorum:`. Update affected native declarations and maintained [tactical scoring selections](../../../vox-deorum-rl/simulator/extract/manifest/tactical/scoring.json), then regenerate under the [extractor convention](../../../vox-deorum-rl/docs/development/extractor.md). Prefer this explicit local scope to a new persistent cache.

For example, a final pass scores four ships against 80 total roster rows. Direct counting visits 320 rows. One lazily built snapshot visits 80 rows plus four map lookups. A ship carrying one available and one finished aircraft, plus one untracked root aircraft, must still count three. A fired missile removed in a child must be absent from that child's independently built table.

## Estimate and verification

Allow 0.5 to 1 day for measurement, then 2 to 4 engineer-days if justified. The example removes 75% of roster scanning, excluding map overhead. If scanning hypothetically accounts for 1% of final validation, its reduction is at most about 0.75% there. Current whole-turn benefit is unknown; a pass with one scored ship may regress.

Use [shared verification](README.md), `python build_vp_clang_sdk.py --config release`, and native extraction/build checks. Compare counts and final scores for finished aircraft, capped-out root cargo, no cargo, spent missiles, predicted aircraft/carrier deaths, moved carriers, sibling positions and repeated mutation of a parent. Compare accepted finishes and assignment order with air search enabled/disabled. Instrument scanning separately from end-to-end release timing.

Out of scope: cargo gameplay rules, persistent/global count caches, participant caps, carrier movement semantics or changes to the penalty formula.
