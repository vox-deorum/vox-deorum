# Releasing

A Vox Deorum release is a single Windows installer that bundles everything a player needs: the three compiled services, a portable Node.js runtime, the pre-built game DLL, and the mod. Installing is a wizard, not a build.

This page covers how versions are numbered, how release notes are written, and how the installer is packaged. For the full checklist, jump to [Checklist for a release](#checklist-for-a-release).

## Versioning

The project version lives in `version.json` at the repo root as three fields — `major`, `minor`, `revision` — which compose into the familiar `MAJOR.MINOR.REVISION` string (currently `0.10.0`, a beta).

The last shipped tag is recorded as one line in `release.txt` (e.g. `v0.10.0`). The build and release-notes tooling reads it to know where the previous release ended.

Releases are tagged `vMAJOR.MINOR.REVISION`. The DLL, being a submodule with its own upstream history, tracks its own Vox Populi base version independently of the project version (noted in the release notes when it changes).

## Release notes

Per-release changelogs live in [`docs/versions/`](../versions/), one Markdown file per version (`0.10.0.md`, `0.9.0.md`, …). Each is grouped into short thematic sections — Narrators, Oracle, MCP Server, Models & Providers, Infrastructure, and so on — with a one-line header noting the date and any savegame-compatibility or DLL-base change. These are the canonical changelogs and the only release documentation that lives in the standing doc tree.

To draft notes for a new version, follow the process in the root `AGENTS.md`. Read the last tag from `release.txt`, then survey what changed since it:

```bash
git log <tag>..HEAD --oneline --no-merges
git diff --stat <tag>..HEAD
```

Group the result into short bullets. A new `docs/versions/<version>.md` is the home for the finished notes.

## Building the installer

The installer is produced by `scripts/build-installer.cmd`, which prepares everything and then compiles an [Inno Setup](https://jrsoftware.org/isinfo.php) script (`scripts/installer.iss`). It needs **Inno Setup 6** installed.

In order, the script:

1. **Fetches a portable Node.js** (v22.12.0) into `node/` if it isn't already there, so the installer can ship a self-contained runtime — no system Node required on the player's machine.
2. **Installs all dependencies** from the root via npm workspaces (including dev, needed to compile), plus the `vox-agents/ui` dependencies.
3. **Builds all three TypeScript services** with `npm run build:all`, then **prunes to production dependencies** (`npm install --omit=dev` + `npm prune`) so only what's needed to run is bundled.
4. **Downloads the pre-built game DLL** via `scripts/download-dll.cmd` if it isn't already staged under `scripts/release/`. Players get a binary DLL; they never compile the gamecore. (Building the DLL from source is a developer task; see [setup.md](setup.md) and [civ5-dll/building.md](civ5-dll/building.md).)
5. **Prepares the output directory** and **compiles the installer** with Inno Setup.

The result is `dist/VoxDeorum-<version>.exe`, with the version read from `release.txt`. That single file is what's attached to a GitHub release. The installer wizard places the services, the runtime, the DLL, and the mod, and wires up the `scripts/vox-deorum.cmd` launcher a player runs to start a session.

## Generated API docs

Separate from release packaging, each TypeScript service publishes a generated TypeDoc API reference (`npm run docs` per service, or `scripts/generate-docs.cmd` for all three at once). These land in the components' own `docs/api/` folders as reference material. They are not part of the prose documentation and not bundled into the installer.

## Checklist for a release

1. Bump `version.json` and update `release.txt` to the new tag.
2. Write `docs/versions/<version>.md` from the commit range since the last tag.
3. Build the installer with `scripts/build-installer.cmd` and verify `dist/VoxDeorum-<version>.exe` was produced.
4. Tag the commit `v<version>` and attach the installer to the GitHub release, with the changelog as the release body.
