# Stage 6: Merge playbook and documentation

> Part of the multi-line VP plan. Shared design lives in [README.md](README.md); requirements live in [specs.md](specs.md). Requires completed Stages 1, 3, 2, 4, and 5 so the documentation describes the implemented process.

## Objective

Developers can merge an upstream VP release, maintain parity, and adopt, change, or retire a supported line from one concise playbook. Player and release documentation explains the two installers and their savegame boundary.

## Approach

Add one canonical playbook beside the existing `civ5-dll` developer docs, then update the pages that describe the old single-line release. The playbook records the process proven in Stages 1, 3, 2, 4, and 5 and keeps future lifecycle changes explicit.

## Work items

1. **Add `docs/developers/civ5-dll/upstream-merges.md`**:
   1. **Model overview**: line branches, versioned DLL tags, `vp-lines.txt`, committed per-line pins, derived `vox-deorum-<line>` branch names, and the rule that the default gitlink manually matches its pin.
   2. **Merge an upstream release**:
      - Configure the `upstream` remote idempotently, fetch origin and upstream tags, and unshallow the clone when needed.
      - Work on a scratch branch and merge the selected `Release-X.Y.Z` tag. Never rebase a published line branch.
      - For modified upstream files, take upstream and reapply the `Vox Deorum:`-marked changes. Stop and investigate if upstream collides with a purely new Vox Deorum file.
      - Recheck the hot spots listed in [02-migrate-to-5.4.md](02-migrate-to-5.4.md) and confirm `bTreatAsHumanToHuman` still passes through every `CvDeal` overload. The playbook spells out the full list.
      - Compare marker counts, build locally, launch the game, verify the ConnectionService handshake, and exercise one diplomacy interaction.
      - Push the line branch and wait for its versioned DLL release. Update that line's committed pin manually. When it is the default line, move the outer gitlink to the same commit.
   3. **Maintain parity**: land changes on the default line, use `git cherry-pick -x` for the other lines, and audit unpaired commits plus marker counts before release.
   4. **Adopt a line**: create and merge its branch, publish the first DLL release, add it to `LINES`, commit its pin, run the release dry run, and update player docs.
   5. **Change the default**: edit `DEFAULT_LINE`, move the gitlink to that line's committed pin, and update player-facing recommendations.
   6. **Retire a line**: remove it from `LINES`, delete its pin, freeze its fork branch, and record the last outer release that shipped it.
2. **Update `docs/developers/releasing.md`** with the two-installer build, committed pins, per-line verification, dry-run guidance, and a playbook link.
3. **Update `docs/developers/civ5-dll/overview.md` and `building.md`** with the branch model, tag scheme, and playbook link.
4. **Update `AGENTS.md`** with the line-branch model and the marker plus `cherry-pick -x` parity rule.
5. **Update player docs** (`docs/players/getting-started.md`, `configuration.md`, and `troubleshooting.md`) with the recommended installer, the alternate VP line, replacement behavior, cross-line savegame incompatibility, and `--line` for source installs.

## Reuse

- [docs/plans/interactive-diplomacy/09-additivity-review.md](../interactive-diplomacy/09-additivity-review.md) for the `bTreatAsHumanToHuman` additivity analysis.
- The existing marker convention in `AGENTS.md`.
- The existing structure of `docs/developers/releasing.md`.

## Verify

- A developer unfamiliar with the migration can identify the correct branch and pin, merge a later 5.4 release, carry a fix to the other line, and change the default from the playbook alone.
- Player documentation matches the installer names and wording on the real multi-line release.
- All changed documentation links resolve.

## Done when

The playbook describes the implemented process without relying on workflow-maintained pins or automated trial merges, and player documentation clearly distinguishes the two VP lines.
