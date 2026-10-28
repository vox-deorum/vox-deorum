# Exploration copying and set reuse: results

Items 7 and 10 are implemented together. **The benchmark demonstrated no whole-rollout speedup.** Median native runtime was 0.4% to 1.8% slower across the three tested starts. All outputs and work counts matched. The upstream change removes repeated copying, but these results do not support a general turn-time improvement claim.

## Measured performance

Times below are medians of eight runs per build. Native runtime includes reconstruction and rollout execution; Python startup and recording discovery are outside this figure.

| Recording, player, turn | Before | After | Change |
| --- | ---: | ---: | ---: |
| Early: `085b577b`, player 1, turn 35 | 0.546 s | 0.548 s | 0.4% slower |
| Late: `020493d2`, player 4, turn 339 | 9.574 s | 9.705 s | 1.4% slower |
| Late: `020493d2`, player 2, turn 338 | 8.111 s | 8.257 s | 1.8% slower |

The homeland phase is the closest recorded measure of exploration selection. It includes other homeland work too:

| Start | Homeland before | Homeland after | Change |
| --- | ---: | ---: | ---: |
| Early, player 1 | 75.10 ms | 69.90 ms | 6.9% faster |
| Late, player 4 | 678.75 ms | 682.92 ms | 0.6% slower |
| Late, player 2 | 773.17 ms | 775.64 ms | 0.3% slower |

Run-to-run ranges overlapped for every start. Each late start was faster in four of its eight paired comparisons. The small overall slowdowns should remain visible in the result, but these short runs do not establish a repeatable regression. The early homeland saving was about 5.2 ms and did not translate into a lower whole-rollout median. The two items were measured together, so no separate percentage can be assigned to either one.

## How this was measured

The comparison used two fixed recordings and three starts, a three-turn horizon, the frozen `garrison-post2/template.json` settings, the `intent-vp` variant, grading and demonstration capture, and one runtime thread. Two batches of 24 runs gave eight repeats per build per start, 48 successful runs in total. Library order reversed every repeat, and the second batch began with the opposite library.

Both libraries used the same Release configuration: llvm-mingw Clang 23.1, ThinLTO, `-march=native`, and test hooks enabled, on an AMD Ryzen 9 9900X. Builds and tests finished before timing began. The baseline DLL was saved before implementation from native commit `ba273e7ad`; the final DLL uses reviewed native commit `bea7a034c` and simulator commit `1b7ca31f`. The baseline included the existing staged simulator work that was subsequently committed separately.

The saved libraries are `logs/runtime-libraries/exploration-7-10-before.dll` and `exploration-7-10-reviewed.dll` in `vox-deorum-rl`. The separate upstream validation handoff records their hashes.

Raw plans, frozen templates, library copies, outputs, and logs are under `vox-deorum-rl/logs/start-timings/exploration-7-10-reviewed/` and `exploration-7-10-confirmation/`. [The combined JSON summary](../../../../vox-deorum-rl/logs/start-timings/exploration-7-10-summary.json) retains individual times, ranges, medians, and work counts. `simulator/scripts/time_starts.py report` can reproduce each batch's report. These measurement artifacts are local and gitignored.

## Correctness and build checks

- All 48 runs produced byte-identical token files for their start. JSON output rows and search statistics matched after removing timing fields, including repeats within each build.
- All 609 native harness tests passed. Unit-access checks cover domain eligibility, empty sets, overlapping domain values, selector overload agreement, and refresh after revelation.
- All 56 extraction tests passed. The maintained selectors regenerate both homeland overloads, and explorer selection calls the snapshot overload.
- Release DLL builds passed for both the reviewed VD source and the upstream port using `build_vp_clang_sdk.py --config release`. Whitespace checks passed. OpenCode compared the reviewed change with the upstream port; its model was not reported.

## What remains unmeasured

No allocation counter or isolated function benchmark was added. Source inspection confirms that range-vector copies and repeated merged-map constructions are removed; their individual elapsed-time and allocation savings were not measured.

The simulator rebuilds exploration scores through `InitiateExplorePlot`. It does not exercise the DLL's incremental `UpdateNearbyExplorePlots` reveal path. Live-game checks of incremental revelation, wrapped map edges, blocked line of sight, and upgrade-home mission fallthrough were not run. No DLL was deployed to the game.

## Upstream handoff

The combined change is prepared on `pr/exploration-reuse`, based on upstream/master `2bc6d34a16c5d4fb8cfb824170b9940cff88d7be`. The branch is checked out in `temp/upstream-review/exploration-reuse-review/civ5-dll/`. Its five source files contain 57 insertions and 19 deletions, left unstaged and uncommitted. The development checkout and existing workflow state are preserved.

The draft is `temp/upstream-review/exploration-reuse-pr.md`; the separate handoff is `temp/upstream-review/exploration-reuse-validation.md`. Refreshed upstream code and all 63 open PR patches were checked on October 28, with no equivalent change found. The PR has not been pushed or opened.
