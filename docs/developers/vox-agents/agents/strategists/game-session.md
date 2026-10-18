# Game session

A game session runs one game of Civilization V from launch to victory. It starts the game, creates a player loop for each AI seat, reacts to game events, and shuts everything down at the end.

`StrategistSession` (`src/strategist/strategist-session.ts`) is the class. It starts from the console (`npm run strategist`, `src/strategist/console.ts`) or from the dashboard's Session view.

## Lifecycle

1. **Launch.** The session validates model references and prompt folders before `VoxCivilization` starts the game. It waits up to 30 seconds for the process, then attaches (see [Sessions](../../framework/sessions.md#launching-the-game)). Launcher errors or a missing process fail startup.
2. **Prepare.** The session connects the MCP client and, when the game is bound, creates one `VoxPlayer` per AI seat. It writes the per-game [reference files](../../workspace/store.md#game-reference) into their stores before starting player loops. A setup failure stops the session before any loop starts.
3. **Play.** The session reacts to MCP notifications:

   | Notification | Effect |
   | --- | --- |
   | `PlayerDoneTurn` | Drives the players' [turn loops](player-loop.md). |
   | `GameSwitched` | Rebinds to the new game ID. |
   | `PlayerVictory` | Shuts down gracefully once the game's archive is safely on disk. |

4. **Stop.** Each player's context is shut down and its workspace store closed (`VoxPlayer.dispose`).

## Session configs

Sessions are configured by JSON files in `vox-agents/configs/` (type `StrategistSessionConfig`). The top level has curated starters. `vox-agents/configs/experiments/` has research and recording configs.

| Field | Purpose |
| --- | --- |
| `llmPlayers` | Which player IDs the AI controls, and which strategist (and optionally which model) plays each. |
| `autoPlay` | The usage mode. See below. |
| `repetition` | Play several games in a row. See below. |
| `production` | Animation and recording behavior. See [Media](../../platform/media.md). |

Per-seat settings such as `files`, `triage`, and `prompts` can also go on a seat. They are described in [Files](../../workspace/files.md), [Tiers and triage](../../models/tiers-and-triage.md), and [Prompt files](../../framework/prompt-files.md).

### Usage modes

| Mode | Behavior |
| --- | --- |
| Interactive (default) | Pauses on human turns so a person can play alongside the AI. |
| Observe | Auto-plays everything, for watching or batch experiments. |
| Human control | Observe mode with a person in a strategist seat. Turned on by assigning `human-strategist`. See [Human control](human-control.md). |

### Repeating games

`repetition` plays several games in sequence. Combined with fixed seeds and seat rotation, this makes experiments repeatable.

- **Seeds.** `VoxCivilization` (`src/infra/vox-civilization.ts`) writes the configured random seeds into Civ's `config.ini` before launch, and restores the old values afterward.
- **Checking seeds.** The session compares the seeds Civ reports with the ones requested, and records both.
- **No stale seeds.** When a new-game config has no `randomSeeds`, the seeds are written as zero for that launch, so fixed seeds left in the user's `config.ini` do not carry over.
- **Seating.** Player seats can rotate between runs.

### Command-line flags

How the game starts is chosen at launch and is not saved in a config:

| Flag           | Effect                   |
| -------------- | ------------------------ |
| (none)         | Start a new game.        |
| `--load`, `-l` | Load a save.             |
| `--wait`, `-w` | Wait for a manual start. |

Other flags: `--config`/`-c`, `--players`/`-p`, `--strategist`/`-s`, `--autoPlay`/`-a`, `--repetition`/`-r`, and `--seed`.

## Crash recovery

If the DLL disconnects and stays down, the session kills and relaunches the game (with a limited number of attempts) and resumes where the strategists left off. A relaunch that loads the same game keeps the existing `VoxPlayer`s: each one treats a repeated turn as a reload and restarts its timeline from there. Players are only recreated when `GameSwitched` reports a different game ID.
