# Stage 4: Multi-installer release pipeline

> Part of the multi-line VP plan. Shared design lives in [README.md](README.md); requirements live in [specs.md](specs.md). Requires Stage 2, which adds the second real pin to Stage 3's line-aware DLL materialization.

## Objective

`release.yml` produces `VoxDeorum-X.Y.Z-vp5.2.exe` and `VoxDeorum-X.Y.Z-vp5.4.exe` from one version bump, commit, and tag. Each installer bundles its pinned VP source tree and DLL and shows the version read from that line's downloaded `version.txt`.

## Approach

Build both installers sequentially in one `windows-latest` job. The npm install, `build:all`, and prune steps run once. Each line then needs only a submodule checkout, DLL materialization, and ISCC compile.

Because the runner is temporary, checking out a commit inside `civ5-dll` changes the submodule working tree but not the gitlink recorded by the already-created release commit. The job does not restore the original checkout or arrange lines in a special order. Every native command still checks its exit code and stops the build on failure.

Per-line parameters reach Inno Setup through `/D` preprocessor defines. `AppId` stays shared, so installing one line replaces the other.

## Work items

1. **`scripts/installer.iss`**:
   - Wrap `MyAppVersion`, and new `VpLine` and `VoxPopuliVersion` values, in `#ifndef` blocks.
   - Name outputs `VoxDeorum-{#MyAppVersion}-vp{#VpLine}` when `VpLine` is present. Keep today's name for local builds without defines.
   - Append `(VP {#VoxPopuliVersion})` to `AppVerName`.
2. **`scripts/build-installer.cmd`**:
   - Accept `--line X.Y` and `--skip-npm`. The latter skips node download, npm install, `build:all`, and prune after the first line.
   - Run `download-dll.cmd --line %LINE%` so the selected cache is materialized into `scripts\release` and the top-level MCP metadata is refreshed.
   - Read `RELEASE_TAG` from `dll-release-info-%LINE%.txt`. Read `VoxPopuliVersion` from the selected `scripts\.dll-cache\version.txt` after materialization.
   - Require the release DLL, a matching `scripts\.dll-cache\release-tag.txt`, and a nonempty VP version before invoking `ISCC /DVpLine=%LINE% /DVoxPopuliVersion=%VP_VERSION% installer.iss`.
3. **`.github/workflows/release.yml`**:
   - Keep the existing version bump, commit, tag, and release skeleton. Drop the single `INSTALLER_NAME` output.
   - Read `LINES` from `vp-lines.txt`. For each line, read its committed pin, derive `vox-deorum-<line>`, fetch that branch, check out the pinned commit in `civ5-dll`, and run `build-installer.cmd --line <line>`. Pass `--skip-npm` after the first build.
   - Check `$LASTEXITCODE` after every native Git and cmd call. No checkout restoration or restoration-error path is needed.
   - Verify every expected installer and require `scripts\release\lua51_win32.dll` to exceed 1 KB so an unsmudged LFS pointer cannot ship.
   - Attach `scripts/dist/VoxDeorum-*.exe`. Generate a short table mapping each installer to its VP version and savegame line.
   - Make dry runs build and verify both installers while leaving commit, push, tag, and release steps gated.
4. **`README.md`**: name both installers and recommend the default line.
5. **`docs/versions/<version>.md`**: note both installers, the new VP 5.4 base, and that savegames do not transfer across VP lines.

## Reuse

- Stage 3's cache materialization and top-level MCP provenance metadata, completed for both pins by Stage 2.
- The existing release workflow's versioning and publication steps.
- The existing `{#VoxPopuliVersion}` uses in `installer.iss`.

## Verify

- Local builds for `--line 5.2` and `--line 5.4` produce distinct installer names and show the selected pin and VP version in their logs.
- A dry run checks out both pinned commits, materializes the matching DLL before each ISCC call, and verifies both installers.
- The first real multi-line release publishes both installers. Each installs and launches with the expected VP base, and installing one after the other replaces the earlier installation.

## Done when

One release from `main` publishes both verified installers with their true VP versions, and local no-define ISCC builds still work.
