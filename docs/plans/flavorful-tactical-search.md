# Flavorful tactical search: upstream VP pull request

This plan sends flavorful tactical search to upstream Vox Populi (`LoneGazebo/Community-Patch-DLL`) as one pull request. It also keeps VD's training and simulation features working.

## Background

The offline simulator in `vox-deorum-rl` showed that flavorful search beats a ten times larger search budget. The write-up is `vox-deorum-rl/plans/flavorful-search-issue.md`. The PR has two parts, both behind one switch that defaults off:

1. **Strategy rows.** Military and economic strategies carry values for the five tactical flavors: RISK, OCCUPATION, ATTRITION, HOLD_CITY and HOLD_GROUND.
2. **Purpose table.** Each tactical search adds a small fixed modifier for its purpose, such as a city assault, a hedgehog or a reinforcement move. The table is the one we tested.

Upstream has none of the five-flavor machinery yet. Issue #13342 was a proposal, and it is now closed. The PR must therefore also carry the base:

- the flavor declarations
- how the flavors for one search are worked out
- the scoring changes

All of it behaves exactly like stock VP at neutral values.

VD's fork (`vox-deorum-5.2`, based on VP 5.2.7) already has all of this. The RL simulator pulls that code out of VD's source by exact symbol name, and in two places by exact text. The PR branch is separate from VD. Keeping training and simulation working therefore depends on how VD later adopts the same behavior (Part C).

## Decisions

| Topic | Decision |
| --- | --- |
| Switch | A CustomModOption that defaults to 0, **plus** an Advanced Setup checkbox. Either one turns the feature on. |
| Part 2 form | The purpose table as tested: the `SearchIntent` enum plus `TACTICAL_INTENT_FLAVOR_DEFAULTS`, with the same names and values. |
| Modifiers | Include the civ, operation and zone modifiers and the Lua API. Only Lua sets the civ modifiers. The operation and zone modifiers are C++ hooks that nothing sets yet, so they are labelled experimental. |
| Part 1 data | Strategy rows only. Re-measure in the simulator before opening the PR, and add a personality fallback only if the gain disappears. |

## Part A: the PR branch

The branch is `pr/flavorful-tactical-search` in `civ5-dll`. Follow the upstream-pr skill and `docs/developers/civ5-dll/upstream-contributions.md`.

- **Branch setup.**
  - Run the `vp-diff` export first.
  - Then run `vp-pr new flavorful-tactical-search` from `upstream/master`.
  - Remove the automatic upstream tracking and set `pushRemote` to `origin`.
- **Porting.**
  - Port by hand from the VD source: the commits "Flavorful tactical search", "part 2", "Hold_ground improvement", "Improved hold_city factors" and "Improved flavorful search", plus later edits in the current HEAD.
  - Leave the edits unstaged.

### A1. The switch

- **CustomModOption `FLAVORFUL_TACTICAL_SEARCH`.**
  - Declare it in `CustomMods.h` and `CustomMods.cpp`.
  - Add a row with value 0 and a comment in `(1) Community Patch/Database Changes/NewCustomModOptions.xml`.
  - Follow the `ROUTE_PLANNER` pattern.
- **Advanced Setup checkbox `GAMEOPTION_FLAVORFUL_TACTICAL_SEARCH`.**
  - Add a string define in `CvGameCoreDLLUtil/include/CvEnums.h`, next to the endgame aggression option.
  - Add a row in `(1) Community Patch/Database Changes/CoreNewGameOptions.xml`.
  - Add description and help text in the CP game option text file.
  - String options need no enum value and add no save data.
- **One helper.** `TacticalAIHelpers::IsFlavorfulSearchEnabled()` checks the CustomModOption, then the game option.
  - The string option lookup is a short linear scan, the same as existing uses such as the chill barbarians option.
  - Call the helper once when working out a search's flavors, never inside scoring loops.
- **Civ modifiers ignore the switch.** They are explicit Lua requests. The PR description says so.

### A2. The five flavors (the base, not gated, stock at neutral)

- **Database.**
  - A new CP SQL file in `(1) Community Patch/Database Changes/AI/` inserts the five `Flavors` rows.
  - Register it in the CP `.civ5proj`, then regenerate the `.modinfo` and its checksums with `scripts/generate_modinfo.py`.
  - Do the same for every edited XML or SQL file.
  - No upstream code loops over the Flavors table in a way that the new rows would change.
