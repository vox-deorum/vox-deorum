# Media: capture and narration

Vox Deorum records or livestreams games through OBS Studio, driven by the strategist session. The narrator pipeline currently assembles recordings into episode manifests; later stages for narrated video are planned.

## Production modes

A [game session's](../agents/strategists/game-session.md) config carries a `production` mode that decides how the game looks and whether OBS is involved.

| Mode | Animations | OBS | Notes |
| --- | --- | --- | --- |
| `none` (default) | skipped in observe mode | no | Uses strategic view during autoplay for speed. |
| `test` | on | no | Plays animations without capture. |
| `livestream` | on | yes | Streams via OBS. |
| `recording` | on | yes | Captures segment-based video via OBS. |

Helper predicates in `src/types/config.ts` split these into "visual" modes (play animations, keep the normal view) and "OBS" modes (initialize capture).

## ObsManager: driving OBS Studio

`ObsManager` (`src/infra/obs-manager.ts`) is a singleton that controls OBS Studio over its WebSocket protocol, using `obs-websocket-js`.

On initialization it makes sure OBS is running (launching it if needed), connects, and builds its scenes programmatically:

- **A game scene** with a window capture and an application-audio capture of the Civilization V process.
- **A pause scene** with a static image, for livestreams.

Capture details:

- Both game inputs are pointed at the running game on every setup, and again whenever a game process is attached (first launch, an existing game, or a crash relaunch). So the capture follows the build that is actually running, whichever the DX11 setting asked for.
- A change made while OBS is disconnected is applied when it reconnects.
- Desktop and microphone audio are muted for the session, so only game audio is recorded.

Production then follows a simple lifecycle: start, pause, resume, stop. Pausing means different things by mode: recordings pause the file so there is no dead air, while livestreams switch to the pause scene.

Recordings are organized per game. When the session learns its game ID, the manager redirects OBS output to a `{recordings}/{gameID}/` directory, restored on shutdown. Healthy connections are checked every ten seconds. Failures trigger relaunch and reconnection attempts with a growing delay capped at sixty seconds, continuing until recovery or shutdown. The manager resumes active production after reconnecting and registers with the process manager for cleanup.

Configuration lives under `obs` in `config.json` (executable path, WebSocket port and password, profile, scenes, output directory), with environment-variable overrides. This path needs a recent OBS Studio on Windows with the obs-websocket v5 server enabled.

## ProductionController: cutting segments

Recording a whole game produces hours of dead time, so the strategist session never calls ObsManager directly. It goes through `ProductionController` (`src/infra/production-controller.ts`), which cuts recordings into **segments** aligned with on-screen action.

The game's render events drive a small state machine:

1. A major-player panel switch starts a segment (see the civ5-mod [ui.md](../../civ5-mod/ui.md)).
2. Each major-player panel switch or animation-start event restarts a ten-second grace timer.
3. When the timer expires, the segment stops. Minor-player switches are logged within active segments and do not extend the timer.

In livestream mode the controller passes straight through to ObsManager.

Alongside the video files, the controller writes `segments.jsonl` in the recording directory: one line per start, switch, or stop event, with the turn, player, wall-clock timestamp, and (on stop) the output filename. That log is the contract with the narrators pipeline.

### Archiving the DLL recording

The MCP server packages the DLL recording as `archive/<experiment>/<game-id>.zip`, with one game-ID root folder, excluding `tactical-training/` and storing `stream.bin` without compression. `archiveRawCaptureRecording` in `mcp-server/src/utils/knowledge/archive.ts` calls `scripts/utilities/archive-raw.mjs` for packaging.

The utility replaces the previous zip only after a temporary archive is complete. A packaging failure preserves the source and any earlier zip. After success, the source is renamed to a hidden `.removing` folder before deletion. Cleanup failures are logged; leftover `.partial` files or `.removing` folders can be removed by hand.

To package manually, run `npm run archive:raw -- SOURCE_ROOT OUTPUT_DIRECTORY` from the repository root.

## The narrators pipeline

The narrator design in `src/narrators/` has five stages, using recordings and game knowledge from all players. Assemble is implemented; stages 2 through 5 are proposals. `NarratorWorkspace` in `src/narrators/workspace.ts` manages the intermediate files so they can be inspected or edited between stages.

| # | Stage | LLM | What it does |
| --- | --- | --- | --- |
| 1 | Assemble | no | Parses `segments.jsonl`, validates and decomposes the segments into **episodes** (units identified by turn and player, timed relative to their source video file), and enriches them from the knowledge database with per-episode event counts, player information, and the game's winner. Output: an episode manifest (`episodes.json`). |
| 2 | Select | yes | Chooses which episodes the final video should keep. |
| 3 | Script | yes | Writes the narration for the selected episodes, drawing on the knowledge database. |
| 4 | Voice | no | Synthesizes the narration through a pluggable text-to-speech provider. |
| 5 | Video | no | Stitches the selected segments and audio into the final video with ffmpeg. |

Assembly runs as a `VoxSession` in `src/narrators/sessions/assemble-session.ts`. The [narrator guide](../../../../vox-agents/src/narrators/overview.md) covers running it and links to the later-stage designs.
