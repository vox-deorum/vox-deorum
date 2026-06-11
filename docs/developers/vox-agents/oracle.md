# vox-agents — Oracle

The Oracle answers counterfactual questions: *what would the AI have decided on that turn if the prompt had been different, or the model had been someone else?* Given a CSV of real game turns, it re-runs each turn's original LLM call — extracted verbatim from recorded telemetry — with whatever modifications an experiment specifies, and records what the model decides this time. Nothing touches a live game: the replayed model is given **schema-only tools**, so it produces tool-call intents that are captured as decisions but never executed.

The source lives in `src/oracle/`; experiments run with `npm run oracle -- -c <experiment.js>`.

## Two phases

Oracle deliberately splits its work:

- The **retrieve phase** reads the input CSV, locates each row's telemetry database (scanning the telemetry directory for `{gameId}-player-{playerId}.db`), and extracts the raw original prompt — system messages, conversation history, active tool names, and the original model — exactly as recorded (`src/oracle/retriever.ts`). No LLM is involved, and nothing is modified; the extracted rows can be saved as JSON for inspection.
- The **replay phase** takes those rows, applies the experiment's `modifyPrompt` transformation, runs each through the chosen model via a dedicated `OracleAgent`, and writes the outcomes: a results CSV (one row per source row per model, with the replayed decision's rationale and token usage), JSON and markdown "trail" files reconstructing each conversation, and a telemetry database of the replay itself (`src/oracle/replayer.ts`).

Running without flags does both in sequence; `--retrieve` and `--replay` run one side alone. The split is what makes iteration cheap: extract once, inspect that the right turns were found, then replay the same retrieved data repeatedly under different prompts or models without re-reading telemetry — experiments can even share a retrieval via a common `retrievalName`.

Finding "the right turn" is validated by **rationale matching**: each CSV row carries a fragment of the original decision rationale, and the extractor fuzzy-matches it against the recorded tool calls, falling back to the previous turn (with a warning) when a turn's record doesn't match — botched and re-run turns make turn numbers alone unreliable.

## Experiments

An experiment is an ES module exporting an `OracleConfig` (see `src/oracle/types.ts` for the exact shape, and `vox-agents/experiments/` for examples). Beyond the required CSV path and experiment name, the interesting knobs are callbacks:

- **`modifyPrompt`** is the heart of the experiment: it receives the original system prompts, messages, active tools, model, and CSV row, and returns whichever of those it wants to override — rewrite one sentence of the system prompt, drop a briefing, hide a tool. Omitted fields keep their originals.
- **`modelOverride`** redirects the replay to a different model — or to an *array* of models, in which case each row is replayed once per entry for side-by-side comparison; duplicating a model in the array repeats the sample, with results distinguished by a repetition index.
- **`rewriteToolSchemas`** rewrites the tool descriptions and schemas the model sees (useful for terminology experiments), `filter` narrows which CSV rows run, and `extractColumns` pulls experiment-specific values out of each replay into extra CSV columns.

Replays run with bounded concurrency, reuse existing trail files to skip already-completed rows, and can route through provider batch APIs for large experiments (`src/oracle/batch/`).

## Where things land

Outputs default under `temp/oracle/`: the per-experiment results CSV next to a directory of retrieved JSONs and replay trails, plus an OpenTelemetry database under `telemetry/oracle/` — which means a replayed experiment can itself be inspected with the telemetry browser like any live run. CLI flags override the output and telemetry directories and the target agent; bare experiment filenames resolve to `experiments/`.

The Oracle reads the same telemetry the [telepathist](telepathist.md) reads — one explains what happened, the other explores what could have happened instead.