- **`CvFlavorManager`.**
  - Port the game-scale table and its helpers: `FlavorToGameScale`, `FlavorFromGameScale` and `ShiftFlavor`.
  - Add a `GetActiveFlavor` accessor.
  - Read the base personality through upstream's existing `GetPersonalityIndividualFlavor`. The diplomacy variant is rescaled, so don't use it.
  - Drop all of VD's custom flavor code.
- **`CvTacticalAI`.** Port these as they are:
  - **Types and constants:** `STacticalFlavors`, the city threat credit, the flavor type names, the attack shift limit, the slot count checks, and `NUM_TACTICAL_FLAVOR_SLOTS` in `CvDefines.h`.
  - **`CvTacticalPosition`:** the flavor weights and their helpers, plus how `initFromScratch` and `initFromParent` set them.
  - **Scoring:** the changes in `ScoreAttackDamage`, `ScoreCombatUnitTurnEnd` and `ScorePlotForCombatUnitMove`.
  - **Per-search setup:** the city threat map, `SetSearchCityFlavorTerms` and `SetSearchRiskThresholds`.
  - **Search entry:** the defaulted `flavors` parameter on `FindBestUnitAssignments`. Merge it with upstream's newer plot storage reservation (#13254).
- **`GetGeneralTacticalFlavors`.** Port it without the custom flavor branches.

### A3. Part 1: strategy rows, gated in the DLL

- **Why the DLL.**
  - The rows always load, and the DLL decides whether to read them.
  - A SQL condition would miss modmods that load later, and it cannot see a per-game checkbox.
- **What is gated.**
  - In `GetGeneralTacticalFlavors`, the strategy delta applies to the five slots only while the switch is on. The strategy delta is the active flavor minus the personality.
  - Only economic and military strategies feed the active flavor. The grand strategy does not.
- **With the switch off:**
  - RISK is 10 times the leader's FLAVOR_RISK. If the leader has none, it is 10 times OFFENSE with the grand strategy, exactly as in stock VP.
  - The other slots stay at 50.
  - RISK counts as unset.
- **The rows file.**
  - The rows from Part B go into a new sweep file in `(2) Vox Populi/Database Changes/AI/`, in the same style as `StrategyFlavorSweeps.sql`.
  - It loads after that file, and it is registered through the VP `.civ5proj`.

### A4. Part 2: the purpose table

- **The enum.** Define `SearchIntent` in `CvTacticalAI.h`, with the same constants and values as VD.
- **The table.** Port `TACTICAL_INTENT_FLAVOR_DEFAULTS` (14 rows of five signed values) and the check that it has one row per purpose.
- **Passing the purpose.** Pass the purpose through these functions:
  - `ExecuteAttackWithUnits`
  - `PositionUnitsAroundTarget`
  - `ExecuteDestroyEnemyUnits`
  - `FindAndExecuteBestUnitAssignments`
  - the search for ranged opportunities

  This covers the same 13 call sites as in VD.
- **The flavor functions.** Port `ApplyIntentFlavorDefaults`, `ApplyFlavorModifiers` and `ResolveSearchFlavors`. Use the helper instead of the VD option macro.

### A5. Civ, operation and zone modifiers

- **Civ.** The `CvMilitaryAI` modifier array, its accessors and its save entry, plus the recount after loading.
- **Lua.** `Player:SetTacticalFlavorModifiers` and `Player:GetTacticalFlavorModifiers` in `CvLuaPlayer`.
- **Operation.**
  - The `CvAIOperation` modifier array, its accessors, its reset and its save entry.
  - Drop VD's capture notification.
- **Current operation.**
  - `CvTacticalAI` keeps the current operation ID while it runs, without saving it.
  - A scoped guard in `PlotOperationalArmyMoves` sets the ID around each operation's turn and restores the previous value afterwards. Every tactical search an operation runs happens inside that call.
  - `ResolveSearchFlavors` reads the ID.
- **Zone.**
  - Port the zone modifier map in `CvTacticalAnalysisMap`. It is not saved and is cleared whenever the zones are rebuilt.
  - Port the zone lookups that skip the refresh, if upstream lacks them.
  - Open PR #13424 touches the same cache, so compare against it.
