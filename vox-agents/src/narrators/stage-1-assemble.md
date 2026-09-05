# Stage 1: Assemble — Build Episode Manifest

## Contract

### Config

```typescript
interface AssembleConfig extends NarratorStageConfig {
  type: "narrator-assemble";
  gameID: string;
  recordingDir: string; // path to <gameID>/ with segments.jsonl + videos
  knowledgePath?: string; // path to game's knowledge + telemetry SQLite DB - if empty, search for mcp-server/archive for the knowledge DB path. other paths are calculated as derivatives (see archivists).
}
```

### Input

- `segments.jsonl` from `recordingDir`
- Knowledge DB at `knowledgeDbPath` (GameEvents, RenderEvents, PlayerInformations, GameMetadata)

### Output

**`workspace/narrator-context.json`** — shared game context for all later stages:

```typescript
interface NarratorContext {
  gameID: string;
  knowledgePath: string; // resolved absolute path
  recordingDir: string; // resolved absolute path
}
```

**`workspace/episodes.json`** — episode manifest:

```typescript
import type { Selectable } from "kysely";
import type { PlayerInformation } from "mcp-server/dist/knowledge/schema/public.js";

interface Episodes {
  gameID: string;
  totalTurns: number;
  players: Selectable<PlayerInformation>[]; // reuse existing type
  playerTypes: Record<number, string>; // playerID -> friendly label (e.g., "Staffed LLM Strategist (deepseek-r1)")
  winner?: { playerID: number; victoryType: string };
  episodes: Episode[];
}

interface Episode {
  // Identity — (turn, playerID) uniquely identifies an episode
  turn: number;
  playerID: number; // whose UI is visible; -1 for minor civ episodes

  // Video reference (all times are source-file-relative milliseconds)
  sourceFile: string; // OBS output filename (from stop.file)
  offset: number; // offset from start of source video file
  duration: number; // length of this episode within the source file

  // Event counts for the CURRENT player in this turn only
  // Sparse map: only types with count > 0
  eventCounts: Record<string, number>;

  // Pre-formatted World Congress summary (only on minor civ episodes, playerID = -1).
  // Built from VictoryProgress.DiplomaticVictory + ResolutionResult GameEvents.
  // String format includes: status, votes needed, delegates by civ, active resolutions,
  // proposals, and voting results. Stage 2 reads this directly — no archivist loop needed.
  worldCongress?: string;
}
```

After this stage, **no wall-clock timestamps exist** in the pipeline. All downstream stages work with source-file-relative offsets and durations.

### No LLM — single implementation

---

## Implementation

### Shared Utilities with Archivist

The archivist pipeline already has reusable DB access utilities. Extract/share these rather than reimplementing:

| Utility | Current Location | What It Does |
| --- | --- | --- |
| `openReadonlyGameDb()` | `archivist/pipeline/scanner.ts` | Opens knowledge SQLite with Kysely + ParseJSONResultsPlugin |
| `extractTurnContexts()` | `archivist/pipeline/extractor.ts` | Batch-queries PlayerSummaries, CityInformations, VictoryProgress, PlayerInformations per turn |
| `PlayerInformation` query pattern | `archivist/pipeline/extractor.ts:48-58` | Queries `PlayerInformations` table, builds `Map<number, Selectable<PlayerInformation>>` |
| `GameMetadata` query pattern | `archivist/console.ts:119-124` | Queries `victoryPlayerID` and `victoryType` from key-value store |

**Refactoring plan:** Move `openReadonlyGameDb()` and the `PlayerInformations` / `GameMetadata` query patterns into a shared location (e.g., `archivist/utils/` or a new `narrator/utils/` that imports from archivist). The narrator doesn't need `extractTurnContexts()` at this stage (that's for Stage 3), but may reuse it later.

### Episode Decomposition Algorithm

