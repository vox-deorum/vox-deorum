# Reduce canal planning refreshes

For DLL developers changing builder planning. A **canal plan** is the set of owned plots that sea-trade paths identify as useful canals, including existing passable improvements.

## Goal and success criteria

Reduce repeated sea-trade path searches in `CvBuilderTaskingAI::UpdateCanalPlots` while retaining useful canal plans between refreshes.

- Perform an initial refresh for a newly initialized or loaded player on its first builder update.
- In a stable world with one update per turn, refresh once per seven turns, staggered by player ID.
- Refresh early for explicitly tracked structural changes; bound other changes by the periodic refresh.
- Preserve the existing scoring treatment of remembered canals during skipped updates.
- Measure fewer canal path searches and lower total builder-update time on representative saves.

This changes planning policy. A canal opportunity can appear later than under the current six-of-seven-turn cadence. The implementation must expose and evaluate that delay rather than describe it as behavior preserving.

## Current state

Relevant sources:

- [CvBuilderTaskingAI.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvBuilderTaskingAI.cpp): `Update`, `UpdateCanalPlots`, `WantCanalAtPlot`, `ScorePlotBuild`, `Serialize`, `Read`, and `Uninit`.
- [CvBuilderTaskingAI.h](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvBuilderTaskingAI.h): `m_canalWantedPlots` and private update helpers.
- [CvAStar.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStar.cpp): `TradePathInitialize`, `TradePathWaterValid`, and `TradePathWaterCost`.

`Update` runs canal planning before improvement scoring. The current guard returns when `(gameTurn + playerID) % 7 == 0`. Eligible players therefore recalculate on six of seven turns. Minor civilizations return before clearing their saved plan.

Each refresh clears `m_canalWantedPlots`, gathers every player's city plots, and makes one `GetMultiplePaths` call per origin city owned by this player. Each search uses `PT_TRADE_WATER`, `MOVEFLAG_PRETEND_CANALS`, and the origin city's sea-trade range.

Every owned land tile on the resulting paths is remembered, including existing passable improvements. The two insertion branches currently have the same effect. `WantCanalAtPlot` reads only this set. `ScorePlotBuild` grants a passable improvement an additional 3000 score when the passable-forts option is enabled and the plot is wanted. This helps preserve existing canals; it is not an absolute prohibition against replacing them.

Path results depend on more than city locations: revelation, ownership, ice, resources, existing passable improvements, ocean access, diplomacy involving coastal passages, and trade range can matter. A cache keyed only by turn or own-city count cannot guarantee identical results.

The wanted-plot set is serialized. There is currently no serialized refresh timestamp or validity marker. Neither `Uninit` nor `Init` clears that set. Clear it in `Init` before inspecting remembered indices for a new game; `Read` subsequently restores the saved set on load.

## Approach and alternatives

Use a seven-turn schedule with an unconditional first refresh and a small, explicit structural snapshot that can force early refreshes. Keep the current path-generation algorithm and scoring unchanged.

The **structural snapshot** compares selected path inputs directly, using sorted vectors rather than a hash whose collision could suppress invalidation:

- All destination cities as `(ownerID, plotIndex)` pairs, so founding, razing, and capture are visible.
- Own origins as `(plotIndex, currentSeaTradeRange)` pairs.
- Player team, ocean-crossing ability, and the team's current war relationships.
- Previously wanted plots as `(plotIndex, ownerID, improvementType, pillaged)` tuples.

The all-city snapshot is intentionally conservative. An inland or unrevealed city can force a refresh even when it cannot be a sea-trade destination. Filtering it safely would require proving that city ownership and intermediate paths using pretend canals cannot affect the result. Retain all cities for this localized change and measure how often each input category forces a refresh.

This covers common disruptions without a map-wide scan or hooks throughout `CvPlot`, `CvTeam`, and city lifecycle code. It does **not** detect every path dependency immediately. Revelation, ownership changes on plots that are not remembered, newly created canals elsewhere, resource discovery, and terrain changes can wait for the periodic refresh. State this bounded approximation in comments and review criteria.

Retain the entire wanted set on skipped updates. Do not clear it before the cadence decision. Do not keep every historical canal forever: a completed refresh replaces the set using current paths and the current selection policy.

Alternatives:

- Merely invert the modulo test: smallest diff, but misses first-turn initialization and explicit invalidation after loading or structural changes.
- Exact world revision tracking: potentially behavior preserving when every dependency is covered, but requires broad event plumbing and an audit of all path inputs. Defer it.
- Hash all relevant map state each update: broader coverage, but adds a map scan and still needs careful dependency enumeration. Profile before considering it.
- Only periodic refresh with no structural snapshot: viable smaller fallback if snapshot maintenance costs exceed its responsiveness benefit.

## Ordered implementation steps

1. **Define transient scheduling state in `CvBuilderTaskingAI.h`.**
   Add `bool m_bCanalPlanValid` and `int m_iLastCanalRefreshTurn`, initialized to false and -1. Add a private `CanalRefreshInputs` value type containing the sorted vectors and scalar values above, plus `m_lastCanalRefreshInputs`. Use existing C++/STL conventions compatible with the DLL toolchain.

2. **Make lifecycle behavior explicit in `CvBuilderTaskingAI.cpp`.**
   Reset the new validity, turn, and snapshot state in `Uninit` and `Init`. Clear `m_canalWantedPlots` in `Init` before snapshot collection can read prior-game plot indices. After `Read` restores existing serialized fields, invalidate the transient schedule while retaining the restored wanted set until its replacement is ready. Keep `Serialize` and save-stream field order unchanged. A backward game-turn jump also forces refresh.

