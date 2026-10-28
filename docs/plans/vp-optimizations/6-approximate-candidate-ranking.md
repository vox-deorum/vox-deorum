# Approximate ranking before exact candidate evaluation

## Goal and success criteria

Reduce unit path searches in peaceful garrison selection and normal operation recruitment by evaluating a small, cheaply ranked candidate set first. This is an explicit AI policy approximation: every chosen move remains exact and legal, but the chosen candidate can differ from exhaustive ranking.

- Preserve all existing unit eligibility, target eligibility, movement flags, exact arrival limits, formation compatibility, and assignment order.
- Retain exhaustive evaluation when a shortlist cannot produce a usable result or fill any originally free formation slot, including optional slots.
- Count exact searches saved, fallback rate, candidate changes, garrison extra arrival turns, recruitment score components/regret, optional and required slot fill, and the recruitment return count.
- Adopt each caller independently only after paired-save evidence shows useful speed gains and acceptable decision quality.

## Current state and candidate selection

| Area | Current behavior and source | Decision |
| --- | --- | --- |
| Garrison | [CvHomelandAI.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvHomelandAI.cpp), `PlotGarrisonMoves` calls `GetBestUnitToReachTarget`. The latter checks domain, processed/movement status, strength, and destination legality before exact `TurnsToReachTarget` for candidates. | Best initial shortlist candidate, restricted to peaceful cities. |
| Recruitment | [CvAIOperation.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAIOperation.cpp), `GrabUnitsFromTheReserves` already runs one broad `PT_ARMY_MIXED` reachability search from muster, calls `IsUnitSuitableForRecruitment`, then exact unit pathfinding. | Shortlist only the survivors of the existing coarse filter. |
| Patrol | `CvHomelandAI::ExecutePatrolMoves` already limits threat targets to three per domain and computes reusable stepfinder reachability from target cities. It chooses a staging plot with existing cheap checks. | Keep this existing coarse policy. It is not a loop of exact per-unit path queries to remove. |
| Exploration | `CvHomelandAI::GetBestExploreTarget` performs one unit-specific `GetPlotsInReach`, then ranks reachable plots by exploration value, high-value priority, movement, danger, and nearby explorers. | Keep the flood and scoring. Adding destination shortlists would replace an already batched search. |
| Infrastructure | [CvBuilderTaskingAI.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvBuilderTaskingAI.cpp), `UpdateRoutePlots`, `ConnectCitiesForShortcuts`, and `ConnectPointsForStrategy` already have owner/razing, distance, and strategic-value filters. `GetPathValues` and `AddRoutePlots` consume actual route plots. | Keep exact route planning in the first implementation. Geometric ranking cannot reproduce road reuse, villages, river/harbor links, or changing planned-route values. |

Other constraints:

- `GetBestUnitToReachTarget` is shared with sentries and engineer behavior. Its default behavior must remain exhaustive.
- Garrison selection currently chooses strictly fewer turns, so original candidate order resolves ties. A unit already on the target returns immediately.
- Recruitment sorts `10000 + power + border extra - 30 * adjustedArrivalTurns`. It adds arrival penalties outside own territory and across a land-area boundary, then greedily fills formation slots through `FindBestFitReserveUnit`.
- `IsUnitSuitableForRecruitment` includes healing/health, existing commitments, explorer/settler roles, embark/ocean capability, coarse reachability, and formation filters. The shortlist must not bypass any of these.
- `FindBestFitReserveUnit` is virtual; the nuke operation has a specialized override. Limit the first recruitment change to operations using the normal base selection contract.
- [CvAStar.cpp](../../../civ5-dll/CvGameCoreDLL_Expansion2/CvAStar.cpp), `UnitPathGetExtraChildren` adds airlift edges. Movement, rivers, embarkation, and route planning can be directional. A reverse coarse flood is a policy estimate, never proof of a forward unit path.

## Approach and alternatives

Separate exact cheap checks from approximation. Existing eligibility checks can reject candidates before searching. Keep them. Geometric or stepfinder arrival estimates can order a shortlist; they cannot safely reject every omitted unit as unreachable or slower.

Use caller-specific vectors and constants. Start with six garrison candidates and eight candidates per open formation slot. Exact-evaluate their union once. Widen to the remaining candidates when fallback conditions apply.

There is no general admissible distance bound here: roads, movement traits, approximate target rings, airlift, and directed transitions defeat a naive `hexDistance / baseMoves` proof. Exact branch-and-bound would require a proven bound for each movement model and recruitment score. It is a separate option if approximation quality is unacceptable.

