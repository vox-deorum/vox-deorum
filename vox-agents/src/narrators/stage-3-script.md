# Stage 3: Script — Generate Narration Scripts

## Contract

### Config

```typescript
interface ScriptConfig extends NarratorStageConfig {
  type: "narrator-script";
  writer: "chapter-writer";
}
```

### Input

- `workspace/selection.json` (SelectionOutput from Stage 2)
- `workspace/episodes.json` (Episodes from Stage 1)
- Knowledge DB via `workspace.openGameDb()` (path stored in `narrator-context.json`)
- Telemetry DBs (per LLM player, if available — derived from knowledgePath)

### Output: `workspace/scripts.json`

```typescript
interface ScriptsOutput {
  arc: ArcOutline;
  scripts: ScriptedEpisode[]; // in presentation order
}

interface ArcOutline {
  hook: string; // opening concept — how the video begins
  throughline: string; // central narrative thread
  tone: string; // overall tone (epic, analytical, dramatic, etc.)
  arcShape: string; // narrative shape (e.g., "rise and fall", "underdog victory")
  closer: string; // ending concept — how the video concludes
  chapters: Chapter[]; // ordered for presentation
}

interface Chapter {
  title: string; // chapter label (e.g., "The Ancient World", "Rome's Gambit")
  theme: string; // what this chapter explores narratively
  role: string; // structural role: setup / rising action / turning point / climax / denouement
  emotionalArc: string; // how mood shifts within this chapter
  keyTension: string; // what drives viewer interest in this chapter
  fromTurn: number; // boundary (inclusive)
  toTurn: number; // boundary (inclusive)
}

interface ScriptedEpisode {
  turn: number;
  playerID: number;
  script: string; // the narration text
  wordCount: number;
  durationLimit: number; // how long can the script be
}
```

### LLM Required — multiple implementations possible

This is the most creative stage. It determines chapter structure, episode ordering, and writes narration text.

---

## Step 0: Adapted Archivist Pipeline (prerequisite)

Before LLM phases, the stage runner extracts and summarizes game data for each selected episode using the archivist pipeline. Output is cached in `workspace/narrator-episodes.duckdb` — re-runs skip episodes that already have summaries.

### 0a: Extraction (no LLM)

Reuse the archivist's extraction functions for each selected `(turn, playerID)`:

- `extractTurnContexts(gameDb)` — batch-queries PlayerSummaries, CityInfo, VictoryProgress
- `extractPlayerEpisodes(gameDb, telepathistDbPath, playerId, ..., agentTurns)` — builds `RawEpisode` per turn

Adaptations:

- `agentTurns` = null for non-LLM players (all turns eligible)
- `telepathistDbPath` = null for non-LLM players
- Only extract turns present in `selection.json`

Write extracted episodes to `workspace/narrator-episodes.duckdb` via `EpisodeWriter`.

### 0b: Summarization (LLM, cached)

All summarization happens through the telepathist/summarizer pipeline. Events and rendered events are included as input and extracted as separate output sections.

