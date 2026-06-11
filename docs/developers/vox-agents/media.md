# vox-agents — Media: Capture and Narration

Vox Deorum can record or livestream its games and turn the recordings into narrated video. Two systems cooperate: OBS Studio capture, driven automatically by the strategist session, and the **narrators** pipeline, which assembles recorded segments and game knowledge into finished video content.

## Production modes

A [strategist session's](strategist.md) config carries a `production` mode that decides how the game looks and whether OBS is involved: `none` (the default) skips animations during autoplay and stays in strategic view for speed; `test` plays animations without OBS; `livestream` streams via OBS; and `recording` captures segment-based video via OBS. Helper predicates in `src/types/config.ts` split these into "visual" modes (play animations, keep the normal view) and "OBS" modes (initialize capture).

## ObsManager: driving OBS Studio

`ObsManager` (`src/infra/obs-manager.ts`) is a singleton that controls OBS Studio over its WebSocket protocol. On initialization it makes sure OBS is running (launching it if needed), connects, and builds its scenes programmatically: a game scene with a window capture of CivilizationV.exe and an application-audio capture of the same process — desktop and microphone audio are muted for the session so only game audio lands in the recording — plus, for livestreams, a pause scene showing a static image. Production then follows a simple lifecycle: start, pause, resume, stop. Pausing means different things by mode — recordings pause the file (no dead air), livestreams switch to the pause scene.

Recordings are organized per game: when the session learns its game ID, the manager redirects OBS output to a `{recordings}/{gameID}/` directory, restored on shutdown. A health monitor polls OBS every few seconds and, on connection loss, relaunches and reconnects with bounded retries, resuming production if it was active. The manager registers with the process manager, so Ctrl-C still stops production and restores OBS settings.

Configuration (executable path, WebSocket port and password, profile, scenes, output directory) lives under `obs` in `config.json`, with environment-variable overrides; OBS Studio 30.2+ with the WebSocket server enabled is required, on Windows.

## ProductionController: cutting segments

Recording a whole game produces hours of dead time, so the strategist session never calls ObsManager directly — it goes through `ProductionController` (`src/infra/production-controller.ts`), which cuts recordings into **segments** aligned with on-screen action. The game's render events drive a small state machine: when the in-game top panel switches to a player (the moment something noteworthy is being shown — see the civ5-mod [ui.md](../civ5-mod/ui.md)), a segment starts; when animation activity suggests the action is ending, a grace timer arms; if nothing else happens before it expires, the segment stops. In livestream mode the controller passes straight through to ObsManager.

Alongside the video files, the controller writes `segments.jsonl` in the recording directory — one line per start/switch/stop with the turn, player, wall-clock timestamp, and (on stop) the output filename. That log is the contract with the narrators pipeline.

## The narrators pipeline

The narrators system (`src/narrators/`) is a five-stage batch pipeline that turns a recorded game — the segments plus the game's knowledge database — into narrated video, from short clips to full-game documentaries. Unlike the [telepathist](telepathist.md), which speaks from one player's perspective, the narrator is omniscient: it sees all players and all events.

Each stage is its own `VoxSession` subclass, independently runnable, communicating only through files in a shared workspace (managed by `NarratorWorkspace` in `src/narrators/workspace.ts`) — so intermediate products can be inspected or hand-edited between stages:

1. **Assemble** parses `segments.jsonl`, validates and decomposes the segments into **episodes** — units identified by turn and player, timed relative to their source video file — and enriches them from the knowledge database with per-episode event counts, player information, and the game's winner. Output: an episode manifest (`episodes.json`).
2. **Select** (LLM) chooses which episodes the final video should keep.
3. **Script** (LLM) writes the narration for the selected episodes, drawing on the knowledge database.
4. **Voice** synthesizes the narration through a pluggable text-to-speech provider.
5. **Video** stitches the selected segments and audio into the final video with ffmpeg.

As of this writing, Stage 1 is implemented (`src/narrators/sessions/assemble-session.ts`); stages 2–5 are designed but not yet built. The stage-by-stage design docs live with the source — `src/narrators/overview.md` and `stage-1-assemble.md` through `stage-5-video.md` — and are the reference when implementing or modifying a stage.