Exhaustive evaluation remains the reference policy and fallback. Merely sorting all candidates but still evaluating every candidate can support measurements, but saves little search work by itself.

## Ordered implementation

### 1. Capture a decision baseline

Add development-only counters at the two chosen callers: eligible survivors, exact queries, successful queries, shortlist size, widening reason, and final selected IDs. Record the existing score and original ordinal for ties.

Create paired decision comparison before enabling a shortlist: evaluate both policies on an unchanged state and apply only one policy. Keep this diagnostic path separate from production timing.

### 2. Add opt-in peaceful garrison selection

In `CvHomelandAI.h/.cpp`, extend the helper with an explicit policy argument, for example `GetBestUnitToReachTarget(target, maxTurns, minStrengthTimes100, selectionPolicy = EXACT_SELECTION)`.

Only `PlotGarrisonMoves` passes `PEACEFUL_GARRISON_SHORTLIST`, and only when `getAtWarCount(false)` is zero and the city does not `NeedsGarrison()`. Preserve the exhaustive path for threatened cities, sentries, engineers, and all other existing callers.

Collect eligible candidates using the same domain, processed state, movement, strength, and `canMoveInto(..., MOVEFLAG_DESTINATION)` checks. Preserve the original on-target early return.

Use local records `{ unitID, originalOrdinal, estimatedArrival100, evaluated, exactTurns }`:

- Set `d = plotDistance(unitPlot, target)` and `v = max(1, baseMoves(false))`. `baseMoves(false)` already includes ordinary promotion movement. Compute `estimatedArrival100 = max(0, ceil(100 * d / v) - 100)` using integer ceiling division `(numerator + denominator - 1) / denominator` and signed 64-bit intermediates. Clamp the stored value to `INT_MAX - 1`. The scale is hundredths of a turn, with the current movement turn numbered zero. It is a heuristic, not a lower bound. Keep the existing exact query's route-aware rejection unchanged.
- Sort by increasing estimate, then original ordinal. Take six entries and include entries tied with the sixth estimate to avoid arbitrary geometric ties. There is no approximate target-ring offset for this garrison query because its exact flags request the city itself.
- Query exact arrival with the existing `MOVEFLAG_NO_ENEMY_TERRITORY` and original maximum turns. Choose by exact turns, then original ordinal, within the evaluated set.
- Widen to all remaining eligible entries if no shortlist candidate is reachable, or if the best exact result exceeds `max(1, maxTurns / 2)`. Skip evaluated entries, including failures.
- Keep squads on the exhaustive path initially because arrival evaluation can resolve alternate squad destinations. Air units remain outside the new policy. Apply the conservative airlift bypass below.

Preserve `CvHomelandUnit::MovesToTarget` writes for exact-evaluated entries and leave omitted entries' shared fields unchanged. Repository references show its sole reader is `CvHomelandUnit::operator<`; the two sorts of `m_CurrentMoveUnits` in `CvHomelandAI.cpp` both use explicit auxiliary-value comparators, so they do not consume that field. Keep all new estimates and selection in the local vector and preserve shared-array ordering. Never store a guessed value as an exact arrival count.

Use a conservative `HasPotentialAirliftSources(player)` decision-level check: any same-team city with `CanAirlift()`, enabled `MOD_EVENTS_AIRLIFT`, or any configured improvement type with `IsAllowsAirliftFrom()` forces exhaustive selection. Inspect these once per decision batch, not per candidate. The improvement-data check intentionally bypasses even when no such improvement is built. This covers current and reachable intermediate airlift sources without a new connectivity cache, at the cost of some late-game/modded savings.

### 3. Shortlist recruitment after existing coarse filtering

In `CvAIOperation.cpp`, add an early `GetOperationType() == AI_OPERATION_NUKE_ATTACK` bypass to the unchanged exhaustive path before constructing any shortlist records or estimates. This is the only specialized `FindBestFitReserveUnit` override found in this checkout; any future override must receive an explicit bypass before using this policy.

Keep the existing muster flood, ocean flags, and every `IsUnitSuitableForRecruitment` check. If `turnsFromMuster` is empty, use the unchanged exhaustive recruitment path for this call. Collect only suitability survivors with valid coarse entries into local `ReserveCandidate` records:

`{ unitID, originalOrdinal, matchingOpenSlots, estimatedScore100, evaluated, exactArrivalTurns, exactScore, reachable }`.

