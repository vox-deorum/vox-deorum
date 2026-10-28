# 10. Reuse one merged exploration set per unchanged selection

**Status:** Implemented together with [item 7](7-exploration-range-copies.md). See the [combined measurement and validation report](7-10-exploration-results.md).

## Change

`CvHomelandAI::ExecuteExplorerMoves` builds one merged exploration set after Lua and exotic-goods handling. It passes that snapshot to target searches at horizons 3, 5, 12, and 23 and to the retained-mission check. Other callers retain the two-argument `GetBestExploreTarget` entry point, which builds a fresh snapshot.

Movement paths normally return from the selection attempt, so the next attempt reads fresh scores. A failed upgrade-home move can issue a mission and continue; that boundary explicitly rebuilds the snapshot. There is no cache across units or turns.

`CvUnit::CanAutomate` uses `HasExplorationPlots` to check eligible domain sets without allocating a merged map. It shares the same land, embark, and ocean eligibility helper with `GetExplorationPlots`. Land, coast, then ocean insertion order still gives the first domain's values precedence for overlapping keys. Reach searches, scoring, restrictions, and sorting are unchanged.

## Removed work and validation scope

An unchanged attempt that previously built two to five merged maps now builds one. Early returns that previously built only one save no merge; the upgrade-home fallthrough can require a second snapshot. The automate-explore emptiness check builds none. These are source-level construction counts, not measured allocation counts.

The simulator declares both target-selection overloads and selects their exact signatures in `homeland/homeland.json`. Its economic facade keeps the existing lazy score-refresh boundary for `HasExplorationPlots`.

Behavior tests cover domain eligibility, empty and ineligible sets, overlapping values, target agreement at all four horizons, and refresh after revelation. The combined report records real-recording output and work parity, measured timings, and the remaining in-game mission and incremental-reveal checks.
