# Reduce canal planning refreshes

**Status:** Do now. The current cadence most likely inverts its own intent and refreshes six turns in seven; the fix is a few lines.

For DLL developers changing builder planning. A **canal plan** is the set of owned plots that sea-trade paths identify as useful canals, including existing passable improvements.

## Goal and success criteria

Refresh the canal plan in `CvBuilderTaskingAI::UpdateCanalPlots` once per seven turns instead of six per seven, and skip it entirely when nothing consumes it.

- In a stable world, each major civilization refreshes once per seven turns, staggered by player ID.
- Players without `MOD_GLOBAL_PASSABLE_FORTS` never run canal path searches.
- Remembered canals keep their existing scoring preference between refreshes.
- Measure fewer canal path searches and lower builder-update time on representative saves.

This changes planning policy: a new canal opportunity can appear up to six turns later than under the current cadence. Evaluate that delay rather than describe the change as behavior preserving.

## Current state

Relevant sources:

- [CvBuilderTaskingAI.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvBuilderTaskingAI.cpp): `Update`, `UpdateCanalPlots`, `WantCanalAtPlot`, `ScorePlotBuild`, `Serialize`, `Init`, and `Uninit`.
- [CvAStar.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStar.cpp): `GetMultiplePaths` and the `PT_TRADE_WATER` callbacks.

`Update` calls `UpdateCanalPlots` on every builder update. Builder updates come from `CvHomelandAI::PlanImprovements`, which normally runs once per player turn. `UpdateCanalPlots` opens with the comment "not needed every turn ... simple performance optimization" and then returns when `(gameTurn + playerID) % 7 == 0`. The guard therefore skips one turn in seven and refreshes on the other six. The comment points to the opposite intent.

Minor civilizations return next. Each refresh then clears `m_canalWantedPlots`, collects every city of every player as a destination, and makes one `GetMultiplePaths` call per owned city with `PT_TRADE_WATER`, `MOVEFLAG_PRETEND_CANALS`, and the origin's sea-trade range. Each call is a destination-free flood over the whole range (see [plan 3](3-target-aware-batch-search.md)), so a refresh costs one bounded water flood per owned city.

Every owned land tile on the resulting paths is remembered. The set has a single reader, `WantCanalAtPlot`, and its only caller is `ScorePlotBuild`. It adds 3000 to a passable improvement's score only when `MOD_GLOBAL_PASSABLE_FORTS` is enabled. No other code reads the plan, and the pathfinder's pretend-canal handling does not check the option. Vox Populi enables the option, so the plan matters in VP games. Community Patch alone leaves it off, and those games currently run every canal search for nothing.

`m_canalWantedPlots` is serialized, so a loaded game restores the last plan. Neither `Init` nor `Uninit` clears it.

## Change

1. **Gate on the consumer.** Return before any work when `MOD_GLOBAL_PASSABLE_FORTS` is off. This is exact: no code reads the plan in that configuration.
2. **Invert the cadence.** Return unless `(gameTurn + playerID) % 7 == 0`, so each player refreshes on its phase turn. Keep the stagger by player ID. Keep the minor-civilization exclusion and the clear-then-rebuild refresh body unchanged.
3. **Clear stale state.** Clear `m_canalWantedPlots` in `Uninit` (or `Init`). Under the longer cadence a plan from a previous game in the same process could otherwise survive up to six turns with indices from a different map. A loaded game is unaffected because `Read` restores the saved set afterwards.
4. Mark both edits with `// Vox Deorum:` and a one-line reason. Keep the serialized field order and the save format unchanged.

No first-turn refresh is needed. A loaded game keeps its saved plan. A new game starts with an empty plan for at most six turns, before canal-capable forts are available.

## Estimates

All figures are analytic illustrations, not measurements.

| Scenario | Current work | After the change |
| --- | --- | --- |
| VP, 10 owned cities, 14 stable turns | 12 refreshes, 120 water floods | 2 refreshes, 20 water floods |
| Community Patch without passable forts | 6 refreshes per 7 turns | None |
| New foreign coastal city founded | Seen next turn (six turns in seven) | Seen on the next phase turn, up to six turns later |

The search count falls by about 83% in VP. The turn-time share of canal planning is unmeasured, so convert this into a whole-turn estimate only after profiling. Current simulator rollouts omit builder planning, so this has no direct rollout saving.

Estimated effort: under half a day to implement, plus a day of save comparisons on coastal and archipelago maps.

## Risks

- The longer interval is an AI policy choice. Compare canal construction and replacement decisions on coastal saves before accepting it.
- Between refreshes, an obsolete plan can keep favoring a canal that is no longer useful. The next refresh replaces it.

## Optional follow-up

If save comparisons show the delay hurts canal decisions, add early refreshes for selected structural changes. Compare a small sorted snapshot (destination cities by owner and plot, own origins with sea-trade range, team war state, and the owner and improvement of each remembered plot) and refresh when it differs. Avoid a hash, whose collisions could suppress a refresh. This snapshot would still miss revelation, resource and terrain changes, which wait for the periodic refresh. Build it only if the simple cadence proves inadequate.

## Verification

1. Review the diff for unchanged path inputs, scoring constants, and serialized field order.
2. Build with `python build_vp_clang_sdk.py --config release` from `civ5-dll/`. When deployment is requested, use `build-and-copy.bat`.
3. On a VP save, log refresh turns per player and confirm one refresh per seven turns at the expected phase. Confirm no refresh with `GLOBAL_PASSABLE_FORTS` disabled. Save and reload between refreshes and confirm the plan survives. Start a second game in the same process and confirm the old plan is gone.
4. Run matching multi-turn coastal saves before and after. Report canal search counts, builder-update time, and any differences in canal construction.

## Out of scope

Changing the canal score, path costs, canal legality, trade-route algorithms, or the save format.