Build `matchingOpenSlots` using the same unit-info role compatibility used by `FindBestFitReserveUnit`, including primary and secondary roles. Extract a small shared compatibility predicate if needed; do not substitute the suitability helper's first returned matching index for all compatible slots.

For a coarse flood entry, set `B = SPath::getNormalizedDistanceBase()`, `v = max(1, baseMoves(isEmbarked()))`, and `distanceRaw = max(0, coarse.iNormalizedDistanceRaw - 2 * B)`. Use the embarked branch's movement rules without adding ordinary extra movement separately. The two-step deduction mirrors this query's ring-2 target allowance only as an ordering heuristic. Compute `arrival100 = max(0, ceil(100 * distanceRaw / (B * v)) - 100)` and add 100 for each of the existing outside-own-territory and land-area penalties. Use the current border extra unchanged. Then `estimatedScore100 = 100 * (10000 + power + borderExtra) - 30 * arrival100`.

Use signed 64-bit intermediates and storage for this estimate, cast before multiplication, and use positive-denominator integer ceiling division. With a nonempty coarse map, the existing suitability predicate rejects units whose plots have no entry; do not invent a sentinel-ranked candidate for them. Higher estimated scores rank first, with original ordinal resolving ties. No estimate becomes an exact score or reachability answer.

Take the best eight candidates for each open slot, including ties at the boundary. Union and deduplicate by unit ID. This preserves rare formation roles that a global top-eight list could omit.

Run the exact existing `TurnsToReachTarget` call once per selected candidate, with the same ring-2, ignore-own-stacking, ignore-ZOC flags and recruitment bound. Preserve arrival penalties and the exact score formula. Store successes and failures locally so widening does not repeat them.

Stable-sort the exact reachable choices with the original score/tie semantics. Before any `AddUnit` or army mutation, simulate the existing greedy slot walk with a local used-unit set and the shared role predicate.

If any originally free slot remains empty in the simulation, including an optional slot, evaluate all remaining eligible candidates, combine exact choices, and rerun the original greedy simulation. Reuse the local success/failure memo so previously evaluated candidates are not searched again. Then execute the existing ordered assignment flow once. Preserve optional-slot fill, the required-unit build list, and the number of recruited units returned by this function when fallback runs.

For small pools of eight or fewer survivors, use the existing exhaustive loop. Keep `AI_OPERATION_NUKE_ATTACK`, any other audited specialized virtual selector, squads, and decisions flagged by the same conservative airlift check on the existing path. Do not change `FindBestFitReserveUnit`'s public virtual signature.

### 4. Make rollout caller-specific

Keep one development switch for reference-versus-shortlist comparison, then use existing project configuration conventions for a single experimental opt-in if a runtime gate is needed. Avoid separate tuning systems for every threshold.

Leave patrol, exploration, capital/scenario connections, shortcuts, and strategic roads unchanged. Record their current query counts so later optimization work starts from actual cost.

Add purpose comments to functions and use `// Vox Deorum:` on changed upstream code. Document accepted policy behavior in existing developer performance documentation only if this implementation is adopted.

## Examples and unmeasured estimates

These are analytic workload examples, not measurements or promised whole-turn gains.

| Example | Exhaustive work | Shortlist work | Implication |
| --- | --- | --- | --- |
| Peaceful garrison, 30 eligible units, no tied boundary | 30 unit queries | 6, or 30 after widening | 80% fewer queries on a successful first pass |
| Same garrison workload, 25% widening rate | 30 per decision | `6 + 0.25 * 24 = 12` on average | 60% fewer queries; sorting and eligibility still cost time |
| Recruitment, 60 survivors, three slots with similar role rankings | 60 exact queries after the existing coarse flood | 8 to 24 distinct queries before fallback | About 60% to 87% fewer unit queries; coarse flood is unchanged |
| Recruitment shortlists leave any originally free slot unfilled | 60 | 60, with stored results reused | No query savings, plus ranking/simulation overhead |

A nearby two-move unit can need four turns around a mountain while a distant unit arrives in one turn by road. If the nearby shortlist supplies a two-turn unit and widening does not trigger, the new policy can choose it. Track one extra arrival turn as quality loss even though both paths are legal. An omitted unit could instead arrive in the current turn, creating two turns of regret under the default bound of four. The widening rule supplies no deterministic regret bound.

For recruitment, if the exhaustive choice scores 10,080 and the shortlist choice scores 10,020, composite score regret is 60. With equal power and other terms, that corresponds to two arrival turns at the existing 30-point penalty. Different power or border bonuses make this only a score comparison. Keep the composite criterion for all changed selections, and also report exact power, adjusted arrival turns, and border-extra differences separately so compensating terms remain visible.

