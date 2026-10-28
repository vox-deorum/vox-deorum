# 11. Build carrier cargo counts once per stable scoring pass

## Goal and applicability gate

Reduce repeated roster scans when several ships receive turn-end scores from the same tactical state. Preserve the exact aircraft-loss penalty. First measure whether these scans matter; ship destination enumeration is not the demonstrated multiplier in current source.

`countCargoAircraft` in [CvTacticalAirSearch.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvTacticalAirSearch.cpp) scans available, not-quite-finished and finished units, counting `MS_AIR` rows with the carrier ID. It optionally adds `gUntrackedCargo`. `FindBestUnitAssignments` in [CvTacticalAI.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvTacticalAI.cpp) records that map before `addInitialAssignments`, then clears/rebuilds it after `dropSuperfluousUnits`. Initial scoring sees pre-cap untracked cargo; final scoring sees post-cap cargo. `ScoreCombatUnitTurnEnd` requests counts only for positive danger, sea units, enabled air search and full scoring.

Actual full-score sites include `addInitialAssignments`' two `EM_INITIAL` passes and `addFinishMovesIfAcceptable`'s `EM_FINAL` loop. Ordinary preferred movement uses `EM_INTERMEDIATE`, and `canProbablyEndTurnAfterAssignment` requests only the impossibility check. Neither reaches this cargo penalty. There is no isolated timing or archived sample attribution for cargo counting.

## Minimal measured implementation

1. Count full cargo scans, roster rows visited and eligible sea scores in initial/final passes. Stop if their runtime share is negligible.
2. Start with `addFinishMovesIfAcceptable`. Its scoring loop reads the three unit lists and appends assignment rows; the transfer from not-quite-finished to finished happens after scoring. Use a local `SCargoCountSnapshot` containing `bool bBuilt` and `map<int, int> trackedCounts`. A const position helper `void getTrackedCargoCounts(map<int, int>& out) const` fills it from all three lists on the first eligible request. A missing carrier key means zero.
3. Pass an optional pointer to this local snapshot through `ScorePlotForMove`, `ScorePlotForCombatUnitMove` and `ScoreCombatUnitTurnEnd`, with `NULL` retaining direct counting. Keep existing callers on the direct path. Add `gUntrackedCargo` separately using the existing lookup, preserving `bTrackedOnly` behavior in root cargo recording.
4. Extend to initial scoring only after auditing `addAssignment(A_INITIAL)` and proving counted membership/carrier fields stay fixed. Its untracked lookup must observe the pre-cap map. Rebuild all tracked snapshots after capping; any future snapshot of untracked cargo must also be discarded at the second `recordCarrierCargo`. Parents remain mutable despite inherited COW lists. Never retain tables across mutations, child initialization or pool reuse.
5. Use C++03, purpose comments and `// Vox Deorum:`. Update native declarations and all affected maintained selections: [state.json](../../../../vox-deorum-rl/simulator/extract/manifest/tactical/state.json) owns `countCargoAircraft` and generated scoring declarations, [search.json](../../../../vox-deorum-rl/simulator/extract/manifest/tactical/search.json) owns finish validation, and [scoring.json](../../../../vox-deorum-rl/simulator/extract/manifest/tactical/scoring.json) owns scoring helpers and root cargo recording. Select the new helper/type and update `ScorePlotForMove`'s signature transform and exposed declaration together. Regenerate under the [extractor convention](../../../../vox-deorum-rl/docs/development/extractor.md).

For example, a final pass scores four ships against 80 total roster rows. Direct counting visits 320 rows. One lazily built snapshot visits 80 rows plus four map lookups. A ship carrying one available and one finished aircraft, plus one untracked root aircraft, must still count three. A fired missile removed in a child must be absent from that child's independently built table.

## Estimate and verification

Allow 0.5 to 1 day for measurement, then 2 to 4 engineer-days if justified. For `S` eligible scores over `N` roster rows, direct counting visits `S * N` rows; the snapshot visits `N` plus map construction and lookups. Four scores remove 75% of roster visits. If those scans hypothetically consume 1% of final-validation time, a 75% time reduction there would save 0.75% of final validation before map overhead; multiply by final validation's workload share for an overall estimate. One score, short rosters or early rejection may regress. Neither scan time nor a whole-turn saving is measured.

The simulator uses this final pass for native search and bundled validation. Individual command/row final scores remain on direct counting under the proposed scope. Measure eligible-score counts per pass rather than assigning all sea-scoring time to this change.

Use [shared verification](README.md), `python build_vp_clang_sdk.py --config release`, and native extraction/build checks. Compare pre-cap initial and post-cap final counts/scores, including aircraft moved from tracked to untracked by capping. Cover finished aircraft, no cargo, spent missiles, predicted aircraft/carrier deaths, moved carriers, siblings and parent mutation. Compare accepted finishes and assignment order with air search enabled/disabled. Instrument scanning separately from release timing.

Out of scope: cargo gameplay rules, persistent/global count caches, participant caps, carrier movement semantics or changes to the penalty formula.
