# Flavorful tactical search: finish in VD, then send upstream

This plan finishes flavorful tactical search on VD's `vox-deorum-5.2` branch first and tests it there. Once it is done, the finished code goes to upstream Vox Populi (`LoneGazebo/Community-Patch-DLL`) as one pull request. VD's training and simulation features must keep working throughout.

## Background

The offline simulator in `vox-deorum-rl` showed that flavorful search beats a ten times larger search budget. The write-up is `vox-deorum-rl/plans/flavorful-search-issue.md`.

The feature has two parts, both behind one switch that defaults off:

1. **Strategy rows.** Military and economic strategies carry values for the five tactical flavors: RISK, OCCUPATION, ATTRITION, HOLD_CITY and HOLD_GROUND.
2. **Purpose table.** Each tactical search adds a small fixed modifier for its purpose, such as a city assault, a hedgehog or a reinforcement move. This is the tested table, `TACTICAL_INTENT_FLAVOR_DEFAULTS`.

VD already has the five-flavor machinery and the purpose table. Today the purpose table sits behind `MOD_VOX_TACTICAL_INTENT_FLAVORS`.

What VD still lacks:

- the shared switch with an Advanced Setup checkbox
- strategy rows, and the switch check on them
- a way to measure rows the way the game actually applies them

Upstream has none of it. Issue #13342 was a proposal, and it is now closed.

The RL simulator pulls VD's tactical code out of VD's source by exact symbol name, and in two places by exact text. Every VD change below has to respect that.

## Decisions

| Topic | Decision |
| --- | --- |
| Order | Finish and test everything on the VD branch first. Port to upstream only after that. |
| Switch | A CustomModOption that defaults to 0, **plus** an Advanced Setup checkbox. Either one turns the feature on. |
| Part 2 form | The purpose table as tested: the `SearchIntent` enum plus `TACTICAL_INTENT_FLAVOR_DEFAULTS`, with the same names and values. |
| Modifiers | The upstream PR includes the civ, operation and zone modifiers and the Lua API. Only Lua sets the civ modifiers. The operation and zone modifiers are C++ hooks that nothing sets yet, so they are labelled experimental. |
| Part 1 data | Strategy rows only. Measure them before relying on them, and add a personality fallback only if the gain disappears. |

## Stage 1: the switch in VD

### Option rows

- **CustomModOption `FLAVORFUL_TACTICAL_SEARCH`.**
  - Declare it in `CustomMods.h` and `CustomMods.cpp`.
  - Add a row with value 0 and a comment to `(1) Community Patch/Database Changes/NewCustomModOptions.xml`.
  - Follow the `ROUTE_PLANNER` pattern, and use the same name upstream will get.
- **Advanced Setup checkbox `GAMEOPTION_FLAVORFUL_TACTICAL_SEARCH`.**
  - Add a string define in `CvGameCoreDLLUtil/include/CvEnums.h`, next to the endgame aggression option.
  - Add a row in `(1) Community Patch/Database Changes/CoreNewGameOptions.xml`.
  - Add description and help text in the CP game option text file.
  - String options need no enum value and add no save data.
  - The row must exist. Without it, every lookup queries the database.

### Keep the macro name

Redefine `MOD_VOX_TACTICAL_INTENT_FLAVORS` to mean "the CustomModOption or the checkbox".

- Retire the old `VOX_TACTICAL_INTENT_FLAVORS` row, or let it act as a third way to turn the feature on.
- Because the name stays, these simulator pieces keep working unchanged:
  - the extracted `ResolveSearchFlavors`
  - the simulator's stubs and its intent flavor setter
  - the recorded option field
  - the generated capture code
- The simulator's stand-in for game options only knows one option. Extracted code must keep going through the macro and never call the game option lookup directly.
- The game option lookup is a short linear string scan, which is fine once per search. Keep it out of scoring loops.

### Flavors in the database

- Move the five `Flavors` rows into a new CP SQL file in `(1) Community Patch/Database Changes/AI/`. That is where upstream will need them.
- Register it in the CP `.civ5proj` and `.modinfo`.
- In `civ5-mod/SQL/VoxDeorum_Options.sql`, change the five-row Flavors insert to `INSERT OR IGNORE`, so a duplicate insert can't fail the file. Then run `civ5-mod/update_md5.py`.
- `FLAVOR_MOBILIZATION` gets a later ID. The simulator looks flavors up by name, so that is fine.

