# Stage 3: VP line records and install scripts

> Part of the multi-line VP plan. This stage runs after the real 5.2 DLL release from Stage 1 and before Stage 2 adds 5.4. The shared design lives in [README.md](README.md), and the requirements live in [specs.md](specs.md).

## Objective

Record the initial supported line in `scripts/vp-lines.txt`, pin its real DLL release, and make the install scripts select and cache that release through the generic line-aware path. The committed per-line pin files are the sole release authority. The default submodule gitlink is kept manually equal to the default line's `COMMIT`. Stage 2 adds 5.4 to this completed mechanism.

## Records

Add `scripts/vp-lines.txt` with the default and only supported line:

```text
DEFAULT_LINE=5.2
LINES=5.2
```

Add `scripts/dll-release-info-5.2.txt` from the Stage 1 release. It contains exactly:

```text
RELEASE_TAG=build-<vp-version>-<timestamp>-<sha7>
COMMIT=<full-fork-commit>
```

In the same change, move the outer `civ5-dll` gitlink to the 5.2 pin's `COMMIT`.

The repository is `CIVITAS-John/vox-populi` and the fork branch is derived as `vox-deorum-<line>`. Do not add either value to the pin. Do not add a legacy pin, an environment-variable override, or a transitional fallback. Do not add a branch entry to `.gitmodules`.

## Script changes

1. **`scripts/download-dll.cmd`** parses `--line X.Y` and `--debug`, resolving an omitted line from `DEFAULT_LINE`. It validates the line format, membership in `LINES`, and the presence of its pin before constructing paths. It reads only `RELEASE_TAG` and `COMMIT`, derives the repository and branch, and downloads the selected DLL, optional PDB, and required `version.txt` asset.
2. The script caches complete artifacts under `.dll-cache\<line>\<mode>\`. A cache hit still materializes the selected line into `scripts\release` or `scripts\debug`, removes a stale PDB when the selected release has none, and refreshes the top-level `.dll-cache\version.txt` and `release-tag.txt` files used by the MCP runtime. A downloaded release must have a nonempty DLL and `version.txt` before replacing its cache entry. `VP_VERSION` always comes from that downloaded `version.txt`.
3. **`scripts/install.cmd`** accepts the same flags, downloads the selected line, and warns when the source `civ5-dll` checkout does not match the selected pin. It does not change the developer's checkout. Its repair command uses the derived `vox-deorum-<line>` branch.
4. **`scripts/bootstrap.cmd`** does not consume an argument beginning with `--` as the release tag and forwards the line flags to `install.cmd`.
5. **`scripts/manual-update.cmd`** forwards all arguments to `install.cmd`.
6. **`.github/workflows/update-prebuilt-binaries.yml`** and `scripts/dll-release-info.txt` are removed. There is no scheduled pin polling or branch-head reconciliation. Updating a line requires committing its new pin and, when the default changes, manually moving the default gitlink.

## Release integration

This stage hands Stage 2 the generic cache materialization and the initial 5.2 pin. Stage 2 adds the 5.4 pin and completed two-line behavior. Stage 4 owns how the release workflow consumes both pins.

## Verification

Run these checks with the real 5.2 artifact and its committed pin:

1. Run `scripts\download-dll.cmd --line 5.2` twice. Confirm the second run is a cache hit that rematerializes the selected DLL and optional PDB into the shared output, and refreshes the top-level MCP metadata.
2. Confirm stale PDB cleanup: a selected release without a PDB removes any stale shared PDB during materialization.
3. Confirm no-argument invocation selects `DEFAULT_LINE`, invalid formats and the unlisted `5.4` line fail, and a missing 5.2 pin fails before any download.
4. Run `scripts\install.cmd --line 5.2` against a checkout that does not match the 5.2 pin. Confirm the warning names the derived repair command and does not change the checkout. Stage 2 verifies matching and cross-line checkouts.
5. Run `bootstrap.cmd --line 5.2` from a clean source directory and confirm `--line` is not treated as a release tag. Confirm `manual-update.cmd` forwards the same arguments to `install.cmd`.
6. Confirm the committed `civ5-dll` gitlink equals the 5.2 pin's `COMMIT`.

## Done when

The generic line-aware path supports the real 5.2 release, its cache hit rematerializes the shared output and runtime metadata, invalid or unpinned selections fail before download, and the gitlink equals the 5.2 pin. Stage 2 can add the real 5.4 line without changing the generic script design.