**For LLM players with telemetry DBs:** Call `prepareTelepathist()` which uses `GetSituationTool`/`GetDecisionTool` to reconstruct game state from telemetry spans (events are included via `GetSituationTool`'s `events` category). Summarizer input is augmented with RenderedEvents queried from the game DB.

**For non-LLM players:** Adapted summarization that formats knowledge DB data (PlayerSummaries, GameEvents, CityInfo) + RenderedEvents directly as text and feeds to the Summarizer. Same instruction template, same output format.

**RenderedEvents** always come from the game DB (not telemetry):

```sql
SELECT * FROM RenderEvents WHERE Turn = ? AND Event = 'AnimationStarted'
```

Filtered by `payload.playerID`. These capture what the viewer sees on screen (unit movements, battles, constructions, etc.).

RenderedEvents are **not** LLM-summarized. Each row has a short `description` field; aggregate them programmatically grouped by `nearestCity`:

```
At Utique, Carthage Bomber (92->60/100 HP) attacks Portugal Destroyer (837->701/850 HP). ...
At Carthage, Carthage completes National College.
```

### Schema Extensions (backward-compatible)

**`RawEpisode`** gains new text summary fields alongside existing `situation`/`decisions`/etc.:

```typescript
events: string | null; // narrative summary of game events this turn
eventsAbstract: string | null; // context-agnostic compressed events summary
renderedEvents: string | null; // programmatic aggregation of animation descriptions (not LLM-generated)
```

**`TurnSummaryRecord`** gains matching fields (nullable for backward-compat with existing telepathist DBs).

**Summarizer instruction** extended with four new optional sections, used by narrators only:

```markdown
# Events

A narrative summary of game events that occurred during this turn. Describe what happened: wars declared, cities captured, technologies discovered, diplomatic agreements, policy adoptions. Focus on narratively significant events.

# EventsAbstract

A context-agnostic, one-paragraph summary of the Events.

- ALWAYS keep civilization names.
- Replace concrete city/city-state names with generic descriptions.

<!-- RenderedEvents are aggregated programmatically, not by the summarizer -->
```

Existing archivist callers: if no event/render data in input, new sections are empty. Backward-compatible.

### Available Data Per Episode After Step 0

| Field | Source | Available For |
| --- | --- | --- |
| `situation` | Summarizer | LLM players (from telemetry); non-LLM (from knowledge DB) |
| `situationAbstract` | Summarizer | All |
| `decisions` | Summarizer | LLM players (from telemetry); null for non-LLM |
| `decisionAbstract` | Summarizer | LLM players; null for non-LLM |
| `narrative` | Summarizer | All |
| `events` | Summarizer | All (from telemetry spans or knowledge DB GameEvents) |
| `eventsAbstract` | Summarizer | All |
| `renderedEvents` | Programmatic | All (aggregated descriptions from game DB RenderEvents) |
| Numeric stats | Extraction | All (score, cities, military, etc.) |

---

## Reference Implementation: Chapter-Based Arc + Draft/Revise

Four-phase process: arc planning → parallel drafts → arc revision → sequential script revision.

### Phase 1: Arc Planning

**Agent:** `NarratorArcPlanner`

**Extends:** `VoxAgent` — programmatic, maxSteps: 1, no tools.

**Input (adaptive):** All selected episodes' summaries from the episode DB. The detail level adapts to episode count:

- **Few episodes** (≤15 or fits in ~50K tokens): full `situation` + `events` + `renderedEvents` + `decisions` + `narrative`
- **Many episodes**: `narrative`

Plus: game overview (players, winner, total turns), video format config, optional user prompt from `config.prompts['script']`.

**What it decides:**

- Overall narrative structure: hook, throughline, tone, arc shape, closer
- Chapter boundaries (turn ranges) and chapter-level narrative metadata

**Output:** `ArcOutline` with `chapters[]`. No per-episode beats — chapters define boundaries and episodes within chapters follow chronological order (by turn, then playerID for same-turn episodes).

This is one LLM call with all episodes. The chapter structure ensures the arc planner scales regardless of episode count.

### Phase 2: Parallel Draft Scripting

**Agent:** `NarratorDrafter`

**Extends:** `VoxAgent` — programmatic, maxSteps: 1, no tools.

Executed **in parallel** across all selected episodes. Each call receives:

- The arc outline (throughline, tone, arcShape)
- This episode's chapter context (title, theme, role, emotionalArc, keyTension)
- Full summaries from DB: `situation`, `events`, `renderedEvents`, `decisions`, `narrative`
- Word budget: `duration / 1000 * 2.5` words

**Output:** `DraftScript` per episode.

**Efficiency:** N parallel LLM calls. No inter-episode dependencies at this stage.

### Phase 3: Arc Revision

**Agent:** `NarratorArcReviser`

**Extends:** `VoxAgent` — programmatic, maxSteps: 1, no tools.

After seeing all draft scripts, revise the arc. May adjust chapter boundaries, refine themes, reorder chapters based on how the actual scripts turned out.

**Input:** All draft scripts + original arc outline.

**Output:** Revised `ArcOutline` (same type).

This is one LLM call.

### Phase 4: Sequential Script Revision

**Agent:** `NarratorScripter`

**Extends:** `VoxAgent` — programmatic, maxSteps: 1, no tools.

Executed **sequentially** in revised presentation order (chapters in arc order, episodes within chapters chronologically). Each call receives:

- The revised arc outline
- This episode's chapter context
- This episode's draft script (from Phase 2)
- This episode's full summaries from DB
- The previous episode's final script (rolling window of 1, for transition continuity)
- Word budget (from `durationLimit` subtracted by 2 seconds)
- **Length adjustment prompt** (conditional — see below)

**Length adjustment:** Compare draft word count to word budget (`durationLimit / 1000 * 2.5`). If the ratio deviates significantly (>15%), inject a targeted instruction:

- **Draft too long** (ratio > 1.15): "Your draft is ~N words over budget. Cut filler, merge redundant sentences, and drop the least essential details. Prioritize narrative impact per word."
- **Draft too short** (ratio < 0.85): "Your draft is ~N words under budget. Expand on key moments — add atmosphere, player motivations, or strategic context. Don't pad; deepen."
- **Within range**: "Keep your revision with roughly the same length as before."

This keeps the reviser focused on content quality by default, only adding length pressure when the draft actually needs it.

**Output:** Final `ScriptedEpisode`.

**Efficiency:** Phase 1 = 1 call. Phase 2 = N parallel. Phase 3 = 1 call. Phase 4 = N sequential. Total = 2 + 2N calls.

---

## Alternative Implementation Ideas

- **Skip Phase 3 (arc revision):** For short videos (3-5 episodes), the initial arc may be sufficient. Skip revision and go directly from drafts to sequential revision for coherence only. Total = 1 + 2N calls.
- **Iterative revision:** Repeat Phase 3→4 multiple times, using each iteration's output as input to the next, converging on quality. Diminishing returns after 2 iterations.
- **Style-specialized writers:** Different agent classes for TikTok vs documentary, with tailored prompts rather than parameterized style instructions.

---

## Reusable Infrastructure

| What | From | Used For |
| --- | --- | --- |
| `extractTurnContexts()` | `archivist/pipeline/extractor.ts` | Batch query knowledge DB |
| `extractPlayerEpisodes()` | `archivist/pipeline/extractor.ts` | Build RawEpisode from turn context |
| `transformEpisode()` | `archivist/pipeline/transformer.ts` | Compute derived fields |
| `EpisodeWriter` | `archivist/pipeline/writer.ts` | Write to DuckDB |
| `prepareTelepathist()` | `archivist/pipeline/telepathist-prep.ts` | Summarize LLM player turns |
| `Summarizer` agent | `telepathist/summarizer.ts` | Summarize non-LLM player turns |
| `buildTurnSummaryInstruction()` | `telepathist/preparation/instructions.ts` | Instruction template (extended) |
| `parseSummaryMarkdown()` | `telepathist/preparation/instructions.ts` | Parse structured summary output |
| `loadTurnSummaries()` | `archivist/pipeline/extractor.ts` | Import existing telepathist summaries |
| `openReadonlyGameDb()` | `archivist/pipeline/scanner.ts` | Open knowledge DB |
| Game data utils | `archivist/utils/game-data.ts` | `parseDiplomatics()`, `extractAllVictoryProgress()`, etc. |