1. **Parse segments.jsonl** into segment groups
   - Read line by line, group entries into segments: `start -> [switch...] -> stop`
   - **Discard malformed segments** — any sequence that doesn't follow the valid pattern (e.g., `start, start, switch, stop`) is dropped with a warning
   - Record each segment's `start.at` as the wall-clock anchor for offset computation

2. **Split each segment into episodes** at switch boundaries, converting to source-file-relative times
   - First episode: offsetMs = 0, ends at first `switch.at - start.at` or `stop.at - start.at`
   - Subsequent episodes: offsetMs = `switch.at - start.at`, ends at next switch or stop
   - duration = endOffset - offset
   - sourceFile = segment's `stop.file`
   - **Minor civ detection:** The `segments.jsonl` already contains `isMinorCiv` in RenderEvent payloads forwarded via ProductionController. If the entry's playerID maps to a minor civ (cross-reference `PlayerInformations.IsMajor`), set episode `playerID = -1`

3. **Build eventCounts** for each episode
   - Batch-query all `GameEvents` for the relevant turns in a single query
   - For each event, increment counters for every player whose `Player{N} >= 1` visibility flag is set (use `MaxMajorCivs` for the loop bound)
   - Count by event `Type` -> `Record<string, number>`
   - For minor civ episodes (playerID = -1): eventCounts stays empty

4. **Build worldCongress strings** for minor civ episodes
   - For each turn that has at least one minor civ episode, query `VictoryProgress` (Key=0, latest version per turn) and read `DiplomaticVictory`
   - Combine with `ResolutionResult` events for that turn (already collected during step 3)
   - Format into a concise multi-line string: status, votes needed, delegates, active resolutions, proposals, voting results
   - Skip if there's no diplomatic data and no voting results

5. **Extract game metadata** (reuse archivist patterns)
   - `openReadonlyGameDb(knowledgeDbPath)` — shared with archivist
   - Query `PlayerInformations` -> players array (same pattern as `archivist/pipeline/extractor.ts:48-58`)
   - Query `GameMetadata` for `victoryPlayerID` and `victoryType` -> winner (same pattern as `archivist/console.ts:119-124`)
   - Compute totalTurns from max turn in episodes

6. **Extract player types** from GameMetadata + agent registry
   - For each major player in `PlayerInformations`:
     - Query `GameMetadata` for `strategist-{playerID}` and `model-{playerID}`
     - Look up the strategist's `displayName` via `agentRegistry.get(strategistName)` cast to `Strategist`
     - If model exists and model ≠ `"VPAI"`: label = `"{displayName} ({model})"`
     - Otherwise: label = displayName alone
     - If no strategist entry: default to `"Vox Populi AI"`
   - Store as `playerTypes: Record<number, string>`

### Wall-Clock to File-Relative Conversion

The `segments.jsonl` `at` timestamps are wall-clock (Date.now()). This stage converts them:

```
segment start.at = 1700000000000  (wall-clock anchor)
switch.at        = 1700000005000
stop.at          = 1700000020000

Episode 1: offset = 0,    duration = 5000
Episode 2: offset = 5000, duration = 15000
```

After conversion, wall-clock timestamps are discarded. All downstream stages see only `(sourceFile, offsetMs, durationMs)`.

### Minor Civ Episodes

When a minor civ's UI appears on screen (the game cycles through all players including city-states), it creates an episode with `playerID = -1`. These episodes:

- Have empty `eventCounts` (no player-specific events to count)
- May carry a `worldCongress` string if congress is active or had voting results that turn
- Are typically short (a few seconds of city-state UI)
- Can be selected by Stage 2 if they contain World Congress activity — Stage 2 reads the pre-formatted string directly, no archivist loop needed

### Event Counting

Events are counted per-type for the episode's player only. Produces a sparse map like:

```json
{ "DeclareWar": 1, "CityCaptureComplete": 2, "TeamTechResearched": 1 }
```

No significance classification or filtering — raw counts give the selection agent maximum signal.
