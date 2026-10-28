# 13. Share the revealed city list during attack-target updates

## Goal and current behavior

Collect potential city targets once per `CvMilitaryAI::UpdateAttackTargets`, then reuse the same ordered vector for every muster city and both movement domains. Success means unchanged army paths and attack/defense rankings, with one candidate-city scan per update.

`UpdateAttackTargets` in [CvMilitaryAI.cpp](../../civ5-dll/CvGameCoreDLL_Expansion2/CvMilitaryAI.cpp) calls `GetArmyPathsFromCity(pMusterCity, false)` and its water variant for each owned city. Each call reconstructs an identical `vector<CvPlot*>` by scanning players and their cities. It excludes the player's team and allied city states, then accepts plots that are still cities and are adjacent-revealed to the player's team. It deliberately leaves coastal filtering to the pathfinder. Later `IsPlayerValid` checks filter results after paths exist.

This opportunity is supported by current source, with no isolated profile attribution or runtime measurement. Path generation is likely much more expensive than collecting targets, so do not equate scan reduction with update-time reduction.

## Minimal change

1. Add a purpose-commented helper such as `void CollectArmyPathTargets(vector<CvPlot*>& out) const`, implementing the current collection loop without changing player/city iteration order or predicates.
2. Add an overload `GetArmyPathsFromCity(CvCity* pMusterCity, bool bWater, const vector<CvPlot*>& targets)`. Keep the current two-argument wrapper for any callers outside this update, having it collect locally and delegate.
3. In `UpdateAttackTargets`, collect once before the muster-city loop and pass the vector to both domain calls. Preserve per-muster trade-route range calculation, `PT_ARMY_LAND`/`PT_ARMY_WATER`, flags, result maps, inversions and scoring order.
4. Audit the full update's callees for gameplay or visibility mutation. This local snapshot is valid only while city existence, ownership, alliances and revelation remain fixed. If a callback can mutate those inputs mid-update, establish a narrower stable scope before reuse. Do not promote the vector to a turn cache.
5. Keep VC2008 C++03, add `// Vox Deorum:` comments, and update header declarations. Current maintained simulator manifests do not select these two military methods. Recheck that boundary at implementation time; update exact selectors if extraction has since added them, then regenerate using the [extractor convention](../../../vox-deorum-rl/docs/development/extractor.md).

For example, with 12 owned muster cities and 40 candidate enemy/neutral cities, current code builds 24 vectors containing the same 40 pointers. The update would build one vector of 40 pointers and still execute all 24 path batches. A noncoastal city remains in the water candidate vector, preserving the pathfinder's existing handling. Candidate order follows the original player and city loops.

## Estimate and verification

Allow 1 to 2 engineer-days. The example removes 23 of 24 collection passes, about 96% of collection work. If collection hypothetically consumes 2% of update time, that is about 1.9% of update time before overhead. There is no measured collection fraction or whole-turn estimate. A player with no muster cities currently does no collection; preserve this by collecting lazily on the first iteration if that case matters.

Follow [shared verification](README.md), `python build_vp_clang_sdk.py --config release` from `civ5-dll/`, and native extraction/build validation where applicable. Compare candidate order, destination keys, full path sequences, approach scores, exposed cities and final target rankings. Cover zero/one/many muster cities, no candidates, same-team cities, allied minors, unrevealed versus adjacent-revealed cities, coastal/noncoastal destinations and distinct muster trade ranges. Check tie ordering and wrapper behavior.

Out of scope: persistent target caching, early diplomacy/coastal filters, changed path stopping rules, altered trade ranges or approximation. Shared batch-search changes belong to [plan 3](3-target-aware-batch-search.md).
