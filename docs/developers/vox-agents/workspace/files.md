# Seat files

The `files` setting gives a seat's agents a place to read records and keep notes. When it is on, every agent of that seat that uses tools also gets a `bash` tool. The shell is simulated (just-bash): it has common text tools, `jq`, `sqlite3`, and `js-exec` for JavaScript, but no network or Python. It works the same on every provider.

With files on, a strategist can look back at earlier turns, keep its own notes between turns, and share notes across games.

```
/workspace/records     read-only    what the seat saw each turn
/workspace/game        notes        the seat's own notes for this game
/workspace/reference   read-only    game rules: techs, policies, buildings, units
/workspace/shared/<n>  configurable notes kept across games and seats
/tmp                   scratch      shared by one player's agents for the game
```

## Turning it on

`FilesConfig` in `src/types/config.ts` defines the setting:

| Value | Meaning |
| --- | --- |
| `"read"` or `"write"` | Shorthand for game-folder access. |
| An object | `game` (access to the game folder, or `false` to leave it out), `shared` (named shared folders, each with its access), and `quota` (the step budget, default 20). |
| `false` | Off. |

Where it can be set, checked in this order: the seat, the session config, then the root `vox-agents/config.json`. The first level that sets it wins and replaces lower levels completely, with no merging. Off is the default. `resolveSeatFiles` in `src/strategist/seat-config.ts` does this, the same way as `triage`.

An invalid value fails session preflight before the game launches, and the error names the config path.

The workspace needs Node 22.17.0 or newer (the repo requires 22.23.3). On older Node, a session with any files-enabled seat fails at start.

## The folders

`src/utils/workspace/player-workspace.ts` mounts the folders. Everything is stored under `<telemetryDir>/workspaces`.

| Folder | Access | Stored in | Lifetime |
| --- | --- | --- | --- |
| `/workspace/records` | Read-only | The seat's [workspace store](store.md) | The game |
| `/workspace/game` | The seat's `game` access | The seat's workspace store | The game |
| `/workspace/reference` | Read-only | `games/<gameID>/reference/`, mounted once it exists | The game |
| `/workspace/shared/<name>` | Per the `shared` setting | `shared/<name>/` | Across games and seats |
| `/tmp` | Read and write | `scratch/<gameID>-player-<playerID>/` | The game, shared by that player's agents, including concurrent ones |

Rules:

- Shared folder names use lowercase letters, digits, `-`, or `_`, and start with a letter or digit.
- Shared folders and `/tmp` are plain folders on disk. Nothing cleans them up.
- Anything written outside these folders is thrown away after each command.
- Read-only folders reject changes.
- Two seats in one game writing the same shared folder can pass information to each other. Use different names per seat, or read access, to avoid it.

### Guide files

Each folder an agent can write gets an `AGENTS.md` guide:

- **Shared folders.** The guide is created once on disk and never overwritten, so agents and players can edit it.
- **Game notes.** The guide lives in the store. If a command that can write finds it missing, the default is written back as part of that command. So the guide returns after an agent deletes it or a rewind drops it. The default leaves it to agents how to use the folder. It notes which notes they see at the start of each run and that decision rationales and turn records already carry forward.

Players read the game notes, including the guide, by exporting the store (see [Reading the store from outside](store.md#reading-the-store-from-outside)).

## The bash tool

`src/utils/tools/bash-tool.ts` wraps the shell as a tool. `VoxAgent.getRunTools` adds `bash` to any agent whose `getActiveTools()` list is not empty. Runs that restrict their tools leave it out; for example, a telepathist answering a special message has no tools.

The tool description covers only shell mechanics: where each call starts, which commands exist, how files are written, how to calculate, and what a result contains.

**JavaScript** runs through `js-exec` in just-bash's QuickJS sandbox, with a 64 MB memory limit and a 30-second timeout. Agents use it for calculations because `$(( ))` handles only whole numbers. Scripts see the same mounts through the `fs` module, so read-only folders still reject writes and note changes are committed like any other command. They cannot reach the real disk or the network. It does not list folders. The records directions message names the mounted folders and which ones the agent can write, and the description is the same for every seat.

Each output stream is capped at 30,000 characters (`workspaceOutputLimit`), and a cut stream ends with a note on how to read the rest. The model receives the result as plain text: stdout first, then stderr and the exit code only when they are present. Telemetry keeps the full result object.

## Step budget

With files on, workspace work and the final decision share one budget of steps:

- `VoxAgent.stepLimit` raises the agent's `maxSteps` to `quota` (default 20), unless `maxSteps` is already higher.
- Every stop check ends the run through `reachedStepLimit` when the budget runs out.
- The closing reminder counts down the steps left for the final decision.

Each step is a full model call, while commands are cheap, so the prompts ask agents to run bash calls in parallel or as one combined script.

A briefer ignores text from a step that also calls bash, so a line like "checking notes" does not end the briefing.

## What else changes with files on

| Feature | Page |
| --- | --- |
| The model gets a short reminder on keeping notes, the step budget, and reading large files. | [Capability reminder](../models/middleware.md#capability-reminder) |
| The records directions list the folders and the recorded turns, and show the latest note with the names of the five before it. | [File mode](../framework/prompts.md#file-mode) |
| The run's last initial message becomes a cache anchor. | [Caching](../framework/caching.md) |
| Old bash output is dropped when the request gets large. | [Compaction](../framework/compaction.md) |

The compaction threshold is the model's `continuityThreshold` option: 300,000 tokens for Claude Code, Codex, OpenAI, and Anthropic models, and 100,000 otherwise. Runs without files never compact.

File access never comes from CLI host tools. `hostTools` accepts only `Web` (see [Model configuration](../models/configuration.md#host-tools-for-cli-models)).
