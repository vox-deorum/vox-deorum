# Setup

This page covers building Vox Deorum from source and running the whole stack end to end. It is for contributors who want to change the code.

If you only want to *play*, the installer does all of this for you. See the players' [Getting Started](../players/getting-started.md) guide instead.

The stack is five components ([architecture.md](architecture.md)): a C++ game DLL, a Civ V mod, and three Node.js/TypeScript services managed as npm workspaces. Most day-to-day work is in the TypeScript and the mod's Lua/SQL. You only rebuild the DLL when you change its C++.

## Prerequisites

| Requirement | Why |
|---|---|
| **Windows 10 or 11** | The game, the named-pipe IPC, and the launch scripts are Windows-only. |
| **Civilization V** with both expansions, plus **Community Patch + Vox Populi** | The modified gamecore the DLL replaces. |
| **Node.js ≥ 20** and npm | Runs the three services. The installer bundles a portable Node; for development use a system install. |
| **Git with LFS** | Cloning the repository and its submodules. |
| **Python 3.x** | Used by the DLL build scripts and a few mod tooling scripts. |
| **A Visual C++ toolchain (v90 / VS2008 toolset)** | Only if you build the DLL. See [Building the DLL](#building-the-dll). |
| **At least one LLM provider credential** | Use an API key for API-backed providers, a local endpoint, or ChatGPT device login for Codex. |

## Clone and install

The repository uses git submodules (the DLL is one) and npm workspaces. Clone recursively and install once from the root:

```bash
git clone --recursive https://github.com/CIVITAS-John/vox-deorum.git
cd vox-deorum
npm install --include=dev
```

Because of npm workspaces, **all dependencies for `bridge-service`, `mcp-server`, and `vox-agents` install together** from the root. Never run `npm install` inside a single workspace. The same rule applies when adding a package.

Build all three TypeScript services at once:

```bash
npm run build:all
```

The vox-agents build recurses into `vox-agents/ui`, so the web UI is built too. The matching root scripts are `npm run test:all`, `npm run lint:all`, and `npm run clean:all`. Each service also has its own `build`, `dev`, `test`, `lint`, and `type-check` scripts if you want to work on just one.

## Building the DLL

You only need this when you change the C++ gamecore, which for Vox Deorum mainly means the connection service. The DLL is a separate submodule with its own upstream history and its own detailed build documentation, so this page stays brief and defers to [civ5-dll/building.md](civ5-dll/building.md).

The gamecore is a 32-bit C++ DLL built with the **v90 (Visual C++ 2008) platform toolset**. There are two supported build paths:

- **Visual Studio + v90 toolset.** Requires both Visual C++ 2008 SP1 (the actual compiler) and Visual C++ 2010 SP1 (the MSBuild integration), hosted in a modern VS2019/2022. The convenience wrapper `build-and-copy` (run from `civ5-dll/`) builds the DLL and copies it into place.
- **Clang scripts.** Python-driven clang builds, the same ones the submodule's CI uses.

The submodule compiles with both toolchains in `civ5-dll/.github/workflows/build_vp.yml`, and runs cppcheck static analysis from `civ5-dll/.github/workflows/cppcheck.yml`. Verify that a C++ change builds cleanly under both compilers, without new warnings, before submitting. Those two files are also where to look when a DLL CI run fails.

Exact installer links, install order, common errors, the deploy step, and the debug-attach workflow are all in [civ5-dll/building.md](civ5-dll/building.md) and the submodule's own `docs/`.

## Configuring the services

Agents need provider credentials and, optionally, a strategist configuration:

1. **Provider credentials.** In `vox-agents/`, copy the environment template (`.env.default` → `.env`) and configure the provider you will use. API-backed providers need a key. Codex downloads its pinned proxy on first use, opens ChatGPT device login in the browser, and prints the one-time code when no existing Codex session is available.
2. **Models.** The registry in `vox-agents/src/utils/config/defaults.ts` ships only the openai-compatible default and embedder, with `default` and `embedder` aliases. Before work starts, Vox Agents verifies each unregistered `provider/model` reference against that provider's model list, then configures a match in memory for the run. If discovery is unavailable, it warns and uses rule-based configuration; a live catalog that confirms the model is absent produces an error, as does a reference that is neither a registered alias nor a supported `provider/model` ID — so a typo fails immediately instead of silently running on the default model. Exact entries in `vox-agents/config.json` remain explicit overrides and bypass discovery. Codex discovery starts the managed proxy and reads its authenticated live catalog. An unregistered reference such as `codex/GPT-5.6-Sol@high` matches the discovered model case-insensitively and applies high reasoning effort. The wizard or `config.json` is still the way to pin custom options. The framework resolves each agent's model through its `getModel()` hook, so you can assign different models to agents or players. See [vox-agents/overview.md](vox-agents/overview.md).
3. **Players and strategist.** `vox-agents/configs/` holds a small set of curated starters. Copy one to control which civilizations the AI plays and how: `llmPlayers` (which player IDs the AI controls), `autoPlay`, and the chosen `strategist`. `vox-agents/configs/experiments/` holds research configurations, including model comparisons and recording runs. Start mode is supplied when launching: `--load` loads a save, `--wait` waits for manual start, and the default starts a new game. See [vox-agents/strategist.md](vox-agents/strategist.md).

The bridge service and MCP server read their own settings from environment and config files; see [bridge-service/configuration.md](bridge-service/configuration.md) and [mcp-server/overview.md](mcp-server/overview.md). Both can start on a dynamically chosen port and publish their real shutdown URL to a temp file when given `BRIDGE_SHUTDOWN_URL_FILE` or `MCP_SHUTDOWN_URL_FILE`. This is how the launcher finds them.

## Running the stack

For a full session you need the game, with the mod enabled, plus all three services.

The launcher `scripts/vox-deorum.cmd` brings the services up in dependency order (bridge, then MCP server, then vox-agents) and waits for each to publish its port. Press Q or K, then confirm the action, to stop the services. K also kills CivilizationV.exe after the services stop. If a service exits unexpectedly, the launcher stops the remaining services and shows the final 50 lines of that service's `logs/combined.log`. It shuts services down gracefully, falling back to a force-kill:

```bat
scripts\vox-deorum.cmd            REM default: web UI
scripts\vox-deorum.cmd strategist REM or any mode matching a vox-agents npm script
scripts\vox-deorum.cmd --keep-open REM keep service windows open after their commands exit
```

`--keep-open` can appear anywhere in the argument list. The launcher continues to detect stopped services, but leaves each finished command prompt open for inspection. Close those command prompts manually when you no longer need them.

The launcher prefers a bundled Node under `node/` and falls back to a system install. It automatically runs the compiled build (`dist/`) when source isn't present, or the source directly when it is.

To run a single service by hand during development, use its own scripts in `bridge-service/`, `mcp-server/`, or `vox-agents/`:

- `npm run dev` for watch mode with hot reload.
- `npm run start` to build then run.

The vox-agents module also exposes purpose-built entry points: `npm run strategist`, `npm run telepathist`, `npm run oracle`, `npm run archivist`, and `npm run narrator`. A running MCP server and bridge service are prerequisites for the agents to connect.

`scripts/` holds more than the launcher: `bootstrap.cmd` clones the repository at a release tag from nothing, `install.cmd` performs the full player-style install, `manual-update.cmd` resets a checkout back to `main` and reinstalls, and there are cleanup scripts for logs and game data. Some of them discard local changes. [Operations](operations.md) documents what each one does, where the services write their logs, and how to attach a Node debugger.

## Next steps

- [Testing](testing.md) covers running and writing tests, plus the pre-submit checklist. Nothing is enforced by CI, so that checklist is on you.
- [Protocol](protocol.md) explains what's actually flowing once the stack is up, and [Diplomacy](diplomacy.md) follows one interactive round trip through it.
- [Operations](operations.md) covers the maintenance scripts, logs, and debugging.
- [Releasing](releasing.md) covers packaging a build into the installer.
- Each component folder under [developers/](.) goes deeper on the part you're changing. Four of the five components (`bridge-service`, `mcp-server`, `vox-agents`, `civ5-mod`) also keep an `AGENTS.md` with the working conventions for that directory. The `civ5-dll` submodule is the exception: it follows upstream practice, with `DEVELOPMENT.md` and its own `docs/` instead.