- **Saves.**
  - Add a tag to `CvGlobals::SaveVersionTags`.
  - Read the two new arrays only from saves at or above that tag, so older saves still load.
  - Follow how `CvGame` reads the save version.

### A6. Clean up, build and draft

- **Remove VD-only code.**
  - `// Vox Deorum:` markers, `MOD_IPC_CHANNEL` and the `VoxDeorumRL/` includes.
  - The capture wrappers around the search. Call `FindBestUnitAssignments` directly instead.
  - Rewrite comments in VP style.
- **Review the delta.**
  - Read the full diff against `upstream/master`.
  - Run `git diff --check`.
  - Look for untracked files.
  - Scan for leftover VD code by hand.
- **Build** the debug DLL with `build_vp_clang_sdk.py`, using the process-local PATH setup.
- **Draft** `temp/upstream-review/flavorful-tactical-search-pr.md`:
  - **Lead:** what players get when they tick the option, and why. Use the issue's results.
  - **Implementation:** described file by file and function by function.
  - **Modifiers:** civ modifiers ignore the switch, and operation and zone modifiers are experimental.
  - **Saves:** a short note on the save version tag.
  - **Issue link:** if the issue has been posted.
- **Other open PRs.** #13393, #13421, #13424 and #13366 touch the same code. Report the likely conflicts, and don't base this PR on them.

## Part B: derive and check the strategy rows

This work happens in `vox-deorum-rl`.

The tested mapping is linear on the 0 to 100 scale. The DLL works differently:

- It adds the strategy rows on the game scale, which is exponential.
- It then shifts 50 by that sum.

The rows must therefore be derived and measured on the game scale.

1. **Collect the existing rows.**
   - List VP's final rows for OFFENSE, DEFENSE, CITY_DEFENSE, RANGED and MILITARY_TRAINING.
   - Cover `AIMilitaryStrategy_Player_Flavors` and `AIEconomicStrategy_Player_Flavors`.
   - Use the values after CP, VP and the sweeps have all applied.
   - A Haiku subagent can do this.
2. **Add a game-scale mode to the flavor mapping** in `simulator/execution/rollout/`.
   - Each slot shifts 50 by a weighted sum of the recorded game-scale strategy deltas. RISK keeps its personality default.
   - Each row will be a weighted sum of that strategy's own rows, so the mode gives exactly the in-game value.
   - Add a harness test next to the existing flavor mapping test.
3. **Fit the weights.**
   - Start from the tested strategy-layer weights:

     | Slot | Starting weights |
     | --- | --- |
     | OCCUPATION | 0.9 OFFENSE, -0.8 DEFENSE, -0.2 CITY_DEFENSE |
     | ATTRITION | 0.4 DEFENSE, 0.3 RANGED, 0.2 CITY_DEFENSE, 0.1 MILITARY_TRAINING |
     | HOLD_CITY | CITY_DEFENSE |
     | HOLD_GROUND | DEFENSE, -0.8 OFFENSE |

   - Drop the grand strategy terms, which had a weight of 0.1. That layer never reaches the active flavor.
   - Fit game-scale weights so the slot distributions over the recorded starts match the tested mapping. Compare them with the histograms in the rollout report.
4. **Re-measure.**
   - Run a new config with the game-scale mode and the purpose table on.
   - Compare it with the native baseline and the tested variant on the same starts.
   - **To pass:** the 3-turn gain stays clearly positive and close to +0.22.
   - **If it falls apart:** revisit a personality fallback for HOLD_CITY and ATTRITION before opening the PR.
5. **Write the rows.** A small script in `simulator/scripts/` computes each strategy's rows from the fitted weights and rounds them.
6. **Hand adjustments.**

   | Strategy | Adjustment |
   | --- | --- |
   | EMPIRE_DEFENSE_CRITICAL | RISK down, HOLD_CITY up |
   | LOSING_WARS | RISK down, HOLD_GROUND up, OCCUPATION down |
   | GS_CONQUEST | OCCUPATION up a little |

   - Keep them small.
   - Existing recordings capture only a few strategy flags, such as AT_WAR, so the simulator cannot test these adjustments.
   - Instead, make one new VD recording with the switch on, and confirm the five slots stay in sensible ranges.

