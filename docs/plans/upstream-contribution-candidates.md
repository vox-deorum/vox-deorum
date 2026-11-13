# Candidate upstream contributions

This plan selects focused Vox Populi contributions from the current Vox Deorum DLL. Prioritize finishing existing submissions, then extract the remaining small fixes and performance changes. Treat larger AI features as separate proposals with their own evidence.

## Goal and comparison basis

Success means each proposed PR has a surviving difference from current upstream, a useful upstream consumer or reproducible problem, a bounded extraction, and an appropriate verification gate. An old export hunk alone does not establish a new candidate.

Checked on **2026-11-13**, after fetching both DLL remotes:

| Reference | Commit | Purpose |
| --- | --- | --- |
| Active VD branch, `vox-deorum-5.2` | `e2ec493f66bb69113d35764800a6834951b9772d` | Source implementations. This is the maintained line selected by `scripts/vp-lines.txt`. |
| Shared upstream ancestor, VP 5.2.7 | `76a576152f00a8780ced6c6721d3cd46c51d151b` | Identify changes introduced on the VD side. |
| Refreshed `upstream/master` | `16596561fcd3779ad4d933cb87a56b69877751b2` | Check whether each change is still missing upstream. |

The fresh export is `temp/upstream-review/candidates-2026-11-13/`, with **146 file entries** and a clean DLL working tree. Its manifest and individual patches record the ancestor-to-VD inventory. Direct comparisons with refreshed upstream source and GitHub PR metadata establish current disposition. Upstream has substantial changes absent from the 5.2 branch, including a new worker planner; those absences must never be extracted as reversions.

PR states below are a snapshot of the upstream PR list and `CIVITAS-John` submissions on that date. Local `pr/*` branches alone do not establish submission. Paths are relative to `civ5-dll/`; **core** means `CvGameCoreDLL_Expansion2/`, and **Lua** means its `Lua/` directory. Patch numbers belong to this fresh export only.

## Existing submissions to finish first

Continue the existing PR for each item. Recheck its current patch and review discussion before changing the corresponding local branch.

