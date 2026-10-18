# Archivist

The archivist turns finished games into experience. It batch-processes an archive of completed game databases into a single DuckDB **episode database**, where each row is a snapshot of one player on one turn: its situation, metrics, and what happened next, indexed for similarity search.

That database is what lets the retrieval-augmented strategist (`simple-strategist-learned`, see [Strategists](strategists/overview.md)) ask "have I been in a situation like this before, and how did it turn out?"

The source lives in `src/archivist/`. From `vox-agents/`, run:

```bash
npm run archivist -- -a <archive-path> -o <output.duckdb>
```

See the [episode database reference](archivist-schema.md) for tables, metric scales, and feature vectors. The SQL schema is defined in `src/archivist/pipeline/writer.ts`.

## What an episode is

An **episode** is one player-turn: its identity, raw state, comparable metrics, feature vectors, and available [telepathist summaries](telepathist.md). The companion `game_outcomes` table stores the game's winner, victory type, and final turn. The [database reference](archivist-schema.md) explains the fields and their scales.

## The pipeline

Processing runs in three phases (`src/archivist/pipeline/`). It is resumable: already-processed players are skipped unless `--force` re-extracts them.

**Phase A, extract, transform, write** (no LLM). The scanner walks the archive directory, classifies each game's databases (knowledge, telemetry, and any existing telepathist database), and identifies which players were LLM-controlled. The extractor batch-reads each game's knowledge database into per-turn contexts and builds raw episodes per player. The transformer computes the derived metrics and vectors. The writer creates and fills the DuckDB tables.

**Phase B, landmark selection.** Retrieval doesn't search every episode. Per player, a greedy max-diversity selection marks roughly one episode in ten as a **landmark**: it seeds with the most atypical episode, then repeatedly adds the candidate least similar to those already chosen. This keeps the search space small while still spanning the variety of situations the player saw.

**Phase C, summaries and embeddings** (LLM). The pipeline generates missing telepathist summaries for landmarks and their future outcome turns, then embeds landmark situation abstracts with the configured embedding model. Existing summaries and embeddings are reused. `--skip-telepathist` and `--skip-embeddings` skip those steps for quick validation runs.

The console starts the DuckDB UI for inspection during and after processing (suppress with `--no-ui`). Other flags limit how many games to process, target a single game, or override the summarizer model.

## Retrieval

`findEpisodes()` (`src/archivist/retrieval/reader.ts`) answers a query describing a current situation in three steps:

1. **Score.** Pre-filter summarized landmarks by scalar attributes, then rank candidates by game-state and neighbor vector similarity, adding text similarity when the query provides a situation abstract. The scalar score only selects the initial pool.
2. **Diversify.** Select a varied result set, three episodes by default.
3. **Fetch outcomes.** Find summarized turns near horizons of 5, 10, 20, and 30 turns, allowing one turn either side. Missing horizons are omitted, each future turn is used once, and the furthest returned outcome hides its decision abstract. Results include metric deltas and the game's eventual victory result.

Two consumers sit on top:

- the learned strategist's `find-episodes` tool, which injects retrieved cases into the next decision's context;
- the telepathist family's `episode-retriever` agent, which lets a human browse the same results interactively.

## Working on the archivist

Three places cover most changes:

- `src/archivist/episode-db.ts` is the DuckDB access layer. It hands out the shared, cached database instance with a normalized path, so pipeline and retrieval consumers agree on which file they are talking to.
- `src/archivist/query-types.ts` defines the retrieval contract: the query a caller submits and the outcome snapshots and deltas it gets back. Changing what retrieval accepts or returns starts here.
- `src/archivist/utils/` holds the pure helpers the rest of the code composes: `game-data.ts` for parsing game records, `math.ts` for the numeric work, `vectors.ts` for building feature vectors, `similarity.ts` for scoring them, and `sql.ts` for DuckDB query construction. A new computed feature is usually a change to `vectors.ts` or `math.ts` plus the transformer in `src/archivist/pipeline/`.
