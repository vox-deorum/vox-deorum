# Setup

This page covers building Vox Deorum from source and running the whole stack end to end. It is for contributors who want to change the code.

If you only want to *play*, the installer does all of this for you — see the players' [Getting Started](../players/getting-started.md) guide instead.

The stack is five components ([architecture.md](architecture.md)): a C++ game DLL, a Civ V mod, and three Node.js/TypeScript services managed as npm workspaces. Most day-to-day work is in the TypeScript and the mod's Lua/SQL. You only rebuild the DLL when you change its C++.

## Prerequisites

| Requirement | Why |
|---|---|
| **Windows 10 or 11** | The game, the named-pipe IPC, and the launch scripts are Windows-only. |
| **Civilization V** with both expansions, plus **Community Patch + Vox Populi** | The modified gamecore the DLL replaces. |
| **Node.js ≥ 20** and npm | Runs the three services. (The installer bundles a portable Node; for development use a system install.) |
| **Git with LFS** | Cloning the repository and its submodules. |
| **Python 3.x** | Used by the DLL build scripts and a few mod tooling scripts. |
| **A Visual C++ toolchain (v90 / VS2008 toolset)** | Only if you build the DLL — see [Building the DLL](#building-the-dll). |
| **At least one LLM provider API key** | Needed to actually run agents (OpenAI, Anthropic, Google, OpenRouter, or a local OpenAI-compatible endpoint). |

## Clone and install

The repository uses git submodules (the DLL is one) and npm workspaces. Clone recursively and install once from the root:

```bash
git clone --recursive https://github.com/CIVITAS-John/vox-deorum.git
cd vox-deorum
npm install --include=dev
```

Because of npm workspaces, **all dependencies for `bridge-service`, `mcp-server`, and `vox-agents` install together** from the root. Never run `npm install` inside a single workspace. The same rule applies when adding a package: install it from the repo root.

Build all three TypeScript services at once:

```bash
npm run build:all
```

The matching root scripts are `npm run test:all` and `npm run clean:all`. Each service also has its own `build`, `dev`, `test`, and `clean` scripts if you want to work on just one.

## Building the DLL

You only need this when you change the C++ gamecore — for Vox Deorum that mainly means the connection service. The DLL is a separate submodule with its own upstream history and its own detailed build documentation, so this page stays brief and defers to [civ5-dll/building.md](civ5-dll/building.md).

The gamecore is a 32-bit C++ DLL built with the **v90 (Visual C++ 2008) platform toolset**. There are two supported build paths:

- **Visual Studio + v90 toolset.** Requires both Visual C++ 2008 SP1 (the actual compiler) and Visual C++ 2010 SP1 (the MSBuild integration), hosted in a modern VS2019/2022. The convenience wrapper `build-and-copy` (run from `civ5-dll/`) builds the DLL and copies it into place.
- **Clang scripts.** Python-driven clang builds, the same ones CI uses.

CI compiles with both MSVC and clang. Verify that a C++ change builds cleanly — without new warnings — under both before submitting.

Exact installer links, install order, common errors, the deploy step, and the debug-attach workflow are all in [civ5-dll/building.md](civ5-dll/building.md) and the submodule's own `docs/`.

## Configuring the services

Agents need provider credentials and, optionally, a strategist configuration:

1. **Provider keys.** In `vox-agents/`, copy the environment template (`.env.default` → `.env`) and add at least one provider API key. `.env.default` documents every available option.
2. **Models.** Model definitions live in `vox-agents/config.json` under `llms`, which maps keys like `openai/gpt-5-mini` to a provider and model, with `default` and `embedder` aliases. The framework is provider-agnostic and resolves each agent's model through its `getModel()` hook. You can assign different models to different agents — or different strategists to different players in the same game. See [vox-agents/overview.md](vox-agents/overview.md).
3. **Players and strategist.** To control which civilizations the AI plays and how, copy one of the files in `vox-agents/configs/` and edit it: `llmPlayers` (which player IDs the AI controls), `autoPlay`, the chosen `strategist`, and `gameMode` (`start` for a new game, `load` for a save). See [vox-agents/strategist.md](vox-agents/strategist.md).

The bridge service and MCP server read their own settings from environment and config files; see [bridge-service/configuration.md](bridge-service/configuration.md) and [mcp-server/overview.md](mcp-server/overview.md). Both can start on a dynamically chosen port and will publish their real shutdown URL to a temp file when given `BRIDGE_SHUTDOWN_URL_FILE` / `MCP_SHUTDOWN_URL_FILE`. This is how the launcher finds them.

## Running the stack

For a full session you need the game (with the mod enabled) plus all three services.

The launcher `scripts/vox-deorum.cmd` brings the services up in dependency order — bridge, then MCP server, then vox-agents — waits for each to publish its port, and on exit shuts them all down gracefully (falling back to a force-kill, and optionally killing CivilizationV.exe too):

```bat
scripts\vox-deorum.cmd            REM default: web UI
scripts\vox-deorum.cmd strategist REM or any mode matching a vox-agents npm script
```

The launcher prefers a bundled Node under `node/` and falls back to a system install. It automatically runs the compiled build (`dist/`) when source isn't present, or the source directly when it is.

To run a single service by hand during development, use its own scripts in `bridge-service/`, `mcp-server/`, or `vox-agents/`:

- `npm run dev` — watch mode with hot reload.
- `npm run start` — build then run.

The vox-agents module also exposes purpose-built entry points: `npm run strategist`, `npm run telepathist`, `npm run oracle`, `npm run archivist`, and `npm run narrator`. A running MCP server and bridge service are prerequisites for the agents to connect.

## Next steps

- [Testing](testing.md) — how to run and write tests across the components.
- [Protocol](protocol.md) — what's actually flowing once the stack is up.
- [Releasing](releasing.md) — packaging a build into the installer.
- Each component folder under [developers/](.) for depth on the part you're changing — and its `AGENTS.md` for the working conventions inside that directory.
