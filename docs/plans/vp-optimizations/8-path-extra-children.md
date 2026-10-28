# Skip extra-child lookups for ordinary path nodes

**Status:** Implemented together with plan 9's one-line neutral-query reuse. Initialization audit, simulator checks, and release DLL builds pass. See the [batch validation](1-2-6-8-results.md).

## Implementation

`UnitPathGetExtraChildren` clears its output, then returns zero when the cached city-airlift, improvement-airlift, and admiral-port flags are all false. Ordinary nodes avoid both plot resolution and the hashed unit lookup.

Enabled branches keep their existing order, null handling, full-moves-or-zero rule, once-per-search checks, allied-minor iteration, and insertion order. Improvement airlift retains its existing unfinished branch. The header declaration now matches the definition's const finder parameter, allowing direct callback checks without an undefined overload.

Current upstream also supports sealift, so its port includes `bCanSealiftFromPlotCity` in the guard. The maintained VD line has three capability flags; the port preserves upstream's fourth transport branch.

`UpdateNodeCacheData` also reuses `bIsVisibleNeutralCombatUnit` for the `MOVEFLAG_DONT_STACK_WITH_NEUTRAL` override. That field comes from the same visibility-aware query, remains false for invisible plots, and is populated even under selective ZOC. See [plan 9](9-neutral-unit-query.md).

## Initialization and verification

The two-layer finder initializes the start node before extra-child enumeration, refreshes ordinary and nonlocal neighbor caches before insertion, and copies the current node's cache into synthetic stop nodes. The generation guard refreshes capabilities for subsequent searches. Step finders use other callbacks. OpenCode independently checked these paths.

Existing extraction selectors regenerate the callback unchanged. Transport fixtures cover city-airlift full/partial/zero moves, output clearing on rejection, once-only checks, and admiral port destinations. Repeated recording comparisons cover ordinary paths; the batch report states their output and timing results.

Live airport/allied-minor and port path-sequence comparisons remain, along with direct enabled/disabled invocation and avoided-lookup counters. The archived 0.53% callback sample share is not a measured saving from this change. No new links, transport legality changes, or capability-generation policy were added.
