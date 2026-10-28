# 12. Fast equality for empty and singleton air damage records

**Status:** Next. The change is contained and exact, and the air search is enabled for VDRL.

## Goal and exact contract

Give `DamageRecordsEqual` direct effective-empty and singleton comparisons while preserving its existing exact equality for every input. Empty records already avoid backing allocations; singleton records can avoid allocating temporary vectors. Success means unchanged air-state deduplication and search decisions with less temporary-container work.

In [CvTacticalAirSearch.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvTacticalAirSearch.cpp), `DamageRecordsEqual` currently copies every nonzero `(unitID, value)` pair into two vectors, sorts them and compares. `airStateEquals` first checks interceptor states, then compares unit damage, uncertain damage and uncertain kill chance through this helper, so a fully equal comparison can call it three times. Each call builds and sorts two vectors, which means up to six vector allocations per equal comparison.

The air-state comparison runs only with `VOX_TACTICAL_AIR_SEARCH`, which is off in default VP but enabled for VDRL, so this plan targets VDRL rollouts and air-search games.

[CvUnit.h](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvUnit.h) defines `SUnitIDValueContainer` with inline single-entry storage and optional vector storage. Its iterator determines which storage is logically active. Equality currently ignores zero rows and row order, but preserves duplicate nonzero rows as a multiset. Public storage and constructed fixtures can contain duplicates even if normal mutators tend to update existing IDs. `GetValue` and approximate damage hashes cannot substitute for this exact multiset contract.

## Chosen implementation

1. Read through the existing iterators, skipping zeros. For each operand find the first nonzero pair, if any, and whether a second nonzero pair exists. Stop scanning once the second is found.
2. If both have no nonzero pair, return true. If only one is empty, return false. If exactly one is a singleton and the other has at least two nonzero rows, return false. If both are singletons, compare the exact pair and return.
3. If both have at least two nonzero rows, run the existing vector-copy, sort and comparison fallback unchanged. This keeps duplicate multiplicity, signed values and arbitrary ordering correct. Avoid a new normalization cache or replacing the container.
4. Add a `// Vox Deorum:` purpose comment to the helper and explain effective entries. Preserve its signature and VC2008 C++03 compatibility. Regenerate the existing [tactical state selection](../../../../vox-deorum-rl/simulator/extract/manifest/tactical/state.json) using the [extractor convention](../../../../vox-deorum-rl/docs/development/extractor.md); no new facade method is needed.

For a worked example, `[(7,0),(9,12)]` and `[(9,12)]` compare equal without allocating. `[(9,12),(9,12)]` and `[(9,24)]` remain unequal: adding values would incorrectly merge distinct multiset rows. `[(2,5),(1,8)]` and its reversal still compare equal through the sorted fallback. An all-zero vector and an empty inline container are equal.

## Estimate and verification

Allow 1 to 2 engineer-days for implementation, behavioral tests and benchmark comparison. Singleton-versus-singleton removes two backing allocations per helper call; three successful singleton record comparisons can remove six per `airStateEquals`. Empty inputs already allocate no backing storage, and sorting zero or one row performs no pair comparisons. Cardinality mismatches can also skip fallback allocations. Multi-entry pairs pay a preliminary scan before the unchanged fallback, potentially almost a full extra scan when leading rows are zero.

There is no isolated timing in either DLL or simulator evidence. If this helper hypothetically consumes 2% of a search and falls 50%, search time falls about 1%; both inputs are assumptions. Measure empty, singleton and fallback frequencies separately, after interceptor and assignment-equivalence gates, before predicting a workload saving.

Follow [shared verification](README.md), the DLL command `python build_vp_clang_sdk.py --config release`, and native extraction/build checks. Use focused native harness cases comparing the helper with its old sort-based result across empty, inline zero/nonzero, vector zeros, reordered rows, negative values, duplicate IDs with equal/different values and duplicate multiplicity. Verify that interceptor differences still reject equality before damage comparisons. Compare full assignments on air-heavy recordings with sweeps, uncertain strikes and missiles; use exact outputs, not approximate danger hashes.

Out of scope: changing equality semantics, quantizing values, altering danger hashes, canonicalizing stored records or changing search pruning policy.
