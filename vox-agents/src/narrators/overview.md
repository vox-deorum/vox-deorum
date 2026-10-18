# Narrator pipeline

The narrator pipeline combines OBS recordings with game knowledge to prepare narrated videos from an omniscient perspective. [Media capture and narration](../../../docs/developers/vox-agents/platform/media.md) is the developer overview.

Stage 1, Assemble, is implemented. Stages 2 through 5 are design proposals.

| Stage | Purpose | Status and reference |
| --- | --- | --- |
| 1. Assemble | Convert recorded segments into timed episodes with event counts and game metadata | Implemented: [Assemble](stage-1-assemble.md) |
| 2. Select | Choose episodes for the video | Proposed: [Select](stage-2-select.md) |
| 3. Script | Write narration using game knowledge | Proposed: [Script](stage-3-script.md) |
| 4. Voice | Synthesize speech | Proposed: [Voice](stage-4-voice.md) |
| 5. Video | Combine footage and narration | Proposed: [Video](stage-5-video.md) |

## Run assembly

From `vox-agents/`, run `npm run narrator -- --stage assemble --config <file> [--workspace <path>]`.

Relative config filenames resolve under `configs/`. The config supplies `gameID`, `recordingDir`, and `workspace`, with an optional `knowledgePath`. The CLI workspace option overrides the config value. Assembly writes `narrator-context.json` and `episodes.json` in that workspace.

## Shared contracts

- `NarratorWorkspace` in `workspace.ts` reads and writes assembly products and opens the knowledge database. Later stages are intended to communicate through workspace files so users can inspect or edit intermediate products.
- Episodes contain `turn`, `playerID`, `sourceFile`, `offset`, `duration`, and event counts. Timing uses source-file-relative milliseconds. Minor-civilization footage uses `playerID = -1` and may include a `worldCongress` summary.
- `types.ts` defines the implemented configuration and output contracts. Shared knowledge-database helpers live in `src/utils/telemetry/knowledge-db.ts`, relative to `vox-agents/`.

## Source map

| File                           | Responsibility                              |
| ------------------------------ | ------------------------------------------- |
| `console.ts`                   | Config loading, stage routing, and shutdown |
| `sessions/assemble-session.ts` | Assembly session and game-data enrichment   |
| `utils/episode-parser.ts`      | Segment parsing and video timing            |
| `utils/world-congress.ts`      | World Congress summaries                    |
| `workspace.ts`                 | Workspace files and database access         |
| `types.ts`                     | Config, segment, and episode types          |
