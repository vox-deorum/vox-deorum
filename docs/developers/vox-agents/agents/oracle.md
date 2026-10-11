# Oracle

The Oracle answers counterfactual questions: _what would the AI have decided on that turn if the prompt had been different, or the model had been someone else?_

Given a CSV of real game turns, it re-runs each turn's original LLM call, extracted verbatim from recorded telemetry, with whatever modifications an experiment specifies, then records what the model decides this time. Nothing touches a live game. The replayed model is given **schema-only tools**, so it produces tool-call intents that are captured as decisions but never executed.

```
recorded telemetry ──retrieve──► original prompts (JSON) ──replay with changes──► new decisions (CSV, trails)
```

The source lives in `src/oracle/`. Run experiments with:

```bash
npm run oracle -- -c <experiment.js>
```

## Two phases

Oracle deliberately splits its work into a retrieve phase and a replay phase.

**Retrieve** (`src/oracle/retriever.ts`) reads the input CSV, locates each row's telemetry database (scanning the telemetry directory for `{gameId}-player-{playerId}.db`), and extracts the raw original prompt exactly as recorded: system messages, conversation history, active tool names, the original model, and the recorded tool framing (see _Tool framing_). No LLM is involved and nothing is modified. The extracted rows can be saved as JSON for inspection.

**Replay** (`src/oracle/replayer.ts`) takes those rows, applies the experiment's `modifyPrompt` transformation, and runs each through the chosen model via a dedicated `OracleAgent`. It writes:

- a results CSV, one row per source row per model, with the replayed decision's rationale and token usage;
- JSON and markdown "trail" files reconstructing each conversation;
- a telemetry database of the replay itself.

Running without flags does both phases in sequence. `--retrieve` and `--replay` run one side alone.

The split is what makes iteration cheap. Extract once, confirm the right turns were found, then replay the same retrieved data repeatedly under different prompts or models without re-reading telemetry. Experiments can even share a retrieval through a common `retrievalName`.

### Finding the right turn

Turn numbers alone are unreliable, because botched and re-run turns reuse them. The Oracle validates its target with **rationale matching**: each CSV row carries a fragment of the original decision rationale, and the extractor fuzzy-matches it against the recorded tool calls. When a turn's record doesn't match, it falls back to the previous turn and emits a warning.

Only the last attempt at each turn is replayed:

- **Retries.** Earlier attempts at the same turn are botched retries and are skipped.
- **Reloads.** A reload also discards attempts. Say a seat played to turn 60, then the player loaded a turn-50 save and played to turn 55. Every turn recorded before the reload for turns 50 and later is discarded. Turns 56 to 60 are never replayed, and their rows come back as errors without the previous-turn fallback.
- **One database.** The rule reads one telemetry database, and each database belongs to one strategist. A reload played under a different strategist is not visible to it.

Retrieved JSON and replay trails made before this rule existed may still hold discarded turns. Run retrieval again and replay with `--forceReplay` to rebuild them.

## Experiments

An experiment is an ES module exporting an `OracleConfig`. See `src/oracle/types.ts` for the exact shape and `vox-agents/experiments/` for examples. Beyond the required CSV path and experiment name, the main controls are:

- **`modifyPrompt`** is the heart of the experiment. It receives the original system prompts, messages, active tools, model, and CSV row, and returns whichever of those it wants to override: rewrite one sentence of the system prompt, drop a briefing, hide a tool. Omitted fields keep their originals. It also carries the original turn's recorded `framing` (see _Tool framing_ below).
- **`modelOverride`** redirects the replay to a different model, or to an _array_ of models. With an array, each row is replayed once per entry for side-by-side comparison. Duplicating a model in the array repeats the sample, with results distinguished by a repetition index. Its third argument exposes the original turn's `{ framing }`, so an experiment can return a model with `options.framing` set to reproduce the source framing.
- **`rewriteToolSchemas`** rewrites the tool descriptions and schemas the model sees, useful for terminology experiments.
- **`toolChoice`** controls whether the replay model may choose whether to call a tool (`auto`, the default), must call at least one tool (`required`), or cannot call tools (`none`). With `required`, each step's closing reminder says a call is required, as it does for any agent. Anthropic and Codex do not accept `required` directly, so they receive `auto` at the provider boundary. A recorded first step from a `required` agent already ends with that reminder, so the replayed messages keep it under any setting.
- **`completionTools`** names the tools that complete a strategist replay, identifies which tool decisions carry an extracted rationale, and tells the Anthropic and Codex completion-tool instruction which calls finish the turn. On continuation steps, Oracle also reminds the model to finish with the configured completion tools that remain active. It defaults to `set-strategy`, `set-flavors`, and `keep-status-quo`.
- **`filter`** narrows which CSV rows run.
- **`extractColumns`** pulls experiment-specific values out of each replay into extra CSV columns.

Replays run with limited concurrency and reuse existing trail files to skip rows already done.

**Batch mode.** Large experiments can go through provider batch APIs (`src/oracle/batch/`). Batch requests go straight to the provider without the [tool-rescue middleware](../models/middleware.md#prompt-mode-tool-calling), so batch mode does not work with prompt-mode models (`options.toolMiddleware: 'prompt'`). Replaying one in batch mode throws an error. Switch those rows to a native tool-calling model or turn batch mode off. Tools the original run removed mid-run are still rejected in batch mode, using the same rejection hooks as the normal path. Rejected calls never count as decisions in either mode.

### Tool framing

Prompt-mode models don't call tools natively; the tool-rescue middleware strips native tools and injects a JSON tool-call protocol as a system message. For claude-code models, that protocol and the agent's own system prose are reframed from "tool" to "action": the CLI persona reasons in terms of actions, and the reframing keeps the game tools from reading as the CLI's native tools. Each replayed turn records the resolved framing as telemetry: `step.tool_framing`, either `'tool'` or `'action'`. The injected protocol block itself is deliberately **not** recorded; replay reconstructs it from the replay model's own framing, so there is nothing stored to drift out of sync.

Retrieve surfaces this on every row as `framing`. It is **informational**, because replay framing derives solely from the replay model: a prompt-mode model replaying a claude-code turn is told "tools", not "actions". To reproduce the original view deliberately, either return a model with `options.framing` set from `modelOverride`, or apply the exported `reframeToolWording` helper to the system prompt inside `modifyPrompt`. `framing` is `undefined` for turns that predate the telemetry, ran a native tool path, had no tools, or failed before recording.

## Where things land

Outputs default under `temp/oracle/`: the per-experiment results CSV next to a directory of retrieved JSONs and replay trails. The replay's own OpenTelemetry database lands under `telemetry/oracle/`, which means a replayed experiment can itself be inspected with the telemetry browser like any live run.

CLI flags override the output and telemetry directories and the target agent. Bare experiment filenames resolve to `experiments/`.

### Stopping a run

| Key | Effect |
| --- | --- |
| Ctrl+A | Graceful stop, and the same key the strategist console uses. No new work starts, work already started finishes (including requests the batch manager accepted), and later phases are skipped. Press Ctrl+A again before the work drains to continue normally. |
| Ctrl+C | Shuts down right away, using the normal interrupted-task behavior. Press it again to force-quit. |

What survives a stop:

- Retrieved JSON files and replay trails that finished are kept. The next replay reuses trails as a cache. Retrieved JSON is kept for inspection only and is not reused as a cache.
- After a graceful stop, the results CSV is left untouched if any queued task was held back. If every task had already started, the CSV is written normally.

The Oracle shuts down through its process manager when the run ends, whether it stopped early or finished.

The Oracle reads the same telemetry the [telepathist](telepathist.md) reads. One explains what happened; the other explores what could have happened instead.
