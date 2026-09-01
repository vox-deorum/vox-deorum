# Stage 2: Migrate the fork to VP 5.4.x

> Part of the multi-line VP plan. Shared decisions are in [README.md](README.md); requirements are in [specs.md](specs.md). Requires Stages 1 and 3.

## Objective

Create `vox-deorum-5.4` from `vox-deorum-5.2`, merge the latest upstream `Release-5.4.x`, preserve the Vox Deorum delta, and publish a real `build-5.4.x-...` artifact. Then add its committed pin to the generic Stage 3 records, append 5.4 to `LINES`, and verify two-line selection before Stage 4 builds both installers.

## Approach

This is the risky technical work. Use the existing markers to retain fork changes after taking upstream conflict resolutions, then explicitly inspect the known diplomacy and deal hot spots. The default remains 5.2 during this migration, so new fork changes continue to land there first and are cherry-picked to 5.4. The 5.2-only records and scripts from Stage 3 remain the foundation for adding the second line.

Merge the latest 5.4.x tag available at execution time. A single marker-guided merge is easier to review than a chain of intermediate release merges.

## Work items

1. Fetch `origin` and upstream tags in a full clone. Record the current marker counts and identify the latest `Release-5.4.x` tag.

2. Create `vox-deorum-5.4` from `origin/vox-deorum-5.2`.

3. Merge the selected upstream release. For modified upstream files, take upstream and reapply the `Vox Deorum:` marked hunks. Keep the fork's build workflow unless upstream changed its build inputs.

4. Review the hot spots: `CvLuaPlayer.cpp`, `TradeLogic.lua`, `CvFlavorManager.cpp`, `CvLuaDeal.cpp`, `CvGame.cpp`, `CvDealClasses.cpp`, and `CvDiplomacyAI.cpp`. Verify `bTreatAsHumanToHuman` still passes through every relevant `CvDeal` API overload.

5. Compare marker counts, run the local Release build, and smoke-test a fresh 5.4 game. Confirm the ConnectionService handshake, one agent decision turn, and a diplomacy interaction. Record that 5.2 savegames are incompatible with this line.

6. Cherry-pick any 5.2 changes made during the migration to 5.4 with `-x`, then audit unpaired commits and marker counts.

7. Push the final `vox-deorum-5.4` commit. Confirm fork CI publishes a `build-5.4.x-...` release from that commit with the usual DLL, PDB, and `version.txt` assets.

8. In the outer repository, add `scripts/dll-release-info-5.4.txt` from the published 5.4 release and append `5.4` to `LINES` in `scripts/vp-lines.txt`. Keep `DEFAULT_LINE=5.2` and the `civ5-dll` gitlink equal to the 5.2 pin.

9. Verify the completed two-line behavior: run `scripts\download-dll.cmd --line 5.2`, then `--line 5.4`, then `--line 5.2` again. Confirm isolated per-line, per-mode caches and that each materialization refreshes the shared output and top-level runtime metadata.

10. Run `scripts\install.cmd --line 5.2` and `--line 5.4` against their matching source checkouts. Confirm matching checkouts produce no warning. Run each command against the other line's checkout and confirm the mismatch warning names the derived repair command without changing the checkout.

## Verify

- Fork CI is green for `vox-deorum-5.4` and the versioned release contains the selected 5.4.x value in `version.txt`.
- Marker-count differences are explained, the Release build succeeds, and the fresh-game smoke test succeeds.
- `scripts/dll-release-info-5.4.txt` pins the published 5.4 artifact, `LINES` contains `5.2 5.4`, and `DEFAULT_LINE` remains 5.2.
- Switching from 5.2 to 5.4 and back materializes the matching artifact and runtime metadata. Matching and mismatching checkout tests produce the expected install-script behavior without changing a checkout.

## Done when

Both real fork artifacts exist, both committed pins are present, and the Stage 3 scripts support 5.2 and 5.4. Stage 4 can build two installers without fabricated lines or scratch artifacts.
