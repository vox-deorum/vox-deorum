# Releasing

A Vox Deorum release is a single Windows installer that bundles everything a player needs: the three compiled services, a portable Node.js runtime, the pre-built game DLL, and the mod. Installing is a wizard, not a build.

Releases are made by a GitHub Actions workflow, not by hand. This page explains what that workflow does, where the version lives, how release notes are written, and how to build an installer locally when you need one. For the short version, jump to [Checklist for a release](#checklist-for-a-release).

## The release workflow

`.github/workflows/release.yml` (named **Release Version**) is the canonical path. It only runs on manual dispatch, usually through `npm run release` (see [Release notes](#release-notes)), and it takes three inputs:

| Input | Meaning |
| --- | --- |
| `version_type` | `patch`, `minor`, `major`, or `none`. Chooses how `version.json` is bumped. |
| `dry_run` | When true, the job builds and verifies the installer but makes no commit, tag, or release. |
| `release_notes` | Optional Markdown used as the release message. When empty, the last commit message is used instead. |

The job runs on `windows-latest` and checks out the repository with submodules and Git LFS. From there it:

1. **Bumps the version** in `version.json`, then rewrites the same number into `release.txt`, the `MyAppVersion` define in `scripts/installer.iss`, the version line in `README.md`, and the default tag in `scripts/bootstrap.cmd`.
2. **Commits those five files** locally as `Release v<version>`, without pushing yet.
3. **Installs Inno Setup 6** and runs `scripts/packaging/build-installer.cmd`, then verifies that `scripts/dist/VoxDeorum-<version>.exe` exists. A missing installer fails the run before anything is published.
4. **Pushes the commit to `main`**, creates an annotated tag `v<version>`, and pushes it.
5. **Publishes the GitHub release** with the installer attached.

Because step 4 pushes straight to `main`, run the workflow from a `main` that is already in the state you want to ship.

### What ends up in the release body

The workflow picks one release message and uses it for both the tag annotation and the GitHub release body. A fixed template wraps it, linking the CivFanatics forum thread, naming the installer file, and linking the commit history. A dry run prints the chosen message in its summary.

The message is the `release_notes` input when one is given. Otherwise the workflow falls back to the last non-merge commit already on `main` when you dispatch the run, read before the workflow makes its own `Release v<version>` commit. Tags from before this fallback existed are annotated exactly `Release v<version>`.

### The pre-built DLL

Players never compile the gamecore, so a release ships a binary DLL. `scripts/vp-lines.txt` lists the supported lines and their default. Each committed `scripts/dll-release-info-<line>.txt` pin identifies the release tag and source commit for one line. `scripts/install/download-dll.cmd` retrieves that pinned release from `CIVITAS-John/vox-populi`. Updating `civ5-dll` alone does not update the installed binary, including through `manual-update.cmd`.

After pushing a DLL commit to `vox-deorum-<line>` and waiting for its published build, run `npm run update:dll` from the repository root. It uses the current `civ5-dll` HEAD and the default VP line. Use `-- --line X.Y` for another supported line or `-- --dry-run` to preview. The command requires Git and GitHub CLI, verifies the build's recorded full commit, branch, and required assets, and leaves the pin unchanged if no matching build is ready. It does not build or download the DLL.

Review and commit the updated pin together with the default line's submodule gitlink. For another line, restore the default checkout before committing. Run `scripts/install.cmd` to install the new pin locally; other checkouts receive it through `manual-update.cmd` after the outer commit is pushed. Building the DLL from source is a developer task; see [setup.md](setup.md) and [civ5-dll/building.md](civ5-dll/building.md).

## Versioning

The version of record is `version.json` at the repo root: three integer fields (`major`, `minor`, `revision`) that compose into the familiar `MAJOR.MINOR.REVISION`. `release.txt` holds the last shipped tag on one line, as `vMAJOR.MINOR.REVISION`. The build and release-notes tooling reads it to know where the previous release ended.

The same number appears in three more places, all of which the release workflow rewrites for you:

| File | Form it takes |
| --- | --- |
| `scripts/installer.iss` | `#define MyAppVersion "MAJOR.MINOR.REVISION"`, which names the installer and its wizard |
| `README.md` | the `**Version MAJOR.MINOR.REVISION - Beta**` line near the top |
| `scripts/bootstrap.cmd` | the tag it falls back to when none is given |

The workflow finds each of those by regular expression, so keep their exact shape when editing around them, and prefer letting the workflow do the bump rather than editing the five files by hand.

Releases are tagged `vMAJOR.MINOR.REVISION`. The DLL is a submodule with its own upstream history, so it tracks its own Vox Populi base version independently of the project version. The release notes call that out when it changes.

## Release notes

Per-release changelogs live in [`docs/versions/`](../versions/), one Markdown file per version. Each opens with a headline giving the version and date plus a one-line summary of the release's theme, then groups changes under short thematic headings such as Diplomacy & Deals, Under the Hood, or Not Yet Done. Any savegame-compatibility or DLL-base change is called out there. These are the canonical changelogs and the only release documentation in the standing doc tree.

Every release, themed or not, goes through the same three steps:

1. **Draft.** Ask a coding agent to draft the release notes. Following the root `AGENTS.md`, it reads the last tag from `release.txt`, surveys `git log` and `git diff --stat` since that tag, and writes short grouped bullets to `.tmp/release-notes.md`. That folder is gitignored, so nothing half-finished lands in the repo.
2. **Edit.** Revise the file by hand. Leave out a top-level title, since the release is already named after its version.
3. **Publish.** Run `npm run release -- <patch|minor|major|none>` from the repository root, adding `--dry-run` to test first. The command is `scripts/packaging/release.mjs`. It requires that you are on `main` and that local `main` matches `origin/main`, because the workflow builds from the remote. It warns about uncommitted changes, shows the next version and the notes, asks for confirmation (`--yes` skips this), and dispatches the workflow through GitHub CLI with the file as `release_notes`. Use `--notes <path>` to send a different file. Follow the run with `gh run watch`.

For a themed release that deserves a page under `docs/versions/`, commit `docs/versions/<version>.md` and push it first, then pass it with `--notes`.

## Building the installer locally

`scripts/packaging/build-installer.cmd` is the same script the workflow calls, and you can run it directly to test packaging without publishing anything. It needs **Inno Setup 6** installed. In order, it:

1. **Fetches a portable Node.js** (v22.23.3) into `node/` if it is missing or holds a different version, so the installer can ship a self-contained runtime and no player needs system Node.
2. **Installs all dependencies** from the root via npm workspaces, including dev dependencies needed to compile, plus the `vox-agents/ui` dependencies separately.
3. **Builds everything** with `npm run build:all`, then **prunes to production dependencies** so only what's needed to run is bundled.
4. **Uses the pre-built game DLL** already staged under `scripts/release/`. When it is missing, `scripts/install/download-dll.cmd` downloads the current default line from `scripts/vp-lines.txt` and its committed pin. The build does not verify an existing staged DLL against that pin. Stage 4 makes installer packaging consume the selected pin every time.
5. **Compiles the installer** from `scripts/installer.iss` with Inno Setup.

The result is `scripts/dist/VoxDeorum-<version>.exe`, versioned from `release.txt`. That single file is what gets attached to a GitHub release. Inno Setup resolves its output directory relative to the `.iss` file, which is why an `OutputDir=dist` in `scripts/installer.iss` means `scripts/dist/` rather than a repo-root folder.

Running this by hand does not bump any version, so a local build reuses whatever version the working tree currently carries. Use it to check that packaging succeeds, and use the workflow's `dry_run` to check the same thing on a clean machine.

## Generated API docs

Separate from release packaging, each TypeScript service publishes a generated TypeDoc API reference: `npm run docs` per service, or `scripts/maintenance/generate-docs.cmd` for all three at once. `.github/workflows/generate-docs.yml` regenerates and commits them whenever service source changes land on `main`. They are reference material in the components' own `docs/api/` folders, not part of the prose documentation and not bundled into the installer.

## Checklist for a release

1. Get `main` into the state you want to ship, and confirm the [pre-submit checks](testing.md#before-you-submit) pass. Nothing in CI runs the tests for you.
2. Have the notes drafted into `.tmp/release-notes.md` and edit them. For a themed release, also commit them as `docs/versions/<version>.md` and push.
3. Run `npm run release -- <type> --dry-run`. Confirm that the installer builds and verifies, and that the summary shows your notes.
4. Run `npm run release -- <type>`. The workflow bumps the version files, commits, tags, builds, and publishes.
5. Check the published release: the installer is attached, and the body carries your notes.
