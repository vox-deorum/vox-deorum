# Operations

This page is for a checkout that already builds and runs ([Setup](setup.md) covers getting there). It documents the maintenance scripts under `scripts/` that setup.md doesn't cover, where each service's logs land, and how to attach a debugger. One of the scripts below discards local changes, so read its entry before running it.

## Maintenance scripts

All paths are relative to the repository root.

### Getting a working checkout

- **`scripts/bootstrap.cmd`** is a from-nothing installer: it installs Git for Windows (with LFS) if missing, shallow-clones the repository at a release tag (the latest one by default, or one passed as an argument), initializes submodules, pulls the LFS-tracked prebuilt DLL binaries, and hands off to `install.cmd`. After an optional tag, pass `--line X.Y` and `--debug` in either order to choose the DLL line and build mode. Use it for someone who has no clone and possibly no Git at all: one command gets them to a working checkout. If you already have a clone, run `install.cmd` directly instead.
- **`scripts/install.cmd`** is the first-run setup a source contributor actually needs. It accepts `--line X.Y` and `--debug` in either order, using the default from `scripts/vp-lines.txt` when the line is omitted. It verifies the line and its committed `scripts/dll-release-info-<line>.txt` pin, then downloads the matching DLL without changing `civ5-dll`. When that checkout differs from the selected pin, the script prints repair commands for the matching `vox-deorum-<line>` branch. It also detects Civilization V through SteamCMD (checking the registry and the common Steam library paths), copies the mod folders into the game's `MODS` directory along with the prebuilt DLL, installs Node.js if it's missing (falling back to a portable copy under `node/` when there are no admin rights or the installer fails), runs `npm install` from the repository root, and creates `vox-agents/.env` from `.env.default` if it doesn't exist yet. This is a separate path from the packaged installer that [Getting Started](../players/getting-started.md) walks a player through: that one ships a compiled build, this one sets up a working Civ 5 install for someone building from source.

### Updating an existing checkout

- **`scripts/manual-update.cmd`** runs `cleanup-data`, `cleanup-logs`, `git checkout main --force`, `git pull`, `git submodule update`, then `install.cmd`, forwarding all arguments including the line and debug selection. **Warning: `git checkout main --force` discards uncommitted local changes and switches you onto `main`, whatever branch you were on.** Use this only when you want to throw away local edits and reset to a clean `main`, for example to reproduce an issue against upstream. For ordinary updates, use `git pull` plus `npm install` instead: it preserves your branch and any local changes.
- **`scripts/cleanup-data.cmd`** clears `mcp-server/data` (the recorded game databases) and, recursively, `vox-agents/telemetry` (every recorded agent trace). When the external `recycle` command-line tool is on your `PATH`, both go to the Recycle Bin and stay recoverable. That tool is not bundled with this repository, so when it is missing the script says so and deletes the files permanently instead. Either way it reports failures rather than hiding them.
- **`scripts/cleanup-logs.cmd`** deletes every file directly under `bridge-service/logs`, `mcp-server/logs`, and `vox-agents/logs` with `del`, so these are always gone rather than recycled.
- **`scripts/uninstall-mods.cmd`** removes the installed Community Patch, Vox Populi, and Vox Deorum mod folders, plus the VPUI and UI_bc1 DLC folders, from your Civilization V install. The packaged installer's own uninstaller runs this automatically; run it by hand to get back to an unmodded game without touching your repository checkout.

Other scripts in `scripts/` are covered elsewhere: `vox-deorum.cmd` and building the three services in [Setup](setup.md), and `build-installer.cmd`, `download-dll.cmd`, and `generate-docs.cmd` in [Releasing](releasing.md).

## Logs

All three services log through the same Winston setup (each service's own `src/utils/logger.ts`), writing to a `logs/` folder under the service directory:

| Service | Log directory |
| --- | --- |
| Bridge Service | `bridge-service/logs/` |
| MCP Server | `mcp-server/logs/` |
| Vox Agents | `vox-agents/logs/` |

Each writes two rotating files alongside its console output: `error.log` (errors only) and `combined.log` (everything down to `debug`). Both cap at 10 MB per file; `error.log` keeps up to 5 rotated files, `combined.log` keeps up to 10. Set the `LOG_LEVEL` environment variable (for example `debug` or `warn`) to change what reaches the console and `combined.log` for a given service; it defaults to `info` if unset.

Vox Agents additionally streams every log line to its web dashboard over SSE. That live view, along with the rest of the tracing and dashboard story, is covered in [vox-agents/observability.md](vox-agents/observability.md) and isn't repeated here.

## Running the Codex proxy in the foreground

When Codex login or startup misbehaves, run the managed proxy by hand in a terminal so you can watch its structured stderr directly instead of digging through what Vox Deorum captures.

```text
npx --yes codex-openai-proxy@0.1.0-rc.23 serve --root C:\absolute\temporary\codex-root --port 8787 --log-level info --login device-code --request-timeout 300000ms --shutdown-timeout 10000ms
```

This mirrors the invocation vox-agents builds. `--login device-code` forces the device-code sign-in flow, which the proxy would otherwise only pick when its stderr isn't a terminal; vox-agents relies on it so the one-time code always reaches the wizard and console. The proxy's log level follows the `LOG_LEVEL` environment variable (default `info`): set `LOG_LEVEL=debug` to see the proxy's redacted app-server diagnostics and its readiness-probe request logs. The version pin is kept current by `npm run update:codex-proxy`, so don't edit it by hand here. Do not configure an API key for the proxy: the adapter passes an inert `local` placeholder to satisfy the OpenAI-compatible client, it is not a credential. See [vox-agents/codex.md](vox-agents/codex.md) for the pin-update workflow.

## Attaching a debugger

Two of the three services open a Node inspector port from certain npm scripts (check each `package.json` if this drifts):

| Service | Script | Port |
| --- | --- | --- |
| MCP Server | `npm run start` (and `start:dist`) | `7000` |
| Vox Agents | `npm run start`, `strategist`, `telepathist`, `oracle`, `narrator` (and their `:dist` variants) | `9229` (Node's default; the scripts pass a bare `--inspect`) |

Neither service's `npm run dev` opens an inspector port, and neither does Vox Agents' `archivist` entry point. Bridge Service doesn't open one in any of its scripts.

To attach, open `chrome://inspect` in Chrome or Edge and add the target port, or use your editor's Node attach configuration (in VS Code, "Attach to Node Process," or an `attach` launch config pointing at the port). Only one process can hold a given port at a time, and the Vox Agents entry points all share one, so running two of them together needs care.

The DLL is a different story: it's not a Node process, so none of this applies. See [civ5-dll/building.md](civ5-dll/building.md) for building a debug DLL and attaching Visual Studio, and the submodule's own [Minidump Guide](../../civ5-dll/docs/minidumps.md) for reading a crash dump.
