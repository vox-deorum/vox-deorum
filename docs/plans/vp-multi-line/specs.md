# Multi-Line Vox Populi Support: Specifications

Vox Deorum currently ships on a single Vox Populi base, 5.2.7. This plan keeps that line available for existing savegames while adding the current 5.4.x line. Each release ships one installer for each supported line from the same `main` commit.

This document defines the target behavior. The staged implementation plan is in [README.md](README.md).

## What we want to achieve

### 1. Per-line fork branches with full feature parity

- The `CIVITAS-John/vox-populi` fork carries one long-lived branch per supported line: `vox-deorum-5.2` and `vox-deorum-5.4`.
- Every Vox Deorum DLL, Lua, and XML change ships on each supported line. Changes land on the default line first and are cherry-picked with `git cherry-pick -x` to the other line. The existing `// Vox Deorum:` and `-- Vox Deorum:` markers remain the audit mechanism.
- The historical `vox-deorum` branch is frozen, not deleted. The outer repository does not use it after the 5.2 line branch exists.

### 2. Explicit line records and selected artifacts

- The outer repository remains on one `main` branch. `scripts/vp-lines.txt` records the supported lines and the default.
- Each supported line has a committed `scripts/dll-release-info-<line>.txt` pin. Its `COMMIT` and `RELEASE_TAG` name the exact fork artifact that line ships. Updating a line is an explicit change to that pin.
- The submodule gitlink matches the default line's pin. Changing the default line updates both deliberately.
- The fork branch is derived as `vox-deorum-<line>`. The fork repository is fixed, so neither value belongs in every pin file.
- Install scripts use `--line X.Y` when supplied and otherwise use `DEFAULT_LINE`. A selected line must be listed and pinned. There is no environment override or fallback to the old single-line record.

### 3. One release, one installer per line

- A Vox Deorum release has one version bump, commit, tag, and GitHub release. It attaches `VoxDeorum-X.Y.Z-vp5.2.exe` and `VoxDeorum-X.Y.Z-vp5.4.exe`.
- Per-line caches hold each line's DLL, optional PDB, release tag, and version metadata. Selecting a line materializes its artifacts into the shared installer output and refreshes the top-level metadata read by the current MCP runtime.
- The installer reads the true VP version from the selected release's `version.txt` asset. It must not use the stale hardcoded version.
- Installers share an `AppId`, so installing one line replaces the other. Player documentation states which installer to choose and that savegames are not compatible across VP lines.

### 4. Automated upstream awareness

- A scheduled workflow on the fork's default branch reports each supported line's upstream base and newer `Release-*` tags in one tracking issue. It links to the merge playbook.
- The workflow does not trial-merge, build, choose a candidate, or resolve conflicts. Merging remains a deliberate human task.

### 5. A documented lifecycle

- The playbook covers merging an upstream release, preserving marker-guided changes, parity cherry-picks, adopting a line, changing the default line, and retiring a line.

## Constraints

- Every stage leaves the repository releasable.
- Stage 3 establishes the generic records, cache, and install behavior with the real 5.2 artifact only. Stage 2 depends on that work and adds the real 5.4 branch, artifact, pin, and second supported line.
- Records remain flat `KEY=VALUE` files because the cmd scripts parse them directly.
- No new credentials are introduced. Fork reads use public GitHub and Git access.
- The top-level `.dll-cache\version.txt` and `release-tag.txt` remain current-runtime metadata for `mcp-server/src/utils/vp-version.ts`. They are refreshed from the selected per-line cache.

## Out of scope

- Side-by-side installation of two lines on one machine.
- Automated conflict resolution, trial merges, or upstream build testing.
- Support for old single-line installations or transitional checkouts. Reinstalling supplies the current scripts and records.
- Supporting additional VP lines beyond 5.2 and 5.4 in this effort.

## Success criteria

- One release from `main` publishes working 5.2 and 5.4 installers with their true VP versions.
- `scripts\install.cmd` defaults to the configured line and accepts `--line 5.4`; both lines use isolated caches and rematerialize the selected artifacts.
- The tracking issue shows each line's upstream base and newer releases.
- The playbook is sufficient to repeat an upstream merge, parity change, default flip, or line retirement without undocumented process.
