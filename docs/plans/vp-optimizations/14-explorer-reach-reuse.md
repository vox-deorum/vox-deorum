# 14. Research exact reuse of expanding explorer reach searches

## Goal and research gate

Determine whether repeated horizon searches at 3, 5, 12 and 23 turns can share traversal work while preserving each bounded result and selected target exactly. Implementation is gated on a parity proof and useful measurements. A valid result of this investigation is to retain independent floods.

`GetBestExploreTarget` and `ExecuteExplorerMoves` in [CvHomelandAI.cpp](../../civ5-dll/CvGameCoreDLL_Expansion2/CvHomelandAI.cpp) retry larger bounds only when the preceding search has no target. Each invocation calls `GetPlotsInReach` with `MOVEFLAG_NO_ENEMY_TERRITORY | MOVEFLAG_MAXIMIZE_EXPLORE`. Existing code reuses the chosen horizon-three target later; it does not unconditionally search all four horizons. Non-recon land units can reject horizons above five before searching.

`CvPathFinder::GetPlotsInReach` in [CvAStar.cpp](../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStar.cpp) emits closed nodes in traversal order, preserving turns, moves and normalized distance, and filters with `CanEndTurnAtNode`. `CvAStar::LinkChild` rejects continuation when exhausted movement would start a turn at or beyond `iMaxTurns`. Increasing the horizon therefore changes traversal, rather than merely changing a final result filter. Equal-cost arrivals retain the earlier arrival because obsolete checks reject equal costs. Stable target sorting makes encounter order observable.

## Investigation and conditional approach

1. Instrument retry frequency, expanded nodes and elapsed reach time at each bound. Separate original short-range successes from genuine multi-horizon attempts. Establish savings potential before designing an API.
2. Add a temporary locked-state comparison probe. Capture full ordered `SMovePlot` rows and chosen targets for independent horizons. Compare them against a 23-turn flood filtered at each shorter bound. Compare every field explicitly: `SMovePlot::operator==` checks only plot identity. Include all scoring inputs. Reject this shortcut on any mismatch.
3. If simple filtering cannot be proved exact, investigate a narrowly scoped continuation context: origin, complete finder data, start moves, open/closed state, deferred bound-rejected transitions and insertion/tie order. A possible interface is `BeginExploreReach(unit, data)` followed by `ExtendTo(iMaxTurns, ReachablePlots& out)`, owned only by one selection attempt. This is a research sketch, not an approved generic API.
4. Prove that deferred transitions resume in the same order and produce the same best node labels as fresh searches at every bound. Preserve stop-node behavior, horizon boundary moves, path costs, output order and normalized distance rounding. Re-run scoring per horizon, including healing's `iMaxTurns <= 3` condition and high-priority target handling.
5. Discard state before missions, sight changes, movement, combat, unit capability changes or any other finder use that overwrites scratch. Keep C++03 and `// Vox Deorum:` comments. If approved, update native declarations and maintained movement/homeland manifests, then regenerate under the [extractor convention](../../../vox-deorum-rl/docs/development/extractor.md).

For example, suppose independent retries expand 100, 250, 900 and 2,000 nodes. Perfect continuation might avoid revisiting 1,250 nodes, roughly 38% of their 3,250 expansions. A one-shot 23-turn flood expands 20 times as many nodes as a successful 100-node short search. These assumed counts explain why eager longest-horizon search can regress normal play.

## Estimate and verification

Allow 2 to 4 engineer-days for measurement and semantic investigation, then 4 to 8 more only if a small exact approach survives. There is no measured current reach-time share or speedup. If repeated reach work hypothetically consumes 10% of homeland selection and falls 30%, selection saves about 3% before overhead.

Use [shared verification](README.md), `python build_vp_clang_sdk.py --config release`, and native extraction/build checks for a prototype. Compare ordered rows and targets at each horizon on roads, embarkation, ocean access, ZOC, zero/partial moves, healing, danger thresholds, ruins, equal-score ties and no-target maps. Record short-success regressions separately.

Out of scope: approximate choices, reduced horizons, cross-attempt caching, [plan 3](3-target-aware-batch-search.md)'s destination-batch stopping and [plan 5](5-lightweight-path-queries.md)'s scalar queries. [Plan 10](10-exploration-set-reuse.md) independently shares merged scores without changing traversal.