## Part C: keep VD training and simulation working

VD stays on the 5.2 line. Align it afterwards in a separate change on `vox-deorum-5.2`, keeping the `// Vox Deorum:` markers.

### VD DLL

- **Keep the option macro's name.**
  - Redefine `MOD_VOX_TACTICAL_INTENT_FLAVORS` to mean "the upstream CustomModOption or the checkbox".
  - Add the upstream CustomModOption.
  - Either retire the old VD option row or let it act as a third way to turn the feature on.
  - Because the name stays, nothing on the simulator side changes:
    - the extracted `ResolveSearchFlavors`
    - the simulator's stubs and its intent flavor setter
    - the recorded option field
    - the generated capture code
  - The simulator's stand-in for game options only knows one option. Extracted code must keep going through the macro.
- **Gate the strategy delta in `GetGeneralTacticalFlavors`.**
  - Gate it in both the normal branch and the custom flavor branch.
  - Insert the check after the function's opening brace and its first two statements, because a simulator text match starts there.
- **Keep every name the simulator extracts unchanged:**
  - `STacticalFlavors`
  - the purpose table and its row check
  - `ResolveSearchFlavors`, `ApplyFlavorModifiers`, `ApplyIntentFlavorDefaults` and `GetGeneralTacticalFlavors`
  - the `kSearchIntent` constants
  - `VoxRlCurrentOperationId`
  - the ranged opportunity block
- **Where `SearchIntent` comes from.**
  - VD keeps getting `SearchIntent` from the simulator's installed schema header.
  - If VD ever merges upstream, resolve that one conflict by keeping the include.
- **Bring in the CP files.**
  - Bring in the CP Flavors SQL, the game option row and its text, and the VP rows file. Without the game option row, every lookup queries the database.
  - Register them in VD's `.civ5proj` and `.modinfo`.

### VD mod

- In `civ5-mod/SQL/VoxDeorum_Options.sql`, change the five-row Flavors insert to `INSERT OR IGNORE`, so a duplicate insert can't fail the file.
- `FLAVOR_MOBILIZATION` gets a later ID. The simulator looks flavors up by name, so that is fine.
- Run `civ5-mod/update_md5.py`.

### RL repository

- **Code:** add the game-scale mapping mode and the config from Part B.
- **Rollout docs:** note in `docs/rollouts/flavor-matching.md` and `docs/rollouts/index.md` that:
  - The variant's `intent` switch only turns part 2 on or off for fresh searches. The focal player's part 1 comes from the recorded values.
  - Fresh searches for other players read personality only. This existing gap now matters for recordings made with the switch on.
- **Unchanged:** the learning flavor projection is independent and needs nothing.

### Documentation

Update these pages with the switch and the strategy rows:

- `docs/developers/civ5-dll/unit-ai/concepts.md`
- `docs/developers/civ5-dll/unit-ai/military-tactical-flavors.md`
- `mcp-server/docs/influence/flavors.md`

## Verification

**PR branch**

- The debug build succeeds.
- The diff has no leftover VD code.
- Every path with the switch off reduces to stock behavior:
  - neutral weights
  - RISK from OFFENSE
  - no strategy delta
  - no purpose rows
- An older save loads, which exercises the save version tag.
- If possible, run an in-game smoke test three ways: checkbox on, checkbox off, and the CustomModOption on. Report anything that was not run.

**Part B**

- The new harness test for the mapping mode passes.
- The rollout report for the rows config is compared with the native baseline and the tested variant.

**VD alignment**

- The VD DLL builds with `build-and-copy.bat`.
- In `vox-deorum-rl`, `simulator/scripts/build.sh` passes. It runs:
  - extraction
  - the harness, including the flavor weights, flavor modifiers, purpose metadata and campaign flavor tests
  - the CLI tests
  - the deploy check
- The capture and extraction Python tests pass.
- One existing recording replays unchanged against its stock baseline.

## Delegation

- **Haiku subagents:** collecting the strategy rows (B1), and the diff scans for leftover VD code.
- **OpenCode:** independent review of the PR changes.
- **Main agent:** the port, the switch, the scoring, and the game-scale mapping mode.
- Each handoff reports the models used.
