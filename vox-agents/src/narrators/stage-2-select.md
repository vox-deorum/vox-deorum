# Stage 2: Select — Choose Episodes for the Video

## Contract

### Config

```typescript
interface SelectConfig extends NarratorStageConfig {
  type: "narrator-select";
  selector: "revised-selector";
  targetDuration?: number; // e.g., 60000 for TikTok, 600000 for documentary
  prompts?: Record<string, string>; // keyed by phase: 'select', 'script', etc.
  batchSize?: number; // episodes per batch, default 50
}
```

### Input

- `workspace/episodes.json` (Episodes from Stage 1)

### Output: `workspace/selection.json`

```typescript
interface SelectionOutput {
  prompts: Record<string, string>; // passed through from config for downstream stages
  selectedDuration: number;
  episodes: SelectedEpisode[]; // all selected episodes (chronological order)
}

interface SelectedEpisode {
  turn: number;
  playerID: number;
  rationale?: string; // why this episode was selected
  trim?: { start: number; end: number }; // optional sub-trim
}
```

### LLM Required — multiple implementations possible

Selection is purely keep/skip with rationale. No ordering or arc — downstream stages handle narrative structure.

---

## Reference Implementation: Two-Pass Selector

### Approach

Two passes over the episode list. Pass 1 selects broadly in batches (generous, ~2x target duration). Pass 2 sees all candidates at once and prunes to the target duration with full narrative context.

### Pass 1: Broad Selection (batched)

```
for each batch of episodes (grouped by turn ranges, default 50 per batch):
  1. Prepare input:
     - Game overview (players, winner, total turns)
     - Target duration + select prompt (from config prompts)
     - This batch's episodes (turn, playerID, durationMs, eventCounts, hasWorldCongress)
     - Previous batches' candidates (so agent avoids redundancy)
     - Budget hint: ~2x target duration across all batches
  2. Call NarratorBroadSelector agent
  3. Collect candidate episodes
```

### Agent: NarratorBroadSelector

**Extends:** `VoxAgent<NarratorParameters, BroadSelectionInput, BroadSelectionOutput>`

**Properties:**

- `programmatic: true` — structured input/output only
- `maxSteps: 1` — single LLM call per batch
- No tools — all data in context

**Input (per batch):**

```typescript
interface BroadSelectionInput {
  gameOverview: {
    players: Selectable<PlayerInformation>[];
    winner?: { playerID: number; victoryType: string };
    totalTurns: number;
    totalEpisodes: number;
  };
  prompt?: string; // from config prompts['select']
  targetDuration: number; // final target — agent aims for ~2x this
  previousDuration: number; // from selected episodes
  previousCandidates: SelectedEpisode[]; // from prior batches
  batchBudget: number; // duration budget for this batch
  batchEpisodes: Episode[]; // this batch's episodes
}
```

**Output (per batch):**

```typescript
interface BroadSelectionOutput {
  candidates: SelectedEpisode[]; // generously selected
}
```

### Pass 2: Pruning

A single LLM call sees all candidates from Pass 1. With full visibility of the candidate pool and game overview, it prunes to the target duration and assigns final rationales. Loop until the duration is within an acceptable range.

### Agent: NarratorPruner

**Extends:** `VoxAgent<NarratorParameters, PruningInput, PruningOutput>`

**Properties:**

- `programmatic: true` — structured input/output only
- `maxSteps: 1` — single LLM call
- No tools — all data in context

**Input:**

```typescript
interface PruningInput {
  gameOverview: {
    players: Selectable<PlayerInformation>[];
    winner?: { playerID: number; victoryType: string };
    totalTurns: number;
  };
  prompt?: string; // from config prompts['select']
  targetDuration: number;
  currentDuration: number; // current duration as a hint
  candidates: SelectedEpisode[]; // all candidates from Pass 1
}
```

**Output:**

```typescript
interface PruningOutput {
  selected: SelectedEpisode[]; // final selection, within target duration
  skipped?: SkippedEpisode[]; // candidates that were cut, with reasons
}

interface SkippedEpisode {
  turn: number;
  playerID: number;
  reason: string;
}
```