3. **Gather inputs without pathfinding.**
   Check the minor-civilization exclusion before collecting inputs. Add `CanalRefreshInputs CollectCanalRefreshInputs(vector<CvPlot*>& destinations) const`. Gather destination plots once and make a sorted value copy for comparisons. Keeping caller traversal order is convenient but is not a tie requirement: `GetMultiplePaths` sorts destination indices internally. Capture wanted-plot state using indexed plot lookup and explicit field comparison. Add purpose comments to each new function.

4. **Define the refresh decision.**
   Add `bool ShouldRefreshCanalPlots(int gameTurn, const CanalRefreshInputs& inputs) const`.
   Refresh when invalid, the turn moves backward, or inputs differ. Otherwise refresh when `(gameTurn + playerID) % 7 == 0` and this turn has not already been refreshed. Include an elapsed-seven-turn fallback if updates missed the phased turn. Initial and forced refreshes do not reset this fixed phase, so another scheduled refresh can follow one to six turns later. Repeated calls within a stable turn reuse the result; an input change may force another refresh in that turn.

5. **Rebuild only after the decision.**
   Run the existing origin searches into a local `set<int> newWantedPlots`; preserve the original path type, flags, range, and destination membership. Swap it into `m_canalWantedPlots` when complete. Refresh the snapshot's wanted-plot component to describe the new set, store the inputs and turn, then mark valid. Empty results are valid cached results.

6. **Preserve canal scoring semantics.**
   Leave `WantCanalAtPlot` and the +3000 scoring rule unchanged. During skipped turns, an existing remembered passable canal continues to receive the same preference. An ownership or improvement change on a remembered tile forces a complete refresh before the next improvement update.

7. **Add temporary diagnostic counters and compare saves.**
   Count refreshes by reason, origin searches, resulting wanted plots, input-collection time, and total canal-planning time. Use existing DLL profiling/logging facilities. Keep permanent diagnostics only if they provide ongoing value. Prefix modifications with `// Vox Deorum:` as required by the repository.

## Concrete examples and estimates

All figures below are analytic illustrations, not measurements.

| Scenario | Current work | Proposed work |
| --- | --- | --- |
| Stable 14-turn interval, 10 origin cities, excluding startup and forced refreshes | 12 refreshes, 120 origin searches | 2 scheduled refreshes, 20 origin searches |
| First update lands on a currently skipped modulo turn | Existing set can remain empty or loaded | Immediate initial refresh |
| Foreign coastal city founded between scheduled turns | Next eligible current update sees it | Structural snapshot forces next builder update to refresh |
| Forced refresh occurs one turn before the player's fixed phase | Normal current cadence applies | Forced refresh followed by the scheduled refresh one turn later |
| Previously unexplored sea becomes revealed | Usually next eligible current update | May wait until next periodic refresh |
| Owned remembered fort changes owner or improvement | Detected by a later current refresh | Remembered-plot comparison forces next update to refresh |

In a stable interval excluding startup and forced refreshes, path-search count falls by about 83%: one refresh instead of six per seven turns. If one refresh costs `C` and each cheap input collection costs `S`, current seven-turn cost is approximately `6C`; proposed cost is `C + 7S`. With `F` additional initial or forced refreshes, it becomes `C * (1 + F) + 7S`. A forced refresh leaves the scheduled phase intact and can be followed soon by another refresh.

No end-turn speedup follows directly from this ratio. Profile canal planning's fraction of total turn time, cost per origin, snapshot overhead, forced-refresh frequency, and actual plan age. A game with frequent structural changes can gain much less.

Estimated implementation effort: 1 to 2 developer days for localized scheduling, lifecycle handling, and diagnostics; 1 to 2 more days for DLL builds, representative save comparisons, and policy tuning. Exact event-driven invalidation would be a separate, larger task.

## Risks and open questions

- The seven-turn delay is an AI policy choice. Compare canal construction and replacement decisions on coastal and archipelago saves before accepting that interval.
- Maintaining old positive preferences can temporarily favor a canal that is no longer useful. The next refresh removes obsolete entries.
- The structural snapshot is intentionally incomplete. Do not call it exact cache invalidation or extend it piecemeal while still claiming full correctness.
- Comparing all cities may cause refreshes for irrelevant destinations. Count refreshes by changed input category before deciding whether a narrower snapshot is worth a separate dependency audit.
- Reloading forces recomputation. The first post-load decision can differ from an uninterrupted run whose periodic cache is older. Save-format compatibility and replay determinism are separate acceptance checks.
- Confirm whether game options can change in a running session before adding them as snapshot fields. Avoid speculative runtime configuration support.

## Verification

1. Review the diff for unchanged serialized field order, path inputs, and scoring constants. Verify all new members initialize before use.
2. Build the DLL with the repository's Windows toolchain. A build-only release check can use `python build_vp_clang_sdk.py --config release` from `civ5-dll`; inspect its current prerequisites before running. When explicitly asked to build and deploy, use the documented `build-and-copy.bat` workflow.
3. Use recorded or controlled saves to check first-update refresh, all seven phase values, forced refresh immediately before a fixed phase, repeated same-turn updates, missed update turns, empty results, minors, save/load, city founding/capture/razing, sea-range changes, and ocean access changes. Start a new game after another game in the same process, including a smaller map, and confirm that prior wanted indices cannot reach snapshot collection.
4. Inspect a remembered operational canal across skipped turns and after a structural refresh. Compare its score preference and whether workers replace it. Check a lost owned tile and a freshly discovered alternative sea path.
5. Run matching multi-turn coastal saves with diagnostics. Report median and slow-turn timings together with canal-plan differences and forced refresh counts. There is no identified DLL unit-test harness for these scenarios; a successful TypeScript test run would not validate this change.

## Out of scope

Changing the canal score, path costs, candidate canal legality, trade-route algorithms, global map revisions, permanent canal protection, or save-file format.
