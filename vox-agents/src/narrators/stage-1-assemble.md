# Stage 1: Assemble

Assembly converts `segments.jsonl` and a game's knowledge database into an episode manifest. It runs without an LLM. The implementation is `sessions/assemble-session.ts`; `types.ts` defines the configuration and output types.

## Inputs and outputs

| Input | Requirement |
| --- | --- |
| `gameID` | Game identifier |
| `recordingDir` | Directory containing `segments.jsonl` and recordings |
| `workspace` | Output directory |
| `knowledgePath` | Optional knowledge SQLite path; otherwise the newest matching database in an experiment folder under `mcp-server/archive/` |

See [Run assembly](overview.md#run-assembly) for the CLI command.

| Output in the workspace | Contents |
| --- | --- |
| `narrator-context.json` | Game ID and resolved absolute knowledge and recording paths |
| `episodes.json` | Game ID, maximum episode turn, players, strategist/model labels, optional winner, and episodes |

Each episode contains a turn, player ID, source video filename, offset, duration, and sparse event counts. Offsets and durations use milliseconds relative to the source video. Minor-civilization footage uses player ID -1 and may carry a World Congress summary. Multiple video chunks can belong to the same player and turn.

## Assembly sequence

1. Create the workspace, require `segments.jsonl`, resolve the knowledge path, and write the shared context.
2. Open the knowledge database read-only and load player information.
3. Parse complete recording segments and split them at player switches.
4. Count visible game events for each major player's turn. Minor-civilization episodes keep empty event counts and may receive World Congress information from victory progress and resolution events.
5. Read the winner and player assignments, compute the maximum episode turn, and write the manifest.

Shared database access and metadata helpers live in `src/utils/telemetry/knowledge-db.ts`, relative to `vox-agents/`.

## Segment parsing

`utils/episode-parser.ts` recognizes a start, zero or more switches, and a stop carrying a source filename. A new start discards an unfinished segment and begins another. Orphaned switches or stops, unparseable entries, and incomplete segments are skipped with warnings.

Each start or switch begins an episode. Its offset is the boundary timestamp minus the segment start; its duration ends at the next switch or stop. Negative durations are clamped to zero. Wall-clock timestamps are absent from the output episodes.

For example, a segment with a switch 5 seconds after its start and a stop at 20 seconds produces two episodes: offset 0 and duration 5,000; then offset 5,000 and duration 15,000.

## Game-data enrichment

The session batch-reads events for the episode turns. Event counts use each major player's visibility flags and retain raw event types. Minor players are identified from `PlayerInformations.IsMajor`.

`utils/world-congress.ts` formats diplomatic victory progress and resolution results for minor-player episodes when data is available. Player labels combine the registered strategist's display name and recorded model; players without a strategist assignment default to Vox Populi AI. These fields give proposed later stages enough context to select and describe footage.
