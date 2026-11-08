# Operations

This page is for a checkout that already builds and runs ([Setup](setup.md) covers getting there). It documents the maintenance scripts under `scripts/`, where each service's logs land, and how to attach a debugger. One script below discards local changes, so read its entry before running it.

## Maintenance scripts

All paths are relative to the repository root.

### Getting a working checkout

#### `scripts/bootstrap.cmd`

A from-nothing installer for someone who has no clone, and possibly no Git. It installs Git for Windows with LFS if missing, shallow-clones the repository at a release tag into a `vox-deorum` folder next to the script, initializes submodules, pulls the LFS-tracked prebuilt DLL binaries, and hands off to `install.cmd`.

Pass an optional release tag first, then `--line X.Y` and `--debug` in either order. The latest release tag is used when none is given. With a clone already, run `install.cmd` directly instead.

#### `scripts/install.cmd`

First-run setup for a source checkout. It accepts `--line X.Y` and `--debug` in either order, using the default line from `scripts/vp-lines.txt` when none is given. It:

1. Validates the selected line and its committed `scripts/dll-release-info-<line>.txt` pin.
2. Downloads the matching prebuilt DLL without switching the `civ5-dll` submodule.
3. Prints repair commands for the matching `vox-deorum-<line>` branch when the source checkout differs from the pin.
4. Finds Steam and Civilization V, installing Steam first if needed, and uses SteamCMD to check the game installation.
5. Replaces the installed Community Patch, Vox Populi, and Vox Deorum mod folders, the EUI compatibility folder, the VPUI and UI_bc1 DLC folders, and the DLL.
6. Installs Node.js if it is missing, falling back to a portable copy under `node/` when there are no admin rights or the installer fails.
7. Runs `npm install` from the root and in `vox-agents/ui`, then creates `vox-agents/.env` from `.env.default` if it does not exist.

| Option | Effect |
| --- | --- |
| `--line X.Y` | Selects a Vox Populi line. The default comes from `scripts/vp-lines.txt`. |
| `--debug` | Uses the debug DLL build instead of the release build. |

The packaged installer that [Getting Started](../players/getting-started.md) walks a player through ships a compiled build. `install.cmd` sets up a working Civilization V install for someone building from source.

### Updating an existing checkout

#### `scripts/manual-update.cmd`

**Warning:** this script deletes recorded data, traces, and logs, and it runs `git checkout main --force` before updating. That discards uncommitted local changes and switches to `main`, whatever branch you were on. Use it only to reset to a clean `main`, for example to reproduce an issue against upstream.

Run it from the `scripts/` directory so it can find its cleanup commands. It runs these steps in order:

1. `cleanup-data` deletes recorded game data, telemetry, and workspace notes.
2. `cleanup-logs` deletes the service logs.
3. `git checkout main --force` resets the checkout onto `main`.
4. `git pull` updates `main`.
5. `git submodule update` updates the submodules.

It then reads the Node.js minimum from the updated root `package.json`, preferring the portable copy under `node/`. If Node is missing or outdated, the script downloads a compatible portable copy there without requiring administrator rights. A failed runtime update stops the script. Finally, it calls `install.cmd`, forwarding all arguments including the line and debug selection.

For routine updates, run `git pull` and `npm install` on your current branch.

#### `scripts/cleanup-data.cmd`

Deletes every direct file in `mcp-server/data` and clears `vox-agents/telemetry` recursively, including the notes and records stored inside telemetry databases. When the external `recycle` command-line tool is on your `PATH`, the files go to the Recycle Bin. That tool is not bundled with the repository, so when it is missing the script says so and deletes permanently instead.

#### `scripts/cleanup-logs.cmd`

Deletes every file directly under `bridge-service/logs`, `mcp-server/logs`, and `vox-agents/logs` with `del`. These are permanently removed.

#### `scripts/uninstall-mods.cmd`

Removes the installed Community Patch, Vox Populi, and Vox Deorum mod folders, plus the VPUI and UI_bc1 DLC folders, from your Civilization V install. It searches the common Steam library paths for the two DLC folders, so an install in an unusual location may keep them. Your repository checkout and other mods are not changed. The packaged installer's uninstaller runs this script automatically.

Other scripts in `scripts/` are covered elsewhere: `vox-deorum.cmd` and building the three services in [Setup](setup.md), and `utilities/build-installer.cmd`, `install/download-dll.cmd`, and `utilities/generate-docs.cmd` in [Releasing](releasing.md).

## Logs

All three services log through the same Winston setup (each service's own `src/utils/logger.ts`), writing to a `logs/` folder under the service directory:

| Service        | Log directory          |
| -------------- | ---------------------- |
| Bridge Service | `bridge-service/logs/` |
| MCP Server     | `mcp-server/logs/`     |
| Vox Agents     | `vox-agents/logs/`     |

Each service writes `error.log` (errors only) and `combined.log` alongside its console output. Both rotate at 10 MB per file; `error.log` keeps up to 5 files and `combined.log` up to 10, including the active file.

`LOG_LEVEL` sets console verbosity for a service and defaults to `info`. The `combined.log` file transport is fixed at `debug`, so it records debug output regardless of `LOG_LEVEL`. Both logging settings live in the service's `src/utils/logger.ts`.

Vox Agents also streams logs to its web dashboard over SSE. For tracing and the live log view, see [vox-agents/platform/observability.md](vox-agents/platform/observability.md).

## Running the Codex proxy in the foreground

When Codex login or startup misbehaves, run the managed proxy by hand in a terminal so you can watch its structured stderr directly.

```text
npx --yes codex-openai-proxy@0.1.0-rc.36 serve --root C:\absolute\temporary\codex-root --port 8787 --log-level info --login device-code --request-timeout 300000ms --shutdown-timeout 10000ms
```

This mirrors the invocation Vox Agents builds. `--login device-code` forces device-code sign-in. For redacted app-server diagnostics and readiness-probe request logs, change the command's flag to `--log-level debug`. When Vox Agents manages the proxy, it selects this flag from `LOG_LEVEL`. The adapter supplies a `local` placeholder as the API key; authentication uses the ChatGPT sign-in. `npm run update:codex-proxy` updates the version pin. See [vox-agents/models/codex.md](vox-agents/models/codex.md) for the pin-update workflow.

## Attaching a debugger

Some npm scripts open a Node inspector. The MCP Server and Vox Agents scripts pass `--inspect=0`, so Node chooses a free port at startup instead of using a fixed one.

| Service | Scripts that open an inspector |
| --- | --- |
| MCP Server | `start`, `start:dist` |
| Vox Agents | `start`, `strategist`, `telepathist`, `oracle`, `narrator`, and their `:dist` variants |
| Bridge Service | none |

The MCP Server's `npm run dev` and Vox Agents' `npm run dev` and `archivist` entry point do not open an inspector.

Read the port from the process's startup line: `Debugger listening on ws://127.0.0.1:<port>/...`. In Chrome, open `chrome://inspect`, add the printed host and port as a Node target, and inspect it. In VS Code, use "Attach to Node Process" or a Node `attach` configuration with that port. Each process chooses its own port.

For DLL debugging, see [civ5-dll/building.md](civ5-dll/building.md) for building a debug DLL and attaching Visual Studio, and the submodule's [Minidump Guide](../../civ5-dll/docs/minidumps.md) for reading a crash dump.