| Open PR | Behavior and source | Follow-up |
| --- | --- | --- |
| [#13392](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13392) | Election influence-loss events without a spy, observer unit flags during combat, and named cooperative-war partners. `CvMinorCivAI.cpp`, `UnitFlagManager.lua`, `CvLuaPlayer.cpp`, `CoreNewUIText.xml`. | Keep the no-spy event behind `MOD_EVENTS_ESPIONAGE`, preserve ordinary player animations, and keep localization arguments together. This PR does **not** contain the incoming-route countdown fix. |
| [#13393](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13393) | Tactical simulation work reduction: safe-plot early exit, fewer copies, line-of-sight reuse, compact attack results, and best-position selection. `CvTacticalAI.cpp` and `.h`. | Resolve overlap with [#13517](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13517), which separately proposes the safe-plot early exit. Require unchanged decisions for performance-only hunks. |
| [#13424](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13424) | Dominance-zone caches and tactical movement-cache reuse. `CvTacticalAnalysisMap.cpp`, `CvTacticalAI.cpp`, `CvAStarNode.h`. | Coordinate with [#13519](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13519), which also changes zone construction and strength calculation. Avoid duplicate ownership of the same optimization. |
| [#13473](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13473) | Continue after an unexpected ranged kill when no later assignment depends on the target plot. `LaterRowsDependOnPlot`, `ExecuteUnitAssignments`. | Cover later attacks and moves onto that plot, planned kills that fail, and unchanged melee handling. |
| [#13483](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13483) | Threatened garrisons participate in search, with deferred holding and falling-city checks. `CvTacticalAI.cpp` and `.h`. | Resolve the gameplay tradeoff: the PR reports more enemy losses and less ground lost, but also more cities lost and no detectable overall grade gain. |
| [#13485](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13485) | Reuse exploration snapshots and avoid repeated copying. `CvEconomicAI`, `CvHomelandAI`, `CvUnit`. | Preserve refresh points after movement and ruins, target order, and selected exploration missions. |
| [#13487](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13487) | Bound homeland path searches while choosing units. `CvHomelandAI`, `CvUnit`. | Preserve selection and tie order, reachability limits, and unreachable-target behavior. |
| [#13559](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13559) | Estimate combat using planned neighbor positions: flanking, formation and aura modifiers, and blockade handling. `CvUnit`, `CvPlot`, `CvTacticalAI`. | Review cache identity and invalidation, planned deaths and movement, and measured cost. Keep attack-neighborhood infrastructure separate from the larger air and flavor features. |

Two additional open performance proposals touch neighboring pathfinding work: [#13518](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13518) memoizes route-build callbacks, and [#13520](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13520) replaces simple distance floods with breadth-first traversal. Their implementations are absent from this VD snapshot. Compare their patches before proposing related work. The VD operational loop's bounded `SearchReachPlots` is a separate consumer.

## Remaining small extractions

### 1. Correct remaining turns on incoming trade routes

`CvLuaPlayer::lGetTradeRoutesToYou` still subtracts completion turn from current turn upstream. Return completion turn minus current turn, matching outgoing routes. The fix survives in VD, and none of the checked submissions contains it.

**Source:** Lua `CvLuaPlayer.cpp`, patch `0108`. **Verification:** inspect the same active route from both participants, confirm the countdown decreases toward completion, and check completion and renewal conventions. Extract just this expression.

### 2. Skip nonlocal path expansion on ordinary nodes

`UnitPathGetExtraChildren` can return before resolving the plot and unit when the node's cache supports no nonlocal movement. Current upstream still performs those lookups first. Adapt VD's three capability checks to include upstream's newer `bCanSealiftFromPlotCity`; copying the old guard would silently suppress sealift paths. Keep the initial output clear.

**Source:** core `CvAStar.cpp`, patch `0017`. **Verification:** compare paths and extra-child lists for ordinary plots, city and improvement airlifts, port changes, and sealifts. Keep this independent of heap, danger-cache, and route-callback changes already submitted or merged. The same patch reuses `bIsVisibleNeutralCombatUnit` in the neutral-stacking check; verify visible and hidden plot behavior independently before including that hunk.

### 3. Reduce canal-planning refreshes

`CvBuilderTaskingAI::UpdateCanalPlots` currently runs on six turns out of seven upstream. VD changes the condition to run on the player's one phase turn, skips the search when passable forts are disabled, and clears `m_canalWantedPlots` in `Uninit`.

**Source:** core `CvBuilderTaskingAI.cpp`, patch `0024`. **Gate:** confirm the desired interval with upstream and inspect every current consumer of the cached plan. This changes plan freshness, so exact behavioral parity is not an acceptance criterion. Verify startup, loading another game, changed ownership and terrain, and both settings of `GLOBAL_PASSABLE_FORTS`. Port these hunks into the new upstream worker planner without replacing its surrounding implementation.

### 4. Compute worker reachability only when needed

VD replaces the eager worker-wide reachability pass with `GetWorkerReachablePlots` and an invocation-local `WorkerReachabilityCache`. Entries rebuild when the worker's start plot, moves, or embarked state changes. Cheap directive filters run before requesting the path search.

**Source:** core `CvHomelandAI.cpp` and `.h`, patches `0056`–`0057`. **Gate:** redesign against upstream's new worker planner. The VD cache explicitly tolerates stale visibility, stacking, routes, and features within an invocation; lazy evaluation can also observe a later board than the old eager snapshot. Specify intended semantics, then compare directive choices, executed work, and path-search counts on worker-heavy turns. Parity remains to establish.

## Additive APIs and events

Each row is a separate possible PR unless shared prerequisites make a combined review smaller. Start with a concrete Lua or scenario consumer. Document chosen Lua contracts in LuaCATS. APIs previously bundled in [#11995](https://github.com/LoneGazebo/Community-Patch-DLL/pull/11995) remain **closed unmerged**; new proposals need independent scope and removal of IPC dependencies.

| Candidate | Current source | Extraction and verification gate |
| --- | --- | --- |
| Map identity and original seed inputs | Lua `CvLuaGame.cpp` and `.h`; `LuaCATS/Game.d.lua`. Patches `0106`–`0107`, `0139`. | Extract `Game.GetMapScriptName` and `Game.GetRandomSeeds`. Read pregame inputs without advancing RNG state. Check new and loaded games and document what the seeds mean. Previously in #11995. |
| Cooperative-war target eligibility | Lua `CvLuaPlayer.cpp` and `.h`; native `CvDiplomacyAI::IsValidCoopWarTarget`. Patches `0108`–`0109`. | Expose eligibility independently of friendship requirements for making a request. Validate player inputs and preserve request-versus-execution semantics. Exclude promise writes. |
| Per-item deal values and complete-deal validation | Lua `CvLuaDeal.cpp` and `.h`; native `CvDealAI`, `CvDealClasses`. Patches `0104`–`0105`, `0036`–`0039`. | Expose each participant's normal item valuation and guarded `AreAllTradeItemsValid`. Preserve `MOD_ACTIVE_DIPLOMACY`. Remove human-to-human overrides and enactment. Check invalid participants, valuation sentinels, and scratch-deal contents before and after a query. |
| Tactical-zone inspection | Lua `CvLuaPlayer.cpp` and `.h`, `CvLuaUnit.cpp` and `.h`; core `CvTacticalAnalysisMap`. Patches `0108`–`0112`, `0078`–`0079`. | Expose count, details, and a unit's zone from a selected player's perspective. Define freshness and visibility, and validate IDs including water zones. Exclude capture accessors and flavor writes. Previously in #11995. |
| Replay messages from Lua | `CvLuaPlayer::lAddReplayMessage`, Lua `CvLuaPlayer.h`. Patches `0108`–`0109`. | Use existing replay storage for scenario events. Check message type, coordinates, text, save/load, and replay display. |
| Economic and military strategy prerequisites | Core `CvEconomicAI`, `CvMilitaryAI`; Lua `CvLuaPlayer`. Patches `0043`–`0044`, `0059`–`0060`, `0108`–`0109`. | Share civilization restrictions, required and obsolete techs, and earliest-turn checks with native selection. Return all eligible strategies. Exclude VD blacklists and delayed reactivation. Keep eligibility distinct from activation. Previously in #11995. |
| Ranked settlement candidates | `CvPlayer::GetBestSettlePlots`, existing `GetBestSettlePlot`, and Lua wrapper. Patches `0063`–`0064`, `0108`–`0109`. | Preserve the single-result choice, reachability rules, and tie order. Return structured coordinates and scores with a bounded limit. Check visibility, search cost, and the no-candidate case. |
| Before-transfer tile-theft event | `CvCity::BuyPlot`, `CvUnit::PerformCultureBomb`, `CustomMods.h`. Patches `0026`, `0099`, `0014`. | Standardize `StealPlot` behind an upstream event option. Define coordinates and old/new owners and distinguish it from existing ownership notifications. Check purchases, culture bombs, unowned tiles, and callback timing. |
| Victory event | `CvGame::setWinner`. Patch `0048`. | Agree on team versus player identity and once-only timing. VD's `PlayerVictory` Lua hook reports the winning team's leader and victory type. Remove IPC gating and capture shutdown; test team victories and loaded ended games. |

## Larger proposals requiring a separate decision

### Observer perspective

Make the selected civilization consistently determine observer fog, discovered resources and resource graphics, diplomacy tooltips, and civilization lists. Retain the real active player for chat, notifications, and network actions.

**Source:** core `CvGame`, `CvPlot`, `CvTeam`; `InfoTooltipInclude.lua`, `DiploList.lua`, `DiploCorner.lua`, `EUI_tooltip_library.lua`, `NotificationPanel.lua`. Patches `0001`, `0005`–`0008`, `0048`, `0066`, `0088`. **Gate:** define one perspective contract and cover ordinary observers, pinned observers, switching, technology changes, and normal human play. The war-duration correction already merged separately.

### Research and policy preview queries

Offer dedicated queries for available techs, including an assumed prerequisite, and adoptable policies or branches, optionally ignoring affordability. VD wrappers still enter recommendation or selection paths. Separate candidate collection from logging, cached recommendation mutation, RNG use, and consumption of forced choices before exposing a query.

**Source:** core `CvTechAI`, `CvTechClasses`, `CvPolicyAI`, `CvPolicyClasses`; Lua `CvLuaPlayer`. Patches `0068`–`0071`, `0090`–`0093`, `0108`–`0109`. **Gate:** repeated queries preserve subsequent AI decisions and forced choices while respecting branch restrictions and hypothetical tech prerequisites. Both APIs were in closed-unmerged #11995. Exclude forced-state serialization.

### Coordinated air search

The implementation now lives mainly in `CvTacticalAirSearch.cpp` and `.h`, with `CvTacticalSearchShared.h` and integration in `CvTacticalAI`. It plans strikes, sweeps, and carrier movement; tracks interceptions and certain versus uncertain damage; groups interchangeable aircraft; and has its own search limits. `VOX_TACTICAL_AIR_SEARCH` defaults off. See [air search](../developers/civ5-dll/unit-ai/simulation/air.md).

**Source:** patches `0074`–`0077`, `0086`, relevant `CvPlot` and `CvUnit` hunks, option declarations, and build source lists. **Gate:** separate neighborhood-estimation PR #13559 and already-merged air-estimate fixes. Prove option-off behavior, acceptable memory and turn-time cost, correct carrier/base losses and interception accounting, and useful gameplay gains across representative games. Shared helpers also affect conventional air targeting; a default-off switch alone does not establish option-off parity. Strip RL capture and external policy routing.

### Tactical flavors and intent adjustments

VD adjusts risk, occupation, attrition, city defense, and ground defense in tactical scoring, with modifiers at civilization, operation, and zone level. `VOX_TACTICAL_INTENT_FLAVORS` controls default intent offsets; it does not gate the whole flavor system. See [flavor scoring](../developers/civ5-dll/unit-ai/flavors/scoring.md).

**Source:** core `CvTacticalAI`, `CvTacticalAnalysisMap`, `CvAIOperation`, `CvPlayer`, and related flavor code. **Gate:** agree on upstream configuration and a minimal useful subset. Remove `VoxDeorumRL/schema` dependencies, external writes, and save-layout changes. Demonstrate neutral behavior and evaluate each non-neutral policy separately. Keep this out of correctness and performance PRs.

### Trade-route interception and protection in search

`CvTacticalTradeSearch.cpp` scores where units end relative to the next steps of enemy and friendly trade routes. `VOX_TACTICAL_TRADE_SEARCH` defaults off. It shares movement arithmetic with `CvGameTrade::StepTradeUnitLocation` and reads possible capturers from danger data. See [trade scoring](../developers/civ5-dll/unit-ai/simulation/scoring.md#trade-routes).

**Source:** patches `0087`, `0034`–`0035`, `0094`–`0095`, and tactical integration. **Gate:** validate direction, circuit completion, expiring routes, corporation protections, visibility, plunder legality, and refresh after route changes. Establish a gameplay benefit without excessive movement toward routes or search cost. Keep helper extraction tied to an accepted consumer.

### Global operational command loop

`VOX_TACTICAL_OPERATIONAL_LOOP` replaces non-barbarian zone-by-zone combat and reinforcement scheduling with battlefield offers, readiness checks, execution, and reprioritization. This adds `CvTacticalOperationalLoop`, `CvTacticalOperationalValue`, and `CvTacticalOperationalWeights`. See [operational loop](../developers/civ5-dll/unit-ai/tactics/operational-loop.md).

**Source:** patches `0080`–`0085`, tactical integration, danger access, and defines/options. **Gate:** reconcile copied native routines with current upstream, separate simulator grading and capture adapters, and agree on configuration and maintenance ownership. Compare full-turn outcomes, city and unit losses, reinforcement behavior, command limits, and runtime against current upstream. Default-off and a working simulator are insufficient evidence for adoption.

### Production scoring and weight accumulation

The square-root flavor change remains in the four production scorers and [#12800](https://github.com/LoneGazebo/Community-Patch-DLL/pull/12800) remains **closed unmerged**. Its review questions whether strengthening building flavors fits upstream's production-AI direction. Revisit with an agreed production design and gameplay evidence; exclude custom settler and mobilization overrides.

The separate `CvWeightedVector::IncreaseWeight` zero-floor change also remains absent upstream. Audit signed-adjustment callers: clamping every update can make results order-dependent, and it does not address overflow. A caller-local fix may be more appropriate.

**Source:** patches `0012`, `0025`, `0072`–`0073`, `0103`. **Gate:** establish intended negative-weight semantics and representative production behavior before proposing either change. Suppressing an assertion alone does not establish a correct fix.

### Turn scheduling and scenario-controlled deals

Hold the `PlayerDoneTurn` extra argument until its meaning is agreed: VD scans for the next living slot, which is not necessarily the next actor in simultaneous or team turns. Preserve existing event compatibility. **Source:** core `CustomMods.h`, `CvPlayer.cpp`, patches `0014`, `0063`.

Hold generalized deal enactment until an upstream scenario consumer justifies an explicit API. VD's human-to-human overrides span item legality, valuation-cache identity, finalization, and Lua bindings. Normal valuation queries can be extracted earlier. **Source:** core `CvDealAI`, `CvDealClasses`; Lua `CvLuaDeal`, `CvLuaPlayer`; EUI `TradeLogic.lua`, patches `0036`–`0039`, `0104`–`0105`, `0108`, `0009`.

## Already upstream

These changes can still appear in the 5.2-based export. Refreshed upstream already contains them.

| Behavior | Upstream evidence |
| --- | --- |
| Include prior attacker, defender, and city damage in `AttackKey::operator==` | Commit [`2bc6d34a1`](https://github.com/LoneGazebo/Community-Patch-DLL/commit/2bc6d34a1). |
| War-duration tooltip opponent and defeated-leader popups during autoplay | Merged [#13360](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13360). |
| Trait combat-bonus initialization and related optimization | Merged [#13391](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13391). |
| Equal-cost pathfinding determinism and per-search danger memoization | Merged [#13361](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13361) and [#13408](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13408). |
| Pathfinder node cleanup and redundant-work removal | Merged [#13423](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13423). #13422 closed unmerged; use the successor's provenance. |
| Tactical scratch-state reclamation and support checkpoints through bookkeeping | Merged [#13421](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13421) and [#13366](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13366). |
| Air-attack damage and quick-estimate parameter correction | Merged [#13468](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13468). Broader coordinated air search remains separate. |
| Wrapped-map army contact selection and global distance undercount | Merged [#13534](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13534) and [#13495](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13495). |
| Duplicate splash kill rewards and pillage-heal HP calculation | Merged [#13542](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13542) and [#13551](https://github.com/LoneGazebo/Community-Patch-DLL/pull/13551). |
| Declaration-of-friendship `break`, tactical attack-strength width, and homeland opportunity-attack log name | Present in current upstream source. Keep unrelated deal checks and logging edits out of these completed fixes. |

## Extraction order and verification

1. Resolve review and overlap in existing submissions, especially #13393/#13517 and #13424/#13519. Refresh their diffs before any new port.
2. Extract the incoming-route countdown and nonlocal-path early exit independently. Agree on canal-plan freshness before porting it. Investigate worker reachability against the current planner separately.
3. Select additive APIs with a current consumer. Prefer small replay, map/seed, and cooperative-war wrappers before queries that enter AI selection paths. Keep independent event contracts separate.
4. Discuss each larger feature before implementation. Establish dependencies on pending PRs and define a minimal proposal, defaults, save compatibility, runtime budget, and gameplay acceptance criteria.
5. For each approved extraction, follow the [upstream contribution workflow](../developers/civ5-dll/upstream-contributions.md): use a refreshed upstream-based branch, port selected hunks, remove VD dependencies, and leave edits available for human review.

For C++ extractions, build the upstream checkout with `python build_vp_clang_sdk.py --config debug` using the workflow's process-local PATH setup. Check supported compiler paths when available and report missing tooling. Use `git diff --check` and inspect changed files for IPC, capture, and save-layout residue. Lua and localization changes need the relevant in-game reproduction; queries need repeated-call checks for unchanged RNG, forced choices, and game state. Performance claims need representative timings and decision parity; intentional behavior changes need gameplay comparisons.

This plan was verified through source, history, exported diffs, and live PR metadata. No extracted patch was built or tested in-game during this inventory refresh.

## Out of scope

- Connection service and schemas, ArduinoJson and compatibility headers, message pumping, and external-agent event forwarding.
- `VoxDeorumRL/`, capture callbacks, generated schemas, simulator recording accessors, and grading-only interfaces without an upstream consumer.
- Forced research or policy persistence, custom flavor serialization, scenario modifiers, promise writes, and custom diplomacy notifications. These need separate feature and save-format design.
- Assertion suppression, `PRECONDITION` replacement, release optimization changes, fork CI, deployment scripts, and build-list additions used only by VD.
- Publishing PRs, switching or rewriting existing review branches, staging changes, and backporting to additional VD lines as part of this plan refresh.