For `N` survivors, shortlist union size `K` and fallback probability `p`, expected arrival-query calls are approximately `K + p * (N - K)`. Tied boundaries can make `K = N`. Count actual `ComputePath` calls and expanded nodes: `TurnsToReachTarget` can reject candidates before searching, and recruitment retains its coarse flood and later `CvArmyAI::AddUnit` arrival queries. Measure bypass frequency as well as fallback frequency. If these callers hypothetically consume 10% of a turn and their runtime falls 50%, turn time falls about 5%; neither input is measured. Plans 3 and 5 can reduce the remaining opportunity.

Estimated effort: 2 to 3 engineer-days for baseline/comparison counters, 2 to 3 for peaceful garrisons, 3 to 5 for recruitment and pure pre-assignment simulation, plus 2 to 3 for paired-save quality checks. Implement and evaluate garrisons first; recruitment has more assignment risk.

## Risks and open questions

- Fallback restores completeness when no usable shortlist result exists. It does not guarantee the exhaustive best choice when the shortlist succeeds.
- Recruitment can fill every originally free slot while selecting a weaker or slower combination. Slot-fill rate and an unchanged return count alone are insufficient validation.
- Stable ties, rare roles, wildcard suitability, and virtual selector overrides need an explicit audit before enabling recruitment.
- The conservative airlift check can disable the optimization for an entire mod configuration that defines an airlift-source improvement. Measure this scope loss before proposing a narrower check.
- Routes and directed movement can misrank candidates even without airlift. Keep exact forward queries for selected candidates and quantify regret.
- Planned infrastructure has stateful value interactions. A future road shortlist would need a separate policy decision and route-quality evidence.
- Thresholds six/eight and the slow-garrison widening threshold are starting hypotheses. Paired-save evidence determines whether they are useful.

## Verification

1. Build release with `python build_vp_clang_sdk.py --config release` from `civ5-dll/` and run the supported MSVC build before upstream submission. See [DEVELOPMENT.md](../../../civ5-dll/DEVELOPMENT.md). npm checks do not establish DLL AI behavior.
2. In development comparison mode, derive exhaustive and shortlist decisions from the same unchanged state before executing either. Compare selected IDs, exact arrival turns, composite scores and their power/arrival/border components, compatible roles, optional and required slot fill, and the simulated recruitment return count. Include empty coarse maps and verify the exhaustive bypass.
3. Exercise small pools, tied boundaries, unreachable nearest units, rare-role recruits, multi-role units, optional/required slots, wildcard suitability, naval/mixed operations, finite recruitment bounds, and specialized operations that must bypass shortlisting.
4. Cover roads/railroads, river crossings, promoted movement, embarkation, blocked borders, ZOC/stacking, approximate rings, squads, and airlift. Compare promoted three-move units seven plots away with an unpromoted four-move unit eight plots away on open terrain. Confirm bypasses work and every accepted candidate passed the original exact forward query.
5. Verify no assignment or mission occurs during comparison/simulation. Real `AddUnit`, required build-list updates, processed flags, and movement happen once in the original order.
6. Profile identical saves with comparison mode disabled. Record query counts and caller/turn CPU time across peaceful, wartime, archipelago, and crowded late-game scenarios. Deployment uses `powershell -Command "& .\build-and-copy.bat"` from `civ5-dll/`, which builds and copies the DLL.
7. Provisional acceptance targets: zero legality/compatibility violations, zero extra missing optional or required slots and unchanged recruitment return counts in paired decisions, at least 25% fewer exact queries in the enabled callers, garrison arrival regret no greater than one turn in at least 95% of changed choices, and composite recruitment score regret at most 60 in at least 95% of changed selections. The 95% thresholds are empirical acceptance hypotheses, not deterministic bounds supplied by shortlisting or fallback. Report full regret distributions, worst cases, score components, and fallback frequency; these policy thresholds require owner review before default enablement.

No standalone C++ AI test harness was identified. Use temporary assertions and decision comparisons in the real DLL, then run several autoplay games for crashes, stalled garrisons, recruitment delays, and recurring fallback. Long-run outcomes are evidence about quality, not proof of strategic equivalence.

## Out of scope

Global path caches, altered A* heuristics or movement legality, reversing unit graphs, replacing road-build paths with distance estimates, changing patrol/exploration policy, pruning capital/scenario connections, or promising identical strategic outcomes.