## Stage 2: the strategy delta behind the switch

In `GetGeneralTacticalFlavors`, the strategy delta applies to the five slots only while the switch is on. The strategy delta is the active flavor minus the base personality.

- **Branches.** Apply the check in both the normal branch and the custom flavor branch. In the custom flavor branch, the custom value stays the base either way.
- **Placement.** Insert the check after the function's opening brace and its first two statements. A simulator text match starts there.
- **With the switch off** (and no custom flavors):
  - RISK is 10 times the leader's FLAVOR_RISK. If the leader has none, it is 10 times OFFENSE with the grand strategy, exactly as in stock VP.
  - The other slots stay at 50.
  - RISK counts as unset.
- **Civ, operation and zone modifiers** keep ignoring the switch. They are explicit requests.

Only economic and military strategies feed the active flavor. The grand strategy does not.

## Stage 3: derive and measure the strategy rows

This stage works in `vox-deorum-rl`, and its rows land in VD.

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
   - **If it falls apart:** add a personality fallback for HOLD_CITY and ATTRITION in Stage 2 before going further.
5. **Write the rows.**
   - A small script in `simulator/scripts/` computes each strategy's rows from the fitted weights and rounds them.
   - It writes a new sweep file in VD's `(2) Vox Populi/Database Changes/AI/`, in the same style as `StrategyFlavorSweeps.sql`. That file loads after the existing sweep.
6. **Hand adjustments.**

   | Strategy | Adjustment |
   | --- | --- |
   | EMPIRE_DEFENSE_CRITICAL | RISK down, HOLD_CITY up |
   | LOSING_WARS | RISK down, HOLD_GROUND up, OCCUPATION down |
   | GS_CONQUEST | OCCUPATION up a little |

   - Keep them small.
   - Existing recordings capture only a few strategy flags, such as AT_WAR, so the simulator cannot test these adjustments. Stage 4 checks them with a new recording.

### Rollout documentation

Note in `docs/rollouts/flavor-matching.md` and `docs/rollouts/index.md` that:

- The variant's `intent` switch only turns part 2 on or off for fresh searches. The focal player's part 1 comes from the recorded values.
- Fresh searches for other players read personality only. This existing gap now matters for recordings made with the switch on.

The learning flavor projection is independent and needs nothing.

## Stage 4: test everything in VD

- **Builds.**
  - The VD DLL builds with `build-and-copy.bat`.
  - In `vox-deorum-rl`, `simulator/scripts/build.sh` passes. It runs:
    - extraction
    - the harness, including the flavor weights, flavor modifiers, purpose metadata and campaign flavor tests
    - the CLI tests
    - the deploy check
  - The capture and extraction Python tests pass.
- **Switch off equals stock.**
  - One existing recording replays unchanged against its stock baseline.
  - Review that every path with the switch off reduces to stock behavior: neutral weights, RISK from OFFENSE, no strategy delta, no purpose rows.
- **Switch on in a real game.**
  - Record at least one new VD game with the checkbox on.
  - Confirm the five slots stay in sensible ranges, including under the hand-adjusted strategies.
  - Confirm the rows reach the recorded flavors.
- **Each way to turn it on.** Run in-game smoke tests three ways: checkbox on, checkbox off, and the CustomModOption on.
- **Rollouts on the new recording.** Run the native baseline and the flavorful variant to confirm the gain holds with real rows.
- **Docs.** Update these pages with the switch and the strategy rows:
  - `docs/developers/civ5-dll/unit-ai/concepts.md`
  - `docs/developers/civ5-dll/unit-ai/military-tactical-flavors.md`
  - `mcp-server/docs/influence/flavors.md`

Stage 5 starts only once all of these pass.

## Stage 5: the upstream pull request

Port the finished VD code to a branch `pr/flavorful-tactical-search` in `civ5-dll`. Follow the upstream-pr skill and `docs/developers/civ5-dll/upstream-contributions.md`.

- **Branch setup.**
  - Run the `vp-diff` export first.
  - Then run `vp-pr new flavorful-tactical-search` from `upstream/master`.
  - Remove the automatic upstream tracking and set `pushRemote` to `origin`.
- **Porting.** Port by hand from VD. Leave the edits unstaged.

### What the PR carries

