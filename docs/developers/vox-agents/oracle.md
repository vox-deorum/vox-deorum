# vox-agents — Oracle

The Oracle answers counterfactual questions: *what would the AI have decided on that turn if the prompt had been different, or the model had been someone else?*

Given a CSV of real game turns, it re-runs each turn's original LLM call — extracted verbatim from recorded telemetry — with whatever modifications an experiment specifies, then records what the model decides this time. Nothing touches a live game. The replayed model is given **schema-only tools**, so it produces tool-call intents that are captured as decisions but never executed.

The source lives in `src/oracle/`. Run experiments with:

```bash
npm run oracle -- -c <experiment.js>
```

## Two phases

Oracle deliberately splits its work into a retrieve phase and a replay phase.

**Retrieve** (`src/oracle/retriever.ts`) reads the input CSV, locates each row's telemetry database (scanning the telemetry directory for `{gameId}-player-{playerId}.db`), and extracts the raw original prompt — system messages, conversation history, active tool names, the original model, and the recorded tool framing (see *Tool framing*) — exactly as recorded. No LLM is involved and nothing is modified. The extracted rows can be saved as JSON for inspection.

**Replay** (`src/oracle/replayer.ts`) takes those rows, applies the experiment's `modifyPrompt` transformation, and runs each through the chosen model via a dedicated `OracleAgent`. It writes:

- a results CSV (one row per source row per model, with the replayed decision's rationale and token usage);
- JSON and markdown "trail" files reconstructing each conversation;
- a telemetry database of the replay itself.

Running without flags does both phases in sequence. `--retrieve` and `--replay` run one side alone.

The split is what makes iteration cheap. Extract once, confirm the right turns were found, then replay the same retrieved data repeatedly under different prompts or models without re-reading telemetry. Experiments can even share a retrieval through a common `retrievalName`.

### Finding the right turn

Turn numbers alone are unreliable, because botched and re-run turns reuse them. The Oracle validates its target with **rationale matching**: each CSV row carries a fragment of the original decision rationale, and the extractor fuzzy-matches it against the recorded tool calls. When a turn's record doesn't match, it falls back to the previous turn and emits a warning.

## Experiments

An experiment is an ES module exporting an `OracleConfig`. See `src/oracle/types.ts` for the exact shape and `vox-agents/experiments/` for examples. Beyond the required CSV path and experiment name, the interesting knobs are callbacks:

- **`modifyPrompt`** is the heart of the experiment. It receives the original system prompts, messages, active tools, model, and CSV row, and returns whichever of those it wants to override — rewrite one sentence of the system prompt, drop a briefing, hide a tool. Omitted fields keep their originals. It also carries the original turn's recorded `framing` (see *Tool framing* below).
- **`modelOverride`** redirects the replay to a different model, or to an *array* of models. With an array, each row is replayed once per entry for side-by-side comparison. Duplicating a model in the array repeats the sample, with results distinguished by a repetition index. Its third argument exposes the original turn's `{ framing }`, so an experiment can return a model with `options.framing` set to reproduce the source framing (see *Tool framing*).
- **`rewriteToolSchemas`** rewrites the tool descriptions and schemas the model sees, useful for terminology experiments.
- **`filter`** narrows which CSV rows run.
- **`extractColumns`** pulls experiment-specific values out of each replay into extra CSV columns.

Replays run with bounded concurrency, reuse existing trail files to skip already-completed rows, and can route through provider batch APIs for large experiments (`src/oracle/batch/`). The batch path serializes the request directly to the provider and does **not** run the tool-rescue middleware, so it is incompatible with prompt-mode models (`options.toolMiddleware: 'prompt'`) — replaying one under `batch` throws rather than silently sending native tools. Override to a native tool-calling model or drop batch mode for those rows.

### Tool framing

Prompt-mode models don't call tools natively; the tool-rescue middleware strips native tools and injects a JSON tool-call protocol as a system message. For claude-code models that protocol — and the agent's own system prose — is reframed from "tool" to "action" (its CLI persona reasons in terms of actions, and it keeps the game tools from reading as the CLI's native tools). Each replayed turn records the resolved framing as telemetry: `step.tool_framing` (`'tool'` or `'action'`). The injected protocol block itself is deliberately **not** recorded — replay reconstructs it from the replay model's own framing, so there is nothing stored to drift out of sync.

Retrieve surfaces this on every row as `framing`. It is **informational** — replay framing derives solely from the replay model, so a prompt-mode model replaying a claude-code turn is told "tools", not "actions". To reproduce the original view deliberately, either return a model with `options.framing` set from `modelOverride`, or apply the exported `reframeToolWording` helper to the system prompt inside `modifyPrompt`. `framing` is `undefined` for turns that predate the telemetry, ran a native tool path, had no tools, or failed before recording.

## Where things land

Outputs default under `temp/oracle/`: the per-experiment results CSV next to a directory of retrieved JSONs and replay trails. The replay's own OpenTelemetry database lands under `telemetry/oracle/`, which means a replayed experiment can itself be inspected with the telemetry browser like any live run.

CLI flags override the output and telemetry directories and the target agent. Bare experiment filenames resolve to `experiments/`.

The Oracle reads the same telemetry the [telepathist](telepathist.md) reads. One explains what happened; the other explores what could have happened instead.
