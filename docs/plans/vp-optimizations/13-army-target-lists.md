# 13. Share the revealed city list during attack-target updates

**Status:** Deprioritized. The collection loop is a cheap player-by-city scan, and each of its results feeds a full `GetMultiplePaths` flood that also copies and sorts the vector, so removing the redundant collections cannot measurably change `UpdateAttackTargets` time.

## Goal and current behavior

Collect potential city targets once per `CvMilitaryAI::UpdateAttackTargets`, then reuse the same ordered vector for every muster city and both movement domains. Success means unchanged army paths and attack/defense rankings, with one candidate-city scan per update.

`UpdateAttackTargets` in [CvMilitaryAI.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvMilitaryAI.cpp) calls `GetArmyPathsFromCity(pMusterCity, false)` and its water variant for each owned city. Each call reconstructs an identical `vector<CvPlot*>` by scanning players and their cities. It excludes the player's team and allied city states, then accepts plots that are still cities and are adjacent-revealed to the player's team. It deliberately leaves coastal filtering to the pathfinder. Later `IsPlayerValid` checks filter results after paths exist.

That collection loop is cheap next to the path work it feeds. Each collected city becomes a destination in a full `GetMultiplePaths` flood, and the batch method receives its destination vector by value, copying and sorting it on every call. The flood and its per-call copy each cost more than the repeated scans this plan would remove. `UpdateAttackTargets` runs once per turn per player from `CvMilitaryAI::DoTurn`, which limits how often any of this work happens. The plan stays parked as a small cleanup.

## Minimal change

1. Add a purpose-commented helper such as `void CollectArmyPathTargets(vector<CvPlot*>& out) const`, implementing the current collection loop without changing player/city iteration order or predicates.
2. Add an overload `GetArmyPathsFromCity(CvCity* pMusterCity, bool bWater, const vector<CvPlot*>& targets)`. Keep the current two-argument wrapper for any callers outside this update, having it collect locally and delegate.
3. In `UpdateAttackTargets`, collect once before the muster-city loop and pass the vector to both domain calls. Preserve per-muster trade-route range calculation, `PT_ARMY_LAND`/`PT_ARMY_WATER`, flags, result maps, inversions and scoring order.
4. Audit the full update's callees for gameplay or visibility mutation. This local snapshot is valid only while city existence, ownership, alliances and revelation remain fixed. If a callback can mutate those inputs mid-update, establish a narrower stable scope before reuse. Do not promote the vector to a turn cache.
5. Keep VC2008 C++03, add `// Vox Deorum:` comments, and update header declarations. Current maintained simulator manifests do not select these two military methods. Recheck that boundary at implementation time; update exact selectors if extraction has since added them, then regenerate using the [extractor convention](../../../../vox-deorum-rl/docs/development/extractor.md).

For example, with 12 owned muster cities and 40 candidate enemy/neutral cities, current code collects 24 vectors containing the same 40 pointers. The update would collect one candidate vector and still execute all 24 path batches. `GetMultiplePaths` takes destinations by value, so each batch retains its private vector copy, allocation and sorting. A noncoastal city remains in the water candidate vector, preserving the pathfinder's existing handling. Candidate order follows the original player and city loops.

## Estimate and verification

Allow 1 to 2 engineer-days if it is ever picked up. For `M > 0` muster cities, collection passes fall from `2M` to one, removing `1 - 1/(2M)` of collection work. The example removes about 96% of the scans, while all 24 path batches and their private copies remain. That is why the effect on update time stays negligible. Current simulator rollouts use captured target lists and omit these methods, so there is no direct saving there. Collect lazily on the first muster iteration to preserve zero scans for a player with no cities.

Follow [shared verification](README.md), `python build_vp_clang_sdk.py --config release` from `civ5-dll/`, and native extraction/build validation where applicable. Compare candidate order, destination keys, full path sequences, approach scores, exposed cities and final target rankings. Cover zero/one/many muster cities, no candidates, same-team cities, allied minors, unrevealed versus adjacent-revealed cities, coastal/noncoastal destinations and distinct muster trade ranges. Check tie ordering and wrapper behavior.

Out of scope: persistent target caching, early diplomacy/coastal filters, changed path stopping rules, altered trade ranges or approximation. Shared batch-search changes belong to [plan 3](3-target-aware-batch-search.md).