- **Switch and data.**
  - The CustomModOption, the checkbox and their text.
  - The CP Flavors file and the VP rows file.
  - Register new files in each `.civ5proj`, then regenerate the `.modinfo` files and checksums with `scripts/generate_modinfo.py`.
  - Upstream needs a small helper, `TacticalAIHelpers::IsFlavorfulSearchEnabled()`, in place of VD's macro.
- **`CvFlavorManager`.**
  - The game-scale table and its helpers: `FlavorToGameScale`, `FlavorFromGameScale` and `ShiftFlavor`.
  - A `GetActiveFlavor` accessor.
  - The base personality comes from upstream's existing `GetPersonalityIndividualFlavor`. The diplomacy variant is rescaled, so don't use it.
  - No custom flavor code.
- **`CvTacticalAI`.**
  - **Types and constants:** `STacticalFlavors`, the city threat credit, the flavor type names, the attack shift limit, the slot count checks, and `NUM_TACTICAL_FLAVOR_SLOTS` in `CvDefines.h`.
  - **`CvTacticalPosition`:** the flavor weights and their helpers.
  - **Scoring:** the changes in `ScoreAttackDamage`, `ScoreCombatUnitTurnEnd` and `ScorePlotForCombatUnitMove`.
  - **Per-search setup:** the city threat map, `SetSearchCityFlavorTerms` and `SetSearchRiskThresholds`.
  - **Search entry:** the defaulted `flavors` parameter on `FindBestUnitAssignments`. Merge it with upstream's newer plot storage reservation (#13254).
- **Purpose table.**
  - `SearchIntent` defined in `CvTacticalAI.h`, with the same constants and values.
  - `TACTICAL_INTENT_FLAVOR_DEFAULTS` and its row check.
  - The purpose passed through the same 13 call sites.
  - `ApplyIntentFlavorDefaults`, `ApplyFlavorModifiers`, `ResolveSearchFlavors` and `GetGeneralTacticalFlavors`, without the custom flavor branches.
- **Civ, operation and zone modifiers.**
  - **Civ:** the `CvMilitaryAI` array, its save entry, and the recount after loading.
  - **Lua:** `Player:SetTacticalFlavorModifiers` and `Player:GetTacticalFlavorModifiers`.
  - **Operation:** the `CvAIOperation` array and its save entry.
  - **Zone:** the zone map in `CvTacticalAnalysisMap`, and the zone lookups that skip the refresh if upstream lacks them. Compare with open PR #13424.
  - **Current operation:** upstream has no VD capture, so `CvTacticalAI` keeps the current operation ID while it runs, without saving it. A scoped guard in `PlotOperationalArmyMoves` sets the ID around each operation's turn.
  - **Saves:** add a tag to `CvGlobals::SaveVersionTags`, and read the two new arrays only from saves at or above it, so older saves still load.

### Clean up, build and draft

- **Remove VD-only code.**
  - `// Vox Deorum:` markers, `MOD_IPC_CHANNEL` and the `VoxDeorumRL/` includes.
  - The capture wrappers around the search. Call `FindBestUnitAssignments` directly instead.
  - Rewrite comments in VP style.
- **Review the delta.**
  - Read the full diff against `upstream/master`.
  - Run `git diff --check`.
  - Look for untracked files.
  - Scan for leftover VD code by hand.
  - A Haiku subagent can do the scans. OpenCode does an independent review.
- **Build** the debug DLL with `build_vp_clang_sdk.py`, using the process-local PATH setup.
- **Smoke test.** If possible, run one in-game test with the checkbox on and off, and load an older save to exercise the save version tag. Report anything that was not run.
- **Draft** `temp/upstream-review/flavorful-tactical-search-pr.md`:
  - **Lead:** what players get when they tick the option, and why. Use the issue's results and the Stage 4 re-measure.
  - **Implementation:** described file by file and function by function.
  - **Modifiers:** civ modifiers ignore the switch, and operation and zone modifiers are experimental.
  - **Saves:** a short note on the save version tag.
  - **Issue link:** if the issue has been posted.
- **Other open PRs.** #13393, #13421, #13424 and #13366 touch the same code. Report the likely conflicts, and don't base this PR on them.

## Delegation

- **Haiku subagents:** collecting the strategy rows, and the diff scans for leftover VD code.
- **OpenCode:** independent review of the VD change and the PR changes.
- **Main agent:** the switch, the strategy delta check, the game-scale mapping mode, and the port.
- Each handoff reports the models used.
