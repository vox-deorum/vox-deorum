# 14. Research exact reuse of expanding explorer reach searches

**Status:** Deprioritized. This is research: exact continuation is unproven, and the harassment reach between horizon three and later retries breaks borrowed finder state.

## Goal and research gate

Determine whether repeated horizon searches at 3, 5, 12 and 23 turns can share traversal work while preserving each bounded result and selected target exactly. Implementation is gated on a parity proof and useful measurements. A valid result of this investigation is to retain independent floods.

`GetBestExploreTarget` and `ExecuteExplorerMoves` in [CvHomelandAI.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvHomelandAI.cpp) retry larger bounds only when the preceding search has no target. Each invocation calls `GetPlotsInReach` with `MOVEFLAG_NO_ENEMY_TERRITORY | MOVEFLAG_MAXIMIZE_EXPLORE`. Existing code reuses the chosen horizon-three target later; it does not unconditionally search all four horizons. Non-recon land units can reject horizons above five before searching.

`GetPlotsInReach` in [CvAStar.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStar.cpp) emits one final label per closed node in traversal order. `LinkChild` enforces the turn bound, but replaces a node whenever the new accumulated cost is lower, without comparing turns. `CvTwoLayerPathFinder::NodeAddedToPath` overwrites its turns and moves. A larger flood can erase a shorter-horizon label, changing membership as well as scores. Equal costs retain the first encountered label, which can have a later turn count; stable target sorting also makes encounter order observable.

For example, suppose plot P has a legal cost-100 arrival at turn 2 and a cost-90 arrival at turn 4, because movement/exploration penalties favor the slower route. A horizon-three search can retain the turn-2 label. A longer flood can replace it with turn 4; filtering that final label at horizon three then omits P. These illustrative labels expose the contract that requires proof; construct a legal native fixture rather than assuming these particular costs occur.

## Investigation and conditional approach

1. Instrument retry frequency, expanded nodes and elapsed reach time at each bound. Separate original short-range successes from genuine multi-horizon attempts. Establish savings potential before designing an API.
2. Build a locked-state comparison probe using independent horizons as the reference. Explicitly compare every ordered `SMovePlot` field and target: its equality operator checks only plot identity. Include a shorter label overwritten by a cheaper later arrival. Filtering one long flood's final labels is invalid without proving such loss impossible or retaining every label needed by each bound.
3. Investigate a selection-local continuation context containing full inputs, start moves, open/closed state, deferred transitions, insertion order and sufficient alternative labels. A possible research API is `BeginExploreReach(unit, data)` followed by `ExtendTo(iMaxTurns, ReachablePlots& out)`. Keeping Pareto labels alone does not prove equivalence to fresh searches' single-label choices.
4. Require proof of identical label replacement, resume order and emitted rows at every bound, including stop nodes, boundary moves and distance rounding. Snapshot shorter results before extending. Re-run horizon-specific scoring, including healing's `iMaxTurns <= 3` condition and high-priority targets. Retain fresh floods if this proof fails.
5. Discard state before missions, sight changes, movement, combat, unit capability changes or any other finder use that overwrites scratch. Keep C++03 and `// Vox Deorum:` comments. If approved, update native declarations and maintained movement/homeland manifests, then regenerate under the [extractor convention](../../../../vox-deorum-rl/docs/development/extractor.md).

Suppose independent retries expand 100, 250, 900 and 2,000 nodes. Perfect continuation might avoid revisiting 1,250 nodes, roughly 38% of their 3,250 expansions. A one-shot 23-turn flood expands 20 times as many nodes as a successful 100-node short search. These assumed counts illustrate possible short-search regressions.

## Estimate and verification

Allow 2 to 4 engineer-days for measurement and semantic investigation, then 4 to 8 more only if a small exact approach survives. The archived profile attributes 92 of 2,830 samples, about 3.25%, to all reach work under this selector. Removing an assumed 30% of that entire historical envelope would save about 0.98% of that workload before overhead. Only eligible repeated work is removable, and exact continuation adds label/snapshot costs; present savings remain unmeasured in both runtimes.

Ordinary AI attempts run a harassment reach flood through the same singleton finder between the horizon-three query and later retries. That invalidates a context borrowing the finder's scratch under the stated lifetime rule. Consecutive 5/12/23 retries are the clearer sharing opportunity. Measure them separately from three-turn successes and interrupted attempts; retain independent floods if exact reuse does not pay.

Use [shared verification](README.md), `python build_vp_clang_sdk.py --config release`, and native extraction/build checks for a prototype. Compare ordered rows and targets at each horizon on roads, embarkation, ocean access, ZOC, zero/partial moves, healing, danger thresholds, ruins, equal-score ties and no-target maps. Record short-success regressions separately.

Out of scope: approximate choices, reduced horizons, cross-attempt caching, [plan 3](3-target-aware-batch-search.md)'s destination-batch stopping and [plan 5](5-lightweight-path-queries.md)'s scalar queries. [Plan 10](10-exploration-set-reuse.md) independently shares merged scores without changing traversal.
