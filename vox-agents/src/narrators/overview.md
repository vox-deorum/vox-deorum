# Narrator Agent System

## What This Is

A batch pipeline that takes recorded Civ 5 gameplay video (from ProductionController/OBS) and the game's knowledge database, and produces narrated video content — from short TikTok-style clips to full-game documentaries.

**Perspective:** Omniscient narrator. Sees all players, all events.

**Not Telepathist:** Telepathist generates per-player, single-perspective summaries. The narrator generates its own omniscient narrative from raw game data.

## Pipeline

Five stages, each independently runnable. Pause between any two stages to manually edit intermediate products.

```
segments.jsonl ──> [1: Assemble] ──> episodes.json
                                         |
                                    [2: Select]  ──> selection.json
                                         |
                   knowledge DB ──> [3: Script]  ──> scripts.json
                                         |
                                    [4: Voice]   ──> audio/*.mp3
                                         |
                   source videos ──> [5: Video]  ──> output/final.mp4
```

| Stage | What | LLM? | Implementations | Detail |
|-------|------|------|-----------------|--------|
| 1 | Assemble episodes from recordings | No | Single | [stage-1-assemble.md](stage-1-assemble.md) |
| 2 | Select which episodes to keep | Yes | Multiple possible | [stage-2-select.md](stage-2-select.md) |
| 3 | Write narration scripts | Yes | Multiple possible | [stage-3-script.md](stage-3-script.md) |
| 4 | Generate TTS audio | No | Single (pluggable provider) | [stage-4-voice.md](stage-4-voice.md) |
| 5 | Stitch final video | No | Single | [stage-5-video.md](stage-5-video.md) |

## Architecture

### Per-Stage VoxSession

Each stage is its own `VoxSession` subclass with its own config type. This means:
- The webui manages narrator stages uniformly alongside strategist sessions
- Each stage can run independently via CLI
- No shared in-memory state — stages communicate via workspace files

```typescript
interface NarratorStageConfig extends SessionConfig {
  type: NarratorStageType;
  workspace: string;
}

type NarratorStageType =
  | 'narrator-assemble'
  | 'narrator-select'
  | 'narrator-script'
  | 'narrator-voice'
  | 'narrator-video';
```

`SessionConfig.type` extended to `SessionType` union in `types/config.ts`.

### Workspace-Managed Shared Context

Game-level parameters (`gameID`, `knowledgePath`, `recordingDir`) live in `narrator-context.json`, written by Stage 1 and read by all later stages. This avoids duplicating these values across per-stage configs.

```typescript
interface NarratorContext {
  gameID: string;
  knowledgePath: string;   // resolved absolute path
  recordingDir: string;    // resolved absolute path
}
```

The `NarratorWorkspace` class (in `workspace.ts`) manages context, DB access, and stage I/O:
- `writeContext()` / `getContext()` — shared game context
- `openGameDb()` — opens knowledge DB from stored context
- `writeEpisodes()` / `readEpisodes()` — Stage 1 I/O
- Future: `writeSelection()` / `readSelection()`, etc.

### CLI

```
npm run narrator -- --workspace <path> --stage <name> --config <file>
```

### Workspace

```
workspace/
├── narrator-context.json    # shared game context (gameID, knowledgePath, recordingDir)
├── episodes.json             # Stage 1
├── selection.json            # Stage 2
├── scripts.json              # Stage 3
├── narrator-episodes.duckdb  # Stage 3 cached extractions
├── audio/
│   ├── manifest.json
│   └── t42-p3.mp3 ...
└── output/
    └── final.mp4
```

## Key Data Model

### Episode identity

`(turn, playerID)` — stable across re-runs. `playerID = -1` for minor civ episodes.

### Episode timing

All times are **source-file-relative milliseconds** after Stage 1. No wall-clock timestamps in the pipeline. All durations across the entire pipeline are milliseconds with no unit suffix. Each episode has `sourceFile`, `offset`, `duration`.

### Event signal

Each episode carries `eventCounts: Record<string, number>` — raw GameEvent type counts for the current player only. No predefined tag vocabulary. Minor civ episodes with World Congress get `hasWorldCongress: true`.

### Knowledge DB

The knowledge DB remains queryable throughout. Stage 1 resolves the path and writes it to `narrator-context.json`. Later stages access it via `workspace.openGameDb()`. If not provided in config, Stage 1 searches `mcp-server/data` and `mcp-server/archive`.

### Reused types

- `PlayerInformation` from `mcp-server/src/knowledge/schema/public.ts`
- DB access via `openReadonlyGameDb()` from archivist (extract to shared location)

## Design Principles

1. **File-based intermediates.** JSON on disk. Human-editable. Re-runnable.
2. **Lightweight manifest.** Stage 1 stores video refs + event counts only. No game data duplication.
3. **DB stays queryable.** Later stages pull detailed context directly rather than relying on pre-extracted snapshots.
4. **Alternative implementations.** LLM stages (2, 3) can have multiple agent implementations, like strategists.
5. **Shared archivist utilities.** Reuse `openReadonlyGameDb()`, PlayerInformations queries, GameMetadata queries.
6. **Abstract TTS.** `TTSProvider` interface, concrete provider chosen via config.
7. **ffmpeg for video.** Start with concat demuxer, upgrade to filter_complex for crossfades/subtitles later.

## Source File Layout

```
vox-agents/src/narrators/
├── console.ts                    # CLI entry point (TODO)
├── workspace.ts                  # NarratorWorkspace — context, DB access, stage I/O
├── types.ts                      # Shared types, configs, NarratorContext
├── sessions/
│   ├── assemble-session.ts       # Stage 1 ✓
│   ├── select-session.ts         # Stage 2
│   ├── script-session.ts         # Stage 3
│   ├── voice-session.ts          # Stage 4
│   └── video-session.ts          # Stage 5
├── agents/
│   ├── narrator-selector.ts      # Reference impl for Stage 2
│   ├── narrator-outliner.ts      # Reference impl for Stage 3a
│   └── narrator-scripter.ts      # Reference impl for Stage 3b
├── tts/
│   └── provider.ts               # TTSProvider interface
└── utils/
    └── episode-parser.ts         # segments.jsonl parsing ✓
```

## Key Dependencies

- `vox-agents/src/infra/vox-session.ts` — base session class
- `vox-agents/src/infra/vox-agent.ts` — base agent class
- `vox-agents/src/infra/vox-context.ts` — agent execution runtime
- `vox-agents/src/infra/production-controller.ts` — produces segments.jsonl
- `vox-agents/src/types/config.ts` — session config types (extend `type` union)
- `vox-agents/src/archivist/pipeline/scanner.ts` — `openReadonlyGameDb()` to share
- `vox-agents/src/archivist/pipeline/extractor.ts` — query patterns to share
- `mcp-server/src/knowledge/schema/` — RenderEvent, PlayerInformation, ResolutionResult types
