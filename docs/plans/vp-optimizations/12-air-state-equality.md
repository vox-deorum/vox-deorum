# 12. Fast equality for empty and singleton air damage records

**Status:** Implemented without performance measurement or timing, as requested.

## Scope and exact contract

`DamageRecordsEqual` directly compares effective-empty and singleton records. Effective entries are rows with a nonzero value. Equality ignores zero rows and row order, and preserves duplicate nonzero rows as a multiset, including signed values and duplicate multiplicity.

In [CvTacticalAirSearch.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvTacticalAirSearch.cpp), `airStateEquals` first checks interceptor states, then compares unit damage, uncertain damage and uncertain kill chance through this helper. Its call order and short-circuit behavior are unchanged.

The air-state comparison runs with `VOX_TACTICAL_AIR_SEARCH`, which is off in default VP and enabled for VDRL. The local upstream tree has no `CvTacticalAirSearch.cpp`, so this fix stays on the maintained VD DLL branch.

## Implementation

The helper reads each operand through the existing [SUnitIDValueContainer](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvUnit.h) iterators, which determine the logically active storage. `CountNonzeroDamageRows` scans one record, skips zeros, saves the first nonzero pair and stops when it finds a second.

Different counts return false, empty records compare equal, and two singletons compare their exact pair. These paths return before temporary vectors are created. When both operands have multiple effective entries, `GetSortedNonzeroDamageRows` copies and sorts each side's nonzero rows for the same multiset comparison as before. No stored normalization, hash comparison or container change is involved. The helper retains its signature and C++03 compatibility.

For example, `[(7,0),(9,12)]` equals `[(9,12)]`. Two copies of `(9,12)` remain unequal to one `(9,24)` row. Reordering multiple nonzero rows preserves equality, and an all-zero vector equals an empty inline container.

The existing [tactical state selection](../../../../vox-deorum-rl/simulator/extract/manifest/tactical/state.json) extracts the two row helpers, `DamageRecordsEqual` and `airStateEquals` as plain function and method selectors; no facade is needed. Generated sources are rebuilt through the [extractor](../../../../vox-deorum-rl/docs/development/extractor.md).

## Verification

The native air-state regression checks the extracted equality against an explicit expected result for each of the three damage fields, in both operand orders. Fixtures build records through `SetValue`, as the search does, and cover empty records, zeroed rows, a single row left among zeros, a stale inline value after promotion, row-count mismatches, row order and differing multi-row values. Interceptor usage and base-loss differences must still reject equality.

Build checks use `python build_vp_clang_sdk.py --config release` and the simulator's extraction/build workflow. Validation results and any unavailable checks are recorded in the implementation handoff. No profiling counters, timing comparisons or speedup claims are part of this change.

Equality semantics, danger hashes, stored records and search pruning policy remain unchanged.
