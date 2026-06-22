# vox-agents — Archivist

The archivist turns finished games into experience. It batch-processes an archive of completed game databases into a single DuckDB **episode database**, where each row is a snapshot of one player on one turn: its situation, metrics, and what happened next, indexed for similarity search.

That database is what lets the retrieval-augmented strategist (`simple-strategist-learned`, see [strategist.md](strategist.md)) ask "have I been in a situation like this before, and how did it turn out?"

The source lives in `src/archivist/`. The entry point is:

```bash
npm run archivist -- -a <archive-path> -o <output.duckdb>
```

In-source reference material — the full pipeline plan and the exact episode table schema — stays with the component in `src/archivist/plan.md` and `src/archivist/schema.md`.

## What an episode is

An **episode** is one player-turn. It records:

- **Identity** — game, turn, player, civilization, and whether the player ultimately won.
- **Raw state** — era, grand strategy, diplomatic standing, score, cities, yields, military.
- **Computed features** that make episodes comparable across games — shares of tourism/military/population normalized against the other players, per-population yield rates, gaps to the best rival, and victory-progress percentages.
- **Two numeric vectors** — one describing the player's own game state, one describing its neighbors.
- **Telepathist summaries**, where available — the [telepathist's](telepathist.md) situation and decision summaries, plus a text embedding of the situation abstract.

A companion `game_outcomes` table records each game's winner, victory type, and final turn, so retrieval can report how a situation resolved without running off the end of the game.

## The pipeline

Processing runs in three phases (`src/archivist/pipeline/`). It is resumable: already-processed players are skipped unless `--force` re-extracts them.

**Phase A — extract, transform, write** (no LLM). The scanner walks the archive directory, classifies each game's databases (knowledge, telemetry, and any existing telepathist database), and identifies which players were LLM-controlled. The extractor batch-reads each game's knowledge database into per-turn contexts and builds raw episodes per player. The transformer computes the derived metrics and vectors. The writer creates and fills the DuckDB tables.

**Phase B — landmark selection.** Retrieval doesn't search every episode. Per player, a greedy max-diversity selection marks roughly one episode in ten as a **landmark**: it seeds with the most atypical episode, then repeatedly adds the candidate least similar to those already chosen. This keeps the search space small while still spanning the variety of situations the player saw.

**Phase C — summaries and embeddings** (LLM). For landmarks and the future turns used to measure their outcomes, the pipeline generates telepathist turn summaries where they don't already exist (reusing the telepathist's preparation machinery) and embeds each situation abstract with the configured embedding model. Both steps are cached and idempotent. `--skip-telepathist` and `--skip-embeddings` cut them off for quick validation runs.

After a run, the console opens the DuckDB UI for inspection (suppress with `--no-ui`). Other flags limit how many games to process, target a single game, or override the summarizer model.

## Retrieval

`findEpisodes()` (`src/archivist/retrieval/reader.ts`) answers a query describing a current situation in three steps:

1. **Score** landmark episodes by fuzzy attribute proximity (era, civilization, grand strategy, diplomatic posture) combined with vector similarity (game-state and neighbor vectors, plus the situation embedding when the query provides text).
2. **Fetch outcomes** for each candidate — snapshots at horizons of roughly 5 to 30 turns later, capped at the game's final turn, with the deltas in shares and per-population rates and the eventual victory result.
3. **Diversify** with a final pass, so the returned cases aren't five copies of the same story.

Two consumers sit on top:

- the learned strategist's `find-episodes` tool, which injects retrieved cases into the next decision's context;
- the telepathist family's `episode-retriever` agent, which lets a human browse the same results interactively.
